/**
 * Cloud-enabled ProjectManager (Phase 2)
 *
 * Dual-mode:
 *   - Guest / offline  → IndexedDB (delegates to the legacy canvas-project.js instance)
 *   - Authenticated    → Supabase PostgreSQL (projects + project_elements tables)
 *
 * Public API is 100% compatible with the legacy window.ProjectManager so that
 * canvas.js and script.js require zero changes.
 *
 * Runs AFTER canvas-project.js in the module load order; overrides window.ProjectManager.
 */

import { supabase } from './supabase.js';

const THUMB_W = 320;
const THUMB_H = 200;

// ────────────────────────────────────────────────────────────────────
// Serialisation helpers (copied from canvas-project.js so this module
// is self-contained; the logic is identical)
// ────────────────────────────────────────────────────────────────────

function _serializeElements(elements) {
    const frameId = new Map();
    let fi = 0;
    elements.forEach(el => { if (el.type === 'frame') frameId.set(el, 'f' + fi++); });

    return elements.map(el => {
        const out = {};
        for (const key of Object.keys(el)) {
            if (key === 'image')        continue;
            if (key === 'parentFrame')  continue;
            if (key === '_generating')  continue;
            if (key === '_genStartTime')continue;
            if (key === '_justCreated') continue;
            out[key] = el[key];
        }
        if (el.type === 'frame') out._fid  = frameId.get(el);
        if (el.parentFrame)      out._pfid = frameId.get(el.parentFrame) ?? null;
        return out;
    });
}

async function _deserializeElements(serialized) {
    if (!Array.isArray(serialized) || serialized.length === 0) return [];

    const frameById = {};
    const elements = serialized.map(s => {
        const el = Object.assign({}, s);
        delete el._pfid;
        if (el._fid !== undefined) {
            frameById[el._fid] = el;
            delete el._fid;
        }
        return el;
    });

    serialized.forEach((s, i) => {
        if (s._pfid !== undefined) elements[i].parentFrame = frameById[s._pfid] ?? null;
    });

    let pendingRender = false;
    function scheduleRender() {
        if (pendingRender) return;
        pendingRender = true;
        requestAnimationFrame(() => {
            pendingRender = false;
            if (window.canvasEngine) window.canvasEngine.render();
        });
    }

    const imageEls = elements.filter(el => el.type === 'image' && el.src);
    if (imageEls.length > 0) {
        const firstImg = imageEls[0];
        await new Promise(resolve => {
            const img = new Image();
            if (!firstImg.src.startsWith('data:')) img.crossOrigin = 'anonymous';
            img.onload  = () => { firstImg.image = img; resolve(); };
            img.onerror = () => resolve();
            img.src = firstImg.src;
        });
        imageEls.slice(1).forEach(el => {
            const img = new Image();
            if (!el.src.startsWith('data:')) img.crossOrigin = 'anonymous';
            img.onload  = () => { el.image = img; scheduleRender(); };
            img.onerror = () => {};
            img.src = el.src;
        });
    }

    return elements;
}

// ────────────────────────────────────────────────────────────────────
// Thumbnail helpers
// ────────────────────────────────────────────────────────────────────

function _thumbnailFromElement(imgEl) {
    try {
        if (!imgEl || !imgEl.naturalWidth) return null;
        const cnv = document.createElement('canvas');
        cnv.width = THUMB_W; cnv.height = THUMB_H;
        const ctx = cnv.getContext('2d');
        ctx.fillStyle = '#EAEFF5';
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        const srcAR = imgEl.naturalWidth / imgEl.naturalHeight;
        const dstAR = THUMB_W / THUMB_H;
        let sx, sy, sw, sh;
        if (srcAR > dstAR) {
            sh = imgEl.naturalHeight; sw = sh * dstAR;
            sx = (imgEl.naturalWidth - sw) / 2; sy = 0;
        } else {
            sw = imgEl.naturalWidth; sh = sw / dstAR;
            sx = 0; sy = (imgEl.naturalHeight - sh) / 2;
        }
        ctx.drawImage(imgEl, sx, sy, sw, sh, 0, 0, THUMB_W, THUMB_H);
        return cnv.toDataURL('image/jpeg', 0.65);
    } catch { return null; }
}

function _thumbnailFromCanvas(canvasEl) {
    try {
        if (!canvasEl) return null;
        const cnv = document.createElement('canvas');
        cnv.width = THUMB_W; cnv.height = THUMB_H;
        const ctx = cnv.getContext('2d');
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        ctx.drawImage(canvasEl, 0, 0, THUMB_W, THUMB_H);
        return cnv.toDataURL('image/jpeg', 0.7);
    } catch { return null; }
}

