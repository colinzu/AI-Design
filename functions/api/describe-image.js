/**
 * Cloudflare Pages Function — Image Description via Gemini
 *
 * Handles POST /api/describe-image
 * Uses Gemini to analyze an image and return search keywords.
 * Environment variables: GEMINI_API_KEY
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';

const ALLOWED_ORIGINS = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
];

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

export async function onRequestPost(context) {
    const { request, env } = context;

    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
        return jsonResponse(500, { error: { message: 'Server misconfigured: missing API key' } });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse(400, { error: { message: 'Invalid JSON body' } });
    }

    const imageData = body.imageData;
    if (!imageData) {
        return jsonResponse(400, { error: { message: 'Missing imageData' } });
    }

    const match = imageData.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
        return jsonResponse(400, { error: { message: 'Invalid image data URL' } });
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const geminiBody = {
        contents: [{
            parts: [
                { text: 'Describe this image in 3-5 short English keywords suitable for searching similar images. Return ONLY the keywords separated by commas, nothing else.' },
                { inlineData: { mimeType, data: base64Data } }
            ]
        }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 50
        }
    };

    const targetUrl = `${GEMINI_BASE}/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    try {
        const upstream = await fetch(targetUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiBody),
        });

        return new Response(upstream.body, {
            status: upstream.status,
            headers: {
                'Content-Type': upstream.headers.get('Content-Type') || 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        return jsonResponse(502, { error: { message: 'Upstream request failed: ' + err.message } });
    }
}

function jsonResponse(status, data) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
    });
}
