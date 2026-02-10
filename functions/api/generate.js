/**
 * Cloudflare Pages Function — Gemini API Proxy
 *
 * Handles POST /api/generate
 * - Validates request structure and origin
 * - Injects GEMINI_API_KEY from Cloudflare Secrets
 * - Forwards to Google Gemini generateContent API
 * - Returns response to client
 *
 * Environment variables (set via Cloudflare Dashboard or wrangler CLI):
 *   GEMINI_API_KEY — Google AI Studio API key
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

// Only these models are allowed (prevents abuse via arbitrary model calls)
const ALLOWED_MODELS = [
    'gemini-3-pro-image-preview',
];

// Allowed request origins
const ALLOWED_ORIGINS = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
];

/**
 * Handle CORS preflight
 */
export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}

/**
 * Handle POST /api/generate
 */
export async function onRequestPost(context) {
    const { request, env } = context;

    // --- 1. Check API key is configured ---
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
        return jsonResponse(500, { error: { message: 'Server misconfigured: missing API key' } });
    }

    // --- 2. Origin validation ---
    const origin = request.headers.get('Origin') || '';
    const isAllowedOrigin = ALLOWED_ORIGINS.some(o => origin.startsWith(o))
        || /^https:\/\/[\w-]+\.pages\.dev$/.test(origin);
    // Also allow if origin header is missing (e.g. server-to-server calls)
    // but block explicitly wrong origins
    if (origin && !isAllowedOrigin) {
        return jsonResponse(403, { error: { message: 'Unauthorized origin' } });
    }

    // --- 3. Parse request body ---
    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse(400, { error: { message: 'Invalid JSON body' } });
    }

    // --- 4. Validate required fields ---
    if (!body.contents || !body.generationConfig) {
        return jsonResponse(400, { error: { message: 'Missing required fields: contents, generationConfig' } });
    }

    // --- 5. Extract and validate model ---
    const model = body.model || 'gemini-3-pro-image-preview';
    if (!ALLOWED_MODELS.includes(model)) {
        return jsonResponse(400, { error: { message: `Model not allowed: ${model}` } });
    }
    // Remove model from body before forwarding (not a Gemini API field)
    delete body.model;

    // --- 6. Forward to Gemini API ---
    const targetUrl = `${GEMINI_BASE}/models/${model}:generateContent?key=${apiKey}`;

    try {
        const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        // Pass through the response (including error responses from Gemini)
        const responseHeaders = new Headers();
        responseHeaders.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
        responseHeaders.set('Access-Control-Allow-Origin', '*');

        return new Response(upstream.body, {
            status: upstream.status,
            headers: responseHeaders,
        });
    } catch (err) {
        return jsonResponse(502, { error: { message: 'Upstream request failed: ' + err.message } });
    }
}

/**
 * Helper: return a JSON response with CORS headers
 */
function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
