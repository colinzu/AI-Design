/**
 * Canvas Generation Panel — AI Image Generation Input
 * Manages the generation input panel that appears below selected frames.
 * Calls Nano Banana Pro via Google Gemini generateContent API.
 */

(function () {
    // ==================== State ====================
    const genState = {
        selectedModel: 'nano-banana',
        selectedModelName: 'Nano Banana Pro',
        imageCount: 1,
        uploadedImages: [],     // { index, src, name }
        isGenerating: false,
        currentFrame: null      // Reference to selected frame element
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
    // Proxied through server.py to bypass region restrictions
    const MODEL_CONFIGS = {
        'nano-banana': {
            apiKey: 'AIzaSyDwsn-H9GkEeAW1w3TUl-rJX_K_daTTkKQ',
            model: 'gemini-3-pro-image-preview',
            baseUrl: '/api/gemini/v1beta',
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

            const frame = selectedElements.find(el => el.type === 'frame');
            if (selectedElements.length === 1 && frame) {
                genState.currentFrame = frame;
                showGenPanel(frame);
            } else {
                genState.currentFrame = null;
                hideGenPanel();
            }
        };

        // Chain into render loop for position updates
        const existingRender = engine.render.bind(engine);
        engine.render = () => {
            existingRender();
            if (genState.currentFrame && !genPanel.classList.contains('hidden')) {
                updateGenPanelPosition(genState.currentFrame);
            }
        };

        // Setup event listeners
        setupGenPanelEvents();

        console.log('[canvas-gen] Generation panel initialized');
    }

    // ==================== Panel Show / Hide / Position ====================
    function showGenPanel(frame) {
        const genPanel = document.getElementById('gen-panel');
        genPanel.classList.remove('hidden');
        updateGenPanelPosition(frame);
    }

    function hideGenPanel() {
        const genPanel = document.getElementById('gen-panel');
        genPanel.classList.add('hidden');
        hideGenModelPicker();
        hideGenCountMenu();
    }

    function updateGenPanelPosition(frame) {
        const engine = window.canvasEngine;
        const genPanel = document.getElementById('gen-panel');
        if (!engine || !genPanel) return;

        // Position below frame center
        const worldCenterX = frame.x + frame.width / 2;
        const worldBottomY = frame.y + frame.height;
        const screenPos = engine.worldToScreen(worldCenterX, worldBottomY);

        if (!screenPos || typeof screenPos.x !== 'number') return;

        genPanel.style.left = screenPos.x + 'px';
        genPanel.style.top = (screenPos.y + 16) + 'px'; // 16px gap below frame
    }

    // ==================== Event Listeners ====================
    function setupGenPanelEvents() {
        const genPanel = document.getElementById('gen-panel');
        const editor = document.getElementById('gen-input-editor');
        const addBtn = document.getElementById('gen-add-btn');
        const modelSelector = document.getElementById('gen-model-selector');
        const countSelector = document.getElementById('gen-count-selector');
        const countMenu = document.getElementById('gen-count-menu');
        const sendBtn = document.getElementById('gen-send-btn');

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
            div.className = 'gen-uploaded-image';
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
            document.getElementById('gen-panel').appendChild(picker);

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
        if (genState.isGenerating) return;
        // Set flag IMMEDIATELY to prevent any duplicate calls
        genState.isGenerating = true;

        const editor = document.getElementById('gen-input-editor');
        const prompt = editor ? editor.textContent.trim() : '';
        const frame = genState.currentFrame;

        if (!frame) { genState.isGenerating = false; return; }
        if (!prompt && genState.uploadedImages.length === 0) { genState.isGenerating = false; return; }

        // Get model config
        const modelConfig = MODEL_CONFIGS[genState.selectedModel];
        if (!modelConfig) {
            genState.isGenerating = false;
            showGenNotification('Selected model is not yet available.');
            return;
        }

        showGenLoading(true);

        // Disable send button immediately to prevent double-click
        const sendBtn = document.getElementById('gen-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        try {
            // Build Gemini generateContent request body
            const parts = [];

            // Add text prompt
            const textPrompt = prompt || 'Generate a high-quality image based on the reference image(s) provided.';
            parts.push({ text: textPrompt });

            // Add reference images as inlineData
            for (const img of genState.uploadedImages) {
                // img.src is a data URL: "data:image/png;base64,..."
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

            // Match frame aspect ratio to closest Gemini-supported ratio
            const aspectRatio = getClosestAspectRatio(frame.width, frame.height);

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

            // Send requests sequentially (avoids SSL EOF errors from concurrent connections)
            // Each request retries up to 2 times on transient failures
            const successfulImages = [];
            for (let i = 0; i < genState.imageCount; i++) {
                let lastError = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try {
                        const result = await callGenerateApi(modelConfig, requestBody);
                        if (result) successfulImages.push(result);
                        lastError = null;
                        break;
                    } catch (e) {
                        lastError = e;
                        console.warn('Image ' + (i + 1) + ' attempt ' + (attempt + 1) + ' failed:', e.message);
                        if (attempt < 2) await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                    }
                }
                if (lastError) console.error('Image ' + (i + 1) + ' failed after 3 attempts:', lastError.message);
            }

            if (successfulImages.length === 0) {
                throw new Error('No images were generated. Please try again.');
            }

            // Place images into frames
            await placeGeneratedImages(successfulImages, frame);

            // Clear input after success
            editor.textContent = '';
            genState.uploadedImages = [];
            renderGenUploadedImages();
            updateGenSendState();

        } catch (error) {
            console.error('[canvas-gen] Generation failed:', error);
            showGenNotification('Generation failed: ' + error.message);
        } finally {
            genState.isGenerating = false;
            showGenLoading(false);
            updateGenSendState(); // Re-enable send button if there's still content
        }
    }

    async function callGenerateApi(modelConfig, requestBody) {
        const url = modelConfig.baseUrl + '/models/' + modelConfig.model
            + ':generateContent?key=' + modelConfig.apiKey;

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

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
    async function placeGeneratedImages(imageDataArray, sourceFrame) {
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

        // Save state before modifications (for undo support)
        engine.saveState();

        const FRAME_SPACING = 80; // px in world coordinates

        loadedImages.forEach((img, index) => {
            if (index === 0) {
                // First image: fill into the current (source) frame
                const imageElement = {
                    type: 'image',
                    x: sourceFrame.x,
                    y: sourceFrame.y,
                    width: sourceFrame.width,
                    height: sourceFrame.height,
                    image: img,
                    src: img.src
                };
                engine.elements.push(imageElement);
            } else {
                // Subsequent images: create new frames to the right
                const newFrameX = sourceFrame.x + (sourceFrame.width + FRAME_SPACING) * index;
                const newFrameY = sourceFrame.y;

                // Create new frame
                const frameCount = engine.elements.filter(el => el.type === 'frame').length + 1;
                const newFrame = {
                    type: 'frame',
                    name: 'Page ' + frameCount,
                    x: newFrameX,
                    y: newFrameY,
                    width: sourceFrame.width,
                    height: sourceFrame.height,
                    fill: sourceFrame.fill,
                    stroke: '#E0E0E0',
                    strokeWidth: 1
                };
                engine.elements.push(newFrame);

                // Place image in the new frame
                const imageElement = {
                    type: 'image',
                    x: newFrameX,
                    y: newFrameY,
                    width: sourceFrame.width,
                    height: sourceFrame.height,
                    image: img,
                    src: img.src
                };
                engine.elements.push(imageElement);
            }
        });

        // Re-render canvas
        engine.render();
    }

    // ==================== Loading State ====================
    function showGenLoading(show) {
        const loading = document.getElementById('gen-loading');
        if (loading) {
            loading.classList.toggle('hidden', !show);
        }
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
