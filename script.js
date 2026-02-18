// ==================== Global State ====================
let isAutoMode = true; // Auto mode: agent routes to appropriate model
let currentModel = null; // null means auto, otherwise specific model id
let currentModelName = 'Auto';
let uploadedImages = [];
let savedRange = null; // Save selection range for @ insertion
let currentLanguage = 'en'; // Language state: 'en' or 'zh'
let isLoggedIn = false; // Auth state
let otpCountdownTimer = null; // OTP countdown timer

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

// Models are now defined in models.js (shared with canvas page)
// Reference: const MODELS = [...] in models.js

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', () => {
    initializeEventListeners();
    renderInspirationGrid();
    initializeInputEditor();
    updateModelDisplay();
    updateSendButtonState();
    updateLanguageButton();
    applyTranslations();
    initializeProjectCards();
    initializeAuthModal();
    updateRecentsVisibility();
    updateAvatarState(null); // ensure correct initial state
    initCrossTabAuthSync();  // react to auth changes in other tabs
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

    // Recents Section - New Project
    // Converted to <a> tag in HTML for better reliability


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

    // Header Login button (logged-out state)
    const headerLoginBtn = document.getElementById('header-login-btn');
    if (headerLoginBtn) {
        headerLoginBtn.addEventListener('click', showAuthModal);
    }

    // Avatar button (logged-in state) → toggle dropdown, close lang picker
    const avatarBtn = document.getElementById('user-avatar-btn');
    if (avatarBtn) {
        avatarBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideLanguagePicker();
            const dropdown = document.getElementById('avatar-dropdown');
            if (dropdown) dropdown.classList.toggle('open');
        });
    }

    // Logout button inside dropdown
    const logoutBtn = document.getElementById('avatar-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await signOut();
            isLoggedIn = false;
            if (typeof ProjectManager !== 'undefined') {
                await ProjectManager.setUserId('guest');
            }
            updateAvatarState(null);
            updateRecentsVisibility();
            initializeProjectCards(); // reload — guest sees no projects
            const dropdown = document.getElementById('avatar-dropdown');
            if (dropdown) dropdown.classList.remove('open');
        });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
        const dropdown = document.getElementById('avatar-dropdown');
        if (dropdown) dropdown.classList.remove('open');
    });
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
            return; // picker is handling this event
        }

        // Cmd/Ctrl + Enter → Send
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            handleGenerate();
            return;
        }
        // Plain Enter → insert newline (default contenteditable behaviour, no override needed)
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
        ${MODELS.map(m => `
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
    if (!isLoggedIn) {
        showAuthModal();
        return;
    }

    const editor = document.getElementById('input-editor');
    const text = editor ? editor.textContent.trim() : '';

    if (!text && uploadedImages.length === 0) {
        showNotification('Please enter your ideas or upload images');
        return;
    }

    // Create a new project and store the prompt for the canvas to pick up
    const projectId = ProjectManager.generateId();
    localStorage.setItem('aime_autostart_' + projectId, JSON.stringify({ text, ts: Date.now() }));

    // Open canvas with autoGen flag — canvas.js will create a 1:1 Frame and start generation
    window.open('canvas.html?id=' + projectId + '&autoGen=1', '_blank');
}

// ==================== Project Cards ====================
async function initializeProjectCards() {
    const grid = document.getElementById('recents-grid');
    if (!grid || typeof ProjectManager === 'undefined') return;

    const projects = await ProjectManager.getAll();

    if (projects.length === 0) {
        grid.innerHTML = '<p class="no-projects-hint">Your projects will appear here.</p>';
        return;
    }

    grid.innerHTML = '';
    projects.forEach(project => {
        const card = document.createElement('div');
        card.className = 'project-card';
        card.dataset.id = project.id;

        const timeStr = typeof formatProjectTime === 'function'
            ? formatProjectTime(project.updatedAt)
            : new Date(project.updatedAt).toLocaleDateString();

        const thumbHtml = project.thumbnail
            ? `<img src="${project.thumbnail}" alt="${escapeHtml(project.name)}" loading="lazy" decoding="async">`
            : `<div class="project-thumb-empty"></div>`;

        card.innerHTML = `
            <div class="project-thumb">${thumbHtml}</div>
            <div class="project-info">
                <h3 class="project-card-name" title="Click to rename">${escapeHtml(project.name || 'Untitled Project')}</h3>
                <p>${timeStr}</p>
            </div>
            <button class="project-delete-btn" title="Delete project" aria-label="Delete">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
            </button>`;

        // Open project on click (but not on name or delete btn clicks)
        card.addEventListener('click', (e) => {
            if (e.target.closest('.project-delete-btn') || e.target.closest('.project-card-name')) return;
            window.open('canvas.html?id=' + project.id, '_blank');
        });

        // Inline name editing
        const nameEl = card.querySelector('.project-card-name');
        nameEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'project-name-input';
            input.value = project.name || 'Untitled Project';
            nameEl.replaceWith(input);
            input.focus();
            input.select();

            async function commitRename() {
                const newName = input.value.trim() || 'Untitled Project';
                await ProjectManager.rename(project.id, newName);
                initializeProjectCards();
            }

            input.addEventListener('blur', commitRename);
            input.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
                if (ev.key === 'Escape') {
                    input.value = project.name || 'Untitled Project';
                    input.blur();
                }
            });
        });

        // Delete on hover button
        const deleteBtn = card.querySelector('.project-delete-btn');
        deleteBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (confirm(`Delete "${project.name || 'Untitled Project'}"? This cannot be undone.`)) {
                await ProjectManager.delete(project.id);
                initializeProjectCards();
            }
        });

        grid.appendChild(card);
    });
}

function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
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
    // Mutually exclusive: close avatar dropdown
    const avatarDd = document.getElementById('avatar-dropdown');
    if (avatarDd) avatarDd.classList.remove('open');

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

// ==================== Auth Modal ====================
function initializeAuthModal() {
    const overlay = document.getElementById('auth-modal-overlay');
    const closeBtn = document.getElementById('auth-modal-close');
    const backBtn = document.getElementById('auth-back-btn');
    const googleBtn = document.getElementById('auth-google-btn');
    const appleBtn = document.getElementById('auth-apple-btn');
    const emailContinueBtn = document.getElementById('auth-email-continue-btn');
    const emailInput = document.getElementById('auth-email-input');
    const resendBtn = document.getElementById('auth-resend-btn');

    // Listen for real auth state changes (e.g. after OAuth redirect)
    if (typeof onAuthStateChange === 'function') {
        onAuthStateChange(({ loggedIn, user }) => {
            if (loggedIn) {
                completeLogin(user);
            }
        });
    }

    // Close on overlay click
    if (overlay) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) hideAuthModal();
        });
    }

    // Close button
    if (closeBtn) {
        closeBtn.addEventListener('click', hideAuthModal);
    }

    // Back button (OTP → Login)
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            showAuthPage('login');
            clearOtpCountdown();
        });
    }

    // Google login
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            setAuthLoading(googleBtn, true);
            const { error } = await signInWithGoogle();
            if (error) {
                if (error.message === 'not_configured') {
                    // Dev mode: simulate login
                    completeLogin({ email: 'demo@example.com', provider: 'google' });
                } else {
                    showAuthError(error.message || 'Google 登录失败，请重试');
                }
            }
            setAuthLoading(googleBtn, false);
        });
    }

    // Apple login
    if (appleBtn) {
        appleBtn.addEventListener('click', async () => {
            setAuthLoading(appleBtn, true);
            const { error } = await signInWithApple();
            if (error) {
                if (error.message === 'not_configured') {
                    completeLogin({ email: 'demo@example.com', provider: 'apple' });
                } else {
                    showAuthError(error.message || 'Apple 登录失败，请重试');
                }
            }
            setAuthLoading(appleBtn, false);
        });
    }

    // Email continue
    if (emailContinueBtn) {
        emailContinueBtn.addEventListener('click', async () => {
            const email = emailInput ? emailInput.value.trim() : '';
            if (!email || !isValidEmail(email)) {
                if (emailInput) {
                    emailInput.focus();
                    emailInput.style.borderColor = '#E53E3E';
                    setTimeout(() => { emailInput.style.borderColor = ''; }, 1500);
                }
                return;
            }

            setAuthLoading(emailContinueBtn, true);
            const { error, simulated } = await sendEmailOTP(email);
            setAuthLoading(emailContinueBtn, false);

            if (error) {
                showAuthError(error.message || '发送失败，请检查邮箱地址');
                return;
            }

            // Store email for OTP verification
            emailContinueBtn.dataset.pendingEmail = email;
            showOtpPage(email, simulated);
        });
    }

    // Email input enter key
    if (emailInput) {
        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') emailContinueBtn && emailContinueBtn.click();
        });
        emailInput.addEventListener('input', () => {
            emailInput.style.borderColor = '';
            const errorEl = document.getElementById('auth-error-msg');
            if (errorEl) errorEl.remove();
        });
    }

    // Resend button
    if (resendBtn) {
        resendBtn.addEventListener('click', async () => {
            const emailContinueBtn = document.getElementById('auth-email-continue-btn');
            const email = emailContinueBtn ? emailContinueBtn.dataset.pendingEmail : '';
            if (email) {
                resendBtn.disabled = true;
                await sendEmailOTP(email);
                resendBtn.disabled = false;
            }
            startOtpCountdown();
            resendBtn.style.display = 'none';
            document.getElementById('auth-resend-text').style.display = '';
        });
    }

    // OTP digit inputs
    initializeOtpInputs();

    // Escape key close
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const overlay = document.getElementById('auth-modal-overlay');
            if (overlay && overlay.classList.contains('active')) {
                hideAuthModal();
            }
        }
    });
}

function showAuthModal() {
    const overlay = document.getElementById('auth-modal-overlay');
    if (!overlay) return;
    showAuthPage('login');
    overlay.classList.add('active');
    // Focus email input
    setTimeout(() => {
        const emailInput = document.getElementById('auth-email-input');
        if (emailInput) emailInput.focus();
    }, 250);
}

function hideAuthModal() {
    const overlay = document.getElementById('auth-modal-overlay');
    if (overlay) overlay.classList.remove('active');
    clearOtpCountdown();
    // Reset email input
    const emailInput = document.getElementById('auth-email-input');
    if (emailInput) emailInput.value = '';
    // Clear OTP digits
    document.querySelectorAll('.auth-otp-digit').forEach(inp => {
        inp.value = '';
        inp.classList.remove('filled');
    });
}

function showAuthPage(page) {
    const loginPage = document.getElementById('auth-page-login');
    const otpPage = document.getElementById('auth-page-otp');
    if (page === 'login') {
        loginPage && loginPage.classList.remove('auth-page-hidden');
        otpPage && otpPage.classList.add('auth-page-hidden');
    } else {
        loginPage && loginPage.classList.add('auth-page-hidden');
        otpPage && otpPage.classList.remove('auth-page-hidden');
    }
}

function showOtpPage(email, simulated = false) {
    const otpEmail = document.getElementById('auth-otp-email');
    if (otpEmail) otpEmail.textContent = email;

    // Store pending email on OTP page for verification
    const otpPage = document.getElementById('auth-page-otp');
    if (otpPage) otpPage.dataset.pendingEmail = email;

    showAuthPage('otp');

    // Show simulated mode hint in dev
    if (simulated) {
        const desc = document.querySelector('.auth-otp-desc');
        if (desc && !desc.querySelector('.dev-hint')) {
            const hint = document.createElement('span');
            hint.className = 'dev-hint';
            hint.style.cssText = 'display:block;margin-top:8px;font-size:11px;color:#F59E0B;background:rgba(245,158,11,0.1);padding:4px 8px;border-radius:6px;';
            hint.textContent = '⚠️  Dev 模式：输入任意6位数字即可通过验证';
            desc.appendChild(hint);
        }
    }

    startOtpCountdown();
    // Clear previous inputs
    document.querySelectorAll('.auth-otp-digit').forEach(inp => {
        inp.value = '';
        inp.classList.remove('filled', 'error');
    });
    // Focus first input
    setTimeout(() => {
        const first = document.querySelector('.auth-otp-digit');
        if (first) first.focus();
    }, 100);
}

function startOtpCountdown() {
    clearOtpCountdown();
    let seconds = 60;
    const countdownEl = document.getElementById('auth-countdown');
    const resendText = document.getElementById('auth-resend-text');
    const resendBtn = document.getElementById('auth-resend-btn');
    if (countdownEl) countdownEl.textContent = seconds;
    if (resendText) resendText.style.display = '';
    if (resendBtn) resendBtn.style.display = 'none';

    otpCountdownTimer = setInterval(() => {
        seconds--;
        if (countdownEl) countdownEl.textContent = seconds;
        if (seconds <= 0) {
            clearOtpCountdown();
            if (resendText) resendText.style.display = 'none';
            if (resendBtn) resendBtn.style.display = 'block';
        }
    }, 1000);
}

function clearOtpCountdown() {
    if (otpCountdownTimer) {
        clearInterval(otpCountdownTimer);
        otpCountdownTimer = null;
    }
}

function initializeOtpInputs() {
    const inputs = document.querySelectorAll('.auth-otp-digit');
    inputs.forEach((input, index) => {
        input.addEventListener('input', (e) => {
            const val = e.target.value.replace(/\D/g, '');
            e.target.value = val ? val[0] : '';
            if (val) {
                e.target.classList.add('filled');
                if (index < inputs.length - 1) {
                    inputs[index + 1].focus();
                } else {
                    // All filled - auto verify
                    checkOtpComplete(inputs);
                }
            } else {
                e.target.classList.remove('filled');
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !e.target.value && index > 0) {
                inputs[index - 1].focus();
                inputs[index - 1].value = '';
                inputs[index - 1].classList.remove('filled');
            }
        });

        input.addEventListener('paste', (e) => {
            e.preventDefault();
            const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            pasted.split('').forEach((char, i) => {
                if (index + i < inputs.length) {
                    inputs[index + i].value = char;
                    inputs[index + i].classList.add('filled');
                }
            });
            const nextIndex = Math.min(index + pasted.length, inputs.length - 1);
            inputs[nextIndex].focus();
            checkOtpComplete(inputs);
        });
    });
}

async function checkOtpComplete(inputs) {
    const code = Array.from(inputs).map(i => i.value).join('');
    if (code.length !== 6) return;

    const otpPage = document.getElementById('auth-page-otp');
    const email = otpPage ? otpPage.dataset.pendingEmail : '';
    if (!email) return;

    // Show loading state on inputs
    inputs.forEach(inp => { inp.disabled = true; });

    const { data, error, simulated } = await verifyEmailOTP(email, code);

    inputs.forEach(inp => { inp.disabled = false; });

    if (error) {
        // Shake + highlight error
        inputs.forEach(inp => inp.classList.add('error'));
        setTimeout(() => inputs.forEach(inp => inp.classList.remove('error')), 600);
        showAuthError(error.message || '验证码错误，请重新输入');
        // Clear inputs and refocus
        inputs.forEach(inp => { inp.value = ''; inp.classList.remove('filled'); });
        inputs[0].focus();
        return;
    }

    const user = data?.user || { email };
    completeLogin(user);
}

async function completeLogin(user = null) {
    isLoggedIn = true;
    const userId = user?.id || 'authenticated';
    if (typeof ProjectManager !== 'undefined') {
        await ProjectManager.setUserId(userId);
    }
    hideAuthModal();
    updateRecentsVisibility();
    updateAvatarState(user);
    initializeProjectCards();
}

function updateAvatarState(user = null) {
    const loginBtn = document.getElementById('header-login-btn');
    const avatarWrapper = document.getElementById('avatar-wrapper');
    const avatarImg = document.getElementById('user-avatar-img');
    const dropdownAvatarImg = document.getElementById('dropdown-avatar-img');
    const dropdownEmail = document.getElementById('dropdown-user-email');

    if (isLoggedIn) {
        if (loginBtn) loginBtn.style.display = 'none';
        if (avatarWrapper) avatarWrapper.style.display = '';

        // Use provider avatar if available
        const avatarUrl = user?.user_metadata?.avatar_url || user?.user_metadata?.picture;
        const email = user?.email || '';
        if (avatarUrl) {
            if (avatarImg) { avatarImg.src = avatarUrl; avatarImg.alt = email; }
            if (dropdownAvatarImg) { dropdownAvatarImg.src = avatarUrl; dropdownAvatarImg.alt = email; }
        }
        if (dropdownEmail) dropdownEmail.textContent = email;
    } else {
        if (loginBtn) loginBtn.style.display = '';
        if (avatarWrapper) avatarWrapper.style.display = 'none';
    }
}

function setAuthLoading(btn, loading) {
    if (!btn) return;
    btn.disabled = loading;
    btn.style.opacity = loading ? '0.7' : '';
    btn.style.cursor = loading ? 'wait' : '';
}

function showAuthError(message) {
    // Remove old error
    const old = document.getElementById('auth-error-msg');
    if (old) old.remove();

    const activePageId = document.getElementById('auth-page-otp').classList.contains('auth-page-hidden')
        ? 'auth-page-login' : 'auth-page-otp';
    const page = document.getElementById(activePageId);
    if (!page) return;

    const err = document.createElement('p');
    err.id = 'auth-error-msg';
    err.style.cssText = 'color:#E53E3E;font-size:13px;text-align:center;margin-top:8px;animation:fadeIn 0.2s ease;';
    err.textContent = message;
    page.appendChild(err);
    setTimeout(() => err.remove(), 4000);
}

function updateRecentsVisibility() {
    const recentsGrid = document.getElementById('recents-grid');
    if (!recentsGrid) return;
    if (isLoggedIn) {
        recentsGrid.style.display = '';
        const placeholder = document.getElementById('recents-placeholder');
        if (placeholder) placeholder.style.display = 'none';
    } else {
        recentsGrid.style.display = 'none';
        const placeholder = document.getElementById('recents-placeholder');
        if (placeholder) placeholder.style.display = 'flex';
    }
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ==================== Cross-tab Auth Sync ====================
function initCrossTabAuthSync() {
    if (typeof listenForAuthBroadcast !== 'function') return;

    listenForAuthBroadcast(({ event, userId, userEmail }) => {
        if (event === 'SIGNED_IN') {
            if (!isLoggedIn) {
                window.location.reload();
            } else if (typeof ProjectManager !== 'undefined' &&
                       ProjectManager.getUserId() !== userId) {
                ProjectManager.setUserId(userId || 'authenticated').then(() => {
                    updateRecentsVisibility();
                    initializeProjectCards();
                    showNotification('Account changed — projects updated');
                });
            }
        } else if (event === 'SIGNED_OUT') {
            if (isLoggedIn) {
                isLoggedIn = false;
                if (typeof ProjectManager !== 'undefined') {
                    ProjectManager.setUserId('guest').then(() => {
                        updateAvatarState(null);
                        updateRecentsVisibility();
                        initializeProjectCards();
                        showNotification('Signed out from another tab');
                    });
                }
            }
        }
    });
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
