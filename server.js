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
async function saveTokens(tokens, { replace = false } = {}) {
  // Na reconexão explícita, não reutilize um refresh_token antigo/revogado.
  // Na renovação automática, preserve o refresh_token porque o Google normalmente
  // não o envia novamente junto com cada novo access_token.
  const current = replace ? {} : (await readTokens().catch(() => null) || {})
  const merged = { ...current, ...tokens }
  if (replace && !tokens.refresh_token) {
    throw new Error('O Google não retornou um novo token de atualização. Revogue o acesso antigo do Doce Cacau na sua Conta Google e tente conectar novamente.')
  }
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
async function notifyAdminsOfNewPublicOrder(orderNumber) {
  if (!firebaseReady) return
  try {
    const db = admin.firestore()
    const users = await db.collection('stores/doce-cacau/users').where('active', '==', true).get()
    const tokens = []
    for (const userDoc of users.docs) {
      const tokenDocs = await userDoc.ref.collection('push_tokens').get()
      tokenDocs.forEach(tokenDoc => {
        const value = String(tokenDoc.data()?.token || '')
        if (value) tokens.push({ token: value, ref: tokenDoc.ref })
      })
    }
    for (let offset = 0; offset < tokens.length; offset += 500) {
      const batch = tokens.slice(offset, offset + 500)
      const result = await admin.messaging().sendEachForMulticast({
        tokens: batch.map(item => item.token),
        // Dados mínimos: não incluir dados pessoais nem conteúdo do pedido.
        data: { title: 'Novo pedido · Doce Cacau', body: `O pedido ${String(orderNumber)} está aguardando atendimento.`, orderNumber: String(orderNumber), type: 'new_public_order' },
        webpush: { headers: { Urgency: 'high', TTL: '86400' } }
      })
      const invalid = []
      result.responses.forEach((response, index) => {
        if (!response.success && ['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(response.error?.code)) invalid.push(batch[index].ref.delete())
      })
      if (invalid.length) await Promise.all(invalid)
    }
  } catch (error) {
    // A falha de push nunca deve impedir a confirmação do pedido do cliente.
    console.error('Falha ao enviar push de novo pedido:', error.message)
  }
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
async function getStoreRootFolder(drive) {
  const q = "name = 'Doce Cacau' and mimeType = 'application/vnd.google-apps.folder' and trashed = false"
  const found = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 10 })
  if (found.data.files?.[0]?.id) return found.data.files[0].id
  return (await drive.files.create({ requestBody: { name: 'Doce Cacau', mimeType: 'application/vnd.google-apps.folder' }, fields: 'id' })).data.id
}
async function getProductsFolder(drive) {
  const parent = await getStoreRootFolder(drive)
  const q = `'${parent}' in parents and name = 'Produtos' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const child = await drive.files.list({ q, fields: 'files(id,name)', pageSize: 10 })
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
  let reauthorizationRequired = false
  let message = ''
  try {
    const auth = await loadDriveAuth()
    if (auth) {
      // Apenas existir um objeto OAuth não significa que o refresh_token ainda é válido.
      // Esta chamada força o Google a validar a autorização de verdade.
      await google.drive({ version: 'v3', auth }).about.get({ fields: 'user' })
      connected = true
    } else {
      message = 'Google Drive ainda não foi conectado.'
    }
  } catch (error) {
    const googleCode = String(error?.response?.data?.error || error?.code || '')
    const errorText = String(error?.message || '')
    reauthorizationRequired = googleCode === 'invalid_grant' || errorText.includes('invalid_grant')
    message = reauthorizationRequired
      ? 'A autorização do Google Drive expirou ou foi revogada. Reconecte sua conta.'
      : 'Não foi possível validar a conexão com o Google Drive.'
    console.error('Status Google Drive:', { code: googleCode, message: errorText })
  }
  res.setHeader('Cache-Control', 'no-store')
  res.json({ configured, connected, reauthorizationRequired, message, folder: 'Doce Cacau/Produtos' })
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
    if (!tokens.refresh_token) {
      throw new Error('O Google não retornou refresh_token. Revogue o acesso antigo do Doce Cacau na Conta Google e tente novamente.')
    }
    const client = oauthClient(); client.setCredentials(tokens)
    const drive = google.drive({ version: 'v3', auth: client })
    await drive.about.get({ fields: 'user' })
    await getProductsFolder(drive)
    // A troca é intencional: não manter o refresh_token antigo que gerou invalid_grant.
    await saveTokens(tokens, { replace: true })
    res.send('<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Google Drive conectado</title><body style="font-family:Arial,sans-serif;padding:32px;color:#503529"><h2>Google Drive conectado!</h2><p>A autorização foi renovada. Você já pode voltar ao Doce Cacau.</p><script>if(window.opener){window.opener.postMessage({type:"DOCE_CACAU_DRIVE_CONNECTED"},window.location.origin)}setTimeout(()=>window.close(),1400)</script></body></html>')
  } catch (error) {
    console.error('OAuth callback:', error)
    const message = String(error?.message || 'Falha ao conectar o Google Drive.')
    const safeMessage = message.replace(/[<>]/g, '').slice(0, 500)
    res.status(500).send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Falha na conexão</title><body style="font-family:Arial,sans-serif;padding:32px;color:#503529"><h2>Não foi possível conectar o Google Drive</h2><p>${safeMessage}</p><p>Volte ao Doce Cacau e tente novamente.</p></body></html>`)
  }
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
    const fileId = String(req.params.id || '').trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) return res.status(400).json({ error: 'Identificador de imagem inválido.' })
    const products = admin.firestore().collection('stores/doce-cacau/products')
    const [primary, secondary] = await Promise.all([
      products.where('driveFileId', '==', fileId).limit(1).get(),
      products.where('driveFileId2', '==', fileId).limit(1).get()
    ])
    const product = primary.docs[0]?.data() || secondary.docs[0]?.data()
    if (!product || product.archived === true || product.isCanceled === true) {
      return res.status(404).json({ error: 'A imagem não está vinculada a um produto ativo.' })
    }
    const auth = await loadDriveAuth()
    if (!auth) return res.status(409).json({ error: 'Google Drive desconectado. Reconecte sua conta.' })
    const drive = google.drive({ version: 'v3', auth })
    const metadata = await drive.files.get({ fileId, fields: 'id,mimeType,trashed' })
    if (metadata.data.trashed || !String(metadata.data.mimeType || '').startsWith('image/')) {
      return res.status(404).json({ error: 'O arquivo vinculado não é uma imagem disponível.' })
    }
    const result = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    res.setHeader('Content-Type', metadata.data.mimeType)
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    result.data.on('error', error => { console.error('Erro ao transmitir imagem:', error); if (!res.headersSent) res.status(502).end() })
    result.data.pipe(res)
  } catch (error) {
    const code = String(error?.response?.data?.error || error?.code || '')
    console.error('Imagem Drive:', error.message)
    res.status(code === 'invalid_grant' ? 409 : (error.status || 500)).json({
      error: code === 'invalid_grant' ? 'A autorização do Google Drive expirou. Reconecte sua conta.' : (error.status ? error.message : 'Não foi possível carregar a imagem do Drive.')
    })
  }
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



