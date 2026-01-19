#!/bin/bash

# Configuration
APP_ID="1920013"
PRIVATE_KEY_PATH="scripts/hive-chat-pm.2026-01-19.private-key.pem"

# 1. Generate JWT (JSON Web Token)
header=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e -A | tr -d '=' | tr '/+' '_-')
now=$(date +%s)
iat=$(($now - 60)) # Issued at (1 min ago to account for clock drift)
exp=$(($now + 600)) # Expires in 10 mins
payload=$(echo -n "{\"iat\":$iat,\"exp\":$exp,\"iss\":\"$APP_ID\"}" | openssl base64 -e -A | tr -d '=' | tr '/+' '_-')
signature=$(echo -n "$header.$payload" | openssl dgst -sha256 -sign "$PRIVATE_KEY_PATH" | openssl base64 -e -A | tr -d '=' | tr '/+' '_-')
JWT="$header.$payload.$signature"

# 2. List all installations
echo "Listing all installations for GitHub App #$APP_ID:"
echo ""
curl -s -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations" | jq '.[] | {id, account: .account.login, type: .account.type, created_at}'
