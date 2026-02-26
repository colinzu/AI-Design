/**
 * Cloudflare Pages Function — Share Link Validator
 *
 * GET /api/share?token=<token>
 *
 * Validates a share token and returns:
 *   { projectId, role, valid: true }  on success
 *   { valid: false, error: "..." }    on invalid/expired
 *
 * Uses Supabase service-role key (secret) so it can bypass RLS.
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export async function onRequestGet({ request, env }) {
    const url   = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
        return Response.json({ valid: false, error: 'Missing token' }, { status: 400, headers: CORS_HEADERS });
    }

    try {
        const supabaseUrl     = env.SUPABASE_URL     || 'https://lfluatmojhkzdywizmsm.supabase.co';
        const supabaseService = env.SUPABASE_SERVICE_KEY;

        if (!supabaseService) {
            // Fallback: use anon key (limited — can only read public share_links)
            return Response.json({ valid: false, error: 'Service key not configured' }, { status: 500, headers: CORS_HEADERS });
        }

        const res = await fetch(
            `${supabaseUrl}/rest/v1/share_links?token=eq.${encodeURIComponent(token)}&select=id,project_id,role,expires_at`,
            { headers: { apikey: supabaseService, Authorization: `Bearer ${supabaseService}` } }
        );

        if (!res.ok) throw new Error('DB query failed: ' + res.status);

        const rows = await res.json();
        if (!rows.length) {
            return Response.json({ valid: false, error: 'Link not found' }, { status: 404, headers: CORS_HEADERS });
        }

        const link = rows[0];
        if (link.expires_at && new Date(link.expires_at) < new Date()) {
            return Response.json({ valid: false, error: 'Link expired' }, { status: 410, headers: CORS_HEADERS });
        }

        return Response.json(
            { valid: true, projectId: link.project_id, role: link.role },
            { headers: CORS_HEADERS }
        );
    } catch (e) {
        return Response.json({ valid: false, error: e.message }, { status: 500, headers: CORS_HEADERS });
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
