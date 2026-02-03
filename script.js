// ==================== Global State ====================
let isAutoMode = true; // Auto mode: agent routes to appropriate model
let currentModel = null; // null means auto, otherwise specific model id
let currentModelName = 'Auto';
let uploadedImages = [];
let savedRange = null; // Save selection range for @ insertion
let currentLanguage = 'en'; // Language state: 'en' or 'zh'

// Translation dictionary
const translations = {
    en: {
        'hero-title': 'Imagine it. <em>Design</em> it.',
        'placeholder': 'Enter your ideas...',
        'category-seedream': 'Seedream 5.0',
        'category-nano': 'Nano Banana Pro',
        'category-social': 'Social media',
        'category-ecommerce': 'E-commerce',
        'category-promotion': 'Promotion',
        'section-recents': 'Recents',
        'section-inspiration': 'Inspiration',
        'new-project': 'New Project',
        'language-en': 'English',
        'language-zh': '简体中文',
        'tab-all': 'All',
        'tab-social': 'Social Media',
        'tab-effects': 'Effects',
        'tab-posters': 'Posters',
        'tab-advertisement': 'Advertisement',
        'tab-brand': 'Brand',
        'tab-cine': 'Cine Muse'
    },
    zh: {
        'hero-title': '想象即设计。<em>创造</em>未来。',
        'placeholder': '输入你的想法...',
        'category-seedream': 'Seedream 5.0',
        'category-nano': 'Nano Banana Pro',
        'category-social': '社交媒体',
        'category-ecommerce': '电子商务',
        'category-promotion': '推广',
        'section-recents': '最近项目',
        'section-inspiration': '灵感',
        'new-project': '新建项目',
        'language-en': 'English',
        'language-zh': '简体中文',
        'tab-all': '全部',
        'tab-social': '社交媒体',
        'tab-effects': '特效',
        'tab-posters': '海报',
        'tab-advertisement': '广告',
        'tab-brand': '品牌',
        'tab-cine': '电影'
    }
};

// Inspiration gallery data - 30+ items
const inspirationData = [
    { src: "assets/images/Inspiration/imgi_20_2b683c752d5d7affd5c37af4ef5a294a.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_34_a75e35edd49a680597665da6bf14488a.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_36_2ad10df92d38f0171ba87ca0d17af081.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_40_dd3c4e6c98d7d1cae9e21cececf08a00.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_43_9559ad4db30640f60aba3f3e2e51ff6c.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_44_33f5d8ed45651cd4df3f59bfbcb86a3b.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_46_2f7818b49107b10f8f44900446c4927a.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_49_6cc1c4b153db1a9e3d0f6bdc9a2a069d.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_51_d216e02d57c01e6554f63fbe0988923b.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_52_be55b53a1f7dfb7c1f02dec9cdb76e67.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_55_e4e124f44219bdeb8d7d08e66e104956.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_57_8d35a085a27b35016b4a2207ad71af25.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_59_ce258d64a3bb5456c3b8df2536574777.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_61_39406516453dc61fc04aaac5d7a37537.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_63_f26578fc503c646043b03d2518874c5c.jpg", title: "Inspiration" },
    { src: "assets/images/Inspiration/imgi_65_30878f915045f642eb6fc9493e1b4cb9.jpg", title: "Inspiration" },
];

const models = [
    { id: 'nano-banana', name: 'Nano Banana Pro', icon: '<span style="color:#4285F4;font-weight:700">G</span>', tags: ['Hot', '60s'], desc: 'Complex reasoning · Accurate text · World knowledge.' },
    { id: 'seedream', name: 'Seedream 5.0', icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2"><rect x="3" y="3" width="6" height="18" rx="1"/><rect x="11" y="8" width="6" height="13" rx="1"/><rect x="19" y="13" width="2" height="8" rx="1"/></svg>', tags: ['30s'], desc: 'High consistency · Strong composition · Cinematic aesthetics' },
];

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    renderInspirationGrid();
    initializeInputEditor();
    updateModelDisplay();
    updateSendButtonState();
    updateLanguageButton();
    applyTranslations();
});

