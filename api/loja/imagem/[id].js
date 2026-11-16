// Rota explícita da Vercel para imagens públicas dos produtos.
import app from '../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const id = encodeURIComponent(String(req.query?.id || ''))
  const queryIndex = (req.url || '').indexOf('?')
  const query = queryIndex >= 0 ? req.url.slice(queryIndex) : ''
  req.url = `/api/loja/imagem/${id}${query}`
  return app(req, res)
}
