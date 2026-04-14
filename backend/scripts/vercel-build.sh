#!/bin/bash
# Build NestJS, then prune heavy packages for Vercel's 250MB function limit
npm run build
npm prune --omit=dev
rm -rf node_modules/opencascade.js \
       node_modules/web-ifc \
       node_modules/mikktspace \
       node_modules/three \
       node_modules/@types \
       node_modules/@gltf-transform \
       node_modules/@img \
       node_modules/swagger-ui-dist \
       node_modules/@azure \
       node_modules/typescript \
       node_modules/@aws-sdk \
       node_modules/@smithy \
       node_modules/@typespec \
       node_modules/libphonenumber-js

echo "=== Post-prune node_modules size ==="
du -sm node_modules || true