async function _generateThumbnailDataUrl(elements, canvasEl) {
    for (let i = elements.length - 1; i >= 0; i--) {
        const el = elements[i];
        if (el.type !== 'image') continue;
        if (el.image) { const t = _thumbnailFromElement(el.image); if (t) return t; }
        if (el.src) {
            const t = await new Promise(resolve => {
                const img = new Image();
                img.onload  = () => resolve(_thumbnailFromElement(img));
                img.onerror = () => resolve(null);
                img.src = el.src;
            });
            if (t) return t;
        }
    }
    return canvasEl ? _thumbnailFromCanvas(canvasEl) : null;
}

// ────────────────────────────────────────────────────────────────────
// Thumbnail upload to Supabase Storage
// Returns a public URL or null on failure.
// ────────────────────────────────────────────────────────────────────

async function _uploadThumbnail(projectId, dataUrl) {
    if (!dataUrl) return null;
    try {
        const blob = await (await fetch(dataUrl)).blob();
        const path = `${projectId}.jpg`;
        const { error } = await supabase.storage
            .from('project-thumbnails')
            .upload(path, blob, { upsert: true, contentType: 'image/jpeg' });
        if (error) return null;
        const { data } = supabase.storage.from('project-thumbnails').getPublicUrl(path);
        return data?.publicUrl ?? null;
    } catch { return null; }
}

// ────────────────────────────────────────────────────────────────────
// Cloud CRUD helpers
// ────────────────────────────────────────────────────────────────────

async function _cloudGetAll(userId) {
    const { data, error } = await supabase
        .from('projects')
        .select('id, name, updated_at, thumbnail_url, frame_count, viewport')
        .eq('owner_id', userId)
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .limit(50);
    if (error) throw error;
    return (data || []).map(p => ({
        id:          p.id,
        name:        p.name,
        updatedAt:   new Date(p.updated_at).getTime(),
        thumbnail:   p.thumbnail_url,
        frameCount:  p.frame_count,
        viewport:    p.viewport,
    }));
}

async function _cloudLoad(projectId) {
    const [metaRes, elemRes] = await Promise.all([
        supabase.from('projects')
            .select('id, name, updated_at, thumbnail_url, frame_count, viewport')
            .eq('id', projectId)
            .single(),
        supabase.from('project_elements')
            .select('elements, version')
            .eq('project_id', projectId)
            .single(),
    ]);
    if (metaRes.error && metaRes.error.code !== 'PGRST116') throw metaRes.error;
    if (!metaRes.data) return null;

    const raw = elemRes.data?.elements ?? [];
    const elements = await _deserializeElements(raw);
    return {
        id:         metaRes.data.id,
        name:       metaRes.data.name,
        updatedAt:  new Date(metaRes.data.updated_at).getTime(),
        thumbnail:  metaRes.data.thumbnail_url,
        frameCount: metaRes.data.frame_count,
        viewport:   metaRes.data.viewport,
        elements,
        _version:   elemRes.data?.version ?? 1,
    };
}

async function _cloudSave(userId, id, name, elements, viewport, canvasEl) {
    const serialized  = _serializeElements(elements);
    const frameCount  = elements.filter(el => el.type === 'frame').length;
    const thumbnailDataUrl = await _generateThumbnailDataUrl(elements, canvasEl);

    // Upsert project metadata
    const { error: projErr } = await supabase
        .from('projects')
        .upsert({
            id,
            owner_id:    userId,
            name:        name || 'Untitled Project',
            frame_count: frameCount,
            viewport:    { x: viewport.x, y: viewport.y, scale: viewport.scale },
            updated_at:  new Date().toISOString(),
        }, { onConflict: 'id' });
    if (projErr) throw projErr;

    // Upsert canvas elements
    const { error: elemErr } = await supabase
        .from('project_elements')
        .upsert({
            project_id: id,
            elements:   serialized,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'project_id' });
    if (elemErr) throw elemErr;

    // Upload thumbnail in background (non-blocking)
    if (thumbnailDataUrl) {
        _uploadThumbnail(id, thumbnailDataUrl).then(url => {
            if (url) {
                supabase.from('projects')
                    .update({ thumbnail_url: url })
                    .eq('id', id)
                    .then(() => {});
            }
        });
    }
}

async function _cloudDelete(projectId) {
    await supabase
        .from('projects')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', projectId);
}

async function _cloudRename(projectId, newName) {
    await supabase
        .from('projects')
        .update({ name: newName || 'Untitled Project', updated_at: new Date().toISOString() })
        .eq('id', projectId);
}

