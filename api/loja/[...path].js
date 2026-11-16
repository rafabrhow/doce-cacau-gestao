// Encaminha todas as rotas /api/loja/* para a aplicação Express compartilhada.
import app from '../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const originalUrl = req.url || '/'
  const queryIndex = originalUrl.indexOf('?')
  const pathname = queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl
  const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : ''

  // Algumas configurações entregam à função somente o trecho após /api/loja.
  if (pathname !== '/api/loja' && !pathname.startsWith('/api/loja/')) {
    const suffix = pathname.startsWith('/') ? pathname : `/${pathname}`
    req.url = `/api/loja${suffix}${query}`
  }

  return app(req, res)
}
