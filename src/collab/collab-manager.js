/**
 * CollabManager — real-time multi-user collaboration (Phase 5)
 *
 * Strategy: Supabase Realtime Broadcast + Presence (NOT CRDT).
 *   - Each user's local edits are applied immediately (zero-latency UX)
 *   - Operations are broadcast to the room channel
 *   - Remote ops are applied via Last-Write-Wins on element version (_v)
 *   - Full-snapshot sync via Postgres Changes (project_elements upsert)
 *   - Cursor positions sent via Presence (throttled to 30 fps)
 *
 * Integration points in canvas.js:
 *   CollabManager.connect(projectId, engine, userId, displayName, avatarUrl)
 *   CollabManager.disconnect()
 *   CollabManager.broadcastOp(type, payload)     ← called after engine.saveState()
 *   CollabManager.broadcastCursor(worldX, worldY) ← called on mousemove
 *   CollabManager.getPresence()                   ← for the presence indicator UI
 *
 * canvas-engine.js additions:
 *   engine.applyRemoteOp(op)
 *   engine._renderCollabCursors(presenceMap)      ← called at end of render()
 */

import { supabase } from '../db/supabase.js';

// ────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────

const CURSOR_THROTTLE_MS  = 33;   // ~30 fps
const SNAPSHOT_DEBOUNCE_MS = 2000; // save snapshot 2s after last local edit

// Deterministic color from userId hash (HSL, always readable on canvas)
function _userColor(userId) {
    let h = 0;
    for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) & 0xffffff;
    return `hsl(${h % 360}, 70%, 55%)`;
}

// ────────────────────────────────────────────────────────────────────
// State
// ────────────────────────────────────────────────────────────────────

let _channel      = null;  // Supabase Realtime channel
let _engine       = null;  // CanvasEngine reference
let _projectId    = null;
let _userId       = null;
let _displayName  = 'Anonymous';
let _avatarUrl    = null;
let _color        = '#888';
let _isConnected  = false;
let _isViewOnly   = false; // when viewing via share link with viewer role

let _lastCursorSend    = 0;
let _snapshotTimer     = null;
let _reconnectAttempts = 0;
let _reconnectTimer    = null;

// Map<userId, { x, y, tool, displayName, avatarUrl, color, updatedAt }>
const _presence = new Map();

// ────────────────────────────────────────────────────────────────────
// Connect / Disconnect
// ────────────────────────────────────────────────────────────────────

async function connect(projectId, engine, userId, displayName, avatarUrl) {
    _projectId   = projectId;
    _engine      = engine;
    _userId      = userId || 'anon-' + Math.random().toString(36).slice(2, 8);
    _displayName = displayName || 'Anonymous';
    _avatarUrl   = avatarUrl || null;
    _color       = _userColor(_userId);
    _isConnected = false;

    _presence.clear();

    const channelName = `project:${projectId}`;

    _channel = supabase.channel(channelName, {
        config: { presence: { key: _userId } }
    });

    // ── Presence (cursor positions + online users) ──────────────
    _channel.on('presence', { event: 'sync' }, () => {
        const state = _channel.presenceState();
        _presence.clear();
        for (const uid of Object.keys(state)) {
            if (uid === _userId) continue;
            const latest = state[uid][state[uid].length - 1];
            _presence.set(uid, latest);
        }
        _updatePresenceUI();
    });

    _channel.on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === _userId) return;
        _presence.set(key, newPresences[newPresences.length - 1]);
        _updatePresenceUI();
    });

    _channel.on('presence', { event: 'leave' }, ({ key }) => {
        _presence.delete(key);
        _updatePresenceUI();
        // Remove cursor from canvas
        if (_engine) _engine.render();
    });

    // ── Broadcast ops ────────────────────────────────────────────
    _channel.on('broadcast', { event: 'op' }, ({ payload }) => {
        if (!payload || payload.userId === _userId) return;
        _applyRemoteOp(payload);
    });

    // ── Postgres Changes — snapshot sync ─────────────────────────
    _channel.on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'project_elements', filter: `project_id=eq.${projectId}` },
        async (payload) => {
            // Another user saved a full snapshot — re-load elements if version is newer
            const remoteVersion = payload.new?.version ?? 0;
            const localVersion  = _engine?._collabVersion ?? 0;
            if (remoteVersion > localVersion + 1 && _engine) {
                // We're behind by more than 1 version — do a full reload
                await _applyFullSnapshot(payload.new?.elements ?? []);
            }
        }
    );

    // Subscribe
    await new Promise((resolve, reject) => {
        _channel.subscribe(async (status) => {
            if (status === 'SUBSCRIBED') {
                _isConnected    = true;
                _reconnectAttempts = 0;
                console.log('[Collab] Connected to', channelName);

                // Announce presence
                await _channel.track({
                    userId:      _userId,
                    displayName: _displayName,
                    avatarUrl:   _avatarUrl,
                    color:       _color,
                    tool:        _engine?.currentTool ?? 'move',
                    x: 0, y: 0,
                    updatedAt:   Date.now(),
                });
                resolve();
            } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                console.warn('[Collab] Channel error:', status);
                _isConnected = false;
                _scheduleReconnect();
                reject(new Error('Collab channel error: ' + status));
            } else if (status === 'CLOSED') {
                _isConnected = false;
                _scheduleReconnect();
            }
        });
    }).catch(e => console.warn('[Collab] Subscribe error:', e));
}

