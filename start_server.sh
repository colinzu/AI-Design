#!/bin/bash
# Kill any existing python http.server on port 8080
lsof -ti:8080 | xargs kill -9 2>/dev/null

echo "🚀 Starting local server at http://127.0.0.1:8080"
echo "Press Ctrl+C to stop."
python3 -m http.server 8080 --bind 127.0.0.1
