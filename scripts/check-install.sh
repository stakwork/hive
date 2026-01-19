#!/bin/bash

# Configuration
APP_ID="1920013"
PRIVATE_KEY_PATH="scripts/hive-chat-pm.2026-01-19.private-key.pem"
INSTALL_ID="91407505"

# 1. Generate JWT (JSON Web Token)
header=$(echo -n '{"alg":"RS256","typ":"JWT"}' | openssl base64 -e -A | tr -d '=' | tr '/+' '_-')
now=$(date +%s)
iat=$(($now - 60)) # Issued at (1 min ago to account for clock drift)
exp=$(($now + 600)) # Expires in 10 mins
payload=$(echo -n "{\"iat\":$iat,\"exp\":$exp,\"iss\":\"$APP_ID\"}" | openssl base64 -e -A | tr -d '=' | tr '/+' '_-')
signature=$(echo -n "$header.$payload" | openssl dgst -sha256 -sign "$PRIVATE_KEY_PATH" | openssl base64 -e -A | tr -d '=' | tr '/+' '_-')
JWT="$header.$payload.$signature"

# 2. Get Installation Access Token
INSTALL_TOKEN=$(curl -s -X POST \
  -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations/$INSTALL_ID/access_tokens" | jq -r '.token')

if [ "$INSTALL_TOKEN" == "null" ]; then
    echo "Error: Could not retrieve installation token. Check your App ID and Private Key."
    exit 1
fi

# 3. Get Installation Info (includes created_at)
echo "Installation #$INSTALL_ID info:"
curl -s -H "Authorization: Bearer $JWT" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/app/installations/$INSTALL_ID" | jq '{created_at, updated_at, account: .account.login}'

# 4. List Repositories with timestamps
echo ""
echo "Authorized repositories:"
curl -s -H "Authorization: Bearer $INSTALL_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/installation/repositories" | jq -r '.repositories[] | "\(.full_name) (created: \(.created_at))"'