// Catálogo público da Loja Virtual: entrega somente campos comerciais autorizados.
app.get('/api/loja/catalogo', async (_req, res) => {
  try {
    if (!firebaseReady) {
      return res.status(503).json({ error: 'Catálogo temporariamente indisponível: Firebase Admin não configurado.' })
    }

    const db = admin.firestore()
    const storeRef = db.doc('stores/doce-cacau/settings/loja-virtual')
    const settingsSnap = await storeRef.get()
    const settings = settingsSnap.exists ? settingsSnap.data() : {}

    if (settings.enabled !== true) {
      return res.status(404).json({ error: 'A loja virtual está temporariamente fechada.' })
    }

    const productsSnap = await db.collection('stores/doce-cacau/products').get()
    const products = productsSnap.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .filter(product =>
        product.archived !== true &&
        product.isCanceled !== true &&
        Number(product.stock) > 0 &&
        Number(product.price) > 0 &&
        String(product.name || '').trim()
      )
      .map(product => {
        const primaryId = String(product.driveFileId || '').trim()
        const secondaryId = String(product.driveFileId2 || '').trim()
        const legacyImage = String(product.image || '').startsWith('https://') ? product.image : ''
        const imageUrls = [
          primaryId ? `/api/loja/imagem/${encodeURIComponent(primaryId)}` : legacyImage,
          secondaryId ? `/api/loja/imagem/${encodeURIComponent(secondaryId)}` : ''
        ].filter(Boolean)

        return {
          id: product.id,
          name: String(product.name).trim(),
          category: String(product.category || ''),
          brand: String(product.brand || ''),
          price: Number(product.price),
          imageUrl: imageUrls[0] || '',
          imageUrls
        }
      })

    res.setHeader('Cache-Control', 'no-store')
    res.json({ storeName: 'Doce Cacau', products })
  } catch (error) {
    console.error('Catálogo público:', error)
    res.status(500).json({ error: 'Não foi possível carregar o catálogo.' })
  }
})

