#!/bin/bash
while IFS= read -r line; do
  # Skip empty lines and comments
  if [[ -z "$line" ]] || [[ "$line" == \#* ]]; then
    continue
  fi
  
  # Extract key and value (handling values with equal signs)
  key=$(echo "$line" | cut -d '=' -f 1)
  value=$(echo "$line" | cut -d '=' -f 2-)
  
  # Remove surrounding quotes from value if present
  value=$(echo "$value" | sed -e 's/^"//' -e 's/"$//')
  
  echo "Pushing $key..."
  printf "%s" "$value" | npx vercel env add "$key" production 2>/dev/null
done < .env.local
