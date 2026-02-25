## Cursor Cloud specific instructions

### Overview

AI Design is a vanilla HTML/CSS/JS web application (no build step, no package manager, no framework). The only local service is `server.py`, a Python 3 stdlib HTTP server that serves static files and proxies `/api/*` requests to external APIs (Gemini, Unsplash, Giphy).

### Running the dev server

```bash
python3 server.py
```

This starts a threaded HTTP server on **port 8080**. No dependencies beyond Python 3 stdlib are needed.

- Homepage: `http://localhost:8080/`
- Canvas editor: `http://localhost:8080/canvas.html`

### Key caveats

- **No linting or test framework**: The project has no ESLint, Prettier, or automated test setup. There is no `package.json` or `requirements.txt`.
- **API keys are embedded** in `server.py` for local dev (Gemini, Unsplash, Giphy). Do not commit changes to these keys.
- **`start_server.sh`** uses `python3 -m http.server` (no API proxy). Use `python3 server.py` instead for full functionality including AI generation.
- **Cloudflare Functions** in `functions/api/` are the production API layer and are not used during local development.
- **Authentication**: Supabase auth is loaded via CDN. In dev mode without valid OAuth credentials, the app simulates auth (any 6-digit OTP works).
- **Canvas text tool** triggers AI image generation via Gemini API, not plain text placement.
