const crypto = require('crypto')
const { getUser, createUser, parseCookie } = require('./_db')

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Credentials', 'true')
  if (req.method === 'OPTIONS') return res.status(204).end()

  if (req.method === 'POST') {
    const userId = 'user-' + crypto.randomBytes(8).toString('hex')
    await createUser(userId)
    res.setHeader('Set-Cookie', `session=${userId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${7 * 86400}`)
    return res.json({ userId })
  }

  // GET — check existing session
  const userId = await getUser(req)
  if (!userId) return res.status(401).json({ error: 'no session' })
  res.json({ userId })
}
