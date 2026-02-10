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

        // Center viewport
        this.viewport.x = this.canvas.width / 2;
        this.viewport.y = this.canvas.height / 2;

        this.render();
        this.updateZoomDisplay();
    }

    resizeCanvas() {
        this.canvas.width = window.innerWidth;
        this.canvas.height = window.innerHeight;
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

    zoom(delta, centerX, centerY) {
        const zoomFactor = delta > 0 ? 1.1 : 0.9;
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
        const centerX = this.canvas.width / 2;
        const centerY = this.canvas.height / 2;
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
            this.viewport.x = this.canvas.width / 2;
            this.viewport.y = this.canvas.height / 2;
            this.viewport.scale = 0.2;
        } else {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            this.elements.forEach(el => {
                minX = Math.min(minX, el.x);
                minY = Math.min(minY, el.y);
                maxX = Math.max(maxX, el.x + el.width);
                maxY = Math.max(maxY, el.y + el.height);
            });

            const padding = 50;
            const contentWidth = maxX - minX;
            const contentHeight = maxY - minY;
            const scaleX = (this.canvas.width - padding * 2) / contentWidth;
            const scaleY = (this.canvas.height - padding * 2) / contentHeight;

            this.viewport.scale = Math.min(scaleX, scaleY, this.viewport.maxScale);
            this.viewport.x = (this.canvas.width - contentWidth * this.viewport.scale) / 2 - minX * this.viewport.scale;
            this.viewport.y = (this.canvas.height - contentHeight * this.viewport.scale) / 2 - minY * this.viewport.scale;
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
        this.canvas.addEventListener('wheel', (e) => this.handleWheel(e));
        this.canvas.addEventListener('dblclick', (e) => this.handleDoubleClick(e));

        document.addEventListener('keydown', (e) => this.handleKeyDown(e));
        document.addEventListener('keyup', (e) => this.handleKeyUp(e));

        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
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

                // Don't save state here - will save after resize completes
                return;
            }

            // Check for element selection
            const clickedElement = this.findElementAt(worldPos.x, worldPos.y);

            if (clickedElement) {
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

        // Update cursor for resize handles
        if (this.currentTool === 'move' && this.selectedElements.length > 0 && !this.isDragging && !this.isResizing) {
            const handle = this.getResizeHandle(worldPos.x, worldPos.y);
            this.canvas.style.cursor = this.getHandleCursor(handle);
        }

        if (this.isPanning && this.lastMousePos) {
            const dx = x - this.lastMousePos.x;
            const dy = y - this.lastMousePos.y;
            this.pan(dx, dy);
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
        if (this.currentTool === 'move' && !this.isDragging && !this.isResizing && !this.isSelecting && !e.shiftKey) {
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

        // Save state only if an operation was completed (drag or resize, NOT selection)
        const shouldSaveState = this.isDragging || this.isResizing;

        this.isDragging = false;
        this.isResizing = false;
        this.isPanning = false; // Reset panning state
        this.isSelecting = false;
        this.resizeHandle = null;
        this.resizeStartState = null;
        this.dragStart = null;
        this.dragStartWorld = null;
        this.dragStartPositions = null;
        this.snapGuides = { vertical: [], horizontal: [] }; // Clear snap guides
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
            // Simple bounding box intersection
            if (el.x >= x && el.x + el.width <= x + width &&
                el.y >= y && el.y + el.height <= y + height) {
                this.selectedElements.push(el);
            }
            // Enhance: Partial intersection? Figma usually requires full enclosure for marquee?
            // Actually Figma default is "Touching" (Partial) for marquee.
            // Let's implement Partial intersection for better UX.
            else if (el.x < x + width && el.x + el.width > x &&
                el.y < y + height && el.y + el.height > y) {
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
            this.zoom(-e.deltaY, x, y);
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

        const clickedElement = this.findElementAt(worldPos.x, worldPos.y);
        if (clickedElement && clickedElement.type === 'text') {
            this.startTextEditing(clickedElement);
        }
    }

    handleKeyDown(e) {
        // Space key for temporary Hand tool
        if (e.code === 'Space' && !this.editingText && !e.repeat) {
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
                'r': 'shape',       // R - Rectangle/Shape tool
                'p': 'pencil',      // P - Pencil tool
                'f': 'frame',       // F - Frame tool (renamed from Page)
                'i': 'image'        // I - Image tool
            };

            if (shortcuts[key]) {
                e.preventDefault();
                this.setTool(shortcuts[key]);

                // For shape tool, default to rectangle
                if (key === 'r') {
                    this.setShapeType('rectangle');
                }
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

    // Find empty space on canvas to place new element without overlapping
    findEmptySpace(width, height, preferredX = null, preferredY = null) {
        // Start from preferred position (viewport center) or specified position
        const startPos = preferredX !== null && preferredY !== null
            ? { x: preferredX, y: preferredY }
            : this.getViewportCenter();

        const offset = 50; // Offset distance when collision detected
        let x = startPos.x - width / 2;
        let y = startPos.y - height / 2;

        // Check if position overlaps with existing elements
        const checkOverlap = (testX, testY) => {
            return this.elements.some(el => {
                // Simple bounding box collision detection
                return !(testX + width < el.x ||
                    testX > el.x + el.width ||
                    testY + height < el.y ||
                    testY > el.y + el.height);
            });
        };

        // If no overlap at preferred position, use it
        if (!checkOverlap(x, y)) {
            return { x, y };
        }

        // Try spiral pattern to find empty space
        const maxAttempts = 20;
        let attempt = 0;
        let spiralOffset = offset;

        while (attempt < maxAttempts) {
            // Try positions in a spiral pattern around the center
            const positions = [
                { x: x + spiralOffset, y: y },              // Right
                { x: x, y: y + spiralOffset },              // Down
                { x: x - spiralOffset, y: y },              // Left
                { x: x, y: y - spiralOffset },              // Up
                { x: x + spiralOffset, y: y + spiralOffset }, // Bottom-right
                { x: x - spiralOffset, y: y + spiralOffset }, // Bottom-left
                { x: x - spiralOffset, y: y - spiralOffset }, // Top-left
                { x: x + spiralOffset, y: y - spiralOffset }  // Top-right
            ];

            for (const pos of positions) {
                if (!checkOverlap(pos.x, pos.y)) {
                    return pos;
                }
            }

            spiralOffset += offset;
            attempt++;
        }

        // If all attempts fail, return position with offset (will overlap but at least shifted)
        return { x: x + offset * attempt, y: y + offset * attempt };
    }

    addFrame(worldX, worldY) {
        // Create 1:1 ratio frame (square) with default size 1080x1080
        const frameSize = 1080;

        // Find empty space instead of stacking at center
        const pos = this.findEmptySpace(frameSize, frameSize, worldX, worldY);

        // Count existing frames for naming
        const frameCount = this.elements.filter(el => el.type === 'frame').length + 1;

        const frame = {
            type: 'frame',
            name: `Page ${frameCount}`,
            x: pos.x,
            y: pos.y,
            width: frameSize,
            height: frameSize,
            fill: '#FFFFFF',
            stroke: '#E0E0E0',
            strokeWidth: 1
        };

        // Save state BEFORE adding frame
        this.saveState();
        this.elements.push(frame);

        // Auto-select the new frame (Figma-like behavior)
        this.selectedElements = [frame];
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
                    fontSize: 24, // Default larger font size
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
            // Standard bounding box resize with snap
            const originalWidth = element.width;
            const originalHeight = element.height;
            const originalX = element.x;
            const originalY = element.y;
            const aspectRatio = element.width / element.height;

            // Calculate new dimensions first (without snap)
            let newX = originalX;
            let newY = originalY;
            let newWidth = originalWidth;
            let newHeight = originalHeight;

            switch (handle) {
                case 'nw':
                    newWidth = originalX + originalWidth - worldX;
                    newHeight = originalY + originalHeight - worldY;
                    newX = worldX;
                    newY = worldY;
                    break;
                case 'ne':
                    newWidth = worldX - originalX;
                    newHeight = originalY + originalHeight - worldY;
                    newY = worldY;
                    break;
                case 'sw':
                    newWidth = originalX + originalWidth - worldX;
                    newHeight = worldY - originalY;
                    newX = worldX;
                    break;
                case 'se':
                    newWidth = worldX - originalX;
                    newHeight = worldY - originalY;
                    break;
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

            // Maintain aspect ratio with Shift
            if (shiftKey && handle.length === 2) { // Corner handles only
                newHeight = newWidth / aspectRatio;
                if (handle.includes('n')) {
                    newY = originalY + originalHeight - newHeight;
                }
                if (handle.includes('w')) {
                    newX = originalX + originalWidth - newWidth;
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
                // Scale font size proportionally to height change relative to START of resize
                // This ensures smooth scaling without compounding errors
                const heightRatio = element.height / this.resizeStartState.height;
                element.fontSize = Math.max(8, Math.round(this.resizeStartState.fontSize * heightRatio));

                // Refit dimensions to text content (Point Text behavior)
                this.fitTextElement(element);
            }
        }

        this.render();
    }

    getResizeHandle(worldX, worldY) {
        if (this.selectedElements.length !== 1) return null;

        const element = this.selectedElements[0];
        const handleRadius = 3 / this.viewport.scale; // Match the circle radius
        const hitArea = 6 / this.viewport.scale; // Slightly larger hit area for easier clicking

        if (element.type === 'shape' && element.shapeType === 'line') {
            // Line/arrow has endpoints only
            if (Math.abs(worldX - element.x) < hitArea && Math.abs(worldY - element.y) < hitArea) {
                return 'nw';
            }
            if (Math.abs(worldX - element.x2) < hitArea && Math.abs(worldY - element.y2) < hitArea) {
                return 'se';
            }
        } else {
            // Check all 8 handles (4 corners + 4 edges) but only 4 corners are visible
            const handles = [
                // Corner handles (visible)
                { name: 'nw', x: element.x, y: element.y },
                { name: 'ne', x: element.x + element.width, y: element.y },
                { name: 'se', x: element.x + element.width, y: element.y + element.height },
                { name: 'sw', x: element.x, y: element.y + element.height },
                // Edge handles (invisible but functional)
                { name: 'n', x: element.x + element.width / 2, y: element.y },
                { name: 'e', x: element.x + element.width, y: element.y + element.height / 2 },
                { name: 's', x: element.x + element.width / 2, y: element.y + element.height },
                { name: 'w', x: element.x, y: element.y + element.height / 2 }
            ];

            for (const handle of handles) {
                if (Math.abs(worldX - handle.x) < hitArea && Math.abs(worldY - handle.y) < hitArea) {
                    return handle.name;
                }
            }
        }

        return null;
    }

    getHandleCursor(handle) {
        if (!handle) return 'default';
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

            const imagesPerRow = 5;
            const spacing = 40;
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
        // Calculate total grid dimensions to find empty space
        const gridWidth = imageElements.slice(0, imagesPerRow).reduce((sum, img, idx) =>
            sum + img.width + (idx > 0 ? spacing : 0), 0);
        const totalRows = Math.ceil(imageElements.length / imagesPerRow);
        const avgHeight = imageElements.reduce((sum, img) => sum + img.height, 0) / imageElements.length;
        const gridHeight = totalRows * avgHeight + (totalRows - 1) * spacing;

        // Find empty space for the entire grid
        const gridPos = this.findEmptySpace(gridWidth, gridHeight, startX, startY);

        let currentX = gridPos.x;
        let currentY = gridPos.y;
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
                currentX = gridPos.x;
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

        // Create input overlay
        const input = document.createElement('textarea');
        input.value = element.text;
        input.style.position = 'fixed';

        const screenPos = this.worldToScreen(element.x, element.y);
        input.style.left = screenPos.x + 'px';
        input.style.top = screenPos.y + 'px';
        input.style.width = (element.width * this.viewport.scale) + 'px';
        input.style.height = (element.height * this.viewport.scale) + 'px';
        input.style.fontSize = (element.fontSize * this.viewport.scale) + 'px';
        input.style.fontFamily = element.fontFamily;
        input.style.color = element.color;
        input.style.background = 'transparent';
        input.style.border = '1px solid #0099B8';
        input.style.outline = 'none';
        input.style.resize = 'none';
        input.style.padding = '4px';
        input.style.zIndex = '10000';

        this.textInput = input;
        document.body.appendChild(input);
        input.focus();
        input.select();

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

        // Second pass: check non-frame elements (children should be found before their parent frame)
        for (let i = this.elements.length - 1; i >= 0; i--) {
            const el = this.elements[i];
            if (el.type === 'frame') continue; // Skip frames in this pass

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

        // Third pass: check frames (body area) — lowest priority so children are found first
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
        // Clear canvas
        this.ctx.fillStyle = '#EAEFF5';
        this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

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
            this.ctx.strokeStyle = 'rgba(255, 51, 102, 0.5)'; // Lighter pink/red
            this.ctx.lineWidth = 1 / this.viewport.scale; // Always 1 screen pixel
            this.ctx.setLineDash([]); // Solid line

            // Calculate bounds for guide lines based on aligned elements
            const getBounds = () => {
                let minX = Infinity, maxX = -Infinity;
                let minY = Infinity, maxY = -Infinity;

                this.selectedElements.forEach(el => {
                    minX = Math.min(minX, el.x);
                    maxX = Math.max(maxX, el.x + el.width);
                    minY = Math.min(minY, el.y);
                    maxY = Math.max(maxY, el.y + el.height);
                });

                // Extend bounds to include nearby elements that might be aligned
                this.elements.forEach(el => {
                    if (!this.selectedElements.includes(el)) {
                        // Check if this element is near the guide lines
                        const nearVertical = this.snapGuides.vertical.some(x =>
                            Math.abs(el.x - x) < 5 || Math.abs(el.x + el.width - x) < 5 || Math.abs(el.x + el.width / 2 - x) < 5
                        );
                        const nearHorizontal = this.snapGuides.horizontal.some(y =>
                            Math.abs(el.y - y) < 5 || Math.abs(el.y + el.height - y) < 5 || Math.abs(el.y + el.height / 2 - y) < 5
                        );

                        if (nearVertical || nearHorizontal) {
                            minX = Math.min(minX, el.x);
                            maxX = Math.max(maxX, el.x + el.width);
                            minY = Math.min(minY, el.y);
                            maxY = Math.max(maxY, el.y + el.height);
                        }
                    }
                });

                return { minX, maxX, minY, maxY };
            };

            const bounds = getBounds();

            // Draw vertical guide lines
            this.snapGuides.vertical.forEach(x => {
                // Check if this is a center alignment (x is at center of any element)
                let isCenterLine = false;
                let centerY1 = bounds.minY;
                let centerY2 = bounds.maxY;

                // Check selected elements
                this.selectedElements.forEach(el => {
                    const elCenterX = el.x + el.width / 2;
                    if (Math.abs(elCenterX - x) < 1) {
                        isCenterLine = true;
                        centerY1 = Math.min(centerY1, el.y + el.height / 2);
                        centerY2 = Math.max(centerY2, el.y + el.height / 2);
                    }
                });

                // Check other elements
                this.elements.forEach(el => {
                    if (!this.selectedElements.includes(el)) {
                        const elCenterX = el.x + el.width / 2;
                        if (Math.abs(elCenterX - x) < 1) {
                            isCenterLine = true;
                            centerY1 = Math.min(centerY1, el.y + el.height / 2);
                            centerY2 = Math.max(centerY2, el.y + el.height / 2);
                        }
                    }
                });

                this.ctx.beginPath();
                if (isCenterLine) {
                    // For center lines, only draw between the center points
                    this.ctx.moveTo(x, centerY1);
                    this.ctx.lineTo(x, centerY2);
                } else {
                    // For edge lines, draw full height
                    this.ctx.moveTo(x, bounds.minY);
                    this.ctx.lineTo(x, bounds.maxY);
                }
                this.ctx.stroke();
            });

            // Draw horizontal guide lines
            this.snapGuides.horizontal.forEach(y => {
                // Check if this is a center alignment (y is at center of any element)
                let isCenterLine = false;
                let centerX1 = bounds.minX;
                let centerX2 = bounds.maxX;

                // Check selected elements
                this.selectedElements.forEach(el => {
                    const elCenterY = el.y + el.height / 2;
                    if (Math.abs(elCenterY - y) < 1) {
                        isCenterLine = true;
                        centerX1 = Math.min(centerX1, el.x + el.width / 2);
                        centerX2 = Math.max(centerX2, el.x + el.width / 2);
                    }
                });

                // Check other elements
                this.elements.forEach(el => {
                    if (!this.selectedElements.includes(el)) {
                        const elCenterY = el.y + el.height / 2;
                        if (Math.abs(elCenterY - y) < 1) {
                            isCenterLine = true;
                            centerX1 = Math.min(centerX1, el.x + el.width / 2);
                            centerX2 = Math.max(centerX2, el.x + el.width / 2);
                        }
                    }
                });

                this.ctx.beginPath();
                if (isCenterLine) {
                    // For center lines, only draw between the center points
                    this.ctx.moveTo(centerX1, y);
                    this.ctx.lineTo(centerX2, y);
                } else {
                    // For edge lines, draw full width
                    this.ctx.moveTo(bounds.minX, y);
                    this.ctx.lineTo(bounds.maxX, y);
                }
                this.ctx.stroke();
            });

            this.ctx.restore();
        }

        this.ctx.restore();

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
        const endX = Math.ceil((this.canvas.width - this.viewport.x) / this.viewport.scale + padding) / gridSize * gridSize;
        const endY = Math.ceil((this.canvas.height - this.viewport.y) / this.viewport.scale + padding) / gridSize * gridSize;

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
                if (screenPos.x >= -10 && screenPos.x <= this.canvas.width + 10 &&
                    screenPos.y >= -10 && screenPos.y <= this.canvas.height + 10) {
                    this.ctx.fillRect(screenPos.x, screenPos.y, dotSize, dotSize);
                }
            }
        }
    }

    renderElement(el) {
        this.ctx.save();

        switch (el.type) {
            case 'frame':
                this.ctx.fillStyle = el.fill;
                this.ctx.fillRect(el.x, el.y, el.width, el.height);
                this.ctx.strokeStyle = el.stroke;
                this.ctx.lineWidth = el.strokeWidth;
                this.ctx.strokeRect(el.x, el.y, el.width, el.height);

                // Draw Frame Headers (Icon + Name, Dimensions)
                // Draw Frame Headers (Icon + Name, Dimensions)
                const headerY = Math.round(el.y - 12);
                const isSelected = this.selectedElements.indexOf(el) !== -1;
                const nameColor = isSelected ? '#0099B8' : '#333333';

                // Use a smaller, fixed font size in Screen Space scaling
                // Reduced from 14 to 11 per user request ("too big")
                const fontSize = 11 / this.viewport.scale;

                // 1. Icon + Name (Left)
                this.ctx.textAlign = 'left';
                this.ctx.textBaseline = 'bottom';

                // Draw Icon (Simple Layout Icon - Rectangle with sidebar)
                const iconSize = fontSize;
                const iconX = Math.round(el.x);
                const iconY = Math.round(headerY - 2 / this.viewport.scale);

                this.ctx.strokeStyle = nameColor;
                this.ctx.lineWidth = 1.5 / this.viewport.scale;

                // Main box
                this.ctx.strokeRect(iconX, iconY - iconSize + 2 / this.viewport.scale, iconSize - 3 / this.viewport.scale, iconSize - 3 / this.viewport.scale);

                // Sidebar line
                this.ctx.beginPath();
                this.ctx.moveTo(iconX + ((iconSize - 3 / this.viewport.scale) * 0.35), iconY - iconSize + 2 / this.viewport.scale);
                this.ctx.lineTo(iconX + ((iconSize - 3 / this.viewport.scale) * 0.35), iconY - 1 / this.viewport.scale);
                this.ctx.stroke();

                // Name
                this.ctx.fillStyle = nameColor;
                this.ctx.font = `600 ${fontSize}px Inter, sans-serif`;
                this.ctx.fillText(el.name || 'Frame', Math.round(el.x + iconSize + 2 / this.viewport.scale), headerY);

                // 2. Dimensions (Right)
                this.ctx.textAlign = 'right';
                const dimText = `${Math.round(el.width)} × ${Math.round(el.height)}`;

                const rightEdge = el.x + el.width;

                // Dimensions
                this.ctx.fillStyle = '#888888'; // Grey for dimensions
                this.ctx.font = `500 ${fontSize}px Inter, sans-serif`; // Medium weight
                this.ctx.fillText(dimText, rightEdge, headerY);
                break;
                break;

            case 'image':
                if (el.image) {
                    this.ctx.drawImage(el.image, el.x, el.y, el.width, el.height);
                }
                break;

            case 'text':
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
            const handles = [
                { x: el.x, y: el.y },                           // Top-left
                { x: el.x + el.width, y: el.y },                // Top-right
                { x: el.x + el.width, y: el.y + el.height },    // Bottom-right
                { x: el.x, y: el.y + el.height }                // Bottom-left
            ];

            this.ctx.fillStyle = '#FFFFFF';
            this.ctx.strokeStyle = '#0099B8';
            this.ctx.lineWidth = 1 / this.viewport.scale;

            handles.forEach(handle => {
                this.ctx.beginPath();
                this.ctx.arc(handle.x, handle.y, handleRadius, 0, Math.PI * 2);
                this.ctx.fill();
                this.ctx.stroke();
            });
        }

        this.ctx.setLineDash([]);
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
        } else {
            this.detachFromFrame(element);
        }
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
