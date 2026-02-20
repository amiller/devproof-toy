# devproof-toy: TLS Oracle

A minimal TLS oracle running in a TEE (Phala/dstack). Fetches HTTPS URLs, captures TLS fingerprints, and returns attested responses with TDX quotes.

## Architecture

```
Vercel (frontend)                    CVM (Phala TEE)
─────────────────                    ────────────────
index.html                           API only, no HTML
  ├─ fetch form UI                   POST /fetch { url }
  ├─ @noble/curves (CDN)               ├─ https.get(url)
  └─ client-side verification           ├─ capture TLS fingerprint
                                        ├─ sign with derived key
                                        └─ return { body, quote, ... }
```

**Three layers:**
1. **TEE Core** — Oracle API. Minimal, auditable. Node builtins only.
2. **Client SDK** — `@noble/curves` in browser. Verifies signatures + attestation client-side.
3. **Vercel Frontend** — UX. Can iterate daily without touching the TEE.

## Quick Start (local)

```bash
phala simulator start
cd enclave && docker compose up --build
# In another terminal:
curl localhost:8080/health
curl -X POST localhost:8080/fetch -H 'Content-Type: application/json' -d '{"url":"https://api.coinbase.com/v2/prices/BTC-USD/spot"}'
```

## Deploy

1. Push to main → GitHub Actions builds enclave image → GHCR
2. Make GHCR package public
3. Update digest in `enclave/docker-compose.staging.yaml`
4. `phala deploy -n devproof-toy -c enclave/docker-compose.staging.yaml --dev-os --ssh-pubkey ~/.ssh/id_ed25519.pub`
5. Vercel auto-deploys frontend from `frontend/`

## Verify

```bash
./scripts/verify.sh <app-id> [gateway]
```

Or use the Vercel frontend — it verifies attestations client-side in the browser.
