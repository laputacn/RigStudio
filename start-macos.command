#!/bin/bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo 'Install Node.js 24 first, then run this file again.'
  read -r -p 'Press Enter to close...'
  exit 1
fi
if [ ! -d node_modules ]; then npm ci; fi
npm run build
npm start
