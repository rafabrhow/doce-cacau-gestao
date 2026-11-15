// Rota explícita para recuperar imagens do Google Drive.
// Evita depender do catch-all /api/drive/[...path] para URLs com ID dinâmico.
import app from '../../../server.js'

export const config = {
  api: { bodyParser: false }
}

export default function handler(req, res) {
  // A Vercel entrega a URL completa para funções API.
  // Mantemos o caminho /api/drive/image/:id esperado pelo Express.
  const originalUrl = req.url || ''
  if (!originalUrl.startsWith('/api/drive/image/')) {
    const queryIndex = originalUrl.indexOf('?')
    const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : ''
    const pathname = queryIndex >= 0 ? originalUrl.slice(0, queryIndex) : originalUrl
    const id = pathname.split('/').filter(Boolean).at(-1) || ''
    req.url = `/api/drive/image/${encodeURIComponent(id)}${query}`
  }

  return app(req, res)
}
