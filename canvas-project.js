/**
 * Canvas Project Manager
 *
 * Uses IndexedDB for project storage — no 5 MB localStorage limit,
 * no image compression, full quality preserved across open/close cycles.
 *
 * All public API methods are async (return Promises).
 * A one-time migration from the old localStorage format is performed on first read.
 */

(function () {
    const DB_NAME    = 'aime_canvas';
    const DB_VERSION = 1;
    const STORE      = 'projects';

    // Legacy localStorage keys (migration only)
    const LS_PREFIX  = 'aime_projects_';
    const LEGACY_KEY = 'aime_projects';

    const MAX_PROJECTS = 10;
    const THUMB_W = 320;
    const THUMB_H = 200;

    let _userId   = 'guest';
    let _db       = null;  // cached open IDBDatabase

    // ==================== IndexedDB ====================

    function openDB() {
        if (_db) return Promise.resolve(_db);
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = e => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'userId' });
                }
            };
            req.onsuccess  = e => { _db = e.target.result; resolve(_db); };
            req.onerror    = () => reject(req.error);
            req.onblocked  = () => reject(new Error('IndexedDB blocked'));
        });
    }

    // ==================== Serialization ====================

    function serializeElements(elements) {
        const frameId = new Map();
        let fi = 0;
        elements.forEach(el => {
            if (el.type === 'frame') frameId.set(el, 'f' + fi++);
        });

        return elements.map(el => {
            const out = {};
            for (const key of Object.keys(el)) {
                if (key === 'image') continue;        // HTMLImageElement — not serializable
                if (key === 'parentFrame') continue;  // live reference — handled below
                if (key === '_generating') continue;
                if (key === '_genStartTime') continue;
                if (key === '_justCreated') continue;
                out[key] = el[key];
            }
            if (el.type === 'frame') out._fid  = frameId.get(el);
            if (el.parentFrame)      out._pfid = frameId.get(el.parentFrame) ?? null;
            return out;
        });
    }

    async function deserializeElements(serialized) {
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
            if (s._pfid !== undefined) {
                elements[i].parentFrame = frameById[s._pfid] ?? null;
            }
        });

        // Start loading all images. For data: URLs (base64) this is near-instant.
        // We return elements immediately so frames/shapes render right away,
        // then each image triggers a repaint when decoded.
        // Batch repaints with rAF so we don't re-render for every single image.
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
            // Await first image so initial render already has at least one image
            // (avoids blank-frame flash for projects with a single image).
            const firstImg = imageEls[0];
            await new Promise(resolve => {
                const img = new Image();
                if (!firstImg.src.startsWith('data:')) img.crossOrigin = 'anonymous';
                img.onload  = () => { firstImg.image = img; resolve(); };
                img.onerror = () => resolve();
                img.src = firstImg.src;
            });
            // Load remaining images in background
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

    // ==================== Thumbnail ====================

    function thumbnailFromElement(imgEl) {
        try {
            if (!imgEl || !imgEl.naturalWidth || !imgEl.naturalHeight) return null;
            const cnv = document.createElement('canvas');
            cnv.width  = THUMB_W;
            cnv.height = THUMB_H;
            const ctx  = cnv.getContext('2d');
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
        } catch (e) {
            return null;
        }
    }

    function generateThumbnail(srcDataUrl) {
        if (!srcDataUrl) return Promise.resolve(null);
        return new Promise(resolve => {
            const img = new Image();
            img.onload  = () => resolve(thumbnailFromElement(img));
            img.onerror = () => resolve(null);
            img.src = srcDataUrl;
        });
    }

    function generateThumbnailFromCanvas(canvasEl) {
        try {
            if (!canvasEl) return null;
            const cnv = document.createElement('canvas');
            cnv.width  = THUMB_W;
            cnv.height = THUMB_H;
            const ctx = cnv.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, THUMB_W, THUMB_H);
            ctx.drawImage(canvasEl, 0, 0, THUMB_W, THUMB_H);
            return cnv.toDataURL('image/jpeg', 0.7);
        } catch (e) {
            return null;
        }
    }

    // ==================== Storage ====================

    async function readAll() {
        try {
            const db = await openDB();
            const result = await new Promise(resolve => {
                const tx  = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(_userId);
                req.onsuccess = () => resolve(req.result);
                req.onerror   = () => resolve(null);
            });

            if (result) return result.projects || [];

            // One-time migration from localStorage
            const lsKey = LS_PREFIX + _userId;
            const raw   = localStorage.getItem(lsKey) || localStorage.getItem(LEGACY_KEY);
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    await writeAll(parsed);
                    localStorage.removeItem(lsKey);
                    localStorage.removeItem(LEGACY_KEY);
                    console.log('[ProjectManager] Migrated localStorage → IndexedDB for', _userId);
                    return parsed;
                } catch { /* ignore bad data */ }
            }
            return [];
        } catch {
            return [];
        }
    }

    async function writeAll(projects) {
        try {
            const db = await openDB();
            await new Promise((resolve, reject) => {
                const tx  = db.transaction(STORE, 'readwrite');
                const req = tx.objectStore(STORE).put({ userId: _userId, projects });
                req.onsuccess = () => resolve();
                req.onerror   = () => reject(req.error);
            });
            return true;
        } catch (e) {
            console.error('[ProjectManager] IndexedDB write failed:', e);
            return false;
        }
    }

    // ==================== Public API ====================

    window.ProjectManager = {

        // Expose deserializeElements so canvas.js can use it for the sessionStorage
        // emergency recovery path without duplicating the implementation.
        _deserializeElements: deserializeElements,

        async getAll() {
            return readAll();
        },

        async get(id) {
            const all = await readAll();
            return all.find(p => p.id === id) ?? null;
        },

        async save(id, name, elements, viewport, canvasEl) {
            // Thumbnail: last image element, then canvas screenshot fallback
            let thumbnail = null;
            for (let i = elements.length - 1; i >= 0 && !thumbnail; i--) {
                const el = elements[i];
                if (el.type !== 'image') continue;
                if (el.image) thumbnail = thumbnailFromElement(el.image);
                if (!thumbnail && el.src) thumbnail = await generateThumbnail(el.src);
            }
            if (!thumbnail && canvasEl) thumbnail = generateThumbnailFromCanvas(canvasEl);

            const frameCount = elements.filter(el => el.type === 'frame').length;
            const project = {
                id,
                name: name || 'Untitled Project',
                updatedAt: Date.now(),
                thumbnail,
                frameCount,
                elements: serializeElements(elements),
                viewport: { x: viewport.x, y: viewport.y, scale: viewport.scale },
            };

            const all    = await readAll();
            const updated = [project, ...all.filter(p => p.id !== id)];
            if (updated.length > MAX_PROJECTS) updated.splice(MAX_PROJECTS);
            return writeAll(updated);
        },

        saveAndForget(id, name, elements, viewport) {
            // Fire-and-forget async IndexedDB write. Best-effort — the primary save
            // path is the visibilitychange handler in canvas.js which fires early
            // enough for async writes to complete. This is only a fallback for cases
            // where visibilitychange doesn't fire (e.g. process kill, hard crash).
            readAll().then(all => {
                const existing  = all.find(p => p.id === id);
                const frameCount = elements.filter(el => el.type === 'frame').length;
                const project = {
                    id,
                    name: name || 'Untitled Project',
                    updatedAt: Date.now(),
                    thumbnail: existing ? existing.thumbnail : null,
                    frameCount,
                    elements: serializeElements(elements),
                    viewport: { x: viewport.x, y: viewport.y, scale: viewport.scale },
                };
                const updated = [project, ...all.filter(p => p.id !== id)];
                if (updated.length > MAX_PROJECTS) updated.splice(MAX_PROJECTS);
                writeAll(updated);
            }).catch(e => console.warn('[ProjectManager] saveAndForget failed:', e));
        },

        async load(id) {
            const project = await this.get(id);
            if (!project) return null;
            const elements = await deserializeElements(project.elements || []);
            return { ...project, elements };
        },

        async delete(id) {
            const all = await readAll();
            await writeAll(all.filter(p => p.id !== id));
        },

        async rename(id, newName) {
            const all = await readAll();
            const p = all.find(p => p.id === id);
            if (p) {
                p.name = newName || 'Untitled Project';
                await writeAll(all);
            }
        },

        generateId() {
            return 'proj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        },

        getUserId() { return _userId; },

        async setUserId(newUserId) {
            const prevUserId = _userId;
            _userId = newUserId || 'guest';

            // Merge guest projects into authenticated user's space on first login
            if (prevUserId === 'guest' && _userId !== 'guest') {
                try {
                    const savedUserId = _userId;

                    _userId = 'guest';
                    const guestProjects = await readAll();
                    _userId = savedUserId;

                    if (guestProjects.length > 0) {
                        const userProjects = await readAll();
                        const merged = [...userProjects];
                        guestProjects.forEach(gp => {
                            if (!merged.find(p => p.id === gp.id)) merged.push(gp);
                        });
                        merged.sort((a, b) => b.updatedAt - a.updatedAt);
                        if (merged.length > MAX_PROJECTS) merged.splice(MAX_PROJECTS);
                        await writeAll(merged);

                        _userId = 'guest';
                        const db = await openDB();
                        await new Promise(resolve => {
                            const tx = db.transaction(STORE, 'readwrite');
                            tx.objectStore(STORE).delete('guest');
                            tx.oncomplete = resolve;
                            tx.onerror    = resolve;
                        });
                        _userId = savedUserId;
                        console.log('[ProjectManager] Merged', guestProjects.length, 'guest project(s)');
                    }
                } catch (e) {
                    console.warn('[ProjectManager] Guest migration failed:', e);
                }
            }

            console.log('[ProjectManager] User switched to:', _userId);
        },
    };

    // ==================== Time Formatting ====================

    window.formatProjectTime = function (ts) {
        const now  = Date.now();
        const diff = now - ts;
        const mins  = Math.floor(diff / 60_000);
        const hours = Math.floor(diff / 3_600_000);
        const days  = Math.floor(diff / 86_400_000);

        if (mins  < 1)  return 'Just now';
        if (mins  < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
        if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
        if (days  < 7)  return `${days} day${days > 1 ? 's' : ''} ago`;

        return new Date(ts).toLocaleDateString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric'
        });
    };

})();
