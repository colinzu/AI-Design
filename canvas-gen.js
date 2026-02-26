/**
 * Canvas Generation Panel — Multi-Instance AI Image Generation
 *
 * Each selected element (or group of elements) gets its own independent panel instance.
 * Multiple panels can exist simultaneously — a panel in "Thinking" state persists
 * while the user selects other elements and starts new generations.
 *
 * Architecture:
 *   panelRegistry = Map<key, PanelInstance>
 *   Each PanelInstance has its own DOM (cloned from <template>), state, and event listeners.
 */

(function () {
    // ==================== Generation State Persistence ====================
    const GEN_STATE_PREFIX = 'aime_gen_';

    function saveGenState(projectId, data) {
        try { localStorage.setItem(GEN_STATE_PREFIX + projectId, JSON.stringify(data)); } catch {}
    }

    function loadGenState(projectId) {
        try {
            const raw = localStorage.getItem(GEN_STATE_PREFIX + projectId);
            if (!raw) return null;
            const s = JSON.parse(raw);
            // Discard state older than 10 minutes to avoid stale restores
            if (Date.now() - (s.timestamp || 0) > 10 * 60 * 1000) {
                localStorage.removeItem(GEN_STATE_PREFIX + projectId);
                return null;
            }
            return s;
        } catch { return null; }
    }

    function clearGenState(projectId) {
        try { localStorage.removeItem(GEN_STATE_PREFIX + projectId); } catch {}
    }

    // ==================== Global Registry ====================
    const panelRegistry = new Map(); // key → PanelInstance

    // Cache recognized image labels: image src hash → label string
    // Persisted to localStorage so labels survive refreshes.
    const _LABEL_CACHE_KEY = 'canvas_image_labels';
    const imageLabelCache = new Map();
    try {
        const saved = JSON.parse(localStorage.getItem(_LABEL_CACHE_KEY) || '{}');
        Object.entries(saved).forEach(([k, v]) => imageLabelCache.set(k, v));
    } catch (_) {}
    function _persistLabelCache() {
        try {
            const obj = {};
            imageLabelCache.forEach((v, k) => { obj[k] = v; });
            localStorage.setItem(_LABEL_CACHE_KEY, JSON.stringify(obj));
        } catch (_) {}
    }

    // Unique ID counter for inline chips
    let _chipIdCounter = 0;
    function nextChipId() { return 'chip-' + (++_chipIdCounter); }

    // Unique ID counter for panel instances (used to fix SVG gradient ID conflicts)
    let _panelIdCounter = 0;

    /**
     * Fix SVG gradient ID conflicts in cloned panel DOM.
     * Each panel gets unique gradient IDs so multiple panels don't interfere.
     */
    function fixSvgGradientIds(dom, panelId) {
        const suffix = '-p' + panelId;
        const gradientIds = ['sparkle-grad-col', 'sparkle-grad-think'];

        gradientIds.forEach(oldId => {
            const newId = oldId + suffix;
            // Update gradient element IDs
            dom.querySelectorAll('[id="' + oldId + '"]').forEach(el => {
                el.id = newId;
            });
            // Update all fill="url(#...)" references
            dom.querySelectorAll('[fill="url(#' + oldId + ')"]').forEach(el => {
                el.setAttribute('fill', 'url(#' + newId + ')');
            });
        });
    }

    // Supported aspect ratios by Gemini API
    const SUPPORTED_RATIOS = [
        { label: '1:1', value: 1 / 1 },
        { label: '3:2', value: 3 / 2 },
        { label: '2:3', value: 2 / 3 },
        { label: '3:4', value: 3 / 4 },
        { label: '4:3', value: 4 / 3 },
        { label: '4:5', value: 4 / 5 },
        { label: '5:4', value: 5 / 4 },
        { label: '9:16', value: 9 / 16 },
        { label: '16:9', value: 16 / 9 },
    ];

    function getClosestAspectRatio(width, height) {
        const ratio = width / height;
        let closest = SUPPORTED_RATIOS[0];
        let minDiff = Math.abs(ratio - closest.value);
        for (const sr of SUPPORTED_RATIOS) {
            const diff = Math.abs(ratio - sr.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = sr;
            }
        }
        return closest.label;
    }

    // Model ID → API config mapping
    const MODEL_CONFIGS = {
        'nano-banana': {
            model: 'gemini-3-pro-image-preview',
            endpoint: '/api/generate',
        },
        'seedream': null,
    };

    // ==================== Panel Instance Factory ====================

    /**
     * Compute a stable key for a set of selected elements.
     * Uses element indices sorted so the same selection always produces the same key.
     */
    function getPanelKey(selectedElements) {
        const engine = window.canvasEngine;
        if (!engine) return 'unknown';
        const indices = selectedElements.map(el => engine.elements.indexOf(el)).sort((a, b) => a - b);
        return indices.join(',');
    }

    /**
     * Create a fresh panel state object.
     */
    function createPanelState() {
        return {
            isAutoMode: true,
            selectedModel: null,       // null = auto
            selectedModelName: 'Auto',
            imageCount: 1,
            uploadedImages: [],     // { index, src, name, fromSelection? }
            isGenerating: false,
            abortController: null,
            currentFrame: null,
            currentAnchor: null,
            panelMode: 'hidden',
            selectedElements: [],
        };
    }

    /**
     * Clone the template and create a new PanelInstance.
     * Returns { key, dom, state, els }.
     */
    function createPanelInstance(key) {
        const template = document.getElementById('gen-panel-template');
        if (!template) {
            console.error('[canvas-gen] gen-panel-template not found');
            return null;
        }

        const panelId = ++_panelIdCounter;
        const clone = template.content.cloneNode(true);
        const dom = clone.querySelector('.gen-panel');

        // Fix SVG gradient ID conflicts: make IDs unique per panel instance
        // so multiple panels don't share the same gradient references
        fixSvgGradientIds(dom, panelId);

        // Cache frequently accessed child elements
        const els = {
            collapsed: dom.querySelector('.gen-collapsed'),
            expanded: dom.querySelector('.gen-expanded'),
            thinking: dom.querySelector('.gen-thinking'),
            editor: dom.querySelector('.gen-input-editor'),
            uploadedImages: dom.querySelector('.gen-uploaded-images'),
            addBtn: dom.querySelector('.gen-add-btn'),
            modelSelector: dom.querySelector('.gen-model-selector'),
            countSelector: dom.querySelector('.gen-count-selector'),
            countMenu: dom.querySelector('.gen-count-menu'),
            sendBtn: dom.querySelector('.gen-send-btn'),
            stopBtn: dom.querySelector('.gen-stop-btn'),
            countLabel: dom.querySelector('.gen-count-label'),
            modelLabel: dom.querySelector('.gen-model-label'),
        };

        const instance = {
            key,
            dom,
            state: createPanelState(),
            els,
        };

        // Bind events scoped to this instance
        bindPanelEvents(instance);

        // Insert into the page (append to body so it's above other content)
        document.body.appendChild(dom);

        // Move count menu to body so position:fixed works
        // (gen-panel has transform which breaks fixed positioning for children)
        if (els.countMenu && els.countMenu.parentNode) {
            els.countMenu.parentNode.removeChild(els.countMenu);
            document.body.appendChild(els.countMenu);
        }

        return instance;
    }

    /**
     * Get or create a panel for a given key.
     */
    function getOrCreatePanel(key) {
        if (panelRegistry.has(key)) {
            return panelRegistry.get(key);
        }
        const instance = createPanelInstance(key);
        if (instance) {
            panelRegistry.set(key, instance);
        }
        return instance;
    }

    /**
     * Remove a panel from the registry and DOM.
     */
    function removePanel(key) {
        const instance = panelRegistry.get(key);
        if (!instance) return;
        if (instance.dom.parentNode) {
            instance.dom.parentNode.removeChild(instance.dom);
        }
        // Also remove the count menu (moved to body)
        if (instance.els.countMenu && instance.els.countMenu.parentNode) {
            instance.els.countMenu.parentNode.removeChild(instance.els.countMenu);
        }
        panelRegistry.delete(key);
    }

    // ==================== Panel Show / Hide / State ====================

    function showPanel(instance, mode) {
        const { dom, state } = instance;
        dom.classList.remove('hidden', 'collapsed', 'expanded', 'thinking');
        dom.classList.add(mode);
        state.panelMode = mode;
        if (state.currentAnchor) {
            updatePanelPosition(instance);
        }
    }

    function hidePanel(instance) {
        const { dom, state } = instance;
        dom.classList.remove('collapsed', 'expanded', 'thinking');
        dom.classList.add('hidden');
        state.panelMode = 'hidden';
        hideModelPicker(instance);
        hideCountMenu(instance);
    }

    function updatePanelPosition(instance) {
        const engine = window.canvasEngine;
        const { dom, state } = instance;
        if (!engine || !state.currentAnchor) return;

        const anchor = state.currentAnchor;
        const worldCenterX = anchor.x + (anchor.width || 0) / 2;
        const worldBottomY = anchor.y + (anchor.height || 0);
        const screenPos = engine.worldToScreen(worldCenterX, worldBottomY);

        if (!screenPos || typeof screenPos.x !== 'number') return;

        const rect = engine.canvas.getBoundingClientRect();
        dom.style.left = (rect.left + screenPos.x) + 'px';
        dom.style.top = (rect.top + screenPos.y + 16) + 'px';
    }

    function autoFocusEditor(instance) {
        const { els } = instance;
        if (!els.editor) return;
        // Focus synchronously to preserve user-gesture context (needed for Tab key etc.)
        els.editor.focus();
        const sel = window.getSelection();
        const range = document.createRange();
        range.selectNodeContents(els.editor);
        range.collapse(false);
        sel.removeAllRanges();
        sel.addRange(range);
    }

    // ==================== Selection Helpers ====================

    function findParentFrame(elements) {
        const engine = window.canvasEngine;
        if (!engine) return null;

        const bounds = getSelectionBounds(elements);
        const frames = engine.elements.filter(el => el.type === 'frame');

        const cx = bounds.x + bounds.width / 2;
        const cy = bounds.y + bounds.height / 2;

        for (let i = frames.length - 1; i >= 0; i--) {
            const f = frames[i];
            if (cx >= f.x && cx <= f.x + f.width && cy >= f.y && cy <= f.y + f.height) {
                return f;
            }
        }
        return null;
    }

    function getSelectionBounds(elements) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of elements) {
            if (el.type === 'path' && el.points && el.points.length) {
                // Path elements store bounds via their points array
                for (const p of el.points) {
                    minX = Math.min(minX, p.x);
                    minY = Math.min(minY, p.y);
                    maxX = Math.max(maxX, p.x);
                    maxY = Math.max(maxY, p.y);
                }
            } else {
                minX = Math.min(minX, el.x || 0);
                minY = Math.min(minY, el.y || 0);
                maxX = Math.max(maxX, (el.x || 0) + (el.width || 0));
                maxY = Math.max(maxY, (el.y || 0) + (el.height || 0));
            }
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    /**
     * Render selected elements to an image. Handles frame (with children), image, text, shape, path.
     * Returns { dataUrl, thumbUrl, name } or null on failure.
     */
    function renderSelectionToImage(elements, engine) {
        if (!elements.length || !engine) return null;

        const toRender = [];
        for (const el of elements) {
            if (el.type === 'frame') {
                toRender.push(el);
                const children = engine.getFrameChildren ? engine.getFrameChildren(el) : [];
                children.forEach(c => toRender.push(c));
            } else {
                toRender.push(el);
            }
        }

        // Always use only the directly-selected elements for bounds — never the expanded
        // toRender list which includes frame children that may overflow the frame rect.
        // Those overflow pixels would appear as transparent (black in JPEG) because the
        // frame clips them during rendering.  The canvas must be exactly the union of the
        // selected elements' own rects; frame children are clipped to the frame anyway.
        const bounds = getSelectionBounds(elements);
        const w = Math.max(1, bounds.width);
        const h = Math.max(1, bounds.height);
        // Cap at 768px on the longest side — sufficient for Gemini context understanding,
        // keeps the base64 payload small (fast upload) and the synchronous canvas draw fast
        // (smaller canvas = less CPU time = chip appears sooner after Tab).
        const maxPx = 768;
        const scale = Math.min(1, maxPx / Math.max(w, h));
        const outW = Math.max(1, Math.round(w * scale));
        const outH = Math.max(1, Math.round(h * scale));
        const scaleX = outW / w;
        const scaleY = outH / h;

        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = outW;
        tempCanvas.height = outH;
        const ctx = tempCanvas.getContext('2d');
        if (!ctx) return null;

        // Fill white so any transparent / un-drawn regions appear white in JPEG output,
        // not black (JPEG has no alpha channel — transparent = black).
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, outW, outH);

        // Build a map of frame screen-space rects so child clipping is fast
        const frameScreenRect = new Map();
        for (const el of toRender) {
            if (el.type === 'frame') {
                frameScreenRect.set(el, {
                    sx: (el.x - bounds.x) * scaleX,
                    sy: (el.y - bounds.y) * scaleY,
                    sw: el.width * scaleX,
                    sh: el.height * scaleY,
                });
            }
        }

        for (const el of toRender) {
            const localX = el.x - bounds.x;
            const localY = el.y - bounds.y;
            const sx = localX * scaleX;
            const sy = localY * scaleY;
            const sw = (el.width || 0) * scaleX;
            const sh = (el.height || 0) * scaleY;

            ctx.save();

            // Clip frame children to the frame's screen rect so overflow doesn't bleed
            if (el.parentFrame && frameScreenRect.has(el.parentFrame)) {
                const fr = frameScreenRect.get(el.parentFrame);
                ctx.beginPath();
                ctx.rect(fr.sx, fr.sy, fr.sw, fr.sh);
                ctx.clip();
            }

            if (el.type === 'frame') {
                ctx.fillStyle = el.fill || '#fff';
                ctx.fillRect(sx, sy, sw, sh);
            } else if (el.type === 'image' && el.image) {
                ctx.drawImage(el.image, 0, 0, el.image.naturalWidth, el.image.naturalHeight, sx, sy, sw, sh);
            } else if (el.type === 'text') {
                ctx.font = `${(el.fontSize || 14) * scaleY}px ${el.fontFamily || 'Inter'}`;
                ctx.fillStyle = el.color || '#000';
                ctx.textAlign = el.align || 'left';
                ctx.textBaseline = 'top';
                const lines = (el.text || '').split('\n');
                const lineHeight = (el.fontSize || 14) * 1.2 * scaleY;
                lines.forEach((line, i) => {
                    ctx.fillText(line, sx + 5 * scaleX, sy + 5 * scaleY + i * lineHeight);
                });
            } else if (el.type === 'shape') {
                const st = el.shapeType || 'rectangle';
                ctx.beginPath();
                if (st === 'rectangle') {
                    const r = (el.cornerRadius || 0) * Math.min(scaleX, scaleY);
                    if (r) ctx.roundRect(sx, sy, sw, sh, r);
                    else ctx.rect(sx, sy, sw, sh);
                } else if (st === 'ellipse') {
                    ctx.ellipse(sx + sw / 2, sy + sh / 2, sw / 2, sh / 2, 0, 0, Math.PI * 2);
                } else if (st === 'line') {
                    ctx.moveTo(sx, sy);
                    ctx.lineTo((el.x2 - bounds.x) * scaleX, (el.y2 - bounds.y) * scaleY);
                } else if (st === 'triangle') {
                    const cx = sx + sw / 2, cy = sy + sh / 2;
                    const r = Math.min(sw, sh) / 2;
                    for (let i = 0; i < 3; i++) {
                        const a = -Math.PI / 2 + (i * 2 * Math.PI / 3);
                        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                } else if (st === 'star') {
                    const cx = sx + sw / 2, cy = sy + sh / 2;
                    const or = Math.min(sw, sh) / 2, ir = or * 0.382;
                    for (let i = 0; i < 10; i++) {
                        const a = -Math.PI / 2 + (i * Math.PI / 5);
                        const r = i % 2 === 0 ? or : ir;
                        const px = cx + r * Math.cos(a), py = cy + r * Math.sin(a);
                        if (i === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                } else {
                    ctx.rect(sx, sy, sw, sh);
                }
                if (el.fill && el.fill !== 'none') {
                    ctx.fillStyle = el.fill;
                    ctx.fill();
                }
                if (el.stroke && el.strokeWidth > 0) {
                    ctx.strokeStyle = el.stroke;
                    ctx.lineWidth = el.strokeWidth * Math.min(scaleX, scaleY);
                    ctx.stroke();
                }
            } else if (el.type === 'path' && el.points && el.points.length) {
                ctx.beginPath();
                el.points.forEach((p, i) => {
                    const px = (p.x - bounds.x) * scaleX, py = (p.y - bounds.y) * scaleY;
                    if (i === 0) ctx.moveTo(px, py);
                    else ctx.lineTo(px, py);
                });
                ctx.strokeStyle = el.stroke || '#000';
                ctx.lineWidth = (el.strokeWidth || 2) * Math.min(scaleX, scaleY);
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.stroke();
            }

            ctx.restore();
        }

        // Export as JPEG for a compact payload — the reference image is used for AI context,
        // not for display, so lossy compression is fine. JPEG is 5-10x smaller than PNG at the
        // same resolution, which is the biggest lever for upload speed.
        let dataUrl;
        try {
            dataUrl = tempCanvas.toDataURL('image/jpeg', 0.85);
        } catch (_e) {
            return null;
        }

        const thumbSize = 64;
        let thumbUrl;

        // For text elements: generate a first-character thumbnail for the chip
        const isSingleText = elements.length === 1 && elements[0].type === 'text';
        if (isSingleText) {
            const el = elements[0];
            const firstChar = (el.text || '').trim().charAt(0) || 'T';
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = thumbSize;
            thumbCanvas.height = thumbSize;
            const thumbCtx = thumbCanvas.getContext('2d');
            thumbCtx.fillStyle = '#f5f5f5';
            thumbCtx.fillRect(0, 0, thumbSize, thumbSize);
            const fontSize = Math.round(thumbSize * 0.6);
            thumbCtx.font = `bold ${fontSize}px ${el.fontFamily || 'Inter'}`;
            thumbCtx.fillStyle = el.color || '#000';
            thumbCtx.textAlign = 'center';
            thumbCtx.textBaseline = 'middle';
            thumbCtx.fillText(firstChar, thumbSize / 2, thumbSize / 2);
            thumbUrl = thumbCanvas.toDataURL('image/png');
        } else {
            const aspect = outW / outH;
            const thumbW = aspect >= 1 ? thumbSize : Math.round(thumbSize * aspect);
            const thumbH = aspect >= 1 ? Math.round(thumbSize / aspect) : thumbSize;
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = thumbW;
            thumbCanvas.height = thumbH;
            const thumbCtx = thumbCanvas.getContext('2d');
            // Fill white so the chip thumbnail always has a legible background
            thumbCtx.fillStyle = '#ffffff';
            thumbCtx.fillRect(0, 0, thumbW, thumbH);
            thumbCtx.drawImage(tempCanvas, 0, 0, outW, outH, 0, 0, thumbW, thumbH);
            thumbUrl = thumbCanvas.toDataURL('image/png');
        }

        // Shape name mapping — use consistent "Circle" for ellipse type
        const SHAPE_NAMES = {
            rectangle: 'Rectangle',
            ellipse: 'Circle',
            triangle: 'Triangle',
            star: 'Star',
            line: 'Line',
        };

        // Compute name mirroring the layer panel's getLabel() priority:
        // el.name → AI cache (images) → type-based label
        let name = 'Selection';
        if (elements.length === 1) {
            const el = elements[0];
            if (el.name) {
                // User-assigned name always wins
                name = el.name.split(/\s+/).slice(0, 3).join(' ');
            } else if (el.type === 'frame') {
                name = 'Frame';
            } else if (el.type === 'image') {
                // AI cache → frame name → fallback
                const cached = el.src ? imageLabelCache.get(getImageCacheKey(el.src)) : null;
                const frameName = el.parentFrame?.name;
                if (cached) {
                    name = cached.split(/\s+/).slice(0, 3).join(' ');
                } else if (frameName && frameName !== 'Frame') {
                    name = frameName.split(/\s+/).slice(0, 2).join(' ');
                    // Pre-populate cache with frame name so recognizeImageLabel can skip the API call
                    if (el.src) imageLabelCache.set(getImageCacheKey(el.src), frameName);
                } else {
                    name = 'Image';
                }
            } else if (el.type === 'text') {
                name = (el.text || '').slice(0, 24).trim() || 'Text';
            } else if (el.type === 'shape') {
                const st = el.shapeType || 'shape';
                name = SHAPE_NAMES[st] || (st.charAt(0).toUpperCase() + st.slice(1));
            } else if (el.type === 'path') {
                name = 'Sketch';
            }
        }

        return { dataUrl, thumbUrl, name };
    }

    /**
     * Collect selected elements as reference image(s) for a panel instance.
     * Renders the selection as one image and adds it as an inline chip with a short name.
     */
    function collectSelectedAsReference(instance, elements) {
        const engine = window.canvasEngine;
        const { state, els } = instance;

        state.uploadedImages = state.uploadedImages.filter(img => !img.fromSelection);
        if (els.editor) {
            els.editor.querySelectorAll('.gen-inline-chip[data-from-selection]').forEach(c => c.remove());
        }

        // Don't add a chip for a single empty frame (no children inside it)
        if (elements.length === 1 && elements[0].type === 'frame') {
            const hasContent = engine.elements.some(el => el.parentFrame === elements[0]);
            if (!hasContent) {
                renderUploadedImages(instance);
                updateSendState(instance);
                return;
            }
        }

        // Ensure all image elements are fully loaded before rendering
        const pendingImages = [];
        const toRender = [];
        for (const el of elements) {
            if (el.type === 'frame') {
                toRender.push(el);
                const children = engine.getFrameChildren ? engine.getFrameChildren(el) : [];
                children.forEach(c => toRender.push(c));
            } else {
                toRender.push(el);
            }
        }
        for (const el of toRender) {
            if (el.type === 'image' && el.src && (!el.image || !el.image.naturalWidth)) {
                pendingImages.push(el);
            }
        }

        if (pendingImages.length > 0) {
            Promise.all(pendingImages.map(el => new Promise(resolve => {
                if (el.image && el.image.naturalWidth) { resolve(); return; }
                const img = el.image || new Image();
                if (!el.src.startsWith('data:')) img.crossOrigin = 'anonymous';
                img.onload = () => { el.image = img; resolve(); };
                img.onerror = () => resolve();
                if (!el.image) {
                    img.src = el.src;
                } else if (el.image.complete) {
                    resolve();
                }
            }))).then(() => {
                doCollect(instance, elements);
            });
            return;
        }

        doCollect(instance, elements);
    }

    function doCollect(instance, elements) {
        const engine = window.canvasEngine;
        const { state, els } = instance;

        // ── Step 1: fast synchronous thumbnail for the chip ───────────────────────
        // For a single already-loaded image element we can build a 64px thumb
        // directly from el.image without an expensive canvas redraw at 768px.
        // This makes the chip appear immediately (no perceptible delay).
        let fastThumb = null;
        let fastName  = null;
        if (elements.length === 1 && elements[0].type === 'image' && elements[0].image) {
            const el  = elements[0];
            const img = el.image;
            const THUMB = 64;
            // If the image lives inside a frame, crop to the frame's visible area
            const frame = el.parentFrame;
            let visW, visH, srcX, srcY, srcW, srcH;
            if (frame && el.width > 0 && el.height > 0) {
                // Intersection of image rect and frame rect in canvas space
                const clipX = Math.max(el.x, frame.x);
                const clipY = Math.max(el.y, frame.y);
                const clipR = Math.min(el.x + el.width,  frame.x + frame.width);
                const clipB = Math.min(el.y + el.height, frame.y + frame.height);
                visW = Math.max(1, clipR - clipX);
                visH = Math.max(1, clipB - clipY);
                // Map visible canvas rect back to source image pixels
                const scaleImgX = img.naturalWidth  / el.width;
                const scaleImgY = img.naturalHeight / el.height;
                srcX = (clipX - el.x) * scaleImgX;
                srcY = (clipY - el.y) * scaleImgY;
                srcW = visW * scaleImgX;
                srcH = visH * scaleImgY;
            } else {
                visW = el.width  || img.naturalWidth;
                visH = el.height || img.naturalHeight;
                srcX = 0; srcY = 0;
                srcW = img.naturalWidth; srcH = img.naturalHeight;
            }
            const aspect = visW / visH;
            const tw = aspect >= 1 ? THUMB : Math.round(THUMB * aspect);
            const th = aspect >= 1 ? Math.round(THUMB / aspect) : THUMB;
            try {
                const tc = document.createElement('canvas');
                tc.width = tw; tc.height = th;
                tc.getContext('2d').drawImage(img, srcX, srcY, srcW, srcH, 0, 0, tw, th);
                fastThumb = tc.toDataURL('image/jpeg', 0.7);
            } catch (_) { /* tainted canvas — fall through */ }
            // Compute chip name: el.name → AI cache → frame name → fallback
            // This mirrors the layer panel's getLabel() logic for consistency.
            const el0 = elements[0];
            if (el0.name) {
                fastName = el0.name.split(/\s+/).slice(0, 3).join(' ');
            } else if (el0.src) {
                const aiLabel = imageLabelCache.get(getImageCacheKey(el0.src));
                if (aiLabel) {
                    fastName = aiLabel.split(/\s+/).slice(0, 3).join(' ');
                }
            }
            if (!fastName) {
                const frameName = el0.parentFrame?.name;
                fastName = (frameName && frameName !== 'Frame')
                    ? frameName.split(/\s+/).slice(0, 2).join(' ')
                    : 'Image';
            }
        }

        // Insert chip immediately with the fast thumbnail (or fall back to full render)
        let imgData;
        if (fastThumb) {
            const el0 = elements[0];
            imgData = {
                chipId: nextChipId(),
                src: fastThumb,      // temporary — replaced below when full-res is ready
                thumb: fastThumb,
                name: fastName || 'Image',
                fromSelection: true,
                _pendingSrc: true,
                // Store original src so recognizeImageLabel caches under the same key
                // as describeImageElement / getImageLabel — ensuring layer & chip names match
                _originalSrc: el0.src || null,
            };
            state.uploadedImages.push(imgData);
            if (els.editor) insertInlineChip(instance, imgData, els.editor);
            renderUploadedImages(instance);
            updateSendState(instance);

            // Check if we already have a good name — skip API if frame name or already cached
            const hasFrameName = el0.parentFrame?.name && el0.parentFrame.name !== 'Frame';
            const alreadyCached = el0.src && imageLabelCache.has(getImageCacheKey(el0.src));

            setTimeout(() => {
                const result = renderSelectionToImage(elements, engine);
                if (result) {
                    imgData.src = result.dataUrl;
                    imgData._pendingSrc = false;
                }
                // If we already have a cached label (from describeImageElement), apply it now
                if (alreadyCached) {
                    const cached = imageLabelCache.get(getImageCacheKey(el0.src));
                    updateChipLabel(instance, imgData, cached);
                } else if (!hasFrameName) {
                    // Skip AI recognition if name is already good from frame
                    recognizeImageLabel(imgData, instance);
                }
            }, 0);
        } else {
            // Fallback: multi-element or no loaded image — synchronous path
            const result = renderSelectionToImage(elements, engine);
            if (!result) return;
            const singleImg = elements.length === 1 && elements[0].type === 'image';
            imgData = {
                chipId: nextChipId(),
                src: result.dataUrl,
                thumb: result.thumbUrl,
                name: result.name,
                fromSelection: true,
                // Pass original src so recognizeImageLabel caches under the same key as layers
                _originalSrc: singleImg ? (elements[0].src || null) : null,
            };
            state.uploadedImages.push(imgData);
            if (els.editor) insertInlineChip(instance, imgData, els.editor);
            if (singleImg && elements[0].image) {
                recognizeImageLabel(imgData, instance);
            }
            renderUploadedImages(instance);
            updateSendState(instance);
        }
    }

    /**
     * Insert an inline image chip into the contenteditable editor.
     */
    /**
     * Insert an inline image chip into the contenteditable editor.
     * @param {string} position - 'start' to insert at beginning, 'end' to append at end
     */
    /**
     * Insert an inline image chip into the contenteditable editor.
     * @param {string} position - 'start', 'end', or 'cursor' (insert at saved cursor position)
     */
    function insertInlineChip(instance, imgData, editor, position = 'start') {
        const chip = document.createElement('span');
        chip.className = 'gen-inline-chip';
        chip.contentEditable = 'false';
        chip.dataset.chipId = imgData.chipId;
        if (imgData.fromSelection) chip.dataset.fromSelection = 'true';

        const thumb = document.createElement('img');
        thumb.src = imgData.thumb;
        thumb.className = 'gen-chip-thumb';
        thumb.draggable = false;

        const label = document.createElement('span');
        label.className = 'gen-chip-label';
        const fullLabelText = imgData.name || 'image';
        label.dataset.fullLabel = fullLabelText;

        // Selection chips (Text, Image, Circle, Sketch, Frame): always show full label
        // User-uploaded image chips: show abbreviated (≤8 chars), expand on hover
        const isSelectionChip = !!imgData.fromSelection;
        if (isSelectionChip) {
            label.textContent = fullLabelText;
        } else {
            // Truncate long labels; max 8 chars + ellipsis
            label.textContent = fullLabelText.length > 8
                ? fullLabelText.slice(0, 7) + '…'
                : fullLabelText;
        }

        chip.appendChild(thumb);
        chip.appendChild(label);

        let previewEl = null;
        chip.addEventListener('mouseenter', (e) => {
            // Expand abbreviated label on hover (only for non-selection chips)
            if (!isSelectionChip) {
                label.textContent = fullLabelText;
            }

            if (previewEl) return;
            previewEl = document.createElement('div');
            previewEl.className = 'gen-chip-preview';
            const img = document.createElement('img');
            img.src = imgData.src || imgData.thumb;
            img.alt = imgData.name || '';
            previewEl.appendChild(img);
            document.body.appendChild(previewEl);
            const rect = chip.getBoundingClientRect();
            previewEl.style.left = rect.left + 'px';
            previewEl.style.top = (rect.top - 8) + 'px';
            previewEl.style.transform = 'translateY(-100%)';
        });
        chip.addEventListener('mouseleave', () => {
            // Collapse back to abbreviated label on leave (only for non-selection chips)
            if (!isSelectionChip && fullLabelText.length > 8) {
                label.textContent = fullLabelText.slice(0, 7) + '…';
            }

            if (previewEl && previewEl.parentNode) {
                previewEl.parentNode.removeChild(previewEl);
                previewEl = null;
            }
        });

        const space = document.createTextNode('\u00A0');

        if (position === 'cursor' && instance._savedRange) {
            // Insert at saved cursor position
            const range = instance._savedRange;
            range.collapse(false);
            range.insertNode(space);
            range.insertNode(chip);
            // Move cursor after the space
            const sel = window.getSelection();
            const newRange = document.createRange();
            newRange.setStartAfter(space);
            newRange.collapse(true);
            sel.removeAllRanges();
            sel.addRange(newRange);
            instance._savedRange = null;
        } else if (position === 'start' && editor.firstChild) {
            editor.insertBefore(chip, editor.firstChild);
            chip.after(space);
        } else {
            editor.appendChild(chip);
            chip.after(space);
        }
        // Update placeholder visibility
        updateEditorPlaceholder(editor);
    }

    /**
     * Get a cache key from image data URL.
     * Uses a hash of the full base64 data to ensure uniqueness across all images.
     */
    function getImageCacheKey(src) {
        // Simple string hash for uniqueness
        let hash = 0;
        const str = src.length > 500 ? src.slice(-500) + src.slice(100, 300) : src;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + ch;
            hash = hash & hash; // Convert to 32bit integer
        }
        return 'img_' + hash + '_' + src.length;
    }

    /**
     * Update the chip label in the editor DOM.
     */
    function updateChipLabel(instance, imgData, labelText) {
        imgData.name = labelText;
        if (instance.els.editor) {
            const chip = instance.els.editor.querySelector(
                `.gen-inline-chip[data-chip-id="${imgData.chipId}"]`
            );
            if (chip) {
                const chipLabel = chip.querySelector('.gen-chip-label');
                if (chipLabel) {
                    chipLabel.dataset.fullLabel = labelText;
                    const isSelection = !!chip.dataset.fromSelection;
                    if (isSelection || chip.matches(':hover')) {
                        chipLabel.textContent = labelText;
                    } else {
                        chipLabel.textContent = labelText.length > 8
                            ? labelText.slice(0, 7) + '…'
                            : labelText;
                    }
                }
            }
        }
    }

    /**
     * Recognize image label with caching. Cached labels are reused immediately.
     */
    async function recognizeImageLabel(imgData, instance) {
        // Use the original element src as cache key so this label is shared with
        // describeImageElement / getImageLabel (used by the layer panel).
        // Fall back to thumbnail src if no original is available (e.g. uploaded files).
        const originalSrc = imgData._originalSrc || null;
        const cacheKey = getImageCacheKey(originalSrc || imgData.src);

        if (imageLabelCache.has(cacheKey)) {
            updateChipLabel(instance, imgData, imageLabelCache.get(cacheKey));
            // Also refresh layer panel so it picks up this label
            const eng = window.canvasEngine;
            if (eng) eng.render();
            return;
        }

        try {
            // Send the small thumbnail (64px) instead of the full image for speed
            const payload = imgData.thumb || imgData.src;
            const resp = await fetch('/api/describe-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData: payload })
            });
            if (!resp.ok) return;

            const result = await resp.json();
            const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) return;

            // Use only 1-2 words max
            const words = text.split(/[\s,]+/).map(k => k.trim()).filter(Boolean);
            let labelText = words[0] || 'Image';
            if (words[1] && (labelText.length + words[1].length) <= 14) {
                labelText += ' ' + words[1];
            }
            labelText = labelText.charAt(0).toUpperCase() + labelText.slice(1);

            // Cache under the original src key so layer panel (getImageLabel) finds it too
            imageLabelCache.set(cacheKey, labelText);
            _persistLabelCache();

            updateChipLabel(instance, imgData, labelText);

            // Refresh the layer panel if open
            const eng = window.canvasEngine;
            if (eng) eng.render();
        } catch (err) {
            console.warn('[canvas-gen] Image recognition failed:', err);
        }
    }

    // ==================== Event Binding (per instance) ====================

    function bindPanelEvents(instance) {
        const { dom, els } = instance;

        els.addBtn.title = 'Add reference image';
        els.modelSelector.title = 'Model';
        els.countSelector.title = 'Image count';
        els.sendBtn.title = 'Send (Enter)';

        // Collapsed capsule click → expand
        els.collapsed.addEventListener('click', (e) => {
            e.stopPropagation();
            showPanel(instance, 'expanded');
            // Re-collect in case chips were lost (e.g. image load timing after refresh)
            const selEls = instance.state.selectedElements;
            if (selEls && selEls.length > 0 && instance.state.uploadedImages.filter(i => i.fromSelection).length === 0) {
                collectSelectedAsReference(instance, selEls);
            }
            autoFocusEditor(instance);
        });

        // Stop button → abort generation
        els.stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (instance.state.abortController) {
                instance.state.abortController.abort();
            }
        });

        // Prompt input → update send button state
        els.editor.addEventListener('input', () => updateSendState(instance));

        // Add button → file upload (save cursor position before dialog opens)
        els.addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Save current cursor position in the editor
            const sel = window.getSelection();
            if (sel.rangeCount > 0 && els.editor.contains(sel.anchorNode)) {
                instance._savedRange = sel.getRangeAt(0).cloneRange();
            }
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/gif,image/webp';
            input.multiple = true;
            input.onchange = (ev) => handleFileUpload(instance, ev.target.files);
            input.click();
        });

        // Model selector → show model picker
        els.modelSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleModelPicker(instance);
        });

        // Image count selector → show count menu
        els.countSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCountMenu(instance);
        });

        // Count menu items
        els.countMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.menu-item');
            if (!item) return;
            const count = parseInt(item.dataset.count);
            instance.state.imageCount = count;
            updateCountDisplay(instance);
            hideCountMenu(instance);
        });

        // Send button
        els.sendBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handleGenerate(instance);
        });

        // Enter key to send (without shift)
        els.editor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGenerate(instance);
            }
        });

        // Close sub-menus on outside click (use document-level listener)
        const outsideClickHandler = (e) => {
            // Model picker
            const modelPicker = dom.querySelector('.floating-picker');
            if (modelPicker && modelPicker.classList.contains('active') &&
                !modelPicker.contains(e.target) && !els.modelSelector.contains(e.target)) {
                hideModelPicker(instance);
            }
            // Count menu
            if (!els.countMenu.classList.contains('hidden') &&
                !els.countMenu.contains(e.target) && !els.countSelector.contains(e.target)) {
                hideCountMenu(instance);
            }
        };
        document.addEventListener('click', outsideClickHandler);
        // Store reference for potential cleanup
        instance._outsideClickHandler = outsideClickHandler;

        // Prevent canvas events when interacting with gen panel
        dom.addEventListener('mousedown', (e) => e.stopPropagation());
        dom.addEventListener('pointerdown', (e) => e.stopPropagation());
        dom.addEventListener('wheel', (e) => e.stopPropagation());
        els.countMenu.addEventListener('mousedown', (e) => e.stopPropagation());
        els.countMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // ==================== File Upload ====================

    /**
     * Downscale an HTMLImageElement to at most maxPx on the longest side and return
     * a JPEG data URL.  Used to keep API payloads small and generation fast.
     */
    function resizeImageForUpload(img, maxPx = 1024, quality = 0.85) {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        if (w > maxPx || h > maxPx) {
            const scale = maxPx / Math.max(w, h);
            w = Math.round(w * scale);
            h = Math.round(h * scale);
        }
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        return c.toDataURL('image/jpeg', quality);
    }

    function handleFileUpload(instance, files) {
        const MAX_FILE_SIZE = 10 * 1024 * 1024;
        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        Array.from(files).forEach(file => {
            if (!ALLOWED_TYPES.includes(file.type)) {
                showNotification('Unsupported file type: ' + file.name);
                return;
            }
            if (file.size > MAX_FILE_SIZE) {
                showNotification('File too large: ' + file.name + ' (max 10MB)');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const rawDataUrl = e.target.result;
                // Create a thumbnail for the inline chip
                const img = new Image();
                img.onload = () => {
                    const thumbCanvas = document.createElement('canvas');
                    const thumbSize = 64;
                    const aspect = img.naturalWidth / img.naturalHeight;
                    thumbCanvas.width = aspect >= 1 ? thumbSize : Math.round(thumbSize * aspect);
                    thumbCanvas.height = aspect >= 1 ? Math.round(thumbSize / aspect) : thumbSize;
                    const ctx = thumbCanvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, thumbCanvas.width, thumbCanvas.height);
                    const thumbUrl = thumbCanvas.toDataURL('image/jpeg', 0.7);

                    // Downscale to ≤1024px JPEG so the API upload is fast regardless of
                    // original file size.
                    const compressedSrc = resizeImageForUpload(img, 1024, 0.85);

                    // Extract short name from filename
                    const shortName = file.name.replace(/\.[^.]+$/, '').slice(0, 15);

                    const imgData = {
                        chipId: nextChipId(),
                        src: compressedSrc,
                        thumb: thumbUrl,
                        name: shortName || 'image',
                    };
                    instance.state.uploadedImages.push(imgData);

                    // Insert inline chip at cursor position (or end if no saved position)
                    if (instance.els.editor) {
                        insertInlineChip(instance, imgData, instance.els.editor,
                            instance._savedRange ? 'cursor' : 'end');
                    }
                    updateSendState(instance);
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
        });
    }

    // No-op: all images are inline chips now
    function renderUploadedImages() { }

    // ==================== Model Picker ====================
    function toggleModelPicker(instance) {
        const picker = instance.dom.querySelector('.floating-picker');
        if (picker && picker.classList.contains('active')) {
            hideModelPicker(instance);
        } else {
            showModelPicker(instance);
        }
    }

    function showModelPicker(instance) {
        const { dom, state, els } = instance;

        // Close count menu first (mutually exclusive)
        hideCountMenu(instance);

        let picker = dom.querySelector('.floating-picker');
        if (!picker) {
            picker = document.createElement('div');
            picker.className = 'floating-picker model-picker-panel';
            els.expanded.appendChild(picker);

            picker.addEventListener('mousedown', (e) => e.stopPropagation());
            picker.addEventListener('pointerdown', (e) => e.stopPropagation());
        }

        renderModelPickerContent(picker, instance);

        picker.classList.add('active');
        picker.classList.remove('hidden');
    }

    function renderModelPickerContent(picker, instance) {
        const { state } = instance;
        picker.innerHTML = `
            <div class="picker-header">
                <span>Models</span>
                <div class="auto-toggle-inline">
                    <span>Auto</span>
                    <label class="toggle-switch-sm">
                        <input type="checkbox" class="gen-auto-toggle" ${state.isAutoMode ? 'checked' : ''}>
                        <span class="toggle-slider-sm"></span>
                    </label>
                </div>
            </div>
            ${MODELS.map(m => `
                <div class="picker-item model-item-picker ${(state.isAutoMode || state.selectedModel === m.id) ? 'selected' : ''}"
                     data-model="${m.id}" data-name="${m.name}">
                    <div class="model-icon-sm">${m.icon}</div>
                    <div class="model-info-sm">
                        <div class="model-name-sm">
                            ${m.name}
                            ${m.tags.map(t => `<span class="tag-sm ${t === 'Hot' ? 'hot' : 'time'}">${t}</span>`).join('')}
                        </div>
                        <p class="model-desc-sm">${m.desc}</p>
                    </div>
                    <span class="check-icon-sm">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" stroke-width="2">
                            <polyline points="20 6 9 17 4 12"/>
                        </svg>
                    </span>
                </div>
            `).join('')}
        `;

        // Auto toggle handler
        const autoToggle = picker.querySelector('.gen-auto-toggle');
        if (autoToggle) {
            autoToggle.addEventListener('change', (e) => {
                state.isAutoMode = e.target.checked;
                if (state.isAutoMode) {
                    state.selectedModel = null;
                    state.selectedModelName = 'Auto';
                }
                updateModelDisplay(instance);
                renderModelPickerContent(picker, instance);
            });
        }

        // Model item click handlers
        picker.querySelectorAll('.model-item-picker').forEach(item => {
            item.addEventListener('click', () => {
                state.isAutoMode = false;
                state.selectedModel = item.dataset.model;
                state.selectedModelName = item.dataset.name;
                updateModelDisplay(instance);
                hideModelPicker(instance);
            });
        });
    }

    function hideModelPicker(instance) {
        const picker = instance.dom.querySelector('.floating-picker');
        if (picker) {
            picker.classList.remove('active');
            picker.classList.add('hidden');
        }
    }

    function updateModelDisplay(instance) {
        if (instance.els.modelLabel) {
            instance.els.modelLabel.textContent = instance.state.selectedModelName;
        }
    }

    // ==================== Image Count ====================
    function toggleCountMenu(instance) {
        if (instance.els.countMenu.classList.contains('hidden')) {
            showCountMenu(instance);
        } else {
            hideCountMenu(instance);
        }
    }

    function showCountMenu(instance) {
        const { els, state } = instance;

        // Close model picker first (mutually exclusive)
        hideModelPicker(instance);

        const selectorRect = els.countSelector.getBoundingClientRect();

        // Position above the count selector using fixed positioning
        els.countMenu.style.left = selectorRect.left + 'px';
        els.countMenu.style.top = (selectorRect.top - 8) + 'px';
        els.countMenu.style.transform = 'translateY(-100%)';
        els.countMenu.classList.remove('hidden');

        // Mark active item
        els.countMenu.querySelectorAll('.menu-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.count) === state.imageCount);
        });
    }

    function hideCountMenu(instance) {
        if (instance.els.countMenu) {
            instance.els.countMenu.classList.add('hidden');
        }
    }

    function updateCountDisplay(instance) {
        if (instance.els.countLabel) {
            instance.els.countLabel.textContent = instance.state.imageCount === 1
                ? '1 Image'
                : instance.state.imageCount + ' Images';
        }
    }

    /**
     * Auto-name a frame by recognizing the generated image content.
     * Uses /api/describe-image to get a short descriptive name (≤20 chars).
     */
    async function autoNameFrame(frame, imageDataUrl) {
        try {
            const resp = await fetch('/api/describe-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData: imageDataUrl })
            });
            if (!resp.ok) return;

            const result = await resp.json();
            const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) return;

            // Take first 1-2 keywords as the frame name
            const keywords = text.split(',').map(k => k.trim()).filter(Boolean);
            let name = keywords.slice(0, 2).join(' ');
            if (name.length > 20) name = name.slice(0, 20).trim();
            name = name.charAt(0).toUpperCase() + name.slice(1);

            if (name) {
                frame.name = name;
                if (window.canvasEngine) window.canvasEngine.render();
            }
        } catch (err) {
            console.warn('[canvas-gen] Auto-naming frame failed:', err);
        }
    }

    /**
     * Derive an immediate placeholder name from the user prompt.
     * Uses the first 1–3 meaningful words, capitalised.
     */
    function quickNameFromPrompt(prompt) {
        if (!prompt) return null;
        // Strip quoted image labels like «photo» and punctuation
        const words = prompt
            .replace(/«[^»]*»/g, '')
            .replace(/[^a-zA-Z0-9\u4e00-\u9fff\s]/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(w => w.length > 1);
        if (!words.length) return null;
        let name = words.slice(0, 3).join(' ');
        if (name.length > 20) name = name.slice(0, 20).trim();
        return name.charAt(0).toUpperCase() + name.slice(1);
    }

    /**
     * Extract the user-typed text from the editor, excluding inline chip text.
     */
    function getEditorPrompt(editor) {
        if (!editor) return '';
        // Clone editor to manipulate without affecting DOM
        const clone = editor.cloneNode(true);
        clone.querySelectorAll('.gen-inline-chip').forEach(c => c.remove());
        return clone.textContent.trim();
    }

    // ==================== Send State ====================
    function updateSendState(instance) {
        const { els, state } = instance;
        const text = getEditorPrompt(els.editor);
        const hasContent = text.length > 0 || state.uploadedImages.length > 0;
        els.sendBtn.disabled = !hasContent;
        updateEditorPlaceholder(els.editor);
    }

    /**
     * Toggle a 'show-placeholder' class on the editor when there's no typed text.
     * This allows showing placeholder even when inline chips are present.
     */
    function updateEditorPlaceholder(editor) {
        if (!editor) return;
        const text = getEditorPrompt(editor);
        if (text.length === 0) {
            editor.classList.add('show-placeholder');
        } else {
            editor.classList.remove('show-placeholder');
        }
    }

    // ==================== Layout Helpers ====================

    /**
     * Ensure the shorter side is at least minSize (default 1080).
     * This is a DEFAULT only — returns adjusted values without modifying originals.
     * @param {number} w  - original width
     * @param {number} h  - original height
     * @param {number} [minSize=1080] - minimum value for the shorter side
     * @returns {{ w: number, h: number }}
     */
    function ensureFrameMinSize(w, h, minSize = 1080) {
        const shorter = Math.min(w, h);
        if (shorter < minSize) {
            const scale = minSize / shorter;
            return { w: Math.round(w * scale), h: Math.round(h * scale) };
        }
        return { w: Math.round(w), h: Math.round(h) };
    }

    /**
     * Check if an element is visually inside a frame (>50% overlap by area).
     */
    function isElementInsideFrame(el, frame) {
        const overlapX = Math.max(0,
            Math.min(el.x + el.width, frame.x + frame.width) - Math.max(el.x, frame.x));
        const overlapY = Math.max(0,
            Math.min(el.y + el.height, frame.y + frame.height) - Math.max(el.y, frame.y));
        const overlapArea = overlapX * overlapY;
        const elArea = el.width * el.height;
        return elArea > 0 && (overlapArea / elArea) > 0.5;
    }

    /**
     * Push all top-level elements (and their frame children) to the right
     * if their left edge >= startX. Used to make room for new generated frames.
     */
    function pushElementsRight(engine, startX, shiftAmount, excludeSet) {
        engine.elements.forEach(el => {
            if (excludeSet && excludeSet.has(el)) return;
            if (el.parentFrame) return; // Children move with their parent frame
            if (el.x >= startX) {
                el.x += shiftAmount;
                // Also move children of frames
                if (el.type === 'frame') {
                    engine.getFrameChildren(el).forEach(child => {
                        child.x += shiftAmount;
                    });
                }
            }
        });
    }

    // ==================== API Call & Generation ====================
    async function handleGenerate(instance) {
        const { els, state } = instance;
        const prompt = getEditorPrompt(els.editor);
        const anchor = state.currentAnchor;

        if (!anchor) return;
        if (!prompt && state.uploadedImages.length === 0) return;

        const modelId = state.isAutoMode ? 'nano-banana' : state.selectedModel;
        const modelConfig = MODEL_CONFIGS[modelId];
        if (!modelConfig) {
            showNotification('Selected model is not yet available.');
            return;
        }

        const engine = window.canvasEngine;
        if (!engine) return;

        // Snapshot context
        const genContext = {
            frame: state.currentFrame,
            anchor: { ...anchor },
            images: [...state.uploadedImages],
            imageCount: state.imageCount,
            selectedElements: [...state.selectedElements],
        };

        state.isGenerating = true;
        // Hide panel during generation — only the cancel overlay is shown.
        els.editor.textContent = '';
        state.uploadedImages = [];
        renderUploadedImages(instance);
        hidePanel(instance);

        const abortController = new AbortController();
        state.abortController = abortController;
        els.sendBtn.disabled = true;

        // Save the pre-generation state so Cmd+Z can jump back to BEFORE generation,
        // then suppress all further saveState() calls until generation completes —
        // intermediate "frame with loading overlay" states must not pollute the undo stack.
        engine.saveState();
        engine._suppressHistory = true;

        // Cancel overlays will be created after target slots are ready
        let cancelOverlayGroup = null;

        // Determine generation mode
        const sourceFrame = genContext.frame;
        const selectedElements = genContext.selectedElements;
        // Check for images inside the frame (by parentFrame or by position overlap)
        const isReplaceMode = sourceFrame && (
            selectedElements.some(el => el !== sourceFrame && el.type !== 'frame') ||
            engine.elements.some(el => el.parentFrame === sourceFrame && el.type === 'image') ||
            engine.elements.some(el => !el.parentFrame && el.type === 'image' &&
                isElementInsideFrame(el, sourceFrame))
        );

        let refRect = sourceFrame || genContext.anchor;
        const FRAME_GAP = 30;

        if (!sourceFrame) {
            // Use the already-captured prompt (editor may have been cleared by now)
            const promptForRatio = prompt || '';
            const ratioMatch = promptForRatio.match(/\b(\d+)\s*[:\uFF1A]\s*(\d+)\b/);
            let w = 1080, h = 1080;
            if (ratioMatch && parseInt(ratioMatch[1]) > 0 && parseInt(ratioMatch[2]) > 0) {
                const rW = parseInt(ratioMatch[1]), rH = parseInt(ratioMatch[2]);
                const ratio = rW / rH;
                // Use 1080 as minimum base so the shorter side is always >= 1080
                const base = 1080;
                w = ratio >= 1 ? Math.round(base * ratio) : base;
                h = ratio >= 1 ? base : Math.round(base / ratio);
            } else {
                const firstImg = selectedElements.find(el => el.type === 'image' && el.image);
                if (firstImg && firstImg.image) {
                    const nw = firstImg.image.naturalWidth || firstImg.width || 1080;
                    const nh = firstImg.image.naturalHeight || firstImg.height || 1080;
                    // Apply 1080 minimum on shorter side as default
                    const sized = ensureFrameMinSize(nw, nh);
                    w = sized.w;
                    h = sized.h;
                }
            }
            refRect = { x: genContext.anchor.x, y: genContext.anchor.y, width: w, height: h };
        } else if (isReplaceMode && sourceFrame) {
            // Replace mode: if user specified a ratio, compute new size based on source image's shortest side
            const ratioMatch = prompt.match(/\b(\d+)\s*[:\uFF1A]\s*(\d+)\b/);
            if (ratioMatch && parseInt(ratioMatch[1]) > 0 && parseInt(ratioMatch[2]) > 0) {
                const rW = parseInt(ratioMatch[1]), rH = parseInt(ratioMatch[2]);
                const userRatio = rW / rH;
                // Find source image natural size inside the frame
                const srcImg = engine.elements.find(el =>
                    el.type === 'image' && el.parentFrame === sourceFrame && el.image
                );
                let base;
                if (srcImg && srcImg.image) {
                    // Use natural resolution: base = shorter side of original image
                    base = Math.min(srcImg.image.naturalWidth, srcImg.image.naturalHeight);
                } else {
                    // Fallback: use frame's shorter side
                    base = Math.min(sourceFrame.width, sourceFrame.height);
                }
                const newW = userRatio >= 1 ? Math.round(base * userRatio) : base;
                const newH = userRatio >= 1 ? base : Math.round(base / userRatio);
                // Update refRect and resize the source frame and any new frames to new size
                refRect = { x: sourceFrame.x, y: sourceFrame.y, width: newW, height: newH };
                sourceFrame.width = newW;
                sourceFrame.height = newH;
            }
        }

        // --- PRE-CREATE placeholder frames for multi-image ---
        // Place new frames adjacent to source frame and push existing content
        const targetSlots = []; // { frame, isNew }
        const numNewFrames = genContext.imageCount - (sourceFrame ? 1 : 0);

        if (sourceFrame && numNewFrames > 0) {
            // Push existing elements to the right to make room for new frames
            const pushStartX = sourceFrame.x + sourceFrame.width;
            const pushAmount = numNewFrames * (refRect.width + FRAME_GAP);
            const excludeSet = new Set([sourceFrame]);
            // Include source frame children in exclude set
            engine.getFrameChildren(sourceFrame).forEach(c => excludeSet.add(c));
            pushElementsRight(engine, pushStartX, pushAmount, excludeSet);
        }

        if (isReplaceMode && sourceFrame) {
            // Replace mode — mark source frame as loading (overlay on image)
            sourceFrame._generating = true;
            sourceFrame._genStartTime = performance.now();
            targetSlots.push({ frame: sourceFrame, isNew: false });

            // Additional images get new frames adjacent to the right
            for (let i = 1; i < genContext.imageCount; i++) {
                const x = sourceFrame.x + (refRect.width + FRAME_GAP) * i;
                const y = sourceFrame.y;
                const f = createEmptyFrame(engine, x, y, refRect.width, refRect.height, sourceFrame.fill);
                f._generating = true;
                f._genStartTime = performance.now();
                targetSlots.push({ frame: f, isNew: true });
            }
        } else if (sourceFrame) {
            // Empty frame selected — first image goes into it
            sourceFrame._generating = true;
            sourceFrame._genStartTime = performance.now();
            targetSlots.push({ frame: sourceFrame, isNew: false });

            // Additional frames adjacent to the right
            for (let i = 1; i < genContext.imageCount; i++) {
                const x = sourceFrame.x + (refRect.width + FRAME_GAP) * i;
                const y = sourceFrame.y;
                const f = createEmptyFrame(engine, x, y, refRect.width, refRect.height, sourceFrame.fill);
                f._generating = true;
                f._genStartTime = performance.now();
                targetSlots.push({ frame: f, isNew: true });
            }
        } else {
            // No frame — create new frames to the right of operated content (anchor)
            const anchor = genContext.anchor;
            const startX = anchor.x + (anchor.width || refRect.width) + FRAME_GAP;
            const startY = anchor.y;
            for (let i = 0; i < genContext.imageCount; i++) {
                const x = startX + (refRect.width + FRAME_GAP) * i;
                const y = startY;
                const f = createEmptyFrame(engine, x, y, refRect.width, refRect.height, '#FFFFFF');
                f._generating = true;
                f._genStartTime = performance.now();
                targetSlots.push({ frame: f, isNew: true });
            }
        }

        engine.render();
        startFrameLoadingAnimation();

        // Persist generation state so it can be resumed after a page refresh
        const _genProjectId = new URLSearchParams(window.location.search).get('id');
        if (_genProjectId) {
            saveGenState(_genProjectId, {
                frames: targetSlots.map(s => ({
                    x: s.frame.x, y: s.frame.y,
                    width: s.frame.width, height: s.frame.height,
                    isNew: s.isNew
                })),
                prompt,
                modelId: state.isAutoMode ? 'nano-banana' : state.selectedModel,
                imageCount: genContext.imageCount,
                timestamp: Date.now()
            });
        }

        // Show per-frame cancel overlays now that slots are created
        cancelOverlayGroup = showCancelOverlays(targetSlots, abortController);

        // --- Build request body ---
        const parts = [];
        const textPrompt = prompt || 'Generate a high-quality image based on the reference image(s) provided.';
        parts.push({ text: textPrompt });

        for (const img of genContext.images) {
            const match = img.src.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
                parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
        }

        // --- Resolution / quality: user-specified takes priority, else 1K default ---
        // 1K is the default: frames are typically 1080px, the response is much smaller
        // (faster download), and quality is indistinguishable at canvas viewing distances.
        // Users can request higher quality by including "2k" or "4k" in the prompt.
        let imageSize = '1K';
        if (/\b4[kK]\b/.test(prompt)) imageSize = '4K';
        else if (/\b2[kK]\b/.test(prompt)) imageSize = '2K';
        else if (/\b1[kK]\b/.test(prompt)) imageSize = '1K';

        // --- Aspect ratio: user-specified (e.g. "16:9") takes priority, else Frame dimensions ---
        let aspectRatio;
        const ratioMatch = prompt.match(/\b(\d+)\s*[:\uFF1A]\s*(\d+)\b/);
        if (ratioMatch) {
            const rW = parseInt(ratioMatch[1]);
            const rH = parseInt(ratioMatch[2]);
            if (rW > 0 && rH > 0) {
                const userRatio = rW / rH;
                let best = SUPPORTED_RATIOS[0], bestDiff = Math.abs(userRatio - best.value);
                for (const sr of SUPPORTED_RATIOS) {
                    const d = Math.abs(userRatio - sr.value);
                    if (d < bestDiff) { bestDiff = d; best = sr; }
                }
                aspectRatio = best.label;
            } else {
                aspectRatio = getClosestAspectRatio(refRect.width, refRect.height);
            }
        } else {
            aspectRatio = getClosestAspectRatio(refRect.width, refRect.height);
        }

        const requestBody = {
            contents: [{
                role: 'user',
                parts
            }],
            generationConfig: {
                responseModalities: ['TEXT', 'IMAGE'],
                imageConfig: {
                    aspectRatio,
                    imageSize
                }
            }
        };

        // --- Bug 3: Fire all generations in PARALLEL, fill slots as they complete ---
        let anySuccess = false;

        const generateOne = async (slotIndex) => {
            const slot = targetSlots[slotIndex];
            if (!slot || abortController.signal.aborted) return;

            let lastError = null;
            for (let attempt = 0; attempt < 3; attempt++) {
                if (abortController.signal.aborted) return;
                try {
                    const result = await callGenerateApi(modelConfig, requestBody, abortController);
                    if (result) {
                        // Load into Image object
                        const img = await loadImageFromData(result.dataUrl);
                        placeImageIntoFrame(engine, slot.frame, img, result.dataUrl, isReplaceMode && slotIndex === 0, textPrompt);
                        anySuccess = true;
                        lastError = null;
                        break;
                    }
                } catch (e) {
                    if (e.name === 'AbortError') return;
                    lastError = e;
                    console.warn('Slot ' + slotIndex + ' attempt ' + (attempt + 1) + ' failed:', e.message);
                    if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                }
            }

            // Clear loading on this slot regardless
            slot.frame._generating = false;
            delete slot.frame._genStartTime;

            if (lastError) {
                console.error('Slot ' + slotIndex + ' failed after retries:', lastError.message);
                // Remove empty new frame on failure
                if (slot.isNew && !engine.elements.some(el => el.parentFrame === slot.frame && el.type === 'image')) {
                    const idx = engine.elements.indexOf(slot.frame);
                    if (idx !== -1) engine.elements.splice(idx, 1);
                }
            }
            engine.render();
        };

        try {
            // Launch all in parallel
            await Promise.all(targetSlots.map((_, i) => generateOne(i)));

            if (abortController.signal.aborted) {
                showNotification('Generation stopped.');
            } else if (!anySuccess) {
                showNotification('No images were generated. Please try again.');
            }

            // Clear input after success
            if (anySuccess) {
                els.editor.textContent = '';
                state.uploadedImages = [];
                renderUploadedImages(instance);
            }
        } catch (error) {
            if (error.name !== 'AbortError') {
                console.error('[canvas-gen] Generation failed:', error);
                showNotification('Generation failed: ' + error.message);
            }
        } finally {
            state.isGenerating = false;
            state.abortController = null;
            // Clear persisted generation state (completed or cancelled)
            if (_genProjectId) clearGenState(_genProjectId);
            // Clear loading states and remove empty new frames (e.g. after cancel)
            targetSlots.forEach(s => {
                s.frame._generating = false;
                delete s.frame._genStartTime;
                // Remove new frames that never received an image (cancelled or failed)
                if (s.isNew && !engine.elements.some(el => el.parentFrame === s.frame && el.type === 'image')) {
                    const idx = engine.elements.indexOf(s.frame);
                    if (idx !== -1) engine.elements.splice(idx, 1);
                }
            });
            // Re-enable history and save the final post-generation state so it is
            // reachable via Cmd+Shift+Z (redo) but the noisy intermediate states are gone.
            engine._suppressHistory = false;
            engine.saveState();
            // Remove all cancel overlays
            if (cancelOverlayGroup) cancelOverlayGroup.removeAll();
            // Deselect and hide panel after generation completes
            hidePanel(instance);
            if (engine) {
                engine.selectedElements = [];
                if (engine.onSelectionChange) engine.onSelectionChange([]);
                engine.render();
            }
        }
    }

    /**
     * Create an empty frame and add to engine.
     */
    function createEmptyFrame(engine, x, y, width, height, fill) {
        const frameCount = engine.elements.filter(el => el.type === 'frame').length + 1;
        const frame = {
            type: 'frame',
            name: 'Frame ' + frameCount,
            x, y, width, height,
            fill: fill || '#FFFFFF',
            stroke: '#E0E0E0',
            strokeWidth: 1
        };
        engine.saveState();
        engine.elements.push(frame);
        return frame;
    }

    /**
     * Place a loaded image into a frame.
     * Resizes the frame to match the image's aspect ratio so the image is not
     * squashed or stretched (frame adapts to image, not the other way around).
     * If isReplace=true, remove existing images in the frame first.
     */
    function placeImageIntoFrame(engine, frame, img, dataUrl, isReplace, promptHint) {
        if (isReplace) {
            const old = engine.elements.filter(el =>
                el.type === 'image' && (
                    el.parentFrame === frame ||
                    (!el.parentFrame && isElementInsideFrame(el, frame))
                )
            );
            old.forEach(child => {
                const idx = engine.elements.indexOf(child);
                if (idx !== -1) engine.elements.splice(idx, 1);
            });
        }

        const iw = img.naturalWidth || img.width || 1;
        const ih = img.naturalHeight || img.height || 1;
        const imageAspect = iw / ih;

        // Resize the frame to match the generated image's aspect ratio while keeping
        // the frame's current longest side as the reference dimension.
        // This preserves the layout the user set up (frame size stays similar),
        // only the aspect ratio adjusts to fit the actual image.
        const maxSide = Math.max(frame.width, frame.height);
        let newW, newH;
        if (imageAspect >= 1) {
            newW = maxSide;
            newH = Math.round(maxSide / imageAspect);
        } else {
            newH = maxSide;
            newW = Math.round(maxSide * imageAspect);
        }
        const centerX = frame.x + frame.width / 2;
        const centerY = frame.y + frame.height / 2;
        frame.x = centerX - newW / 2;
        frame.y = centerY - newH / 2;
        frame.width = newW;
        frame.height = newH;

        const imageElement = {
            type: 'image',
            x: frame.x,
            y: frame.y,
            width: frame.width,
            height: frame.height,
            image: img,
            src: dataUrl,
            parentFrame: frame
        };

        // Insert image BEFORE any existing non-image children of this frame
        // so that text/shapes/paths added to the frame remain visually on top of images.
        const firstNonImageChildIndex = engine.elements.findIndex(
            el => el.parentFrame === frame && el.type !== 'image'
        );
        if (firstNonImageChildIndex !== -1) {
            engine.elements.splice(firstNonImageChildIndex, 0, imageElement);
        } else {
            engine.elements.push(imageElement);
        }

        // Give the frame an instant name from the prompt so the label is never blank.
        // autoNameFrame will overwrite with a more descriptive AI-derived name later.
        const immediate = quickNameFromPrompt(promptHint);
        if (immediate && (!frame.name || frame.name === 'Frame')) {
            frame.name = immediate;
        }

        autoNameFrame(frame, dataUrl);

        if (typeof engine.saveState === 'function') engine.saveState();
    }

    function loadImageFromData(dataUrl) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('Failed to load generated image'));
            img.src = dataUrl;
        });
    }

    async function callGenerateApi(modelConfig, requestBody, abortController) {
        const payload = { ...requestBody, model: modelConfig.model };

        const fetchOptions = {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        };

        if (abortController) {
            fetchOptions.signal = abortController.signal;
        }

        const response = await fetch(modelConfig.endpoint, fetchOptions);

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            const msg = errorData.error?.message || ('HTTP ' + response.status);
            throw new Error(msg);
        }

        const data = await response.json();

        const candidates = data.candidates || [];
        for (const candidate of candidates) {
            const parts = candidate?.content?.parts || [];
            for (const part of parts) {
                if (part.inlineData) {
                    const mimeType = part.inlineData.mimeType || 'image/png';
                    const base64 = part.inlineData.data;
                    return { dataUrl: 'data:' + mimeType + ';base64,' + base64 };
                }
            }
        }

        return null;
    }

    // ==================== Notifications ====================
    function showNotification(message) {
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;background:#090C14;color:white;padding:12px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;font-size:14px;font-weight:500;animation:slideIn 0.3s ease;max-width:400px;';
        toast.textContent = message;

        if (!document.getElementById('gen-toast-styles')) {
            const style = document.createElement('style');
            style.id = 'gen-toast-styles';
            style.textContent = '@keyframes slideIn{from{transform:translateX(100%);opacity:0}to{transform:translateX(0);opacity:1}}';
            document.head.appendChild(style);
        }

        document.body.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 5000);
    }

    // ==================== Initialization ====================
    function initGenPanel() {
        const engine = window.canvasEngine;
        if (!engine) {
            console.warn('[canvas-gen] Canvas engine not available');
            return;
        }

        const template = document.getElementById('gen-panel-template');
        if (!template) {
            console.warn('[canvas-gen] gen-panel-template not found');
            return;
        }

        // Chain into existing onSelectionChange (set by canvas.js for action bar)
        const existingSelectionHandler = engine.onSelectionChange;
        let _lastSelectionKey = null; // Track previous selection to avoid redundant updates

        engine.onSelectionChange = (selectedElements) => {
            // Call existing handler first (frame-action-bar logic)
            if (existingSelectionHandler) existingSelectionHandler(selectedElements);

            // Hide gen panels while editing text inline
            if (engine.editingText) {
                for (const [, inst] of panelRegistry) {
                    if (!inst.state.isGenerating) {
                        hidePanel(inst);
                    }
                }
                _lastSelectionKey = null;
                return;
            }

            // Compute current key and skip if selection hasn't actually changed
            const currentKey = selectedElements.length > 0 ? getPanelKey(selectedElements) : null;
            if (currentKey === _lastSelectionKey) return;
            _lastSelectionKey = currentKey;

            // Hide all non-generating panels; generating panels stay visible
            for (const [key, inst] of panelRegistry) {
                if (!inst.state.isGenerating) {
                    hidePanel(inst);
                }
            }

            // Clean up stale panels (not generating, not currently selected)
            for (const [key, inst] of panelRegistry) {
                if (!inst.state.isGenerating && key !== currentKey) {
                    removePanel(key);
                }
            }

            if (selectedElements.length === 0) return;

            const hasGeneratingFrame = selectedElements.some(el =>
                el.type === 'frame' && el._generating
            );
            if (hasGeneratingFrame) {
                for (const [, inst] of panelRegistry) {
                    hidePanel(inst);
                }
                return;
            }

            const key = currentKey;
            const instance = getOrCreatePanel(key);
            if (!instance) return;

            // If this panel is currently generating, don't override its thinking state
            if (instance.state.isGenerating) {
                return;
            }

            const frame = selectedElements.find(el => el.type === 'frame');
            instance.state.selectedElements = [...selectedElements];

            if (selectedElements.length === 1 && frame) {
                instance.state.currentFrame = frame;
                instance.state.currentAnchor = frame;

                if (frame._justCreated) {
                    showPanel(instance, 'expanded');
                    autoFocusEditor(instance);
                } else {
                    showPanel(instance, 'collapsed');
                }
            } else {
                instance.state.currentFrame = findParentFrame(selectedElements);
                instance.state.currentAnchor = getSelectionBounds(selectedElements);
                showPanel(instance, 'collapsed');
            }

            collectSelectedAsReference(instance, selectedElements);
        };

        // Chain into render loop for position updates on ALL visible panels
        const existingRender = engine.render.bind(engine);
        engine.render = () => {
            existingRender();
            for (const [key, inst] of panelRegistry) {
                if (inst.state.panelMode !== 'hidden') {
                    // Recompute anchor from live element positions (for drag follow)
                    if (inst.state.selectedElements && inst.state.selectedElements.length > 0) {
                        if (inst.state.selectedElements.length === 1 && inst.state.selectedElements[0].type === 'frame') {
                            inst.state.currentAnchor = inst.state.selectedElements[0];
                        } else {
                            inst.state.currentAnchor = getSelectionBounds(inst.state.selectedElements);
                        }
                    }
                    if (inst.state.currentAnchor) {
                        updatePanelPosition(inst);
                    }
                }
            }
        };

        // Expose global helper so canvas.js Tab shortcut can expand+focus the active panel.
        // Robust: if no panel exists yet, create one from the current engine selection.
        window.canvasGenFocusPanel = () => {
            const selectedElements = engine.selectedElements;
            if (!selectedElements || selectedElements.length === 0) return;

            // Don't expand the panel if any selected frame is currently generating.
            // The cancel overlay is already shown; Tab should not open the input box on top.
            const hasGeneratingFrame = selectedElements.some(el => el._generating) ||
                engine.elements.some(el => el._generating &&
                    selectedElements.some(sel => sel === el || sel === el.parentFrame));
            if (hasGeneratingFrame) return;

            // Try to find an existing visible panel first
            let target = null;
            for (const [, inst] of panelRegistry) {
                if (inst.state.panelMode !== 'hidden' && !inst.state.isGenerating) {
                    target = inst;
                    break;
                }
            }

            // If no visible panel exists, create one from the current selection
            if (!target) {
                const key = getPanelKey(selectedElements);
                target = getOrCreatePanel(key);
                if (!target) return;

                const frame = selectedElements.find(el => el.type === 'frame');
                target.state.selectedElements = [...selectedElements];
                if (selectedElements.length === 1 && frame) {
                    target.state.currentFrame = frame;
                    target.state.currentAnchor = frame;
                } else {
                    target.state.currentFrame = findParentFrame(selectedElements);
                    target.state.currentAnchor = getSelectionBounds(selectedElements);
                }
                _lastSelectionKey = key;
            }

            showPanel(target, 'expanded');

            // Re-collect selected elements as reference image chip.
            // Run AFTER showPanel so the editor DOM is visible and can receive chips.
            const selEls = target.state.selectedElements;
            if (selEls && selEls.length > 0) {
                collectSelectedAsReference(target, selEls);
            }

            autoFocusEditor(target);
        };

        console.log('[canvas-gen] Multi-instance generation panel initialized');
    }

    // ==================== Cancel Overlay ====================

    /**
     * Show a floating "Cancel" overlay for each generating frame.
     * Returns an array of overlay DOM elements so the caller can remove them all.
     */
    function showCancelOverlays(targetSlots, abortController) {
        const overlays = [];
        const CANCEL_INSET_FROM_BOTTOM = 28;

        targetSlots.forEach(slot => {
            const overlay = document.createElement('div');
            overlay.className = 'gen-cancel-overlay';
            overlay.textContent = 'Cancel';
            overlay.addEventListener('click', () => {
                abortController.abort();
            });
            document.body.appendChild(overlay);
            overlays.push({ el: overlay, frame: slot.frame });
        });

        let raf;
        function tick() {
            const engine = window.canvasEngine;
            if (!engine) { raf = null; return; }
            const rect = engine.canvas.getBoundingClientRect();
            let anyAlive = false;
            overlays.forEach(o => {
                if (!o.el.parentNode) return;
                if (!o.frame._generating) {
                    o.el.remove();
                    return;
                }
                anyAlive = true;
                const center = engine.worldToScreen(
                    o.frame.x + o.frame.width / 2,
                    o.frame.y + o.frame.height
                );
                o.el.style.left = (rect.left + center.x) + 'px';
                o.el.style.top = (rect.top + center.y - CANCEL_INSET_FROM_BOTTOM) + 'px';
            });
            if (anyAlive) raf = requestAnimationFrame(tick);
            else raf = null;
        }
        raf = requestAnimationFrame(tick);

        return {
            removeAll() {
                if (raf) cancelAnimationFrame(raf);
                overlays.forEach(o => { if (o.el.parentNode) o.el.remove(); });
            }
        };
    }

    // ==================== Frame Loading Animation ====================
    let _frameAnimRAF = null;
    function startFrameLoadingAnimation() {
        if (_frameAnimRAF) return; // already running
        function tick() {
            const engine = window.canvasEngine;
            if (!engine) { _frameAnimRAF = null; return; }
            // Check if any frame is still generating
            const anyLoading = engine.elements.some(el => el._generating);
            if (!anyLoading) {
                _frameAnimRAF = null;
                engine.render();
                return;
            }
            engine.render();
            _frameAnimRAF = requestAnimationFrame(tick);
        }
        _frameAnimRAF = requestAnimationFrame(tick);
    }

    // ==================== Auto-Generation API ====================

    /**
     * Programmatically create a 1:1 Frame at the canvas centre, populate the
     * gen-panel with the given prompt, and start generation immediately.
     * Called by canvas.js when the canvas was opened from the homepage with
     * a pre-supplied prompt (autoGen=1 query param).
     */
    window.GenPanel = {
        /**
         * Resume a generation that was interrupted by a page refresh.
         * Finds the matching frames, re-marks them as generating, and re-calls the API.
         */
        async resumePending(projectId) {
            const saved = loadGenState(projectId);
            if (!saved) return;

            const engine = window.canvasEngine;
            if (!engine) return;

            const modelId = saved.modelId || 'nano-banana';
            const modelConfig = MODEL_CONFIGS[modelId];
            if (!modelConfig) { clearGenState(projectId); return; }

            // Find matching frames by coordinate proximity
            const targetSlots = [];
            for (const fd of (saved.frames || [])) {
                const frame = engine.elements.find(el =>
                    el.type === 'frame' &&
                    Math.abs(el.x - fd.x) < 2 &&
                    Math.abs(el.y - fd.y) < 2 &&
                    Math.abs(el.width - fd.width) < 2 &&
                    Math.abs(el.height - fd.height) < 2
                );
                if (frame) {
                    frame._generating = true;
                    frame._genStartTime = performance.now();
                    targetSlots.push({ frame, isNew: fd.isNew || false });
                }
            }

            if (targetSlots.length === 0) { clearGenState(projectId); return; }

            engine.render();
            startFrameLoadingAnimation();

            const abortController = new AbortController();
            const cancelOverlayGroup = showCancelOverlays(targetSlots, abortController);

            const textPrompt = saved.prompt || 'Generate a high-quality image.';
            const sourceFrame = targetSlots[0].frame;
            const aspectRatio = getClosestAspectRatio(sourceFrame.width, sourceFrame.height);
            const requestBody = {
                contents: [{ role: 'user', parts: [{ text: textPrompt }] }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: { aspectRatio, imageSize: '1K' }
                }
            };

            try {
                await Promise.all(targetSlots.map(async (slot) => {
                    if (abortController.signal.aborted) return;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        if (abortController.signal.aborted) return;
                        try {
                            const result = await callGenerateApi(modelConfig, requestBody, abortController);
                            if (result) {
                                const img = await loadImageFromData(result.dataUrl);
                                placeImageIntoFrame(engine, slot.frame, img, result.dataUrl, false, textPrompt);
                                break;
                            }
                        } catch (e) {
                            if (e.name === 'AbortError') return;
                            if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                        }
                    }
                    slot.frame._generating = false;
                    delete slot.frame._genStartTime;
                    engine.render();
                }));
            } finally {
                clearGenState(projectId);
                targetSlots.forEach(s => {
                    s.frame._generating = false;
                    delete s.frame._genStartTime;
                    if (s.isNew && !engine.elements.some(el => el.parentFrame === s.frame && el.type === 'image')) {
                        const idx = engine.elements.indexOf(s.frame);
                        if (idx !== -1) engine.elements.splice(idx, 1);
                    }
                });
                cancelOverlayGroup.removeAll();
                engine.render();
            }
        },

        /**
         * Describe an image element and store its AI label in the cache.
         * Called whenever a new image is added to the canvas (any source).
         * Silently no-ops if the label is already cached.
         */
        async describeImageElement(el) {
            if (!el || el.type !== 'image' || !el.src) return;
            const cacheKey = getImageCacheKey(el.src);
            if (imageLabelCache.has(cacheKey)) return; // already known

            // Build a small thumbnail to send (faster API call)
            let payload = el.src;
            try {
                const THUMB = 128;
                const img = el.image;
                if (img && img.naturalWidth > 0) {
                    const tc = document.createElement('canvas');
                    const scale = Math.min(1, THUMB / Math.max(img.naturalWidth, img.naturalHeight));
                    tc.width  = Math.round(img.naturalWidth  * scale);
                    tc.height = Math.round(img.naturalHeight * scale);
                    tc.getContext('2d').drawImage(img, 0, 0, tc.width, tc.height);
                    payload = tc.toDataURL('image/jpeg', 0.75);
                }
            } catch (_) { /* use full src */ }

            try {
                const resp = await fetch('/api/describe-image', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ imageData: payload })
                });
                if (!resp.ok) return;
                const result = await resp.json();
                const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (!text) return;

                const words = text.split(/[\s,]+/).map(k => k.trim()).filter(Boolean);
                let labelText = words[0] || 'Image';
                if (words[1] && (labelText.length + words[1].length) <= 14) {
                    labelText += ' ' + words[1];
                }
                labelText = labelText.charAt(0).toUpperCase() + labelText.slice(1);

                imageLabelCache.set(cacheKey, labelText);
                _persistLabelCache();

                // Trigger layer panel refresh if open
                const engine = window.canvasEngine;
                if (engine) engine.render();
            } catch (err) {
                console.warn('[canvas-gen] describeImageElement failed:', err);
            }
        },

        /**
         * Return a human-readable label for an image element, using the cached AI label
         * if available. Falls back to the frame name or "Image".
         */
        getImageLabel(el) {
            if (!el || el.type !== 'image') return null;
            // Use cached AI label first
            if (el.src) {
                const cached = imageLabelCache.get(getImageCacheKey(el.src));
                if (cached) return cached;
            }
            // Fall back to parent frame name
            const frameName = el.parentFrame?.name;
            if (frameName && frameName !== 'Frame') return frameName;
            return null;
        },

        triggerAutoGeneration(promptText) {
            const engine = window.canvasEngine;
            if (!engine) {
                setTimeout(() => window.GenPanel.triggerAutoGeneration(promptText), 100);
                return;
            }

            // Place a 1:1 square Frame at the viewport centre
            const FRAME_SIZE = 800; // logical canvas units
            const cx = (window.innerWidth / 2 - engine.viewport.x) / engine.viewport.scale;
            const cy = (window.innerHeight / 2 - engine.viewport.y) / engine.viewport.scale;
            const frame = createEmptyFrame(engine, cx - FRAME_SIZE / 2, cy - FRAME_SIZE / 2, FRAME_SIZE, FRAME_SIZE, '#FFFFFF');
            engine.render();

            // Trigger the selection → gen-panel will be created by onSelectionChange
            if (engine.onSelectionChange) engine.onSelectionChange([frame]);

            // Give the panel one animation frame to initialise, then set prompt + fire
            requestAnimationFrame(() => {
                const key = getPanelKey([frame]);
                const instance = panelRegistry.get(key);
                if (!instance) return;

                if (instance.els.editor && promptText) {
                    instance.els.editor.textContent = promptText;
                    instance.els.editor.classList.remove('show-placeholder');
                    updateSendState(instance);
                }

                // Small delay so UI settles before generation starts
                setTimeout(() => handleGenerate(instance), 80);
            });
        }
    };

    // ==================== Bootstrap ====================
    function waitForEngine() {
        if (window.canvasEngine) {
            initGenPanel();
        } else {
            requestAnimationFrame(waitForEngine);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        waitForEngine();
    });
})();
