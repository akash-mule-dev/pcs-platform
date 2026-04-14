#!/bin/bash
set -e

# Build with webpack using the 'vercel' project config (entry: serverless.ts)
npx nest build vercel

# Only keep native modules needed at runtime
cd node_modules
ls | grep -vE '^(bcrypt|pg|\.package-lock\.json)$' | xargs rm -rf 2>/dev/null || true
cd ..

echo "=== Build output ==="
ls -lh dist/main.js
echo "=== node_modules size ==="
du -sm node_modules 2>/dev/null || echo "none"
