#!/bin/bash
set -e
cd "$(dirname "$0")"
clear
printf '\nWOLF EQUIPMENT CATALOGUE UPDATE\n'
printf '================================\n\n'
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20 or newer, then run this file again."
  echo ""
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi
if [ ! -f "private-import/current-products.csv" ]; then
  echo "No Current RMS export was found."
  echo "Save it as: private-import/current-products.csv"
  echo ""
  read -n 1 -s -r -p "Press any key to close…"
  exit 1
fi
if [ ! -d "node_modules" ]; then
  echo "Installing image optimisation support…"
  npm install --no-audit --no-fund
fi
echo "Building pages and importing fresh product images…"
npm run import
printf '\nUpdate complete. Review reports/catalogue-report.csv before publishing.\n\n'
read -n 1 -s -r -p "Press any key to close…"