// ────────────────────────────────────────────────────────────────────
// Migration: push local IndexedDB projects to cloud on first login
// ────────────────────────────────────────────────────────────────────

async function _migrateLocalToCloud(userId) {
    const _local = window._localProjectManager;
    if (!_local) return;
    const localProjects = await _local.getAll();
    if (!localProjects.length) return;

    console.log('[ProjectManager] Migrating', localProjects.length, 'local project(s) to cloud…');
    for (const p of localProjects) {
        try {
            const full = await _local.load(p.id);
            if (!full) continue;
            await _cloudSave(userId, p.id, p.name, full.elements || [], full.viewport || {}, null);
            console.log('[ProjectManager] Migrated project:', p.name);
        } catch (e) {
            console.warn('[ProjectManager] Migration failed for', p.id, e);
        }
    }
    console.log('[ProjectManager] Migration complete.');
}

// ────────────────────────────────────────────────────────────────────
// Public API (same interface as legacy window.ProjectManager)
// ────────────────────────────────────────────────────────────────────

let _userId  = 'guest';
let _isCloud = false;

const CloudProjectManager = {

    // Expose for canvas-project.js emergency recovery path
    _deserializeElements,

    getUserId() { return _userId; },

    async setUserId(newUserId) {
        const prev = _userId;
        _userId    = newUserId || 'guest';
        _isCloud   = _userId !== 'guest';

        // On first real login, migrate local projects to cloud
        if (prev === 'guest' && _isCloud) {
            await _migrateLocalToCloud(_userId).catch(() => {});
        }

        // Also update the legacy local manager so it still tracks userId
        if (window._localProjectManager) {
            await window._localProjectManager.setUserId(_userId);
        }

        console.log('[ProjectManager] Switched to:', _userId, _isCloud ? '(cloud)' : '(local)');
    },

    async getAll() {
        if (_isCloud) {
            try { return await _cloudGetAll(_userId); } catch (e) {
                console.warn('[ProjectManager] Cloud getAll failed, falling back:', e);
            }
        }
        return window._localProjectManager ? window._localProjectManager.getAll() : [];
    },

    async get(id) {
        const all = await this.getAll();
        return all.find(p => p.id === id) ?? null;
    },

    async load(id) {
        if (_isCloud) {
            try {
                const p = await _cloudLoad(id);
                if (p) return p;
            } catch (e) {
                console.warn('[ProjectManager] Cloud load failed, falling back:', e);
            }
        }
        return window._localProjectManager ? window._localProjectManager.load(id) : null;
    },

    async save(id, name, elements, viewport, canvasEl) {
        if (_isCloud) {
            try {
                await _cloudSave(_userId, id, name, elements, viewport, canvasEl);
                window.dispatchEvent(new CustomEvent('pm:save', { detail: { ok: true, cloud: true } }));
                return true;
            } catch (e) {
                const msg = e?.message || String(e);
                const code = e?.code || e?.status || '';
                console.error('[ProjectManager] Cloud save FAILED. userId:', _userId, '| error:', msg, '| code:', code, '| full:', e);
                window.dispatchEvent(new CustomEvent('pm:save', { detail: { ok: false, cloud: true, error: msg, code } }));
            }
        }
        if (window._localProjectManager) {
            return window._localProjectManager.save(id, name, elements, viewport, canvasEl);
        }
        return false;
    },

    saveAndForget(id, name, elements, viewport) {
        // Best-effort fire-and-forget (used in beforeunload)
        if (_isCloud) {
            _cloudSave(_userId, id, name, elements, viewport, null).catch(() => {});
        }
        if (window._localProjectManager) {
            window._localProjectManager.saveAndForget(id, name, elements, viewport);
        }
    },

    async delete(id) {
        if (_isCloud) {
            try { await _cloudDelete(id); } catch (e) {
                console.warn('[ProjectManager] Cloud delete failed:', e);
            }
        }
        if (window._localProjectManager) {
            await window._localProjectManager.delete(id);
        }
    },

    async rename(id, newName) {
        if (_isCloud) {
            try { await _cloudRename(id, newName); } catch (e) {
                console.warn('[ProjectManager] Cloud rename failed:', e);
            }
        }
        if (window._localProjectManager) {
            await window._localProjectManager.rename(id, newName);
        }
    },

    generateId() {
        return crypto.randomUUID ? crypto.randomUUID() : ('proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7));
    },
};

// ────────────────────────────────────────────────────────────────────
// Install: stash legacy manager, override global
// ────────────────────────────────────────────────────────────────────

// Save the IndexedDB manager created by canvas-project.js
window._localProjectManager = window.ProjectManager;

// Override with the cloud-enabled manager
window.ProjectManager = CloudProjectManager;
