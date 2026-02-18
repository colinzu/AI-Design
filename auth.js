// ==================== Auth Configuration ====================
// ⚙️  Setup instructions:
//   1. Go to https://supabase.com → New project (free)
//   2. Settings → API → copy "Project URL" and "anon public" key
//   3. Authentication → Providers → enable Email (OTP)
//   4. Authentication → Providers → enable Google (need Google Cloud Client ID)
//   5. Authentication → Providers → enable Apple (need Apple Developer account)
//   6. Copy auth.local.js.example → auth.local.js and fill in your keys
//      (auth.local.js is gitignored and loaded before this file in HTML)

// These are placeholder values. Real credentials are supplied by auth.local.js
// which is loaded first in the HTML and is NOT committed to git.
// If auth.local.js has already defined these as real values, the declarations
// below are intentionally shadowed / overridden by it (auth.local.js uses
// plain `const` at the top level of the same scope via a preceding <script>).
// To avoid redeclaration errors, we use var here so re-declaration is silently
// ignored when auth.local.js has already run.

/* eslint-disable no-var */
if (typeof SUPABASE_URL === 'undefined') {
    var SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
}
if (typeof SUPABASE_ANON_KEY === 'undefined') {
    var SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
}
/* eslint-enable no-var */

// ==================== Supabase Client ====================
let _supabase = null;

function getSupabaseClient() {
    if (_supabase) return _supabase;
    if (typeof supabase === 'undefined' || !supabase.createClient) {
        throw new Error('Supabase SDK not loaded');
    }
    _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return _supabase;
}

function isConfigured() {
    return SUPABASE_URL !== 'YOUR_SUPABASE_PROJECT_URL' &&
           SUPABASE_ANON_KEY !== 'YOUR_SUPABASE_ANON_KEY';
}

// ==================== Cross-tab Broadcast ====================
const AUTH_CHANNEL_NAME = 'ai_design_auth_v1';
const AUTH_STORAGE_KEY  = '_ai_design_auth_event';

let _broadcastChannel = null;

function _getBroadcastChannel() {
    if (!_broadcastChannel && typeof BroadcastChannel !== 'undefined') {
        try { _broadcastChannel = new BroadcastChannel(AUTH_CHANNEL_NAME); } catch {}
    }
    return _broadcastChannel;
}

/** Notify other tabs about an auth state change. */
function broadcastAuthChange(event, userId, userEmail) {
    const payload = JSON.stringify({ event, userId, userEmail, ts: Date.now() });
    try {
        const ch = _getBroadcastChannel();
        if (ch) ch.postMessage(payload);
    } catch {}
    // localStorage fallback (fires 'storage' event in other tabs of the same origin)
    try {
        localStorage.setItem(AUTH_STORAGE_KEY, payload);
        // Remove immediately so the same key change fires again next time
        setTimeout(() => localStorage.removeItem(AUTH_STORAGE_KEY), 100);
    } catch {}
}

/**
 * Listen for auth changes from OTHER tabs.
 * callback({ event, userId, userEmail })
 */
function listenForAuthBroadcast(callback) {
    try {
        const ch = _getBroadcastChannel();
        if (ch) {
            ch.onmessage = (e) => {
                try { callback(JSON.parse(e.data)); } catch {}
            };
        }
    } catch {}
    // localStorage fallback
    window.addEventListener('storage', (e) => {
        if (e.key === AUTH_STORAGE_KEY && e.newValue) {
            try { callback(JSON.parse(e.newValue)); } catch {}
        }
    });
}

// ==================== Auth State ====================
let _authStateCallback = null;

function onAuthStateChange(callback) {
    _authStateCallback = callback;
    if (!isConfigured()) return;
    try {
        const client = getSupabaseClient();
        client.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' && session) {
                broadcastAuthChange('SIGNED_IN', session.user.id, session.user.email);
                callback({ loggedIn: true, user: session.user });
            } else if (event === 'SIGNED_OUT') {
                broadcastAuthChange('SIGNED_OUT', null, null);
                callback({ loggedIn: false, user: null });
            }
        });
        // Check current session on init
        client.auth.getSession().then(({ data: { session } }) => {
            if (session) {
                callback({ loggedIn: true, user: session.user });
            }
        });
    } catch (e) {
        console.warn('[Auth] onAuthStateChange error:', e.message);
    }
}

// ==================== OAuth Redirect URL ====================
function getRedirectUrl() {
    // Always redirect back to the index page (strip hash/search)
    const origin = window.location.origin;
    const path = window.location.pathname.replace(/\/[^/]*$/, '/') || '/';
    return origin + path;
}

// ==================== Google Login ====================
async function signInWithGoogle() {
    if (!isConfigured()) {
        console.warn('[Auth] Supabase not configured – skipping real auth');
        return { error: { message: 'not_configured' } };
    }
    try {
        const client = getSupabaseClient();
        const { data, error } = await client.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: getRedirectUrl(),
                queryParams: { access_type: 'offline', prompt: 'select_account' }
            }
        });
        return { data, error };
    } catch (e) {
        return { error: { message: e.message } };
    }
}

// ==================== Apple Login ====================
async function signInWithApple() {
    if (!isConfigured()) {
        console.warn('[Auth] Supabase not configured – skipping real auth');
        return { error: { message: 'not_configured' } };
    }
    try {
        const client = getSupabaseClient();
        const { data, error } = await client.auth.signInWithOAuth({
            provider: 'apple',
            options: { redirectTo: getRedirectUrl() }
        });
        return { data, error };
    } catch (e) {
        return { error: { message: e.message } };
    }
}

// ==================== Email OTP ====================
async function sendEmailOTP(email) {
    if (!isConfigured()) {
        console.warn('[Auth] Supabase not configured – simulating OTP send');
        return { error: null, simulated: true };
    }
    try {
        const client = getSupabaseClient();
        // Do NOT pass emailRedirectTo — omitting it makes Supabase send
        // a numeric OTP token (not a magic link) via email.
        const { data, error } = await client.auth.signInWithOtp({
            email,
            options: { shouldCreateUser: true }
        });
        return { data, error };
    } catch (e) {
        return { error: { message: e.message } };
    }
}

async function verifyEmailOTP(email, token) {
    if (!isConfigured()) {
        // Simulated: accept any 6-digit code in dev mode
        if (/^\d{6}$/.test(token)) {
            return { data: { user: { email } }, error: null, simulated: true };
        }
        return { error: { message: '验证码格式错误' } };
    }
    try {
        const client = getSupabaseClient();
        const { data, error } = await client.auth.verifyOtp({
            email,
            token,
            type: 'email'
        });
        return { data, error };
    } catch (e) {
        return { error: { message: e.message } };
    }
}

// ==================== Sign Out ====================
async function signOut() {
    if (!isConfigured()) return;
    try {
        const client = getSupabaseClient();
        await client.auth.signOut();
    } catch (e) {
        console.warn('[Auth] signOut error:', e.message);
    }
}

// ==================== Get Current User ====================
async function getCurrentUser() {
    if (!isConfigured()) return null;
    try {
        const client = getSupabaseClient();
        const { data: { user } } = await client.auth.getUser();
        return user;
    } catch (e) {
        return null;
    }
}
