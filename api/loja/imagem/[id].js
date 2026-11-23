// Rota explícita da Vercel para imagens públicas dos produtos.
import app from '../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const originalUrl = String(req.url || '')
  const queryIndex = originalUrl.indexOf('?')
  const pathname = queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl
  const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : ''

  // O parâmetro pode chegar em req.query.id ou somente no caminho, dependendo
  // da forma como a Vercel encaminha a função dinâmica.
  const queryId = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id
  const pathId = pathname.split('/').filter(Boolean).at(-1)
  const id = String(queryId || pathId || '').trim()

  if (!id) return res.status(400).json({ error: 'Identificador da imagem não informado.' })

  req.url = `/api/loja/imagem/${encodeURIComponent(id)}${query}`
  return app(req, res)
}