// Imagens públicas: o vínculo do ID ao produto ativo no Firestore é a autorização.
// Não exigimos que o arquivo esteja na pasta "Produtos", pois essa validação por
// pasta pode rejeitar imagens antigas válidas caso a pasta tenha sido recriada.
app.get('/api/loja/imagem/:id', async (req, res) => {
  try {
    if (!firebaseReady) {
      return res.status(503).json({ error: 'Serviço de imagens temporariamente indisponível.' })
    }

    const fileId = String(req.params.id || '').trim()
    if (!/^[a-zA-Z0-9_-]+$/.test(fileId)) {
      return res.status(400).json({ error: 'Identificador de imagem inválido.' })
    }

    const productsRef = admin.firestore().collection('stores/doce-cacau/products')
    const [primarySnap, secondarySnap] = await Promise.all([
      productsRef.where('driveFileId', '==', fileId).limit(1).get(),
      productsRef.where('driveFileId2', '==', fileId).limit(1).get()
    ])

    const product = primarySnap.docs[0]?.data() || secondarySnap.docs[0]?.data()
    if (!product || product.archived === true || product.isCanceled === true || Number(product.stock) <= 0) {
      return res.status(404).json({ error: 'Imagem não vinculada a um produto disponível.' })
    }

    const auth = await loadDriveAuth()
    if (!auth) {
      return res.status(503).json({ error: 'Google Drive não está conectado.' })
    }

    const drive = google.drive({ version: 'v3', auth })
    const metadata = await drive.files.get({
      fileId,
      fields: 'id,mimeType,trashed'
    })

    if (metadata.data.trashed || !String(metadata.data.mimeType || '').startsWith('image/')) {
      return res.status(404).json({ error: 'O arquivo vinculado não é uma imagem disponível.' })
    }

    const result = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    res.setHeader('Content-Type', metadata.data.mimeType)
    res.setHeader('Cache-Control', 'public, max-age=2592000, stale-while-revalidate=604800')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    result.data.on('error', error => {
      console.error('Transmissão da imagem do catálogo:', error)
      if (!res.headersSent) res.status(502).end()
      else res.destroy(error)
    })
    result.data.pipe(res)
  } catch (error) {
    const status = Number(error.status) || Number(error.code) || 500
    console.error('Imagem do catálogo:', {
      message: error.message,
      code: error.code,
      status: error.status,
      fileId: req.params.id
    })
    if (!res.headersSent) {
      res.status(status >= 400 && status <= 599 ? status : 500)
        .json({ error: 'Não foi possível carregar a imagem do catálogo.' })
    }
  }
})


