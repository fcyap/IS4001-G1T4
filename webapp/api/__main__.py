"""python -m webapp.api [--port 8000]"""
import argparse
import socket
import sys

import uvicorn

parser = argparse.ArgumentParser(description="Building comfort and energy view: after-hours waste and cooling comfort (API + built app)")
parser.add_argument("--port", type=int, default=8000)
args = parser.parse_args()

with socket.socket() as s:
    if s.connect_ex(("127.0.0.1", args.port)) == 0:
        sys.exit(f"Port {args.port} is already in use (is the app already running in another terminal?). "
                 f"Stop that process, or pick another port: python -m webapp.api --port {args.port + 1}")

print(f"Building comfort and energy view (after-hours waste + cooling comfort): http://localhost:{args.port}")
uvicorn.run("webapp.api.main:app", host="127.0.0.1", port=args.port)
