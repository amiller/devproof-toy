const { neon } = require('@neondatabase/serverless')

const sql = neon(process.env.DATABASE_URL)

let tablesReady = null
function init() {
  if (!tablesReady) tablesReady = sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW()
  )`
  return tablesReady
}

const parseCookie = (cookie, name) => {
  const m = cookie?.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`))
  return m ? m[1] : null
}

async function getUser(req) {
  await init()
  const userId = parseCookie(req.headers.cookie, 'session')
  if (!userId) return null
  const rows = await sql`SELECT id FROM users WHERE id = ${userId}`
  return rows[0]?.id || null
}

async function createUser(userId) {
  await init()
  await sql`INSERT INTO users (id) VALUES (${userId})`
}

module.exports = { getUser, createUser, parseCookie }
