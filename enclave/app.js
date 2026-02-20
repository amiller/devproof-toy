const http = require('http')
const https = require('https')
const crypto = require('crypto')
const fs = require('fs')

const PORT = process.env.PORT || 8080
const SOCK = '/var/run/dstack.sock'
const STORE_PATH = '/data/store.enc'
const JWT_SECRET = process.env.JWT_SECRET || 'devproof-demo-secret'

// --- dstack helpers ---
function dstackCall(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body)
    const req = http.request({ socketPath: SOCK, path, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, res => {
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve(JSON.parse(buf)))
    })
    req.on('error', reject)
    req.end(data)
  })
}

async function getKey() {
  return dstackCall('/GetKey', { path: '/oracle', purpose: 'signing' })
}

// --- AES-256-GCM helpers ---
function encrypt(plaintext, key) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return JSON.stringify({ iv: iv.toString('hex'), data: enc.toString('hex'), tag: cipher.getAuthTag().toString('hex') })
}

function decrypt(blob, key) {
  const { iv, data, tag } = JSON.parse(blob)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'))
  decipher.setAuthTag(Buffer.from(tag, 'hex'))
  return decipher.update(Buffer.from(data, 'hex'), null, 'utf8') + decipher.final('utf8')
}

// --- KV store (encrypted at rest) ---
let kvStore = {}
let aesKey = null

async function initStore() {
  const { key } = await getKey()
  aesKey = Buffer.from(key.slice(0, 64), 'hex') // 32 bytes
  if (fs.existsSync(STORE_PATH)) {
    kvStore = JSON.parse(decrypt(fs.readFileSync(STORE_PATH, 'utf8'), aesKey))
    console.log(`Loaded ${Object.keys(kvStore).length} keys from encrypted store`)
  }
}

function saveStore() {
  fs.writeFileSync(STORE_PATH, encrypt(JSON.stringify(kvStore), aesKey))
}

// --- Stats (per-run, in-memory) ---
const stats = { fetchRequests: 0, storeWrites: 0, storeReads: 0, startTime: new Date().toISOString(), lastRequest: null }

function tick() { stats.lastRequest = new Date().toISOString() }

// --- HTTPS fetch ---
function fetchHttps(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const fingerprint = res.socket.getPeerCertificate()?.fingerprint256 || null
      let buf = ''
      res.on('data', c => buf += c)
      res.on('end', () => resolve({ body: buf, tlsFingerprint: fingerprint }))
    }).on('error', reject)
  })
}

async function handleFetch(reqBody) {
  const { url } = JSON.parse(reqBody)
  if (!url?.startsWith('https://')) throw new Error('url must start with https://')
  stats.fetchRequests++; tick()

  const { body, tlsFingerprint } = await fetchHttps(url)
  const timestamp = new Date().toISOString()
  const { key: publicKey, signature_chain } = await getKey()
  const hash = crypto.createHash('sha256').update(url + body + (tlsFingerprint || '') + timestamp).digest('hex')
  const quote = await dstackCall('/GetQuote', { report_data: hash })
  return { url, body, tlsFingerprint, timestamp, hash, publicKey, signatureChain: signature_chain, quote: quote.quote }
}

// --- Report ---
async function generateReport() {
  const s = { ...stats, kvEntries: Object.keys(kvStore).length, uptime: Math.floor((Date.now() - new Date(stats.startTime).getTime()) / 1000) + 's' }
  const hash = crypto.createHash('sha256').update(JSON.stringify(s)).digest('hex')
  const { key: publicKey, signature_chain } = await getKey()
  const quote = await dstackCall('/GetQuote', { report_data: hash })
  return { type: 'tee-exit-report', generated: new Date().toISOString(), stats: s, hash, publicKey, signatureChain: signature_chain, quote: quote.quote }
}

// --- JWT validation (HMAC-SHA256, no deps) ---
function b64url(s) { return Buffer.from(s).toString('base64url') }
function verifyJwt(token) {
  const [header, payload, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url')
  if (sig !== expected) throw new Error('invalid token')
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString())
  if (data.exp && data.exp < Date.now() / 1000) throw new Error('token expired')
  return data
}

function requireAuth(req) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) throw new Error('missing token')
  return verifyJwt(auth.slice(7))
}

// --- HTTP server ---
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readBody(req) {
  return new Promise(resolve => { let buf = ''; req.on('data', c => buf += c); req.on('end', () => resolve(buf)) })
}

const server = http.createServer(async (req, res) => {
  cors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  try {
    let result

    if (req.url === '/health') result = { ok: true }
    else if (req.url === '/key') result = await getKey()
    else if (req.url === '/fetch' && req.method === 'POST') { requireAuth(req); result = await handleFetch(await readBody(req)) }
    else if (req.url === '/report') result = await generateReport()
    else if (req.url === '/store' && req.method === 'POST') {
      requireAuth(req)
      const { key, value } = JSON.parse(await readBody(req))
      if (!key) throw new Error('key required')
      kvStore[key] = value; saveStore()
      stats.storeWrites++; tick()
      result = { ok: true, key }
    }
    else if (req.url === '/store' && req.method === 'GET') {
      requireAuth(req)
      stats.storeReads++; tick()
      result = { keys: Object.keys(kvStore), count: Object.keys(kvStore).length }
    }
    else if (req.url.startsWith('/store/') && req.method === 'GET') {
      requireAuth(req)
      const key = decodeURIComponent(req.url.slice(7))
      stats.storeReads++; tick()
      if (!(key in kvStore)) { res.writeHead(404); return res.end(JSON.stringify({ error: 'key not found' })) }
      result = { key, value: kvStore[key] }
    }
    else if (req.url === '/metadata') {
      const meta = await new Promise((resolve, reject) => {
        http.get('http://172.17.0.1:8090/', r => { let buf = ''; r.on('data', c => buf += c); r.on('end', () => resolve(buf)) }).on('error', reject)
      })
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end(meta)
    }
    else { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })) }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result, null, 2))
  } catch (e) {
    res.writeHead(500)
    res.end(JSON.stringify({ error: e.message }))
  }
})

initStore()
  .then(() => server.listen(PORT, () => console.log(`tls-oracle listening on :${PORT}`)))
  .catch(e => { console.log('Store init failed (maybe no dstack socket yet), starting without persistence:', e.message); server.listen(PORT, () => console.log(`tls-oracle listening on :${PORT} (no persistence)`)) })
