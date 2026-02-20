const { neon } = require('@neondatabase/serverless')

const sql = neon(process.env.DATABASE_URL)

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW()
  )`
  await sql`CREATE TABLE IF NOT EXISTS records (
    user_id TEXT REFERENCES users(id),
    key TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY (user_id, key)
  )`
}

let tablesReady = null
function init() {
  if (!tablesReady) tablesReady = ensureTables()
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

async function insertRecord(userId, key, ciphertext) {
  await init()
  await sql`INSERT INTO records (user_id, key, ciphertext) VALUES (${userId}, ${key}, ${ciphertext})
    ON CONFLICT (user_id, key) DO UPDATE SET ciphertext = ${ciphertext}`
}

async function getRecord(userId, key) {
  await init()
  const rows = await sql`SELECT ciphertext FROM records WHERE user_id = ${userId} AND key = ${key}`
  return rows[0]?.ciphertext || null
}

async function listRecords(userId) {
  await init()
  return sql`SELECT key, ciphertext FROM records WHERE user_id = ${userId} ORDER BY created_at`
}

module.exports = { getUser, createUser, insertRecord, getRecord, listRecords, parseCookie }
