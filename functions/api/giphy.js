/**
 * Cloudflare Pages Function — Giphy API Proxy
 *
 * Handles GET /api/giphy?query=...&offset=0&limit=30
 * Environment variables: GIPHY_API_KEY
 */

export async function onRequestOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '86400',
        },
    });
}

export async function onRequestGet(context) {
    const { request, env } = context;

    const apiKey = env.GIPHY_API_KEY;
    if (!apiKey) {
        return jsonResponse(500, { error: 'Server misconfigured: missing GIPHY_API_KEY' });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const offset = url.searchParams.get('offset') || '0';
    const limit = url.searchParams.get('limit') || '30';

    let targetUrl;
    if (query) {
        targetUrl = `https://api.giphy.com/v1/gifs/search?q=${encodeURIComponent(query)}&offset=${offset}&limit=${limit}&api_key=${apiKey}`;
    } else {
        targetUrl = `https://api.giphy.com/v1/gifs/trending?offset=${offset}&limit=${limit}&api_key=${apiKey}`;
    }

    try {
        const upstream = await fetch(targetUrl, {
            headers: { 'Accept': 'application/json' },
        });

        return new Response(upstream.body, {
            status: upstream.status,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch (err) {
        return jsonResponse(502, { error: 'Upstream request failed: ' + err.message });
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
