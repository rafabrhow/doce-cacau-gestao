export default function handler(req, res) {
  return res.status(200).json({
    url: req.url,
    originalUrl: req.originalUrl,
    query: req.query
  })
}