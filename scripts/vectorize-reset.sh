#!/bin/bash

# Prompt for Cloudflare API token if not already set
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  read -sp "Enter your Cloudflare API Token: " CLOUDFLARE_API_TOKEN
  echo
  export CLOUDFLARE_API_TOKEN
fi

echo "Deleting existing vectorize indexes..."
echo | bunx wrangler vectorize delete material-matcher-name
echo | bunx wrangler vectorize delete material-matcher-desc
echo | bunx wrangler vectorize delete material-matcher-ebkp

echo "Creating vectorize indexes..."
echo | bunx wrangler vectorize create material-matcher-name --dimensions=768 --metric=cosine
echo | bunx wrangler vectorize create material-matcher-desc --dimensions=768 --metric=cosine
echo | bunx wrangler vectorize create material-matcher-ebkp --dimensions=768 --metric=cosine

echo "Done! Now redeploy and re-add your materials."