// ==================== Event Listeners ====================
function initializeEventListeners() {
    // Model selector - clicking opens picker
    const modelSelector = document.getElementById('model-selector');
    if (modelSelector) {
        modelSelector.addEventListener('click', (e) => {
            e.stopPropagation();
            showModelPicker();
        });
    }

    // Add button
    const addBtn = document.getElementById('add-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = 'image/*';
            input.multiple = true;
            input.onchange = (e) => handleFileUpload(e.target.files);
            input.click();
        });
    }

    // Send button
    const sendBtn = document.getElementById('send-btn');
    if (sendBtn) {
        sendBtn.addEventListener('click', handleGenerate);
    }

    // Category chips
    const categoryChips = document.querySelectorAll('.category-chip');
    categoryChips.forEach(chip => {
        chip.addEventListener('click', () => {
            categoryChips.forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });

    // Tab buttons
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            hideImagePicker();
            hideModelPicker();
        }
    });

    // Close pickers when clicking outside
    document.addEventListener('click', (e) => {
        const imagePicker = document.getElementById('image-picker');
        const modelPicker = document.getElementById('model-picker');
        const languagePicker = document.getElementById('language-picker');
        const editor = document.getElementById('input-editor');
        const modelSelector = document.getElementById('model-selector');
        const languageBtn = document.getElementById('language-btn');

        if (imagePicker && !imagePicker.contains(e.target) && e.target !== editor && !editor.contains(e.target)) {
            hideImagePicker();
        }
        if (modelPicker && !modelPicker.contains(e.target) && (!modelSelector || !modelSelector.contains(e.target))) {
            hideModelPicker();
        }
        if (languagePicker && !languagePicker.contains(e.target) && (!languageBtn || !languageBtn.contains(e.target))) {
            hideLanguagePicker();
        }
    });

    // Language button
    const languageBtn = document.getElementById('language-btn');
    if (languageBtn) {
        languageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            showLanguagePicker();
        });
    }
}

// ==================== Input Editor ====================
function initializeInputEditor() {
    const editor = document.getElementById('input-editor');
    if (!editor) return;

    // Handle input for @ detection
    editor.addEventListener('input', (e) => {
        checkForAtSymbol(editor);
        updateSendButtonState();
    });

    // Handle keydown for special keys
    editor.addEventListener('keydown', (e) => {
        const picker = document.getElementById('image-picker');

        if (picker && picker.classList.contains('active')) {
            const items = picker.querySelectorAll('.picker-item');
            const activeItem = picker.querySelector('.picker-item.active');
            let activeIndex = Array.from(items).indexOf(activeItem);

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (activeIndex < items.length - 1) {
                    items[activeIndex]?.classList.remove('active');
                    items[activeIndex + 1]?.classList.add('active');
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                if (activeIndex > 0) {
                    items[activeIndex]?.classList.remove('active');
                    items[activeIndex - 1]?.classList.add('active');
                }
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const active = picker.querySelector('.picker-item.active');
                if (active) {
                    insertImageReference(active.dataset.index);
                }
            } else if (e.key === 'Escape') {
                hideImagePicker();
            }
        }
    });
}

function checkForAtSymbol(editor) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;

    if (textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent;
    const cursorPos = range.startOffset;

    // Find @ before cursor
    const textBeforeCursor = text.substring(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex !== -1 && uploadedImages.length > 0) {
        const textAfterAt = textBeforeCursor.substring(lastAtIndex + 1);
        // Only show picker if @ is at cursor or followed by numbers/nothing
        if (textAfterAt === '' || /^\d*$/.test(textAfterAt)) {
            showImagePicker(textAfterAt);
            return;
        }
    }

    hideImagePicker();
}

function showImagePicker(filter = '') {
    // Save current selection before showing picker
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
        savedRange = selection.getRangeAt(0).cloneRange();
    }

    let picker = document.getElementById('image-picker');

    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'image-picker';
        picker.className = 'floating-picker';
        document.querySelector('.creation-card').appendChild(picker);
    }

    // Filter images based on input after @
    const filteredImages = uploadedImages.filter(img =>
        filter === '' || img.index.toString().startsWith(filter)
    );

    if (filteredImages.length === 0) {
        hideImagePicker();
        return;
    }

    picker.innerHTML = filteredImages.map((img, i) => `
        <div class="picker-item ${i === 0 ? 'active' : ''}" data-index="${img.index}">
            <img src="${img.src}" alt="Image ${img.index}">
            <span class="picker-label">Pic ${img.index}</span>
        </div>
    `).join('');

    // Add scroll class if more than 5 images
    if (filteredImages.length > 5) {
        picker.classList.add('image-picker-scroll');
    } else {
        picker.classList.remove('image-picker-scroll');
    }

    // Add click handlers - use mousedown to prevent blur
    picker.querySelectorAll('.picker-item').forEach(item => {
        item.addEventListener('mousedown', (e) => {
            e.preventDefault(); // Prevent focus loss
            insertImageReference(item.dataset.index);
        });
        item.addEventListener('mouseenter', () => {
            picker.querySelectorAll('.picker-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
        });
    });

    // Position picker near cursor
    positionPickerAtCursor(picker);
    picker.classList.add('active');
}

function positionPickerAtCursor(picker) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const cardRect = document.querySelector('.creation-card').getBoundingClientRect();

    // Position relative to creation-card - 默认向下
    const left = rect.left - cardRect.left;
    const top = rect.bottom - cardRect.top + 8; // 光标下方8px

    picker.style.left = Math.max(0, left) + 'px';
    picker.style.top = top + 'px';
    picker.style.bottom = 'auto';
    picker.classList.remove('position-top');
}

function hideImagePicker() {
    const picker = document.getElementById('image-picker');
    if (picker) {
        picker.classList.remove('active');
    }
}

function insertImageReference(imageIndex) {
    const editor = document.getElementById('input-editor');
    const selection = window.getSelection();

    // Restore saved range if available
    if (savedRange) {
        selection.removeAllRanges();
        selection.addRange(savedRange);
    }

    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const textNode = range.startContainer;

    // Find the image data
    const imgData = uploadedImages.find(img => img.index === parseInt(imageIndex));
    if (!imgData) return;

    if (textNode.nodeType === Node.TEXT_NODE) {
        const text = textNode.textContent;
        const cursorPos = range.startOffset;
        const textBeforeCursor = text.substring(0, cursorPos);
        const lastAtIndex = textBeforeCursor.lastIndexOf('@');

        if (lastAtIndex !== -1) {
            // Create the reference tag with thumbnail and "Pic X" label
            const refTag = document.createElement('span');
            refTag.className = 'image-ref-tag';
            refTag.contentEditable = 'false';
            refTag.dataset.imageIndex = imageIndex;
            refTag.innerHTML = `<img src="${imgData.src}" alt="Pic ${imageIndex}"><span class="ref-label">Pic ${imageIndex}</span>`;

            // Split the text node and insert the tag
            const beforeText = text.substring(0, lastAtIndex);
            const afterText = text.substring(cursorPos);

            textNode.textContent = beforeText;

            const afterNode = document.createTextNode(afterText + '\u00A0');

            const parent = textNode.parentNode;
            parent.insertBefore(refTag, textNode.nextSibling);
            parent.insertBefore(afterNode, refTag.nextSibling);

            // Move cursor after the tag
            const newRange = document.createRange();
            newRange.setStart(afterNode, 1);
            newRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(newRange);
        }
    }

    savedRange = null; // Clear saved range
    hideImagePicker();
    editor.focus();
}

// ==================== Model Picker ====================
function showModelPicker() {
    let picker = document.getElementById('model-picker');

    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'model-picker';
        picker.className = 'floating-picker model-picker-panel';
        document.querySelector('.creation-card').appendChild(picker);
    }

    renderModelPicker(picker);

    // Position near model selector - 默认向下
    const modelSelector = document.getElementById('model-selector');
    const cardRect = document.querySelector('.creation-card').getBoundingClientRect();
    const selectorRect = modelSelector.getBoundingClientRect();

    const top = selectorRect.bottom - cardRect.top + 8; // 选择器下方8px

    picker.style.left = (selectorRect.left - cardRect.left) + 'px';
    picker.style.top = top + 'px';
    picker.style.bottom = 'auto';
    picker.classList.remove('position-top');

    picker.classList.add('active');
}

function renderModelPicker(picker) {
    picker.innerHTML = `
        <div class="picker-header">
            <span>Models</span>
            <div class="auto-toggle-inline">
                <span>Auto</span>
                <label class="toggle-switch-sm">
                    <input type="checkbox" id="auto-toggle-picker" ${isAutoMode ? 'checked' : ''}>
                    <span class="toggle-slider-sm"></span>
                </label>
            </div>
        </div>
        ${models.map(m => `
            <div class="picker-item model-item-picker ${isAutoMode || currentModel === m.id ? 'selected' : ''}" data-model="${m.id}" data-name="${m.name}">
                <div class="model-icon-sm">${m.icon}</div>
                <div class="model-info-sm">
                    <div class="model-name-sm">
                        ${m.name}
                        ${m.tags.map(t => `<span class="tag-sm ${t === 'Hot' ? 'hot' : 'time'}">${t}</span>`).join('')}
                    </div>
                    <p class="model-desc-sm">${m.desc}</p>
                </div>
                <span class="check-icon-sm">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                </span>
            </div>
        `).join('')}
    `;

    // Auto toggle handler
    const autoToggle = picker.querySelector('#auto-toggle-picker');
    if (autoToggle) {
        autoToggle.addEventListener('change', (e) => {
            isAutoMode = e.target.checked;
            if (isAutoMode) {
                currentModel = null;
                currentModelName = 'Auto';
            }
            updateModelDisplay();
            renderModelPicker(picker); // Re-render to update checkmarks
        });
    }

    // Model item click handlers
    picker.querySelectorAll('.model-item-picker').forEach(item => {
        item.addEventListener('click', () => {
            // When user clicks a specific model, turn off Auto
            isAutoMode = false;
            currentModel = item.dataset.model;
            currentModelName = item.dataset.name;
            updateModelDisplay();
            hideModelPicker();
        });
    });
}

function hideModelPicker() {
    const picker = document.getElementById('model-picker');
    if (picker) {
        picker.classList.remove('active');
    }
}

function updateModelDisplay() {
    const modelSelector = document.getElementById('model-selector');
    if (!modelSelector) return;

    const displayName = isAutoMode ? 'Auto' : currentModelName;
    modelSelector.innerHTML = `
        <img src="assets/images/Model.svg" alt="Model" class="model-icon-img">
        <span class="model-label">${displayName}</span>
    `;
}

// ==================== File Upload ====================
function handleFileUpload(files) {
    const container = document.getElementById('uploaded-images');
    if (!container || !files.length) return;

    const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

    Array.from(files).forEach((file) => {
        // Validate file type
        if (!ALLOWED_TYPES.includes(file.type)) {
            showNotification(`Unsupported file type: ${file.name}`);
            return;
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
            showNotification(`File too large: ${file.name} (max 10MB)`);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            // Get next index
            const newIndex = uploadedImages.length + 1;

            // Store in array
            uploadedImages.push({
                index: newIndex,
                src: e.target.result,
                name: file.name,
                size: file.size
            });

            renderUploadedImages();
        };

        reader.onerror = () => {
            showNotification(`Failed to read file: ${file.name}`);
        };

        reader.readAsDataURL(file);
    });
}

function renderUploadedImages() {
    const container = document.getElementById('uploaded-images');
    if (!container) return;

    container.innerHTML = '';

    uploadedImages.forEach((img, idx) => {
        // Update index to be sequential
        img.index = idx + 1;

        const imageEl = document.createElement('div');
        imageEl.className = 'uploaded-image';
        imageEl.dataset.index = img.index;
        imageEl.innerHTML = `
            <img src="${img.src}" alt="Pic ${img.index}">
            <span class="image-badge">${img.index}</span>
            <button class="remove-image-btn" data-index="${img.index}">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;

        // Add remove handler
        const removeBtn = imageEl.querySelector('.remove-image-btn');
        removeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(imageEl.dataset.index) - 1;
            uploadedImages.splice(idx, 1);
            renderUploadedImages();
            updateImageReferences(); // Update references after deletion
        });

        container.appendChild(imageEl);
    });

    updateSendButtonState();
}

function updateImageReferences() {
    const editor = document.getElementById('input-editor');
    if (!editor) return;

    const refTags = editor.querySelectorAll('.image-ref-tag');
    refTags.forEach(tag => {
        const oldIndex = parseInt(tag.dataset.imageIndex);
        const imageExists = uploadedImages.find(img => img.index === oldIndex);

        if (!imageExists) {
            // Image was deleted, remove the reference tag
            tag.remove();
        }
    });
}

// ==================== Send Button State ====================
function updateSendButtonState() {
    const sendBtn = document.getElementById('send-btn');
    const editor = document.getElementById('input-editor');

    if (!sendBtn || !editor) return;

    const text = editor.textContent.trim();
    const hasContent = text.length > 0 || uploadedImages.length > 0;

    sendBtn.disabled = !hasContent;
}

// ==================== Generation ====================
function handleGenerate() {
    const editor = document.getElementById('input-editor');
    const text = editor ? editor.textContent.trim() : '';

    if (!text && uploadedImages.length === 0) {
        showNotification('Please enter your ideas or upload images');
        return;
    }

    showNotification('Generating your design...');
}

// ==================== Inspiration Gallery ====================
function renderInspirationGrid() {
    const grid = document.getElementById('inspiration-grid');
    if (!grid) return;

    grid.innerHTML = '';

    inspirationData.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'inspiration-item';
        itemDiv.innerHTML = `<img src="${item.src}" alt="${item.title}" loading="lazy" decoding="async">`;
        grid.appendChild(itemDiv);
    });
}

// ==================== Notifications ====================
function showNotification(message) {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.style.cssText = `
        position: fixed;
        top: 80px;
        right: 24px;
        background: var(--text-primary);
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        z-index: 10000;
        font-size: 14px;
        font-weight: 500;
        animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;

    if (!document.getElementById('toast-styles')) {
        const style = document.createElement('style');
        style.id = 'toast-styles';
        style.textContent = `
            @keyframes slideIn {
                from { transform: translateX(100%); opacity: 0; }
                to { transform: translateX(0); opacity: 1; }
            }
            @keyframes slideOut {
                from { transform: translateX(0); opacity: 1; }
                to { transform: translateX(100%); opacity: 0; }
            }
            @keyframes fadeOut {
                from { opacity: 1; transform: scale(1); }
                to { opacity: 0; transform: scale(0.8); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ==================== Language Picker ====================
function showLanguagePicker() {
    let picker = document.getElementById('language-picker');

    if (!picker) {
        picker = document.createElement('div');
        picker.id = 'language-picker';
        picker.className = 'floating-picker language-picker-panel';
        document.body.appendChild(picker);
    }

    const languages = [
        { code: 'en', label: translations[currentLanguage]['language-en'] },
        { code: 'zh', label: translations[currentLanguage]['language-zh'] }
    ];

    picker.innerHTML = languages.map(lang => `
        <div class="language-item ${currentLanguage === lang.code ? 'selected' : ''}" data-lang="${lang.code}">
            <span class="language-label">${lang.label}</span>
            <svg class="language-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
            </svg>
        </div>
    `).join('');

    // Position near language button with smart positioning
    const languageBtn = document.getElementById('language-btn');
    if (languageBtn) {
        const btnRect = languageBtn.getBoundingClientRect();
        const pickerHeight = 100; // Approximate height
        const spaceBelow = window.innerHeight - btnRect.bottom;
        const spaceAbove = btnRect.top;

        // Smart positioning: default down, up if not enough space
        if (spaceBelow >= pickerHeight + 8) {
            // Position below
            picker.style.top = (btnRect.bottom + window.scrollY + 8) + 'px';
            picker.style.bottom = 'auto';
            picker.classList.remove('position-top');
        } else if (spaceAbove >= pickerHeight + 8) {
            // Position above
            picker.style.bottom = (window.innerHeight - btnRect.top + 8) + 'px';
            picker.style.top = 'auto';
            picker.classList.add('position-top');
        } else {
            // Default to below if both are tight
            picker.style.top = (btnRect.bottom + window.scrollY + 8) + 'px';
            picker.style.bottom = 'auto';
        }

        picker.style.right = (window.innerWidth - btnRect.right) + 'px';
        picker.style.left = 'auto';
    }

    // Add click handlers
    picker.querySelectorAll('.language-item').forEach(item => {
        item.addEventListener('click', () => {
            currentLanguage = item.dataset.lang;
            applyTranslations();
            updateLanguageButton();
            hideLanguagePicker();
            // 移除通知
        });
    });

    picker.classList.add('active');
}

function hideLanguagePicker() {
    const picker = document.getElementById('language-picker');
    if (picker) {
        picker.classList.remove('active');
    }
}

// ==================== Translation System ====================
function applyTranslations() {
    // Update all elements with data-translate attribute
    document.querySelectorAll('[data-translate]').forEach(element => {
        const key = element.getAttribute('data-translate');
        if (translations[currentLanguage][key]) {
            element.innerHTML = translations[currentLanguage][key];
        }
    });

    // Update input placeholder
    const editor = document.getElementById('input-editor');
    if (editor) {
        const placeholder = currentLanguage === 'zh'
            ? editor.getAttribute('data-placeholder-zh')
            : editor.getAttribute('data-placeholder');
        editor.setAttribute('data-placeholder', placeholder);
    }

    // Update section titles
    const sectionTitles = document.querySelectorAll('.section-title');
    if (sectionTitles.length >= 2) {
        sectionTitles[0].textContent = translations[currentLanguage]['section-recents'];
        sectionTitles[1].textContent = translations[currentLanguage]['section-inspiration'];
    }

    // Update new project text
    const newProjectSpan = document.querySelector('.new-project span');
    if (newProjectSpan) {
        newProjectSpan.textContent = translations[currentLanguage]['new-project'];
    }

    // Update inspiration tabs
    const tabs = document.querySelectorAll('.tab-btn');
    const tabKeys = ['tab-all', 'tab-social', 'tab-effects', 'tab-posters', 'tab-advertisement', 'tab-brand', 'tab-cine'];
    tabs.forEach((tab, index) => {
        if (tabKeys[index] && translations[currentLanguage][tabKeys[index]]) {
            tab.textContent = translations[currentLanguage][tabKeys[index]];
        }
    });
}

function updateLanguageButton() {
    const languageDisplay = document.getElementById('language-display');
    if (!languageDisplay) return;

    // Update button to show full language name
    const langText = currentLanguage === 'en' ? 'English' : '简体中文';
    languageDisplay.textContent = langText;
}

// ==================== Recents Horizontal Scroll ====================
function initializeRecentsScroll() {
    const scrollContainer = document.getElementById('recents-grid');
    const scrollLeft = document.getElementById('scroll-left');
    const scrollRight = document.getElementById('scroll-right');

    if (!scrollContainer || !scrollLeft || !scrollRight) return;

    // Update button states
    function updateScrollButtons() {
        const { scrollLeft: scrollPos, scrollWidth, clientWidth } = scrollContainer;

        // Disable left button if at start
        if (scrollPos <= 0) {
            scrollLeft.disabled = true;
        } else {
            scrollLeft.disabled = false;
        }

        // Disable right button if at end
        if (scrollPos + clientWidth >= scrollWidth - 1) {
            scrollRight.disabled = true;
        } else {
            scrollRight.disabled = false;
        }
    }

    // Scroll left
    scrollLeft.addEventListener('click', () => {
        scrollContainer.scrollBy({
            left: -400,
            behavior: 'smooth'
        });
    });

    // Scroll right
    scrollRight.addEventListener('click', () => {
        scrollContainer.scrollBy({
            left: 400,
            behavior: 'smooth'
        });
    });

    // Update buttons on scroll
    scrollContainer.addEventListener('scroll', updateScrollButtons);

    // Initial button state
    updateScrollButtons();
}
