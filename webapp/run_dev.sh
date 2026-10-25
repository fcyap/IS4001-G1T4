#!/usr/bin/env bash
# Starts the API (with reload) and the Vite dev server together. Ctrl+C stops both.
# Run from anywhere:  ./webapp/run_dev.sh   (macOS / Linux; on Windows use run_dev.ps1)
set -e
here="$(cd "$(dirname "$0")" && pwd)"
root="$(dirname "$here")"
web="$here/web"

[ -d "$web/node_modules" ] || (cd "$web" && npm install)

# Prefer the project virtual environment when there is one.
python="python3"
[ -x "$root/.venv/bin/python" ] && python="$root/.venv/bin/python"

(cd "$root" && "$python" -m uvicorn webapp.api.main:app --reload --port 8000) &
api=$!
trap 'kill $api 2>/dev/null' EXIT

echo "API on http://localhost:8000, app on http://localhost:5173"
cd "$web" && npx vite --port 5173 --open
