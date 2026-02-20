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

    zoom(delta, centerX, centerY, rawDelta) {
        // Proportional trackpad pinch: more rawDelta = more zoom, capped to ±25% per event
        let zoomFactor;
        if (rawDelta !== undefined) {
            // Scale: each deltaY unit ≈ 1.2% zoom; cap single event at ±25%
            const pct = Math.max(-0.25, Math.min(0.25, -rawDelta * 0.012));
            zoomFactor = 1 + pct;
        } else {
            // Keyboard shortcuts — fixed step
            zoomFactor = delta > 0 ? 1.10 : 0.91;
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
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                maxX = Math.max(maxX, el.x + el.width);
                maxY = Math.max(maxY, el.y + el.height);
            });

            // Padding: keep 20px from sidebars/toolbars
            // Left sidebar ~68px + 20px, right 40px, top 60px + 20px, bottom toolbar ~68px + 20px
            const padLeft = 88;
            const padRight = 40;
            const padTop = 80;
            const padBottom = 88;
            const availW = this.cssWidth - padLeft - padRight;
            const availH = this.cssHeight - padTop - padBottom;
            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;
            const scaleX = availW / contentWidth;
            const scaleY = availH / contentHeight;

            this.viewport.scale = Math.min(scaleX, scaleY, this.viewport.maxScale);
            // Center content within the available area
            const centerX = padLeft + availW / 2;
            const centerY = padTop + availH / 2;
            this.viewport.x = centerX - (minX + contentWidth / 2) * this.viewport.scale;
            this.viewport.y = centerY - (minY + contentHeight / 2) * this.viewport.scale;
        }

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

    // Save current state BEFORE making changes
    saveState() {
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
        this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        // passive: false is required so that preventDefault() actually works for wheel events
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));
        document.addEventListener('paste', (e) => this.handlePaste(e));

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
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(blob);
                return; // Only handle first image
            }
        }
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
                    this.canvas.style.cursor = 'grabbing';
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

        // Update cursor for resize/rotation handles
        if (this.currentTool === 'move' && this.selectedElements.length > 0 && !this.isDragging && !this.isResizing && !this.isRotating) {
            const handle = this.getResizeHandle(worldPos.x, worldPos.y);
            this.canvas.style.cursor = this.getHandleCursor(handle);

            // Track which rotation corner the mouse is hovering (problem 3)
            const newRotCorner = (handle && handle.startsWith('rot-')) ? handle.slice(4) : null;
            if (newRotCorner !== this.hoveredRotCorner) {
                this.hoveredRotCorner = newRotCorner;
                this.scheduleRender(); // Redraw to show/hide rotation indicator
            }
        }
        // Keep grabbing cursor while rotating
        if (this.isRotating) {
            this.canvas.style.cursor = 'grabbing';
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

            // Detect frame hover for non-frame elements being dragged
            this.highlightedFrame = null;
            const isDraggingNonFrame = this.selectedElements.some(el => el.type !== 'frame');
            if (isDraggingNonFrame) {
                // Check overlap with frames for the first non-frame selected element
                const draggedEl = this.selectedElements.find(el => el.type !== 'frame');
                if (draggedEl) {
                    let bestFrame = null;
                    let bestOverlap = 0;
                    this.elements.forEach(fr => {
                        if (fr.type !== 'frame') return;
                        if (this.selectedElements.includes(fr)) return;
                        const overlap = this.getOverlapPercent(draggedEl, fr);
                        if (overlap > bestOverlap) {
                            bestOverlap = overlap;
                            bestFrame = fr;
                        }
                    });
                    if (bestOverlap > 0.5 && bestFrame) {
                        this.highlightedFrame = bestFrame;
                    }
                }
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

                // Auto-attach to frame if created inside one
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

        // Finalize frame attachment after drag
        if (this.isDragging) {
            this.selectedElements.forEach(el => {
                if (el.type !== 'frame') {
                    this.updateFrameAttachment(el);
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
            this.canvas.style.cursor = 'text'; // Restore text cursor
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
            // Zoom with Ctrl/Meta + Wheel (or pinch gesture)
            // Pass rawDelta for smooth trackpad support
            this.zoom(-e.deltaY, x, y, e.deltaY);
        } else {
            // Pan with Wheel (or two-finger drag)
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
        // Intercept browser zoom shortcuts (Ctrl/Cmd + =/-/0) — prevent browser zoom,
        // redirect to canvas zoom instead
        if ((e.ctrlKey || e.metaKey) && !this.editingText && !this.isInputActive()) {
            if (e.key === '=' || e.key === '+') {
                e.preventDefault();
                const cx = this.cssWidth / 2;
                const cy = this.cssHeight / 2;
                this.zoom(1, cx, cy);
                return;
            }
            if (e.key === '-') {
                e.preventDefault();
                const cx = this.cssWidth / 2;
                const cy = this.cssHeight / 2;
                this.zoom(-1, cx, cy);
                return;
            }
            if (e.key === '0') {
                e.preventDefault();
                this.fitToScreen();
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
                // Restore cursor based on tool
                if (this.currentTool === 'text') {
                    this.canvas.style.cursor = 'text';
                } else {
                    this.canvas.style.cursor = 'default';
                }
                // Restore UI to show current tool
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
        this.selectedElements = [frame];

        // Scroll viewport so the new frame is centered on screen
        this.scrollToCenter(pos.x, pos.y, frameSize, frameSize);
        this.render();
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
                    // Line: No fill, Darker Gray Stroke
                    // Others: Darker Gray Fill, No Stroke
                    // Using #808080 (Gray)
                    fill: isLine ? 'none' : '#808080',
                    stroke: isLine ? '#808080' : 'none',
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
                    stroke: '#FF0000',
                    strokeWidth: 4,
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
        // Corner handles: larger hit area (10 screen px)
        const cornerHit = 10 / this.viewport.scale;
        // Edge handles: respond along the FULL edge length (8 screen px wide zone)
        const edgeHit = 8 / this.viewport.scale;
        // Rotation zone: outer ring beyond corner handles (10–28 screen px outside corner)
        const rotOuter = 28 / this.viewport.scale;
        const rotInner = cornerHit; // start where corner handle ends

        if (element.type === 'shape' && element.shapeType === 'line') {
            if (Math.abs(worldX - element.x) < cornerHit && Math.abs(worldY - element.y) < cornerHit) return 'nw';
            if (Math.abs(worldX - element.x2) < cornerHit && Math.abs(worldY - element.y2) < cornerHit) return 'se';
            return null;
        }

        // Use axis-aligned bounding box for handle detection
        // If element is rotated, we still check against the AABB corner positions
        const { x, y, width, height } = element;

        // Helper: check if point is in the rotation annular zone at a corner
        const inRotZone = (cx, cy) => {
            const dx = worldX - cx;
            const dy = worldY - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            return dist >= rotInner && dist <= rotOuter;
        };

        // Corners first — highest priority (resize)
        if (Math.abs(worldX - x) < cornerHit && Math.abs(worldY - y) < cornerHit) return 'nw';
        if (Math.abs(worldX - (x + width)) < cornerHit && Math.abs(worldY - y) < cornerHit) return 'ne';
        if (Math.abs(worldX - (x + width)) < cornerHit && Math.abs(worldY - (y + height)) < cornerHit) return 'se';
        if (Math.abs(worldX - x) < cornerHit && Math.abs(worldY - (y + height)) < cornerHit) return 'sw';

        // Rotation zones — just outside each corner
        if (inRotZone(x, y)) return 'rot-nw';
        if (inRotZone(x + width, y)) return 'rot-ne';
        if (inRotZone(x + width, y + height)) return 'rot-se';
        if (inRotZone(x, y + height)) return 'rot-sw';

        // Edges: trigger anywhere along the full edge (excluding the corner zones)
        const inXRange = worldX >= x + cornerHit && worldX <= x + width - cornerHit;
        const inYRange = worldY >= y + cornerHit && worldY <= y + height - cornerHit;

        if (inXRange && Math.abs(worldY - y) < edgeHit) return 'n';            // top edge
        if (inXRange && Math.abs(worldY - (y + height)) < edgeHit) return 's'; // bottom edge
        if (inYRange && Math.abs(worldX - x) < edgeHit) return 'w';            // left edge
        if (inYRange && Math.abs(worldX - (x + width)) < edgeHit) return 'e'; // right edge

        return null;
    }

    getHandleCursor(handle) {
        if (!handle) return 'default';
        if (handle.startsWith('rot-')) return 'grab';
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

        this.editingText = element;

        // Create input overlay positioned to match the canvas element exactly
        const input = document.createElement('textarea');
        input.value = element.text;
        input.style.position = 'fixed';

        // Must include the canvas's own offset on the page
        const canvasRect = this.canvas.getBoundingClientRect();
        const screenPos = this.worldToScreen(element.x, element.y);
        const scaledFontSize = element.fontSize * this.viewport.scale;
        const scaledWidth = Math.max(element.width * this.viewport.scale, scaledFontSize * 3);
        const scaledHeight = Math.max(element.height * this.viewport.scale, scaledFontSize * 1.5);

        input.style.left = (canvasRect.left + screenPos.x) + 'px';
        input.style.top = (canvasRect.top + screenPos.y) + 'px';
        input.style.width = scaledWidth + 'px';
        input.style.height = scaledHeight + 'px';
        input.style.fontSize = scaledFontSize + 'px';
        input.style.fontFamily = element.fontFamily;
        input.style.color = element.color;
        input.style.background = 'rgba(255,255,255,0.92)';
        input.style.border = '1.5px solid #0099B8';
        input.style.borderRadius = '3px';
        input.style.outline = 'none';
        input.style.resize = 'none';
        input.style.padding = '4px';
        input.style.lineHeight = '1.2';
        input.style.boxSizing = 'border-box';
        input.style.zIndex = '10000';
        input.style.overflow = 'hidden';

        this.textInput = input;
        document.body.appendChild(input);
        input.focus();
        // Select all text immediately so user can type to replace or edit
        setTimeout(() => {
            input.select();
        }, 0);

        const finishEditing = () => {
            const newText = input.value.trim();
            if (!newText) {
                // Remove empty text element
                const index = this.elements.indexOf(element);
                if (index > -1) {
                    this.elements.splice(index, 1);
                }
            } else {
                element.text = input.value;
                this.fitTextElement(element);
            }

            if (document.body.contains(input)) {
                document.body.removeChild(input);
            }
            this.textInput = null;
            this.editingText = null;
            this.render();
        };

        input.addEventListener('blur', finishEditing);
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Confirm on Enter (without Shift)
                e.preventDefault();
                finishEditing();
            } else if (e.key === 'Escape') {
                finishEditing();
            }
        });
    }

    stopTextEditing() {
        if (this.textInput && this.editingText) {
            const newText = this.textInput.value.trim();
            if (!newText) {
                // Remove empty text element
                const index = this.elements.indexOf(this.editingText);
                if (index > -1) {
                    this.elements.splice(index, 1);
                }
            } else {
                this.editingText.text = this.textInput.value;
                this.fitTextElement(this.editingText);
            }

            document.body.removeChild(this.textInput);
            this.textInput = null;
            this.editingText = null;
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
                const bounds = this.getPathBounds(el);
                const padding = 5 / this.viewport.scale;
                if (worldX >= bounds.x - padding && worldX <= bounds.x + bounds.width + padding &&
                    worldY >= bounds.y - padding && worldY <= bounds.y + bounds.height + padding) {
                    return el;
                }
            } else {
                if (worldX >= el.x && worldX <= el.x + el.width &&
                    worldY >= el.y && worldY <= el.y + el.height) {
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
        this.elements.forEach(el => {
            if (el === this.tempElement) return;
            if (el.type === 'frame') return;
            if (el.parentFrame) return; // Skip children, rendered with their frame
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

                    // 2. Dimensions (Right) — actual image resolution in px if frame has image, else frame size
                    const childImage = this.elements.find(e => e.type === 'image' && e.parentFrame === el);
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
                this.ctx.beginPath();
                el.points.forEach((p, i) => {
                    if (i === 0) this.ctx.moveTo(p.x, p.y);
                    else this.ctx.lineTo(p.x, p.y);
                });
                this.ctx.strokeStyle = el.stroke;
                this.ctx.lineWidth = el.strokeWidth;
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.stroke();
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

    drawRotationHandles(el, onlyCorner = null) {
        // Draw a small curved arrow arc outside each corner to indicate rotation is available.
        // onlyCorner: if provided ('nw'|'ne'|'se'|'sw'), only draw that corner.
        // If null, nothing is drawn (rotation hints shown on demand only).
        if (onlyCorner === null) return;  // No hover — don't show anything

        const arcRadius = 10 / this.viewport.scale;
        const arcGap = 5 / this.viewport.scale;   // gap between corner handle and arc start
        const arcSweep = Math.PI / 2.5;            // ~72° arc sweep
        const arrowSize = 4 / this.viewport.scale;

        this.ctx.save();
        this.ctx.strokeStyle = 'rgba(0, 153, 184, 0.85)';
        this.ctx.lineWidth = 2 / this.viewport.scale;
        this.ctx.lineCap = 'round';
        this.ctx.setLineDash([]);

        const allCorners = [
            {
                id: 'nw', x: el.x, y: el.y,              // NW corner
                startAngle: Math.PI, endAngle: Math.PI + arcSweep, arrowDir: 1
            },
            {
                id: 'ne', x: el.x + el.width, y: el.y,              // NE corner
                startAngle: -Math.PI / 2 - arcSweep / 2, endAngle: -Math.PI / 2 + arcSweep / 2, arrowDir: 1
            },
            {
                id: 'se', x: el.x + el.width, y: el.y + el.height,  // SE corner
                startAngle: 0, endAngle: arcSweep, arrowDir: 1
            },
            {
                id: 'sw', x: el.x, y: el.y + el.height,  // SW corner
                startAngle: Math.PI / 2 - arcSweep / 2, endAngle: Math.PI / 2 + arcSweep / 2, arrowDir: 1
            }
        ];

        const offsets = [
            { dx: -1, dy: -1 },  // NW
            { dx: 1, dy: -1 },  // NE
            { dx: 1, dy: 1 },  // SE
            { dx: -1, dy: 1 },  // SW
        ];

        allCorners.forEach((corner, idx) => {
            if (corner.id !== onlyCorner) return; // Only draw hovered corner

            const diag = arcRadius + arcGap;
            const off = offsets[idx];
            const cx = corner.x + off.dx * diag;
            const cy = corner.y + off.dy * diag;

            this.ctx.beginPath();
            this.ctx.arc(cx, cy, arcRadius, corner.startAngle, corner.endAngle, false);
            this.ctx.stroke();

            // Draw arrowhead at end of arc
            const endX = cx + arcRadius * Math.cos(corner.endAngle);
            const endY = cy + arcRadius * Math.sin(corner.endAngle);
            const tangentAngle = corner.endAngle + Math.PI / 2;
            this.ctx.beginPath();
            this.ctx.moveTo(
                endX + arrowSize * Math.cos(tangentAngle - 0.5),
                endY + arrowSize * Math.sin(tangentAngle - 0.5)
            );
            this.ctx.lineTo(endX, endY);
            this.ctx.lineTo(
                endX + arrowSize * Math.cos(tangentAngle + 0.5),
                endY + arrowSize * Math.sin(tangentAngle + 0.5)
            );
            this.ctx.stroke();
        });

        this.ctx.restore();
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
        const elLeft = element.x;
        const elRight = element.x + element.width;
        const elTop = element.y;
        const elBottom = element.y + element.height;

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

    // Check and update frame attachment for an element based on 50% overlap rule
    updateFrameAttachment(element) {
        if (element.type === 'frame') return; // Frames don't attach to other frames

        let bestFrame = null;
        let bestOverlap = 0;

        // Find the frame with the most overlap
        this.elements.forEach(el => {
            if (el.type !== 'frame') return;
            if (el === element) return;
            const overlap = this.getOverlapPercent(element, el);
            if (overlap > bestOverlap) {
                bestOverlap = overlap;
                bestFrame = el;
            }
        });

        if (bestOverlap > 0.5 && bestFrame) {
            this.attachToFrame(element, bestFrame);
            // Ensure new element renders on TOP: move it to after all existing children of this frame
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

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.rect(el.x, el.y, el.width, el.height);
        this.ctx.clip();

        if (hasImage) {
            // Replace mode: semi-transparent white overlay on existing image
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
        } else {
            // Empty frame: light tinted overlay
            this.ctx.fillStyle = 'rgba(7, 50, 71, 0.06)';
        }
        this.ctx.fillRect(el.x, el.y, el.width, el.height);

        // Subtle shimmer: a sweeping gradient band
        const shimmerW = el.width * 0.6;
        const cycle = 2.0; // seconds per sweep
        const progress = (t % cycle) / cycle;
        const shimmerX = el.x - shimmerW + (el.width + shimmerW * 2) * progress;

        const grad = this.ctx.createLinearGradient(shimmerX, el.y, shimmerX + shimmerW, el.y);
        grad.addColorStop(0, 'rgba(255, 255, 255, 0)');
        grad.addColorStop(0.3, 'rgba(0, 200, 210, 0.08)');
        grad.addColorStop(0.5, 'rgba(0, 200, 210, 0.12)');
        grad.addColorStop(0.7, 'rgba(0, 200, 210, 0.08)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        this.ctx.fillStyle = grad;
        this.ctx.fillRect(el.x, el.y, el.width, el.height);

        // Subtle pulsing dots in center
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        const dotCount = 3;
        const dotSpacing = 16 / this.viewport.scale;
        const dotRadius = 3 / this.viewport.scale;
        for (let i = 0; i < dotCount; i++) {
            const dx = cx + (i - 1) * dotSpacing;
            const phase = t * 3 + i * 0.6;
            const alpha = 0.15 + 0.2 * Math.sin(phase);
            this.ctx.beginPath();
            this.ctx.arc(dx, cy, dotRadius, 0, Math.PI * 2);
            this.ctx.fillStyle = `rgba(0, 200, 210, ${alpha})`;
            this.ctx.fill();
        }

        this.ctx.restore();
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
}
