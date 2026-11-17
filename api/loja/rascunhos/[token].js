// Rota explícita da Vercel para consultar/atualizar um rascunho da Loja Virtual.
// Reutiliza os handlers e validações já existentes no server.js.
import app from '../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  if (!token) return res.status(400).json({ error: 'Identificador do pedido ausente.' })

  const rawUrl = req.url || ''
  const queryIndex = rawUrl.indexOf('?')
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : ''
  req.url = `/api/loja/rascunhos/${encodeURIComponent(String(token))}${query}`

  return app(req, res)
}
