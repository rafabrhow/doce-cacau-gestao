// Rotas explícitas da Vercel para ações de um rascunho:
// POST /:token/comprovante e POST /:token/finalizar.
// A lógica de negócio permanece centralizada no server.js.
import app from '../../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const token = Array.isArray(req.query.token) ? req.query.token[0] : req.query.token
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action
  if (!token || !action) return res.status(400).json({ error: 'Rota do pedido incompleta.' })

  const rawUrl = req.url || ''
  const queryIndex = rawUrl.indexOf('?')
  const query = queryIndex >= 0 ? rawUrl.slice(queryIndex) : ''
  req.url = `/api/loja/rascunhos/${encodeURIComponent(String(token))}/${encodeURIComponent(String(action))}${query}`

  return app(req, res)
}
