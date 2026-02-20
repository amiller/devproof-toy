const { getUser, insertRecord, getRecord, listRecords } = require('./_db')

const CVM_URL = process.env.CVM_URL || 'https://fffd093b00ce84a2708706ce61510913d7333dcf-8080.dstack-pha-prod7.phala.network'
const JWT_SECRET = process.env.JWT_SECRET || 'devproof-demo-secret'

// Mint a JWT for TEE calls (same logic as api/token.js)
const crypto = require('crypto')
function mintJwt() {
  const b64url = s => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)).toString('base64url')
  const header = b64url({ alg: 'HS256', typ: 'JWT' })
  const payload = b64url({ sub: 'vercel-proxy', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 })
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  return `${header}.${payload}.${sig}`
}

async function teeCall(path, body) {
  const res = await fetch(`${CVM_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${mintJwt()}` },
    body: JSON.stringify(body)
  })
  return res.json()
}

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
    const data = await teeCall('/encrypt', { userId, key, value: String(value) })
    if (data.error) return res.status(500).json(data)
    await insertRecord(userId, key, data.ciphertext)
    return res.json({ ok: true, key })
  }

  // GET
  const key = req.query.key
  if (key) {
    const ciphertext = await getRecord(userId, key)
    if (!ciphertext) return res.status(404).json({ error: 'not found' })
    const data = await teeCall('/decrypt', { ciphertext })
    if (data.error) return res.status(500).json(data)
    return res.json({ key, value: data.value })
  }

  // List all
  const rows = await listRecords(userId)
  res.json({ records: rows })
}
