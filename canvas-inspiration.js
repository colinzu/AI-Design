/**
 * Canvas Inspiration Panel
 * Provides image search via Unsplash and Giphy.
 * - Opens from left sidebar "Inspiration" button
 * - Auto-loads popular content on first open
 * - When user selects an image on canvas and opens inspiration,
 *   it auto-detects the image intent via Gemini and searches for similar content
 * - Category tabs map to search keywords
 * - Click any result to add it to the canvas
 */

(function () {
    // ==================== State ====================
    const inspState = {
        isOpen: false,
        activeSource: 'unsplash', // 'unsplash' | 'giphy'
        activeCategory: 'all',
        query: '',
        page: 1,
        offset: 0,
        hasMore: true,
        isLoading: false,
        results: [],
        intentQuery: null,
        isDetectingIntent: false,
        hasLoadedInitial: false, // Track if we loaded default content
    };

    const PER_PAGE = 30;

    // Category → search keyword mapping
    const CATEGORY_KEYWORDS = {
        'all': '',
        'social': 'social media design',
        'effects': 'visual effects graphic',
        'posters': 'poster design',
        'post': 'instagram post design',
    };

    // ==================== Initialization ====================
    function initInspirationPanel() {
        const engine = window.canvasEngine;
        if (!engine) {
            console.warn('[inspiration] Canvas engine not available');
            return;
        }

        setupEventListeners();
        console.log('[inspiration] Inspiration panel initialized');
    }

    function setupEventListeners() {
        const panel = document.getElementById('inspiration-panel');
        const searchInput = document.getElementById('insp-search');
        const searchClear = document.getElementById('insp-search-clear');
        const collapseBtn = document.getElementById('insp-collapse-btn');
        const loadMoreBtn = document.getElementById('insp-load-more');

        // Sidebar button
        const sidebarBtn = document.querySelector('.sidebar-btn[data-action="inspiration"]');
        if (sidebarBtn) {
            sidebarBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                togglePanel();
            });
        }

        // Collapse button (closes panel)
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => closePanel());
        }

        // Search input with debounce
        let searchTimer = null;
        searchInput.addEventListener('input', () => {
            const val = searchInput.value.trim();
            searchClear.classList.toggle('hidden', val.length === 0);

            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                inspState.query = val;
                inspState.intentQuery = null;
                // Reset category to "all" when user types
                setActiveCategory('all');
                resetAndSearch();
            }, 400);
        });

        // Search clear
        searchClear.addEventListener('click', () => {
            searchInput.value = '';
            searchClear.classList.add('hidden');
            inspState.query = '';
            inspState.intentQuery = null;
            resetAndSearch();
        });

        // Enter key for instant search
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                clearTimeout(searchTimer);
                inspState.query = searchInput.value.trim();
                inspState.intentQuery = null;
                resetAndSearch();
            }
        });

        // Category tabs
        const catTabs = document.getElementById('insp-category-tabs');
        if (catTabs) {
            catTabs.addEventListener('click', (e) => {
                const cat = e.target.closest('.insp-cat');
                if (!cat) return;

                setActiveCategory(cat.dataset.category);

                // Build search query from category
                const keyword = CATEGORY_KEYWORDS[cat.dataset.category] || '';
                inspState.query = keyword;
                inspState.intentQuery = null;

                // Clear search input to show we're in category mode
                searchInput.value = '';
                searchClear.classList.add('hidden');

                resetAndSearch();
            });
        }

        // Load more
        const loadMoreButton = loadMoreBtn.querySelector('.insp-load-more-btn');
        if (loadMoreButton) {
            loadMoreButton.addEventListener('click', () => loadMore());
        }

        // Infinite scroll
        const resultsEl = document.getElementById('insp-results');
        resultsEl.addEventListener('scroll', () => {
            if (inspState.isLoading || !inspState.hasMore) return;
            const { scrollTop, scrollHeight, clientHeight } = resultsEl;
            if (scrollHeight - scrollTop - clientHeight < 200) {
                loadMore();
            }
        });

        // Prevent canvas interactions
        panel.addEventListener('mousedown', (e) => e.stopPropagation());
        panel.addEventListener('pointerdown', (e) => e.stopPropagation());
        panel.addEventListener('wheel', (e) => e.stopPropagation());

        // Close on outside click
        document.addEventListener('click', (e) => {
            if (!inspState.isOpen) return;
            if (panel.contains(e.target)) return;
            const sb = document.querySelector('.sidebar-btn[data-action="inspiration"]');
            if (sb && sb.contains(e.target)) return;
            closePanel();
        });
    }

    function setActiveCategory(category) {
        inspState.activeCategory = category;
        const tabs = document.querySelectorAll('.insp-cat');
        tabs.forEach(t => {
            t.classList.toggle('active', t.dataset.category === category);
        });
    }

    // ==================== Panel Open / Close ====================
    function togglePanel() {
        if (inspState.isOpen) {
            closePanel();
        } else {
            openPanel();
        }
    }

    function openPanel() {
        const panel = document.getElementById('inspiration-panel');
        const sidebarBtn = document.querySelector('.sidebar-btn[data-action="inspiration"]');

        // Close layers panel if open (mutual exclusion — sidebar is a tab switcher)
        const layersPanel = document.getElementById('layers-panel');
        if (layersPanel && !layersPanel.classList.contains('hidden')) {
            layersPanel.classList.add('hidden');
            document.body.classList.remove('layers-open');
            const layersBtn = document.querySelector('.sidebar-btn[data-action="layers"]');
            if (layersBtn) layersBtn.classList.remove('active');
        }
        // Clear all other sidebar active states first
        document.querySelectorAll('.sidebar-btn').forEach(b => b.classList.remove('active'));

        panel.classList.remove('hidden');
        inspState.isOpen = true;
        document.body.classList.add('insp-open');

        if (sidebarBtn) {
            sidebarBtn.classList.add('active');
            sidebarBtn.removeAttribute('title'); // Hide native tooltip when panel is open
        }

        // Populate recents on first open
        populateRecents();

        // Check if an image is selected on canvas → auto-detect intent
        const engine = window.canvasEngine;
        if (engine) {
            const selectedImage = engine.selectedElements.find(el => el.type === 'image' && el.src);
            if (selectedImage) {
                // Always detect intent when an image is selected, even if we have results
                detectImageIntent(selectedImage);
                return;
            }
        }

        // No image selected — load default content if not loaded yet
        if (!inspState.hasLoadedInitial) {
            inspState.hasLoadedInitial = true;
            resetAndSearch();
        }
    }

    // Populate recents from canvas images (on first open)
    function populateRecents() {
        const section = document.getElementById('insp-recents-section');
        const scrollContainer = document.getElementById('insp-recents-scroll');
        if (!scrollContainer || !section || scrollContainer.children.length > 0) return;

        // Seed recents from images already on canvas
        const engine = window.canvasEngine;
        if (engine && engine.elements) {
            const canvasImages = engine.elements
                .filter(el => el.type === 'image' && el.src)
                .slice(-6)
                .reverse();

            if (canvasImages.length > 0) {
                canvasImages.forEach(img => {
                    const item = document.createElement('div');
                    item.className = 'insp-recent-item';
                    const imgEl = document.createElement('img');
                    imgEl.src = img.src;
                    imgEl.alt = '';
                    imgEl.loading = 'lazy';
                    imgEl.draggable = false;
                    item.appendChild(imgEl);
                    scrollContainer.appendChild(item);
                });
                section.classList.add('has-items');
            }
        }
    }

    function closePanel() {
        const panel = document.getElementById('inspiration-panel');
        const sidebarBtn = document.querySelector('.sidebar-btn[data-action="inspiration"]');

        panel.classList.add('hidden');
        inspState.isOpen = false;
        document.body.classList.remove('insp-open');

        if (sidebarBtn) {
            sidebarBtn.classList.remove('active');
            sidebarBtn.setAttribute('title', 'Inspiration'); // Restore tooltip when panel closed
        }

        // Hide intent icon
        const intentIcon = document.getElementById('insp-intent-icon');
        if (intentIcon) intentIcon.classList.add('hidden');
    }

    // ==================== Image Intent Detection ====================
    async function detectImageIntent(imageElement) {
        if (inspState.isDetectingIntent) return;
        inspState.isDetectingIntent = true;

        const searchIcon = document.querySelector('.insp-search-icon');
        const intentIcon = document.getElementById('insp-intent-icon');
        const searchInput = document.getElementById('insp-search');

        // Show intent icon, hide search icon
        searchIcon.classList.add('hidden');
        intentIcon.classList.remove('hidden');
        searchInput.placeholder = 'Analyzing image...';

        try {
            // Get image data
            let imageData = imageElement.src;

            // If the src is not a data URL, render element to canvas to get one
            if (!imageData || !imageData.startsWith('data:')) {
                imageData = await elementToDataUrl(imageElement);
            }

            if (!imageData) {
                throw new Error('Could not get image data');
            }

            // Call Gemini to describe the image
            const response = await fetch('/api/describe-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageData })
            });

            if (!response.ok) {
                throw new Error('Failed to analyze image');
            }

            const data = await response.json();

            // Extract keywords from Gemini response
            let keywords = '';
            const candidates = data.candidates || [];
            for (const candidate of candidates) {
                const parts = candidate?.content?.parts || [];
                for (const part of parts) {
                    if (part.text) {
                        keywords = part.text.trim();
                        break;
                    }
                }
                if (keywords) break;
            }

            if (keywords) {
                inspState.intentQuery = keywords;
                inspState.query = keywords;
                searchInput.value = keywords;
                searchInput.placeholder = 'Search inspiration...';
                document.getElementById('insp-search-clear').classList.remove('hidden');
                setActiveCategory('all');
                resetAndSearch();
            } else {
                searchInput.placeholder = 'Search inspiration...';
                if (!inspState.hasLoadedInitial) {
                    inspState.hasLoadedInitial = true;
                    resetAndSearch();
                }
            }
        } catch (err) {
            console.warn('[inspiration] Intent detection failed:', err);
            searchInput.placeholder = 'Search inspiration...';
            // Fall back to loading default content
            if (!inspState.hasLoadedInitial) {
                inspState.hasLoadedInitial = true;
                resetAndSearch();
            }
        } finally {
            inspState.isDetectingIntent = false;
            // Restore search icon, hide intent icon
            searchIcon.classList.remove('hidden');
            intentIcon.classList.add('hidden');
        }
    }

    function elementToDataUrl(element) {
        return new Promise((resolve) => {
            if (element.image) {
                const tempCanvas = document.createElement('canvas');
                const maxSize = 512;
                let w = element.image.naturalWidth || element.width;
                let h = element.image.naturalHeight || element.height;

                if (w > maxSize || h > maxSize) {
                    const ratio = Math.min(maxSize / w, maxSize / h);
                    w = Math.round(w * ratio);
                    h = Math.round(h * ratio);
                }

                tempCanvas.width = w;
                tempCanvas.height = h;
                const ctx = tempCanvas.getContext('2d');
                try {
                    ctx.drawImage(element.image, 0, 0, w, h);
                    resolve(tempCanvas.toDataURL('image/jpeg', 0.7));
                } catch (e) {
                    // CORS or tainted canvas
                    console.warn('[inspiration] Cannot convert image to data URL:', e);
                    resolve('');
                }
            } else {
                resolve('');
            }
        });
    }

    // ==================== Search & Data Fetching ====================
    function resetAndSearch() {
        inspState.page = 1;
        inspState.offset = 0;
        inspState.hasMore = true;
        inspState.results = [];

        const grid = document.getElementById('insp-grid');
        grid.innerHTML = '';

        fetchResults();
    }

    function loadMore() {
        if (inspState.isLoading || !inspState.hasMore) return;

        if (inspState.activeSource === 'unsplash') {
            inspState.page++;
        } else {
            inspState.offset += PER_PAGE;
        }

        fetchResults();
    }

    async function fetchResults() {
        if (inspState.isLoading) return;
        inspState.isLoading = true;

        const loading = document.getElementById('insp-loading');
        const empty = document.getElementById('insp-empty');
        const loadMoreEl = document.getElementById('insp-load-more');

        loading.classList.remove('hidden');
        empty.classList.add('hidden');
        loadMoreEl.classList.add('hidden');

        const query = inspState.query;

        try {
            let items = [];

            if (inspState.activeSource === 'unsplash') {
                items = await fetchUnsplash(query, inspState.page);
            } else if (inspState.activeSource === 'giphy') {
                items = await fetchGiphy(query, inspState.offset);
            }

            inspState.results = inspState.results.concat(items);
            inspState.hasMore = items.length >= PER_PAGE;

            renderResults(items, false);

            if (inspState.results.length === 0) {
                empty.classList.remove('hidden');
            }

            if (inspState.hasMore && inspState.results.length > 0) {
                loadMoreEl.classList.remove('hidden');
            }
        } catch (err) {
            console.error('[inspiration] Fetch failed:', err);
            if (inspState.results.length === 0) {
                empty.classList.remove('hidden');
            }
        } finally {
            inspState.isLoading = false;
            loading.classList.add('hidden');
        }
    }

    async function fetchUnsplash(query, page) {
        const params = new URLSearchParams({ page, per_page: PER_PAGE });

        // Only add query param when there's an actual search term
        // Empty query → popular/editorial endpoint (no query param)
        if (query && query.trim().length > 0) {
            params.set('query', query.trim());
        }

        const resp = await fetch('/api/unsplash?' + params.toString());
        if (!resp.ok) throw new Error('Unsplash API error: ' + resp.status);

        const data = await resp.json();

        // search returns { results: [...] }, browse returns [...]
        const photos = data.results || data;
        if (!Array.isArray(photos)) return [];

        return photos.map(photo => ({
            id: photo.id,
            source: 'unsplash',
            thumbUrl: photo.urls?.small || photo.urls?.thumb,
            fullUrl: photo.urls?.regular || photo.urls?.small,  // regular ~1080px, loads fast
            width: photo.width,
            height: photo.height,
            alt: photo.alt_description || photo.description || '',
            author: photo.user?.name || '',
        }));
    }

    async function fetchGiphy(query, offset) {
        const params = new URLSearchParams({ offset, limit: PER_PAGE });
        if (query && query.trim().length > 0) {
            params.set('query', query.trim());
        }

        const resp = await fetch('/api/giphy?' + params.toString());
        if (!resp.ok) throw new Error('Giphy API error: ' + resp.status);

        const data = await resp.json();
        const gifs = data.data || [];

        return gifs.map(gif => ({
            id: gif.id,
            source: 'giphy',
            thumbUrl: gif.images?.fixed_width?.url || gif.images?.preview_gif?.url,
            fullUrl: gif.images?.original?.url,
            width: parseInt(gif.images?.original?.width) || 300,
            height: parseInt(gif.images?.original?.height) || 300,
            alt: gif.title || '',
            author: gif.user?.display_name || '',
        }));
    }

    // ==================== Rendering ====================
    function renderResults(newItems, replace) {
        const grid = document.getElementById('insp-grid');

        if (replace) {
            grid.innerHTML = '';
        }

        newItems.forEach(item => {
            const div = document.createElement('div');
            div.className = 'insp-grid-item';

            const img = document.createElement('img');
            img.src = item.thumbUrl;
            img.alt = item.alt;
            img.loading = 'lazy';
            img.draggable = false;

            const overlay = document.createElement('div');
            overlay.className = 'insp-img-overlay';
            if (item.author) {
                overlay.innerHTML = '<span>' + escapeHtml(item.author) + '</span>';
            }

            div.appendChild(img);
            div.appendChild(overlay);

            // Click to add to canvas
            div.addEventListener('click', () => {
                addToCanvas(item);
            });

            grid.appendChild(div);
        });
    }

    // ==================== Recents Management ====================
    function addToRecents(item) {
        const section = document.getElementById('insp-recents-section');
        const scrollContainer = document.getElementById('insp-recents-scroll');
        if (!scrollContainer || !section) return;

        // Avoid duplicates
        const existing = scrollContainer.querySelector(`[data-recent-id="${item.id}"]`);
        if (existing) return;

        const div = document.createElement('div');
        div.className = 'insp-recent-item';
        div.dataset.recentId = item.id;

        const img = document.createElement('img');
        img.src = item.thumbUrl;
        img.alt = item.alt || '';
        img.loading = 'lazy';
        img.draggable = false;

        div.appendChild(img);
        div.addEventListener('click', () => addToCanvas(item));

        // Insert at the beginning (most recent first)
        scrollContainer.insertBefore(div, scrollContainer.firstChild);

        // Show the recents section
        section.classList.add('has-items');

        // Keep max 10 recent items
        while (scrollContainer.children.length > 10) {
            scrollContainer.removeChild(scrollContainer.lastChild);
        }
    }

    // ==================== Add to Canvas ====================
    function addToCanvas(item) {
        const engine = window.canvasEngine;
        if (!engine) return;

        const url = item.fullUrl;
        if (!url) return;

        // Add to recents
        addToRecents(item);

        showAddFeedback();

        const img = new Image();
        img.crossOrigin = 'anonymous';

        img.onload = () => {
            engine.saveState();

            let x, y, w, h;
            const selectedFrame = engine.selectedElements.find(el => el.type === 'frame');

            if (selectedFrame) {
                // Add image into frame (cover-fit, centered) — keep existing children
                const frameAspect = selectedFrame.width / selectedFrame.height;
                const imgAspect = img.naturalWidth / img.naturalHeight;

                if (imgAspect > frameAspect) {
                    h = selectedFrame.height;
                    w = h * imgAspect;
                } else {
                    w = selectedFrame.width;
                    h = w / imgAspect;
                }
                x = selectedFrame.x + (selectedFrame.width - w) / 2;
                y = selectedFrame.y + (selectedFrame.height - h) / 2;
            } else {
                // Place at next grid position (8-col, 30px gap).
                // Cap resolution to ~2K (2048px on the long side) to keep the canvas
                // performant — very large source images (4K, 8K) would slow rendering.
                const MAX_SIDE = 2048;
                w = img.naturalWidth;
                h = img.naturalHeight;
                if (w > MAX_SIDE || h > MAX_SIDE) {
                    const scale = MAX_SIDE / Math.max(w, h);
                    w = Math.round(w * scale);
                    h = Math.round(h * scale);
                }

                const pos = engine.getNextGridPosition(w, h, 30);
                x = pos.x;
                y = pos.y;
            }

            const element = {
                type: 'image',
                x: x,
                y: y,
                width: w,
                height: h,
                image: img,
                src: url,
            };

            // Attach to frame if placed inside one
            if (selectedFrame) {
                element.parentFrame = selectedFrame;
            }

            engine.elements.push(element);
            engine.selectedElements = [element];

            // Scroll canvas so new image is centered on screen (unless placed into a frame)
            if (!selectedFrame) {
                engine.scrollToCenter(x, y, w, h);
            }
            engine.render();

            if (engine.onSelectionChange) {
                engine.onSelectionChange(engine.selectedElements);
            }

            // Auto-describe image for layer naming
            if (window.GenPanel && window.GenPanel.describeImageElement) {
                window.GenPanel.describeImageElement(element);
            }
        };

        img.onerror = () => {
            console.warn('[inspiration] Failed to load image:', url);
            showNotification('Failed to load image');
        };

        img.src = url;
    }

    function showAddFeedback() {
        // Brief highlight flash on the clicked item (handled by CSS :active),
        // plus a subtle toast
        showNotification('Added to canvas');
    }

    // ==================== Utilities ====================
    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function showNotification(message) {
        const existing = document.querySelector('.toast-notification');
        if (existing) existing.remove();

        const toast = document.createElement('div');
        toast.className = 'toast-notification';
        toast.style.cssText = 'position:fixed;top:80px;right:24px;background:#090C14;color:white;padding:12px 20px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);z-index:10000;font-size:14px;font-weight:500;animation:slideIn 0.3s ease;max-width:400px;';
        toast.textContent = message;
        document.body.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 3000);
    }

    // Expose public API for cross-panel coordination
    window.InspPanel = {
        close: closePanel,
        isOpen: () => inspState.isOpen,
    };

    // ==================== Bootstrap ====================
    function waitForEngine() {
        if (window.canvasEngine) {
            initInspirationPanel();
        } else {
            requestAnimationFrame(waitForEngine);
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        waitForEngine();
    });
})();
