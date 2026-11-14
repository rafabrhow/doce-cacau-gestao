// Encaminha as rotas /api/* para o mesmo Express usado no ambiente local.
import app from '../server.js'

// O Multer precisa receber o fluxo original do upload multipart.
export const config = { api: { bodyParser: false } }
export default app
