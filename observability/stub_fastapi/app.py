"""
Minimal HTTP + Prometheus for docker-compose. Replace with your real FastAPI;
keep /metrics and label conventions for shared Grafana boards.
"""
from __future__ import annotations

import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

HTTP_REQUESTS = Counter(
    "http_requests_total",
    "HTTP requests (stub fastapi process)",
    ["method", "handler", "status", "service"],
)
HTTP_DUR = Histogram(
    "http_request_duration_seconds",
    "Request duration (stub fastapi process)",
    ["method", "handler", "status", "service"],
    buckets=(0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5, 10, 30),
)
SERVICE = "fastapi-stub"
PORT = 8000


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_a, **_k):
        return

    def do_GET(self):
        path = (self.path or "/").split("?", 1)[0]
        t0 = time.perf_counter()
        short = (path or "/")[:64]
        if path in ("/", "/health", "/api/health"):
            body = ('{"status":"ok","service":"%s"}\n' % SERVICE).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            st = "200"
        elif path == "/metrics":
            out = generate_latest()
            self.send_response(200)
            self.send_header("Content-Type", CONTENT_TYPE_LATEST)
            self.end_headers()
            self.wfile.write(out)
            d = time.perf_counter() - t0
            HTTP_DUR.labels("GET", "metrics", "200", SERVICE).observe(d)
            HTTP_REQUESTS.labels("GET", "metrics", "200", SERVICE).inc()
            return
        else:
            body = b'{"detail":"not found"}\n'
            self.send_response(404)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.end_headers()
            self.wfile.write(body)
            st = "404"
        d = time.perf_counter() - t0
        HTTP_DUR.labels("GET", short, st, SERVICE).observe(d)
        HTTP_REQUESTS.labels("GET", short, st, SERVICE).inc()


if __name__ == "__main__":
    s = HTTPServer(("0.0.0.0", PORT), Handler)
    print("stub_fastapi on", PORT, flush=True)  # noqa: T20
    s.serve_forever()
