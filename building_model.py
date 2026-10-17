#!/usr/bin/env python3
"""Serve the Chamchuri 5 building energy model."""

from __future__ import annotations

import csv
import json
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "qn1_circuit_waste_and_classification.csv"
HTML_FILE = ROOT / "building_model.html"
CSS_FILE = ROOT / "building_model.css"
JS_FILE = ROOT / "building_model.js"


def load_data() -> list[dict[str, object]]:
    with DATA_FILE.open(newline="", encoding="utf-8-sig") as source:
        rows = list(csv.DictReader(source))

    numeric_columns = {
        "Baseload_kW",
        "Unocc_to_Occ_Ratio",
        "OffHours_CV",
        "Unocc_Mean_kW",
        "Surplus_kWh_18M",
        "Annual_Surplus_kWh",
        "Annual_Avoided_Cost_THB",
    }
    for row in rows:
        for column in numeric_columns:
            row[column] = float(row[column] or 0)
    return rows


def json_for_html(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        path = urlsplit(self.path).path
        if path in ("/", "/index.html"):
            html = HTML_FILE.read_text(encoding="utf-8")
            body = html.replace("__DATA__", json_for_html(load_data())).encode("utf-8")
            content_type = "text/html; charset=utf-8"
        elif path == "/building_model.css":
            body = CSS_FILE.read_bytes()
            content_type = "text/css; charset=utf-8"
        elif path == "/building_model.js":
            body = JS_FILE.read_bytes()
            content_type = "text/javascript; charset=utf-8"
        else:
            self.send_error(404)
            return

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {fmt % args}")


def serve() -> None:
    address = ("127.0.0.1", 8001)
    HTTPServer(address, Handler).serve_forever()


def run_with_auto_restart() -> None:
    script = Path(__file__).resolve()
    last_modified = script.stat().st_mtime_ns
    address = "http://127.0.0.1:8001"
    print(f"Building energy model ready at {address} (Ctrl+C to stop)", flush=True)

    while True:
        server = subprocess.Popen([sys.executable, str(script), "--serve"])
        try:
            while server.poll() is None:
                time.sleep(0.4)
                modified = script.stat().st_mtime_ns
                if modified == last_modified:
                    continue

                # Wait for the editor to finish writing the file before restarting.
                time.sleep(0.3)
                stable_modified = script.stat().st_mtime_ns
                if stable_modified != modified:
                    continue

                print("building_model.py changed; restarting server...", flush=True)
                server.terminate()
                server.wait()
                last_modified = stable_modified
                break
            else:
                print("Building model server stopped.", flush=True)
                return
        except KeyboardInterrupt:
            server.terminate()
            server.wait()
            print("Building model server stopped.", flush=True)
            return


if __name__ == "__main__":
    if sys.argv[1:] == ["--serve"]:
        serve()
    else:
        run_with_auto_restart()
