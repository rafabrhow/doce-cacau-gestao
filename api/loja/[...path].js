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

  // Usa o endpoint fixo /api/loja/rascunhos, que já é atendido no deployment.
  // O token e a ação seguem na query e são traduzidos para as rotas Express
  // existentes. Assim não dependemos do roteamento dinâmico da Vercel.
  const routedUrl = new URL(req.url || '/', 'http://localhost')
  if (routedUrl.pathname === '/api/loja/rascunhos') {
    const token = String(routedUrl.searchParams.get('token') || '').trim()
    const action = String(routedUrl.searchParams.get('action') || '').trim()

    // POST sem token continua sendo a criação original do rascunho.
    if (req.method === 'POST' && !token && !action) {
      return app(req, res)
    }

    if (!/^[a-f0-9-]{32,36}$/i.test(token)) {
      return res.status(400).json({ error: 'Identificador do pedido inválido ou ausente.' })
    }

    let targetPath = `/api/loja/rascunhos/${encodeURIComponent(token)}`

    if (req.method === 'POST') {
      if (!['comprovante', 'finalizar'].includes(action)) {
        return res.status(400).json({ error: 'Ação do pedido inválida.' })
      }
      targetPath += `/${action}`
    } else if (action) {
      return res.status(400).json({ error: 'Ação não permitida para este método.' })
    } else if (!['GET', 'PATCH'].includes(req.method || '')) {
      return res.status(405).json({ error: 'Método não permitido.' })
    }

    // Mantém o corpo intacto: JSON e multipart são processados no server.js.
    req.url = targetPath
  }

  return app(req, res)
}