// Checkout público: rascunhos e pedidos ficam isolados das vendas/financeiro do PDV.
function publicDraftRef(token) {
  if (!/^[a-f0-9-]{32,36}$/i.test(token)) throw new Error('Identificador do pedido inválido.')
  return admin.firestore().doc(`stores/doce-cacau/public_order_drafts/${token}`)
}
async function validatePublicItems(items) {
  if (!Array.isArray(items) || !items.length || items.length > 40) throw new Error('A sacola está vazia ou contém itens demais.')
  const db = admin.firestore()
  const normalized = []
  for (const entry of items) {
    const productId = String(entry.productId || '')
    const quantity = Number(entry.quantity)
    if (!productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 30) throw new Error('Quantidade de produto inválida.')
    const snap = await db.doc(`stores/doce-cacau/products/${productId}`).get()
    if (!snap.exists) throw new Error('Um produto da sacola não está mais disponível.')
    const p = snap.data()
    if (p.archived === true || p.isCanceled === true || Number(p.stock) < quantity || Number(p.price) <= 0) {
      throw new Error(`Estoque insuficiente ou produto indisponível: ${p.name || 'produto'}.`)
    }
    normalized.push({
      productId, name: String(p.name || ''), barcode: String(p.barcode || ''),
      quantity, unitPrice: Number(p.price), unitCost: Math.max(0,Number(p.cost)||0), lineTotal: Number(p.price) * quantity
    })
  }
  return normalized
}
function sanitizeCustomer(value = {}) {
  const text = (v, max) => String(v || '').trim().slice(0, max)
  const fulfillment = value.fulfillment === 'entrega' ? 'entrega' : 'retirada'
  const payment = value.payment === 'pix_entrega' ? 'cartao' : (['pix_antecipado', 'cartao', 'dinheiro'].includes(value.payment) ? value.payment : 'pix_antecipado')
  return {
    name: text(value.name, 100), phone: text(value.phone, 25),
    fulfillment, address: text(value.address, 220), reference: text(value.reference, 150),
    payment, notes: text(value.notes, 400)
  }
}
app.get('/api/loja/checkout', async (_req, res) => {
  try {
    if (!firebaseReady) return res.status(503).json({ error: 'Checkout temporariamente indisponível.' })
    const db = admin.firestore()
    const settingsSnap = await db.doc('stores/doce-cacau/settings/loja-virtual').get()
    const s = settingsSnap.exists ? settingsSnap.data() : {}
    if (s.enabled !== true) return res.status(404).json({ error: 'A loja virtual está temporariamente fechada.' })
    const productsSnap = await db.collection('stores/doce-cacau/products').get()
    const products = productsSnap.docs.map(d => ({ id: d.id, name: String(d.data().name || ''), price: Number(d.data().price) || 0 }))
      .filter(p => p.name && p.price > 0)
    res.setHeader('Cache-Control', 'no-store')
    res.json({
      settings: {
        allowCashOnDelivery: s.allowCashOnDelivery === true,
        allowPixAdvance: s.allowPixAdvance === true,
        allowCardOnDelivery: s.allowCardOnDelivery === true || (s.allowCardOnDelivery === undefined && s.allowPixOnDelivery === true),
        pixKeyType: String(s.pixKeyType || 'aleatoria'), pixKey: String(s.pixKey || ''),
        pixHolder: String(s.pixHolder || ''), pixCity: String(s.pixCity || ''),
        allowPickup: s.allowPickup !== false, allowDelivery: s.allowDelivery === true,
        deliveryFee: Math.max(0, Number(s.deliveryFee) || 0)
      },
      products
    })
  } catch (error) {
    console.error('Configuração checkout:', error)
    res.status(500).json({ error: 'Não foi possível preparar o checkout.' })
  }
})
app.post('/api/loja/rascunhos', async (req, res) => {
  try {
    if (!firebaseReady) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' })
    const settingsSnap = await admin.firestore().doc('stores/doce-cacau/settings/loja-virtual').get()
    if (!settingsSnap.exists || settingsSnap.data().enabled !== true) return res.status(404).json({ error: 'A loja virtual está temporariamente fechada.' })
    const items = await validatePublicItems(req.body.items)
    const customer = sanitizeCustomer(req.body.customer)
    const token = randomBytes(18).toString('hex')
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
    await publicDraftRef(token).set({
      token, items, customer, subtotal, status: 'rascunho',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    })
    res.status(201).json({ token })
  } catch (error) {
    res.status(400).json({ error: error.message || 'Não foi possível salvar o pedido.' })
  }
})
app.get('/api/loja/rascunhos/:token', async (req, res) => {
  try {
    if (!firebaseReady) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' })
    const snap = await publicDraftRef(String(req.params.token)).get()
    if (!snap.exists) return res.status(404).json({ error: 'Pedido salvo não encontrado ou expirado.' })
    const draft = snap.data()
    if (draft.expiresAt?.toDate && draft.expiresAt.toDate().getTime() < Date.now()) return res.status(410).json({ error: 'O prazo para retomar este pedido expirou.' })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ draft: { items: draft.items || [], customer: draft.customer || {}, status: draft.status, orderNumber: draft.orderNumber || '', proofFileName: draft.proofFileName || '' } })
  } catch (error) { res.status(400).json({ error: error.message || 'Não foi possível recuperar o pedido.' }) }
})
app.patch('/api/loja/rascunhos/:token', async (req, res) => {
  try {
    const ref = publicDraftRef(String(req.params.token))
    const snap = await ref.get()
    if (!snap.exists || snap.data().status === 'finalizado') return res.status(404).json({ error: 'Rascunho não encontrado ou já finalizado.' })
    const items = await validatePublicItems(req.body.items)
    const customer = sanitizeCustomer(req.body.customer)
    await ref.update({ items, customer, subtotal: items.reduce((sum, item) => sum + item.lineTotal, 0), updatedAt: admin.firestore.FieldValue.serverTimestamp() })
    res.json({ ok: true })
  } catch (error) { res.status(400).json({ error: error.message || 'Não foi possível atualizar o pedido.' }) }
})
app.post('/api/loja/rascunhos/:token/comprovante', upload.single('proof'), async (req, res) => {
  try {
    if (!firebaseReady) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' })
    if (!req.file) return res.status(400).json({ error: 'Selecione o comprovante.' })
    if (!['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(req.file.mimetype)) return res.status(415).json({ error: 'Envie um PDF, JPG, PNG ou WEBP.' })
    const ref = publicDraftRef(String(req.params.token))
    const draft = await ref.get()
    if (!draft.exists || draft.data().status === 'finalizado') return res.status(404).json({ error: 'Pedido salvo não encontrado.' })
    const auth = await loadDriveAuth()
    if (!auth) return res.status(503).json({ error: 'O recebimento de comprovantes está temporariamente indisponível. Entre em contato com a loja.' })
    const drive = google.drive({ version: 'v3', auth })
    const rootFolder = await getStoreRootFolder(drive)
    const q = `'${rootFolder}' in parents and name = 'Comprovantes Loja Virtual' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    const found = await drive.files.list({ q, fields: 'files(id)', pageSize: 5 })
    const folderId = found.data.files?.[0]?.id || (await drive.files.create({
      requestBody: { name: 'Comprovantes Loja Virtual', mimeType: 'application/vnd.google-apps.folder', parents: [rootFolder] }, fields: 'id'
    })).data.id
    const safeName = String(req.file.originalname || 'comprovante').replace(/[^\w.-]/g, '_').slice(0, 80)
    const uploaded = await drive.files.create({
      requestBody: { name: `pedido-${String(req.params.token).slice(0, 8)}-${Date.now()}-${safeName}`, mimeType: req.file.mimetype, parents: [folderId] },
      media: { mimeType: req.file.mimetype, body: Readable.from(req.file.buffer) }, fields: 'id,name'
    })
    await ref.update({ proofFileId: uploaded.data.id, proofFileName: safeName, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
    res.json({ ok: true, fileName: safeName })
  } catch (error) {
    console.error('Comprovante Loja Virtual:', error)
    res.status(500).json({ error: 'Não foi possível anexar o comprovante.' })
  }
})

// Registro seguro do dispositivo autenticado para receber notificações administrativas.
app.post('/api/admin/push-token', requireUser, async (req, res) => {
  try {
    const token = String(req.body.token || '').trim()
    if (token.length < 40 || token.length > 4096) return res.status(400).json({ error: 'Token de notificações inválido.' })
    const memberRef = admin.firestore().doc(`stores/doce-cacau/users/${req.user.uid}`)
    const member = await memberRef.get()
    if (!member.exists || member.data()?.active !== true) return res.status(403).json({ error: 'Usuário sem acesso ativo.' })
    const tokenId = createHash('sha256').update(token).digest('hex')
    await memberRef.collection('push_tokens').doc(tokenId).set({ token, platform: 'web', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ ok: true })
  } catch (error) {
    console.error('Registro token push:', error)
    res.status(500).json({ error: 'Não foi possível registrar as notificações neste dispositivo.' })
  }
})

// Painel administrativo dos pedidos recebidos pela Loja Virtual.
app.get('/api/loja/admin/pedidos/contagem', requireUser, async (_req, res) => {
  try {
    const snapshot = await admin.firestore().collection('stores/doce-cacau/public_orders').where('status', '==', 'pendente').count().get()
    res.setHeader('Cache-Control', 'no-store')
    res.json({ pending: snapshot.data().count || 0 })
  } catch (error) {
    console.error('Contagem pedidos pendentes:', error)
    res.status(500).json({ error: 'Não foi possível consultar a contagem de pedidos.' })
  }
})
app.get('/api/loja/admin/pedidos', requireUser, async (_req, res) => {
  try {
    const snap = await admin.firestore().collection('stores/doce-cacau/public_orders').get()
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data(), proofFileId: d.data().proofFileId || null }))
      .sort((a, b) => {
        const at = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
        const bt = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
        return bt - at
      })
    res.setHeader('Cache-Control', 'no-store')
    res.json({ orders })
  } catch (error) {
    console.error('Lista pedidos Loja Virtual:', error)
    res.status(500).json({ error: 'Não foi possível carregar os pedidos da loja.' })
  }
})

app.get('/api/loja/admin/comprovante/:token', requireUser, async (req, res) => {
  try {
    const snap = await admin.firestore().doc(`stores/doce-cacau/public_orders/${String(req.params.token)}`).get()
    if (!snap.exists || !snap.data().proofFileId) return res.status(404).json({ error: 'Este pedido não possui comprovante.' })
    const auth = await loadDriveAuth()
    if (!auth) return res.status(503).json({ error: 'Google Drive não está conectado.' })
    const drive = google.drive({ version: 'v3', auth })
    const fileId = String(snap.data().proofFileId)
    const metadata = await drive.files.get({ fileId, fields: 'id,name,mimeType,parents,trashed' })
    const rootFolder = await getStoreRootFolder(drive)
    const q = `'${rootFolder}' in parents and name = 'Comprovantes Loja Virtual' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
    const folders = await drive.files.list({ q, fields: 'files(id)', pageSize: 5 })
    const folderId = folders.data.files?.[0]?.id
    if (!folderId || metadata.data.trashed || !(metadata.data.parents || []).includes(folderId) || !['application/pdf','image/jpeg','image/png','image/webp'].includes(metadata.data.mimeType)) return res.status(403).json({ error: 'Comprovante inválido.' })
    const file = await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    res.setHeader('Content-Type', metadata.data.mimeType)
    res.setHeader('Content-Disposition', `inline; filename="${String(metadata.data.name || 'comprovante').replace(/["\r\n]/g, '')}"`)
    res.setHeader('Cache-Control', 'no-store')
    file.data.on('error', error => { console.error('Leitura comprovante:', error); if (!res.headersSent) res.status(502).end() })
    file.data.pipe(res)
  } catch (error) {
    console.error('Comprovante administrativo:', error)
    res.status(500).json({ error: 'Não foi possível abrir o comprovante.' })
  }
})

app.patch('/api/loja/admin/pedidos/:token', requireUser, async (req, res) => {
  try {
    const action = String(req.body.action || '')
    if (!['aprovar', 'recusar'].includes(action)) return res.status(400).json({ error: 'Ação inválida.' })
    const db = admin.firestore()
    const publicRef = db.doc(`stores/doce-cacau/public_orders/${String(req.params.token)}`)
    const memberSnap = await db.doc(`stores/doce-cacau/users/${req.user.uid}`).get()
    const operatorName = String(memberSnap.data()?.name || req.user.name || 'Equipe Doce Cacau')
    if (action === 'recusar') {
      await db.runTransaction(async tx => {
        const snap = await tx.get(publicRef)
        if (!snap.exists) throw new Error('Pedido não encontrado.')
        if (snap.data().status !== 'pendente') throw new Error('Este pedido já foi analisado.')
        tx.update(publicRef, { status: 'recusado', deliveryStatus: 'Pedido recusado', reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: req.user.uid, reviewedByName: operatorName, rejectionReason: String(req.body.reason || '').slice(0, 300) })
      })
      return res.json({ ok: true, status: 'recusado' })
    }

    await db.runTransaction(async tx => {
      const publicSnap = await tx.get(publicRef)
      if (!publicSnap.exists) throw new Error('Pedido não encontrado.')
      const publicOrder = publicSnap.data()
      if (publicOrder.status !== 'pendente') throw new Error('Este pedido já foi analisado.')
      const items = Array.isArray(publicOrder.items) ? publicOrder.items : []
      if (!items.length) throw new Error('O pedido não possui produtos.')
      const productRefs = items.map(item => db.doc(`stores/doce-cacau/products/${String(item.productId)}`))
      const productSnaps = []
      for (const ref of productRefs) productSnaps.push(await tx.get(ref))
      productSnaps.forEach((snap, index) => {
        const item = items[index]
        if (!snap.exists) throw new Error(`Produto não encontrado: ${item.name || 'produto'}.`)
        const product = snap.data()
        if (product.archived === true || product.isCanceled === true || Number(product.stock) < Number(item.quantity)) throw new Error(`Estoque insuficiente ou produto indisponível: ${item.name || product.name}.`)
      })
      const now = new Date().toISOString()
      const paidInAdvance = publicOrder.paymentMethod === 'pix_antecipado'
      const total = Number(publicOrder.total) || 0
      const orderId = `web-${String(req.params.token)}`
      const orderRef = db.doc(`stores/doce-cacau/orders/${orderId}`)
      const existing = await tx.get(orderRef)
      if (existing.exists) throw new Error('Este pedido já foi encaminhado para vendas.')
      const payments = paidInAdvance ? [{ id: `web-${String(req.params.token).slice(0, 12)}`, amount: total, method: 'Pix', date: now, user: operatorName, userId: req.user.uid }] : []
      const notes = [
        publicOrder.customer?.fulfillment === 'entrega' ? `Entrega: ${publicOrder.customer.address || ''}` : 'Retirada na loja',
        publicOrder.customer?.reference ? `Referência: ${publicOrder.customer.reference}` : '',
        publicOrder.customer?.notes ? `Observações do cliente: ${publicOrder.customer.notes}` : '',
        `Pedido da Loja Virtual: ${publicOrder.orderNumber}`
      ].filter(Boolean).join(' | ')
      const order = {
        id: orderId, customer: String(publicOrder.customer?.name || 'Cliente da loja'), phone: String(publicOrder.customer?.phone || ''),
        items: items.map(item => ({ productId: String(item.productId), name: String(item.name || ''), barcode: String(item.barcode || ''), quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), unitCost: Math.max(0,Number(item.unitCost)||0) })),
        total, subtotal: Number(publicOrder.subtotal) || total, deliveryFee: Number(publicOrder.deliveryFee) || 0,
        paymentStatus: paidInAdvance ? 'Pago' : 'A pagar', deliveryStatus: 'Reservado', paid: paidInAdvance ? total : 0,
        payments, seller: 'Loja Virtual', createdAt: now,
        pickupDate: publicOrder.customer?.fulfillment === 'entrega' ? 'Entrega' : 'Retirada', notes,
        createdBy: req.user.uid, createdByName: operatorName, source: 'loja_virtual', publicOrderNumber: publicOrder.orderNumber
      }
      productSnaps.forEach((snap, index) => {
        const item = items[index]
        const product = snap.data()
        const nextStock = Number(product.stock) - Number(item.quantity)
        tx.update(productRefs[index], { stock: nextStock, outOfStockSince: nextStock > 0 ? null : product.outOfStockSince || now, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
        const movementId = `web-${String(req.params.token).slice(0, 10)}-${index}`
        tx.set(db.doc(`stores/doce-cacau/stock_movements/${movementId}`), {
          id: movementId, productId: snap.id, productName: String(product.name || item.name), type: 'Reserva', quantity: Number(item.quantity),
          date: now, user: operatorName, userId: req.user.uid, detail: `Pedido Loja Virtual ${publicOrder.orderNumber}`
        })
      })
      tx.create(orderRef, order)
      tx.update(publicRef, { status: 'aprovado', deliveryStatus: 'Encaminhado para entrega', reviewedAt: admin.firestore.FieldValue.serverTimestamp(), reviewedBy: req.user.uid, reviewedByName: operatorName, internalOrderId: orderId })
    })
    res.json({ ok: true, status: 'aprovado' })
  } catch (error) {
    console.error('Análise pedido Loja Virtual:', error)
    res.status(409).json({ error: error.message || 'Não foi possível analisar o pedido.' })
  }
})

app.post('/api/loja/rascunhos/:token/finalizar', async (req, res) => {
  try {
    if (!firebaseReady) return res.status(503).json({ error: 'Serviço temporariamente indisponível.' })
    const db = admin.firestore()
    const ref = publicDraftRef(String(req.params.token))
    const snap = await ref.get()
    if (!snap.exists) return res.status(404).json({ error: 'Pedido salvo não encontrado.' })
    const draft = snap.data()
    if (draft.status === 'finalizado') return res.json({ ok: true, orderNumber: draft.orderNumber })
    const settingsSnap = await db.doc('stores/doce-cacau/settings/loja-virtual').get()
    const s = settingsSnap.exists ? settingsSnap.data() : {}
    if (s.enabled !== true) return res.status(409).json({ error: 'A loja está temporariamente fechada.' })
    const customer = sanitizeCustomer(draft.customer)
    if (!customer.name || customer.phone.replace(/\D/g, '').length < 10) return res.status(400).json({ error: 'Informe nome e telefone válidos.' })
    if (customer.fulfillment === 'entrega' && (!s.allowDelivery || !customer.address)) return res.status(400).json({ error: 'Entrega indisponível ou endereço incompleto.' })
    if (customer.fulfillment === 'retirada' && s.allowPickup === false) return res.status(400).json({ error: 'Retirada indisponível.' })
    if (customer.payment === 'dinheiro' && s.allowCashOnDelivery !== true) return res.status(400).json({ error: 'Pagamento em dinheiro indisponível.' })
    if (customer.payment === 'pix_antecipado' && (s.allowPixAdvance !== true || !draft.proofFileId)) return res.status(400).json({ error: 'Pix antecipado exige comprovante anexado.' })
    if (customer.payment === 'cartao' && !(s.allowCardOnDelivery === true || (s.allowCardOnDelivery === undefined && s.allowPixOnDelivery === true))) return res.status(400).json({ error: 'Pagamento com cartão na entrega/retirada indisponível.' })
    const items = await validatePublicItems(draft.items)
    const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0)
    const deliveryFee = customer.fulfillment === 'entrega' ? Math.max(0, Number(s.deliveryFee) || 0) : 0
    const total = subtotal + deliveryFee
    const orderNumber = `DC-${String(req.params.token).slice(0, 7).toUpperCase()}`
    const orderRef = db.doc(`stores/doce-cacau/public_orders/${String(req.params.token)}`)
    const order = {
      orderNumber, source: 'loja_virtual', customer, items, subtotal, deliveryFee, total,
      paymentMethod: customer.payment, paymentStatus: customer.payment === 'pix_antecipado' ? 'Aguardando conferência' : 'Aguardando pagamento',
      deliveryStatus: 'Aguardando confirmação', proofFileId: draft.proofFileId || null,
      proofFileName: draft.proofFileName || '', status: 'pendente',
      createdAt: admin.firestore.FieldValue.serverTimestamp(), draftToken: String(req.params.token)
    }
    const result = await db.runTransaction(async tx => {
      const current = await tx.get(ref)
      if (!current.exists) throw new Error('Pedido salvo não encontrado.')
      if (current.data().status === 'finalizado') return { orderNumber: current.data().orderNumber, alreadyFinalized: true }
      const existingOrder = await tx.get(orderRef)
      if (!existingOrder.exists) tx.create(orderRef, order)
      tx.update(ref, { status: 'finalizado', orderNumber, updatedAt: admin.firestore.FieldValue.serverTimestamp() })
      return { orderNumber, alreadyFinalized: false }
    })
    if (!result.alreadyFinalized) await notifyAdminsOfNewPublicOrder(result.orderNumber)
    res.status(result.alreadyFinalized ? 200 : 201).json({ ok: true, orderNumber: result.orderNumber })
  } catch (error) {
    console.error('Finalização pedido público:', error)
    res.status(400).json({ error: error.message || 'Não foi possível finalizar o pedido.' })
  }
})


// Exportação usada pela função serverless da Vercel.
export default app

// Mantém o servidor HTTP local para npm run server / npm run dev:all.
if (process.env.VERCEL !== '1' && process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  app.listen(PORT, '127.0.0.1', () => console.log(`API local Doce Cacau em http://127.0.0.1:${PORT}`))
}
