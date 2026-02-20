# Devproof Starter Kit

An encrypted key-value store running in a TEE (Trusted Execution Environment). Values are AES-256-GCM encrypted inside the enclave and stored as ciphertext in Postgres. The encryption key never leaves the TEE. The running code is attestable and linked to this open-source repo.

**[Live demo](https://devproof-toy.vercel.app)** · **[API docs](https://devproof-toy.vercel.app/docs)** · **[Verification guide](VERIFY.md)**

## Architecture

```
Browser → Vercel (cookie sessions) → TEE (encrypt/decrypt) → Neon Postgres (ciphertext only)
```

| Layer | Sees |
|-------|------|
| Browser | keys, plaintext values |
| Vercel | keys, ciphertext, session cookies |
| TEE | keys, plaintext values, encryption key |
| Neon DB | keys, ciphertext |

The TEE holds an AES-256-GCM key derived from hardware (`/GetKey`). When you store a value, the TEE encrypts it with AAD binding to `userId:key`, then writes ciphertext to Postgres. Neither Vercel nor Neon ever see plaintext values.

## Fork & Deploy

### Prerequisites

- GitHub account (for CI + GHCR)
- [Vercel](https://vercel.com) account
- [Neon](https://neon.tech) Postgres database
- [Phala Cloud](https://cloud.phala.network) account + `phala` CLI (`npm i -g @aspect-build/phala`)

### Steps

**1. Fork this repo** and clone it locally.

**2. Create a Neon database.** Copy the `DATABASE_URL` connection string.

**3. Set up Vercel.**
```bash
npx vercel link  # link to your fork
npx vercel env add DATABASE_URL  # paste your Neon URL (production + preview)
npx vercel env add JWT_SECRET    # any random string, e.g. openssl rand -hex 32
```

**4. Make your GHCR package public.** After the first CI build, go to GitHub → Settings → Packages → your image → Change visibility to Public. (Phala needs to pull it.)

**5. Push to main.** GitHub Actions builds the enclave image → `ghcr.io/<you>/devproof-toy:latest`.

**6. Get the image digest and update the compose file.**
```bash
docker pull ghcr.io/<you>/devproof-toy:latest
docker inspect --format='{{index .RepoDigests 0}}' ghcr.io/<you>/devproof-toy:latest
# Copy the sha256:... digest into enclave/docker-compose.staging.yaml
```

**7. Deploy to Phala Cloud.**
```bash
phala deploy -n my-devproof \
  -c enclave/docker-compose.staging.yaml \
  -e "DATABASE_URL=<your-neon-url>" \
  --dev-os
```
Note the CVM URL from the output (e.g. `https://<id>-8080.dstack-pha-prod7.phala.network`).

**8. Update CVM_URL** in these files with your CVM URL:
- `frontend/index.html` (the hidden input)
- `api/verify.js` (the `CVM_URL` constant)

**9. Deploy Vercel.**
```bash
npx vercel --prod --yes
```

### Local Development

```bash
phala simulator start
cd enclave && docker compose up --build
# TEE runs at localhost:8080
curl localhost:8080/health
```

## Customizing

The enclave is `enclave/app.js` (~250 lines). Add your own endpoints there — anything that needs to handle sensitive data, encrypt/decrypt, or produce attestations.

The API layer is `api/*.js` (Vercel serverless functions). These handle sessions and proxy to the TEE. Add new proxy endpoints here.

The frontend is `frontend/index.html` (vanilla JS, no build step). Swap it for React, Svelte, whatever — the API doesn't care.

## File Structure

```
enclave/
  app.js                    # TEE server (KV store, TLS oracle, attestation)
  Dockerfile                # Minimal Node.js image
  docker-compose.yaml       # Local dev (with simulator)
  docker-compose.staging.yaml  # Production (pinned digest)
api/
  session.js                # Cookie sessions (anonymous, auto-created)
  records.js                # KV store proxy (Vercel → TEE)
  token.js                  # JWT for TEE gateway auth
  verify.js                 # TEE health + attestation check
  _db.js                    # Neon client (users table)
frontend/
  index.html                # Main app (one-click demos)
  docs/index.html           # API reference
.github/workflows/
  build.yml                 # CI: build enclave image → GHCR
```

## How Verification Works

See [VERIFY.md](VERIFY.md) for the full audit guide. The short version:

1. `/api/verify` checks TEE health and returns the `compose_hash`
2. `compose_hash` links to a GitHub commit — you can inspect exactly what code is running
3. The Docker image is pinned by digest, so the compose hash proves the code matches the repo
4. TDX attestation (Intel Trust Domain Extensions) proves the code runs in a genuine TEE
