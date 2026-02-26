/**
 * Canvas Engine - Complete infinite canvas implementation
 * Supports: Select, Hand, Page, Image, Text, Shapes (Rectangle/Line/Arrow/Ellipse/Polygon/Star), Pencil
 */

class CanvasEngine {
    constructor(canvasElement) {
        this.canvas = canvasElement;
        this.ctx = canvasElement.getContext('2d');

        // Viewport state
        this.viewport = {
            x: 0,
            y: 0,
            scale: 0.2,
            minScale: 0.02,
            maxScale: 5.0
        };

        // Canvas state
        this.elements = [];
        this.selectedElements = [];
        this.currentTool = 'move';
        this.previousTool = null; // For temporary tool switching
        this.currentShapeType = 'rectangle';

        // History for undo/redo
        this.history = {
            past: [],
            future: [],
            maxSize: 50
        };

        // Interaction state
        this.isPanning = false;
        this.isDrawing = false;
        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.rotateHandle = null;
        this.rotateStartAngle = 0;
        this.rotateElementStartAngle = 0;
        this.rotateCenterWorld = null;
        this.hoveredRotCorner = null; // Currently hovered rotation corner ('nw'|'ne'|'se'|'sw')
        this.dragStart = null;
        this.lastMousePos = null;
        this.tempElement = null;
        this.resizeHandle = null;
        this.spacePressed = false; // Track space key state

        // Text editing
        this.editingText = null;
        this.textInput = null;

        // Frame container state
        this.highlightedFrame = null; // Frame being hovered during drag
        this.enteredFrame = null; // Frame the user has "entered" (double-click to enter)

        // Internal clipboard for copy/paste of canvas elements
        this._clipboard = null; // { elements: [...deep clones], offsetX, offsetY }

        // Performance optimization
        this.renderScheduled = false;

        // Visual aids
        this.showPixelGrid = false;
        this.showRulers = false;
        this.autoSnap = true; // Enable auto-snap by default
        this.snapGuides = { vertical: [], horizontal: [] }; // Snap guide lines

        this.init();
    }

    init() {
        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        this.setupEventListeners();

        // Center viewport (use CSS pixel dimensions)
        this.viewport.x = this.cssWidth / 2;
        this.viewport.y = this.cssHeight / 2;

        this.render();
        this.updateZoomDisplay();
    }

    resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        this.dpr = dpr;
        this.cssWidth = window.innerWidth;
        this.cssHeight = window.innerHeight;
        this.canvas.width = Math.round(this.cssWidth * dpr);
        this.canvas.height = Math.round(this.cssHeight * dpr);
        this.canvas.style.width = this.cssWidth + 'px';
        this.canvas.style.height = this.cssHeight + 'px';
        this.render();
    }

    // ==================== Coordinate Transformations ====================

    screenToWorld(screenX, screenY) {
        return {
            x: (screenX - this.viewport.x) / this.viewport.scale,
            y: (screenY - this.viewport.y) / this.viewport.scale
        };
    }

    worldToScreen(worldX, worldY) {
        return {
            x: worldX * this.viewport.scale + this.viewport.x,
            y: worldY * this.viewport.scale + this.viewport.y
        };
    }

    // ==================== Viewport Controls ====================

    pan(dx, dy) {
        this.viewport.x += dx;
        this.viewport.y += dy;
        this.render();
    }

    zoom(delta, centerX, centerY, rawDelta, deltaMode) {
        // Smooth zoom: proportional to input magnitude
        let zoomFactor;
        if (rawDelta !== undefined) {
            // Trackpad pinch (deltaMode=0, small values) vs mouse wheel (deltaMode=0/1, larger values)
            // deltaMode 1 = line, typically 3 lines per notch
            const lineMultiplier = (deltaMode === 1) ? 20 : 1;
            const scaledDelta = rawDelta * lineMultiplier;
            // Sensitivity: 1.5% per pixel, capped at ±30% per frame for smoothness
            const pct = Math.max(-0.30, Math.min(0.30, -scaledDelta * 0.015));
            zoomFactor = 1 + pct;
        } else {
            // Keyboard shortcuts — fixed step
            zoomFactor = delta > 0 ? 1.12 : 0.89;
        }
        let newScale = this.viewport.scale * zoomFactor;
        newScale = Math.max(this.viewport.minScale, Math.min(this.viewport.maxScale, newScale));

        if (newScale !== this.viewport.scale) {
            const worldPos = this.screenToWorld(centerX, centerY);
            this.viewport.scale = newScale;
            const newScreenPos = this.worldToScreen(worldPos.x, worldPos.y);

            this.viewport.x += centerX - newScreenPos.x;
            this.viewport.y += centerY - newScreenPos.y;

            // Throttled render for better performance
            this.scheduleRender();
            this.updateZoomDisplay();
        }
    }

    setZoom(scale) {
        const centerX = this.cssWidth / 2;
        const centerY = this.cssHeight / 2;
        const worldPos = this.screenToWorld(centerX, centerY);

        this.viewport.scale = Math.max(this.viewport.minScale, Math.min(this.viewport.maxScale, scale));
        const newScreenPos = this.worldToScreen(worldPos.x, worldPos.y);

        this.viewport.x += centerX - newScreenPos.x;
        this.viewport.y += centerY - newScreenPos.y;

        this.render();
        this.updateZoomDisplay();
    }

    updateZoomDisplay() {
        const zoomDisplay = document.getElementById('zoom-display');
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.viewport.scale * 100)}%`;
        }
    }

    fitToScreen() {
        if (this.elements.length === 0) {
            this.viewport.x = this.cssWidth / 2;
            this.viewport.y = this.cssHeight / 2;
            this.viewport.scale = 0.2;
        } else {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            this.elements.forEach(el => {
                let x, y, w, h;
                if (el.type === 'path') {
                    const b = this.getPathBounds(el);
                    x = b.x; y = b.y; w = b.width; h = b.height;
                } else {
                    x = el.x; y = el.y; w = el.width; h = el.height;
                }
                if (!isFinite(x) || !isFinite(y) || !isFinite(w) || !isFinite(h)) return;
                minX = Math.min(minX, x);
                minY = Math.min(minY, y);
                maxX = Math.max(maxX, x + w);
                maxY = Math.max(maxY, y + h);
            });

            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;

            if (!isFinite(minX) || contentWidth <= 0 || contentHeight <= 0) {
                this.viewport.x = this.cssWidth / 2;
                this.viewport.y = this.cssHeight / 2;
                this.viewport.scale = 0.2;
                this.render();
                this.updateZoomDisplay();
                return;
            }

            const padLeft = 88;
            const padRight = 40;
            const padTop = 80;
            const padBottom = 88;
            const availW = Math.max(1, this.cssWidth - padLeft - padRight);
            const availH = Math.max(1, this.cssHeight - padTop - padBottom);
            const scaleX = availW / contentWidth;
            const scaleY = availH / contentHeight;

            this.viewport.scale = Math.min(scaleX, scaleY, this.viewport.maxScale);
            const centerX = padLeft + availW / 2;
            const centerY = padTop + availH / 2;
            this.viewport.x = centerX - (minX + contentWidth / 2) * this.viewport.scale;
            this.viewport.y = centerY - (minY + contentHeight / 2) * this.viewport.scale;
        }

        this.render();
        this.updateZoomDisplay();
    }

    // Zoom + pan to fit specific elements, accounting for UI chrome.
    // options: { padLeft, padRight, padTop, padBottom, maxScale, minScale }
    fitToElements(elements, options = {}) {
        if (!elements || elements.length === 0) return;

        const padLeft = options.padLeft ?? 88;
        const padRight = options.padRight ?? 60;
        const padTop = options.padTop ?? 80;
        const padBottom = options.padBottom ?? 200; // extra for gen panel
        const maxScale = options.maxScale ?? 2.0;
        const minScale = options.minScale ?? this.viewport.minScale;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        elements.forEach(el => {
            let x, y, w, h;
            if (el.type === 'path') {
                const b = this.getPathBounds(el);
                x = b.x; y = b.y; w = b.width; h = b.height;
            } else {
                x = el.x ?? 0; y = el.y ?? 0; w = el.width ?? 0; h = el.height ?? 0;
            }
            if (!isFinite(x) || !isFinite(y)) return;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x + w);
            maxY = Math.max(maxY, y + h);
        });

        if (!isFinite(minX)) return;

        const availW = Math.max(1, this.cssWidth - padLeft - padRight);
        const availH = Math.max(1, this.cssHeight - padTop - padBottom);
        const contentW = maxX - minX;
        const contentH = maxY - minY;

        if (contentW <= 0 || contentH <= 0) return;

        const scaleX = availW / contentW;
        const scaleY = availH / contentH;
        const newScale = Math.max(minScale, Math.min(scaleX, scaleY, maxScale));
        this.viewport.scale = newScale;

        const centerX = padLeft + availW / 2;
        const centerY = padTop + availH / 2;
        this.viewport.x = centerX - (minX + contentW / 2) * newScale;
        this.viewport.y = centerY - (minY + contentH / 2) * newScale;

        this.render();
        this.updateZoomDisplay();
    }

    // ==================== History ====================

    // Clone elements array, converting parentFrame references to indices
    cloneElements(elements) {
        const cloned = elements.map(el => {
            const clone = { ...el };
            if (el.type === 'image' && el.image) {
                clone.image = el.image;
            }
            if (el.type === 'path' && el.points) {
                clone.points = el.points.map(p => ({ ...p }));
            }
            // Convert parentFrame reference to index for serialization
            if (el.parentFrame) {
                clone.parentFrameIndex = elements.indexOf(el.parentFrame);
                delete clone.parentFrame;
            }
            return clone;
        });
        return cloned;
    }

    // Restore parentFrame references from indices
    restoreParentRefs(elements) {
        elements.forEach(el => {
            if (el.parentFrameIndex !== undefined && el.parentFrameIndex >= 0) {
                el.parentFrame = elements[el.parentFrameIndex];
            }
            delete el.parentFrameIndex;
        });
        return elements;
    }

    // Save current state BEFORE making changes.
    // When _suppressHistory is true the call is a no-op — used during AI generation
    // so that the intermediate "frame + loading overlay" states never enter the undo stack.
    saveState() {
        if (this._suppressHistory) return;
        const clonedElements = this.cloneElements(this.elements);
        const state = { elements: clonedElements };

        // Only save if state is different from last saved state
        const stateStr = JSON.stringify({
            elements: clonedElements.map(el => {
                const { image, ...rest } = el;
                return rest;
            })
        });

        const lastStateStr = this.history.past.length > 0
            ? JSON.stringify({
                elements: this.history.past[this.history.past.length - 1].elements.map(el => {
                    const { image, ...rest } = el;
                    return rest;
                })
            })
            : null;

        if (lastStateStr !== stateStr) {
            this.history.past.push(state);
            if (this.history.past.length > this.history.maxSize) {
                this.history.past.shift();
            }
            this.history.future = [];
        }
    }

    undo() {
        if (this.history.past.length === 0) return;

        const currentClone = this.cloneElements(this.elements);
        this.history.future.push({ elements: currentClone });

        const prevState = this.history.past.pop();
        this.elements = this.restoreParentRefs(prevState.elements.map(el => {
            const clone = { ...el };
            if (el.type === 'image' && el.image) clone.image = el.image;
            if (el.type === 'path' && el.points) clone.points = el.points.map(p => ({ ...p }));
            if (el.parentFrameIndex !== undefined) clone.parentFrameIndex = el.parentFrameIndex;
            return clone;
        }));
        this.selectedElements = [];

        this.render();
    }

    redo() {
        if (this.history.future.length === 0) return;

        const currentClone = this.cloneElements(this.elements);
        this.history.past.push({ elements: currentClone });

        const nextState = this.history.future.pop();
        this.elements = this.restoreParentRefs(nextState.elements.map(el => {
            const clone = { ...el };
            if (el.type === 'image' && el.image) clone.image = el.image;
            if (el.type === 'path' && el.points) clone.points = el.points.map(p => ({ ...p }));
            if (el.parentFrameIndex !== undefined) clone.parentFrameIndex = el.parentFrameIndex;
            return clone;
        }));
        this.selectedElements = [];

        this.render();
    }

    restoreImages(elements) {
        elements.forEach(el => {
            if (el.type === 'image' && el.src && !el.image) {
                const img = new Image();
                img.onload = () => {
                    el.image = img;
                    this.render();
                };
                img.src = el.src;
            }
        });
    }

    // ==================== Visual Aids ====================

    togglePixelGrid() {
        this.showPixelGrid = !this.showPixelGrid;
        this.render();
    }

    toggleRulers() {
        this.showRulers = !this.showRulers;
        this.render();
    }

    toggleAutoSnap() {
        this.autoSnap = !this.autoSnap;
        console.log('Auto Snap:', this.autoSnap ? 'ON' : 'OFF');
    }

    // Snap position to nearby elements (Figma-style smart guides)
    snapPosition(x, y, elementWidth = 0, elementHeight = 0, excludeElements = []) {
        if (!this.autoSnap) {
            this.snapGuides = { vertical: [], horizontal: [] };
            return { x, y };
        }

        // Convert screen pixels to world coordinates for threshold
        const snapThreshold = 10 / this.viewport.scale; // Snap within 10 screen pixels
        let snappedX = x;
        let snappedY = y;
        let minDistX = Infinity;
        let minDistY = Infinity;

        // Clear previous snap guides
        this.snapGuides = { vertical: [], horizontal: [] };

        // Collect all potential guide lines
        const verticalGuides = new Map(); // guideLine -> distance
        const horizontalGuides = new Map(); // guideLine -> distance

        // Current element edges and center
        const currentLeft = x;
        const currentRight = x + elementWidth;
        const currentCenterX = x + elementWidth / 2;
        const currentTop = y;
        const currentBottom = y + elementHeight;
        const currentCenterY = y + elementHeight / 2;

        // Snap to other elements' edges and centers
        this.elements.forEach(el => {
            if (excludeElements.includes(el)) return;

            // Target element edges and center
            const targetLeft = el.x;
            const targetRight = el.x + el.width;
            const targetCenterX = el.x + el.width / 2;
            const targetTop = el.y;
            const targetBottom = el.y + el.height;
            const targetCenterY = el.y + el.height / 2;

            // X-axis alignment checks
            const xChecks = [
                // Left edge alignments
                { current: currentLeft, target: targetLeft, offset: 0, guideLine: targetLeft },
                { current: currentLeft, target: targetRight, offset: 0, guideLine: targetRight },
                { current: currentLeft, target: targetCenterX, offset: 0, guideLine: targetCenterX },

                // Right edge alignments
                { current: currentRight, target: targetLeft, offset: -elementWidth, guideLine: targetLeft },
                { current: currentRight, target: targetRight, offset: -elementWidth, guideLine: targetRight },
                { current: currentRight, target: targetCenterX, offset: -elementWidth, guideLine: targetCenterX },

                // Center alignments
                { current: currentCenterX, target: targetLeft, offset: -elementWidth / 2, guideLine: targetLeft },
                { current: currentCenterX, target: targetRight, offset: -elementWidth / 2, guideLine: targetRight },
                { current: currentCenterX, target: targetCenterX, offset: -elementWidth / 2, guideLine: targetCenterX }
            ];

            xChecks.forEach(({ current, target, offset, guideLine }) => {
                const dist = Math.abs(current - target);
                if (dist < snapThreshold) {
                    // Track the best snap position
                    if (dist < minDistX) {
                        minDistX = dist;
                        snappedX = target + offset;
                    }
                    // Collect guide line (keep track of minimum distance for this guide)
                    if (!verticalGuides.has(guideLine) || dist < verticalGuides.get(guideLine)) {
                        verticalGuides.set(guideLine, dist);
                    }
                }
            });

            // Y-axis alignment checks
            const yChecks = [
                // Top edge alignments
                { current: currentTop, target: targetTop, offset: 0, guideLine: targetTop },
                { current: currentTop, target: targetBottom, offset: 0, guideLine: targetBottom },
                { current: currentTop, target: targetCenterY, offset: 0, guideLine: targetCenterY },

                // Bottom edge alignments
                { current: currentBottom, target: targetTop, offset: -elementHeight, guideLine: targetTop },
                { current: currentBottom, target: targetBottom, offset: -elementHeight, guideLine: targetBottom },
                { current: currentBottom, target: targetCenterY, offset: -elementHeight, guideLine: targetCenterY },

                // Center alignments
                { current: currentCenterY, target: targetTop, offset: -elementHeight / 2, guideLine: targetTop },
                { current: currentCenterY, target: targetBottom, offset: -elementHeight / 2, guideLine: targetBottom },
                { current: currentCenterY, target: targetCenterY, offset: -elementHeight / 2, guideLine: targetCenterY }
            ];

            yChecks.forEach(({ current, target, offset, guideLine }) => {
                const dist = Math.abs(current - target);
                if (dist < snapThreshold) {
                    // Track the best snap position
                    if (dist < minDistY) {
                        minDistY = dist;
                        snappedY = target + offset;
                    }
                    // Collect guide line (keep track of minimum distance for this guide)
                    if (!horizontalGuides.has(guideLine) || dist < horizontalGuides.get(guideLine)) {
                        horizontalGuides.set(guideLine, dist);
                    }
                }
            });
        });

        // Only show guides that are within a small tolerance of the best snap
        const tolerance = 0.5; // Show guides within 0.5 pixels of best alignment
        this.snapGuides.vertical = Array.from(verticalGuides.entries())
            .filter(([_, dist]) => dist <= minDistX + tolerance)
            .map(([guideLine, _]) => guideLine);

        this.snapGuides.horizontal = Array.from(horizontalGuides.entries())
            .filter(([_, dist]) => dist <= minDistY + tolerance)
            .map(([guideLine, _]) => guideLine);

        const didSnap = snappedX !== x || snappedY !== y;
        if (didSnap) {
            console.log('Smart align:', {
                from: { x, y },
                to: { x: snappedX, y: snappedY },
                guides: { v: this.snapGuides.vertical.length, h: this.snapGuides.horizontal.length }
            });
        }

        return { x: snappedX, y: snappedY };
    }

    // ==================== Event Handlers ====================

    setupEventListeners() {
        this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        // mousemove and mouseup are on the document so that drag/resize/rotate operations
        // continue to work even when the cursor moves over floating UI elements (e.g. the
        // cancel overlay shown on generating frames).
        document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        document.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        // passive: false is required so that preventDefault() actually works for wheel events
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
        // Clear rotation hover indicator when mouse leaves canvas
        this.canvas.addEventListener('mouseleave', () => {
            if (this.hoveredRotCorner !== null) {
                this.hoveredRotCorner = null;
                this.scheduleRender();
            }
        });

        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        document.addEventListener('paste', (e) => this.handlePaste(e));

        // Prevent browser zoom (Ctrl/Cmd +/-/0 and Ctrl+wheel) and horizontal swipe-back
        // navigation globally. Chrome/Safari interpret a fast horizontal trackpad swipe as
        // "back / forward" — preventDefault() on the wheel event suppresses that.
        document.addEventListener('wheel', (e) => {
            if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                return;
            }
            // Block horizontal swipe-back: any deltaX (trackpad two-finger left swipe)
            // that could trigger the browser's back/forward navigation gesture.
            if (Math.abs(e.deltaX) > 0) {
                e.preventDefault();
            }
        }, { passive: false });

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    handlePaste(e) {
        // Skip if typing in an input
        if (this.editingText || this.isInputActive()) return;

        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (!blob) return;

                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = new Image();
                    img.onload = () => {
                        this.saveState();

                        const w = img.naturalWidth;
                        const h = img.naturalHeight;
                        const gap = 30;

                        const pos = this.getNextGridPosition(w, h, gap);

                        const element = {
                            type: 'image',
                            x: pos.x,
                            y: pos.y,
                            width: w,
                            height: h,
                            image: img,
                            src: ev.target.result,
                        };

                        this.elements.push(element);
                        this.selectedElements = [element];

                        // Scroll viewport so the new image is centered on screen
                        this.scrollToCenter(pos.x, pos.y, w, h);
                        this.render();

                        if (this.onSelectionChange) {
                            this.onSelectionChange(this.selectedElements);
                        }

                        // Auto-describe image for layer naming
                        if (window.GenPanel && window.GenPanel.describeImageElement) {
                            window.GenPanel.describeImageElement(element);
                        }
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(blob);
                return; // Only handle first image
            }
        }
    }

    // ==================== Copy / Paste ====================

    _copyToClipboard() {
        // Collect selected elements + their frame children
        const toCopy = new Set(this.selectedElements);
        this.selectedElements.forEach(el => {
            if (el.type === 'frame') {
                this.getFrameChildren(el).forEach(c => toCopy.add(c));
            }
        });

        // Compute bounding box for offset calculation
        let minX = Infinity, minY = Infinity;
        toCopy.forEach(el => {
            minX = Math.min(minX, el.x ?? Infinity);
            minY = Math.min(minY, el.y ?? Infinity);
        });
        if (!isFinite(minX)) minX = 0;
        if (!isFinite(minY)) minY = 0;

        // Deep-clone each element (preserve image reference — it's immutable display data)
        const clones = [];
        const frameIdMap = new Map(); // original frame → cloned frame

        // First pass: clone frames so children can reference them
        toCopy.forEach(el => {
            if (el.type !== 'frame') return;
            const clone = Object.assign({}, el);
            delete clone._fid;
            delete clone._pfid;
            frameIdMap.set(el, clone);
            clones.push(clone);
        });

        // Second pass: clone non-frames
        toCopy.forEach(el => {
            if (el.type === 'frame') return;
            const clone = Object.assign({}, el);
            delete clone._fid;
            delete clone._pfid;
            // Re-link parentFrame to the cloned frame if it was also copied
            if (el.parentFrame && frameIdMap.has(el.parentFrame)) {
                clone.parentFrame = frameIdMap.get(el.parentFrame);
            } else {
                delete clone.parentFrame; // detach if parent not in selection
            }
            // Deep-clone path points
            if (el.type === 'path' && el.points) {
                clone.points = el.points.map(p => ({ ...p }));
            }
            clones.push(clone);
        });

        this._clipboard = { elements: clones, originX: minX, originY: minY, pasteCount: 0 };
    }

    _pasteFromClipboard() {
        if (!this._clipboard) return;

        this._clipboard.pasteCount++;
        const PASTE_OFFSET = 20 * this._clipboard.pasteCount;

        // Clone again from the stored clipboard (so repeated Cmd+V keeps pasting)
        const frameIdMap = new Map();
        const newElements = [];

        // First pass: frames
        this._clipboard.elements.forEach(el => {
            if (el.type !== 'frame') return;
            const clone = Object.assign({}, el);
            clone.x = el.x + PASTE_OFFSET;
            clone.y = el.y + PASTE_OFFSET;
            // path points
            if (el.type === 'path' && el.points) clone.points = el.points.map(p => ({ ...p, x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET }));
            frameIdMap.set(el, clone);
            newElements.push(clone);
        });

        // Second pass: non-frames
        this._clipboard.elements.forEach(el => {
            if (el.type === 'frame') return;
            const clone = Object.assign({}, el);
            clone.x = el.x + PASTE_OFFSET;
            clone.y = el.y + PASTE_OFFSET;
            if (el.type === 'path' && el.points) clone.points = el.points.map(p => ({ ...p, x: p.x + PASTE_OFFSET, y: p.y + PASTE_OFFSET }));
            if (el.parentFrame && frameIdMap.has(el.parentFrame)) {
                clone.parentFrame = frameIdMap.get(el.parentFrame);
            } else {
                delete clone.parentFrame;
            }
            newElements.push(clone);
        });

        this.saveState();
        this.elements.push(...newElements);
        this.selectedElements = newElements.filter(el => !el.parentFrame); // select top-level pasted elements
        this.render();

        if (this.onSelectionChange) this.onSelectionChange(this.selectedElements);
    }

    handleMouseDown(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = this.screenToWorld(x, y);

        this.dragStart = { x, y };
        this.dragStartWorld = { x: worldPos.x, y: worldPos.y }; // Store world pos for accurate drag
        this.lastMousePos = { x, y };

        // Space key gives temporary Hand tool
        if (this.currentTool === 'hand' || e.button === 1 || this.spacePressed) {
            this.isPanning = true;
            this.canvas.style.cursor = 'grabbing';
            return;
        }

        if (this.currentTool === 'move') {
            // Check for resize handles first
            const handle = this.getResizeHandle(worldPos.x, worldPos.y);
            if (handle) {
                // Rotation handle detected
                if (handle.startsWith('rot-')) {
                    const element = this.selectedElements[0];
                    if (element.type === 'frame') return; // frames cannot be rotated
                    this.isRotating = true;
                    this.rotateHandle = handle;
                    // Center of element in world space
                    this.rotateCenterWorld = {
                        x: element.x + element.width / 2,
                        y: element.y + element.height / 2
                    };
                    // Angle from center to mouse at drag start
                    this.rotateStartAngle = Math.atan2(
                        worldPos.y - this.rotateCenterWorld.y,
                        worldPos.x - this.rotateCenterWorld.x
                    );
                    this.rotateElementStartAngle = element.rotation || 0;
                    this.canvas.style.cursor = this._getRotateCursor(handle.slice(4));
                    return;
                }

                this.isResizing = true;
                this.resizeHandle = handle;

                // Store initial state for scaling calculations
                const element = this.selectedElements[0];
                this.resizeStartState = {
                    width: element.width,
                    height: element.height,
                    x: element.x,
                    y: element.y,
                    fontSize: element.fontSize || 16
                };

                // For frames: snapshot all children so corner resize can scale them
                if (element.type === 'frame') {
                    this.resizeStartState.children = this.getFrameChildren(element).map(child => ({
                        el: child,
                        x: child.x,
                        y: child.y,
                        width: child.width,
                        height: child.height,
                        fontSize: child.fontSize || null,
                    }));
                }

                // Don't save state here - will save after resize completes
                return;
            }

            // Check for element selection
            const clickedElement = this.findElementAt(worldPos.x, worldPos.y);

            if (clickedElement) {
                // If we click a frame that's different from the entered frame, exit entered mode
                if (clickedElement.type === 'frame' && clickedElement !== this.enteredFrame) {
                    this.enteredFrame = null;
                }
                // If we click outside the entered frame entirely, exit entered mode
                if (this.enteredFrame && clickedElement !== this.enteredFrame &&
                    clickedElement.parentFrame !== this.enteredFrame) {
                    this.enteredFrame = null;
                }

                if (e.shiftKey) {
                    // Toggle selection logic
                    const index = this.selectedElements.indexOf(clickedElement);
                    if (index >= 0) {
                        this.selectedElements.splice(index, 1);
                    } else {
                        this.selectedElements.push(clickedElement);
                    }
                } else {
                    // If clicking an unselected element, select it (and deselect others)
                    // If clicking a selected element, keep selection (to allow multi-drag)
                    if (!this.selectedElements.includes(clickedElement)) {
                        this.selectedElements = [clickedElement];
                    }
                }

                this.isDragging = true;

                // Store start position for ALL selected elements for dragging
                this.dragStartPositions = new Map();
                this.selectedElements.forEach(el => {
                    this.dragStartPositions.set(el, { x: el.x, y: el.y });
                });

                this.saveState();
                this.render();
            } else {
                // Clicked on empty space — exit entered frame and deselect
                this.enteredFrame = null;
                if (!e.shiftKey) {
                    this.selectedElements = [];
                }

                // Start Box Selection
                this.isSelecting = true;
                this.selectionStart = { x: worldPos.x, y: worldPos.y };
                this.selectionEnd = { x: worldPos.x, y: worldPos.y };

                this.render();
            }
        } else {
            // Start creating new element
            this.isDrawing = true;
            this.startDrawing(worldPos.x, worldPos.y, e);
            this.saveState();
        }
    }

    handleMouseMove(e) {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = this.screenToWorld(x, y);

        // Determine whether the cursor is physically over the canvas element.
        // Hover-only effects (handle highlighting, cursor changes) are skipped when
        // the cursor is outside the canvas, but active operations (drag / resize /
        // rotate / pan) continue so they aren't interrupted by floating overlays.
        const overCanvas = (
            e.clientX >= rect.left && e.clientX <= rect.right &&
            e.clientY >= rect.top  && e.clientY <= rect.bottom
        );

        // Update cursor — runs every mousemove so inline style always reflects current tool
        if (this.isPanning) {
            this.canvas.style.cursor = 'grabbing';
        } else if (this.isRotating && this.rotateHandle) {
            this.canvas.style.cursor = this._getRotateCursor(this.rotateHandle.slice(4));
        } else if (overCanvas && this.currentTool === 'move' && this.selectedElements.length > 0 && !this.isDragging && !this.isResizing) {
            const handle = this.getResizeHandle(worldPos.x, worldPos.y);
            this.canvas.style.cursor = this.getHandleCursor(handle);
            // Track which rotation corner the mouse is hovering
            const newRotCorner = (handle && handle.startsWith('rot-')) ? handle.slice(4) : null;
            if (newRotCorner !== this.hoveredRotCorner) {
                this.hoveredRotCorner = newRotCorner;
                this.scheduleRender();
            }
        } else if (overCanvas) {
            // Enforce tool cursor every frame so CSS inheritance can never override it
            if (this.spacePressed || this.currentTool === 'hand') {
                this.canvas.style.cursor = 'grab';
            } else if (this.currentTool === 'text') {
                this.canvas.style.cursor = 'text';
            } else if (this.currentTool === 'pencil') {
                this.canvas.style.cursor = this._getPencilCursor();
            } else if (this.currentTool === 'rectangle') {
                this.canvas.style.cursor = 'crosshair';
            } else {
                this.canvas.style.cursor = 'default';
            }
        }

        if (this.isPanning && this.lastMousePos) {
            const dx = x - this.lastMousePos.x;
            const dy = y - this.lastMousePos.y;
            this.pan(dx, dy);
        } else if (this.isRotating && this.rotateCenterWorld && this.selectedElements.length === 1) {
            this.updateRotation(worldPos.x, worldPos.y);
        } else if (this.isResizing && this.dragStart) {
            this.updateResize(worldPos.x, worldPos.y, e);
        } else if (this.isDragging && this.dragStartWorld && this.dragStartPositions) {
            const dx = worldPos.x - this.dragStartWorld.x;
            const dy = worldPos.y - this.dragStartWorld.y;

            // Track frame delta for moving children
            const frameDx = worldPos.x - (this.lastWorldPos ? this.lastWorldPos.x : this.dragStartWorld.x);
            const frameDy = worldPos.y - (this.lastWorldPos ? this.lastWorldPos.y : this.dragStartWorld.y);

            // Collect all frame children that should move (for frames being dragged)
            // Map: frame -> list of children
            const frameChildrenMap = new Map();
            this.selectedElements.forEach(el => {
                if (el.type === 'frame') {
                    const children = this.getFrameChildren(el).filter(
                        child => !this.selectedElements.includes(child)
                    );
                    if (children.length > 0) {
                        frameChildrenMap.set(el, children);
                    }
                }
            });

            this.selectedElements.forEach(el => {
                const startPos = this.dragStartPositions.get(el);
                if (startPos) {
                    const newX = startPos.x + dx;
                    const newY = startPos.y + dy;
                    const oldX = el.x;
                    const oldY = el.y;

                    if (el.type === 'path') {
                        el.points.forEach(p => {
                            p.x += frameDx;
                            p.y += frameDy;
                        });
                        el.x += frameDx;
                        el.y += frameDy;
                    } else {
                        const snapped = this.snapPosition(newX, newY, el.width, el.height, this.selectedElements);
                        el.x = snapped.x;
                        el.y = snapped.y;
                    }

                    // Move frame children by the actual frame delta (after snap)
                    if (el.type === 'frame' && frameChildrenMap.has(el)) {
                        const actualDx = el.x - oldX;
                        const actualDy = el.y - oldY;
                        frameChildrenMap.get(el).forEach(child => {
                            if (child.type === 'path') {
                                child.points.forEach(p => {
                                    p.x += actualDx;
                                    p.y += actualDy;
                                });
                                child.x += actualDx;
                                child.y += actualDy;
                            } else {
                                child.x += actualDx;
                                child.y += actualDy;
                            }
                        });
                    }
                }
            });

            // Detect frame hover: attach when the mouse cursor is inside a frame (Figma-style)
            this.highlightedFrame = null;
            const isDraggingNonFrame = this.selectedElements.some(el => el.type !== 'frame');
            if (isDraggingNonFrame) {
                this.highlightedFrame = this.getFrameAt(worldPos.x, worldPos.y, this.selectedElements);
            }

            this.render();
        } else if (this.isSelecting) {
            this.selectionEnd = { x: worldPos.x, y: worldPos.y };
            this.updateSelectionBox();
            this.render();
        } else if (this.isDrawing && this.dragStart) {
            const worldStart = this.screenToWorld(this.dragStart.x, this.dragStart.y);
            this.updateDrawing(worldStart.x, worldStart.y, worldPos.x, worldPos.y, e);
        }

        this.lastWorldPos = { x: worldPos.x, y: worldPos.y };
        this.lastMousePos = { x, y };
    }

    handleMouseUp(e) {
        if (this.isDrawing && this.tempElement) {
            // Only add element if it has some size (except for text)
            // For lines, calculate length using coordinates
            const isLine = this.tempElement.type === 'shape' && this.tempElement.shapeType === 'line';
            const hasSize = isLine
                ? Math.hypot(this.tempElement.x2 - this.tempElement.x, this.tempElement.y2 - this.tempElement.y) > 5
                : (this.tempElement.width > 5 && this.tempElement.height > 5);

            if (this.tempElement.type === 'text' ||
                this.tempElement.type === 'polygon' ||
                hasSize ||
                (this.tempElement.type === 'path' && this.tempElement.points && this.tempElement.points.length > 2)) {

                // Save state BEFORE adding element
                this.saveState();
                this.elements.push(this.tempElement);

                // Auto-attach to frame if the element was created fully inside one,
                // and ensure it sits on top of all other children in that frame.
                this.updateFrameAttachment(this.tempElement);

                // Auto-switch to Select tool after creating element (except for pencil)
                if (this.currentTool !== 'pencil' && this.currentTool !== 'move') {
                    this.setTool('move');
                }
            }
            this.tempElement = null;
            this.isDrawing = false;
        }

        // Handle Box Selection End
        if (this.isSelecting) {
            this.isSelecting = false;
            this.selectionStart = null;
            this.selectionEnd = null;
            this.render();
        }

        // Handle Click Selection (Deselect others if not dragged and no shift)
        if (this.currentTool === 'move' && !this.isDragging && !this.isResizing && !this.isRotating && !this.isSelecting && !e.shiftKey) {
            const rect = this.canvas.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            const worldPos = this.screenToWorld(x, y);
            const clickedElement = this.findElementAt(worldPos.x, worldPos.y);

            if (clickedElement) {
                this.selectedElements = [clickedElement];
                this.render();
            }
        }

        // Finalize frame attachment after drag — use mouse cursor position (Figma-style)
        if (this.isDragging) {
            const rect = this.canvas.getBoundingClientRect();
            const mx = e.clientX - rect.left;
            const my = e.clientY - rect.top;
            const dropWorld = this.screenToWorld(mx, my);
            const targetFrame = this.getFrameAt(dropWorld.x, dropWorld.y, this.selectedElements);

            this.selectedElements.forEach(el => {
                if (el.type === 'frame') {
                    this.resolveFrameOverlap(el);
                } else if (targetFrame) {
                    this.attachToFrame(el, targetFrame);
                    this.bringToTopOfFrame(el, targetFrame);
                } else {
                    this.detachFromFrame(el);
                }
            });
            this.highlightedFrame = null;
        }

        // Save state only if an operation was completed (drag, resize, or rotate, NOT selection)
        const shouldSaveState = this.isDragging || this.isResizing || this.isRotating;

        this.isDragging = false;
        this.isResizing = false;
        this.isRotating = false;
        this.rotateHandle = null;
        this.rotateCenterWorld = null;
        this.isPanning = false; // Reset panning state
        this.isSelecting = false;
        this.resizeHandle = null;
        this.resizeStartState = null;
        this.dragStart = null;
        this.dragStartWorld = null;
        this.dragStartPositions = null;
        this.snapGuides = { vertical: [], horizontal: [] }; // Clear snap guides
        this.render(); // Immediately re-render so snap guide lines disappear on mouse-up
        // Keep lastMousePos for panning inertia if implemented, or just reset

        if (this.spacePressed || this.currentTool === 'hand') {
            this.canvas.style.cursor = 'grab';
        } else if (this.currentTool === 'text') {
            this.canvas.style.cursor = 'text';
        } else if (this.currentTool === 'pencil') {
            this.canvas.style.cursor = this._getPencilCursor();
        } else if (this.currentTool === 'rectangle') {
            this.canvas.style.cursor = 'crosshair';
        } else {
            this.canvas.style.cursor = 'default';
        }

        // Restore UI to show current tool
        this.updateToolUI(this.currentTool);

        // Save state after operation completes
        if (shouldSaveState) {
            this.saveState();
        }
    }

    updateSelectionBox() {
        if (!this.selectionStart || !this.selectionEnd) return;

        // Calculate selection box in world coordinates
        const x = Math.min(this.selectionStart.x, this.selectionEnd.x);
        const y = Math.min(this.selectionStart.y, this.selectionEnd.y);
        const width = Math.abs(this.selectionEnd.x - this.selectionStart.x);
        const height = Math.abs(this.selectionEnd.y - this.selectionStart.y);

        // Find elements within the box
        this.selectedElements = [];
        this.elements.forEach(el => {
            // For path elements, derive bounding box from their points array
            let elX, elY, elW, elH;
            if (el.type === 'path' && el.points && el.points.length) {
                const bounds = this.getPathBounds(el);
                elX = bounds.x;
                elY = bounds.y;
                elW = bounds.width;
                elH = bounds.height;
            } else {
                elX = el.x || 0;
                elY = el.y || 0;
                elW = el.width || 0;
                elH = el.height || 0;
            }

            // Touch / partial intersection — any overlap includes the element
            if (elX < x + width && elX + elW > x &&
                elY < y + height && elY + elH > y) {
                this.selectedElements.push(el);
            }
        });
    }

    handleWheel(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        if (e.ctrlKey || e.metaKey) {
            // Zoom: Ctrl/Cmd + scroll, or trackpad pinch gesture
            // Pass rawDelta + deltaMode for smooth proportional zoom
            this.zoom(-e.deltaY, x, y, e.deltaY, e.deltaMode);
        } else {
            // Pan with two-finger scroll or mouse wheel
            this.pan(-e.deltaX, -e.deltaY);
        }
    }

    handleDoubleClick(e) {
        if (this.currentTool !== 'move') return;

        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const worldPos = this.screenToWorld(x, y);

        // Check if double-clicking on a frame header (for renaming)
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type === 'frame' && this.isOnFrameHeader(el, worldPos.x, worldPos.y)) {
                this.startFrameRename(el, e.clientX, e.clientY);
                return;
            }
        }

        // Double-click on a selected frame → enter the frame to select children
        if (this.selectedElements.length === 1 && this.selectedElements[0].type === 'frame') {
            const frame = this.selectedElements[0];
            if (worldPos.x >= frame.x && worldPos.x <= frame.x + frame.width &&
                worldPos.y >= frame.y && worldPos.y <= frame.y + frame.height) {
                this.enteredFrame = frame;
                // Now find the child element at click position
                const child = this.findElementAt(worldPos.x, worldPos.y);
                if (child && child !== frame) {
                    this.selectedElements = [child];
                }
                this.render();
                return;
            }
        }

        const clickedElement = this.findElementAt(worldPos.x, worldPos.y);
        if (clickedElement && clickedElement.type === 'text') {
            this.startTextEditing(clickedElement);
        }
    }

    startFrameRename(frame, screenX, screenY) {
        // Create an overlay input at the frame name position
        const fontSize = 12;
        const gap = 8;
        const nameScreenPos = this.worldToScreen(frame.x, frame.y);
        const inputY = nameScreenPos.y - gap - fontSize - 2;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = frame.name || 'Frame';
        input.className = 'frame-rename-input';
        input.style.position = 'fixed';
        input.style.left = (nameScreenPos.x) + 'px';
        input.style.top = inputY + 'px';
        input.style.fontSize = fontSize + 'px';
        input.style.fontWeight = '600';
        input.style.fontFamily = 'Inter, sans-serif';
        input.style.color = '#0099B8';
        input.style.background = 'rgba(255,255,255,0.95)';
        input.style.border = '1px solid rgba(0,153,184,0.3)';
        input.style.borderRadius = '4px';
        input.style.padding = '1px 4px';
        input.style.outline = 'none';
        input.style.zIndex = '9999';
        input.style.minWidth = '60px';
        input.style.maxWidth = '200px';

        document.body.appendChild(input);
        input.focus();
        input.select();

        const commit = () => {
            const newName = input.value.trim();
            if (newName) {
                frame.name = newName;
            }
            if (input.parentNode) input.parentNode.removeChild(input);
            this.render();
        };

        input.addEventListener('blur', commit);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
            if (e.key === 'Escape') { input.value = frame.name || 'Frame'; input.blur(); }
            e.stopPropagation();
        });
        input.addEventListener('mousedown', (e) => e.stopPropagation());
        input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    handleKeyDown(e) {
        // Intercept browser zoom shortcuts (Ctrl/Cmd + =/-/0) — ALWAYS prevent browser zoom.
        // Redirect to canvas zoom when not in a text input.
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                if (!this.editingText && !this.isInputActive()) {
                    const cx = this.cssWidth / 2;
                    const cy = this.cssHeight / 2;
                    this.zoom(1, cx, cy);
                }
                return;
            }
            if (e.key === '-') {
                e.preventDefault();
                if (!this.editingText && !this.isInputActive()) {
                    const cx = this.cssWidth / 2;
                    const cy = this.cssHeight / 2;
                    this.zoom(-1, cx, cy);
                }
                return;
            }
            if (e.key === '0') {
                e.preventDefault();
                if (!this.editingText && !this.isInputActive()) {
                    this.fitToScreen();
                }
                return;
            }
        }

        // Space key for temporary Hand tool - but NOT in input fields
        if (e.code === 'Space' && !this.editingText && !this.isInputActive() && !e.repeat) {
            e.preventDefault();
            this.spacePressed = true;
            if (!this.isPanning && !this.isDrawing) {
                this.canvas.style.cursor = 'grab';
                // Trigger UI update to show hand tool active
                this.updateToolUI('hand');
            }
            return;
        }

        // Delete selected - Only if input is NOT active
        if ((e.key === 'Delete' || e.key === 'Backspace') &&
            this.selectedElements.length > 0 &&
            !this.editingText &&
            !this.isInputActive()) {

            // Collect all elements to delete (including children of deleted frames)
            const toDelete = new Set(this.selectedElements);
            this.selectedElements.forEach(el => {
                if (el.type === 'frame') {
                    this.getFrameChildren(el).forEach(child => toDelete.add(child));
                }
            });
            // Also detach any elements whose parent is being deleted
            this.elements.forEach(el => {
                if (el.parentFrame && toDelete.has(el.parentFrame)) {
                    toDelete.add(el);
                }
            });
            this.elements = this.elements.filter(el => !toDelete.has(el));
            this.selectedElements = [];
            this.render();

            // Save state after deletion
            this.saveState();
        }

        // Select All (Cmd+A)
        if ((e.metaKey || e.ctrlKey) && e.key === 'a' && !this.editingText && !this.isInputActive()) {
            e.preventDefault();
            this.selectedElements = [...this.elements];
            this.render();
        }

        // Copy (Cmd+C) — copy selected elements to internal clipboard
        if ((e.metaKey || e.ctrlKey) && e.key === 'c' && !this.editingText && !this.isInputActive()) {
            if (this.selectedElements.length > 0) {
                e.preventDefault();
                this._copyToClipboard(false);
            }
        }

        // Cut (Cmd+X) — copy then delete
        if ((e.metaKey || e.ctrlKey) && e.key === 'x' && !this.editingText && !this.isInputActive()) {
            if (this.selectedElements.length > 0) {
                e.preventDefault();
                this._copyToClipboard(false);
                // Delete selected (same logic as Delete key)
                const toDelete = new Set(this.selectedElements);
                this.selectedElements.forEach(el => {
                    if (el.type === 'frame') this.getFrameChildren(el).forEach(c => toDelete.add(c));
                });
                this.elements.forEach(el => {
                    if (el.parentFrame && toDelete.has(el.parentFrame)) toDelete.add(el);
                });
                this.elements = this.elements.filter(el => !toDelete.has(el));
                this.selectedElements = [];
                this.render();
                this.saveState();
            }
        }

        // Paste (Cmd+V) — paste from internal clipboard
        if ((e.metaKey || e.ctrlKey) && e.key === 'v' && !this.editingText && !this.isInputActive()) {
            if (this._clipboard) {
                e.preventDefault();
                this._pasteFromClipboard();
            }
        }

        // Undo/Redo - Only if input is NOT active
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey && !this.editingText && !this.isInputActive()) {
            e.preventDefault();
            this.undo();
        }
        if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey)) && !this.editingText && !this.isInputActive()) {
            e.preventDefault();
            this.redo();
        }

        // Escape to deselect
        if (e.key === 'Escape') {
            this.selectedElements = [];
            if (this.editingText) {
                this.stopTextEditing();
            }
            this.render();
        }

        // Tool shortcuts - only when NOT in input mode and NO modifier keys pressed
        if (this.shouldTriggerShortcut(e)) {
            const key = e.key.toLowerCase();
            const shortcuts = {
                'v': 'move',        // V - Select/Move tool
                'm': 'hand',        // M - Hand tool (previously H)
                'h': 'hand',        // H - Hand tool (keep legacy)
                't': 'text',        // T - Text tool
                'r': 'rectangle',   // R - Rectangle/Shape tool
                'p': 'pencil',      // P - Pencil tool
                'f': 'frame',       // F - Frame tool (renamed from Page)
                'i': 'image'        // I - Image tool
            };

            if (shortcuts[key]) {
                e.preventDefault();
                this.setTool(shortcuts[key]);
                // Note: R key does NOT reset shape type — the last-used shape is remembered
            }
        }
    }

    isInputActive() {
        const activeElement = document.activeElement;
        return activeElement && (
            activeElement.tagName === 'INPUT' ||
            activeElement.tagName === 'TEXTAREA' ||
            activeElement.isContentEditable
        );
    }

    // Check if keyboard shortcut should trigger
    shouldTriggerShortcut(e) {
        // Don't trigger if in text editing mode
        if (this.editingText) return false;

        // Don't trigger if any modifier key is pressed
        if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;

        // Don't trigger if focused on an input element
        if (this.isInputActive()) {
            return false;
        }

        return true;
    }

    handleKeyUp(e) {
        // Release space key
        if (e.code === 'Space') {
            this.spacePressed = false;
            if (this.currentTool !== 'hand') {
                if (this.currentTool === 'text') {
                    this.canvas.style.cursor = 'text';
                } else if (this.currentTool === 'pencil') {
                    this.canvas.style.cursor = this._getPencilCursor();
                } else if (this.currentTool === 'rectangle') {
                    this.canvas.style.cursor = 'crosshair';
                } else {
                    this.canvas.style.cursor = 'default';
                }
                this.updateToolUI(this.currentTool);
            }
        }
    }

    // ==================== Tool Management ====================

    setTool(tool) {
        // Handle immediate actions
        if (tool === 'frame') {
            const center = this.getViewportCenter();
            // Switch back to move tool first
            this.setTool('move');
            // Then add frame and select it
            this.addFrame(center.x, center.y);
            return;
        }

        if (tool === 'image') {
            const center = this.getViewportCenter();
            this.triggerImageUpload(center.x, center.y);
            // Switch back to move tool
            this.setTool('move');
            return;
        }

        this.currentTool = tool;
        this.selectedElements = [];
        this.hoveredRotCorner = null; // Reset rotation hover state on tool change

        // Set appropriate cursor
        if (tool === 'hand') {
            this.canvas.style.cursor = 'grab';
        } else if (tool === 'text') {
            this.canvas.style.cursor = 'text';
        } else if (tool === 'pencil') {
            this.canvas.style.cursor = this._getPencilCursor();
        } else if (tool === 'rectangle') {
            // Shape tools: crosshair (+) cursor — signals "drag to draw a region"
            this.canvas.style.cursor = 'crosshair';
        } else {
            this.canvas.style.cursor = 'default';
        }

        this.updateToolUI(tool);
        this.render();
    }

    getViewportCenter() {
        const rect = this.canvas.getBoundingClientRect();
        const centerX = rect.width / 2;
        const centerY = rect.height / 2;
        return this.screenToWorld(centerX, centerY);
    }

    /**
     * Get the best position for a new element.
     * Priority:
     *   1. Viewport center — if no overlap, place there directly.
     *   2. To the right of whatever occupies the center (same row).
     *   3. Wrap to next row after 8 items per row, 30px gap.
     */
    getNextGridPosition(itemWidth, itemHeight, gap = 30, cols = 8) {
        const topLevel = this.elements.filter(el => !el.parentFrame);

        if (topLevel.length === 0) {
            // Empty canvas: place at viewport center
            const center = this.getViewportCenter();
            return { x: center.x - itemWidth / 2, y: center.y - itemHeight / 2 };
        }

        // Check if viewport center is free
        const center = this.getViewportCenter();
        const cx = center.x - itemWidth / 2;
        const cy = center.y - itemHeight / 2;
        const overlaps = topLevel.some(el =>
            el.x < cx + itemWidth + gap && el.x + el.width > cx - gap &&
            el.y < cy + itemHeight + gap && el.y + el.height > cy - gap
        );

        if (!overlaps) {
            return { x: cx, y: cy };
        }

        // Center is occupied — place to the right of existing content.
        // Sort elements: top-to-bottom then left-to-right
        const sorted = [...topLevel].sort((a, b) => {
            const rowDiff = a.y - b.y;
            if (Math.abs(rowDiff) > gap) return rowDiff;
            return a.x - b.x;
        });

        const originX = sorted[0].x;

        // Group into rows by y-proximity
        const rows = [];
        let currentRow = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            const el = sorted[i];
            if (Math.abs(el.y - currentRow[0].y) < gap) {
                currentRow.push(el);
            } else {
                rows.push(currentRow);
                currentRow = [el];
            }
        }
        rows.push(currentRow);

        const lastRow = rows[rows.length - 1];
        if (lastRow.length < cols) {
            // Room in the last row
            const lastEl = lastRow[lastRow.length - 1];
            return {
                x: lastEl.x + lastEl.width + gap,
                y: lastRow[0].y
            };
        } else {
            // Row full — start a new row below
            let maxBottom = -Infinity;
            topLevel.forEach(el => {
                maxBottom = Math.max(maxBottom, el.y + el.height);
            });
            return { x: originX, y: maxBottom + gap };
        }
    }

    /**
     * Scroll the viewport so that a world-space rectangle is centered on screen.
     */
    scrollToCenter(worldX, worldY, width, height) {
        const screenCenterX = this.cssWidth / 2;
        const screenCenterY = this.cssHeight / 2;
        const worldCenterX = worldX + width / 2;
        const worldCenterY = worldY + height / 2;

        this.viewport.x = screenCenterX - worldCenterX * this.viewport.scale;
        this.viewport.y = screenCenterY - worldCenterY * this.viewport.scale;
    }

    addFrame(worldX, worldY) {
        const frameSize = 1080;
        const gap = 30;

        const pos = this.getNextGridPosition(frameSize, frameSize, gap);

        const frameCount = this.elements.filter(el => el.type === 'frame').length + 1;

        const frame = {
            type: 'frame',
            name: `Frame ${frameCount}`,
            x: pos.x,
            y: pos.y,
            width: frameSize,
            height: frameSize,
            fill: '#FFFFFF',
            stroke: '#E0E0E0',
            strokeWidth: 1
        };

        this.saveState();
        this.elements.push(frame);
        this.resolveFrameOverlap(frame);
        this.selectedElements = [frame];
        frame._justCreated = true;

        this.scrollToCenter(frame.x, frame.y, frameSize, frameSize);
        this.render();

        // Clear the transient flag after a tick so subsequent selections behave normally
        requestAnimationFrame(() => { delete frame._justCreated; });
    }

    updateToolUI(tool) {
        // Update toolbar UI - can be overridden by canvas.js
        if (window.updateToolbarUI) {
            window.updateToolbarUI(tool);
        }
    }

    setShapeType(shapeType) {
        this.currentShapeType = shapeType;
    }

    fitTextElement(element) {
        this.ctx.save();
        this.ctx.font = `${element.fontSize}px ${element.fontFamily}`;

        const padding = 5;
        const lines = (element.text || '').split('\n');
        let maxWidth = 0;

        lines.forEach(line => {
            const metrics = this.ctx.measureText(line);
            maxWidth = Math.max(maxWidth, metrics.width);
        });

        // Ensure some minimum width for empty text box so it's visible/clickable
        const minWidth = 20;

        element.width = Math.max(minWidth, maxWidth + padding * 2);
        element.height = lines.length * (element.fontSize * 1.2) + padding * 2;

        this.ctx.restore();
    }

    // ==================== Drawing Tools ====================

    startDrawing(worldX, worldY, e) {
        switch (this.currentTool) {
            case 'frame':
                // Frame is now handled in setTool via immediate action
                // This case is kept as fallback but shouldn't be reached ideally
                const center = this.screenToWorld(e.clientX, e.clientY);
                this.addFrame(center.x, center.y);
                this.setTool('move');
                break;

            case 'image':
                // Image is now handled in setTool via immediate action
                this.triggerImageUpload(worldX, worldY);
                this.setTool('move');
                break;

            case 'text':
                this.tempElement = {
                    type: 'text',
                    x: worldX,
                    y: worldY,
                    width: 0, // Will be set by fitTextElement
                    height: 0, // Will be set by fitTextElement
                    text: '', // Start with empty text
                    fontSize: 36, // Default font size (larger for readability)
                    fontFamily: 'Inter',
                    color: '#000000',
                    align: 'left'
                };

                // Initial fit (for height mostly)
                this.fitTextElement(this.tempElement);

                // Save state BEFORE adding text element
                this.saveState();
                this.elements.push(this.tempElement);

                // Attach to frame if placed inside one, and bring to top of its children
                this.updateFrameAttachment(this.tempElement);

                this.selectedElements = [this.tempElement];
                const textElement = this.tempElement;
                this.tempElement = null;

                this.render();
                // Auto-switch to Select before starting edit
                this.setTool('move');
                // Start editing immediately
                setTimeout(() => this.startTextEditing(textElement), 50);
                break;

            case 'rectangle':
                const isLine = this.currentShapeType === 'line';
                this.tempElement = {
                    type: 'shape',
                    shapeType: this.currentShapeType,
                    x: worldX,
                    y: worldY,
                    width: 0,
                    height: 0,
                    fill: isLine ? 'none' : '#D9D9D9',
                    stroke: isLine ? '#D9D9D9' : 'none',
                    strokeWidth: isLine ? 4 : 0,
                    cornerRadius: this.currentShapeType === 'rectangle' ? 0 : undefined
                };

                // Initialize endpoints for line
                if (this.currentShapeType === 'line') {
                    this.tempElement.x2 = worldX;
                    this.tempElement.y2 = worldY;
                }
                break;

            case 'pencil':
                this.tempElement = {
                    type: 'path',
                    points: [{ x: worldX, y: worldY }],
                    stroke: '#EA5353',
                    strokeWidth: 6,
                    fill: 'none'
                };
                break;
        }
    }

    updateDrawing(startX, startY, currentX, currentY, e) {
        if (!this.tempElement) return;

        const shiftKey = e.shiftKey;

        switch (this.tempElement.type) {
            case 'shape':
                let width = currentX - startX;
                let height = currentY - startY;

                // Handle shape-specific logic
                if (this.tempElement.shapeType === 'line') {
                    // For lines, store end point
                    this.tempElement.x = startX;
                    this.tempElement.y = startY;
                    this.tempElement.x2 = currentX;
                    this.tempElement.y2 = currentY;

                    // Shift constrains to 15° increments
                    if (shiftKey) {
                        const dx = currentX - startX;
                        const dy = currentY - startY;
                        const angle = Math.atan2(dy, dx);
                        const snapAngle = Math.round(angle / (Math.PI / 12)) * (Math.PI / 12); // 15° increments
                        const length = Math.sqrt(dx * dx + dy * dy);
                        this.tempElement.x2 = startX + length * Math.cos(snapAngle);
                        this.tempElement.y2 = startY + length * Math.sin(snapAngle);
                    }
                } else {
                    // For other shapes, use width/height
                    if (shiftKey) {
                        // Constrain to square/circle
                        const size = Math.max(Math.abs(width), Math.abs(height));
                        width = width >= 0 ? size : -size;
                        height = height >= 0 ? size : -size;
                    }

                    this.tempElement.x = width >= 0 ? startX : startX + width;
                    this.tempElement.y = height >= 0 ? startY : startY + height;
                    this.tempElement.width = Math.abs(width);
                    this.tempElement.height = Math.abs(height);
                }
                break;

            case 'path':
                // Add point if moved enough
                const lastPoint = this.tempElement.points[this.tempElement.points.length - 1];
                const dist = Math.sqrt((currentX - lastPoint.x) ** 2 + (currentY - lastPoint.y) ** 2);
                if (dist > 2) {
                    this.tempElement.points.push({ x: currentX, y: currentY });
                }
                break;
        }

        this.render();
    }

    updateResize(worldX, worldY, e) {
        if (!this.resizeHandle || this.selectedElements.length === 0) return;

        const element = this.selectedElements[0]; // Only resize first selected element
        const handle = this.resizeHandle;
        const shiftKey = e.shiftKey;

        if (element.type === 'shape' && element.shapeType === 'line') {
            // Special handling for lines/arrows with snap
            if (handle === 'se') {
                const snapped = this.snapPosition(worldX, worldY, 0, 0, [element]);
                element.x2 = snapped.x;
                element.y2 = snapped.y;
            } else if (handle === 'nw') {
                const snapped = this.snapPosition(worldX, worldY, 0, 0, [element]);
                element.x = snapped.x;
                element.y = snapped.y;
            }
        } else {
            const originalWidth = element.width;
            const originalHeight = element.height;
            const originalX = element.x;
            const originalY = element.y;

            let newX = originalX;
            let newY = originalY;
            let newWidth = originalWidth;
            let newHeight = originalHeight;

            if (handle.length === 2 && this.resizeStartState) {
                // Corner handles: ALWAYS proportional, anchored to resize-start state
                const startX = this.resizeStartState.x;
                const startY = this.resizeStartState.y;
                const startW = this.resizeStartState.width;
                const startH = this.resizeStartState.height;
                const startAR = startW / startH;

                switch (handle) {
                    case 'se':
                        newWidth = worldX - startX;
                        newHeight = newWidth / startAR;
                        newX = startX;
                        newY = startY;
                        break;
                    case 'sw':
                        newWidth = (startX + startW) - worldX;
                        newHeight = newWidth / startAR;
                        newX = worldX;
                        newY = startY;
                        break;
                    case 'ne':
                        newWidth = worldX - startX;
                        newHeight = newWidth / startAR;
                        newX = startX;
                        newY = (startY + startH) - newHeight;
                        break;
                    case 'nw':
                        newWidth = (startX + startW) - worldX;
                        newHeight = newWidth / startAR;
                        newX = worldX;
                        newY = (startY + startH) - newHeight;
                        break;
                }
            } else {
                // Edge handles: free single-axis resize (incremental)
                switch (handle) {
                    case 'n':
                        newHeight = originalY + originalHeight - worldY;
                        newY = worldY;
                        break;
                    case 's':
                        newHeight = worldY - originalY;
                        break;
                    case 'w':
                        newWidth = originalX + originalWidth - worldX;
                        newX = worldX;
                        break;
                    case 'e':
                        newWidth = worldX - originalX;
                        break;
                }
            }

            // Apply snap to the edge being resized
            if (this.autoSnap) {
                // Determine which edges are moving
                const movingLeft = handle.includes('w');
                const movingRight = handle.includes('e');
                const movingTop = handle.includes('n');
                const movingBottom = handle.includes('s');

                // For edges that are moving, calculate their target position and snap
                if (movingRight || movingLeft) {
                    // Calculate the edge position that's moving
                    const edgeX = movingLeft ? newX : (newX + newWidth);
                    const snapped = this.snapPosition(edgeX, newY, newWidth, newHeight, [element]);

                    if (movingLeft) {
                        // Left edge moving: adjust x and width
                        const deltaX = snapped.x - newX;
                        newX = snapped.x;
                        newWidth -= deltaX;
                    } else if (movingRight) {
                        // Right edge moving: adjust width based on snapped right edge
                        newWidth = snapped.x - newX;
                    }
                }

                if (movingTop || movingBottom) {
                    // Calculate the edge position that's moving
                    const edgeY = movingTop ? newY : (newY + newHeight);
                    const snapped = this.snapPosition(newX, edgeY, newWidth, newHeight, [element]);

                    if (movingTop) {
                        // Top edge moving: adjust y and height
                        const deltaY = snapped.y - newY;
                        newY = snapped.y;
                        newHeight -= deltaY;
                    } else if (movingBottom) {
                        // Bottom edge moving: adjust height based on snapped bottom edge
                        newHeight = snapped.y - newY;
                    }
                }
            } else {
                // Clear guides when not snapping
                this.snapGuides = { vertical: [], horizontal: [] };
            }

            // Prevent negative dimensions
            if (newWidth < 10) newWidth = 10;
            if (newHeight < 10) newHeight = 10;

            // Apply the final values
            element.x = newX;
            element.y = newY;
            element.width = newWidth;
            element.height = newHeight;

            // Auto-scale text font size based on height for text elements
            if (element.type === 'text' && this.resizeStartState) {
                const heightRatio = element.height / this.resizeStartState.height;
                element.fontSize = Math.max(8, Math.round(this.resizeStartState.fontSize * heightRatio));
                this.fitTextElement(element);
            }

            // Corner handle on a frame: scale all children proportionally
            if (element.type === 'frame' && handle.length === 2 &&
                this.resizeStartState && this.resizeStartState.children) {
                const startW = this.resizeStartState.width;
                const startH = this.resizeStartState.height;
                const startX = this.resizeStartState.x;
                const startY = this.resizeStartState.y;
                const scaleX = element.width / startW;
                const scaleY = element.height / startH;
                this.resizeStartState.children.forEach(cs => {
                    cs.el.x = element.x + (cs.x - startX) * scaleX;
                    cs.el.y = element.y + (cs.y - startY) * scaleY;
                    cs.el.width = Math.max(1, cs.width * scaleX);
                    cs.el.height = Math.max(1, cs.height * scaleY);
                    if (cs.fontSize !== null) {
                        cs.el.fontSize = Math.max(8, Math.round(cs.fontSize * scaleY));
                    }
                });
            }
        }

        this.render();
    }

    updateRotation(worldX, worldY) {
        const element = this.selectedElements[0];
        const cx = this.rotateCenterWorld.x;
        const cy = this.rotateCenterWorld.y;

        // Current angle from center to mouse
        const currentAngle = Math.atan2(worldY - cy, worldX - cx);

        // Delta from when drag started
        let angleDelta = currentAngle - this.rotateStartAngle;

        // New raw rotation
        let newRotation = this.rotateElementStartAngle + angleDelta;

        // Snap to key rotation angles: 15°, 30°, 45°, 60°, 90° (and their multiples)
        const snapThresholdRad = (5 / 180) * Math.PI; // 5° tolerance for snapping
        // All multiples of 15° from 0 to 360
        const snapAngles = Array.from({ length: 25 }, (_, i) => (i * 15) * Math.PI / 180);

        // Normalize newRotation to [0, 2π)
        const normalized = ((newRotation % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        // Find closest snap angle
        let closestSnap = null;
        let minDist = Infinity;
        for (const snapAngle of snapAngles) {
            const dist = Math.abs(normalized - snapAngle);
            const dist2 = Math.abs(normalized - snapAngle + 2 * Math.PI);
            const dist3 = Math.abs(normalized - snapAngle - 2 * Math.PI);
            const d = Math.min(dist, dist2, dist3);
            if (d < minDist) {
                minDist = d;
                closestSnap = snapAngle;
            }
        }

        if (minDist < snapThresholdRad) {
            // Snap: align to snapped angle, keeping consistent with newRotation sign
            const snapDelta = closestSnap - normalized;
            newRotation += snapDelta;
        }

        element.rotation = newRotation;
        this.render();
    }

    getResizeHandle(worldX, worldY) {
        if (this.selectedElements.length !== 1) return null;

        const element = this.selectedElements[0];
        const cornerHit = 10 / this.viewport.scale;
        const edgeHit = 8 / this.viewport.scale;
        const rotOuter = 22 / this.viewport.scale;
        const rotInner = cornerHit;

        if (element.type === 'shape' && element.shapeType === 'line') {
            if (Math.abs(worldX - element.x) < cornerHit && Math.abs(worldY - element.y) < cornerHit) return 'nw';
            if (Math.abs(worldX - element.x2) < cornerHit && Math.abs(worldY - element.y2) < cornerHit) return 'se';
            return null;
        }

        const { x, y, width, height } = element;

        // Transform mouse into element-local coords (unrotate around center)
        let lx = worldX, ly = worldY;
        if (element.rotation && element.rotation !== 0) {
            const cx = x + width / 2;
            const cy = y + height / 2;
            const cos = Math.cos(-element.rotation);
            const sin = Math.sin(-element.rotation);
            const dx = worldX - cx;
            const dy = worldY - cy;
            lx = cx + dx * cos - dy * sin;
            ly = cy + dx * sin + dy * cos;
        }

        // Frames cannot be rotated (they are axis-aligned layout containers)
        const isFrame = element.type === 'frame';

        // Only trigger rotation when the mouse is OUTSIDE the element bounds
        const isOutside = lx < x || lx > x + width || ly < y || ly > y + height;

        const inRotZone = (cornerX, cornerY) => {
            if (isFrame) return false;  // frames never show rotation handles
            if (!isOutside) return false;
            const dx = lx - cornerX;
            const dy = ly - cornerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return dist >= rotInner && dist <= rotOuter;
        };

        // Corners (resize)
        if (Math.abs(lx - x) < cornerHit && Math.abs(ly - y) < cornerHit) return 'nw';
        if (Math.abs(lx - (x + width)) < cornerHit && Math.abs(ly - y) < cornerHit) return 'ne';
        if (Math.abs(lx - (x + width)) < cornerHit && Math.abs(ly - (y + height)) < cornerHit) return 'se';
        if (Math.abs(lx - x) < cornerHit && Math.abs(ly - (y + height)) < cornerHit) return 'sw';

        // Rotation zones — just outside each corner
        if (inRotZone(x, y)) return 'rot-nw';
        if (inRotZone(x + width, y)) return 'rot-ne';
        if (inRotZone(x + width, y + height)) return 'rot-se';
        if (inRotZone(x, y + height)) return 'rot-sw';

        // Edges
        const inXRange = lx >= x + cornerHit && lx <= x + width - cornerHit;
        const inYRange = ly >= y + cornerHit && ly <= y + height - cornerHit;

        if (inXRange && Math.abs(ly - y) < edgeHit) return 'n';
        if (inXRange && Math.abs(ly - (y + height)) < edgeHit) return 's';
        if (inYRange && Math.abs(lx - x) < edgeHit) return 'w';
        if (inYRange && Math.abs(lx - (x + width)) < edgeHit) return 'e';

        return null;
    }

    getHandleCursor(handle) {
        if (!handle) return 'default';
        if (handle.startsWith('rot-')) {
            const corner = handle.slice(4); // 'nw' | 'ne' | 'se' | 'sw'
            return this._getRotateCursor(corner);
        }
        const cursors = {
            'nw': 'nw-resize',
            'n': 'n-resize',
            'ne': 'ne-resize',
            'e': 'e-resize',
            'se': 'se-resize',
            's': 's-resize',
            'sw': 'sw-resize',
            'w': 'w-resize'
        };
        return cursors[handle] || 'default';
    }

    _getRotateCursor(corner) {
        const degMap = { nw: 0, ne: 90, se: 180, sw: 270 };
        let deg = degMap[corner] ?? 0;
        // Add the element's own rotation so the cursor follows the rotated corners
        const el = this.selectedElements[0];
        if (el && el.rotation) {
            deg += el.rotation * (180 / Math.PI);
        }
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><g transform="rotate(${deg} 12 12)"><path d="M7 17Q3 3 17 7" stroke="#000" stroke-width="1.8" fill="none" stroke-linecap="round"/><path d="M5 14.5L7 17L9.5 15" stroke="#000" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M15 9.5L17 7L14.5 5" stroke="#000" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 12 12, pointer`;
    }

    triggerImageUpload(worldX, worldY) {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.multiple = true; // Enable multiple file selection

        input.onchange = (e) => {
            const files = Array.from(e.target.files);
            if (files.length === 0) return;

            const imagesPerRow = 8;
            const spacing = 30;
            let loadedCount = 0;
            const imageElements = [];

            // Load all images first
            files.forEach((file, index) => {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        imageElements[index] = {
                            image: img,
                            width: img.width,
                            height: img.height,
                            src: event.target.result
                        };

                        loadedCount++;

                        // When all images are loaded, arrange them in grid
                        if (loadedCount === files.length) {
                            // Save state BEFORE adding images
                            this.saveState();
                            this.arrangeImagesInGrid(imageElements, worldX, worldY, imagesPerRow, spacing);

                            // Scroll viewport to the last placed image
                            const lastImg = imageElements[imageElements.length - 1];
                            if (lastImg) {
                                const placed = this.elements.find(el =>
                                    el.type === 'image' && el.image === lastImg.image);
                                if (placed) {
                                    this.scrollToCenter(placed.x, placed.y, placed.width, placed.height);
                                }
                            }
                            this.render();
                        }
                    };
                    img.src = event.target.result;
                };
                reader.readAsDataURL(file);
            });
        };
        input.click();
    }

    arrangeImagesInGrid(imageElements, startX, startY, imagesPerRow, spacing) {
        // Use grid position for the first image
        const firstPos = this.getNextGridPosition(
            imageElements[0]?.width || 500,
            imageElements[0]?.height || 500,
            spacing, imagesPerRow
        );

        let currentX = firstPos.x;
        let currentY = firstPos.y;
        let maxHeightInRow = 0;
        const newElements = [];

        imageElements.forEach((imgData, index) => {
            // Add image to canvas
            const element = {
                type: 'image',
                x: currentX,
                y: currentY,
                width: imgData.width,
                height: imgData.height,
                image: imgData.image,
                src: imgData.src
            };
            this.elements.push(element);
            newElements.push(element);

            // Auto-describe image for layer naming
            if (window.GenPanel && window.GenPanel.describeImageElement) {
                window.GenPanel.describeImageElement(element);
            }

            // Track max height in current row
            maxHeightInRow = Math.max(maxHeightInRow, imgData.height);

            // Move to next position
            if ((index + 1) % imagesPerRow === 0) {
                // Start new row
                currentX = firstPos.x;
                currentY += maxHeightInRow + spacing;
                maxHeightInRow = 0;
            } else {
                // Move to next column
                currentX += imgData.width + spacing;
            }
        });

        // Auto-select new images
        this.selectedElements = newElements;
    }

    startTextEditing(element) {
        if (element.type !== 'text') return;

        if (this.editingText === element) return;

        // Finish any current text editing session first
        if (this.textInput) {
            this.textInput.blur();
        }

        this.editingText = element;
        const originalText = element.text;
        element._editing = true;

        const input = document.createElement('textarea');
        input.value = element.text;
        input.style.position = 'fixed';

        const worldPadding = 5;

        const measureCanvas = document.createElement('canvas');
        const measureCtx = measureCanvas.getContext('2d');

        const updatePositionAndSize = () => {
            if (!this.editingText || this.editingText !== element) return;

            const scale = this.viewport.scale;
            const scaledPadding = worldPadding * scale;
            const screenPos = this.worldToScreen(element.x, element.y);
            const scaledFontSize = Math.max(1, element.fontSize * scale);

            input.style.left = (screenPos.x + scaledPadding) + 'px';
            input.style.top = (screenPos.y + scaledPadding) + 'px';
            input.style.fontSize = scaledFontSize + 'px';

            const lines = (input.value || '').split('\n');
            const lineHeight = scaledFontSize * 1.2;

            measureCtx.font = `${scaledFontSize}px ${element.fontFamily || 'Inter, sans-serif'}`;
            let maxLineWidth = scaledFontSize * 2;
            lines.forEach(line => {
                maxLineWidth = Math.max(maxLineWidth, measureCtx.measureText(line || ' ').width);
            });

            input.style.width = (maxLineWidth + scaledFontSize) + 'px';
            input.style.height = Math.max(lineHeight, lines.length * lineHeight + 4) + 'px';
        };

        input.style.fontFamily = element.fontFamily || 'Inter, sans-serif';
        input.style.color = element.color || '#000000';
        input.style.background = 'transparent';
        input.style.border = 'none';
        input.style.outline = 'none';
        input.style.resize = 'none';
        input.style.padding = '0';
        input.style.margin = '0';
        input.style.lineHeight = '1.2';
        input.style.boxSizing = 'border-box';
        input.style.zIndex = '10000';
        input.style.overflow = 'hidden';
        input.style.whiteSpace = 'pre';
        input.style.caretColor = '#0099B8';

        this.textInput = input;
        this._textUpdatePosition = updatePositionAndSize;
        document.body.appendChild(input);
        updatePositionAndSize();
        input.focus();
        setTimeout(() => {
            input.select();
            updatePositionAndSize();
        }, 0);

        input.addEventListener('input', () => {
            element.text = input.value || '';
            this.fitTextElement(element);
            updatePositionAndSize();
            this.render();
        });

        let finished = false;
        const finishEditing = () => {
            if (finished) return;
            finished = true;
            delete element._editing;
            this._textUpdatePosition = null;

            const newText = input.value;
            if (!newText.trim()) {
                const index = this.elements.indexOf(element);
                if (index > -1) this.elements.splice(index, 1);
            } else {
                element.text = newText;
                this.fitTextElement(element);
            }

            if (document.body.contains(input)) document.body.removeChild(input);
            this.textInput = null;
            this.editingText = null;
            this.render();
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') {
                element.text = originalText;
                finished = true;
                delete element._editing;
                this._textUpdatePosition = null;
                if (document.body.contains(input)) document.body.removeChild(input);
                this.textInput = null;
                this.editingText = null;
                this.fitTextElement(element);
                this.render();
            }
        });

        this.render();
    }

    stopTextEditing() {
        if (this.textInput && this.editingText) {
            delete this.editingText._editing;
            this._textUpdatePosition = null;

            const newText = this.textInput.value.trim();
            if (!newText) {
                const index = this.elements.indexOf(this.editingText);
                if (index > -1) {
                    this.elements.splice(index, 1);
                }
            } else {
                this.editingText.text = this.textInput.value;
                this.fitTextElement(this.editingText);
            }

            const inputEl = this.textInput;
            this.textInput = null;
            this.editingText = null;
            if (document.body.contains(inputEl)) document.body.removeChild(inputEl);
            this.render();
        }
    }

    findElementAt(worldX, worldY) {
        // First pass: check frame headers (name area above frame) — highest priority
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type === 'frame' && this.isOnFrameHeader(el, worldX, worldY)) {
                return el;
            }
        }

        // Second pass: check non-frame elements
        // Only search children of the "entered" frame, or non-parented elements
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type === 'frame') continue;

            // If element is inside a frame, only allow selection if that frame is "entered"
            if (el.parentFrame && el.parentFrame !== this.enteredFrame) continue;

            if (el.type === 'shape' && el.shapeType === 'line') {
                const threshold = 5 / this.viewport.scale;
                const dist = this.pointToLineDistance(worldX, worldY, el.x, el.y, el.x2, el.y2);
                if (dist < threshold) return el;
            } else if (el.type === 'path') {
                if (this.isPointOnPath(el, worldX, worldY)) return el;
            } else {
                // Unrotate point into element-local space if rotated
                let lx = worldX, ly = worldY;
                if (el.rotation && el.rotation !== 0 && el.width !== undefined) {
                    const cx = el.x + el.width / 2;
                    const cy = el.y + el.height / 2;
                    const cos = Math.cos(-el.rotation);
                    const sin = Math.sin(-el.rotation);
                    const dx = worldX - cx;
                    const dy = worldY - cy;
                    lx = cx + dx * cos - dy * sin;
                    ly = cy + dx * sin + dy * cos;
                }
                if (lx >= el.x && lx <= el.x + el.width &&
                    ly >= el.y && ly <= el.y + el.height) {
                    return el;
                }
            }
        }

        // Third pass: check frames (body area)
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type !== 'frame') continue;
            if (worldX >= el.x && worldX <= el.x + el.width &&
                worldY >= el.y && worldY <= el.y + el.height) {
                return el;
            }
        }

        return null;
    }

    pointToLineDistance(px, py, x1, y1, x2, y2) {
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;

        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;

        if (lenSq != 0) param = dot / lenSq;

        let xx, yy;

        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }

        const dx = px - xx;
        const dy = py - yy;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // ==================== Rendering ====================

    scheduleRender() {
        if (this.renderScheduled) return;

        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.render();
            this.renderScheduled = false;
        });
    }

    render() {
        const dpr = this.dpr || 1;

        // Apply DPR scale so all drawing commands use CSS pixel units
        this.ctx.save();
        this.ctx.scale(dpr, dpr);

        // High-quality image interpolation for sharp rendering
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = 'high';

        // Clear canvas (in CSS pixels)
        this.ctx.fillStyle = '#EAEFF5';
        this.ctx.fillRect(0, 0, this.cssWidth || this.canvas.width, this.cssHeight || this.canvas.height);

        // Draw background grid
        this.drawGrid();

        // Apply viewport transform
        this.ctx.save();
        this.ctx.translate(this.viewport.x, this.viewport.y);
        this.ctx.scale(this.viewport.scale, this.viewport.scale);

        // Render elements with frame clipping
        // 1. Render non-parented, non-frame elements first (below frames)
        //    Unparented paths are deferred to pass 3 (top layer)
        this.elements.forEach(el => {
            if (el === this.tempElement) return;
            if (el.type === 'frame') return;
            if (el.type === 'path' && !el.parentFrame) return;
            if (el.parentFrame) return;
            this.renderElement(el);
        });

        // 2. Render frames and their children (with clipping)
        this.elements.forEach(el => {
            if (el === this.tempElement) return;
            if (el.type !== 'frame') return;

            // Render the frame itself
            this.renderElement(el);

            // Render frame highlight during drag
            if (this.highlightedFrame === el) {
                this.ctx.save();
                this.ctx.strokeStyle = '#0099B8';
                this.ctx.lineWidth = 3 / this.viewport.scale;
                this.ctx.setLineDash([]);
                this.ctx.strokeRect(el.x, el.y, el.width, el.height);
                this.ctx.restore();
            }

            // Render children clipped to frame bounds
            const children = this.getFrameChildren(el);
            if (children.length > 0) {
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.rect(el.x, el.y, el.width, el.height);
                this.ctx.clip();
                children.forEach(child => {
                    if (child !== this.tempElement) {
                        this.renderElement(child);
                    }
                });
                this.ctx.restore();
            }

            // Loading overlay AFTER children so it renders on top of images
            if (el._generating) {
                this.renderFrameLoadingOverlay(el);
            }
        });

        // Render selected frame children unclipped with reduced opacity
        // so the user can see parts extending outside the frame
        this.selectedElements.forEach(el => {
            if (el.parentFrame && el !== this.tempElement) {
                this.ctx.save();
                this.ctx.globalAlpha = 0.35;
                this.renderElement(el);
                this.ctx.restore();
            }
        });

        // 3. Render pencil paths on top of frames (always top-layer)
        this.elements.forEach(el => {
            if (el === this.tempElement) return;
            if (el.type !== 'path') return;
            if (el.parentFrame) return; // Orphaned frame children still clipped (shouldn't happen)
            this.renderElement(el);
        });

        // Render temporary element
        if (this.tempElement) {
            this.renderElement(this.tempElement);
        }

        // Render selection (unclipped so handles are always visible)
        this.selectedElements.forEach(el => this.renderSelection(el));

        // Render drag selection box
        if (this.isSelecting && this.selectionStart && this.selectionEnd) {
            const x = Math.min(this.selectionStart.x, this.selectionEnd.x);
            const y = Math.min(this.selectionStart.y, this.selectionEnd.y);
            const width = Math.abs(this.selectionEnd.x - this.selectionStart.x);
            const height = Math.abs(this.selectionEnd.y - this.selectionStart.y);

            this.ctx.save();
            this.ctx.fillStyle = 'rgba(0, 153, 255, 0.1)';
            this.ctx.strokeStyle = 'rgba(0, 153, 255, 0.5)';
            this.ctx.lineWidth = 1 / this.viewport.scale;
            this.ctx.fillRect(x, y, width, height);
            this.ctx.strokeRect(x, y, width, height);
            this.ctx.restore();
        }

        // Render snap guide lines (Figma-style) - show during drag or resize
        if (this.snapGuides && (this.isDragging || this.resizeHandle) && (this.snapGuides.vertical.length > 0 || this.snapGuides.horizontal.length > 0)) {
            this.ctx.save();
            const guideColor = 'rgba(255, 51, 102, 0.75)';
            this.ctx.strokeStyle = guideColor;
            this.ctx.lineWidth = 1 / this.viewport.scale; // Always 1 screen pixel
            this.ctx.setLineDash([]); // Solid line

            // Helper: draw a small × cross at world-space point (wx, wy)
            const crossSize = 4 / this.viewport.scale;
            const drawCross = (wx, wy) => {
                this.ctx.beginPath();
                this.ctx.moveTo(wx - crossSize, wy - crossSize);
                this.ctx.lineTo(wx + crossSize, wy + crossSize);
                this.ctx.moveTo(wx + crossSize, wy - crossSize);
                this.ctx.lineTo(wx - crossSize, wy + crossSize);
                this.ctx.stroke();
            };

            // All elements for alignment checks
            const allElements = this.elements;
            const tolerance = 5;

            // Draw vertical guide lines
            this.snapGuides.vertical.forEach(guideX => {
                // Collect all elements whose edge or center aligns at guideX
                let minY = Infinity, maxY = -Infinity;
                let isCenterLine = false;
                let centerMinY = Infinity, centerMaxY = -Infinity;

                allElements.forEach(el => {
                    const left = el.x;
                    const right = el.x + el.width;
                    const centerX = el.x + el.width / 2;
                    const elTop = el.y;
                    const elBottom = el.y + el.height;

                    if (Math.abs(centerX - guideX) < tolerance) {
                        isCenterLine = true;
                        centerMinY = Math.min(centerMinY, el.y + el.height / 2);
                        centerMaxY = Math.max(centerMaxY, el.y + el.height / 2);
                    } else if (Math.abs(left - guideX) < tolerance || Math.abs(right - guideX) < tolerance) {
                        minY = Math.min(minY, elTop);
                        maxY = Math.max(maxY, elBottom);
                    }
                });

                let y1, y2;
                this.ctx.beginPath();
                if (isCenterLine) {
                    y1 = centerMinY; y2 = centerMaxY;
                    this.ctx.moveTo(guideX, y1);
                    this.ctx.lineTo(guideX, y2);
                } else if (minY <= maxY) {
                    y1 = minY; y2 = maxY;
                    this.ctx.moveTo(guideX, y1);
                    this.ctx.lineTo(guideX, y2);
                }
                this.ctx.stroke();
                // Draw × at both endpoints
                if (y1 !== undefined) {
                    drawCross(guideX, y1);
                    drawCross(guideX, y2);
                }
            });

            // Draw horizontal guide lines
            this.snapGuides.horizontal.forEach(guideY => {
                // Collect all elements whose edge or center aligns at guideY
                let minX = Infinity, maxX = -Infinity;
                let isCenterLine = false;
                let centerMinX = Infinity, centerMaxX = -Infinity;

                allElements.forEach(el => {
                    const top = el.y;
                    const bottom = el.y + el.height;
                    const centerY = el.y + el.height / 2;
                    const elLeft = el.x;
                    const elRight = el.x + el.width;

                    if (Math.abs(centerY - guideY) < tolerance) {
                        isCenterLine = true;
                        centerMinX = Math.min(centerMinX, el.x + el.width / 2);
                        centerMaxX = Math.max(centerMaxX, el.x + el.width / 2);
                    } else if (Math.abs(top - guideY) < tolerance || Math.abs(bottom - guideY) < tolerance) {
                        minX = Math.min(minX, elLeft);
                        maxX = Math.max(maxX, elRight);
                    }
                });

                let x1, x2;
                this.ctx.beginPath();
                if (isCenterLine) {
                    x1 = centerMinX; x2 = centerMaxX;
                    this.ctx.moveTo(x1, guideY);
                    this.ctx.lineTo(x2, guideY);
                } else if (minX <= maxX) {
                    x1 = minX; x2 = maxX;
                    this.ctx.moveTo(x1, guideY);
                    this.ctx.lineTo(x2, guideY);
                }
                this.ctx.stroke();
                // Draw × at both endpoints
                if (x1 !== undefined) {
                    drawCross(x1, guideY);
                    drawCross(x2, guideY);
                }
            });

            this.ctx.restore();
        }

        this.ctx.restore(); // viewport transform
        this.ctx.restore(); // DPR scale

        // Sync text editing overlay position with current viewport
        if (this._textUpdatePosition) {
            this._textUpdatePosition();
        }

        // Notify selection change
        if (this.onSelectionChange) {
            this.onSelectionChange(this.selectedElements);
        }
    }

    drawGrid() {
        const baseGridSize = 24;
        const dotSize = 1;
        const dotColor = 'rgba(7, 50, 71, 0.15)';

        // Skip grid rendering if zoom is too small to avoid artifacts
        if (this.viewport.scale < 0.05) return;

        // Adaptive grid spacing based on zoom level for performance
        let gridSize = baseGridSize;
        if (this.viewport.scale < 0.2) {
            gridSize = baseGridSize * 4; // Larger spacing at low zoom
        } else if (this.viewport.scale < 0.5) {
            gridSize = baseGridSize * 2;
        }

        this.ctx.fillStyle = dotColor;

        // Calculate visible bounds with padding
        const padding = 100;
        const startX = Math.floor((-this.viewport.x / this.viewport.scale - padding) / gridSize) * gridSize;
        const startY = Math.floor((-this.viewport.y / this.viewport.scale - padding) / gridSize) * gridSize;
        const cssW = this.cssWidth || this.canvas.width;
        const cssH = this.cssHeight || this.canvas.height;
        const endX = Math.ceil((cssW - this.viewport.x) / this.viewport.scale + padding) / gridSize * gridSize;
        const endY = Math.ceil((cssH - this.viewport.y) / this.viewport.scale + padding) / gridSize * gridSize;

        // Limit maximum number of grid dots for performance
        const maxDots = 5000;
        const estimatedDots = ((endX - startX) / gridSize) * ((endY - startY) / gridSize);

        if (estimatedDots > maxDots) {
            // Too many dots, increase spacing further
            gridSize *= Math.ceil(Math.sqrt(estimatedDots / maxDots));
        }

        for (let x = startX; x < endX; x += gridSize) {
            for (let y = startY; y < endY; y += gridSize) {
                const screenPos = this.worldToScreen(x, y);
                // Only draw dots that are within canvas bounds
                if (screenPos.x >= -10 && screenPos.x <= cssW + 10 &&
                    screenPos.y >= -10 && screenPos.y <= cssH + 10) {
                    this.ctx.fillRect(screenPos.x, screenPos.y, dotSize, dotSize);
                }
            }
        }
    }

    renderElement(el) {
        this.ctx.save();

        // Apply rotation transform around element center
        if (el.rotation && el.rotation !== 0 && el.width !== undefined && el.height !== undefined) {
            const cx = el.x + el.width / 2;
            const cy = el.y + el.height / 2;
            this.ctx.translate(cx, cy);
            this.ctx.rotate(el.rotation);
            this.ctx.translate(-cx, -cy);
        }

        switch (el.type) {
            case 'frame':
                this.ctx.fillStyle = el.fill;
                this.ctx.fillRect(el.x, el.y, el.width, el.height);
                this.ctx.strokeStyle = el.stroke;
                this.ctx.lineWidth = el.strokeWidth;
                this.ctx.strokeRect(el.x, el.y, el.width, el.height);

                // Draw Frame Headers (Name + Ratio + Dimensions) — hidden below 10% zoom
                // Rendered in screen-space for pixel-crisp text at any zoom level
                if (this.viewport.scale >= 0.10) {
                    const isSelected = this.selectedElements.indexOf(el) !== -1;
                    const labelColor = '#2f3640';
                    const selectedNameColor = '#0099B8';

                    const screenFontSize = 12;
                    const screenGap = 8;

                    const leftScreen = this.worldToScreen(el.x, el.y);
                    const rightScreen = this.worldToScreen(el.x + el.width, el.y);

                    // Reset to DPR-only transform (remove viewport, keep pixel density)
                    const dpr = this.dpr || 1;
                    this.ctx.save();
                    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

                    const textY = leftScreen.y - screenGap;
                    this.ctx.font = `400 ${screenFontSize}px Inter, system-ui, sans-serif`;
                    this.ctx.textBaseline = 'bottom';

                    // 1. Name (Left) — highlight when selected
                    this.ctx.textAlign = 'left';
                    this.ctx.fillStyle = isSelected ? selectedNameColor : labelColor;
                    this.ctx.fillText(el.name || 'Frame', Math.round(leftScreen.x), Math.round(textY));

                    // 2. Dimensions (Right) — actual image resolution in px if frame has image, else frame size.
                    // Use the LAST image child so we always show the most recently generated image size.
                    const childImages = this.elements.filter(e => e.type === 'image' && e.parentFrame === el);
                    const childImage = childImages.length ? childImages[childImages.length - 1] : null;
                    const dimLabel = childImage?.image?.naturalWidth
                        ? this._getDimLabel(childImage.image.naturalWidth, childImage.image.naturalHeight)
                        : this._getDimLabel(el.width, el.height);
                    this.ctx.textAlign = 'right';
                    this.ctx.fillStyle = labelColor;
                    this.ctx.fillText(dimLabel, Math.round(rightScreen.x), Math.round(textY));

                    this.ctx.restore();
                }

                // Loading overlay is rendered AFTER children in render() loop
                // so it appears on top of images for replace mode
                break;

            case 'image':
                if (el.image) {
                    this.ctx.drawImage(el.image, el.x, el.y, el.width, el.height);
                }
                break;

            case 'text':
                // Skip rendering text while it is being edited in textarea overlay
                if (el === this.editingText) break;
                this.ctx.font = `${el.fontSize}px ${el.fontFamily}`;
                this.ctx.fillStyle = el.color;
                this.ctx.textAlign = el.align || 'left';
                this.ctx.textBaseline = 'top';

                // Simple text rendering (Point Text)
                const padding = 5;
                const lines = el.text.split('\n');
                const lineHeight = el.fontSize * 1.2;

                lines.forEach((line, index) => {
                    this.ctx.fillText(line, el.x + padding, el.y + padding + index * lineHeight);
                });
                break;

            case 'shape':
                this.renderShape(el);
                break;

            case 'path':
                if (!el.points || el.points.length === 0) break;
                this.ctx.beginPath();
                if (el.points.length === 1) {
                    // Single dot
                    const r = (el.strokeWidth || 6) / 2;
                    this.ctx.arc(el.points[0].x, el.points[0].y, r, 0, Math.PI * 2);
                    this.ctx.fillStyle = el.stroke;
                    this.ctx.fill();
                } else {
                    // Smooth curve through points using quadratic bezier
                    this.ctx.moveTo(el.points[0].x, el.points[0].y);
                    for (let i = 1; i < el.points.length - 1; i++) {
                        const mx = (el.points[i].x + el.points[i + 1].x) / 2;
                        const my = (el.points[i].y + el.points[i + 1].y) / 2;
                        this.ctx.quadraticCurveTo(el.points[i].x, el.points[i].y, mx, my);
                    }
                    const last = el.points[el.points.length - 1];
                    this.ctx.lineTo(last.x, last.y);
                    this.ctx.strokeStyle = el.stroke;
                    this.ctx.lineWidth = el.strokeWidth || 6;
                    this.ctx.lineCap = 'round';
                    this.ctx.lineJoin = 'round';
                    this.ctx.stroke();
                }
                break;
        }

        this.ctx.restore();
    }

    renderShape(el) {
        const shapeType = el.shapeType || 'rectangle';

        this.ctx.beginPath();

        switch (shapeType) {
            case 'rectangle':
                if (el.cornerRadius && el.cornerRadius > 0) {
                    this.roundRect(el.x, el.y, el.width, el.height, el.cornerRadius);
                } else {
                    this.ctx.rect(el.x, el.y, el.width, el.height);
                }
                break;

            case 'ellipse':
                this.ctx.ellipse(
                    el.x + el.width / 2,
                    el.y + el.height / 2,
                    el.width / 2,
                    el.height / 2,
                    0, 0, Math.PI * 2
                );
                break;

            case 'line':
                this.ctx.moveTo(el.x, el.y);
                this.ctx.lineTo(el.x2, el.y2);
                break;

            case 'triangle':
                this.drawPolygon(el.x, el.y, el.width, el.height, 3);
                break;

            case 'star':
                this.drawStar(el.x, el.y, el.width, el.height, 5, 0.382);
                break;
        }

        if (el.fill && el.fill !== 'none') {
            this.ctx.fillStyle = el.fill;
            this.ctx.fill();
        }

        if (el.stroke && el.strokeWidth > 0) {
            this.ctx.strokeStyle = el.stroke;
            this.ctx.lineWidth = el.strokeWidth;
            this.ctx.stroke();
        }
    }

    drawPolygon(x, y, width, height, sides) {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const radiusX = width / 2;
        const radiusY = height / 2;

        // Adjust angle to start from top
        const startAngle = -Math.PI / 2;

        this.ctx.beginPath();
        for (let i = 0; i < sides; i++) {
            const angle = startAngle + (i * 2 * Math.PI / sides);
            // Use ellipse parametric equation for stretching
            const px = cx + radiusX * Math.cos(angle);
            const py = cy + radiusY * Math.sin(angle);

            if (i === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
    }

    drawStar(x, y, width, height, points, innerRatio) {
        const cx = x + width / 2;
        const cy = y + height / 2;
        const outerRadiusX = width / 2;
        const outerRadiusY = height / 2;
        const innerRadiusX = outerRadiusX * innerRatio;
        const innerRadiusY = outerRadiusY * innerRatio;

        const startAngle = -Math.PI / 2;

        this.ctx.beginPath();
        for (let i = 0; i < points * 2; i++) {
            const isOuter = i % 2 === 0;
            const rx = isOuter ? outerRadiusX : innerRadiusX;
            const ry = isOuter ? outerRadiusY : innerRadiusY;

            const angle = startAngle + (i * Math.PI / points);
            const px = cx + rx * Math.cos(angle);
            const py = cy + ry * Math.sin(angle);

            if (i === 0) this.ctx.moveTo(px, py);
            else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
    }

    roundRect(x, y, width, height, radius) {
        this.ctx.moveTo(x + radius, y);
        this.ctx.lineTo(x + width - radius, y);
        this.ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
        this.ctx.lineTo(x + width, y + height - radius);
        this.ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
        this.ctx.lineTo(x + radius, y + height);
        this.ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
        this.ctx.lineTo(x, y + radius);
        this.ctx.quadraticCurveTo(x, y, x + radius, y);
    }

    renderSelection(el) {
        if (el === this.editingText) return;

        this.ctx.save();

        // Apply same rotation transform as renderElement so selection aligns with rotated element
        if (el.rotation && el.rotation !== 0 && el.width !== undefined && el.height !== undefined) {
            const cx = el.x + el.width / 2;
            const cy = el.y + el.height / 2;
            this.ctx.translate(cx, cy);
            this.ctx.rotate(el.rotation);
            this.ctx.translate(-cx, -cy);
        }

        // Use #0099B8 color and 1px solid border
        this.ctx.strokeStyle = '#0099B8';
        this.ctx.lineWidth = 1 / this.viewport.scale;
        this.ctx.setLineDash([]);

        if (el.type === 'shape' && el.shapeType === 'line') {
            // Selection for lines - show endpoints
            const handleSize = 8 / this.viewport.scale;

            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.strokeStyle = '#0099B8';
            this.ctx.lineWidth = 1 / this.viewport.scale;

            // Start point
            this.ctx.fillRect(el.x - handleSize / 2, el.y - handleSize / 2, handleSize, handleSize);
            this.ctx.strokeRect(el.x - handleSize / 2, el.y - handleSize / 2, handleSize, handleSize);

            // End point
            this.ctx.fillRect(el.x2 - handleSize / 2, el.y2 - handleSize / 2, handleSize, handleSize);
            this.ctx.strokeRect(el.x2 - handleSize / 2, el.y2 - handleSize / 2, handleSize, handleSize);
        } else if (el.type === 'path') {
            // Path selection - show bounding box
            const bounds = this.getPathBounds(el);

            // Draw selection box precisely on bounds
            this.ctx.strokeRect(
                bounds.x,
                bounds.y,
                bounds.width,
                bounds.height
            );

            // Draw corner handles only for paths (no resize for now)
            const handleSize = 8 / this.viewport.scale;
            const handles = [
                { x: bounds.x, y: bounds.y },
                { x: bounds.x + bounds.width, y: bounds.y },
                { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
                { x: bounds.x, y: bounds.y + bounds.height }
            ];

            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.strokeStyle = '#0099B8';
            this.ctx.lineWidth = 1 / this.viewport.scale;

            handles.forEach(handle => {
                this.ctx.fillRect(
                    handle.x - handleSize / 2,
                    handle.y - handleSize / 2,
                    handleSize,
                    handleSize
                );
                this.ctx.strokeRect(
                    handle.x - handleSize / 2,
                    handle.y - handleSize / 2,
                    handleSize,
                    handleSize
                );
            });
        } else {
            // Standard bounding box selection - draw precisely on element bounds
            this.ctx.strokeRect(
                el.x,
                el.y,
                el.width,
                el.height
            );

            // Draw resize handles - only 4 corners, small circles
            const handleRadius = 3 / this.viewport.scale; // Small 3px radius circles
            const cornerHandles = [
                { x: el.x, y: el.y },                           // Top-left
                { x: el.x + el.width, y: el.y },                // Top-right
                { x: el.x + el.width, y: el.y + el.height },    // Bottom-right
                { x: el.x, y: el.y + el.height }                // Bottom-left
            ];

            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.strokeStyle = '#0099B8';
            this.ctx.lineWidth = 1 / this.viewport.scale;

            cornerHandles.forEach(handle => {
                this.ctx.beginPath();
                this.ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            });

            // Draw rotation arc indicators at corners (only when single element selected)
            if (this.selectedElements.length === 1) {
                // Only draw the corner that the mouse is currently hovering over (problem 3)
                this.drawRotationHandles(el, this.hoveredRotCorner || null);
            }
        }

        this.ctx.setLineDash([]);
        this.ctx.restore();
    }

    drawRotationHandles(_el, _corner) {
        // Rotation intent is communicated entirely through the cursor (_getRotateCursor).
        // No canvas overlay is drawn.
    }

    // ==================== Frame Container Logic ====================

    // Get all children of a frame
    getFrameChildren(frame) {
        return this.elements.filter(el => el.parentFrame === frame);
    }

    // Find the topmost frame at a world position (excluding specified elements)
    getFrameAt(worldX, worldY, excludeElements = []) {
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type !== 'frame') continue;
            if (excludeElements.includes(el)) continue;
            if (worldX >= el.x && worldX <= el.x + el.width &&
                worldY >= el.y && worldY <= el.y + el.height) {
                return el;
            }
        }
        return null;
    }

    // Calculate what percentage of element's area is inside a frame
    getOverlapPercent(element, frame) {
        let elLeft, elRight, elTop, elBottom;
        if (element.type === 'path' && element.points && element.points.length) {
            const b = this.getPathBounds(element);
            elLeft = b.x; elRight = b.x + b.width;
            elTop = b.y; elBottom = b.y + b.height;
        } else {
            elLeft = element.x;
            elRight = element.x + (element.width || 0);
            elTop = element.y;
            elBottom = element.y + (element.height || 0);
        }

        const frLeft = frame.x;
        const frRight = frame.x + frame.width;
        const frTop = frame.y;
        const frBottom = frame.y + frame.height;

        // Calculate intersection
        const overlapLeft = Math.max(elLeft, frLeft);
        const overlapRight = Math.min(elRight, frRight);
        const overlapTop = Math.max(elTop, frTop);
        const overlapBottom = Math.min(elBottom, frBottom);

        if (overlapRight <= overlapLeft || overlapBottom <= overlapTop) {
            return 0; // No overlap
        }

        const overlapArea = (overlapRight - overlapLeft) * (overlapBottom - overlapTop);
        const elementArea = element.width * element.height;

        if (elementArea <= 0) return 0;
        return overlapArea / elementArea;
    }

    // Push a frame so it doesn't overlap any other frame.
    resolveFrameOverlap(frame) {
        const gap = 30;
        const oldX = frame.x, oldY = frame.y;
        const otherFrames = this.elements.filter(el => el.type === 'frame' && el !== frame);

        for (let iter = 0; iter < 5; iter++) {
            let pushed = false;
            for (const other of otherFrames) {
                const overlapX = Math.min(frame.x + frame.width, other.x + other.width) - Math.max(frame.x, other.x);
                const overlapY = Math.min(frame.y + frame.height, other.y + other.height) - Math.max(frame.y, other.y);
                if (overlapX <= 0 || overlapY <= 0) continue;

                const cx = frame.x + frame.width / 2;
                const cy = frame.y + frame.height / 2;
                const ocx = other.x + other.width / 2;
                const ocy = other.y + other.height / 2;

                if (overlapX < overlapY) {
                    frame.x += cx < ocx ? -(overlapX + gap) : (overlapX + gap);
                } else {
                    frame.y += cy < ocy ? -(overlapY + gap) : (overlapY + gap);
                }
                pushed = true;
            }
            if (!pushed) break;
        }

        // Move children by the total displacement
        const totalDx = frame.x - oldX;
        const totalDy = frame.y - oldY;
        if (totalDx !== 0 || totalDy !== 0) {
            this.getFrameChildren(frame).forEach(child => {
                child.x += totalDx;
                child.y += totalDy;
            });
        }
    }

    // Attach element to a frame
    attachToFrame(element, frame) {
        if (element === frame) return; // Can't parent to self
        if (element.type === 'frame') return; // Frames can't be children (for now)
        element.parentFrame = frame;
    }

    // Detach element from its parent frame
    detachFromFrame(element) {
        delete element.parentFrame;
    }

    // Check and update frame attachment for an element based on 50% overlap rule.
    // For zero-size or near-zero elements (e.g. freshly placed text before any typing),
    // fall back to a point-in-frame test using the element's (x, y) origin so they still
    // attach correctly even when their area hasn't been computed yet.
    updateFrameAttachment(element) {
        if (element.type === 'frame') return;

        let bestFrame = null;
        let bestOverlap = 0;

        const elArea = (element.width || 0) * (element.height || 0);

        this.elements.forEach(el => {
            if (el.type !== 'frame') return;
            if (el === element) return;

            let score;
            if (elArea > 0) {
                // Normal case: use area-overlap ratio
                score = this.getOverlapPercent(element, el);
            } else {
                // Zero-size element (e.g. new text): test if origin point is inside frame
                const px = element.x, py = element.y;
                score = (px >= el.x && px <= el.x + el.width &&
                         py >= el.y && py <= el.y + el.height) ? 1 : 0;
            }

            if (score > bestOverlap) {
                bestOverlap = score;
                bestFrame = el;
            }
        });

        if (bestOverlap > 0.5 && bestFrame) {
            this.attachToFrame(element, bestFrame);
            // Ensure new element renders on top of all existing children of this frame
            this.bringToTopOfFrame(element, bestFrame);
        } else {
            this.detachFromFrame(element);
        }
    }

    // Move element to the end of its frame's children in this.elements (so it renders on top)
    bringToTopOfFrame(element, frame) {
        // Find the last index of any child of this frame in this.elements
        let lastChildIndex = -1;
        for (let i = 0; i < this.elements.length; i++) {
            if (this.elements[i].parentFrame === frame && this.elements[i] !== element) {
                lastChildIndex = i;
            }
        }
        const currentIndex = this.elements.indexOf(element);
        if (currentIndex === -1) return;

        // Only move if element is not already after all other children
        if (lastChildIndex === -1 || currentIndex > lastChildIndex) return;

        // Remove and re-insert after lastChildIndex
        this.elements.splice(currentIndex, 1);
        // After removal, index shifts down if removal was before lastChildIndex
        const insertAt = lastChildIndex - (currentIndex < lastChildIndex ? 1 : 0) + 1;
        this.elements.splice(insertAt, 0, element);
    }

    // Render loading overlay on a generating frame (called after children are drawn)
    renderFrameLoadingOverlay(el) {
        const t = ((performance.now() - (el._genStartTime || 0)) / 1000);
        const hasImage = this.elements.some(
            child => child.parentFrame === el && child.type === 'image'
        );
        const s = this.viewport.scale;
        const ctx = this.ctx;

        ctx.save();
        ctx.beginPath();
        ctx.rect(el.x, el.y, el.width, el.height);
        ctx.clip();

        // ── Background: white + subtle brand-cyan radial gradient ───────────────
        // A soft radial glow emanates from the centre, breathing in sync with the bars.
        // Global breathe cycle: ~4 s (natural resting breath pace)
        const BREATHE_HZ = 0.25;  // 0.25 cycles/s → 4 s period, slow & calm
        const breathe    = (Math.sin(t * BREATHE_HZ * Math.PI * 2 - Math.PI / 2) + 1) / 2; // 0…1, starts at 0

        const cx = el.x + el.width  / 2;
        const cy = el.y + el.height / 2;

        // Solid base
        ctx.fillStyle = hasImage ? 'rgba(255,255,255,0.78)' : 'rgba(244,253,254,0.84)';
        ctx.fillRect(el.x, el.y, el.width, el.height);

        // Radial brand-cyan glow, radius breathes gently
        const glowR     = Math.max(el.width, el.height) * (0.55 + 0.15 * breathe);
        const glowAlpha = 0.06 + 0.07 * breathe;   // 0.06 … 0.13 — very subtle
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        grd.addColorStop(0,   `rgba(0, 204, 220, ${(glowAlpha * 1.6).toFixed(3)})`);
        grd.addColorStop(0.5, `rgba(0, 204, 220, ${glowAlpha.toFixed(3)})`);
        grd.addColorStop(1,   'rgba(0, 204, 220, 0)');
        ctx.fillStyle = grd;
        ctx.fillRect(el.x, el.y, el.width, el.height);

        // ── Three vertical bars, EQ / breath style ───────────────────────────────
        const BAR_COUNT  = 3;
        // Slightly thinner bars: cap at 4 instead of 6
        const BAR_W      = Math.max(1.5, Math.min(4,  el.width  * 0.018)) / s;
        const BAR_GAP    = Math.max(3,   Math.min(10, el.width  * 0.04))  / s;
        const BAR_MAX_H  = Math.max(8,   Math.min(32, el.height * 0.11))  / s;
        const BAR_MIN_H  = BAR_MAX_H * 0.22;
        // Same slow pace as the glow — each bar offset 120° so they stagger
        const PHASE_STEP = (Math.PI * 2) / BAR_COUNT;

        ctx.lineCap = 'round';

        for (let i = 0; i < BAR_COUNT; i++) {
            const raw  = Math.sin(t * BREATHE_HZ * Math.PI * 2 + i * PHASE_STEP - Math.PI / 2);
            const norm = (raw + 1) / 2;  // 0 … 1
            const h    = BAR_MIN_H + (BAR_MAX_H - BAR_MIN_H) * norm;
            const bx   = cx + (i - (BAR_COUNT - 1) / 2) * (BAR_W + BAR_GAP);
            const alpha = 0.38 + 0.55 * norm;  // 0.38 … 0.93

            ctx.beginPath();
            ctx.moveTo(bx, cy - h / 2);
            ctx.lineTo(bx, cy + h / 2);
            ctx.strokeStyle = `rgba(0, 204, 220, ${alpha.toFixed(3)})`;
            ctx.lineWidth   = BAR_W;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Dimension label for frame header.
     * When frame has an image: shows actual pixel resolution (e.g. 2048 × 2048).
     * When frame is empty or has no image: shows frame size in canvas units.
     */
    _getDimLabel(width, height) {
        return `${Math.round(width)} × ${Math.round(height)}`;
    }

    _isStandardRatio(width, height) {
        const STANDARD_RATIOS = [
            1, 3 / 2, 2 / 3, 3 / 4, 4 / 3, 4 / 5, 5 / 4, 9 / 16, 16 / 9,
        ];
        const ratio = width / height;
        return STANDARD_RATIOS.some(r => Math.abs(ratio - r) < 0.02);
    }

    _getClosestRatioLabel(width, height) {
        const STANDARD_RATIOS = [
            { label: '1:1', value: 1 },
            { label: '3:2', value: 3 / 2 },
            { label: '2:3', value: 2 / 3 },
            { label: '3:4', value: 3 / 4 },
            { label: '4:3', value: 4 / 3 },
            { label: '4:5', value: 4 / 5 },
            { label: '5:4', value: 5 / 4 },
            { label: '9:16', value: 9 / 16 },
            { label: '16:9', value: 16 / 9 },
        ];
        const ratio = width / height;
        let closest = STANDARD_RATIOS[0];
        let minDiff = Math.abs(ratio - closest.value);
        for (const r of STANDARD_RATIOS) {
            const diff = Math.abs(ratio - r.value);
            if (diff < minDiff) {
                minDiff = diff;
                closest = r;
            }
        }
        // Only show if within 5% of a standard ratio
        if (minDiff < 0.05) return closest.label;
        return '';
    }

    // Check if a world position is on a frame's header/name area
    isOnFrameHeader(frame, worldX, worldY) {
        const headerHeight = 20 / this.viewport.scale;
        return worldX >= frame.x &&
            worldX <= frame.x + frame.width &&
            worldY >= frame.y - headerHeight &&
            worldY < frame.y;
    }

    // Calculate bounding box for path
    getPathBounds(path) {
        if (!path.points || path.points.length === 0) {
            return { x: 0, y: 0, width: 0, height: 0 };
        }

        let minX = path.points[0].x;
        let minY = path.points[0].y;
        let maxX = path.points[0].x;
        let maxY = path.points[0].y;

        path.points.forEach(p => {
            minX = Math.min(minX, p.x);
            minY = Math.min(minY, p.y);
            maxX = Math.max(maxX, p.x);
            maxY = Math.max(maxY, p.y);
        });

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    // Check if world point is within stroke distance of a pencil path
    isPointOnPath(path, worldX, worldY) {
        if (!path.points || path.points.length === 0) return false;
        const threshold = Math.max((path.strokeWidth || 2) / 2 + 3, 5) / this.viewport.scale;
        if (path.points.length === 1) {
            const p = path.points[0];
            return Math.hypot(worldX - p.x, worldY - p.y) <= threshold;
        }
        for (let i = 0; i < path.points.length - 1; i++) {
            const p1 = path.points[i];
            const p2 = path.points[i + 1];
            if (this.pointToLineDistance(worldX, worldY, p1.x, p1.y, p2.x, p2.y) <= threshold) {
                return true;
            }
        }
        return false;
    }

    // Returns a pencil-shaped CSS cursor data URI.
    // SVG must be fully percent-encoded so the url() value is unambiguous in all browsers.
    _getPencilCursor() {
        // Single-quote attrs + encodeURIComponent avoids quote-nesting and angle-bracket issues.
        const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path d='M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z' fill='%23073247'/></svg>`;
        return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 0 24, crosshair`;
    }
}
