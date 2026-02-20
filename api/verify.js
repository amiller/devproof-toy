const crypto = require('crypto')

const CVM_URL = process.env.CVM_URL || 'https://fffd093b00ce84a2708706ce61510913d7333dcf-8080.dstack-pha-prod7.phala.network'

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(204).end()

  const checks = []

  // Health
  try {
    const r = await fetch(`${CVM_URL}/health`)
    const d = await r.json()
    checks.push({ check: 'tee_health', ok: d.ok === true })
  } catch (e) { checks.push({ check: 'tee_health', ok: false, error: e.message }) }

  // Metadata + compose hash
  try {
    const r = await fetch(`${CVM_URL}/metadata`)
    const html = (await r.text()).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    const m = html.match(/"compose_hash":\s*"([a-f0-9]+)"/)
    if (m) {
      checks.push({ check: 'compose_hash', ok: true, composeHash: m[1], github: `https://github.com/amiller/devproof-toy/commit/${m[1]}` })
    } else {
      checks.push({ check: 'compose_hash', ok: false, error: 'not found in metadata' })
    }
  } catch (e) { checks.push({ check: 'compose_hash', ok: false, error: e.message }) }

  // Stats
  try {
    const r = await fetch(`${CVM_URL}/stats`)
    checks.push({ check: 'stats', ok: true, ...(await r.json()) })
  } catch (e) { checks.push({ check: 'stats', ok: false, error: e.message }) }

  const allOk = checks.every(c => c.ok)
  res.json({ verified: allOk, checks })
}
