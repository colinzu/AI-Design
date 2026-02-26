/**
 * canvas-layers.js
 * Layers panel — shows engine.elements as a hierarchical list.
 * Supports: search, selection sync, visibility toggle, lock, reorder (drag), rename.
 */

(function () {
    // ── State ──────────────────────────────────────────────────────────────────
    let _engine     = null;
    let _collapsed  = new Set();   // frame IDs (el._lid) that are collapsed
    let _hidden     = new Set();   // element IDs that are hidden
    let _locked     = new Set();   // element IDs that are locked
    let _dragSrc    = null;        // element being dragged
    let _rafPending = false;
    let _searchQuery = '';         // current search filter

    // Lightweight unique id on each element (assigned lazily)
    let _nextLid = 1;
    function lid(el) {
        if (!el._lid) el._lid = _nextLid++;
        return el._lid;
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    function init() {
        _engine = window.canvasEngine;
        if (!_engine) { setTimeout(init, 100); return; }

        // Open/close button
        const btn = document.querySelector('.sidebar-btn[data-action="layers"]');
        if (btn) btn.addEventListener('click', e => { e.stopPropagation(); togglePanel(); });

        // Collapse button inside panel
        const collapseBtn = document.getElementById('layers-collapse-btn');
        if (collapseBtn) collapseBtn.addEventListener('click', closePanel);

        // Search input
        const searchInput = document.getElementById('layers-search');
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                _searchQuery = searchInput.value.trim().toLowerCase();
                renderList();
            });
            searchInput.addEventListener('keydown', e => e.stopPropagation());
        }

        // Close when clicking outside the panel (canvas clicks also close it, like Inspiration)
        // Row clicks use e.stopPropagation() so they never reach this listener.
        document.addEventListener('click', e => {
            const panel = document.getElementById('layers-panel');
            if (!panel || panel.classList.contains('hidden')) return;
            const btn = document.querySelector('.sidebar-btn[data-action="layers"]');
            // If click is inside panel or on the toggle button, keep open
            if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
            closePanel();
        });

        // Hook into engine so panel refreshes after every render
        const origRender = _engine.render.bind(_engine);
        _engine.render = function (...args) {
            origRender(...args);
            scheduleRefresh();
        };

        // Also hook saveState so undo/redo refreshes the panel
        const origSave = _engine.saveState.bind(_engine);
        _engine.saveState = function (...args) {
            origSave(...args);
            scheduleRefresh();
        };

        // Intercept other sidebar buttons so they close the layers panel
        document.querySelectorAll('.sidebar-btn:not([data-action="layers"])').forEach(otherBtn => {
            otherBtn.addEventListener('click', () => {
                const panel = document.getElementById('layers-panel');
                if (panel && !panel.classList.contains('hidden')) closePanel();
            }, true); // capture phase so it fires before stopPropagation
        });

        patchRenderElement();
        console.log('[layers] Layers panel initialized');
    }

    function scheduleRefresh() {
        if (_rafPending) return;
        _rafPending = true;
        requestAnimationFrame(() => {
            _rafPending = false;
            const panel = document.getElementById('layers-panel');
            if (!panel || panel.classList.contains('hidden')) return;
            renderList();
        });
    }

    // ── Panel open/close ───────────────────────────────────────────────────────
    function togglePanel() {
        const panel = document.getElementById('layers-panel');
        if (!panel) return;
        if (panel.classList.contains('hidden')) openPanel();
        else closePanel();
    }

    function openPanel() {
        const panel = document.getElementById('layers-panel');
        const btn   = document.querySelector('.sidebar-btn[data-action="layers"]');
        if (!panel) return;

        // Close inspiration panel properly via its public API
        if (window.InspPanel && window.InspPanel.isOpen()) {
            window.InspPanel.close();
        }

        // Deactivate all other sidebar buttons first (mutual exclusion)
        document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));
        panel.classList.remove('hidden');
        if (btn) btn.classList.add('active');
        document.body.classList.add('layers-open');
        renderList();
    }

    function closePanel() {
        const panel = document.getElementById('layers-panel');
        const btn   = document.querySelector('.sidebar-btn[data-action="layers"]');
        if (!panel) return;
        panel.classList.add('hidden');
        if (btn) btn.classList.remove('active');
        document.body.classList.remove('layers-open');
    }

    // ── Rendering ──────────────────────────────────────────────────────────────
    function renderList() {
        const list = document.getElementById('layers-list');
        if (!list || !_engine) return;

        const elements = _engine.elements;
        if (!elements || elements.length === 0) {
            list.innerHTML = '<div class="layers-empty">No layers yet.<br>Add frames or elements to get started.</div>';
            return;
        }

        // Rebuild index map for this render pass (numbering unnamed duplicates)
        _indexMap = buildIndexMap(elements);

        // Build tree: top-level items in reverse z-order (topmost first, like Figma)
        const rows = [];
        buildTree(elements, rows);

        // Apply search filter
        const filtered = _searchQuery
            ? rows.filter(({ el }) => getLabel(el, elements).toLowerCase().includes(_searchQuery))
            : rows;

        if (filtered.length === 0) {
            list.innerHTML = `<div class="layers-empty">No layers match "<em>${_searchQuery}</em>".</div>`;
            return;
        }

        // Render rows
        const frag = document.createDocumentFragment();
        filtered.forEach(({ el, depth }) => {
            frag.appendChild(buildRow(el, depth, elements));
        });

        list.innerHTML = '';
        list.appendChild(frag);
    }

    /**
     * Build a flat list of { el, depth } in display order (top of stack = top of list).
     * Frames show their children indented below them when expanded.
     * Top-level order: reverse of elements array (last = topmost = first in list).
     */
    function buildTree(elements, rows) {
        const topLevel = [];
        for (let i = elements.length - 1; i >= 0; i--) {
            const el = elements[i];
            if (!el.parentFrame) topLevel.push(el);
        }

        topLevel.forEach(el => {
            rows.push({ el, depth: 0 });

            if (el.type === 'frame') {
                const children = [];
                for (let i = elements.length - 1; i >= 0; i--) {
                    const c = elements[i];
                    if (c.parentFrame === el) children.push(c);
                }
                if (!_collapsed.has(lid(el))) {
                    children.forEach(c => rows.push({ el: c, depth: 1 }));
                }
            }
        });
    }

    function buildRow(el, depth, allElements) {
        const isSelected  = _engine.selectedElements && _engine.selectedElements.includes(el);
        const isHidden    = _hidden.has(lid(el)) || !!el._hidden;
        const isLocked    = _locked.has(lid(el)) || !!el._locked;
        const isFrame     = el.type === 'frame';
        const hasChildren = isFrame && _engine.elements.some(c => c.parentFrame === el);
        const isExpanded  = isFrame && !_collapsed.has(lid(el));

        const row = document.createElement('div');
        row.className = 'layer-row' +
            (isSelected ? ' selected' : '') +
            (isHidden   ? ' hidden-layer' : '') +
            (isLocked   ? ' locked-layer' : '');
        row.dataset.depth = depth;
        row.dataset.lid   = lid(el);

        // ── Expand arrow ──
        const expand = document.createElement('div');
        expand.className = 'layer-expand' +
            (hasChildren ? (isExpanded ? ' expanded' : '') : ' leaf');
        expand.innerHTML = `<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <path d="M3 2L7 5L3 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`;
        if (hasChildren) {
            expand.addEventListener('click', e => {
                e.stopPropagation();
                if (_collapsed.has(lid(el))) _collapsed.delete(lid(el));
                else _collapsed.add(lid(el));
                renderList();
            });
        }

        // ── Thumbnail ──
        const thumb = document.createElement('div');
        thumb.className = 'layer-thumb';
        thumb.appendChild(makeThumb(el));

        // ── Name ──
        const name = document.createElement('div');
        name.className = 'layer-name';
        name.textContent = getLabel(el, allElements);
        name.title = name.textContent;

        name.addEventListener('dblclick', e => {
            e.stopPropagation();
            startRename(row, el, name);
        });

        // ── Action buttons ──
        // Logic: show all 3 on hover/selected. But if a state is active (locked/hidden),
        // that single button is always visible regardless of hover.
        const actions = document.createElement('div');
        actions.className = 'layer-actions';

        // Settings placeholder
        const settingsBtn = document.createElement('button');
        settingsBtn.className = 'layer-action-btn layer-action-settings';
        settingsBtn.title = 'Settings';
        settingsBtn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>`;
        // No click handler — placeholder only

        // Lock toggle
        const lockBtn = document.createElement('button');
        // active-state button is always visible; inactive ones rely on row hover/select via CSS
        lockBtn.className = 'layer-action-btn layer-action-lock' + (isLocked ? ' state-active' : '');
        lockBtn.title = isLocked ? 'Unlock' : 'Lock';
        lockBtn.innerHTML = isLocked
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
               </svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
               </svg>`;
        lockBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleLock(el);
        });

        // Visibility toggle
        const visBtn = document.createElement('button');
        visBtn.className = 'layer-action-btn layer-action-vis' + (isHidden ? ' state-active' : '');
        visBtn.title = isHidden ? 'Show' : 'Hide';
        visBtn.innerHTML = isHidden
            ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
               </svg>`
            : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
               </svg>`;
        visBtn.addEventListener('click', e => {
            e.stopPropagation();
            toggleVisibility(el);
        });

        actions.appendChild(settingsBtn);
        actions.appendChild(lockBtn);
        actions.appendChild(visBtn);
        row.appendChild(expand);
        row.appendChild(thumb);
        row.appendChild(name);
        row.appendChild(actions);

        // ── Row click: select ──
        row.addEventListener('click', e => {
            e.stopPropagation(); // prevent document outside-click listener from closing the panel
            if (e.target.closest('.layer-expand') || e.target.closest('.layer-action-btn')) return;
            selectElement(el, e.shiftKey || e.metaKey || e.ctrlKey);
        });

        // ── Drag-to-reorder ──
        row.draggable = true;
        row.addEventListener('dragstart', e => {
            _dragSrc = el;
            row.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
            _dragSrc = null;
            row.classList.remove('dragging');
            document.querySelectorAll('.layer-row').forEach(r => {
                r.classList.remove('drag-over-top', 'drag-over-bottom');
            });
        });
        row.addEventListener('dragover', e => {
            if (!_dragSrc || _dragSrc === el) return;
            e.preventDefault();
            const rect = row.getBoundingClientRect();
            const half = rect.top + rect.height / 2;
            row.classList.remove('drag-over-top', 'drag-over-bottom');
            row.classList.add(e.clientY < half ? 'drag-over-top' : 'drag-over-bottom');
        });
        row.addEventListener('dragleave', () => {
            row.classList.remove('drag-over-top', 'drag-over-bottom');
        });
        row.addEventListener('drop', e => {
            e.preventDefault();
            if (!_dragSrc || _dragSrc === el) return;
            const rect = row.getBoundingClientRect();
            const before = e.clientY < rect.top + rect.height / 2;
            reorderElement(_dragSrc, el, before);
            row.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        return row;
    }

    // ── Thumbnails ─────────────────────────────────────────────────────────────
    function makeThumb(el) {
        // Frames: always use the frame icon (not image thumbnail — child images are listed below)
        if (el.type === 'frame') {
            return toolbarIcon('assets/images/Frame.svg');
        }

        // Image element: show photo thumbnail
        if (el.type === 'image' && el.image) {
            try {
                const THUMB = 24;
                const iw = el.image.naturalWidth, ih = el.image.naturalHeight;
                if (iw > 0 && ih > 0) {
                    const tc = document.createElement('canvas');
                    tc.width = THUMB; tc.height = THUMB;
                    const tctx = tc.getContext('2d');
                    const scale = Math.max(THUMB / iw, THUMB / ih);
                    const sw = THUMB / scale, sh = THUMB / scale;
                    const sx = (iw - sw) / 2, sy = (ih - sh) / 2;
                    tctx.drawImage(el.image, sx, sy, sw, sh, 0, 0, THUMB, THUMB);
                    const img = document.createElement('img');
                    img.src = tc.toDataURL('image/jpeg', 0.7);
                    return img;
                }
            } catch (_) { /* tainted canvas — fall through */ }
        }

        // Shape: per-type icon matching the toolbar shape menu
        if (el.type === 'shape') {
            return shapeIcon(el.shapeType || 'rectangle');
        }

        if (el.type === 'text') {
            return toolbarIcon('assets/images/Text.svg');
        }

        if (el.type === 'path') {
            return toolbarIcon('assets/images/Pencil.svg');
        }

        // Default
        return svgIcon(`<circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8" fill="none"/>`);
    }

    function toolbarIcon(src) {
        const img = document.createElement('img');
        img.src = src;
        img.width = 16;
        img.height = 16;
        img.style.cssText = 'width:16px;height:16px;object-fit:contain;opacity:0.55;';
        return img;
    }

    /**
     * Per-shape icon matching the toolbar shape-menu SVGs (stroke-based, no fill).
     * Uses exact same paths/shapes as canvas.html shape menu items.
     */
    function shapeIcon(shapeType) {
        let inner;
        switch (shapeType) {
            case 'ellipse':
                inner = `<ellipse cx="8" cy="8" rx="6" ry="6" stroke="currentColor" stroke-width="1.5"/>`;
                break;
            case 'triangle':
                inner = `<path d="M8 2L14.5 14H1.5L8 2Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`;
                break;
            case 'star':
                inner = `<path d="M8 2l1.6 4 4.4.3-3.2 2.8 1 4.3L8 11.2l-3.8 2.2 1-4.3L2 6.3l4.4-.3z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`;
                break;
            case 'line':
                inner = `<line x1="2.5" y1="13.5" x2="13.5" y2="2.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`;
                break;
            case 'rectangle':
            default:
                inner = `<rect x="2" y="2" width="12" height="12" rx="1.2" stroke="currentColor" stroke-width="1.5"/>`;
                break;
        }
        const w = document.createElement('div');
        w.style.cssText = 'width:16px;height:16px;display:flex;align-items:center;justify-content:center;flex-shrink:0;opacity:0.55;';
        w.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">${inner}</svg>`;
        return w;
    }

    function svgIcon(inner) {
        const w = document.createElement('div');
        w.style.cssText = 'width:16px;height:16px;display:flex;align-items:center;justify-content:center;';
        w.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none">${inner}</svg>`;
        return w;
    }

    // ── Labels ─────────────────────────────────────────────────────────────────
    /**
     * Build a sequential index map for elements that share the same type-based fallback label.
     * E.g. two unnamed Image elements become "Image 1", "Image 2".
     * allElements is the full engine.elements array for consistent numbering.
     */
    function buildIndexMap(allElements) {
        // Count per base-label across the entire elements list (in z-order)
        const counter = {};
        const map = new Map(); // el → index number (1-based)
        for (const el of allElements) {
            if (el.name) continue; // named elements don't need numbering
            const base = baseLabel(el);
            counter[base] = (counter[base] || 0) + 1;
            map.set(el, counter[base]);
        }
        // If a base label only appears once, don't show a number
        const totals = {};
        for (const el of allElements) {
            if (el.name) continue;
            const base = baseLabel(el);
            totals[base] = (totals[base] || 0) + 1;
        }
        // Keep only entries where total > 1
        for (const el of allElements) {
            if (totals[baseLabel(el)] <= 1) map.delete(el);
        }
        return map;
    }

    // Index map is rebuilt once per renderList() call and shared across all getLabel calls in that render
    let _indexMap = null;

    function getLabel(el, allElements) {
        if (el.name) return el.name;

        // Image: try AI-cached label first
        if (el.type === 'image') {
            const aiLabel = window.GenPanel && window.GenPanel.getImageLabel
                ? window.GenPanel.getImageLabel(el) : null;
            if (aiLabel) return aiLabel;
        }

        // Index map is guaranteed fresh (set by renderList before building rows)
        const base = baseLabel(el);
        const idx  = _indexMap ? _indexMap.get(el) : undefined;
        return idx ? `${base} ${idx}` : base;
    }

    function baseLabel(el) {
        if (el.type === 'frame') return 'Frame';
        if (el.type === 'image') return 'Image';
        if (el.type === 'text')  return (el.text || '').slice(0, 24).trim() || 'Text';
        if (el.type === 'shape') {
            const map = { rectangle: 'Rectangle', ellipse: 'Ellipse', line: 'Line', triangle: 'Triangle', star: 'Star' };
            return map[el.shapeType] || 'Shape';
        }
        if (el.type === 'path') return 'Path';
        return 'Layer';
    }

    // ── Selection ──────────────────────────────────────────────────────────────
    function selectElement(el, additive) {
        if (!_engine) return;
        if (additive) {
            const idx = _engine.selectedElements.indexOf(el);
            if (idx === -1) _engine.selectedElements.push(el);
            else _engine.selectedElements.splice(idx, 1);
        } else {
            _engine.selectedElements = [el];
        }
        _engine.render();
        if (_engine.onSelectionChange) _engine.onSelectionChange(_engine.selectedElements);
        scrollCanvasToElement(el);
        renderList();
    }

    function scrollCanvasToElement(el) {
        if (!_engine) return;
        const cx = (el.x || 0) + (el.width || 0) / 2;
        const cy = (el.y || 0) + (el.height || 0) / 2;
        const rect = _engine.canvas.getBoundingClientRect();
        _engine.viewport.x = rect.width  / 2 - cx * _engine.viewport.scale;
        _engine.viewport.y = rect.height / 2 - cy * _engine.viewport.scale;
        _engine.render();
    }

    // ── Visibility ─────────────────────────────────────────────────────────────
    function toggleVisibility(el) {
        const id = lid(el);
        if (_hidden.has(id)) {
            _hidden.delete(id);
            el._hidden = false;
        } else {
            _hidden.add(id);
            el._hidden = true;
        }
        _engine.render();
        renderList();
    }

    // ── Lock ───────────────────────────────────────────────────────────────────
    function toggleLock(el) {
        const id = lid(el);
        if (_locked.has(id)) {
            _locked.delete(id);
            el._locked = false;
        } else {
            _locked.add(id);
            el._locked = true;
        }
        renderList();
    }

    // Patch engine's renderElement to skip hidden elements
    function patchRenderElement() {
        if (!_engine || _engine._layerPatchApplied) return;
        _engine._layerPatchApplied = true;
        const orig = _engine.renderElement.bind(_engine);
        _engine.renderElement = function(el, ...args) {
            if (el._hidden) return;
            return orig(el, ...args);
        };
    }

    // ── Rename ─────────────────────────────────────────────────────────────────
    function startRename(row, el, nameEl) {
        const input = document.createElement('input');
        input.type = 'text';
        input.value = el.name || baseLabel(el);
        input.style.cssText = `
            flex:1; font-size:12.5px; border:none; outline:none;
            background: rgba(0,153,184,0.08); border-radius:4px;
            padding: 2px 6px; color:#073247; min-width:0;
        `;
        nameEl.replaceWith(input);
        input.focus();
        input.select();

        function commit() {
            const val = input.value.trim();
            if (val) el.name = val;
            renderList();
        }
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter') { e.preventDefault(); commit(); }
            if (e.key === 'Escape') { renderList(); }
            e.stopPropagation();
        });
    }

    // ── Reorder (drag-and-drop) ────────────────────────────────────────────────
    function reorderElement(src, target, beforeInList) {
        if (!_engine) return;
        const els = _engine.elements;
        const si = els.indexOf(src);
        const ti = els.indexOf(target);
        if (si === -1 || ti === -1) return;

        _engine.saveState();
        els.splice(si, 1);
        const ti2 = els.indexOf(target);
        const insertAt = beforeInList ? ti2 + 1 : ti2;
        els.splice(Math.max(0, insertAt), 0, src);

        _engine.render();
        renderList();
    }

    // ── Boot ───────────────────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
    } else {
        setTimeout(init, 200);
    }
})();
