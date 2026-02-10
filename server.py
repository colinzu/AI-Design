#!/usr/bin/env python3
"""
Local dev server with API proxy for AI-Design.
Serves static files and proxies /api/generate to Google Gemini API.

Features:
- Threaded: handles concurrent requests (4 parallel image generations)
- Robust: survives client disconnects (BrokenPipeError, etc.)
- Matches production API: /api/generate (same as Cloudflare Worker)
"""

import http.server
import json
import urllib.request
import urllib.error
import os
import sys
import signal

PORT = 8080
GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

# API key for local development only.
# In production, this is stored as a Cloudflare secret.
GEMINI_API_KEY = 'AIzaSyDwsn-H9GkEeAW1w3TUl-rJX_K_daTTkKQ'

# Allowed models (same whitelist as the Cloudflare Worker)
ALLOWED_MODELS = ['gemini-3-pro-image-preview']


class RobustThreadingHTTPServer(http.server.ThreadingHTTPServer):
    """Threaded HTTP server that gracefully handles client disconnects."""
    daemon_threads = True

    def handle_error(self, request, client_address):
        """Suppress noisy tracebacks for common client disconnect errors."""
        exc_type = sys.exc_info()[0]
        if exc_type in (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            sys.stderr.write(f'[INFO] Client {client_address} disconnected\n')
        else:
            super().handle_error(request, client_address)


class ProxyHandler(http.server.SimpleHTTPRequestHandler):
    timeout = 30  # Close idle connections after 30s to free threads

    def do_POST(self):
        if self.path == '/api/generate':
            self._proxy_generate()
        elif self.path.startswith('/api/gemini/'):
            self._proxy_gemini_legacy()
        else:
            self.send_error(404, 'Not Found')

    def do_OPTIONS(self):
        if self.path.startswith('/api/'):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Max-Age', '86400')
            self.end_headers()
        else:
            self.send_error(404, 'Not Found')

    def _proxy_generate(self):
        """
        POST /api/generate — matches the Cloudflare Worker API.
        Reads 'model' from request body, injects API key, forwards to Gemini.
        """
        self.close_connection = True

        content_length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b''

        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            error = json.dumps({'error': {'message': 'Invalid JSON body'}}).encode()
            self._send_proxy_response(400, error, 'application/json')
            return

        # Validate required fields
        if 'contents' not in body or 'generationConfig' not in body:
            error = json.dumps({'error': {'message': 'Missing required fields'}}).encode()
            self._send_proxy_response(400, error, 'application/json')
            return

        # Extract and validate model
        model = body.pop('model', 'gemini-3-pro-image-preview')
        if model not in ALLOWED_MODELS:
            error = json.dumps({'error': {'message': f'Model not allowed: {model}'}}).encode()
            self._send_proxy_response(400, error, 'application/json')
            return

        # Build Gemini API URL
        target_url = f'{GEMINI_BASE}/models/{model}:generateContent?key={GEMINI_API_KEY}'
        forward_body = json.dumps(body).encode()

        self._forward_to_gemini(target_url, forward_body)

    def _proxy_gemini_legacy(self):
        """Legacy: /api/gemini/* direct proxy (kept for backward compatibility)."""
        self.close_connection = True
        remote_path = self.path[len('/api/gemini'):]
        target_url = 'https://generativelanguage.googleapis.com' + remote_path

        content_length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(content_length) if content_length > 0 else b''

        self._forward_to_gemini(target_url, body)

    def _forward_to_gemini(self, target_url, body):
        """Forward a request to Gemini API and return the response."""
        headers = {'Content-Type': 'application/json'}

        try:
            req = urllib.request.Request(target_url, data=body, headers=headers, method='POST')

            with urllib.request.urlopen(req, timeout=120) as resp:
                resp_body = resp.read()
                self._send_proxy_response(
                    resp.status, resp_body,
                    resp.headers.get('Content-Type', 'application/json'))

        except urllib.error.HTTPError as e:
            error_body = e.read()
            self._send_proxy_response(e.code, error_body, 'application/json')

        except Exception as e:
            error_msg = json.dumps({'error': {'message': str(e)}}).encode()
            self._send_proxy_response(502, error_msg, 'application/json')

    def _send_proxy_response(self, status_code, body, content_type):
        """Send a proxy response, silently handling client disconnects."""
        try:
            self.send_response(status_code)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, OSError):
            self.log_message('Client disconnected before response sent (%d)', status_code)

    def handle_one_request(self):
        """Override to catch BrokenPipeError from the post-method wfile.flush()."""
        try:
            super().handle_one_request()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            self.close_connection = True
            self.log_message('Connection broken during request handling')

    def end_headers(self):
        if self.path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, format, *args):
        msg = format % args
        if '/api/' in msg:
            sys.stderr.write(f"\033[36m[PROXY] {msg}\033[0m\n")
        else:
            sys.stderr.write(f"[STATIC] {msg}\n")


if __name__ == '__main__':
    # Prevent SIGPIPE from killing the process (macOS/Linux)
    if hasattr(signal, 'SIGPIPE'):
        signal.signal(signal.SIGPIPE, signal.SIG_IGN)

    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = RobustThreadingHTTPServer(('', PORT), ProxyHandler)
    print(f'🚀 AI-Design dev server at http://127.0.0.1:{PORT}')
    print(f'   API proxy: POST /api/generate → Gemini API')
    print(f'   Legacy:    /api/gemini/* → Gemini API')
    print(f'   Threaded mode: concurrent requests supported')
    print(f'   Press Ctrl+C to stop\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n⏹  Server stopped')
        server.server_close()
