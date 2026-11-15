// Rotas específicas do Google Drive: /api/drive/*
// Usa a mesma aplicação Express do ambiente local.
import app from '../../../server.js'

export const config = { api: { bodyParser: false } }
export default app
