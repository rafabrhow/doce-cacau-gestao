// Rotas específicas do Google Drive: /api/drive/*
// Usa a mesma aplicação Express do ambiente local.
import app from '../../server.js'

// O Multer precisa receber o fluxo original do upload multipart.
export const config = { api: { bodyParser: false } }

export default app
