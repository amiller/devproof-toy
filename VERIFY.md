# Verifying a Devproof App

This guide explains how to verify that a devproof deployment is running the code it claims to run, and that your data is actually encrypted.

## Quick Check

```bash
curl https://devproof-toy.vercel.app/api/verify
```

Returns:
```json
{
  "verified": true,
  "checks": [
    { "check": "tee_health", "ok": true },
    { "check": "compose_hash", "ok": true, "composeHash": "abc123...", "github": "https://github.com/amiller/devproof-toy/commit/abc123..." },
    { "check": "stats", "ok": true, "totalUsers": 12, "totalRecords": 34 }
  ]
}
```

## Step-by-Step Audit

### 1. Verify the running code

The `compose_hash` in the verify response is a hash of the Docker Compose file running inside the TEE. This links directly to a GitHub commit:

```bash
# Get the compose hash
HASH=$(curl -s https://devproof-toy.vercel.app/api/verify | jq -r '.checks[] | select(.check=="compose_hash") | .composeHash')

# View the commit on GitHub
open "https://github.com/amiller/devproof-toy/commit/$HASH"
```

At that commit, inspect:
- `enclave/app.js` — the actual TEE code handling your data
- `enclave/Dockerfile` — what's in the container
- `enclave/docker-compose.staging.yaml` — the pinned image digest

### 2. Verify the Docker image

The compose file pins the image by `sha256` digest. You can pull it and verify:

```bash
# The digest from docker-compose.staging.yaml
docker pull ghcr.io/amiller/devproof-toy@sha256:<digest-from-compose>

# Rebuild locally from the same commit and compare
git checkout $HASH
cd enclave && docker build -t local-verify .
# Compare the layers/contents
```

### 3. Check TDX attestation

The TEE runs on Phala Network with Intel TDX (Trust Domain Extensions). The `/report` endpoint returns a TDX quote:

```bash
curl https://<cvm-url>/report
```

This quote proves the code is running inside a genuine confidential VM. Phala provides tools to verify these quotes — see [Phala attestation docs](https://docs.phala.network/tech-specs/multi-proof-and-verifiable-compute/tee-attestation).

### 4. Inspect the database

If you have access to the Neon database, you can verify that only ciphertext is stored:

```sql
SELECT key, ciphertext FROM records LIMIT 5;
-- Keys are readable, but values are AES-256-GCM ciphertext blobs
-- e.g. {"iv":"a1b2...","data":"c3d4...","tag":"e5f6..."}
```

No plaintext values exist in the database. The encryption key lives only inside the TEE.

### 5. Verify the TLS oracle

The `/fetch` endpoint fetches HTTPS URLs through the TEE and returns:
- The response body
- TLS certificate fingerprint
- Timestamp
- SHA-256 hash of all the above
- TDX attestation quote over that hash

```bash
TOKEN=$(curl -s -c cookies.txt -X POST https://devproof-toy.vercel.app/api/session && \
        curl -s -b cookies.txt -X POST https://devproof-toy.vercel.app/api/token | jq -r .token)

curl -s https://<cvm-url>/fetch \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://api.coinbase.com/v2/prices/BTC-USD/spot"}'
```

The hash in the response can be recomputed from `url + body + tlsFingerprint + timestamp` to verify integrity. The TDX quote attests that hash was produced inside the TEE.

## Trust Model

| What you trust | What you verify |
|----------------|-----------------|
| Intel TDX hardware | TDX attestation quotes |
| Phala Network infrastructure | compose_hash → GitHub commit |
| GitHub (code hosting) | Read the source yourself |
| Neon (database) | Only ciphertext stored |
| Vercel (frontend/API) | Never sees plaintext values or encryption key |
