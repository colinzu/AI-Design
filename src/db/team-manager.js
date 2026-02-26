/**
 * TeamManager — CRUD for teams, members, and user profile.
 *
 * Exposes:
 *   window.TeamManager.getMyTeams()
 *   window.TeamManager.createTeam(name)
 *   window.TeamManager.inviteMember(teamId, email, role)
 *   window.TeamManager.removeMember(teamId, userId)
 *   window.TeamManager.leaveTeam(teamId)
 *   window.TeamManager.getProfile(userId?)
 *   window.TeamManager.updateProfile(updates)
 *   window.TeamManager.openProfileModal()
 *   window.TeamManager.openTeamModal()
 */

import { supabase } from './supabase.js';

// ────────────────────────────────────────────────────────────
// Profile
// ────────────────────────────────────────────────────────────

async function getProfile(userId) {
    const id = userId || (await supabase.auth.getUser()).data?.user?.id;
    if (!id) return null;
    const { data } = await supabase.from('profiles').select('*').eq('id', id).single();
    return data;
}

async function updateProfile(updates) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { error } = await supabase
        .from('profiles')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    if (error) throw error;
}

// ────────────────────────────────────────────────────────────
// Teams
// ────────────────────────────────────────────────────────────

async function getMyTeams() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    // Teams I own OR am a member of
    const { data, error } = await supabase
        .from('teams')
        .select(`
            id, name, slug, avatar_url, owner_id, created_at,
            team_members!inner(user_id, role)
        `)
        .eq('team_members.user_id', user.id);

    if (error) {
        // Fallback: just owned teams
        const { data: owned } = await supabase
            .from('teams')
            .select('id, name, slug, avatar_url, owner_id, created_at')
            .eq('owner_id', user.id);
        return owned || [];
    }
    return data || [];
}

async function createTeam(name) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const slug = name.toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        + '-' + Date.now().toString(36);

    const { data: team, error } = await supabase
        .from('teams')
        .insert({ name, slug, owner_id: user.id })
        .select()
        .single();
    if (error) throw error;

    // Auto-add creator as owner member
    await supabase.from('team_members').insert({
        team_id: team.id, user_id: user.id, role: 'owner',
    });
    return team;
}

async function getTeamMembers(teamId) {
    const { data, error } = await supabase
        .from('team_members')
        .select('user_id, role, joined_at, profiles!inner(display_name, avatar_url)')
        .eq('team_id', teamId);
    if (error) throw error;
    return (data || []).map(m => ({
        userId:      m.user_id,
        role:        m.role,
        joinedAt:    m.joined_at,
        displayName: m.profiles?.display_name,
        avatarUrl:   m.profiles?.avatar_url,
    }));
}

async function inviteMember(teamId, email, role = 'editor') {
    // Look up user by email via auth (server-side only works with service role).
    // Instead, we upsert an invite record that the invite function will process.
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    // Call the Cloudflare invite function (sends email)
    const res = await fetch('/api/invites', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ teamId, email, role, invitedBy: user.id }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to send invite');
    }
    return res.json();
}

async function removeMember(teamId, userId) {
    const { error } = await supabase
        .from('team_members')
        .delete()
        .eq('team_id', teamId)
        .eq('user_id', userId);
    if (error) throw error;
}

async function leaveTeam(teamId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await removeMember(teamId, user.id);
}

// ────────────────────────────────────────────────────────────
// Profile Modal UI
// ────────────────────────────────────────────────────────────

