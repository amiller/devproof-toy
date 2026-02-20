const crypto = require('crypto')
const { getUser } = require('./_db')

const CVM_URL = process.env.CVM_URL || 'https://fffd093b00ce84a2708706ce61510913d7333dcf-8080.dstack-pha-prod7.phala.network'
const JWT_SECRET = process.env.JWT_SECRET || 'devproof-demo-secret'

function mintJwt() {
  const b64url = s => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)).toString('base64url')
  const h = b64url({ alg: 'HS256', typ: 'JWT' })
  const p = b64url({ sub: 'vercel-proxy', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${p}`).digest('base64url')
  return `${h}.${p}.${sig}`
}

const teeHeaders = () => ({ 'Content-Type': 'application/json', 'Authorization': `Bearer ${mintJwt()}` })

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const userId = await getUser(req)
  if (!userId) return res.status(401).json({ error: 'no session' })

  if (req.method === 'POST') {
    const { key, value } = req.body
    if (!key || value === undefined) return res.status(400).json({ error: 'key and value required' })
    const r = await fetch(`${CVM_URL}/records`, { method: 'POST', headers: teeHeaders(), body: JSON.stringify({ userId, key, value: String(value) }) })
    return res.status(r.status).json(await r.json())
  }

  // GET — proxy to TEE
  const key = req.query.key
  const url = key
    ? `${CVM_URL}/records?userId=${encodeURIComponent(userId)}&key=${encodeURIComponent(key)}`
    : `${CVM_URL}/records?userId=${encodeURIComponent(userId)}`
  const r = await fetch(url, { headers: teeHeaders() })
  res.status(r.status).json(await r.json())
}
