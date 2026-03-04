#!/bin/bash
while IFS= read -r line; do
  if [[ "$line" == MD__* ]]; then
    key=$(echo "$line" | cut -d '=' -f 1)
    standardKey=${key#MD__}
    value=$(echo "$line" | cut -d '=' -f 2-)
    value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//')
    echo "Processing $standardKey..."
    npx vercel env rm "$standardKey" production -y 2>/dev/null || true
    printf "%s" "$value" | npx vercel env add "$standardKey" production
  fi
done < .env.development.local
