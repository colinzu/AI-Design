/**
 * Cloudflare Pages Function — Unsplash API Proxy
 *
 * Handles GET /api/unsplash?query=...&page=1&per_page=30
 * Environment variables: UNSPLASH_ACCESS_KEY
 */

const ALLOWED_ORIGINS = [
    'http://localhost:8080',
    'http://127.0.0.1:8080',
];

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

    const accessKey = env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
        return jsonResponse(500, { error: 'Server misconfigured: missing UNSPLASH_ACCESS_KEY' });
    }

    const url = new URL(request.url);
    const query = url.searchParams.get('query') || '';
    const page = url.searchParams.get('page') || '1';
    const perPage = url.searchParams.get('per_page') || '30';

    let targetUrl;
    if (query) {
        targetUrl = `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&page=${page}&per_page=${perPage}&client_id=${accessKey}`;
    } else {
        targetUrl = `https://api.unsplash.com/photos?page=${page}&per_page=${perPage}&order_by=popular&client_id=${accessKey}`;
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