function openProfileModal() {
    // Remove any existing modal
    document.getElementById('profile-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'profile-modal-overlay';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-box profile-modal-box">
            <div class="modal-header">
                <h2 class="modal-title">Profile</h2>
                <button class="modal-close-btn" id="profile-modal-close">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div class="profile-avatar-section">
                    <div class="profile-avatar-preview" id="profile-avatar-preview">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                        </svg>
                    </div>
                    <div class="profile-avatar-info">
                        <p class="profile-avatar-hint">Your profile picture is set via your login provider.</p>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Display Name</label>
                    <input type="text" id="profile-display-name" class="form-input" placeholder="Your name">
                </div>
                <div class="form-group">
                    <label class="form-label">Language</label>
                    <select id="profile-language" class="form-input">
                        <option value="en">English</option>
                        <option value="zh">中文</option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="profile-modal-cancel">Cancel</button>
                <button class="btn btn-primary" id="profile-modal-save">Save Changes</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    // Load current profile
    getProfile().then(p => {
        if (!p) return;
        const nameEl = document.getElementById('profile-display-name');
        const langEl = document.getElementById('profile-language');
        const avatarEl = document.getElementById('profile-avatar-preview');
        if (nameEl) nameEl.value = p.display_name || '';
        if (langEl) langEl.value = p.language || 'en';
        if (avatarEl && p.avatar_url) {
            avatarEl.innerHTML = `<img src="${p.avatar_url}" alt="" style="width:80px;height:80px;border-radius:50%;object-fit:cover;">`;
        }
    });

    function closeModal() { overlay.remove(); }

    document.getElementById('profile-modal-close').addEventListener('click', closeModal);
    document.getElementById('profile-modal-cancel').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    document.getElementById('profile-modal-save').addEventListener('click', async () => {
        const name = document.getElementById('profile-display-name').value.trim();
        const lang = document.getElementById('profile-language').value;
        try {
            await updateProfile({ display_name: name, language: lang });
            _showToast('Profile updated.');
            closeModal();
        } catch (e) {
            _showToast('Failed to update profile: ' + e.message, 'error');
        }
    });
}

// ────────────────────────────────────────────────────────────
// Team Modal UI
// ────────────────────────────────────────────────────────────

function openTeamModal() {
    document.getElementById('team-modal-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'team-modal-overlay';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-box team-modal-box">
            <div class="modal-header">
                <h2 class="modal-title">Teams</h2>
                <button class="modal-close-btn" id="team-modal-close">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div class="team-create-row">
                    <input type="text" id="team-name-input" class="form-input" placeholder="New team name…" maxlength="50">
                    <button class="btn btn-primary" id="team-create-btn">Create Team</button>
                </div>
                <div class="team-list" id="team-list">
                    <div class="team-list-loading">Loading teams…</div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="team-modal-close2">Close</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    function closeModal() { overlay.remove(); }
    document.getElementById('team-modal-close').addEventListener('click', closeModal);
    document.getElementById('team-modal-close2').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    // Load teams
    _renderTeamList();

    document.getElementById('team-create-btn').addEventListener('click', async () => {
        const name = document.getElementById('team-name-input').value.trim();
        if (!name) return;
        try {
            await createTeam(name);
            document.getElementById('team-name-input').value = '';
            _showToast(`Team "${name}" created.`);
            _renderTeamList();
        } catch (e) {
            _showToast('Failed to create team: ' + e.message, 'error');
        }
    });

    async function _renderTeamList() {
        const listEl = document.getElementById('team-list');
        if (!listEl) return;
        listEl.innerHTML = '<div class="team-list-loading">Loading…</div>';
        try {
            const teams = await getMyTeams();
            if (!teams.length) {
                listEl.innerHTML = '<p class="team-empty">No teams yet. Create one above.</p>';
                return;
            }
            listEl.innerHTML = teams.map(t => `
                <div class="team-item" data-id="${t.id}">
                    <div class="team-item-avatar">${(t.name || 'T')[0].toUpperCase()}</div>
                    <div class="team-item-info">
                        <span class="team-item-name">${_esc(t.name)}</span>
                        <span class="team-item-slug">/${_esc(t.slug)}</span>
                    </div>
                    <button class="team-item-manage btn btn-secondary btn-sm" data-id="${t.id}">Manage</button>
                </div>`).join('');

            listEl.querySelectorAll('.team-item-manage').forEach(btn => {
                btn.addEventListener('click', () => _openTeamDetail(btn.dataset.id, teams));
            });
        } catch (e) {
            listEl.innerHTML = `<p class="team-error">Failed to load: ${_esc(e.message)}</p>`;
        }
    }

    async function _openTeamDetail(teamId, teams) {
        const team = teams.find(t => t.id === teamId);
        if (!team) return;

        const listEl = document.getElementById('team-list');
        listEl.innerHTML = `
            <div class="team-detail-header">
                <button class="btn btn-ghost btn-sm" id="team-back-btn">← Back</button>
                <h3 class="team-detail-name">${_esc(team.name)}</h3>
            </div>
            <div class="team-invite-row">
                <input type="email" id="team-invite-email" class="form-input" placeholder="Invite by email…">
                <select id="team-invite-role" class="form-input form-input-sm">
                    <option value="editor">Editor</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                </select>
                <button class="btn btn-primary btn-sm" id="team-invite-btn">Invite</button>
            </div>
            <div class="team-members-list" id="team-members-list">Loading members…</div>`;

        document.getElementById('team-back-btn').addEventListener('click', _renderTeamList);
        document.getElementById('team-invite-btn').addEventListener('click', async () => {
            const email = document.getElementById('team-invite-email').value.trim();
            const role  = document.getElementById('team-invite-role').value;
            if (!email) return;
            try {
                await inviteMember(teamId, email, role);
                _showToast(`Invitation sent to ${email}.`);
                document.getElementById('team-invite-email').value = '';
            } catch (e) {
                _showToast('Failed to invite: ' + e.message, 'error');
            }
        });

        // Load members
        try {
            const members = await getTeamMembers(teamId);
            const membersEl = document.getElementById('team-members-list');
            if (!membersEl) return;
            if (!members.length) { membersEl.innerHTML = '<p>No members yet.</p>'; return; }
            membersEl.innerHTML = `<table class="team-members-table">
                <thead><tr><th>Member</th><th>Role</th><th></th></tr></thead>
                <tbody>
                ${members.map(m => `
                    <tr>
                        <td class="tm-name">${_esc(m.displayName || m.userId.slice(0, 8))}</td>
                        <td class="tm-role tm-role-${m.role}">${m.role}</td>
                        <td><button class="btn btn-ghost btn-sm tm-remove" data-uid="${m.userId}">Remove</button></td>
                    </tr>`).join('')}
                </tbody></table>`;
            membersEl.querySelectorAll('.tm-remove').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await removeMember(teamId, btn.dataset.uid);
                        _showToast('Member removed.');
                        _openTeamDetail(teamId, teams);
                    } catch (e) {
                        _showToast('Failed: ' + e.message, 'error');
                    }
                });
            });
        } catch (e) {
            const membersEl = document.getElementById('team-members-list');
            if (membersEl) membersEl.innerHTML = `<p>Error: ${_esc(e.message)}</p>`;
        }
    }
}

// ────────────────────────────────────────────────────────────
// Utilities
// ────────────────────────────────────────────────────────────

function _esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _showToast(msg, type = 'success') {
    // Re-use existing showToast if available (script.js / canvas.js defines it)
    if (typeof window.showToast === 'function') {
        window.showToast(msg, type);
        return;
    }
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:${type === 'error' ? '#e53e3e' : '#22c55e'};color:#fff;
        padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;
        box-shadow:0 4px 12px rgba(0,0,0,.2)`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

// ────────────────────────────────────────────────────────────
// Global export
// ────────────────────────────────────────────────────────────

window.TeamManager = {
    getProfile,
    updateProfile,
    getMyTeams,
    createTeam,
    getTeamMembers,
    inviteMember,
    removeMember,
    leaveTeam,
    openProfileModal,
    openTeamModal,
};
