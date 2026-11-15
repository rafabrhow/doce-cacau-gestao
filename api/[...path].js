// Encaminha as rotas /api/* para o mesmo Express usado no ambiente local.
import app from '../server.js'

// O Multer precisa receber o fluxo original do upload multipart.
export const config = { api: { bodyParser: false } }

// Dependendo do roteamento do deployment, a Vercel pode entregar à função
// o caminho sem o prefixo /api. O Express da aplicação usa rotas /api/*.
// Normalizamos o caminho para que os dois formatos funcionem.
export default function handler(req, res) {
  const url = req.url || '/'
  const pathname = url.split('?')[0]

  if (pathname !== '/api' && !pathname.startsWith('/api/')) {
    req.url = `/api${url.startsWith('/') ? '' : '/'}${url}`
  }

  return app(req, res)
}
