// Rota explícita da Vercel para consultar pedidos pendentes.
// Reutiliza a autenticação e a lógica já implementadas em server.js.
import app from '../../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const queryIndex = (req.url || '').indexOf('?')
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : ''
  req.url = `/api/loja/admin/pedidos/contagem${query}`
  return app(req, res)
}
