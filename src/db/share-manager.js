/**
 * ShareManager — project sharing links and permission management.
 *
 * Exposes:
 *   window.ShareManager.createShareLink(projectId, role, expiresInDays)
 *   window.ShareManager.getShareLinks(projectId)
 *   window.ShareManager.revokeShareLink(linkId)
 *   window.ShareManager.setProjectVisibility(projectId, visibility)
 *   window.ShareManager.openShareModal(projectId)
 */

import { supabase } from './supabase.js';

async function createShareLink(projectId, role = 'viewer', expiresInDays = null) {
    const expires = expiresInDays
        ? new Date(Date.now() + expiresInDays * 86400000).toISOString()
        : null;

    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase
        .from('share_links')
        .insert({ project_id: projectId, role, expires_at: expires, created_by: user?.id })
        .select()
        .single();
    if (error) throw error;
    return data;
}

async function getShareLinks(projectId) {
    const { data, error } = await supabase
        .from('share_links')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
}

async function revokeShareLink(linkId) {
    const { error } = await supabase
        .from('share_links')
        .delete()
        .eq('id', linkId);
    if (error) throw error;
}

async function setProjectVisibility(projectId, visibility) {
    const { error } = await supabase
        .from('projects')
        .update({ visibility, updated_at: new Date().toISOString() })
        .eq('id', projectId);
    if (error) throw error;
}

async function getProjectVisibility(projectId) {
    const { data } = await supabase
        .from('projects')
        .select('visibility')
        .eq('id', projectId)
        .single();
    return data?.visibility || 'private';
}

// ────────────────────────────────────────────────────────────
// Share Modal UI
// ────────────────────────────────────────────────────────────

function openShareModal(projectId) {
    document.getElementById('share-modal-overlay')?.remove();

    const origin = window.location.origin;
    const canvasPath = window.location.pathname.replace(/\/[^/]*$/, '/canvas.html');

    const overlay = document.createElement('div');
    overlay.id = 'share-modal-overlay';
    overlay.className = 'modal-overlay active';
    overlay.innerHTML = `
        <div class="modal-box share-modal-box">
            <div class="modal-header">
                <h2 class="modal-title">Share Project</h2>
                <button class="modal-close-btn" id="share-modal-close">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            </div>
            <div class="modal-body">
                <div class="share-visibility-section">
                    <label class="form-label">Project Access</label>
                    <select id="share-visibility-select" class="form-input">
                        <option value="private">Private — only invited members</option>
                        <option value="team">Team — anyone in my team can view</option>
                        <option value="public">Public — anyone with the link can view</option>
                    </select>
                </div>

                <div class="share-link-section">
                    <div class="share-link-row">
                        <label class="form-label">Share Link</label>
                        <div class="share-link-role-row">
                            <select id="share-link-role" class="form-input form-input-sm">
                                <option value="viewer">View only</option>
                                <option value="editor">Can edit</option>
                            </select>
                            <button class="btn btn-primary btn-sm" id="share-create-link-btn">Create Link</button>
                        </div>
                    </div>
                    <div id="share-links-list" class="share-links-list">
                        <div class="share-links-loading">Loading links…</div>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" id="share-modal-done">Done</button>
            </div>
        </div>`;

    document.body.appendChild(overlay);

    function closeModal() { overlay.remove(); }
    document.getElementById('share-modal-close').addEventListener('click', closeModal);
    document.getElementById('share-modal-done').addEventListener('click', closeModal);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

    // Load current visibility
    getProjectVisibility(projectId).then(vis => {
        const sel = document.getElementById('share-visibility-select');
        if (sel) sel.value = vis;
    });

    document.getElementById('share-visibility-select').addEventListener('change', async (e) => {
        try {
            await setProjectVisibility(projectId, e.target.value);
            _showToast('Access updated.');
        } catch (err) {
            _showToast('Failed: ' + err.message, 'error');
        }
    });

    document.getElementById('share-create-link-btn').addEventListener('click', async () => {
        const role = document.getElementById('share-link-role').value;
        try {
            await createShareLink(projectId, role);
            _showToast('Share link created.');
            _renderLinks();
        } catch (err) {
            _showToast('Failed: ' + err.message, 'error');
        }
    });

    _renderLinks();

    async function _renderLinks() {
        const listEl = document.getElementById('share-links-list');
        if (!listEl) return;
        listEl.innerHTML = '<div class="share-links-loading">Loading…</div>';
        try {
            const links = await getShareLinks(projectId);
            if (!links.length) {
                listEl.innerHTML = '<p class="share-links-empty">No share links yet.</p>';
                return;
            }
            listEl.innerHTML = links.map(link => {
                const url = `${origin}${canvasPath}?id=${projectId}&share=${link.token}`;
                const expires = link.expires_at
                    ? `Expires ${new Date(link.expires_at).toLocaleDateString()}`
                    : 'Never expires';
                return `
                    <div class="share-link-item" data-id="${link.id}">
                        <div class="share-link-url-row">
                            <input type="text" class="form-input share-link-url" value="${url}" readonly>
                            <button class="btn btn-secondary btn-sm share-link-copy" data-url="${url}">Copy</button>
                        </div>
                        <div class="share-link-meta">
                            <span class="share-link-role-badge share-role-${link.role}">${link.role}</span>
                            <span class="share-link-expiry">${expires}</span>
                            <button class="btn btn-ghost btn-sm share-link-revoke" data-id="${link.id}">Revoke</button>
                        </div>
                    </div>`;
            }).join('');

            listEl.querySelectorAll('.share-link-copy').forEach(btn => {
                btn.addEventListener('click', () => {
                    navigator.clipboard?.writeText(btn.dataset.url)
                        .then(() => _showToast('Link copied to clipboard.'))
                        .catch(() => _showToast('Copy failed — try manually.', 'error'));
                });
            });
            listEl.querySelectorAll('.share-link-revoke').forEach(btn => {
                btn.addEventListener('click', async () => {
                    try {
                        await revokeShareLink(btn.dataset.id);
                        _showToast('Link revoked.');
                        _renderLinks();
                    } catch (err) {
                        _showToast('Failed: ' + err.message, 'error');
                    }
                });
            });
        } catch (e) {
            listEl.innerHTML = `<p>Error: ${_esc(e.message)}</p>`;
        }
    }
}

function _esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _showToast(msg, type = 'success') {
    if (typeof window.showToast === 'function') { window.showToast(msg, type); return; }
    const t = document.createElement('div');
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
        background:${type === 'error' ? '#e53e3e' : '#22c55e'};color:#fff;
        padding:10px 20px;border-radius:8px;font-size:14px;z-index:99999;
        box-shadow:0 4px 12px rgba(0,0,0,.2)`;
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}

window.ShareManager = {
    createShareLink,
    getShareLinks,
    revokeShareLink,
    setProjectVisibility,
    getProjectVisibility,
    openShareModal,
};
