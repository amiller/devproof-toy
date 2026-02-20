const crypto = require('crypto')

const JWT_SECRET = process.env.JWT_SECRET || 'devproof-demo-secret'

function b64url(data) {
  return Buffer.from(typeof data === 'string' ? data : JSON.stringify(data)).toString('base64url')
}

function signJwt(payload) {
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const body = b64url(payload)
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const token = signJwt({
    sub: 'demo-user-' + crypto.randomBytes(4).toString('hex'),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour
  })
  res.json({ token })
}
