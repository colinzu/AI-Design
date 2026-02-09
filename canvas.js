/**
 * Canvas Page Initialization and UI Integration
 */

document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('infinite-canvas');
    const engine = new CanvasEngine(canvas);

    // ==================== Project Menu ====================

    const logoMenuBtn = document.getElementById('logo-btn');
    const projectMenu = document.getElementById('project-menu');
    const projectNameInput = document.getElementById('project-name');

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
    });

    // Project menu actions
    projectMenu.addEventListener('click', (e) => {
        const menuItem = e.target.closest('.menu-item');
        if (!menuItem) return;

        const action = menuItem.dataset.action;

        switch (action) {
            case 'new-project':
                window.open('canvas.html', '_blank');
                break;
            case 'recent-projects':
                window.location.href = 'index.html';
                break;
            case 'undo':
                engine.undo();
                break;
            case 'redo':
                engine.redo();
                break;
            case 'move-to-trash':
                if (confirm('Are you sure you want to move this project to trash?')) {
                    alert('Project moved to trash');
                    window.location.href = 'index.html';
                }
                break;
        }

        projectMenu.style.display = 'none';
    });

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

    if (zoomDropdownBtn) {
        zoomDropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            zoomMenu.classList.toggle('hidden');
        });
    }

    // Zoom presets and actions
    if (zoomMenu) {
        zoomMenu.addEventListener('click', (e) => {
            const menuItem = e.target.closest('.menu-item');
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

            zoomMenu.classList.add('hidden');
        });
    }

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

            // Update active state
            toolButtons.forEach(b => b.classList.remove('active'));
            const rectangleBtn = document.querySelector('.tool-btn[data-tool="rectangle"]');
            if (rectangleBtn) {
                rectangleBtn.classList.add('active');
            }

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

        // Tool shortcuts
        if (!engine.editingText) {
            const toolMap = {
                'v': 'move',
                'h': 'hand',
                'f': 'frame', // Frame tool (renamed from Page)
                'i': 'image',
                't': 'text',
                'r': 'rectangle',
                'p': 'pencil'
            };

            if (toolMap[e.key.toLowerCase()]) {
                // If handled by engine, let it be. But here we can redundant check...
                // Actually, if defaultPrevented, we already returned.
                // So this only runs if engine DIDN'T handle it.
                // But wait, engine handles all these.
                // So this block is redundant if we assume engine handles them.
                // But for safety/other tools engine might miss?
                // For now, update map and prevent default.

                e.preventDefault();
                const tool = toolMap[e.key.toLowerCase()];
                engine.setTool(tool);

                // Update UI (redundant as engine updates UI, but safe)
                toolButtons.forEach(b => {
                    b.classList.remove('active');
                    if (b.dataset.tool === tool) {
                        b.classList.add('active');
                    }
                });
            }
        }
    });

    // Make engine globally accessible for debugging
    window.canvasEngine = engine;

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
                // Simple check for standard ratios
                if (Math.abs(currentRatio - 1) < 0.01) ratioSelect.value = '1:1';
                else if (Math.abs(currentRatio - 4 / 3) < 0.01) ratioSelect.value = '4:3';
                else if (Math.abs(currentRatio - 3 / 4) < 0.01) ratioSelect.value = '3:4';
                else if (Math.abs(currentRatio - 16 / 9) < 0.01) ratioSelect.value = '16:9';
                else if (Math.abs(currentRatio - 9 / 16) < 0.01) ratioSelect.value = '9:16';
                else ratioSelect.value = 'custom';

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

            const [w, h] = val.split(':').map(Number);
            const ratio = w / h;

            // Adjust height to match ratio while keeping width
            frame.height = frame.width / ratio;

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



        // Handle Download
        downloadBtn.addEventListener('click', () => {
            const frame = engine.selectedElements[0];
            if (!frame || frame.type !== 'frame') return;

            // 1. Create a temporary canvas
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = frame.width;
            tempCanvas.height = frame.height;
            const tempCtx = tempCanvas.getContext('2d');

            // 2. Fill background
            tempCtx.fillStyle = frame.fill;
            tempCtx.fillRect(0, 0, frame.width, frame.height);

            // 3. Render overlapping elements
            // We need to shift everything by (-frame.x, -frame.y)
            engine.elements.forEach(el => {
                if (el === frame) return;

                // Simple intersection check
                if (el.x < frame.x + frame.width &&
                    el.x + el.width > frame.x &&
                    el.y < frame.y + frame.height &&
                    el.y + el.height > frame.y) {

                    // Save and translate context to draw in local frame coordinates
                    // Since we can't easily reuse renderElement with a custom context/transform without deeper refactoring,
                    // we'll implement a basic subset of rendering here for the export.

                    const localX = el.x - frame.x;
                    const localY = el.y - frame.y;

                    tempCtx.save();

                    if (el.type === 'image' && el.image) {
                        tempCtx.drawImage(el.image, localX, localY, el.width, el.height);
                    } else if (el.type === 'text') {
                        tempCtx.font = `${el.fontSize}px ${el.fontFamily}`;
                        tempCtx.fillStyle = el.color;
                        tempCtx.textAlign = el.align || 'left';
                        tempCtx.textBaseline = 'top';
                        const lines = el.text.split('\n');
                        const lineHeight = el.fontSize * 1.2;
                        lines.forEach((line, i) => {
                            tempCtx.fillText(line, localX + 5, localY + 5 + i * lineHeight);
                        });
                    } else if (el.type === 'shape') {
                        tempCtx.beginPath();
                        if (el.shapeType === 'rectangle') {
                            if (el.cornerRadius) {
                                // Simple round rect
                                tempCtx.roundRect(localX, localY, el.width, el.height, el.cornerRadius);
                            } else {
                                tempCtx.rect(localX, localY, el.width, el.height);
                            }
                        } else if (el.shapeType === 'ellipse') {
                            tempCtx.ellipse(localX + el.width / 2, localY + el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
                        } else if (el.shapeType === 'line') {
                            tempCtx.moveTo(localX, localY);
                            tempCtx.lineTo(el.x2 - frame.x, el.y2 - frame.y);
                        }

                        if (el.fill && el.fill !== 'none') {
                            tempCtx.fillStyle = el.fill;
                            tempCtx.fill();
                        }
                        if (el.stroke && el.strokeWidth > 0) {
                            tempCtx.strokeStyle = el.stroke;
                            tempCtx.lineWidth = el.strokeWidth;
                            tempCtx.stroke();
                        }
                    }

                    tempCtx.restore();
                }
            });

            // 4. Download
            const link = document.createElement('a');
            link.download = `${frame.name || 'frame'}.png`;
            link.href = tempCanvas.toDataURL('image/png');
            link.click();
        });
    }
});
