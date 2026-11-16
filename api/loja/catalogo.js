// Rota explícita da Vercel para o catálogo público.
import app from '../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  req.url = `/api/loja/catalogo${req.url?.includes('?') ? req.url.slice(req.url.indexOf('?')) : ''}`
  return app(req, res)
}
