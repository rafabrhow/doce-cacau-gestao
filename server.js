import dotenv from 'dotenv'
import express from 'express'
import multer from 'multer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import { google } from 'googleapis'
import admin from 'firebase-admin'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
// .env.local é usado somente no ambiente local. Na Vercel, use Environment Variables.
if (process.env.VERCEL !== '1') dotenv.config({ path: path.join(ROOT, '.env.local') })

const app = express()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } })
const PORT = Number(process.env.LOCAL_API_PORT || 8787)
const TOKEN_PATH = path.join(ROOT, '.google-drive-token.json')
const isProduction = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production'
const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'FIREBASE_SERVICE_ACCOUNT_JSON']
const oauthStates = new Map()
const driveTokenRef = () => admin.firestore().doc('stores/doce-cacau/private_integrations/google_drive')
const oauthStateRef = state => admin.firestore().doc(`stores/doce-cacau/oauth_states/${state}`)

// A interface chama a API no mesmo domínio; não habilitamos CORS genérico.
app.use(express.json({ limit: '1mb' }))

let firebaseReady = false
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)
    if (!admin.apps.length) admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
    firebaseReady = true
  }
} catch (error) { console.error('FIREBASE_SERVICE_ACCOUNT_JSON inválido:', error.message) }

function oauthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI)
}
function encryptionKey() {
  const secret = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
  if (!secret || secret.length < 32) throw new Error('Configure GOOGLE_TOKEN_ENCRYPTION_KEY com pelo menos 32 caracteres.')
  // Deriva sempre uma chave AES-256 de 32 bytes, sem guardar o segredo no banco.
  return createHash('sha256').update(secret, 'utf8').digest()
}
function encryptTokens(tokens) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(tokens), 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }
}
function decryptTokens(record) {
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(record.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(record.authTag, 'base64'))
  const clear = Buffer.concat([decipher.update(Buffer.from(record.ciphertext, 'base64')), decipher.final()]).toString('utf8')
  return JSON.parse(clear)
}
async function readTokens() {
  if (isProduction) {
    if (!firebaseReady) throw new Error('Firebase Admin não está configurado na Vercel.')
    const snapshot = await driveTokenRef().get()
    if (!snapshot.exists) return null
    const record = snapshot.data()
    return decryptTokens(record)
  }
  try { return fs.existsSync(TOKEN_PATH) ? JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8')) : null } catch { return null }
}
async function saveTokens(tokens) {
  const current = await readTokens().catch(() => null) || {}
  const merged = { ...current, ...tokens }
  if (isProduction) {
    if (!firebaseReady) throw new Error('Firebase Admin não está configurado na Vercel.')
    const encrypted = encryptTokens(merged)
    await driveTokenRef().set({ ...encrypted, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
  } else {
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged), { mode: 0o600 })
    try { fs.chmodSync(TOKEN_PATH, 0o600) } catch {}
  }
  return merged
}
async function loadDriveAuth() {
  const tokens = await readTokens()
  if (!tokens) return null
  const client = oauthClient()
  client.setCredentials(tokens)
  client.on('tokens', refreshed => {
    saveTokens(refreshed).catch(error => console.error('Falha ao salvar renovação do Google Drive:', error.message))
  })
  return client
}
async function saveOAuthState(state, uid) {
  const value = { uid, createdAt: Date.now() }
  if (isProduction) {
    if (!firebaseReady) throw new Error('Firebase Admin não está configurado na Vercel.')
    await oauthStateRef(state).set(value)
  } else oauthStates.set(state, value)
}
async function consumeOAuthState(state) {
  if (isProduction) {
    if (!firebaseReady) return null
    const ref = oauthStateRef(state)
    const snapshot = await ref.get()
    if (snapshot.exists) await ref.delete()
    return snapshot.exists ? snapshot.data() : null
  }
  const value = oauthStates.get(state) || null
  oauthStates.delete(state)
  return value
}
async function requireUser(req, res, next) {
  try {
    if (!firebaseReady) return res.status(503).json({ error: 'Serviço de autenticação indisponível. Verifique as variáveis de ambiente da API.' })
    const match = String(req.headers.authorization || '').match(/^Bearer\s+(.+)$/i)
    if (!match) return res.status(401).json({ error: 'Faça login no Doce Cacau.' })
    const decoded = await admin.auth().verifyIdToken(match[1])
    const member = await admin.firestore().doc(`stores/doce-cacau/users/${decoded.uid}`).get()
    if (!member.exists || member.data()?.active !== true) return res.status(403).json({ error: 'Usuário sem acesso ativo à Doce Cacau.' })
    req.user = decoded
    next()
  } catch (error) {
    console.error('Falha de autenticação da API:', error.message)
    res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente no sistema.' })
  }
}
async function getProductsFolder(drive) {
  const q = "name = 'Doce Cacau' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  const found = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 10 })
  let parent = found.data.files?.[0]?.id
  if (!parent) parent = (await drive.files.create({ requestBody: { name: 'Doce Cacau', mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' })).data.id
  const q2 = `'${parent}' in parents and name = 'Produtos' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const child = await drive.files.list({ q: q2, fields: 'files(id,name)', pageSize: 10 })
  if (child.data.files?.[0]?.id) return child.data.files[0].id
  return (await drive.files.create({ requestBody: { name: 'Produtos', mimeType: 'application/vnd.google-apps.folder', parents: [parent] }, fields: 'id' })).data.id
}
async function assertProductImage(drive, fileId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) throw new Error('Identificador de imagem inválido.')
  const metadata = await drive.files.get({ fileId, fields: 'id,mimeType,parents,trashed' })
  const folderId = await getProductsFolder(drive)
  if (metadata.data.trashed || !String(metadata.data.mimeType || '').startsWith('image/') || !(metadata.data.parents || []).includes(folderId)) {
    const error = new Error('A imagem não pertence à pasta de produtos da Doce Cacau.')
    error.status = 403
    throw error
  }
  return metadata.data
}

app.get('/api/drive/status', requireUser, async (_req, res) => {
  const configured = required.every(key => Boolean(process.env[key])) && (!isProduction || Boolean(process.env.GOOGLE_TOKEN_ENCRYPTION_KEY))
  let connected = false
  try { connected = Boolean(await loadDriveAuth()) } catch (error) { console.error('Status Google Drive:', error.message) }
  res.json({ configured, connected, folder: 'Doce Cacau/Produtos' })
})
app.get('/api/drive/connect', requireUser, async (req, res) => {
  try {
    if (!required.slice(0, 3).every(key => Boolean(process.env[key]))) return res.status(503).json({ error: 'Configure as credenciais OAuth do Google nas variáveis de ambiente.' })
    if (isProduction && (!firebaseReady || !process.env.GOOGLE_TOKEN_ENCRYPTION_KEY)) return res.status(503).json({ error: 'Configure Firebase Admin e a chave de criptografia na Vercel.' })
    const state = randomBytes(32).toString('hex')
    await saveOAuthState(state, req.user.uid)
    const url = oauthClient().generateAuthUrl({ access_type: 'offline', prompt: 'consent', state, scope: ['https://www.googleapis.com/auth/drive'] })
    res.json({ url })
  } catch (error) { console.error('Início OAuth:', error.message); res.status(500).json({ error: 'Não foi possível iniciar a conexão com o Google Drive.' }) }
})
app.get('/api/drive/oauth2callback', async (req, res) => {
  try {
    const state = String(req.query.state || '')
    const pending = state ? await consumeOAuthState(state) : null
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) return res.status(400).send('Autorização expirada ou inválida. Volte ao Doce Cacau e tente conectar novamente.')
    if (req.query.error) return res.status(400).send('A autorização do Google foi cancelada.')
    const { tokens } = await oauthClient().getToken(String(req.query.code || ''))
    await saveTokens(tokens)
    const client = oauthClient(); client.setCredentials(tokens)
    await getProductsFolder(google.drive({ version: 'v3', auth: client }))
    res.send('<h2>Google Drive conectado!</h2><p>Você já pode voltar ao Doce Cacau.</p><script>setTimeout(()=>window.close(),1800)</script>')
  } catch (error) { console.error('OAuth callback:', error); res.status(500).send('Falha ao conectar o Google Drive. Verifique as variáveis de ambiente do servidor.') }
})
app.post('/api/drive/upload', requireUser, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Selecione uma imagem.' })
    if (!req.file.mimetype.startsWith('image/')) return res.status(415).json({ error: 'Envie um arquivo de imagem.' })
    const auth = await loadDriveAuth()
    if (!auth) return res.status(409).json({ error: 'Conecte o Google Drive antes de enviar imagens.' })
    const drive = google.drive({ version: 'v3', auth })
    const folderId = await getProductsFolder(drive)
    const productId = String(req.body.productId || 'produto').replace(/[^a-zA-Z0-9_-]/g, '_')
    const safeName = String(req.file.originalname || 'imagem').replace(/[^\w.-]/g, '_').slice(0, 100)
    const result = await drive.files.create({
      requestBody: { name: `${productId}-${Date.now()}-${safeName}`, mimeType: req.file.mimetype, parents: [folderId] },
      media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) }, fields: 'id,name'
    })
    res.json({ fileId: result.data.id, image: '', name: result.data.name })
  } catch (error) { console.error('Upload Drive:', error); res.status(500).json({ error: 'Não foi possível enviar a foto ao Google Drive.' }) }
})
app.get('/api/drive/image/:id', requireUser, async (req, res) => {
  try {
    const auth = await loadDriveAuth()
    if (!auth) return res.status(409).json({ error: 'Google Drive desconectado.' })
    const drive = google.drive({ version: 'v3', auth })
    const metadata = await assertProductImage(drive, String(req.params.id || ''))
    const result = await drive.files.get({ fileId: req.params.id, alt: 'media' }, { responseType: 'stream' })
    res.setHeader('Content-Type', metadata.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    result.data.on('error', error => { console.error('Erro ao transmitir imagem:', error); if (!res.headersSent) res.status(502).end() })
    result.data.pipe(res)
  } catch (error) { console.error('Imagem Drive:', error.message); res.status(error.status || 404).json({ error: error.status ? error.message : 'Não foi possível carregar a imagem do Drive.' }) }
})
app.delete('/api/drive/file/:id', requireUser, async (req, res) => {
  try {
    const auth = await loadDriveAuth()
    if (!auth) return res.status(409).json({ error: 'Google Drive desconectado.' })
    const drive = google.drive({ version: 'v3', auth })
    await assertProductImage(drive, String(req.params.id || ''))
    await drive.files.delete({ fileId: req.params.id })
    res.json({ ok: true })
  } catch (error) { console.error('Exclusão Drive:', error.message); res.status(error.status || 500).json({ error: error.status ? error.message : 'Não foi possível excluir a imagem.' }) }
})

// Exportação usada pela função serverless da Vercel.
export default app

// Mantém o servidor HTTP local para npm run server / npm run dev:all.
if (process.env.VERCEL !== '1' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, '127.0.0.1', () => console.log(`API local Doce Cacau em http://127.0.0.1:${PORT}`))
}
