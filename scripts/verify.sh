#!/bin/bash
# Verify attestation + compose hash from a deployed CVM
# Usage: ./verify.sh <app-id> [gateway]
set -e

APP_ID=${1:?Usage: ./verify.sh <app-id> [gateway]}
GATEWAY=${2:-dstack-pha-prod7.phala.network}
BASE_8090="https://${APP_ID}-8090.${GATEWAY}"
BASE_8080="https://${APP_ID}-8080.${GATEWAY}"

echo "=== TLS Oracle Attestation Verification ==="
echo "Metadata: $BASE_8090"
echo "API: $BASE_8080"
echo ""

echo "--- Compose Hash (from 8090) ---"
RAW=$(curl -sf "$BASE_8090/")
python3 -c "
import sys, json, hashlib, html, re
raw = sys.stdin.read()
decoded = html.unescape(raw)
m = re.search(r'\"compose_hash\":\s*\"([a-f0-9]+)\"', decoded)
if m: print(f'compose_hash: {m.group(1)}')
else: print('compose_hash: not found')
" <<< "$RAW"

echo ""
echo "--- Health ---"
curl -sf "$BASE_8080/health" | python3 -m json.tool 2>/dev/null || echo "(failed)"

echo ""
echo "--- Derived Key ---"
curl -sf "$BASE_8080/key" | python3 -m json.tool 2>/dev/null || echo "(failed)"

echo ""
echo "--- TLS Oracle Test ---"
curl -sf -X POST "$BASE_8080/fetch" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://api.coinbase.com/v2/prices/BTC-USD/spot"}' \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
print(f'URL: {d[\"url\"]}')
print(f'TLS Fingerprint: {d.get(\"tlsFingerprint\", \"(none)\")}')
print(f'Timestamp: {d[\"timestamp\"]}')
print(f'Hash: {d[\"hash\"]}')
print(f'Body (first 200): {d[\"body\"][:200]}')
print(f'Quote: {d[\"quote\"][:80]}...' if d.get('quote') else 'Quote: (none)')
print(f'Signature chain: {len(d.get(\"signatureChain\", []))} signatures')
" 2>/dev/null || echo "(failed)"

echo ""
echo "Done."
