export default function handler(req, res) {
  return res.status(200).json({
    ok: true,
    message: 'API Doce Cacau funcionando',
    environment: process.env.VERCEL ? 'vercel' : 'local'
  })
}