#!/bin/bash

# Windows dev startup helper
# Usage: bash scripts/dev.sh

set -e

echo "═══════════════════════════════════════════════════"
echo "Asset Detection - Dev Environment"
echo "═══════════════════════════════════════════════════"
echo ""

# Check .env.local exists
if [ ! -f .env.local ]; then
  echo "❌ .env.local not found!"
  echo "Run: cp .env.example .env.local"
  echo "Then configure DATABASE_URL, REDIS_URL, GEMINI_API_KEY"
  exit 1
fi

echo "✓ .env.local found"

# Check dependencies
if ! command -v node &> /dev/null; then
  echo "❌ Node.js not found"
  exit 1
fi

echo "✓ Node.js $(node -v)"

if ! command -v npm &> /dev/null; then
  echo "❌ npm not found"
  exit 1
fi

echo "✓ npm $(npm -v)"

# Install if needed
if [ ! -d node_modules ]; then
  echo ""
  echo "Installing dependencies..."
  npm install
fi

echo ""
echo "✓ Environment ready"
echo ""
echo "To start development:"
echo ""
echo "  Terminal 1 (Next.js dev server):"
echo "    npm run dev"
echo ""
echo "  Terminal 2 (Detection worker):"
echo "    bash scripts/start-worker.sh"
echo ""
echo "Then open: http://localhost:3000"
echo ""
