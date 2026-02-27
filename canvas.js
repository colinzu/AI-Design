/**
 * Canvas Page Initialization and UI Integration
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('infinite-canvas');
    const engine = new CanvasEngine(canvas);

    // ==================== Project Persistence ====================

    // Determine project ID from URL, or generate a new one
    const urlParams = new URLSearchParams(window.location.search);
    let projectId = urlParams.get('id');
    if (!projectId) {
        projectId = ProjectManager.generateId();
        window.history.replaceState({}, '', window.location.pathname + '?id=' + projectId);
    }

    let _isLoadingProject = false;
    let _autosaveTimer = null;  // must be declared here so scheduleAutosave & beforeunload share it
    let _pendingVisibilitySave = false;

    function getProjectName() {
        return projectNameInput ? projectNameInput.value.trim() || 'Untitled Project' : 'Untitled Project';
    }

    function scheduleAutosave() {
        if (_isLoadingProject) return;
        clearTimeout(_autosaveTimer);
        _autosaveTimer = setTimeout(async () => {
            await ProjectManager.save(projectId, getProjectName(), engine.elements, engine.viewport, engine.canvas);
        }, 1500);
    }

    // Hook into engine.saveState so every undo-able action triggers auto-save
    const _origSaveState = engine.saveState.bind(engine);
    engine.saveState = function (...args) {
        _origSaveState(...args);
        scheduleAutosave();
    };

    // ── Primary save-on-hide: fires when tab loses focus, user switches away, or
    // the browser is about to unload the page.  Unlike beforeunload, this fires
    // early enough for async IndexedDB writes to complete.
    // This handles Cmd+R, Cmd+W, tab switching, and most navigation cases.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        if (_isLoadingProject) return;
        clearTimeout(_autosaveTimer);
        _pendingVisibilitySave = true;
        ProjectManager.save(projectId, getProjectName(), engine.elements, engine.viewport, engine.canvas)
            .finally(() => { _pendingVisibilitySave = false; });
    });

    // ── Fallback for cases where visibilitychange doesn't fire reliably
    // (e.g. Cmd+Shift+R hard-refresh in some browsers).  saveAndForget uses the
    // already-serialised data path so it's as fast as possible synchronously.
    window.addEventListener('beforeunload', () => {
        if (_isLoadingProject) return;
        if (_pendingVisibilitySave) return; // visibilitychange already handled it
        clearTimeout(_autosaveTimer);
        ProjectManager.saveAndForget(projectId, getProjectName(), engine.elements, engine.viewport);
    });

    function applyViewport(viewport) {
        if (!viewport) return false;
        const { x: vx, y: vy, scale: vs } = viewport;
        if (vs && vs > 0 && (vx !== 0 || vy !== 0)) {
            engine.viewport.x = vx;
            engine.viewport.y = vy;
            engine.viewport.scale = vs;
            const testEl = engine.elements.find(e => e.x !== undefined && e.width !== undefined);
            if (testEl) {
                const s1 = engine.worldToScreen(testEl.x, testEl.y);
                const s2 = engine.worldToScreen(testEl.x + testEl.width, testEl.y + testEl.height);
                if (s2.x > 0 && s1.x < engine.cssWidth && s2.y > 0 && s1.y < engine.cssHeight) {
                    return true;
                }
            } else {
                return true;
            }
        }
        return false;
    }

    async function initProject() {
        _isLoadingProject = true;
        try {
            const project = await ProjectManager.load(projectId);
            if (!project || !project.elements || project.elements.length === 0) return;

            engine.elements = project.elements;
            if (!applyViewport(project.viewport)) engine.fitToScreen();
            if (projectNameInput && project.name) {
                projectNameInput.value = project.name;
                document.title = project.name + ' - AI Design';
            }
            engine.render();
        } finally {
            _isLoadingProject = false;
        }
    }

    // ==================== Auth + Project Load ====================
    // getSession() reads from local storage (no network round-trip), so auth
    // resolution is fast and does not delay the initial canvas render.
    // Expose getProjectName for CollabManager snapshot saves
    window.getProjectName = getProjectName;

    (async () => {
        // Resolve auth first (uses local session cache — very fast)
        let _currentUser = null;
        if (typeof getCurrentUser === 'function') {
            try {
                _currentUser = await getCurrentUser();
                if (_currentUser?.id) await ProjectManager.setUserId(_currentUser.id);
            } catch { }
        }

        // Handle share link token (Phase 4) — check before project load
        const shareToken = urlParams.get('share');
        if (shareToken) {
            try {
                const res = await fetch(`/api/share?token=${encodeURIComponent(shareToken)}`);
                const data = await res.json();
                if (data.valid && data.role === 'viewer') {
                    window.CollabManager?.setViewOnly(true);
                    // Show view-only banner
                    const banner = document.createElement('div');
                    banner.id = 'view-only-banner';
                    banner.style.cssText = 'position:fixed;top:44px;left:50%;transform:translateX(-50%);z-index:9999;background:#1e293b;color:#94a3b8;font-size:12px;padding:5px 14px;border-radius:0 0 8px 8px;pointer-events:none;';
                    banner.textContent = 'View only — you cannot edit this project';
                    document.body.appendChild(banner);
                }
            } catch { /* ignore share validation errors */ }
        }

        // Load project (cloud or IndexedDB)
        await initProject();

        // Resume any generation that was interrupted by a page refresh
        if (projectId && window.GenPanel && window.GenPanel.resumePending) {
            // Delay slightly so canvas-gen.js has time to finish initialising
            setTimeout(() => {
                if (window.GenPanel && window.GenPanel.resumePending) {
                    window.GenPanel.resumePending(projectId);
                }
            }, 400);
        }

        // Auto-generation from homepage prompt
        const autoGen = urlParams.get('autoGen');
        if (autoGen === '1') {
            const promptKey = 'aime_autostart_' + projectId;
            const raw = localStorage.getItem(promptKey);
            if (raw) {
                localStorage.removeItem(promptKey);
                try {
                    const { text } = JSON.parse(raw);
                    if (text) {
                        // Wait for GenPanel to be initialized (canvas-gen.js bootstraps async)
                        const waitAndGenerate = () => {
                            if (window.GenPanel && window.GenPanel.triggerAutoGeneration) {
                                window.GenPanel.triggerAutoGeneration(text);
                            } else {
                                setTimeout(waitAndGenerate, 100);
                            }
                        };
                        setTimeout(waitAndGenerate, 200);
                    }
                } catch { /* ignore */ }
            }
        }

        // ── Phase 5: Start real-time collaboration ─────────────────────────────
        if (_currentUser?.id && window.CollabManager) {
            const meta = _currentUser.user_metadata || {};
            window.CollabManager.connect(
                projectId, engine,
                _currentUser.id,
                meta.full_name || meta.name || _currentUser.email,
                meta.avatar_url || null
            ).catch(e => console.warn('[Canvas] Collab connect failed:', e));
        }

        // ── Phase 5: Broadcast canvas operations ─────────────────────────────
        // Wrap engine.saveState to capture element diffs and broadcast to peers.
        const _origSaveState2 = engine.saveState.bind(engine);
        engine.saveState = function (...args) {
            if (!window.CollabManager?.isConnected()) { _origSaveState2(...args); return; }

            // Snapshot IDs + positions BEFORE the state save
            const prevIds    = new Set(engine.elements.map(e => e.id));
            const prevStates = {};
            engine.elements.forEach(e => {
                prevStates[e.id] = {
                    x: e.x, y: e.y, width: e.width, height: e.height,
                    rotation: e.rotation, src: e.src, text: e.text,
                };
            });

            _origSaveState2(...args);

            // Broadcast diffs AFTER the state save
            const now = Date.now();
            engine.elements.forEach(el => {
                if (!prevIds.has(el.id)) {
                    const { image, ...elData } = el;
                    window.CollabManager.broadcastOp('element_add', { element: { ...elData, _v: now } });
                } else {
                    const prev = prevStates[el.id];
                    if (prev && (el.x !== prev.x || el.y !== prev.y ||
                        el.width !== prev.width || el.height !== prev.height ||
                        el.rotation !== prev.rotation || el.src !== prev.src || el.text !== prev.text)) {
                        window.CollabManager.broadcastOp('element_update', {
                            elementId: el.id,
                            changes: {
                                x: el.x, y: el.y, width: el.width, height: el.height,
                                rotation: el.rotation, src: el.src, text: el.text, _v: now,
                            },
                        });
                    }
                }
            });
            prevIds.forEach(id => {
                if (!engine.elements.find(e => e.id === id)) {
                    window.CollabManager.broadcastOp('element_delete', { elementId: id });
                }
            });
        };

        // ── Phase 5: Broadcast cursor position on mouse move ───────────────────
        canvas.addEventListener('mousemove', (e) => {
            if (!window.CollabManager?.isConnected()) return;
            const rect = canvas.getBoundingClientRect();
            const worldX = (e.clientX - rect.left - engine.viewport.x) / engine.viewport.scale;
            const worldY = (e.clientY - rect.top  - engine.viewport.y) / engine.viewport.scale;
            window.CollabManager.broadcastCursor(worldX, worldY);
        }, { passive: true });

        // After project loaded, sync ongoing auth state changes
        if (typeof onAuthStateChange === 'function') {
            onAuthStateChange(({ loggedIn, user }) => {
                const newId = loggedIn && user?.id ? user.id : 'guest';
                if (newId !== ProjectManager.getUserId()) {
                    ProjectManager.setUserId(newId);
                }
                updateCanvasAuthUI(loggedIn, user || null);
                // Reconnect collab when user changes
                if (loggedIn && user?.id && window.CollabManager) {
                    const meta = user.user_metadata || {};
                    window.CollabManager.connect(
                        projectId, engine, user.id,
                        meta.full_name || meta.name || user.email,
                        meta.avatar_url || null
                    ).catch(() => {});
                } else if (!loggedIn) {
                    window.CollabManager?.disconnect();
                }
            });
        }

        // Cross-tab: another tab changed account → save current work + show banner
        if (typeof listenForAuthBroadcast === 'function') {
            listenForAuthBroadcast(({ event, userId: broadcastUserId }) => {
                const isChange = event === 'SIGNED_OUT' ||
                    (event === 'SIGNED_IN' && broadcastUserId !== ProjectManager.getUserId());
                if (!isChange) return;
                clearTimeout(_autosaveTimer);
                const n = projectNameInput ? projectNameInput.value.trim() || 'Untitled Project' : 'Untitled Project';
                ProjectManager.saveAndForget(projectId, n, engine.elements, engine.viewport);
                showAuthSyncBanner(event === 'SIGNED_OUT' ? 'signed-out' : 'account-changed');
            });
        }
    })();

    function showAuthSyncBanner(reason) {
        if (document.getElementById('auth-sync-banner')) return;
        const msg = reason === 'signed-out'
            ? 'You signed out in another tab.'
            : 'Account changed in another tab.';
        const b = document.createElement('div');
        b.id = 'auth-sync-banner';
        b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#1a1a2e;color:#fff;padding:12px 20px;display:flex;align-items:center;justify-content:center;gap:16px;font-size:14px;font-family:Inter,sans-serif;box-shadow:0 2px 12px rgba(0,0,0,.3)';
        b.innerHTML = `<span>${msg} Your work has been saved.</span>
            <button onclick="location.reload()" style="background:#fff;color:#1a1a2e;border:none;border-radius:6px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer">Reload</button>
            <button onclick="this.parentElement.remove()" style="background:transparent;color:rgba(255,255,255,.6);border:none;font-size:20px;cursor:pointer;line-height:1">×</button>`;
        document.body.prepend(b);
    }

    // ==================== Project Menu ====================

    const logoMenuBtn = document.getElementById('logo-btn');
    const projectMenu = document.getElementById('project-menu');
    const projectNameInput = document.getElementById('project-name');

    // Sync document title and auto-save when project name changes
    if (projectNameInput) {
        projectNameInput.addEventListener('input', () => {
            document.title = (projectNameInput.value.trim() || 'Untitled Project') + ' - AI Design';
            scheduleAutosave();
        });
    }

    // Toggle project menu
    function toggleProjectMenu() {
        const isVisible = projectMenu.style.display !== 'none';
        projectMenu.style.display = isVisible ? 'none' : 'block';
    }

    logoMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleProjectMenu();
    });

    // Close menus when clicking outside
    const zoomMenu = document.getElementById('zoom-menu');
    const zoomDropdownBtn = document.getElementById('zoom-dropdown-btn');
    const shapeMenu = document.getElementById('shape-menu');
    const inspirationPanel = document.getElementById('inspiration-panel');
    const inspirationBtn = document.querySelector('.sidebar-btn[data-action="inspiration"]');

    document.addEventListener('click', (e) => {
        if (!projectMenu.contains(e.target) && e.target !== logoMenuBtn && !logoMenuBtn.contains(e.target)) {
            projectMenu.style.display = 'none';
        }
        if (zoomMenu && !zoomMenu.contains(e.target) && e.target !== zoomDropdownBtn && !zoomDropdownBtn.contains(e.target)) {
            zoomMenu.classList.add('hidden');
        }
        if (shapeMenu && !shapeMenu.contains(e.target)) {
            const rectangleBtn = document.querySelector('.tool-btn[data-tool="rectangle"]');
            if (!rectangleBtn || (!rectangleBtn.contains(e.target) && e.target !== rectangleBtn)) {
                shapeMenu.classList.add('hidden');
            }
        }
        // Auto-hide inspiration panel when clicking canvas blank area
        if (inspirationPanel && !inspirationPanel.classList.contains('hidden')) {
            // Check if click is outside panel and not on the inspiration button
            if (!inspirationPanel.contains(e.target) &&
                (!inspirationBtn || (!inspirationBtn.contains(e.target) && e.target !== inspirationBtn))) {
                // Close the panel
                inspirationPanel.classList.add('hidden');
                if (inspirationBtn) inspirationBtn.classList.remove('active');
                // Hide intent icon
                const intentIcon = document.getElementById('insp-intent-icon');
                if (intentIcon) intentIcon.classList.add('hidden');
            }
        }
    });

    // Project menu actions
    projectMenu.addEventListener('click', (e) => {
        const menuItem = e.target.closest('.menu-item');
        if (!menuItem) return;

        const action = menuItem.dataset.action;

        switch (action) {
            case 'go-home':
                window.location.href = 'index.html';
                break;
            case 'new-project':
                window.open('canvas.html', '_blank');
                break;
            case 'undo':
                engine.undo();
                break;
            case 'redo':
                engine.redo();
                break;
            case 'move-to-trash':
                if (confirm('Delete this project? This cannot be undone.')) {
                    ProjectManager.delete(projectId);
                    window.location.href = 'index.html';
                }
                break;
        }

        projectMenu.style.display = 'none';
    });

    // Recent Projects hover submenu
    const recentItem = document.getElementById('recent-projects-item');
    const recentSubmenu = document.getElementById('recent-projects-submenu');
    if (recentItem && recentSubmenu) {
        recentItem.addEventListener('mouseenter', async () => {
            let projects = [];
            if (typeof ProjectManager !== 'undefined') {
                try { projects = (await ProjectManager.getAll()).slice(0, 5); } catch { }
            }
            if (projects.length === 0) {
                recentSubmenu.innerHTML = '<div class="recent-submenu-empty">No recent projects</div>';
            } else {
                recentSubmenu.innerHTML = projects.map(p => `
                    <div class="recent-submenu-item" data-id="${p.id}">
                        ${p.thumbnail
                        ? `<img class="recent-submenu-thumb" src="${p.thumbnail}" alt="">`
                        : `<div class="recent-submenu-thumb recent-submenu-thumb-empty"></div>`}
                        <span class="recent-submenu-name">${escapeHtml(p.name || 'Untitled Project')}</span>
                    </div>
                `).join('');
                recentSubmenu.querySelectorAll('.recent-submenu-item').forEach(el => {
                    el.addEventListener('click', (e) => {
                        e.stopPropagation();
                        window.open('canvas.html?id=' + el.dataset.id, '_blank');
                        projectMenu.style.display = 'none';
                    });
                });
            }
            recentSubmenu.classList.add('open');
        });
        recentItem.addEventListener('mouseleave', () => {
            recentSubmenu.classList.remove('open');
        });
    }

    function escapeHtml(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // View toggles
    const pixelGridToggle = document.getElementById('toggle-pixel-grid');
    const rulersToggle = document.getElementById('toggle-rulers');
    const autoSnapToggle = document.getElementById('toggle-auto-snap');

    if (pixelGridToggle) {
        pixelGridToggle.addEventListener('change', (e) => {
            engine.togglePixelGrid();
        });
    }

    if (rulersToggle) {
        rulersToggle.addEventListener('change', (e) => {
            engine.toggleRulers();
        });
    }

    if (autoSnapToggle) {
        autoSnapToggle.addEventListener('change', (e) => {
            engine.toggleAutoSnap();
        });
    }

    // ==================== Zoom Controls ====================

    const zoomBarInput = document.getElementById('zoom-bar-input');

    if (zoomDropdownBtn) {
        zoomDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomMenu.classList.toggle('hidden');
            if (!zoomMenu.classList.contains('hidden')) {
                updateZoomDisplay();
                // Auto-focus input, select all digits
                if (zoomBarInput) {
                    setTimeout(() => {
                        zoomBarInput.focus();
                        zoomBarInput.select();
                    }, 50);
                }
            }
        });
    }

    // Zoom presets and actions
    if (zoomMenu) {
        zoomMenu.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.menu-item');
            const barBtn = e.target.closest('.zoom-bar-btn');

            if (barBtn) {
                const action = barBtn.dataset.zoomAction;
                if (action === 'in') {
                    engine.zoom(100, canvas.width / 2, canvas.height / 2);
                } else if (action === 'out') {
                    engine.zoom(-100, canvas.width / 2, canvas.height / 2);
                }
                updateZoomDisplay();
                return; // Don't close menu for bar buttons
            }

            if (!menuItem) return;

            const zoom = menuItem.dataset.zoom;
            const zoomAction = menuItem.dataset.zoomAction;

            if (zoomAction === 'in') {
                engine.zoom(100, canvas.width / 2, canvas.height / 2);
            } else if (zoomAction === 'out') {
                engine.zoom(-100, canvas.width / 2, canvas.height / 2);
            } else if (zoomAction === 'fit') {
                engine.fitToScreen();
            } else if (zoom) {
                engine.setZoom(parseFloat(zoom));
            }

            updateZoomDisplay();
            zoomMenu.classList.add('hidden');
        });
    }

    // Zoom bar input: only numbers, clamp to range
    if (zoomBarInput) {
        const minPct = Math.round(engine.viewport.minScale * 100);
        const maxPct = Math.round(engine.viewport.maxScale * 100);

        // Show raw number on focus, select all for easy replacement
        zoomBarInput.addEventListener('focus', () => {
            zoomBarInput.value = Math.round(engine.viewport.scale * 100);
            setTimeout(() => zoomBarInput.select(), 0);
        });

        // Only allow digits, backspace, delete, arrows
        zoomBarInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyZoomInput();
                zoomBarInput.blur();
                return;
            }
            if (e.key === 'Escape') {
                updateZoomDisplay();
                zoomBarInput.blur();
                return;
            }
            // Allow: digits, backspace, delete, arrows, tab, select-all
            const allowed = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab'];
            if (allowed.includes(e.key)) { e.stopPropagation(); return; }
            if ((e.metaKey || e.ctrlKey) && e.key === 'a') { e.stopPropagation(); return; }
            if (!/^\d$/.test(e.key)) {
                e.preventDefault();
            }
            e.stopPropagation();
        });

        // Strip non-digits on input (catches paste, IME, etc.)
        zoomBarInput.addEventListener('input', () => {
            zoomBarInput.value = zoomBarInput.value.replace(/[^\d]/g, '');
        });

        // Apply on blur
        zoomBarInput.addEventListener('blur', () => {
            applyZoomInput();
        });

        // Prevent canvas interactions
        zoomBarInput.addEventListener('mousedown', (e) => e.stopPropagation());
        zoomBarInput.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    function applyZoomInput() {
        if (!zoomBarInput) return;
        const raw = zoomBarInput.value.replace('%', '').trim();
        let num = parseInt(raw, 10);
        if (isNaN(num) || num <= 0) {
            updateZoomDisplay();
            return;
        }
        // Clamp to engine's min/max scale range
        const minPct = Math.round(engine.viewport.minScale * 100);
        const maxPct = Math.round(engine.viewport.maxScale * 100);
        num = Math.max(minPct, Math.min(maxPct, num));
        engine.setZoom(num / 100);
        updateZoomDisplay();
    }

    // Sync zoom display in both places
    function updateZoomDisplay() {
        const pct = Math.round(engine.viewport.scale * 100) + '%';
        const zoomDisplay = document.getElementById('zoom-display');
        if (zoomDisplay) zoomDisplay.textContent = pct;
        if (zoomBarInput && document.activeElement !== zoomBarInput) {
            zoomBarInput.value = pct;
        }
    }

    window._updateZoomDisplay = updateZoomDisplay;

    // ==================== Toolbar Setup ====================

    const toolButtons = document.querySelectorAll('.tool-btn[data-tool]');

    toolButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const tool = btn.dataset.tool;

            // Handle rectangle button special case - show shape menu
            if (tool === 'rectangle') {
                const isHidden = shapeMenu.classList.contains('hidden');

                // Close other menus first if needed (optional, but good practice)
                if (zoomMenu) zoomMenu.classList.add('hidden');

                if (isHidden) {
                    shapeMenu.classList.remove('hidden');
                    // Position menu left-aligned with the button
                    const btnRect = btn.getBoundingClientRect();
                    shapeMenu.style.left = btnRect.left + 'px';
                } else {
                    shapeMenu.classList.add('hidden');
                }
                return;
            }

            // Remove active from all tool buttons
            toolButtons.forEach(b => b.classList.remove('active'));

            // Add active to clicked button
            btn.classList.add('active');

            engine.setTool(tool);
        });
    });

    // ==================== Shape Button Icon Memory ====================
    // Inline SVG icons — stroke-only so they render correctly at toolbar size
    const SHAPE_ICONS = {
        rectangle: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="14" height="14" rx="1.5" stroke="currentColor" stroke-width="1.7"/></svg>`,
        ellipse: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse cx="10" cy="10" rx="7" ry="7" stroke="currentColor" stroke-width="1.7"/></svg>`,
        triangle: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 3L17.5 16.5H2.5L10 3Z" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
        star: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 2.5l1.8 4.8 5 .4-3.8 3.3 1.2 4.9L10 13.4l-4.2 2.5 1.2-4.9L3.2 7.7l5-.4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
        line: `<svg width="20" height="20" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg"><line x1="3.5" y1="16.5" x2="16.5" y2="3.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
    };

    // Shape always resets to rectangle on each page load — no persistence
    const SHAPE_STORAGE_KEY = 'canvas_last_shape';
    localStorage.removeItem(SHAPE_STORAGE_KEY); // clear any stale value
    const rectangleBtn = document.querySelector('.tool-btn[data-tool="rectangle"]');

    function applyShapeToButton(shapeType) {
        if (!rectangleBtn) return;
        // Preserve the tooltip popup if already present
        const existingTooltip = rectangleBtn.querySelector('.tooltip-popup');
        if (existingTooltip) existingTooltip.remove();

        const icon = SHAPE_ICONS[shapeType] || SHAPE_ICONS.rectangle;
        rectangleBtn.innerHTML = icon;

        // Re-append or create the tooltip
        if (existingTooltip) {
            rectangleBtn.appendChild(existingTooltip);
        }
        // If no tooltip yet (e.g. called before tooltip init), it will be added by the tooltip init loop
    }

    // No saved shape to apply — always start as rectangle
    window._applyInitialShape = () => {};

    // Shape Menu
    if (shapeMenu) {
        shapeMenu.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.menu-item');
            if (!menuItem) return;

            const shapeType = menuItem.dataset.shape;

            // Set shape type in engine
            engine.setShapeType(shapeType);

            // Activate rectangle tool
            engine.setTool('rectangle');

            // Update button icon to reflect chosen shape
            applyShapeToButton(shapeType);

            // Update active state
            toolButtons.forEach(b => b.classList.remove('active'));
            if (rectangleBtn) rectangleBtn.classList.add('active');

            // Hide menu
            shapeMenu.classList.add('hidden');
        });
    }

    // Set initial tool to Move (default)
    engine.setTool('move');

    // Global function for engine to update UI (for space key)
    window.updateToolbarUI = function (tool) {
        toolButtons.forEach(b => {
            b.classList.remove('active');
            if (b.dataset.tool === tool) {
                b.classList.add('active');
            }
        });
    };

    // Listen for tool changes from engine (for auto-switch)
    const originalSetTool = engine.setTool.bind(engine);
    engine.setTool = function (tool) {
        originalSetTool(tool);
        // Update UI based on actual current tool (in case originalSetTool changed it)
        window.updateToolbarUI(engine.currentTool);
    };

    // ==================== Keyboard Shortcuts ====================

    document.addEventListener('keydown', (e) => {
        // New Project
        if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault();
            window.open('canvas.html', '_blank');
        }

        if (e.defaultPrevented) return;

        // Tool shortcuts (only single key, no modifiers)
        if (!engine.editingText && !engine.isInputActive() &&
            !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey) {
            const toolMap = {
                'v': 'move',
                'h': 'hand',
                'f': 'frame',
                'i': 'image',
                't': 'text',
                'r': 'rectangle',
                'p': 'pencil'
            };

            if (toolMap[e.key.toLowerCase()]) {
                e.preventDefault();
                const tool = toolMap[e.key.toLowerCase()];
                engine.setTool(tool);

                toolButtons.forEach(b => {
                    b.classList.remove('active');
                    if (b.dataset.tool === tool) {
                        b.classList.add('active');
                    }
                });
            }
        }

        // Tab: zoom + center selection so content and gen-panel are both visible
        if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey &&
            !engine.editingText && !engine.isInputActive()) {
            if (engine.selectedElements && engine.selectedElements.length > 0) {
                e.preventDefault();

                // If all selected elements belong to the same parent frame,
                // fit the entire frame (not just the selection).
                let fitTarget = engine.selectedElements;
                const parentFrames = new Set();
                let allHaveParent = true;
                for (const el of engine.selectedElements) {
                    if (el.parentFrame) {
                        parentFrames.add(el.parentFrame);
                    } else if (el.type !== 'frame') {
                        allHaveParent = false;
                    }
                }
                if (allHaveParent && parentFrames.size === 1) {
                    const parentFrame = [...parentFrames][0];
                    fitTarget = [parentFrame];
                }

                engine.fitToElements(fitTarget, {
                    padTop: 80,
                    padBottom: 220,
                    padLeft: 88,
                    padRight: 60,
                    maxScale: 1.5
                });
                if (window.canvasGenFocusPanel) window.canvasGenFocusPanel();
            }
        }

        // Zoom shortcuts (Shift + key, use e.code for reliable detection)
        if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey &&
            !engine.editingText && !engine.isInputActive()) {
            const zoomShortcuts = {
                'KeyF': 'fit',
                'Digit0': 0.5,
                'Digit1': 1.0,
                'Digit2': 2.0,
                'Equal': 'in',     // Shift + = (which is +)
                'Minus': 'out',    // Shift + -
            };
            if (e.code in zoomShortcuts) {
                e.preventDefault();
                const val = zoomShortcuts[e.code];
                if (val === 'fit') {
                    engine.fitToScreen();
                } else if (val === 'in') {
                    engine.zoom(100, canvas.width / 2, canvas.height / 2);
                } else if (val === 'out') {
                    engine.zoom(-100, canvas.width / 2, canvas.height / 2);
                } else {
                    engine.setZoom(val);
                }
                if (window._updateZoomDisplay) window._updateZoomDisplay();
            }
        }
    });

    // ── Phase 4: Share button ──────────────────────────────────────────────────
    const shareBtn = document.getElementById('share-btn');
    if (shareBtn) {
        shareBtn.addEventListener('click', () => {
            if (window.ShareManager) {
                window.ShareManager.openShareModal(projectId);
            } else {
                alert('Share feature loading…');
            }
        });
    }

    // ── Phase 3: Profile & Team menu items in avatar dropdown ─────────────────
    const profileMenuItem = document.getElementById('avatar-profile-btn');
    if (profileMenuItem) {
        profileMenuItem.addEventListener('click', () => {
            document.getElementById('avatar-dropdown')?.classList.remove('open');
            window.TeamManager?.openProfileModal();
        });
    }
    const teamMenuItem = document.getElementById('avatar-team-btn');
    if (teamMenuItem) {
        teamMenuItem.addEventListener('click', () => {
            document.getElementById('avatar-dropdown')?.classList.remove('open');
            window.TeamManager?.openTeamModal();
        });
    }

    // Disconnect collab gracefully on unload
    window.addEventListener('beforeunload', () => {
        window.CollabManager?.disconnect();
    });

    // Make engine globally accessible for debugging
    window.canvasEngine = engine;

    // ==================== Global Wheel Interception (prevents browser zoom everywhere) ====================
    // Block Ctrl/Cmd + wheel from zooming the browser, regardless of which element the cursor is over.
    // Skip if event is on canvas itself — canvas-engine.js handleWheel already handles it there.
    document.addEventListener('wheel', (e) => {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            const canvasEl = document.getElementById('infinite-canvas');
            // If cursor is on the canvas, canvas-engine.js already handles zoom — skip
            if (canvasEl && (e.target === canvasEl || canvasEl.contains(e.target))) return;
            if (window.canvasEngine) {
                // Zoom around canvas center when cursor is over UI elements
                const rect = canvasEl ? canvasEl.getBoundingClientRect() : null;
                const cx = rect ? rect.width / 2 : window.innerWidth / 2;
                const cy = rect ? rect.height / 2 : window.innerHeight / 2;
                window.canvasEngine.zoom(-e.deltaY, cx, cy, e.deltaY);
            }
        }
    }, { passive: false });

    // Initialize custom tooltips
    document.querySelectorAll('.tool-btn').forEach(btn => {
        const tooltipText = btn.getAttribute('data-tooltip');
        const shortcutText = btn.getAttribute('data-shortcut');

        if (tooltipText) {
            const tooltip = document.createElement('div');
            tooltip.className = 'tooltip-popup';

            const nameSpan = document.createElement('span');
            nameSpan.textContent = tooltipText;
            tooltip.appendChild(nameSpan);

            if (shortcutText) {
                const shortcutSpan = document.createElement('span');
                shortcutSpan.className = 'tooltip-shortcut-key';
                shortcutSpan.textContent = shortcutText;
                tooltip.appendChild(shortcutSpan);
            }

            btn.appendChild(tooltip);
        }
    });

    // Apply saved shape icon now that tooltips are set up
    if (window._applyInitialShape) window._applyInitialShape();

    // ==================== Floating Action Bar Logic ====================
    const actionBar = document.getElementById('frame-action-bar');
    const ratioSelect = document.getElementById('frame-ratio');
    const colorInput = document.getElementById('frame-bg-color');
    const colorPreview = document.getElementById('frame-bg-preview');
    const downloadBtn = document.getElementById('frame-download-btn');

    if (actionBar && engine) {
        // Handle selection change
        engine.onSelectionChange = (selectedElements) => {
            const frame = selectedElements.find(el => el.type === 'frame');

            if (selectedElements.length === 1 && frame) {
                // Show bar
                actionBar.classList.remove('hidden');
                updateActionBarPosition(frame);

                // Update UI state to match frame
                colorInput.value = frame.fill;
                colorPreview.style.backgroundColor = frame.fill;

                // Update ratio select
                const currentRatio = frame.width / frame.height;
                const RATIO_MAP = [
                    { value: '1:1', ratio: 1 },
                    { value: '2:3', ratio: 2 / 3 },
                    { value: '3:2', ratio: 3 / 2 },
                    { value: '3:4', ratio: 3 / 4 },
                    { value: '4:3', ratio: 4 / 3 },
                    { value: '9:16', ratio: 9 / 16 },
                    { value: '16:9', ratio: 16 / 9 },
                ];
                const matched = RATIO_MAP.find(r => Math.abs(currentRatio - r.ratio) < 0.02);
                ratioSelect.value = matched ? matched.value : 'custom';

            } else {
                // Hide bar
                actionBar.classList.add('hidden');
            }
        };

        // Update position on scroll/zoom (hook into render loop)
        const originalRender = engine.render.bind(engine);
        engine.render = () => {
            originalRender();
            const frame = engine.selectedElements.find(el => el.type === 'frame');
            if (engine.selectedElements.length === 1 && frame) {
                updateActionBarPosition(frame);
            }
            // Keep zoom display in sync
            if (window._updateZoomDisplay) window._updateZoomDisplay();
        };

        function updateActionBarPosition(frame) {
            // Get screen coordinates of frame top-center
            // Note: frame.x/y are top-left in world space
            const worldCenterX = frame.x + frame.width / 2;
            const worldTopY = frame.y;

            const screenPos = engine.worldToScreen(worldCenterX, worldTopY);

            // Ensure screenPos is valid
            if (!screenPos || typeof screenPos.x !== 'number') return;

            // Position bar centered horizontally above the frame
            actionBar.style.left = `${screenPos.x}px`;
            actionBar.style.top = `${screenPos.y - 12}px`; // 12px gap

            // Ensure bar is on screen
            // (Simple clamp could be added here if needed, but keeping it simple for now)
        }

        // Handle Ratio Change
        ratioSelect.addEventListener('change', (e) => {
            const frame = engine.selectedElements[0];
            if (!frame || frame.type !== 'frame') return;

            const val = e.target.value;
            if (val === 'custom') return;

            const [rW, rH] = val.split(':').map(Number);
            const ratio = rW / rH;

            // Keep the shorter side at least 1080 (default)
            // For landscape (ratio>=1): width is longer, shorter is height = 1080
            // For portrait  (ratio<1):  height is longer, shorter is width  = 1080
            const minSide = 1080;
            let newW, newH;
            if (ratio >= 1) {
                newH = minSide;
                newW = Math.round(minSide * ratio);
            } else {
                newW = minSide;
                newH = Math.round(minSide / ratio);
            }

            frame.width = newW;
            frame.height = newH;

            // Also resize all child images to fill the frame proportionally
            engine.elements.forEach(el => {
                if (el.parentFrame !== frame || el.type !== 'image') return;
                const frameAspect = newW / newH;
                const imgAspect = (el.image?.naturalWidth || el.width) / (el.image?.naturalHeight || el.height);
                if (imgAspect > frameAspect) {
                    el.height = newH;
                    el.width = newH * imgAspect;
                } else {
                    el.width = newW;
                    el.height = newW / imgAspect;
                }
                el.x = frame.x + (newW - el.width) / 2;
                el.y = frame.y + (newH - el.height) / 2;
            });

            engine.render();
            engine.saveState();
        });

        // Handle BG Color Change
        colorInput.addEventListener('input', (e) => {
            const frame = engine.selectedElements[0];
            if (!frame || frame.type !== 'frame') return;

            const color = e.target.value;
            frame.fill = color;
            colorPreview.style.backgroundColor = color;

            engine.render();
            // Don't save state on every input event, maybe on change
        });

        colorInput.addEventListener('change', (e) => {
            const frame = engine.selectedElements[0];
            if (!frame || frame.type !== 'frame') return;
            // Save state on final change
            engine.saveState();
        });



        // Handle Download — export at actual image resolution when frame has an image
        downloadBtn.addEventListener('click', () => {
            const frame = engine.selectedElements[0];
            if (!frame || frame.type !== 'frame') return;

            const frameImage = engine.elements.find(el => el.type === 'image' && el.parentFrame === frame && el.image);
            const outW = frameImage?.image?.naturalWidth
                ? frameImage.image.naturalWidth
                : Math.max(1, Math.round(frame.width));
            const outH = frameImage?.image?.naturalHeight
                ? frameImage.image.naturalHeight
                : Math.max(1, Math.round(frame.height));

            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = outW;
            tempCanvas.height = outH;
            const tempCtx = tempCanvas.getContext('2d');
            const scaleX = outW / frame.width;
            const scaleY = outH / frame.height;

            tempCtx.fillStyle = frame.fill;
            tempCtx.fillRect(0, 0, outW, outH);

            // Clip all drawing to frame bounds so overflow images don't bleed outside
            tempCtx.save();
            tempCtx.beginPath();
            tempCtx.rect(0, 0, outW, outH);
            tempCtx.clip();

            engine.elements.forEach(el => {
                if (el === frame) return;
                if (el.parentFrame !== frame) return; // only render direct frame children
                if (el.x >= frame.x + frame.width || el.x + (el.width || 0) <= frame.x ||
                    el.y >= frame.y + frame.height || el.y + (el.height || 0) <= frame.y) return;

                const localX = el.x - frame.x;
                const localY = el.y - frame.y;
                const sw = (el.width || 0) * scaleX;
                const sh = (el.height || 0) * scaleY;
                const sx = localX * scaleX;
                const sy = localY * scaleY;

                tempCtx.save();

                if (el.type === 'image' && el.image) {
                    // Always use source-rect drawImage so the clip region is respected
                    // even when the image overflows the frame (localX/localY < 0).
                    // Compute the portion of the *source* image that maps to the frame area:
                    //   scaleImgX/Y = how many source pixels per canvas unit
                    //   cropSrcX/Y  = first visible source pixel (offset when el.x < frame.x)
                    const scaleImgX = el.image.naturalWidth  / (el.width  || 1);
                    const scaleImgY = el.image.naturalHeight / (el.height || 1);
                    // Intersection of image rect and frame rect in canvas space
                    const visCanX = Math.max(el.x, frame.x) - frame.x;
                    const visCanY = Math.max(el.y, frame.y) - frame.y;
                    const visCanR = Math.min(el.x + (el.width  || 0), frame.x + frame.width)  - frame.x;
                    const visCanB = Math.min(el.y + (el.height || 0), frame.y + frame.height) - frame.y;
                    const visCanW = Math.max(0, visCanR - visCanX);
                    const visCanH = Math.max(0, visCanB - visCanY);
                    if (visCanW > 0 && visCanH > 0) {
                        const cropSrcX = (Math.max(el.x, frame.x) - el.x) * scaleImgX;
                        const cropSrcY = (Math.max(el.y, frame.y) - el.y) * scaleImgY;
                        const cropSrcW = visCanW / (el.width  || 1) * el.image.naturalWidth;
                        const cropSrcH = visCanH / (el.height || 1) * el.image.naturalHeight;
                        tempCtx.drawImage(
                            el.image,
                            cropSrcX, cropSrcY, cropSrcW, cropSrcH,
                            visCanX * scaleX, visCanY * scaleY,
                            visCanW * scaleX, visCanH * scaleY
                        );
                    }
                } else if (el.type === 'text') {
                    tempCtx.font = `${(el.fontSize || 14) * scaleY}px ${el.fontFamily || 'Inter'}`;
                    tempCtx.fillStyle = el.color || '#000';
                    tempCtx.textAlign = el.align || 'left';
                    tempCtx.textBaseline = 'top';
                    const lines = (el.text || '').split('\n');
                    const lineHeight = (el.fontSize || 14) * 1.2 * scaleY;
                    lines.forEach((line, i) => {
                        tempCtx.fillText(line, sx + 5 * scaleX, sy + 5 * scaleY + i * lineHeight);
                    });
                } else if (el.type === 'shape') {
                    tempCtx.beginPath();
                    if (el.shapeType === 'rectangle') {
                        const r = (el.cornerRadius || 0) * Math.min(scaleX, scaleY);
                        if (r) tempCtx.roundRect(sx, sy, sw, sh, r);
                        else tempCtx.rect(sx, sy, sw, sh);
                    } else if (el.shapeType === 'ellipse') {
                        tempCtx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
                    } else if (el.shapeType === 'line') {
                        tempCtx.moveTo(sx, sy);
                        tempCtx.lineTo((el.x2 - frame.x) * scaleX, (el.y2 - frame.y) * scaleY);
                    }
                    if (el.fill && el.fill !== 'none') {
                        tempCtx.fillStyle = el.fill;
                        tempCtx.fill();
                    }
                    if (el.stroke && el.strokeWidth > 0) {
                        tempCtx.strokeStyle = el.stroke;
                        tempCtx.lineWidth = el.strokeWidth * Math.min(scaleX, scaleY);
                        tempCtx.stroke();
                    }
                }

                tempCtx.restore();
            });

            // Restore the frame clip
            tempCtx.restore();

            const link = document.createElement('a');
            link.download = `${frame.name || 'frame'}.png`;
            link.href = tempCanvas.toDataURL('image/png');
            link.click();
        });
    }

    // ==================== Canvas Auth UI (header right-section) ====================

    // Use the same element IDs as index.html so the header is identical
    function updateCanvasAuthUI(loggedIn, user) {
        const loginBtn = document.getElementById('header-login-btn');
        const avatarWrap = document.getElementById('avatar-wrapper');
        const avatarImg = document.getElementById('user-avatar-img');
        const dropAvatar = document.getElementById('dropdown-avatar-img');
        const dropEmail = document.getElementById('dropdown-user-email');

        if (loggedIn) {
            if (loginBtn) loginBtn.style.display = 'none';
            if (avatarWrap) avatarWrap.style.display = '';
            const url = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
            if (url) {
                if (avatarImg) { avatarImg.src = url; avatarImg.alt = user.email || ''; }
                if (dropAvatar) { dropAvatar.src = url; dropAvatar.alt = user.email || ''; }
            }
            if (dropEmail) dropEmail.textContent = user?.email || '';
        } else {
            if (loginBtn) loginBtn.style.display = '';
            if (avatarWrap) avatarWrap.style.display = 'none';
        }

        // Update save mode badge
        _updateSaveModeBadge(loggedIn);
    }

    // ── Save status badge ────────────────────────────────────────────────────
    function _updateSaveModeBadge(isLoggedIn) {
        let badge = document.getElementById('save-mode-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'save-mode-badge';
            badge.style.cssText = [
                'position:fixed', 'bottom:12px', 'right:12px', 'z-index:9999',
                'padding:4px 10px', 'border-radius:20px', 'font-size:11px',
                'font-family:Inter,sans-serif', 'pointer-events:none',
                'transition:opacity .3s', 'opacity:0.85',
            ].join(';');
            document.body.appendChild(badge);
        }
        if (isLoggedIn) {
            badge.style.background = '#1a6b3c';
            badge.style.color = '#90f0b8';
            badge.textContent = '☁ Cloud';
        } else {
            badge.style.background = '#4a3800';
            badge.style.color = '#ffd066';
            badge.textContent = '⚠ Local only — sign in to save to cloud';
        }
    }

    // Listen for pm:save events from project-manager
    window.addEventListener('pm:save', (e) => {
        const { ok, error, code } = e.detail;
        const badge = document.getElementById('save-mode-badge');
        if (!badge) return;
        if (ok) {
            badge.style.background = '#1a6b3c';
            badge.style.color = '#90f0b8';
            badge.textContent = '☁ Saved';
        } else {
            badge.style.background = '#6b1a1a';
            badge.style.color = '#f09090';
            badge.textContent = `✗ Save failed (${code || error})`;
            console.error('[Canvas] Cloud save failed. Check console for [ProjectManager] error above.');
        }
    });

    // Header auth button wiring (same IDs as index.html)
    const headerLoginBtn = document.getElementById('header-login-btn');
    if (headerLoginBtn) {
        headerLoginBtn.addEventListener('click', () => {
            const overlay = document.getElementById('auth-modal-overlay');
            if (overlay) {
                const loginPage = document.getElementById('auth-page-login');
                const otpPage = document.getElementById('auth-page-otp');
                if (loginPage) loginPage.classList.remove('auth-page-hidden');
                if (otpPage) otpPage.classList.add('auth-page-hidden');
                overlay.classList.add('active');
            } else {
                window.location.href = 'index.html';
            }
        });
    }

    // ---- Language picker (standalone, no script.js dependency) ----
    let _canvasLang = localStorage.getItem('aime_language') || 'en';
    const _langLabels = { en: 'English', zh: '简体中文' };

    function _updateLangDisplay() {
        const el = document.getElementById('language-display');
        if (el) el.textContent = _langLabels[_canvasLang] || 'English';
    }
    _updateLangDisplay();

    function _hideLangPicker() {
        const picker = document.getElementById('canvas-lang-picker');
        if (picker) picker.classList.remove('active');
    }

    function _showLangPicker() {
        // Mutually exclusive: close avatar dropdown
        const ad = document.getElementById('avatar-dropdown');
        if (ad) ad.classList.remove('open');

        let picker = document.getElementById('canvas-lang-picker');
        if (!picker) {
            picker = document.createElement('div');
            picker.id = 'canvas-lang-picker';
            picker.className = 'floating-picker language-picker-panel';
            picker.style.position = 'fixed';
            document.body.appendChild(picker);
        }

        picker.innerHTML = Object.entries(_langLabels).map(([code, label]) => `
            <div class="language-item ${_canvasLang === code ? 'selected' : ''}" data-lang="${code}">
                <span class="language-label">${label}</span>
                <svg class="language-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                </svg>
            </div>
        `).join('');

        const langBtnEl = document.getElementById('language-btn');
        if (langBtnEl) {
            const r = langBtnEl.getBoundingClientRect();
            picker.style.top = (r.bottom + 8) + 'px';
            picker.style.left = 'auto';
            picker.style.right = (window.innerWidth - r.right) + 'px';
        }

        picker.querySelectorAll('.language-item').forEach(item => {
            item.addEventListener('click', () => {
                _canvasLang = item.dataset.lang;
                localStorage.setItem('aime_language', _canvasLang);
                _updateLangDisplay();
                _hideLangPicker();
            });
        });

        picker.classList.add('active');
    }

    // Language button
    const langBtn = document.getElementById('language-btn');
    if (langBtn) {
        langBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const picker = document.getElementById('canvas-lang-picker');
            if (picker && picker.classList.contains('active')) {
                _hideLangPicker();
            } else {
                _showLangPicker();
            }
        });
    }

    // Avatar dropdown (mutually exclusive with language picker)
    const avatarBtn = document.getElementById('user-avatar-btn');
    const avatarDropdown = document.getElementById('avatar-dropdown');
    if (avatarBtn && avatarDropdown) {
        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            _hideLangPicker();  // close lang picker when opening avatar
            avatarDropdown.classList.toggle('open');
        });
    }

    const logoutBtn = document.getElementById('avatar-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            if (typeof signOut === 'function') await signOut();
            ProjectManager.setUserId('guest');
            updateCanvasAuthUI(false, null);
            if (avatarDropdown) avatarDropdown.classList.remove('open');
        });
    }

    // Close both pickers on outside click
    document.addEventListener('click', (e) => {
        const langPicker = document.getElementById('canvas-lang-picker');
        const langBtnEl2 = document.getElementById('language-btn');
        if (langPicker && !langPicker.contains(e.target) && (!langBtnEl2 || !langBtnEl2.contains(e.target))) {
            _hideLangPicker();
        }
        if (avatarDropdown && !avatarDropdown.contains(e.target) && (!avatarBtn || !avatarBtn.contains(e.target))) {
            avatarDropdown.classList.remove('open');
        }
    });

    // Initial auth UI state
    updateCanvasAuthUI(false, null);

    // Initialize auth modal (same flow as index.html)
    // Re-declare here since script.js is not loaded on canvas page
    _initCanvasAuthModal();

    function _initCanvasAuthModal() {
        const overlay = document.getElementById('auth-modal-overlay');
        const closeBtn = document.getElementById('auth-modal-close');
        const backBtn = document.getElementById('auth-back-btn');
        const googleBtn = document.getElementById('auth-google-btn');
        const appleBtn = document.getElementById('auth-apple-btn');
        const emailInput = document.getElementById('auth-email-input');
        const emailContinueBtn = document.getElementById('auth-email-continue-btn');
        const resendBtn = document.getElementById('auth-resend-btn');

        let _otpTimer = null;
        let _pendingEmail = '';

        function _hideModal() {
            if (overlay) overlay.classList.remove('active');
            _clearTimer();
            if (emailInput) emailInput.value = '';
            document.querySelectorAll('.auth-otp-digit').forEach(i => { i.value = ''; i.classList.remove('filled', 'error'); });
        }
        function _showPage(page) {
            const lp = document.getElementById('auth-page-login');
            const op = document.getElementById('auth-page-otp');
            if (page === 'login') { lp?.classList.remove('auth-page-hidden'); op?.classList.add('auth-page-hidden'); }
            else { lp?.classList.add('auth-page-hidden'); op?.classList.remove('auth-page-hidden'); }
        }
        function _clearTimer() { clearInterval(_otpTimer); }
        function _startCountdown() {
            _clearTimer();
            let s = 60;
            const cd = document.getElementById('auth-countdown');
            const rt = document.getElementById('auth-resend-text');
            if (cd) cd.textContent = s;
            if (rt) rt.style.display = '';
            if (resendBtn) resendBtn.style.display = 'none';
            _otpTimer = setInterval(() => {
                s--;
                if (cd) cd.textContent = s;
                if (s <= 0) { _clearTimer(); if (rt) rt.style.display = 'none'; if (resendBtn) resendBtn.style.display = 'block'; }
            }, 1000);
        }
        function _completeLogin(user) {
            const uid = user?.id || 'authenticated';
            ProjectManager.setUserId(uid);
            updateCanvasAuthUI(true, user);
            _hideModal();
        }
        function _setLoading(btn, on) { if (btn) { btn.disabled = on; btn.style.opacity = on ? '0.7' : ''; } }
        function _isEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

        if (overlay) overlay.addEventListener('click', e => { if (e.target === overlay) _hideModal(); });
        if (closeBtn) closeBtn.addEventListener('click', _hideModal);
        if (backBtn) backBtn.addEventListener('click', () => { _showPage('login'); _clearTimer(); });

        if (googleBtn) googleBtn.addEventListener('click', async () => {
            _setLoading(googleBtn, true);
            const { error } = await signInWithGoogle();
            if (error?.message === 'not_configured') _completeLogin({ email: 'demo@example.com' });
            else if (error) console.warn('Google auth error:', error.message);
            _setLoading(googleBtn, false);
        });
        if (appleBtn) appleBtn.addEventListener('click', async () => {
            _setLoading(appleBtn, true);
            const { error } = await signInWithApple();
            if (error?.message === 'not_configured') _completeLogin({ email: 'demo@example.com' });
            else if (error) console.warn('Apple auth error:', error.message);
            _setLoading(appleBtn, false);
        });

        if (emailContinueBtn) emailContinueBtn.addEventListener('click', async () => {
            const email = emailInput?.value.trim() || '';
            if (!_isEmail(email)) { if (emailInput) { emailInput.focus(); emailInput.style.borderColor = '#E53E3E'; setTimeout(() => emailInput.style.borderColor = '', 1500); } return; }
            _setLoading(emailContinueBtn, true);
            const { error, simulated } = await sendEmailOTP(email);
            _setLoading(emailContinueBtn, false);
            if (error) { console.warn('OTP send error:', error.message); return; }
            _pendingEmail = email;
            const oe = document.getElementById('auth-otp-email');
            if (oe) oe.textContent = email;
            if (simulated) {
                const desc = document.querySelector('.auth-otp-desc');
                if (desc && !desc.querySelector('.dev-hint')) {
                    const h = document.createElement('span');
                    h.className = 'dev-hint';
                    h.style.cssText = 'display:block;margin-top:8px;font-size:11px;color:#F59E0B;background:rgba(245,158,11,.1);padding:4px 8px;border-radius:6px;';
                    h.textContent = '⚠️  Dev mode: any 6-digit code works';
                    desc.appendChild(h);
                }
            }
            _showPage('otp');
            _startCountdown();
            document.querySelectorAll('.auth-otp-digit').forEach(i => { i.value = ''; i.classList.remove('filled', 'error'); });
            setTimeout(() => document.querySelector('.auth-otp-digit')?.focus(), 100);
        });
        if (emailInput) {
            emailInput.addEventListener('keydown', e => { if (e.key === 'Enter') emailContinueBtn?.click(); });
        }
        if (resendBtn) resendBtn.addEventListener('click', async () => {
            if (_pendingEmail) await sendEmailOTP(_pendingEmail);
            _startCountdown();
        });

        // OTP digit wiring
        const digits = document.querySelectorAll('.auth-otp-digit');
        digits.forEach((inp, i) => {
            inp.addEventListener('input', e => {
                const v = e.target.value.replace(/\D/g, '');
                e.target.value = v ? v[0] : '';
                if (v) { inp.classList.add('filled'); if (i < digits.length - 1) digits[i + 1].focus(); else _checkOtp(digits); }
                else inp.classList.remove('filled');
            });
            inp.addEventListener('keydown', e => {
                if (e.key === 'Backspace' && !inp.value && i > 0) { digits[i - 1].focus(); digits[i - 1].value = ''; digits[i - 1].classList.remove('filled'); }
            });
            inp.addEventListener('paste', e => {
                e.preventDefault();
                const p = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
                p.split('').forEach((c, j) => { if (i + j < digits.length) { digits[i + j].value = c; digits[i + j].classList.add('filled'); } });
                digits[Math.min(i + p.length, digits.length - 1)].focus();
                _checkOtp(digits);
            });
        });

        async function _checkOtp(inputs) {
            const code = Array.from(inputs).map(x => x.value).join('');
            if (code.length !== 6) return;
            inputs.forEach(x => x.disabled = true);
            const { data, error } = await verifyEmailOTP(_pendingEmail, code);
            inputs.forEach(x => x.disabled = false);
            if (error) {
                inputs.forEach(x => x.classList.add('error'));
                setTimeout(() => inputs.forEach(x => x.classList.remove('error')), 600);
                inputs.forEach(x => { x.value = ''; x.classList.remove('filled'); });
                inputs[0].focus();
                return;
            }
            _completeLogin(data?.user || { email: _pendingEmail });
        }

        // Listen for session restored after OAuth redirect
        if (typeof onAuthStateChange === 'function') {
            onAuthStateChange(({ loggedIn, user }) => {
                if (loggedIn && user) _completeLogin(user);
            });
        }

        document.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay?.classList.contains('active')) _hideModal(); });
    }

});  // end DOMContentLoaded

