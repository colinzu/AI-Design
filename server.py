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
import urllib.parse
import os
import sys
import signal
import re

PORT = 8080
GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta'

# API key for local development only.
# In production, this is stored as a Cloudflare secret.
GEMINI_API_KEY = 'AIzaSyDwsn-H9GkEeAW1w3TUl-rJX_K_daTTkKQ'

# Allowed models (same whitelist as the Cloudflare Worker)
ALLOWED_MODELS = ['gemini-3-pro-image-preview']

# Unsplash API (free tier: 50 req/hr)
UNSPLASH_ACCESS_KEY = 'qMqETFh1CGgNK42J602KvvKWMZKP-3j3VWUorzfXAo0'

# Giphy API (free tier)
GIPHY_API_KEY = 'dc6zaTOxFJmzC'


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

    def do_GET(self):
        if self.path.startswith('/api/unsplash'):
            self._proxy_unsplash()
        elif self.path.startswith('/api/giphy'):
            self._proxy_giphy()
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/generate':
            self._proxy_generate()
        elif self.path == '/api/describe-image':
            self._proxy_describe_image()
        elif self.path.startswith('/api/gemini/'):
            self._proxy_gemini_legacy()
        else:
            self.send_error(404, 'Not Found')

    def do_OPTIONS(self):
        if self.path.startswith('/api/'):
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Access-Control-Max-Age', '86400')
            self.end_headers()
        else:
            self.send_error(404, 'Not Found')

    def _proxy_unsplash(self):
        """GET /api/unsplash?query=...&page=1&per_page=30 → Unsplash API."""
        self.close_connection = True
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        query = params.get('query', [''])[0]
        page = params.get('page', ['1'])[0]
        per_page = params.get('per_page', ['30'])[0]

        if query:
            url = f'https://api.unsplash.com/search/photos?query={urllib.parse.quote(query)}&page={page}&per_page={per_page}&client_id={UNSPLASH_ACCESS_KEY}'
        else:
            url = f'https://api.unsplash.com/photos?page={page}&per_page={per_page}&order_by=popular&client_id={UNSPLASH_ACCESS_KEY}'

        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json'})
            # Fix SSL error by using unverified context
            import ssl
            context = ssl._create_unverified_context()
            with urllib.request.urlopen(req, timeout=15, context=context) as resp:
                data = resp.read()
                self._send_proxy_response(resp.status, data, 'application/json')
        except urllib.error.HTTPError as e:
            self._send_proxy_response(e.code, e.read(), 'application/json')
        except Exception as e:
            error_msg = json.dumps({'error': str(e)}).encode()
            self._send_proxy_response(502, error_msg, 'application/json')

    def _proxy_giphy(self):
        """GET /api/giphy?query=...&offset=0&limit=30 → Giphy API."""
        self.close_connection = True
        parsed = urllib.parse.urlparse(self.path)
        params = urllib.parse.parse_qs(parsed.query)
        query = params.get('query', [''])[0]
        offset = params.get('offset', ['0'])[0]
        limit = params.get('limit', ['30'])[0]

        if query:
            url = f'https://api.giphy.com/v1/gifs/search?q={urllib.parse.quote(query)}&offset={offset}&limit={limit}&api_key={GIPHY_API_KEY}'
        else:
            url = f'https://api.giphy.com/v1/gifs/trending?offset={offset}&limit={limit}&api_key={GIPHY_API_KEY}'

        try:
            req = urllib.request.Request(url, headers={'Accept': 'application/json'})
            with urllib.request.urlopen(req, timeout=15) as resp:
                data = resp.read()
                self._send_proxy_response(resp.status, data, 'application/json')
        except urllib.error.HTTPError as e:
            self._send_proxy_response(e.code, e.read(), 'application/json')
        except Exception as e:
            error_msg = json.dumps({'error': str(e)}).encode()
            self._send_proxy_response(502, error_msg, 'application/json')

    def _proxy_describe_image(self):
        """POST /api/describe-image — Use Gemini to describe an image for search keywords."""
        self.close_connection = True
        content_length = int(self.headers.get('Content-Length', 0))
        raw_body = self.rfile.read(content_length) if content_length > 0 else b''

        try:
            body = json.loads(raw_body)
        except json.JSONDecodeError:
            error = json.dumps({'error': {'message': 'Invalid JSON body'}}).encode()
            self._send_proxy_response(400, error, 'application/json')
            return

        image_data = body.get('imageData', '')
        if not image_data:
            error = json.dumps({'error': {'message': 'Missing imageData'}}).encode()
            self._send_proxy_response(400, error, 'application/json')
            return

        # Build Gemini request to describe the image
        match = re.match(r'^data:([^;]+);base64,(.+)$', image_data)
        if not match:
            error = json.dumps({'error': {'message': 'Invalid image data URL'}}).encode()
            self._send_proxy_response(400, error, 'application/json')
            return

        mime_type = match.group(1)
        base64_data = match.group(2)

        gemini_body = json.dumps({
            'contents': [{
                'parts': [
                    {'text': 'Describe this image in 3-5 short English keywords suitable for searching similar images. Return ONLY the keywords separated by commas, nothing else.'},
                    {'inlineData': {'mimeType': mime_type, 'data': base64_data}}
                ]
            }],
            'generationConfig': {
                'temperature': 0.2,
                'maxOutputTokens': 50
            }
        }).encode()

        target_url = f'{GEMINI_BASE}/models/gemini-2.0-flash:generateContent?key={GEMINI_API_KEY}'
        headers = {'Content-Type': 'application/json'}

        try:
            req = urllib.request.Request(target_url, data=gemini_body, headers=headers, method='POST')
            with urllib.request.urlopen(req, timeout=30) as resp:
                resp_body = resp.read()
                self._send_proxy_response(resp.status, resp_body, 'application/json')
        except urllib.error.HTTPError as e:
            self._send_proxy_response(e.code, e.read(), 'application/json')
        except Exception as e:
            error_msg = json.dumps({'error': {'message': str(e)}}).encode()
            self._send_proxy_response(502, error_msg, 'application/json')

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
    print(f'   Inspiration: GET /api/unsplash, GET /api/giphy')
    print(f'   Intent:   POST /api/describe-image → Gemini')
    print(f'   Legacy:   /api/gemini/* → Gemini API')
    print(f'   Threaded mode: concurrent requests supported')
    print(f'   Press Ctrl+C to stop\n')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n⏹  Server stopped')
        server.server_close()
