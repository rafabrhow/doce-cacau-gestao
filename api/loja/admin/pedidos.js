// Rota fixa da Vercel para as operações administrativas dos pedidos da Loja Virtual.
// Mantém autenticação, leitura do comprovante e regras de aprovação/recusa no server.js.
import app from '../../../server.js'

export const config = { api: { bodyParser: false } }

export default function handler(req, res) {
  const url = new URL(req.url || '/api/loja/admin/pedidos', 'http://localhost')
  const token = String(url.searchParams.get('token') || '').trim()
  const action = String(url.searchParams.get('action') || '').trim()

  // Leitura do comprovante: GET /api/loja/admin/pedidos?token=...&action=comprovante
  if (req.method === 'GET' && action === 'comprovante') {
    if (!token) return res.status(400).json({ error: 'Identificador do pedido ausente.' })
    req.url = `/api/loja/admin/comprovante/${encodeURIComponent(token)}`
    return app(req, res)
  }

  // Aprovar/recusar: PATCH /api/loja/admin/pedidos?token=...
  if (req.method === 'PATCH') {
    if (!token) return res.status(400).json({ error: 'Identificador do pedido ausente.' })
    req.url = `/api/loja/admin/pedidos/${encodeURIComponent(token)}`
    return app(req, res)
  }

  // Listagem original: GET /api/loja/admin/pedidos
  if (req.method === 'GET' && !action && !token) {
    req.url = '/api/loja/admin/pedidos'
    return app(req, res)
  }

  return res.status(405).json({ error: 'Método ou operação não permitida.' })
}