async function disconnect() {
    clearTimeout(_reconnectTimer);
    clearTimeout(_snapshotTimer);
    _presence.clear();
    _isConnected = false;

    if (_channel) {
        await _channel.untrack();
        await supabase.removeChannel(_channel);
        _channel = null;
    }
    console.log('[Collab] Disconnected.');
    _updatePresenceUI();
}

// ────────────────────────────────────────────────────────────────────
// Broadcast helpers
// ────────────────────────────────────────────────────────────────────

/**
 * Broadcast a canvas operation.
 * type: 'element_add' | 'element_update' | 'element_delete' | 'element_reorder'
 */
function broadcastOp(type, payload) {
    if (!_isConnected || !_channel || _isViewOnly) return;
    _channel.send({
        type:    'broadcast',
        event:   'op',
        payload: { type, userId: _userId, ts: Date.now(), ...payload },
    }).catch(() => {});

    // Schedule full-snapshot save (debounced)
    clearTimeout(_snapshotTimer);
    _snapshotTimer = setTimeout(() => _saveSnapshot(), SNAPSHOT_DEBOUNCE_MS);
}

/**
 * Broadcast cursor position (throttled to 30 fps).
 * worldX, worldY: canvas world coordinates.
 */
function broadcastCursor(worldX, worldY) {
    if (!_isConnected || !_channel) return;
    const now = Date.now();
    if (now - _lastCursorSend < CURSOR_THROTTLE_MS) return;
    _lastCursorSend = now;

    _channel.track({
        userId:      _userId,
        displayName: _displayName,
        avatarUrl:   _avatarUrl,
        color:       _color,
        tool:        _engine?.currentTool ?? 'move',
        x:           worldX,
        y:           worldY,
        updatedAt:   now,
    }).catch(() => {});
}

// ────────────────────────────────────────────────────────────────────
// Apply remote operations
// ────────────────────────────────────────────────────────────────────

function _applyRemoteOp(op) {
    if (!_engine) return;
    const { type, elementId, element, changes, elementIds, newOrder } = op;

    switch (type) {
        case 'element_add': {
            if (!element || _engine.elements.find(e => e.id === element.id)) break;
            _engine.elements.push({ ...element, _v: op.ts });
            _engine.render();
            break;
        }
        case 'element_update': {
            const el = _engine.elements.find(e => e.id === elementId);
            if (!el) break;
            // Last-Write-Wins: only apply if remote ts is newer
            if (op.ts >= (el._v || 0)) {
                Object.assign(el, changes);
                el._v = op.ts;
                _engine.render();
            }
            break;
        }
        case 'element_delete': {
            const idx = _engine.elements.findIndex(e => e.id === elementId);
            if (idx !== -1) {
                _engine.elements.splice(idx, 1);
                // Deselect if removed element was selected
                _engine.selectedElements = (_engine.selectedElements || [])
                    .filter(e => e.id !== elementId);
                _engine.render();
            }
            break;
        }
        case 'element_reorder': {
            if (!elementIds || !newOrder) break;
            const elMap = new Map(_engine.elements.map(e => [e.id, e]));
            const reordered = newOrder.map(id => elMap.get(id)).filter(Boolean);
            // Rebuild elements array preserving non-reordered elements
            const kept = _engine.elements.filter(e => !new Set(newOrder).has(e.id));
            _engine.elements = [...reordered, ...kept];
            _engine.render();
            break;
        }
        default:
            break;
    }
}

