#!/bin/bash
set -e
cd "$(dirname "$0")"
PORT=8765
printf '\nOpening the Wolf equipment catalogue preview…\n'
python3 -m http.server "$PORT" >/tmp/wolf-catalogue-preview.log 2>&1 &
SERVER_PID=$!
sleep 1
open "http://localhost:$PORT/equipment/"
printf '\nPreview server is running. Keep this window open.\nPress Control-C to stop it.\n\n'
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
wait $SERVER_PID
