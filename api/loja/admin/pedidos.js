// Rota explícita da Vercel para a listagem administrativa de pedidos.
import app from '../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const queryIndex = (req.url || '').indexOf('?')
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : ''
  req.url = `/api/loja/admin/pedidos${query}`
  return app(req, res)
}
