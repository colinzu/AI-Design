/**
 * Canvas Generation Panel — AI Image Generation Input
 * Manages the generation input panel that appears below selected elements.
 * Three states: collapsed (capsule), expanded (full input), thinking (loading).
 * Calls Nano Banana Pro via Google Gemini generateContent API.
 */

(function () {
    // ==================== State ====================
    const genState = {
        selectedModel: 'nano-banana',
        selectedModelName: 'Nano Banana Pro',
        imageCount: 1,
        uploadedImages: [],     // { index, src, name, fromSelection? }
        isGenerating: false,
        abortController: null,  // AbortController for cancelling generation
        currentFrame: null,     // Reference to target frame for placing generated images
        currentAnchor: null,    // { x, y, width, height } bounding box for positioning
        panelMode: 'hidden',    // 'hidden' | 'collapsed' | 'expanded' | 'thinking'
        selectedElements: [],   // Copy of selected elements for replacement logic
    };

    // Supported aspect ratios by Gemini API
    const SUPPORTED_RATIOS = [
        { label: '1:1',   value: 1 / 1 },
        { label: '3:2',   value: 3 / 2 },
        { label: '2:3',   value: 2 / 3 },
        { label: '3:4',   value: 3 / 4 },
        { label: '4:3',   value: 4 / 3 },
        { label: '4:5',   value: 4 / 5 },
        { label: '5:4',   value: 5 / 4 },
        { label: '9:16',  value: 9 / 16 },
        { label: '16:9',  value: 16 / 9 },
    ];

    /**
     * Find the closest supported aspect ratio for a given width/height.
     */
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
    // Local dev: server.py proxies /api/generate → Gemini API
    // Production: Cloudflare Worker handles /api/generate → Gemini API
    const MODEL_CONFIGS = {
        'nano-banana': {
            model: 'gemini-3-pro-image-preview',
            endpoint: '/api/generate',
        },
        'seedream': null, // 暂未接入
    };

    // ==================== Initialization ====================
    function initGenPanel() {
        const engine = window.canvasEngine;
        if (!engine) {
            console.warn('[canvas-gen] Canvas engine not available');
            return;
        }

        const genPanel = document.getElementById('gen-panel');
        if (!genPanel) return;

        // Chain into existing onSelectionChange (set by canvas.js for action bar)
        const existingSelectionHandler = engine.onSelectionChange;
        engine.onSelectionChange = (selectedElements) => {
            // Call existing handler first (frame-action-bar logic)
            if (existingSelectionHandler) existingSelectionHandler(selectedElements);

            // Don't change panel if currently generating
            if (genState.isGenerating) return;

            if (selectedElements.length === 0) {
                hideGenPanel();
                return;
            }

            genState.selectedElements = [...selectedElements];
            const frame = selectedElements.find(el => el.type === 'frame');

            if (selectedElements.length === 1 && frame) {
                // Selected a Frame
                genState.currentFrame = frame;
                genState.currentAnchor = frame;

                // Check if frame is empty (no elements inside it)
                const hasContent = engine.elements.some(el =>
                    el !== frame && el.type !== 'frame' &&
                    el.x >= frame.x && el.x + (el.width || 0) <= frame.x + frame.width &&
                    el.y >= frame.y && el.y + (el.height || 0) <= frame.y + frame.height
                );

                if (!hasContent) {
                    // Empty frame → expanded (active input, ready to type)
                    showGenPanel('expanded');
                    autoFocusEditor();
                } else {
                    // Frame has content → collapsed
                    showGenPanel('collapsed');
                }
            } else {
                // Selected non-frame content (images, shapes, etc.) → collapsed state
                genState.currentFrame = findParentFrame(selectedElements);
                genState.currentAnchor = getSelectionBounds(selectedElements);
                collectSelectedAsReference(selectedElements);
                showGenPanel('collapsed');
            }
        };

        // Chain into render loop for position updates
        const existingRender = engine.render.bind(engine);
        engine.render = () => {
            existingRender();
            if (genState.panelMode !== 'hidden' && genState.currentAnchor) {
                updateGenPanelPosition(genState.currentAnchor);
            }
        };

        // Setup event listeners
        setupGenPanelEvents();

        console.log('[canvas-gen] Generation panel initialized');
    }

    // ==================== Panel Show / Hide / State ====================

    /**
     * Show the gen panel in a specific mode: 'collapsed', 'expanded', or 'thinking'
     */
    function showGenPanel(mode) {
        const genPanel = document.getElementById('gen-panel');
        genPanel.classList.remove('hidden', 'collapsed', 'expanded', 'thinking');
        genPanel.classList.add(mode);
        genState.panelMode = mode;
        if (genState.currentAnchor) {
            updateGenPanelPosition(genState.currentAnchor);
        }
    }

    function hideGenPanel() {
        const genPanel = document.getElementById('gen-panel');
        genPanel.classList.remove('collapsed', 'expanded', 'thinking');
        genPanel.classList.add('hidden');
        genState.panelMode = 'hidden';
        genState.currentFrame = null;
        genState.currentAnchor = null;
        hideGenModelPicker();
        hideGenCountMenu();
    }

    function updateGenPanelPosition(anchor) {
        const engine = window.canvasEngine;
        const genPanel = document.getElementById('gen-panel');
        if (!engine || !genPanel) return;

        // Position below anchor center
        const worldCenterX = anchor.x + anchor.width / 2;
        const worldBottomY = anchor.y + anchor.height;
        const screenPos = engine.worldToScreen(worldCenterX, worldBottomY);

        if (!screenPos || typeof screenPos.x !== 'number') return;

        genPanel.style.left = screenPos.x + 'px';
        genPanel.style.top = (screenPos.y + 16) + 'px'; // 16px gap below element
    }

    function autoFocusEditor() {
        const editor = document.getElementById('gen-input-editor');
        if (editor) {
            requestAnimationFrame(() => editor.focus());
        }
    }

    // ==================== Selection Helpers ====================

    /**
     * Find the parent frame that contains the selected elements (by coordinate overlap).
     */
    function findParentFrame(elements) {
        const engine = window.canvasEngine;
        if (!engine) return null;

        const bounds = getSelectionBounds(elements);
        const frames = engine.elements.filter(el => el.type === 'frame');

        // Find frame whose bounds contain the selection center
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

    /**
     * Get the bounding box of selected elements.
     */
    function getSelectionBounds(elements) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const el of elements) {
            minX = Math.min(minX, el.x);
            minY = Math.min(minY, el.y);
            maxX = Math.max(maxX, el.x + (el.width || 0));
            maxY = Math.max(maxY, el.y + (el.height || 0));
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
    }

    /**
     * Collect selected image elements as reference images for the gen panel.
     */
    function collectSelectedAsReference(elements) {
        // Remove previous auto-collected images, keep user-uploaded ones
        genState.uploadedImages = genState.uploadedImages.filter(img => !img.fromSelection);

        for (const el of elements) {
            if (el.type === 'image' && el.image) {
                try {
                    const tempCanvas = document.createElement('canvas');
                    // Cap resolution for performance
                    const scale = Math.min(1, 1024 / Math.max(el.width, el.height));
                    tempCanvas.width = Math.round(el.width * scale);
                    tempCanvas.height = Math.round(el.height * scale);
                    const ctx = tempCanvas.getContext('2d');
                    ctx.drawImage(el.image, 0, 0, tempCanvas.width, tempCanvas.height);
                    const dataUrl = tempCanvas.toDataURL('image/jpeg', 0.85);

                    genState.uploadedImages.push({
                        index: genState.uploadedImages.length + 1,
                        src: dataUrl,
                        name: 'Selected image',
                        fromSelection: true
                    });
                } catch (err) {
                    console.warn('[canvas-gen] Failed to export selected image:', err);
                }
            }
        }
        renderGenUploadedImages();
        updateGenSendState();
    }

    // ==================== Event Listeners ====================
    function setupGenPanelEvents() {
        const genPanel = document.getElementById('gen-panel');
        const collapsed = document.getElementById('gen-collapsed');
        const editor = document.getElementById('gen-input-editor');
        const addBtn = document.getElementById('gen-add-btn');
        const modelSelector = document.getElementById('gen-model-selector');
        const countSelector = document.getElementById('gen-count-selector');
        const countMenu = document.getElementById('gen-count-menu');
        const sendBtn = document.getElementById('gen-send-btn');
        const stopBtn = document.getElementById('gen-stop-btn');

        // Collapsed capsule click → expand
        collapsed.addEventListener('click', (e) => {
            e.stopPropagation();
            showGenPanel('expanded');
            autoFocusEditor();
        });

        // Stop button → abort generation
        stopBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (genState.abortController) {
                genState.abortController.abort();
            }
        });

        // 1. Prompt input → update send button state
        editor.addEventListener('input', updateGenSendState);

        // 2. Add button → file upload
        addBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/jpeg,image/png,image/gif,image/webp';
            input.multiple = true;
            input.onchange = (ev) => handleGenFileUpload(ev.target.files);
            input.click();
        });

        // 3. Model selector → show model picker
        modelSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGenModelPicker();
        });

        // 4. Image count selector → show count menu
        countSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleGenCountMenu();
        });

        // 5. Count menu items
        countMenu.addEventListener('click', (e) => {
            const item = e.target.closest('.menu-item');
            if (!item) return;
            const count = parseInt(item.dataset.count);
            genState.imageCount = count;
            updateCountDisplay();
            hideGenCountMenu();
        });

        // 6. Send button (use mousedown instead of click to avoid Enter key also triggering click)
        sendBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            handleGenerate();
        });

        // 7. Enter key to send (without shift)
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleGenerate();
            }
        });

        // 8. Close sub-menus on outside click
        document.addEventListener('click', (e) => {
            const modelPicker = document.getElementById('gen-model-picker');
            if (modelPicker && modelPicker.classList.contains('active') &&
                !modelPicker.contains(e.target) && !modelSelector.contains(e.target)) {
                hideGenModelPicker();
            }
            if (!countMenu.classList.contains('hidden') &&
                !countMenu.contains(e.target) && !countSelector.contains(e.target)) {
                hideGenCountMenu();
            }
        });

        // 9. Prevent canvas events when interacting with gen panel
        genPanel.addEventListener('mousedown', (e) => e.stopPropagation());
        genPanel.addEventListener('pointerdown', (e) => e.stopPropagation());
        genPanel.addEventListener('wheel', (e) => e.stopPropagation());
        countMenu.addEventListener('mousedown', (e) => e.stopPropagation());
        countMenu.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    // ==================== File Upload ====================
    function handleGenFileUpload(files) {
        const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
        const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

        Array.from(files).forEach(file => {
            if (!ALLOWED_TYPES.includes(file.type)) {
                showGenNotification('Unsupported file type: ' + file.name);
                return;
            }
            if (file.size > MAX_FILE_SIZE) {
                showGenNotification('File too large: ' + file.name + ' (max 10MB)');
                return;
            }

            const reader = new FileReader();
            reader.onload = (e) => {
                const newIndex = genState.uploadedImages.length + 1;
                genState.uploadedImages.push({
                    index: newIndex,
                    src: e.target.result,
                    name: file.name
                });
                renderGenUploadedImages();
                updateGenSendState();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderGenUploadedImages() {
        const container = document.getElementById('gen-uploaded-images');
        container.innerHTML = '';

        genState.uploadedImages.forEach((img, idx) => {
            img.index = idx + 1;
            const div = document.createElement('div');
            div.className = 'gen-uploaded-image' + (img.fromSelection ? ' from-selection' : '');
            div.innerHTML = `
                <img src="${img.src}" alt="Ref ${img.index}">
                <button class="gen-remove-btn" data-idx="${idx}">
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" stroke-width="3">
                        <line x1="18" y1="6" x2="6" y2="18"/>
                        <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                </button>
            `;
            div.querySelector('.gen-remove-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                genState.uploadedImages.splice(idx, 1);
                renderGenUploadedImages();
                updateGenSendState();
            });
            container.appendChild(div);
        });
    }

    // ==================== Model Picker ====================
    function toggleGenModelPicker() {
        const picker = document.getElementById('gen-model-picker');
        if (picker && picker.classList.contains('active')) {
            hideGenModelPicker();
        } else {
            showGenModelPicker();
        }
    }

    function showGenModelPicker() {
        let picker = document.getElementById('gen-model-picker');
        if (!picker) {
            picker = document.createElement('div');
            picker.id = 'gen-model-picker';
            picker.className = 'floating-picker model-picker-panel';
            document.getElementById('gen-expanded').appendChild(picker);

            // Prevent events from bubbling to canvas
            picker.addEventListener('mousedown', (e) => e.stopPropagation());
            picker.addEventListener('pointerdown', (e) => e.stopPropagation());
        }

        // Render using shared MODELS array
        picker.innerHTML = `
            <div class="picker-header"><span>Models</span></div>
            ${MODELS.map(m => `
                <div class="picker-item model-item-picker ${genState.selectedModel === m.id ? 'selected' : ''}"
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

        // Click handlers for model items
        picker.querySelectorAll('.model-item-picker').forEach(item => {
            item.addEventListener('click', () => {
                genState.selectedModel = item.dataset.model;
                genState.selectedModelName = item.dataset.name;
                updateGenModelDisplay();
                hideGenModelPicker();
            });
        });

        picker.classList.add('active');
        picker.classList.remove('hidden');
    }

    function hideGenModelPicker() {
        const picker = document.getElementById('gen-model-picker');
        if (picker) {
            picker.classList.remove('active');
            picker.classList.add('hidden');
        }
    }

    function updateGenModelDisplay() {
        const label = document.querySelector('.gen-model-label');
        if (label) label.textContent = genState.selectedModelName;
    }

    // ==================== Image Count ====================
    function toggleGenCountMenu() {
        const menu = document.getElementById('gen-count-menu');
        if (menu.classList.contains('hidden')) {
            showGenCountMenu();
        } else {
            hideGenCountMenu();
        }
    }

    function showGenCountMenu() {
        const menu = document.getElementById('gen-count-menu');
        const countSelector = document.getElementById('gen-count-selector');
        const selectorRect = countSelector.getBoundingClientRect();

        // Position above the count selector
        menu.style.left = selectorRect.left + 'px';
        menu.style.top = (selectorRect.top - 8) + 'px';
        menu.style.transform = 'translateY(-100%)';
        menu.classList.remove('hidden');

        // Mark active item
        menu.querySelectorAll('.menu-item').forEach(item => {
            item.classList.toggle('active', parseInt(item.dataset.count) === genState.imageCount);
        });
    }

    function hideGenCountMenu() {
        const menu = document.getElementById('gen-count-menu');
        if (menu) menu.classList.add('hidden');
    }

    function updateCountDisplay() {
        const label = document.querySelector('.gen-count-label');
        if (label) {
            label.textContent = genState.imageCount === 1
                ? '1 Image'
                : genState.imageCount + ' Images';
        }
    }

    // ==================== Send State ====================
    function updateGenSendState() {
        const sendBtn = document.getElementById('gen-send-btn');
        const editor = document.getElementById('gen-input-editor');
        const text = editor ? editor.textContent.trim() : '';
        const hasContent = text.length > 0 || genState.uploadedImages.length > 0;
        sendBtn.disabled = !hasContent;
    }

    // ==================== API Call & Generation ====================
    async function handleGenerate() {
        const editor = document.getElementById('gen-input-editor');
        const prompt = editor ? editor.textContent.trim() : '';
        const anchor = genState.currentAnchor;

        if (!anchor) return;
        if (!prompt && genState.uploadedImages.length === 0) return;

        // Get model config
        const modelConfig = MODEL_CONFIGS[genState.selectedModel];
        if (!modelConfig) {
            showGenNotification('Selected model is not yet available.');
            return;
        }

        // Snapshot all context at generation start so each call is independent
        const genContext = {
            frame: genState.currentFrame,
            anchor: { ...anchor },
            images: [...genState.uploadedImages],
            imageCount: genState.imageCount,
            selectedElements: [...genState.selectedElements],
        };

        // Switch this panel to thinking state
        genState.isGenerating = true;
        showGenPanel('thinking');

        // Create abort controller for this generation
        const abortController = new AbortController();
        genState.abortController = abortController;

        // Disable send button
        const sendBtn = document.getElementById('gen-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        try {
            // Build Gemini generateContent request body
            const parts = [];

            const textPrompt = prompt || 'Generate a high-quality image based on the reference image(s) provided.';
            parts.push({ text: textPrompt });

            // Add reference images as inlineData
            for (const img of genContext.images) {
                const match = img.src.match(/^data:([^;]+);base64,(.+)$/);
                if (match) {
                    parts.push({
                        inlineData: {
                            mimeType: match[1],
                            data: match[2]
                        }
                    });
                }
            }

            // Use frame or anchor dimensions for aspect ratio
            const refRect = genContext.frame || genContext.anchor;
            const aspectRatio = getClosestAspectRatio(refRect.width, refRect.height);

            // Detect image size from prompt (default 1K, user can say "2k" or "4k")
            let imageSize = '1K';
            if (/\b4[kK]\b/.test(prompt)) imageSize = '4K';
            else if (/\b2[kK]\b/.test(prompt)) imageSize = '2K';

            const requestBody = {
                contents: [{ parts: parts }],
                generationConfig: {
                    responseModalities: ['TEXT', 'IMAGE'],
                    imageConfig: {
                        aspectRatio: aspectRatio,
                        imageSize: imageSize
                    }
                }
            };

            // Generate images sequentially
            const successfulImages = [];
            for (let i = 0; i < genContext.imageCount; i++) {
                if (abortController.signal.aborted) break;

                let lastError = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    if (abortController.signal.aborted) break;
                    try {
                        const result = await callGenerateApi(modelConfig, requestBody, abortController);
                        if (result) successfulImages.push(result);
                        lastError = null;
                        break;
                    } catch (e) {
                        if (e.name === 'AbortError') throw e;
                        lastError = e;
                        console.warn('Image ' + (i + 1) + ' attempt ' + (attempt + 1) + ' failed:', e.message);
                        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
                if (lastError) console.error('Image ' + (i + 1) + ' failed after 3 attempts:', lastError.message);
            }

            if (abortController.signal.aborted) {
                throw new DOMException('Generation stopped by user', 'AbortError');
            }

            if (successfulImages.length === 0) {
                throw new Error('No images were generated. Please try again.');
            }

            // Place images
            await placeGeneratedImages(successfulImages, genContext);

            // Clear input after success
            editor.textContent = '';
            genState.uploadedImages = [];
            renderGenUploadedImages();
            updateGenSendState();

        } catch (error) {
            if (error.name === 'AbortError') {
                console.log('[canvas-gen] Generation stopped by user');
                showGenNotification('Generation stopped.');
            } else {
                console.error('[canvas-gen] Generation failed:', error);
                showGenNotification('Generation failed: ' + error.message);
            }
        } finally {
            genState.isGenerating = false;
            genState.abortController = null;
            // Return to collapsed state after generation
            showGenPanel('collapsed');
            updateGenSendState();
        }
    }

    async function callGenerateApi(modelConfig, requestBody, abortController) {
        // Send model in body — the server/Worker uses it to build the Gemini URL
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

        // Extract image from Gemini generateContent response
        // Format: { candidates: [{ content: { parts: [...] } }] }
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

    // ==================== Place Images into Frames ====================
    async function placeGeneratedImages(imageDataArray, genContext) {
        const engine = window.canvasEngine;
        if (!engine) return;

        const loadImage = (imgData) => {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = () => reject(new Error('Failed to load generated image'));
                img.src = imgData.dataUrl;
            });
        };

        // Load all images
        const loadedImages = [];
        for (const imgData of imageDataArray) {
            try {
                const img = await loadImage(imgData);
                loadedImages.push(img);
            } catch (err) {
                console.warn('[canvas-gen] Skipping failed image load:', err);
            }
        }

        if (loadedImages.length === 0) return;

        const { frame: sourceFrame, anchor, selectedElements } = genContext;

        // Save state before modifications (for undo support)
        engine.saveState();

        const refRect = sourceFrame || anchor;
        const FRAME_SPACING = 80;

        // Determine if selected elements are inside a frame
        const isInsideFrame = sourceFrame && selectedElements.some(el =>
            el !== sourceFrame && el.type !== 'frame'
        );

        if (isInsideFrame) {
            // CASE: Selected content inside a frame → replace selected elements
            for (const sel of selectedElements) {
                if (sel.type === 'frame') continue;
                const idx = engine.elements.indexOf(sel);
                if (idx !== -1) engine.elements.splice(idx, 1);
            }

            loadedImages.forEach((img, index) => {
                if (index === 0) {
                    // First image replaces into the source frame
                    const imageElement = {
                        type: 'image',
                        x: sourceFrame.x,
                        y: sourceFrame.y,
                        width: sourceFrame.width,
                        height: sourceFrame.height,
                        image: img,
                        src: img.src,
                        parentFrame: sourceFrame
                    };
                    engine.elements.push(imageElement);
                } else {
                    const newFrameX = sourceFrame.x + (sourceFrame.width + FRAME_SPACING) * index;
                    const newFrameY = sourceFrame.y;
                    addFrameWithImage(engine, img, newFrameX, newFrameY,
                        sourceFrame.width, sourceFrame.height, sourceFrame.fill);
                }
            });
        } else if (sourceFrame) {
            // CASE: Selected empty frame → place into frame
            loadedImages.forEach((img, index) => {
                if (index === 0) {
                    const imageElement = {
                        type: 'image',
                        x: sourceFrame.x,
                        y: sourceFrame.y,
                        width: sourceFrame.width,
                        height: sourceFrame.height,
                        image: img,
                        src: img.src,
                        parentFrame: sourceFrame
                    };
                    engine.elements.push(imageElement);
                } else {
                    const newFrameX = sourceFrame.x + (sourceFrame.width + FRAME_SPACING) * index;
                    const newFrameY = sourceFrame.y;
                    addFrameWithImage(engine, img, newFrameX, newFrameY,
                        sourceFrame.width, sourceFrame.height, sourceFrame.fill);
                }
            });
        } else {
            // CASE: No frame → create new frames to the right of selection
            loadedImages.forEach((img, index) => {
                const newFrameX = refRect.x + (refRect.width + FRAME_SPACING) * (index + 1);
                const newFrameY = refRect.y;
                addFrameWithImage(engine, img, newFrameX, newFrameY,
                    refRect.width, refRect.height, '#FFFFFF');
            });
        }

        // Re-render canvas
        engine.render();
    }

    /**
     * Helper: add a frame + image at a position.
     * Frame is inserted BEFORE the image so the image renders on top.
     */
    function addFrameWithImage(engine, img, x, y, width, height, fill) {
        const frameCount = engine.elements.filter(el => el.type === 'frame').length + 1;
        const newFrame = {
            type: 'frame',
            name: 'Page ' + frameCount,
            x, y, width, height,
            fill: fill,
            stroke: '#E0E0E0',
            strokeWidth: 1
        };
        engine.elements.push(newFrame);

        const imageElement = {
            type: 'image',
            x, y, width, height,
            image: img,
            src: img.src,
            parentFrame: newFrame
        };
        engine.elements.push(imageElement);
    }

    // ==================== Notifications ====================
    function showGenNotification(message) {
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;background:#090C14;color:white;padding:12px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;font-size:14px;font-weight:500;animation:slideIn 0.3s ease;max-width:400px;';
        toast.textContent = message;

        // Add animation keyframes if not present
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
