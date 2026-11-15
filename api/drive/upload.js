// Rota explícita para upload de imagens no Google Drive.
// Evita depender do catch-all /api/drive/[...path] na Vercel.
import app from '../../server.js'

export const config = {
  api: { bodyParser: false }
}

export default function handler(req, res) {
  const originalUrl = req.url || '/'
  const queryIndex = originalUrl.indexOf('?')
  const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : ''
  const pathname = queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl

  // O Express registra a rota completa com o prefixo /api.
  if (pathname !== '/api/drive/upload') {
    req.url = `/api/drive/upload${query}`
  }

  return app(req, res)
}