async function _applyFullSnapshot(rawElements) {
    if (!_engine || !window.ProjectManager?._deserializeElements) return;
    try {
        const elements = await window.ProjectManager._deserializeElements(rawElements);
        _engine.elements = elements;
        _engine.render();
        console.log('[Collab] Applied full snapshot,', elements.length, 'elements.');
    } catch (e) {
        console.warn('[Collab] Failed to apply snapshot:', e);
    }
}

async function _saveSnapshot() {
    if (!_engine || !window.ProjectManager || !_projectId) return;
    try {
        await window.ProjectManager.save(
            _projectId,
            window.getProjectName?.() || 'Untitled Project',
            _engine.elements,
            _engine.viewport,
            _engine.canvas
        );
    } catch (e) {
        console.warn('[Collab] Snapshot save failed:', e);
    }
}

// ────────────────────────────────────────────────────────────────────
// Presence UI
// ────────────────────────────────────────────────────────────────────

function _updatePresenceUI() {
    const container = document.getElementById('collab-presence');
    if (!container) return;

    const users = [..._presence.values()].slice(0, 5); // show max 5 avatars
    const total  = _presence.size;

    if (!users.length) {
        container.innerHTML = '';
        return;
    }

    container.innerHTML = users.map(u => {
        const initials = (u.displayName || 'A').slice(0, 2).toUpperCase();
        const title = u.displayName || 'Collaborator';
        if (u.avatarUrl) {
            return `<img class="collab-avatar" src="${u.avatarUrl}" alt="${title}" title="${title}"
                         style="border-color:${u.color || '#888'}">`;
        }
        return `<div class="collab-avatar collab-avatar-initials" title="${title}"
                     style="background:${u.color || '#888'}">${initials}</div>`;
    }).join('') + (total > 5 ? `<div class="collab-avatar collab-avatar-more">+${total - 5}</div>` : '');

    // Also trigger canvas re-render for cursor overlays
    if (_engine) _engine.render();
}

// ────────────────────────────────────────────────────────────────────
// Reconnection (Phase 6)
// ────────────────────────────────────────────────────────────────────

function _scheduleReconnect() {
    if (_reconnectAttempts >= 8) {
        console.warn('[Collab] Max reconnect attempts reached. Giving up.');
        return;
    }
    const delay = Math.min(1000 * Math.pow(2, _reconnectAttempts), 30000);
    _reconnectAttempts++;
    console.log(`[Collab] Reconnecting in ${delay}ms (attempt ${_reconnectAttempts})…`);
    _reconnectTimer = setTimeout(async () => {
        if (_projectId && _engine && _userId) {
            try {
                await connect(_projectId, _engine, _userId, _displayName, _avatarUrl);
            } catch { _scheduleReconnect(); }
        }
    }, delay);
}

// ────────────────────────────────────────────────────────────────────
// Offline / Online detection (Phase 6)
// ────────────────────────────────────────────────────────────────────

window.addEventListener('online', () => {
    if (!_isConnected && _projectId) {
        console.log('[Collab] Network restored — reconnecting…');
        _reconnectAttempts = 0;
        connect(_projectId, _engine, _userId, _displayName, _avatarUrl).catch(() => {});
    }
});

window.addEventListener('offline', () => {
    console.log('[Collab] Network lost — operating in offline mode.');
    _isConnected = false;
    _updatePresenceUI();
});

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

window.CollabManager = {
    connect,
    disconnect,
    broadcastOp,
    broadcastCursor,
    getPresence: () => new Map(_presence),
    isConnected: () => _isConnected,
    setViewOnly: (v) => { _isViewOnly = v; },
    getUserColor: _userColor,
};
