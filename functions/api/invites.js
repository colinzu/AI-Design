/**
 * Cloudflare Pages Function — Team Invitation Email
 *
 * POST /api/invites
 * Body: { teamId, email, role, invitedBy }
 *
 * Sends an invitation email via Supabase Auth admin API (magic link invite).
 * Requires env vars: SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

const CORS_HEADERS = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequestPost({ request, env }) {
    let body;
    try { body = await request.json(); }
    catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: CORS_HEADERS }); }

    const { teamId, email, role, invitedBy } = body;

    if (!teamId || !email) {
        return Response.json({ error: 'teamId and email required' }, { status: 400, headers: CORS_HEADERS });
    }

    const supabaseUrl     = env.SUPABASE_URL     || 'https://lfluatmojhkzdywizmsm.supabase.co';
    const supabaseService = env.SUPABASE_SERVICE_KEY;

    if (!supabaseService) {
        return Response.json({ error: 'Service key not configured' }, { status: 500, headers: CORS_HEADERS });
    }

    try {
        // 1. Invite the user via Supabase Auth (sends magic-link email)
        const origin = new URL(request.url).origin;
        const redirectTo = `${origin}/?team_invite=${teamId}`;

        const inviteRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
            method:  'POST',
            headers: {
                apikey:          supabaseService,
                Authorization:  `Bearer ${supabaseService}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                email,
                email_confirm: false,
                invite: true,
                redirect_to: redirectTo,
                data: { invited_to_team: teamId, team_role: role, invited_by: invitedBy },
            }),
        });

        const inviteData = await inviteRes.json().catch(() => ({}));

        if (!inviteRes.ok && inviteRes.status !== 422 /* already exists */) {
            throw new Error(inviteData.message || `Invite API error ${inviteRes.status}`);
        }

        // 2. If user already exists, just add them to team_members directly
        const userId = inviteData?.id;
        if (userId) {
            await fetch(`${supabaseUrl}/rest/v1/team_members`, {
                method:  'POST',
                headers: {
                    apikey:          supabaseService,
                    Authorization:  `Bearer ${supabaseService}`,
                    'Content-Type': 'application/json',
                    Prefer:         'resolution=ignore-duplicates',
                },
                body: JSON.stringify({ team_id: teamId, user_id: userId, role, invited_by: invitedBy }),
            });
        }

        return Response.json({ success: true, email }, { headers: CORS_HEADERS });
    } catch (e) {
        return Response.json({ error: e.message }, { status: 500, headers: CORS_HEADERS });
    }
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
