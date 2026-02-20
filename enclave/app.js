const http = require('http')
const https = require('https')
const { createHash } = require('crypto')

const PORT = process.env.PORT || 8080
const SOCK = '/var/run/dstack.sock'

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

async function getKey() {
  return dstackCall('/GetKey', { path: '/oracle', purpose: 'signing' })
}

async function handleFetch(reqBody) {
  const { url } = JSON.parse(reqBody)
  if (!url?.startsWith('https://')) throw new Error('url must start with https://')

  const { body, tlsFingerprint } = await fetchHttps(url)
  const timestamp = new Date().toISOString()
  const { key: publicKey, signature_chain } = await getKey()

  const hash = createHash('sha256')
    .update(url + body + (tlsFingerprint || '') + timestamp)
    .digest('hex')

  const quote = await dstackCall('/GetQuote', { report_data: hash })

  return { url, body, tlsFingerprint, timestamp, hash, publicKey, signatureChain: signature_chain, quote: quote.quote }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function readBody(req) {
  return new Promise(resolve => {
    let buf = ''
    req.on('data', c => buf += c)
    req.on('end', () => resolve(buf))
  })
}

const server = http.createServer(async (req, res) => {
  cors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end() }

  try {
    let result
    if (req.url === '/health') result = { ok: true }
    else if (req.url === '/key') result = await getKey()
    else if (req.url === '/fetch' && req.method === 'POST') result = await handleFetch(await readBody(req))
    else { res.writeHead(404); return res.end(JSON.stringify({ error: 'not found' })) }

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(result, null, 2))
  } catch (e) {
    res.writeHead(500)
    res.end(JSON.stringify({ error: e.message }))
  }
})

server.listen(PORT, () => console.log(`tls-oracle listening on :${PORT}`))
