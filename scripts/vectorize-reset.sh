#!/bin/bash

# Prompt for Cloudflare API token if not already set
if [ -z "$CLOUDFLARE_API_TOKEN" ]; then
  read -sp "Enter your Cloudflare API Token: " CLOUDFLARE_API_TOKEN
  echo
  export CLOUDFLARE_API_TOKEN
fi

echo | bunx wrangler vectorize delete material-similarity-matcher

echo | bunx wrangler vectorize create material-similarity-matcher \
  --dimensions=768 \
  --metric=cosine
