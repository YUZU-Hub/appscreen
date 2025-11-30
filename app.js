// State management
const state = {
    screenshots: [],
    selectedIndex: 0,
    outputDevice: 'iphone-6.9',
    customWidth: 1290,
    customHeight: 2796,
    use3D: false,
    rotation3D: { x: 0, y: 0, z: 0 },
    scale3D: 100,
    background: {
        type: 'gradient',
        gradient: {
            angle: 135,
            stops: [
                { color: '#667eea', position: 0 },
                { color: '#764ba2', position: 100 }
            ]
        },
        solid: '#1a1a2e',
        image: null,
        imageFit: 'cover',
        imageBlur: 0,
        overlayColor: '#000000',
        overlayOpacity: 0,
        noise: false,
        noiseIntensity: 10
    },
    screenshot: {
        scale: 70,
        y: 55,
        x: 50,
        rotation: 0,
        perspective: 0,
        cornerRadius: 24,
        shadow: {
            enabled: true,
            color: '#000000',
            blur: 40,
            opacity: 30,
            x: 0,
            y: 20
        },
        frame: {
            enabled: false,
            style: 'iphone-15-pro',
            color: '#1d1d1f',
            width: 12,
            opacity: 100
        }
    },
    text: {
        headlines: { en: '' },
        headlineLanguages: ['en'],
        currentHeadlineLang: 'en',
        headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        headlineSize: 100,
        headlineWeight: '600',
        headlineColor: '#ffffff',
        position: 'top',
        offsetY: 12,
        lineHeight: 110,
        subheadlines: { en: '' },
        subheadlineLanguages: ['en'],
        currentSubheadlineLang: 'en',
        subheadlineSize: 50,
        subheadlineColor: '#ffffff',
        subheadlineOpacity: 70
    }
};

// Language flags mapping
const languageFlags = {
    'en': '🇺🇸', 'en-gb': '🇬🇧', 'de': '🇩🇪', 'fr': '🇫🇷', 'es': '🇪🇸',
    'it': '🇮🇹', 'pt': '🇵🇹', 'pt-br': '🇧🇷', 'nl': '🇳🇱', 'ru': '🇷🇺',
    'ja': '🇯🇵', 'ko': '🇰🇷', 'zh': '🇨🇳', 'zh-tw': '🇹🇼', 'ar': '🇸🇦',
    'hi': '🇮🇳', 'tr': '🇹🇷', 'pl': '🇵🇱', 'sv': '🇸🇪', 'da': '🇩🇰',
    'no': '🇳🇴', 'fi': '🇫🇮', 'th': '🇹🇭', 'vi': '🇻🇳', 'id': '🇮🇩'
};

// Current language dropdown target
let currentLanguageTarget = null;

// Device dimensions
const deviceDimensions = {
    'iphone-6.9': { width: 1320, height: 2868 },
    'iphone-6.7': { width: 1290, height: 2796 },
    'iphone-6.5': { width: 1284, height: 2778 },
    'iphone-5.5': { width: 1242, height: 2208 },
    'ipad-12.9': { width: 2048, height: 2732 },
    'ipad-11': { width: 1668, height: 2388 }
};

// DOM elements
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');
const uploadZone = document.getElementById('upload-zone');
const fileInput = document.getElementById('file-input');
const screenshotList = document.getElementById('screenshot-list');
const noScreenshot = document.getElementById('no-screenshot');

// IndexedDB for larger storage (can store hundreds of MB vs localStorage's 5-10MB)
let db = null;
const DB_NAME = 'AppStoreScreenshotGenerator';
const DB_VERSION = 2;
const PROJECTS_STORE = 'projects';
const META_STORE = 'meta';

let currentProjectId = 'default';
let projects = [{ id: 'default', name: 'Default Project' }];

function openDatabase() {
    return new Promise((resolve, reject) => {
        try {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = (event) => {
                console.error('IndexedDB error:', event.target.error);
                // Continue without database
                resolve(null);
            };
            
            request.onsuccess = () => {
                db = request.result;
                resolve(db);
            };
            
            request.onupgradeneeded = (event) => {
                const database = event.target.result;
                
                // Delete old store if exists (from version 1)
                if (database.objectStoreNames.contains('state')) {
                    database.deleteObjectStore('state');
                }
                
                // Create projects store
                if (!database.objectStoreNames.contains(PROJECTS_STORE)) {
                    database.createObjectStore(PROJECTS_STORE, { keyPath: 'id' });
                }
                
                // Create meta store for project list and current project
                if (!database.objectStoreNames.contains(META_STORE)) {
                    database.createObjectStore(META_STORE, { keyPath: 'key' });
                }
            };
            
            request.onblocked = () => {
                console.warn('Database upgrade blocked. Please close other tabs.');
                resolve(null);
            };
        } catch (e) {
            console.error('Failed to open IndexedDB:', e);
            resolve(null);
        }
    });
}

// Load project list and current project
async function loadProjectsMeta() {
    if (!db) return;
    
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction([META_STORE], 'readonly');
            const store = transaction.objectStore(META_STORE);
            
            const projectsReq = store.get('projects');
            const currentReq = store.get('currentProject');
            
            transaction.oncomplete = () => {
                if (projectsReq.result) {
                    projects = projectsReq.result.value;
                }
                if (currentReq.result) {
                    currentProjectId = currentReq.result.value;
                }
                updateProjectSelector();
                resolve();
            };
            
            transaction.onerror = () => resolve();
        } catch (e) {
            resolve();
        }
    });
}

// Save project list and current project
function saveProjectsMeta() {
    if (!db) return;
    
    try {
        const transaction = db.transaction([META_STORE], 'readwrite');
        const store = transaction.objectStore(META_STORE);
        store.put({ key: 'projects', value: projects });
        store.put({ key: 'currentProject', value: currentProjectId });
    } catch (e) {
        console.error('Error saving projects meta:', e);
    }
}

// Update project selector dropdown
function updateProjectSelector() {
    const selector = document.getElementById('project-selector');
    selector.innerHTML = '';
    
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        if (project.id === currentProjectId) {
            option.selected = true;
        }
        selector.appendChild(option);
    });
}

// Initialize
async function init() {
    try {
        await openDatabase();
        await loadProjectsMeta();
        await loadState();
        syncUIWithState();
        updateCanvas();
    } catch (e) {
        console.error('Initialization error:', e);
        // Continue with defaults
        syncUIWithState();
        updateCanvas();
    }
}

// Set up event listeners immediately (don't wait for async init)
function initSync() {
    setupEventListeners();
    updateGradientStopsUI();
    updateCanvas();
    // Then load saved data asynchronously
    init();
}

// Save state to IndexedDB for current project
function saveState() {
    if (!db) return;
    
    // Convert screenshots to base64 for storage
    const screenshotsToSave = state.screenshots.map(s => ({
        src: s.image.src,
        name: s.name,
        deviceType: s.deviceType,
        overrides: s.overrides
    }));

    const stateToSave = {
        id: currentProjectId,
        screenshots: screenshotsToSave,
        selectedIndex: state.selectedIndex,
        outputDevice: state.outputDevice,
        customWidth: state.customWidth,
        customHeight: state.customHeight,
        use3D: state.use3D,
        rotation3D: state.rotation3D,
        scale3D: state.scale3D,
        background: {
            type: state.background.type,
            gradient: state.background.gradient,
            solid: state.background.solid,
            imageFit: state.background.imageFit,
            imageBlur: state.background.imageBlur,
            overlayColor: state.background.overlayColor,
            overlayOpacity: state.background.overlayOpacity,
            noise: state.background.noise,
            noiseIntensity: state.background.noiseIntensity
        },
        screenshot: state.screenshot,
        text: state.text
    };
    
    try {
        const transaction = db.transaction([PROJECTS_STORE], 'readwrite');
        const store = transaction.objectStore(PROJECTS_STORE);
        store.put(stateToSave);
    } catch (e) {
        console.error('Error saving state:', e);
    }
}

// Load state from IndexedDB for current project
function loadState() {
    if (!db) return Promise.resolve();
    
    return new Promise((resolve) => {
        try {
            const transaction = db.transaction([PROJECTS_STORE], 'readonly');
            const store = transaction.objectStore(PROJECTS_STORE);
            const request = store.get(currentProjectId);
            
            request.onsuccess = () => {
                const parsed = request.result;
                if (parsed) {
                    // Load screenshots
                    state.screenshots = [];
                    if (parsed.screenshots && parsed.screenshots.length > 0) {
                        let loadedCount = 0;
                        parsed.screenshots.forEach((s, index) => {
                            const img = new Image();
                            img.onload = () => {
                                state.screenshots[index] = {
                                    image: img,
                                    name: s.name,
                                    deviceType: s.deviceType,
                                    overrides: s.overrides || {}
                                };
                                loadedCount++;
                                if (loadedCount === parsed.screenshots.length) {
                                    updateScreenshotList();
                                    updateCanvas();
                                }
                            };
                            img.src = s.src;
                        });
                    }
                    
                    state.selectedIndex = parsed.selectedIndex || 0;
                    state.outputDevice = parsed.outputDevice || 'iphone-6.9';
                    state.customWidth = parsed.customWidth || 1320;
                    state.customHeight = parsed.customHeight || 2868;
                    state.use3D = parsed.use3D || false;
                    state.rotation3D = parsed.rotation3D || { x: 0, y: 0, z: 0 };
                    state.scale3D = parsed.scale3D || 100;

                    if (parsed.background) {
                        state.background.type = parsed.background.type || 'gradient';
                        state.background.gradient = parsed.background.gradient || state.background.gradient;
                        state.background.solid = parsed.background.solid || state.background.solid;
                        state.background.imageFit = parsed.background.imageFit || 'cover';
                        state.background.imageBlur = parsed.background.imageBlur || 0;
                        state.background.overlayColor = parsed.background.overlayColor || '#000000';
                        state.background.overlayOpacity = parsed.background.overlayOpacity || 0;
                        state.background.noise = parsed.background.noise || false;
                        state.background.noiseIntensity = parsed.background.noiseIntensity || 10;
                    }
                    
                    if (parsed.screenshot) {
                        state.screenshot = { ...state.screenshot, ...parsed.screenshot };
                    }
                    
                    if (parsed.text) {
                        state.text = { ...state.text, ...parsed.text };
                    }
                } else {
                    // New project, reset to defaults
                    resetStateToDefaults();
                }
                resolve();
            };
            
            request.onerror = () => {
                console.error('Error loading state:', request.error);
                resolve();
            };
        } catch (e) {
            console.error('Error loading state:', e);
            resolve();
        }
    });
}

// Reset state to defaults (without clearing storage)
function resetStateToDefaults() {
    state.screenshots = [];
    state.selectedIndex = 0;
    state.outputDevice = 'iphone-6.9';
    state.customWidth = 1320;
    state.customHeight = 2868;
    state.use3D = false;
    state.rotation3D = { x: 0, y: 0, z: 0 };
    state.scale3D = 100;
    state.background = {
        type: 'gradient',
        gradient: {
            angle: 135,
            stops: [
                { color: '#667eea', position: 0 },
                { color: '#764ba2', position: 100 }
            ]
        },
        solid: '#1a1a2e',
        image: null,
        imageFit: 'cover',
        imageBlur: 0,
        overlayColor: '#000000',
        overlayOpacity: 0,
        noise: false,
        noiseIntensity: 10
    };
    state.screenshot = {
        scale: 70,
        y: 55,
        x: 50,
        rotation: 0,
        perspective: 0,
        cornerRadius: 24,
        shadow: {
            enabled: true,
            color: '#000000',
            blur: 40,
            opacity: 30,
            x: 0,
            y: 20
        },
        frame: {
            enabled: false,
            style: 'iphone-15-pro',
            color: '#1d1d1f',
            width: 12,
            opacity: 100
        }
    };
    state.text = {
        headlines: { en: '' },
        headlineLanguages: ['en'],
        currentHeadlineLang: 'en',
        headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        headlineSize: 100,
        headlineWeight: '600',
        headlineColor: '#ffffff',
        position: 'top',
        offsetY: 12,
        lineHeight: 110,
        subheadlines: { en: '' },
        subheadlineLanguages: ['en'],
        currentSubheadlineLang: 'en',
        subheadlineSize: 50,
        subheadlineColor: '#ffffff',
        subheadlineOpacity: 70
    };
}

// Switch to a different project
async function switchProject(projectId) {
    // Save current project first
    saveState();
    
    currentProjectId = projectId;
    saveProjectsMeta();
    
    // Reset and load new project
    resetStateToDefaults();
    await loadState();
    
    // Reset per-screenshot text toggle
    document.getElementById('per-screenshot-text-toggle').classList.remove('active');
    document.getElementById('tab-text').classList.remove('per-screenshot-mode');
    
    syncUIWithState();
    updateScreenshotList();
    updateGradientStopsUI();
    updateCanvas();
}

// Create a new project
async function createProject(name) {
    const id = 'project_' + Date.now();
    projects.push({ id, name });
    saveProjectsMeta();
    await switchProject(id);
    updateProjectSelector();
}

// Rename current project
function renameProject(newName) {
    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        project.name = newName;
        saveProjectsMeta();
        updateProjectSelector();
    }
}

// Delete current project
async function deleteProject() {
    if (projects.length <= 1) {
        alert('Cannot delete the only project');
        return;
    }

    // Remove from projects list
    const index = projects.findIndex(p => p.id === currentProjectId);
    if (index > -1) {
        projects.splice(index, 1);
    }

    // Delete from IndexedDB
    if (db) {
        const transaction = db.transaction([PROJECTS_STORE], 'readwrite');
        const store = transaction.objectStore(PROJECTS_STORE);
        store.delete(currentProjectId);
    }

    // Switch to first available project
    saveProjectsMeta();
    await switchProject(projects[0].id);
    updateProjectSelector();
}

// Sync UI controls with current state
function syncUIWithState() {
    // Device selector
    document.querySelectorAll('.device-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.device === state.outputDevice);
    });
    document.getElementById('custom-size-inputs').style.display = state.outputDevice === 'custom' ? 'block' : 'none';
    document.getElementById('custom-width').value = state.customWidth;
    document.getElementById('custom-height').value = state.customHeight;

    // Background type
    document.querySelectorAll('#bg-type-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === state.background.type);
    });
    document.getElementById('gradient-options').style.display = state.background.type === 'gradient' ? 'block' : 'none';
    document.getElementById('solid-options').style.display = state.background.type === 'solid' ? 'block' : 'none';
    document.getElementById('image-options').style.display = state.background.type === 'image' ? 'block' : 'none';

    // Gradient
    document.getElementById('gradient-angle').value = state.background.gradient.angle;
    document.getElementById('gradient-angle-value').textContent = state.background.gradient.angle + '°';
    updateGradientStopsUI();

    // Solid color
    document.getElementById('solid-color').value = state.background.solid;
    document.getElementById('solid-color-hex').value = state.background.solid;

    // Image background
    document.getElementById('bg-image-fit').value = state.background.imageFit;
    document.getElementById('bg-blur').value = state.background.imageBlur;
    document.getElementById('bg-blur-value').textContent = state.background.imageBlur + 'px';
    document.getElementById('bg-overlay-color').value = state.background.overlayColor;
    document.getElementById('bg-overlay-hex').value = state.background.overlayColor;
    document.getElementById('bg-overlay-opacity').value = state.background.overlayOpacity;
    document.getElementById('bg-overlay-opacity-value').textContent = state.background.overlayOpacity + '%';

    // Noise
    document.getElementById('noise-toggle').classList.toggle('active', state.background.noise);
    document.getElementById('noise-options').style.display = state.background.noise ? 'block' : 'none';
    document.getElementById('noise-intensity').value = state.background.noiseIntensity;
    document.getElementById('noise-intensity-value').textContent = state.background.noiseIntensity + '%';

    // Screenshot settings
    document.getElementById('screenshot-scale').value = state.screenshot.scale;
    document.getElementById('screenshot-scale-value').textContent = state.screenshot.scale + '%';
    document.getElementById('screenshot-y').value = state.screenshot.y;
    document.getElementById('screenshot-y-value').textContent = state.screenshot.y + '%';
    document.getElementById('screenshot-x').value = state.screenshot.x;
    document.getElementById('screenshot-x-value').textContent = state.screenshot.x + '%';
    document.getElementById('corner-radius').value = state.screenshot.cornerRadius;
    document.getElementById('corner-radius-value').textContent = state.screenshot.cornerRadius + 'px';
    document.getElementById('screenshot-rotation').value = state.screenshot.rotation;
    document.getElementById('screenshot-rotation-value').textContent = state.screenshot.rotation + '°';

    // Shadow
    document.getElementById('shadow-toggle').classList.toggle('active', state.screenshot.shadow.enabled);
    document.getElementById('shadow-options').style.display = state.screenshot.shadow.enabled ? 'block' : 'none';
    document.getElementById('shadow-color').value = state.screenshot.shadow.color;
    document.getElementById('shadow-color-hex').value = state.screenshot.shadow.color;
    document.getElementById('shadow-blur').value = state.screenshot.shadow.blur;
    document.getElementById('shadow-blur-value').textContent = state.screenshot.shadow.blur + 'px';
    document.getElementById('shadow-opacity').value = state.screenshot.shadow.opacity;
    document.getElementById('shadow-opacity-value').textContent = state.screenshot.shadow.opacity + '%';
    document.getElementById('shadow-x').value = state.screenshot.shadow.x;
    document.getElementById('shadow-x-value').textContent = state.screenshot.shadow.x + 'px';
    document.getElementById('shadow-y').value = state.screenshot.shadow.y;
    document.getElementById('shadow-y-value').textContent = state.screenshot.shadow.y + 'px';

    // Frame
    document.getElementById('frame-toggle').classList.toggle('active', state.screenshot.frame.enabled);
    document.getElementById('frame-options').style.display = state.screenshot.frame.enabled ? 'block' : 'none';
    document.getElementById('frame-style').value = state.screenshot.frame.style;
    document.getElementById('frame-color').value = state.screenshot.frame.color;
    document.getElementById('frame-color-hex').value = state.screenshot.frame.color;
    document.getElementById('frame-width').value = state.screenshot.frame.width;
    document.getElementById('frame-width-value').textContent = state.screenshot.frame.width + 'px';
    document.getElementById('frame-opacity').value = state.screenshot.frame.opacity;
    document.getElementById('frame-opacity-value').textContent = state.screenshot.frame.opacity + '%';

    // Text
    const currentHeadline = state.text.headlines ? (state.text.headlines[state.text.currentHeadlineLang || 'en'] || '') : (state.text.headline || '');
    document.getElementById('headline-text').value = currentHeadline;
    document.getElementById('headline-font').value = state.text.headlineFont;
    document.getElementById('headline-size').value = state.text.headlineSize;
    document.getElementById('headline-size-value').textContent = state.text.headlineSize + 'px';
    document.getElementById('headline-weight').value = state.text.headlineWeight;
    document.getElementById('headline-color').value = state.text.headlineColor;
    document.getElementById('headline-color-hex').value = state.text.headlineColor;
    document.querySelectorAll('#text-position button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.position === state.text.position);
    });
    document.getElementById('text-offset-y').value = state.text.offsetY;
    document.getElementById('text-offset-y-value').textContent = state.text.offsetY + '%';
    document.getElementById('line-height').value = state.text.lineHeight;
    document.getElementById('line-height-value').textContent = state.text.lineHeight + '%';
    const currentSubheadline = state.text.subheadlines ? (state.text.subheadlines[state.text.currentSubheadlineLang || 'en'] || '') : (state.text.subheadline || '');
    document.getElementById('subheadline-text').value = currentSubheadline;
    document.getElementById('subheadline-size').value = state.text.subheadlineSize;
    document.getElementById('subheadline-size-value').textContent = state.text.subheadlineSize + 'px';
    document.getElementById('subheadline-color').value = state.text.subheadlineColor;
    document.getElementById('subheadline-color-hex').value = state.text.subheadlineColor;
    document.getElementById('subheadline-opacity').value = state.text.subheadlineOpacity;
    document.getElementById('subheadline-opacity-value').textContent = state.text.subheadlineOpacity + '%';

    // Language UIs
    updateHeadlineLanguageUI();
    updateSubheadlineLanguageUI();

    // 3D mode
    document.getElementById('use-3d-toggle').classList.toggle('active', state.use3D);
    document.getElementById('rotation-3d-options').style.display = state.use3D ? 'block' : 'none';
    document.getElementById('rotation-3d-x').value = state.rotation3D.x;
    document.getElementById('rotation-3d-x-value').textContent = state.rotation3D.x + '°';
    document.getElementById('rotation-3d-y').value = state.rotation3D.y;
    document.getElementById('rotation-3d-y-value').textContent = state.rotation3D.y + '°';
    document.getElementById('rotation-3d-z').value = state.rotation3D.z;
    document.getElementById('rotation-3d-z-value').textContent = state.rotation3D.z + '°';
    document.getElementById('scale-3d').value = state.scale3D;
    document.getElementById('scale-3d-value').textContent = state.scale3D + '%';

    // Hide 2D-only settings in 3D mode
    document.getElementById('2d-only-settings').style.display = state.use3D ? 'none' : 'block';
    document.getElementById('position-presets-section').style.display = state.use3D ? 'none' : 'block';

    // Show/hide 3D renderer
    if (typeof showThreeJS === 'function') {
        showThreeJS(state.use3D);
    }
}

function setupEventListeners() {
    // File upload
    uploadZone.addEventListener('click', () => fileInput.click());
    uploadZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZone.classList.add('dragover');
    });
    uploadZone.addEventListener('dragleave', () => {
        uploadZone.classList.remove('dragover');
    });
    uploadZone.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZone.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Project controls
    document.getElementById('project-selector').addEventListener('change', (e) => {
        switchProject(e.target.value);
    });

    document.getElementById('new-project-btn').addEventListener('click', () => {
        document.getElementById('project-modal-title').textContent = 'New Project';
        document.getElementById('project-name-input').value = '';
        document.getElementById('project-modal-confirm').textContent = 'Create';
        document.getElementById('project-modal').dataset.mode = 'new';
        document.getElementById('project-modal').classList.add('visible');
        document.getElementById('project-name-input').focus();
    });

    document.getElementById('save-project-btn').addEventListener('click', () => {
        saveState();
        // Show brief confirmation
        const btn = document.getElementById('save-project-btn');
        btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"/></svg>';
        setTimeout(() => {
            btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17,21 17,13 7,13 7,21"/><polyline points="7,3 7,8 15,8"/></svg>';
        }, 1000);
    });

    document.getElementById('rename-project-btn').addEventListener('click', () => {
        const project = projects.find(p => p.id === currentProjectId);
        document.getElementById('project-modal-title').textContent = 'Rename Project';
        document.getElementById('project-name-input').value = project ? project.name : '';
        document.getElementById('project-modal-confirm').textContent = 'Rename';
        document.getElementById('project-modal').dataset.mode = 'rename';
        document.getElementById('project-modal').classList.add('visible');
        document.getElementById('project-name-input').focus();
    });

    document.getElementById('delete-project-btn').addEventListener('click', () => {
        if (projects.length <= 1) {
            alert('Cannot delete the only project');
            return;
        }
        const project = projects.find(p => p.id === currentProjectId);
        document.getElementById('delete-project-message').textContent = 
            `Are you sure you want to delete "${project ? project.name : 'this project'}"? This cannot be undone.`;
        document.getElementById('delete-project-modal').classList.add('visible');
    });

    // Project modal buttons
    document.getElementById('project-modal-cancel').addEventListener('click', () => {
        document.getElementById('project-modal').classList.remove('visible');
    });

    document.getElementById('project-modal-confirm').addEventListener('click', () => {
        const name = document.getElementById('project-name-input').value.trim();
        if (!name) {
            alert('Please enter a project name');
            return;
        }
        
        const mode = document.getElementById('project-modal').dataset.mode;
        if (mode === 'new') {
            createProject(name);
        } else if (mode === 'rename') {
            renameProject(name);
        }
        
        document.getElementById('project-modal').classList.remove('visible');
    });

    document.getElementById('project-name-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            document.getElementById('project-modal-confirm').click();
        }
    });

    // Delete project modal buttons
    document.getElementById('delete-project-cancel').addEventListener('click', () => {
        document.getElementById('delete-project-modal').classList.remove('visible');
    });

    document.getElementById('delete-project-confirm').addEventListener('click', () => {
        deleteProject();
        document.getElementById('delete-project-modal').classList.remove('visible');
    });

    // Close modals on overlay click
    document.getElementById('project-modal').addEventListener('click', (e) => {
        if (e.target.id === 'project-modal') {
            document.getElementById('project-modal').classList.remove('visible');
        }
    });

    document.getElementById('delete-project-modal').addEventListener('click', (e) => {
        if (e.target.id === 'delete-project-modal') {
            document.getElementById('delete-project-modal').classList.remove('visible');
        }
    });

    // Language selector events
    document.getElementById('add-headline-lang').addEventListener('click', (e) => {
        e.stopPropagation();
        showLanguageDropdown('headline', e.target.closest('.add-language-btn'));
    });

    document.getElementById('add-subheadline-lang').addEventListener('click', (e) => {
        e.stopPropagation();
        showLanguageDropdown('subheadline', e.target.closest('.add-language-btn'));
    });

    // Language dropdown option clicks
    document.querySelectorAll('.language-option').forEach(opt => {
        opt.addEventListener('click', () => {
            const lang = opt.dataset.lang;
            const flag = opt.dataset.flag;
            
            if (currentLanguageTarget === 'headline') {
                addHeadlineLanguage(lang, flag);
            } else if (currentLanguageTarget === 'subheadline') {
                addSubheadlineLanguage(lang, flag);
            }
            
            hideLanguageDropdown();
        });
    });

    // Close language dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.language-dropdown') && !e.target.closest('.add-language-btn')) {
            hideLanguageDropdown();
        }
    });

    // Translate button events
    document.getElementById('translate-headline-btn').addEventListener('click', () => {
        openTranslateModal('headline');
    });

    document.getElementById('translate-subheadline-btn').addEventListener('click', () => {
        openTranslateModal('subheadline');
    });

    document.getElementById('translate-source-lang').addEventListener('change', (e) => {
        updateTranslateSourcePreview();
    });

    document.getElementById('translate-modal-cancel').addEventListener('click', () => {
        document.getElementById('translate-modal').classList.remove('visible');
    });

    document.getElementById('translate-modal-apply').addEventListener('click', () => {
        applyTranslations();
        document.getElementById('translate-modal').classList.remove('visible');
    });

    document.getElementById('ai-translate-btn').addEventListener('click', () => {
        aiTranslateAll();
    });

    document.getElementById('translate-modal').addEventListener('click', (e) => {
        if (e.target.id === 'translate-modal') {
            document.getElementById('translate-modal').classList.remove('visible');
        }
    });

    // About modal
    document.getElementById('about-btn').addEventListener('click', () => {
        document.getElementById('about-modal').classList.add('visible');
    });

    document.getElementById('about-modal-close').addEventListener('click', () => {
        document.getElementById('about-modal').classList.remove('visible');
    });

    document.getElementById('about-modal').addEventListener('click', (e) => {
        if (e.target.id === 'about-modal') {
            document.getElementById('about-modal').classList.remove('visible');
        }
    });

    // Settings modal
    document.getElementById('settings-btn').addEventListener('click', () => {
        openSettingsModal();
    });

    document.getElementById('settings-modal-close').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('visible');
    });

    document.getElementById('settings-modal-cancel').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('visible');
    });

    document.getElementById('settings-modal-save').addEventListener('click', () => {
        saveSettings();
    });

    document.getElementById('settings-show-key').addEventListener('click', () => {
        const input = document.getElementById('settings-api-key');
        input.type = input.type === 'password' ? 'text' : 'password';
    });

    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') {
            document.getElementById('settings-modal').classList.remove('visible');
        }
    });

    // Device selector
    document.querySelectorAll('.device-option').forEach(opt => {
        opt.addEventListener('click', () => {
            document.querySelectorAll('.device-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            state.outputDevice = opt.dataset.device;
            
            const customInputs = document.getElementById('custom-size-inputs');
            if (state.outputDevice === 'custom') {
                customInputs.style.display = 'block';
            } else {
                customInputs.style.display = 'none';
            }
            updateCanvas();
        });
    });

    // Custom size inputs
    document.getElementById('custom-width').addEventListener('input', (e) => {
        state.customWidth = parseInt(e.target.value) || 1290;
        updateCanvas();
    });
    document.getElementById('custom-height').addEventListener('input', (e) => {
        state.customHeight = parseInt(e.target.value) || 2796;
        updateCanvas();
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
        });
    });

    // Background type selector
    document.querySelectorAll('#bg-type-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#bg-type-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.background.type = btn.dataset.type;
            
            document.getElementById('gradient-options').style.display = btn.dataset.type === 'gradient' ? 'block' : 'none';
            document.getElementById('solid-options').style.display = btn.dataset.type === 'solid' ? 'block' : 'none';
            document.getElementById('image-options').style.display = btn.dataset.type === 'image' ? 'block' : 'none';
            
            updateCanvas();
        });
    });

    // Gradient presets
    document.querySelectorAll('.preset-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            swatch.classList.add('selected');
            
            // Parse gradient from preset
            const gradientStr = swatch.dataset.gradient;
            const angleMatch = gradientStr.match(/(\d+)deg/);
            const colorMatches = gradientStr.matchAll(/(#[a-fA-F0-9]{6})\s+(\d+)%/g);
            
            if (angleMatch) {
                state.background.gradient.angle = parseInt(angleMatch[1]);
                document.getElementById('gradient-angle').value = state.background.gradient.angle;
                document.getElementById('gradient-angle-value').textContent = state.background.gradient.angle + '°';
            }
            
            const stops = [];
            for (const match of colorMatches) {
                stops.push({ color: match[1], position: parseInt(match[2]) });
            }
            if (stops.length >= 2) {
                state.background.gradient.stops = stops;
                updateGradientStopsUI();
            }
            
            updateCanvas();
        });
    });

    // Gradient angle
    document.getElementById('gradient-angle').addEventListener('input', (e) => {
        state.background.gradient.angle = parseInt(e.target.value);
        document.getElementById('gradient-angle-value').textContent = e.target.value + '°';
        updateCanvas();
    });

    // Add gradient stop
    document.getElementById('add-gradient-stop').addEventListener('click', () => {
        const lastStop = state.background.gradient.stops[state.background.gradient.stops.length - 1];
        state.background.gradient.stops.push({
            color: lastStop.color,
            position: Math.min(lastStop.position + 20, 100)
        });
        updateGradientStopsUI();
        updateCanvas();
    });

    // Solid color
    document.getElementById('solid-color').addEventListener('input', (e) => {
        state.background.solid = e.target.value;
        document.getElementById('solid-color-hex').value = e.target.value;
        updateCanvas();
    });
    document.getElementById('solid-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            state.background.solid = e.target.value;
            document.getElementById('solid-color').value = e.target.value;
            updateCanvas();
        }
    });

    // Background image
    const bgImageUpload = document.getElementById('bg-image-upload');
    const bgImageInput = document.getElementById('bg-image-input');
    bgImageUpload.addEventListener('click', () => bgImageInput.click());
    bgImageInput.addEventListener('change', (e) => {
        if (e.target.files[0]) {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    state.background.image = img;
                    document.getElementById('bg-image-preview').src = event.target.result;
                    document.getElementById('bg-image-preview').style.display = 'block';
                    updateCanvas();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    document.getElementById('bg-image-fit').addEventListener('change', (e) => {
        state.background.imageFit = e.target.value;
        updateCanvas();
    });

    document.getElementById('bg-blur').addEventListener('input', (e) => {
        state.background.imageBlur = parseInt(e.target.value);
        document.getElementById('bg-blur-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('bg-overlay-color').addEventListener('input', (e) => {
        state.background.overlayColor = e.target.value;
        document.getElementById('bg-overlay-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('bg-overlay-opacity').addEventListener('input', (e) => {
        state.background.overlayOpacity = parseInt(e.target.value);
        document.getElementById('bg-overlay-opacity-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    // Noise toggle
    document.getElementById('noise-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        state.background.noise = this.classList.contains('active');
        document.getElementById('noise-options').style.display = state.background.noise ? 'block' : 'none';
        updateCanvas();
    });

    document.getElementById('noise-intensity').addEventListener('input', (e) => {
        state.background.noiseIntensity = parseInt(e.target.value);
        document.getElementById('noise-intensity-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    // Screenshot settings
    document.getElementById('screenshot-scale').addEventListener('input', (e) => {
        state.screenshot.scale = parseInt(e.target.value);
        document.getElementById('screenshot-scale-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    document.getElementById('screenshot-y').addEventListener('input', (e) => {
        state.screenshot.y = parseInt(e.target.value);
        document.getElementById('screenshot-y-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    document.getElementById('screenshot-x').addEventListener('input', (e) => {
        state.screenshot.x = parseInt(e.target.value);
        document.getElementById('screenshot-x-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    document.getElementById('corner-radius').addEventListener('input', (e) => {
        state.screenshot.cornerRadius = parseInt(e.target.value);
        document.getElementById('corner-radius-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('screenshot-rotation').addEventListener('input', (e) => {
        state.screenshot.rotation = parseInt(e.target.value);
        document.getElementById('screenshot-rotation-value').textContent = e.target.value + '°';
        updateCanvas();
    });

    // Shadow toggle
    document.getElementById('shadow-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        state.screenshot.shadow.enabled = this.classList.contains('active');
        document.getElementById('shadow-options').style.display = state.screenshot.shadow.enabled ? 'block' : 'none';
        updateCanvas();
    });

    document.getElementById('shadow-color').addEventListener('input', (e) => {
        state.screenshot.shadow.color = e.target.value;
        document.getElementById('shadow-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('shadow-blur').addEventListener('input', (e) => {
        state.screenshot.shadow.blur = parseInt(e.target.value);
        document.getElementById('shadow-blur-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('shadow-opacity').addEventListener('input', (e) => {
        state.screenshot.shadow.opacity = parseInt(e.target.value);
        document.getElementById('shadow-opacity-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    document.getElementById('shadow-x').addEventListener('input', (e) => {
        state.screenshot.shadow.x = parseInt(e.target.value);
        document.getElementById('shadow-x-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('shadow-y').addEventListener('input', (e) => {
        state.screenshot.shadow.y = parseInt(e.target.value);
        document.getElementById('shadow-y-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    // Frame toggle
    document.getElementById('frame-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        state.screenshot.frame.enabled = this.classList.contains('active');
        document.getElementById('frame-options').style.display = state.screenshot.frame.enabled ? 'block' : 'none';
        updateCanvas();
    });

    document.getElementById('frame-style').addEventListener('change', (e) => {
        state.screenshot.frame.style = e.target.value;
        updateCanvas();
    });

    document.getElementById('frame-color').addEventListener('input', (e) => {
        state.screenshot.frame.color = e.target.value;
        document.getElementById('frame-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('frame-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            state.screenshot.frame.color = e.target.value;
            document.getElementById('frame-color').value = e.target.value;
            updateCanvas();
        }
    });

    document.getElementById('frame-width').addEventListener('input', (e) => {
        state.screenshot.frame.width = parseInt(e.target.value);
        document.getElementById('frame-width-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('frame-opacity').addEventListener('input', (e) => {
        state.screenshot.frame.opacity = parseInt(e.target.value);
        document.getElementById('frame-opacity-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    // Per-screenshot text toggle
    document.getElementById('per-screenshot-text-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        const isPerScreenshot = this.classList.contains('active');
        document.getElementById('tab-text').classList.toggle('per-screenshot-mode', isPerScreenshot);
        
        if (isPerScreenshot && state.screenshots.length > 0) {
            // Initialize override for current screenshot if not exists
            const screenshot = state.screenshots[state.selectedIndex];
            if (!screenshot.overrides.text) {
                screenshot.overrides.text = { ...state.text };
            }
            loadTextUIFromScreenshot();
        } else {
            loadTextUIFromGlobal();
        }
    });

    // Text settings
    document.getElementById('headline-text').addEventListener('input', (e) => {
        const text = getTextSettings();
        if (!text.headlines) text.headlines = { en: '' };
        text.headlines[text.currentHeadlineLang || 'en'] = e.target.value;
        updateCanvas();
    });

    document.getElementById('headline-font').addEventListener('change', (e) => {
        setTextValue('headlineFont', e.target.value);
        updateCanvas();
    });

    document.getElementById('headline-size').addEventListener('input', (e) => {
        setTextValue('headlineSize', parseInt(e.target.value));
        document.getElementById('headline-size-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('headline-weight').addEventListener('change', (e) => {
        setTextValue('headlineWeight', e.target.value);
        updateCanvas();
    });

    document.getElementById('headline-color').addEventListener('input', (e) => {
        setTextValue('headlineColor', e.target.value);
        document.getElementById('headline-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.querySelectorAll('#text-position button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#text-position button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTextValue('position', btn.dataset.position);
            updateCanvas();
        });
    });

    document.getElementById('text-offset-y').addEventListener('input', (e) => {
        setTextValue('offsetY', parseInt(e.target.value));
        document.getElementById('text-offset-y-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    document.getElementById('line-height').addEventListener('input', (e) => {
        setTextValue('lineHeight', parseInt(e.target.value));
        document.getElementById('line-height-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    document.getElementById('subheadline-text').addEventListener('input', (e) => {
        const text = getTextSettings();
        if (!text.subheadlines) text.subheadlines = { en: '' };
        text.subheadlines[text.currentSubheadlineLang || 'en'] = e.target.value;
        updateCanvas();
    });

    document.getElementById('subheadline-size').addEventListener('input', (e) => {
        setTextValue('subheadlineSize', parseInt(e.target.value));
        document.getElementById('subheadline-size-value').textContent = e.target.value + 'px';
        updateCanvas();
    });

    document.getElementById('subheadline-color').addEventListener('input', (e) => {
        setTextValue('subheadlineColor', e.target.value);
        document.getElementById('subheadline-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('subheadline-opacity').addEventListener('input', (e) => {
        setTextValue('subheadlineOpacity', parseInt(e.target.value));
        document.getElementById('subheadline-opacity-value').textContent = e.target.value + '%';
        updateCanvas();
    });

    // Export buttons
    document.getElementById('export-current').addEventListener('click', exportCurrent);
    document.getElementById('export-all').addEventListener('click', exportAll);

    // Position presets
    document.querySelectorAll('.position-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.position-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyPositionPreset(btn.dataset.preset);
        });
    });

    // 3D mode toggle
    document.getElementById('use-3d-toggle').addEventListener('click', function() {
        this.classList.toggle('active');
        state.use3D = this.classList.contains('active');
        document.getElementById('rotation-3d-options').style.display = state.use3D ? 'block' : 'none';

        // Hide 2D-only settings in 3D mode
        document.getElementById('2d-only-settings').style.display = state.use3D ? 'none' : 'block';
        document.getElementById('position-presets-section').style.display = state.use3D ? 'none' : 'block';

        if (typeof showThreeJS === 'function') {
            showThreeJS(state.use3D);
        }

        if (state.use3D && typeof updateScreenTexture === 'function') {
            updateScreenTexture();
        }

        updateCanvas();
    });

    // 3D rotation controls
    document.getElementById('rotation-3d-x').addEventListener('input', (e) => {
        state.rotation3D.x = parseInt(e.target.value);
        document.getElementById('rotation-3d-x-value').textContent = e.target.value + '°';
        if (typeof setThreeJSRotation === 'function') {
            setThreeJSRotation(state.rotation3D.x, state.rotation3D.y, state.rotation3D.z);
        }
        updateCanvas(); // Keep export canvas in sync
    });

    document.getElementById('rotation-3d-y').addEventListener('input', (e) => {
        state.rotation3D.y = parseInt(e.target.value);
        document.getElementById('rotation-3d-y-value').textContent = e.target.value + '°';
        if (typeof setThreeJSRotation === 'function') {
            setThreeJSRotation(state.rotation3D.x, state.rotation3D.y, state.rotation3D.z);
        }
        updateCanvas(); // Keep export canvas in sync
    });

    document.getElementById('rotation-3d-z').addEventListener('input', (e) => {
        state.rotation3D.z = parseInt(e.target.value);
        document.getElementById('rotation-3d-z-value').textContent = e.target.value + '°';
        if (typeof setThreeJSRotation === 'function') {
            setThreeJSRotation(state.rotation3D.x, state.rotation3D.y, state.rotation3D.z);
        }
        updateCanvas(); // Keep export canvas in sync
    });

    document.getElementById('scale-3d').addEventListener('input', (e) => {
        state.scale3D = parseInt(e.target.value);
        document.getElementById('scale-3d-value').textContent = e.target.value + '%';
        if (typeof setThreeJSScale === 'function') {
            setThreeJSScale(state.scale3D);
        }
        updateCanvas(); // Keep export canvas in sync
    });
}

// Helper function to check if per-screenshot text mode is active
function isPerScreenshotTextMode() {
    return document.getElementById('per-screenshot-text-toggle').classList.contains('active');
}

// Language helper functions
function showLanguageDropdown(target, buttonElement) {
    currentLanguageTarget = target;
    const dropdown = document.getElementById('language-dropdown');
    const rect = buttonElement.getBoundingClientRect();
    
    dropdown.style.position = 'fixed';
    dropdown.style.top = (rect.bottom + 4) + 'px';
    dropdown.style.left = (rect.left - 150 + rect.width) + 'px';
    dropdown.classList.add('visible');
    
    // Hide already added languages
    const existingLangs = target === 'headline' 
        ? getTextSettings().headlineLanguages 
        : getTextSettings().subheadlineLanguages;
    
    document.querySelectorAll('.language-option').forEach(opt => {
        opt.style.display = existingLangs.includes(opt.dataset.lang) ? 'none' : 'flex';
    });
}

function hideLanguageDropdown() {
    document.getElementById('language-dropdown').classList.remove('visible');
    currentLanguageTarget = null;
}

function addHeadlineLanguage(lang, flag) {
    const text = getTextSettings();
    if (!text.headlineLanguages.includes(lang)) {
        text.headlineLanguages.push(lang);
        if (!text.headlines) text.headlines = { en: '' };
        text.headlines[lang] = '';
        updateHeadlineLanguageUI();
        switchHeadlineLanguage(lang);
        saveState();
    }
}

function addSubheadlineLanguage(lang, flag) {
    const text = getTextSettings();
    if (!text.subheadlineLanguages.includes(lang)) {
        text.subheadlineLanguages.push(lang);
        if (!text.subheadlines) text.subheadlines = { en: '' };
        text.subheadlines[lang] = '';
        updateSubheadlineLanguageUI();
        switchSubheadlineLanguage(lang);
        saveState();
    }
}

function removeHeadlineLanguage(lang) {
    const text = getTextSettings();
    if (lang === 'en') return; // Can't remove default
    
    const index = text.headlineLanguages.indexOf(lang);
    if (index > -1) {
        text.headlineLanguages.splice(index, 1);
        delete text.headlines[lang];
        
        if (text.currentHeadlineLang === lang) {
            text.currentHeadlineLang = 'en';
        }
        
        updateHeadlineLanguageUI();
        switchHeadlineLanguage(text.currentHeadlineLang);
        saveState();
    }
}

function removeSubheadlineLanguage(lang) {
    const text = getTextSettings();
    if (lang === 'en') return; // Can't remove default
    
    const index = text.subheadlineLanguages.indexOf(lang);
    if (index > -1) {
        text.subheadlineLanguages.splice(index, 1);
        delete text.subheadlines[lang];
        
        if (text.currentSubheadlineLang === lang) {
            text.currentSubheadlineLang = 'en';
        }
        
        updateSubheadlineLanguageUI();
        switchSubheadlineLanguage(text.currentSubheadlineLang);
        saveState();
    }
}

function switchHeadlineLanguage(lang) {
    const text = getTextSettings();
    text.currentHeadlineLang = lang;
    
    // Update UI
    document.querySelectorAll('#headline-languages .language-flag').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    
    // Load text for this language
    document.getElementById('headline-text').value = text.headlines[lang] || '';
    updateCanvas();
}

function switchSubheadlineLanguage(lang) {
    const text = getTextSettings();
    text.currentSubheadlineLang = lang;
    
    // Update UI
    document.querySelectorAll('#subheadline-languages .language-flag').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.lang === lang);
    });
    
    // Load text for this language
    document.getElementById('subheadline-text').value = text.subheadlines[lang] || '';
    updateCanvas();
}

function updateHeadlineLanguageUI() {
    const text = getTextSettings();
    const container = document.getElementById('headline-languages');
    container.innerHTML = '';
    
    text.headlineLanguages.forEach(lang => {
        const btn = document.createElement('button');
        btn.className = 'language-flag' + (lang === text.currentHeadlineLang ? ' active' : '');
        btn.dataset.lang = lang;
        btn.title = lang.toUpperCase();
        btn.innerHTML = languageFlags[lang] || '🏳️';
        
        if (lang !== 'en') {
            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-lang';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeHeadlineLanguage(lang);
            };
            btn.appendChild(removeBtn);
        }
        
        btn.onclick = () => switchHeadlineLanguage(lang);
        container.appendChild(btn);
    });
}

function updateSubheadlineLanguageUI() {
    const text = getTextSettings();
    const container = document.getElementById('subheadline-languages');
    container.innerHTML = '';
    
    text.subheadlineLanguages.forEach(lang => {
        const btn = document.createElement('button');
        btn.className = 'language-flag' + (lang === text.currentSubheadlineLang ? ' active' : '');
        btn.dataset.lang = lang;
        btn.title = lang.toUpperCase();
        btn.innerHTML = languageFlags[lang] || '🏳️';
        
        if (lang !== 'en') {
            const removeBtn = document.createElement('span');
            removeBtn.className = 'remove-lang';
            removeBtn.innerHTML = '×';
            removeBtn.onclick = (e) => {
                e.stopPropagation();
                removeSubheadlineLanguage(lang);
            };
            btn.appendChild(removeBtn);
        }
        
        btn.onclick = () => switchSubheadlineLanguage(lang);
        container.appendChild(btn);
    });
}

// Translate modal functions
let currentTranslateTarget = null;

const languageNames = {
    'en': 'English (US)', 'en-gb': 'English (UK)', 'de': 'German', 'fr': 'French', 
    'es': 'Spanish', 'it': 'Italian', 'pt': 'Portuguese', 'pt-br': 'Portuguese (BR)',
    'nl': 'Dutch', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean',
    'zh': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)', 'ar': 'Arabic',
    'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'sv': 'Swedish',
    'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'th': 'Thai',
    'vi': 'Vietnamese', 'id': 'Indonesian'
};

function openTranslateModal(target) {
    currentTranslateTarget = target;
    const text = getTextSettings();
    const isHeadline = target === 'headline';
    
    document.getElementById('translate-target-type').textContent = isHeadline ? 'Headline' : 'Subheadline';
    
    const languages = isHeadline ? text.headlineLanguages : text.subheadlineLanguages;
    const texts = isHeadline ? text.headlines : text.subheadlines;
    const currentLang = isHeadline ? text.currentHeadlineLang : text.currentSubheadlineLang;
    
    // Populate source language dropdown
    const sourceSelect = document.getElementById('translate-source-lang');
    sourceSelect.innerHTML = '';
    languages.forEach(lang => {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = `${languageFlags[lang]} ${languageNames[lang] || lang}`;
        if (lang === currentLang) option.selected = true;
        sourceSelect.appendChild(option);
    });
    
    // Update source preview
    updateTranslateSourcePreview();
    
    // Populate target languages
    const targetsContainer = document.getElementById('translate-targets');
    targetsContainer.innerHTML = '';
    
    languages.forEach(lang => {
        const item = document.createElement('div');
        item.className = 'translate-target-item';
        item.dataset.lang = lang;
        item.innerHTML = `
            <div class="translate-target-header">
                <span class="flag">${languageFlags[lang]}</span>
                <span>${languageNames[lang] || lang}</span>
            </div>
            <textarea placeholder="Enter ${languageNames[lang] || lang} translation...">${texts[lang] || ''}</textarea>
        `;
        targetsContainer.appendChild(item);
    });
    
    document.getElementById('translate-modal').classList.add('visible');
}

function updateTranslateSourcePreview() {
    const text = getTextSettings();
    const sourceLang = document.getElementById('translate-source-lang').value;
    const isHeadline = currentTranslateTarget === 'headline';
    const texts = isHeadline ? text.headlines : text.subheadlines;
    const sourceText = texts[sourceLang] || '';
    
    document.getElementById('source-text-preview').textContent = sourceText || 'No text entered';
}

function applyTranslations() {
    const text = getTextSettings();
    const isHeadline = currentTranslateTarget === 'headline';
    const texts = isHeadline ? text.headlines : text.subheadlines;
    
    // Get all translations from the modal
    document.querySelectorAll('#translate-targets .translate-target-item').forEach(item => {
        const lang = item.dataset.lang;
        const textarea = item.querySelector('textarea');
        texts[lang] = textarea.value;
    });
    
    // Update the current text field
    const currentLang = isHeadline ? text.currentHeadlineLang : text.currentSubheadlineLang;
    if (isHeadline) {
        document.getElementById('headline-text').value = texts[currentLang] || '';
    } else {
        document.getElementById('subheadline-text').value = texts[currentLang] || '';
    }
    
    saveState();
    updateCanvas();
}

async function aiTranslateAll() {
    const text = getTextSettings();
    const sourceLang = document.getElementById('translate-source-lang').value;
    const isHeadline = currentTranslateTarget === 'headline';
    const texts = isHeadline ? text.headlines : text.subheadlines;
    const languages = isHeadline ? text.headlineLanguages : text.subheadlineLanguages;
    const sourceText = texts[sourceLang] || '';
    
    if (!sourceText.trim()) {
        setTranslateStatus('Please enter text in the source language first', 'error');
        return;
    }
    
    // Get target languages (all except source)
    const targetLangs = languages.filter(lang => lang !== sourceLang);
    
    if (targetLangs.length === 0) {
        setTranslateStatus('Add more languages to translate to', 'error');
        return;
    }

    // Check for API key
    const apiKey = localStorage.getItem('claudeApiKey');
    
    const btn = document.getElementById('ai-translate-btn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4m-8-10h4m12 0h4m-5.66-5.66l-2.83 2.83m-5.66 5.66l-2.83 2.83m14.14 0l-2.83-2.83M6.34 6.34L3.51 3.51"/>
        </svg>
        <span>Translating...</span>
    `;
    
    setTranslateStatus(`Translating to ${targetLangs.length} language(s)...`, '');
    
    // Mark all target items as translating
    targetLangs.forEach(lang => {
        const item = document.querySelector(`.translate-target-item[data-lang="${lang}"]`);
        if (item) item.classList.add('translating');
    });
    
    try {
        // Build the translation prompt
        const targetLangNames = targetLangs.map(lang => `${languageNames[lang]} (${lang})`).join(', ');
        
        const prompt = `You are a professional translator for App Store screenshot marketing copy. Translate the following text from ${languageNames[sourceLang]} to these languages: ${targetLangNames}.

The text is a short marketing headline/tagline for an app, so keep translations:
- Concise and punchy (similar length to original)
- Marketing-focused and compelling
- Culturally appropriate for each target market
- Natural-sounding in each language

Source text (${languageNames[sourceLang]}):
"${sourceText}"

Respond ONLY with a valid JSON object mapping language codes to translations. Do not include any other text.
Example format:
{"de": "German translation", "fr": "French translation"}

Translate to these language codes: ${targetLangs.join(', ')}`;

        // Build headers - include API key if available
        const headers = {
            "Content-Type": "application/json",
        };
        
        if (apiKey) {
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2023-06-01";
            headers["anthropic-dangerous-direct-browser-access"] = "true";
        }

        const response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                model: "claude-sonnet-4-20250514",
                max_tokens: 1000,
                messages: [
                    { role: "user", content: prompt }
                ]
            })
        });

        if (!response.ok) {
            const status = response.status;
            if (status === 0 || status === 403 || status === 401) {
                throw new Error('AI_UNAVAILABLE');
            }
            throw new Error(`API request failed: ${status}`);
        }

        const data = await response.json();
        let responseText = data.content[0].text;
        
        // Clean up response - remove markdown code blocks if present
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        
        const translations = JSON.parse(responseText);
        
        // Apply translations to the textareas
        let translatedCount = 0;
        targetLangs.forEach(lang => {
            if (translations[lang]) {
                const item = document.querySelector(`.translate-target-item[data-lang="${lang}"]`);
                if (item) {
                    const textarea = item.querySelector('textarea');
                    textarea.value = translations[lang];
                    translatedCount++;
                }
            }
        });
        
        setTranslateStatus(`✓ Translated to ${translatedCount} language(s)`, 'success');
        
    } catch (error) {
        console.error('Translation error:', error);
        const apiKey = localStorage.getItem('claudeApiKey');
        
        if (error.message === 'Failed to fetch') {
            if (apiKey) {
                setTranslateStatus('Connection failed. Check your API key in Settings.', 'error');
            } else {
                setTranslateStatus('Add your Claude API key in Settings (gear icon) to use AI translation.', 'error');
            }
        } else if (error.message === 'AI_UNAVAILABLE') {
            setTranslateStatus('Add your Claude API key in Settings to use AI translation.', 'error');
        } else if (error.message.includes('401')) {
            setTranslateStatus('Invalid API key. Update it in Settings (gear icon).', 'error');
        } else {
            setTranslateStatus('Translation failed: ' + error.message, 'error');
        }
    } finally {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <span>Auto-translate with AI</span>
        `;
        
        // Remove translating state
        document.querySelectorAll('.translate-target-item').forEach(item => {
            item.classList.remove('translating');
        });
    }
}

function setTranslateStatus(message, type) {
    const status = document.getElementById('ai-translate-status');
    status.textContent = message;
    status.className = 'ai-translate-status' + (type ? ' ' + type : '');
}

// Settings modal functions
function openSettingsModal() {
    const savedKey = localStorage.getItem('claudeApiKey');
    const input = document.getElementById('settings-api-key');
    input.value = savedKey || '';
    input.type = 'password';
    
    const status = document.getElementById('settings-key-status');
    if (savedKey) {
        status.textContent = '✓ API key is saved';
        status.className = 'settings-key-status success';
    } else {
        status.textContent = '';
        status.className = 'settings-key-status';
    }
    
    document.getElementById('settings-modal').classList.add('visible');
}

function saveSettings() {
    const key = document.getElementById('settings-api-key').value.trim();
    const status = document.getElementById('settings-key-status');
    
    if (key) {
        if (key.startsWith('sk-ant-')) {
            localStorage.setItem('claudeApiKey', key);
            status.textContent = '✓ API key saved';
            status.className = 'settings-key-status success';
            
            setTimeout(() => {
                document.getElementById('settings-modal').classList.remove('visible');
            }, 500);
        } else {
            status.textContent = 'Invalid key format. Should start with sk-ant-';
            status.className = 'settings-key-status error';
        }
    } else {
        localStorage.removeItem('claudeApiKey');
        status.textContent = 'API key removed';
        status.className = 'settings-key-status';
        
        setTimeout(() => {
            document.getElementById('settings-modal').classList.remove('visible');
        }, 500);
    }
}

// Helper function to set text value (global or per-screenshot)
function setTextValue(key, value) {
    if (isPerScreenshotTextMode() && state.screenshots.length > 0) {
        const screenshot = state.screenshots[state.selectedIndex];
        if (!screenshot.overrides.text) {
            screenshot.overrides.text = { ...state.text };
        }
        screenshot.overrides.text[key] = value;
    } else {
        state.text[key] = value;
    }
}

// Helper function to get text settings for current screenshot
function getTextSettings() {
    if (state.screenshots.length > 0) {
        const screenshot = state.screenshots[state.selectedIndex];
        if (screenshot.overrides.text) {
            return screenshot.overrides.text;
        }
    }
    return state.text;
}

// Load text UI from current screenshot's override
function loadTextUIFromScreenshot() {
    if (state.screenshots.length === 0) return;
    const screenshot = state.screenshots[state.selectedIndex];
    const text = screenshot.overrides.text || state.text;
    updateTextUI(text);
}

// Load text UI from global settings
function loadTextUIFromGlobal() {
    updateTextUI(state.text);
}

// Update all text UI elements
function updateTextUI(text) {
    document.getElementById('headline-text').value = text.headline || '';
    document.getElementById('headline-font').value = text.headlineFont;
    document.getElementById('headline-size').value = text.headlineSize;
    document.getElementById('headline-size-value').textContent = text.headlineSize + 'px';
    document.getElementById('headline-weight').value = text.headlineWeight;
    document.getElementById('headline-color').value = text.headlineColor;
    document.getElementById('headline-color-hex').value = text.headlineColor;
    document.querySelectorAll('#text-position button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.position === text.position);
    });
    document.getElementById('text-offset-y').value = text.offsetY;
    document.getElementById('text-offset-y-value').textContent = text.offsetY + '%';
    document.getElementById('line-height').value = text.lineHeight;
    document.getElementById('line-height-value').textContent = text.lineHeight + '%';
    document.getElementById('subheadline-text').value = text.subheadline || '';
    document.getElementById('subheadline-size').value = text.subheadlineSize;
    document.getElementById('subheadline-size-value').textContent = text.subheadlineSize + 'px';
    document.getElementById('subheadline-color').value = text.subheadlineColor;
    document.getElementById('subheadline-color-hex').value = text.subheadlineColor;
    document.getElementById('subheadline-opacity').value = text.subheadlineOpacity;
    document.getElementById('subheadline-opacity-value').textContent = text.subheadlineOpacity + '%';
}

function applyPositionPreset(preset) {
    const presets = {
        'centered': { scale: 70, x: 50, y: 50, rotation: 0, perspective: 0 },
        'bleed-bottom': { scale: 85, x: 50, y: 120, rotation: 0, perspective: 0 },
        'bleed-top': { scale: 85, x: 50, y: -20, rotation: 0, perspective: 0 },
        'float-center': { scale: 60, x: 50, y: 50, rotation: 0, perspective: 0 },
        'tilt-left': { scale: 65, x: 50, y: 55, rotation: -8, perspective: 0 },
        'tilt-right': { scale: 65, x: 50, y: 55, rotation: 8, perspective: 0 },
        'perspective': { scale: 65, x: 50, y: 50, rotation: 0, perspective: 15 },
        'float-bottom': { scale: 55, x: 50, y: 70, rotation: 0, perspective: 0 }
    };

    const p = presets[preset];
    if (!p) return;

    state.screenshot.scale = p.scale;
    state.screenshot.x = p.x;
    state.screenshot.y = p.y;
    state.screenshot.rotation = p.rotation;
    state.screenshot.perspective = p.perspective;

    // Update UI controls
    document.getElementById('screenshot-scale').value = p.scale;
    document.getElementById('screenshot-scale-value').textContent = p.scale + '%';
    document.getElementById('screenshot-x').value = p.x;
    document.getElementById('screenshot-x-value').textContent = p.x + '%';
    document.getElementById('screenshot-y').value = p.y;
    document.getElementById('screenshot-y-value').textContent = p.y + '%';
    document.getElementById('screenshot-rotation').value = p.rotation;
    document.getElementById('screenshot-rotation-value').textContent = p.rotation + '°';

    updateCanvas();
}

function handleFiles(files) {
    Array.from(files).forEach(file => {
        if (file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const img = new Image();
                img.onload = () => {
                    // Detect device type based on aspect ratio
                    const ratio = img.width / img.height;
                    let deviceType = 'iPhone';
                    if (ratio > 0.6) {
                        deviceType = 'iPad';
                    }

                    state.screenshots.push({
                        image: img,
                        name: file.name,
                        deviceType: deviceType,
                        // Individual settings (can override global)
                        overrides: {}
                    });

                    updateScreenshotList();
                    if (state.screenshots.length === 1) {
                        state.selectedIndex = 0;
                    }
                    // Update 3D texture if in 3D mode
                    if (state.use3D && typeof updateScreenTexture === 'function') {
                        updateScreenTexture();
                    }
                    updateCanvas();
                };
                img.src = e.target.result;
            };
            reader.readAsDataURL(file);
        }
    });
}

function updateScreenshotList() {
    screenshotList.innerHTML = '';
    noScreenshot.style.display = state.screenshots.length === 0 ? 'block' : 'none';

    state.screenshots.forEach((screenshot, index) => {
        const item = document.createElement('div');
        item.className = 'screenshot-item' + (index === state.selectedIndex ? ' selected' : '');
        item.innerHTML = `
            <img class="screenshot-thumb" src="${screenshot.image.src}" alt="${screenshot.name}">
            <div class="screenshot-info">
                <div class="screenshot-name">${screenshot.name}</div>
                <div class="screenshot-device">${screenshot.deviceType}</div>
            </div>
            <button class="screenshot-delete" data-index="${index}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        item.addEventListener('click', (e) => {
            if (!e.target.closest('.screenshot-delete')) {
                state.selectedIndex = index;
                updateScreenshotList();
                // Update text UI if in per-screenshot mode
                if (isPerScreenshotTextMode()) {
                    loadTextUIFromScreenshot();
                }
                // Update 3D texture if in 3D mode
                if (state.use3D && typeof updateScreenTexture === 'function') {
                    updateScreenTexture();
                }
                updateCanvas();
            }
        });

        item.querySelector('.screenshot-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            state.screenshots.splice(index, 1);
            if (state.selectedIndex >= state.screenshots.length) {
                state.selectedIndex = Math.max(0, state.screenshots.length - 1);
            }
            updateScreenshotList();
            updateCanvas();
        });

        screenshotList.appendChild(item);
    });
}

function updateGradientStopsUI() {
    const container = document.getElementById('gradient-stops');
    container.innerHTML = '';

    state.background.gradient.stops.forEach((stop, index) => {
        const div = document.createElement('div');
        div.className = 'gradient-stop';
        div.innerHTML = `
            <input type="color" value="${stop.color}" data-stop="${index}">
            <input type="number" value="${stop.position}" min="0" max="100" data-stop="${index}">
            <span>%</span>
            ${index > 1 ? `<button class="screenshot-delete" data-stop="${index}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>` : ''}
        `;

        div.querySelector('input[type="color"]').addEventListener('input', (e) => {
            state.background.gradient.stops[index].color = e.target.value;
            updateCanvas();
        });

        div.querySelector('input[type="number"]').addEventListener('input', (e) => {
            state.background.gradient.stops[index].position = parseInt(e.target.value);
            updateCanvas();
        });

        const deleteBtn = div.querySelector('.screenshot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                state.background.gradient.stops.splice(index, 1);
                updateGradientStopsUI();
                updateCanvas();
            });
        }

        container.appendChild(div);
    });
}

function getCanvasDimensions() {
    if (state.outputDevice === 'custom') {
        return { width: state.customWidth, height: state.customHeight };
    }
    return deviceDimensions[state.outputDevice];
}

function updateCanvas() {
    saveState(); // Persist state on every update
    const dims = getCanvasDimensions();
    canvas.width = dims.width;
    canvas.height = dims.height;

    // Scale for preview
    const maxPreviewWidth = 400;
    const maxPreviewHeight = 700;
    const scale = Math.min(maxPreviewWidth / dims.width, maxPreviewHeight / dims.height);
    canvas.style.width = (dims.width * scale) + 'px';
    canvas.style.height = (dims.height * scale) + 'px';

    // Draw background
    drawBackground();

    // Draw screenshot (2D mode) or 3D phone model
    if (state.screenshots.length > 0) {
        if (state.use3D && typeof renderThreeJSToCanvas === 'function' && phoneModelLoaded) {
            // In 3D mode, update the screen texture and render the phone model
            if (typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            renderThreeJSToCanvas(canvas, dims.width, dims.height);
        } else if (!state.use3D) {
            // In 2D mode, draw the screenshot normally
            drawScreenshot();
        }
    }

    // Draw text
    drawText();

    // Draw noise overlay if enabled
    if (state.background.noise) {
        drawNoise();
    }
}

function drawBackground() {
    const dims = getCanvasDimensions();

    if (state.background.type === 'gradient') {
        const angle = state.background.gradient.angle * Math.PI / 180;
        const x1 = dims.width / 2 - Math.cos(angle) * dims.width;
        const y1 = dims.height / 2 - Math.sin(angle) * dims.height;
        const x2 = dims.width / 2 + Math.cos(angle) * dims.width;
        const y2 = dims.height / 2 + Math.sin(angle) * dims.height;

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        state.background.gradient.stops.forEach(stop => {
            gradient.addColorStop(stop.position / 100, stop.color);
        });

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, dims.width, dims.height);
    } else if (state.background.type === 'solid') {
        ctx.fillStyle = state.background.solid;
        ctx.fillRect(0, 0, dims.width, dims.height);
    } else if (state.background.type === 'image' && state.background.image) {
        const img = state.background.image;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        let dx = 0, dy = 0, dw = dims.width, dh = dims.height;

        if (state.background.imageFit === 'cover') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
        } else if (state.background.imageFit === 'contain') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                dh = dims.width / imgRatio;
                dy = (dims.height - dh) / 2;
            } else {
                dw = dims.height * imgRatio;
                dx = (dims.width - dw) / 2;
            }

            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, dims.width, dims.height);
        }

        if (state.background.imageBlur > 0) {
            ctx.filter = `blur(${state.background.imageBlur}px)`;
        }

        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.filter = 'none';

        // Overlay
        if (state.background.overlayOpacity > 0) {
            ctx.fillStyle = state.background.overlayColor;
            ctx.globalAlpha = state.background.overlayOpacity / 100;
            ctx.fillRect(0, 0, dims.width, dims.height);
            ctx.globalAlpha = 1;
        }
    }
}

function drawScreenshot() {
    const dims = getCanvasDimensions();
    const screenshot = state.screenshots[state.selectedIndex];
    if (!screenshot) return;

    const img = screenshot.image;
    const scale = state.screenshot.scale / 100;
    
    // Calculate scaled dimensions
    let imgWidth = dims.width * scale;
    let imgHeight = (img.height / img.width) * imgWidth;

    // If image is taller than canvas after scaling, adjust
    if (imgHeight > dims.height * scale) {
        imgHeight = dims.height * scale;
        imgWidth = (img.width / img.height) * imgHeight;
    }

    const x = (dims.width - imgWidth) * (state.screenshot.x / 100);
    const y = (dims.height - imgHeight) * (state.screenshot.y / 100);

    // Center point for transformations
    const centerX = x + imgWidth / 2;
    const centerY = y + imgHeight / 2;

    ctx.save();

    // Apply transformations
    ctx.translate(centerX, centerY);
    
    // Apply rotation
    if (state.screenshot.rotation !== 0) {
        ctx.rotate(state.screenshot.rotation * Math.PI / 180);
    }

    // Apply perspective (simulated with scale transform)
    if (state.screenshot.perspective !== 0) {
        const perspectiveScale = 1 - Math.abs(state.screenshot.perspective) * 0.005;
        ctx.transform(1, state.screenshot.perspective * 0.01, 0, 1, 0, 0);
    }

    ctx.translate(-centerX, -centerY);

    // Draw rounded rectangle with screenshot
    const radius = state.screenshot.cornerRadius * (imgWidth / 400); // Scale radius with image

    // Draw shadow first (needs a filled shape, not clipped)
    if (state.screenshot.shadow.enabled) {
        const shadowColor = hexToRgba(state.screenshot.shadow.color, state.screenshot.shadow.opacity / 100);
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = state.screenshot.shadow.blur;
        ctx.shadowOffsetX = state.screenshot.shadow.x;
        ctx.shadowOffsetY = state.screenshot.shadow.y;
        
        // Draw filled rounded rect for shadow
        ctx.fillStyle = '#000';
        ctx.beginPath();
        roundRect(ctx, x, y, imgWidth, imgHeight, radius);
        ctx.fill();
        
        // Reset shadow before drawing image
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }

    // Clip and draw image
    ctx.beginPath();
    roundRect(ctx, x, y, imgWidth, imgHeight, radius);
    ctx.clip();
    ctx.drawImage(img, x, y, imgWidth, imgHeight);
    
    ctx.restore();

    // Draw device frame if enabled (needs separate transform context)
    if (state.screenshot.frame.enabled) {
        ctx.save();
        ctx.translate(centerX, centerY);
        if (state.screenshot.rotation !== 0) {
            ctx.rotate(state.screenshot.rotation * Math.PI / 180);
        }
        if (state.screenshot.perspective !== 0) {
            ctx.transform(1, state.screenshot.perspective * 0.01, 0, 1, 0, 0);
        }
        ctx.translate(-centerX, -centerY);
        drawDeviceFrame(x, y, imgWidth, imgHeight);
        ctx.restore();
    }
}

function drawDeviceFrame(x, y, width, height) {
    const frameColor = state.screenshot.frame.color;
    const frameWidth = state.screenshot.frame.width * (width / 400); // Scale with image
    const frameOpacity = state.screenshot.frame.opacity / 100;
    const radius = state.screenshot.cornerRadius * (width / 400) + frameWidth;

    ctx.globalAlpha = frameOpacity;
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = frameWidth;
    ctx.beginPath();
    roundRect(ctx, x - frameWidth/2, y - frameWidth/2, width + frameWidth, height + frameWidth, radius);
    ctx.stroke();

    // Draw notch or dynamic island for iPhones (not for simple style)
    if (state.screenshot.frame.style !== 'simple' && state.screenshot.frame.style.includes('iphone')) {
        const notchWidth = width * 0.35;
        const notchHeight = height * 0.035;
        const notchX = x + (width - notchWidth) / 2;
        const notchY = y + frameWidth;

        if (state.screenshot.frame.style.includes('pro') || state.screenshot.frame.style === 'iphone-15') {
            // Dynamic Island
            const islandWidth = width * 0.25;
            const islandHeight = height * 0.025;
            const islandX = x + (width - islandWidth) / 2;
            const islandY = y + height * 0.015;

            ctx.fillStyle = '#000';
            ctx.beginPath();
            roundRect(ctx, islandX, islandY, islandWidth, islandHeight, islandHeight / 2);
            ctx.fill();
        } else {
            // Notch
            ctx.fillStyle = frameColor;
            ctx.beginPath();
            roundRect(ctx, notchX, notchY - frameWidth, notchWidth, notchHeight, notchHeight / 3);
            ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
}

function drawText() {
    const dims = getCanvasDimensions();
    const text = getTextSettings();

    // Get current language text
    const headline = text.headlines ? (text.headlines[text.currentHeadlineLang || 'en'] || '') : (text.headline || '');
    const subheadline = text.subheadlines ? (text.subheadlines[text.currentSubheadlineLang || 'en'] || '') : (text.subheadline || '');

    if (!headline && !subheadline) return;

    const padding = dims.width * 0.08;
    const textY = text.position === 'top' 
        ? dims.height * (text.offsetY / 100)
        : dims.height * (1 - text.offsetY / 100);

    ctx.textAlign = 'center';
    ctx.textBaseline = text.position === 'top' ? 'top' : 'bottom';

    let currentY = textY;

    // Draw headline
    if (headline) {
        ctx.font = `${text.headlineWeight} ${text.headlineSize}px ${text.headlineFont}`;
        ctx.fillStyle = text.headlineColor;

        const lines = wrapText(ctx, headline, dims.width - padding * 2);
        const lineHeight = text.headlineSize * (text.lineHeight / 100);

        if (text.position === 'bottom') {
            currentY -= (lines.length - 1) * lineHeight;
        }

        lines.forEach((line, i) => {
            ctx.fillText(line, dims.width / 2, currentY + i * lineHeight);
        });

        currentY += lines.length * lineHeight;
    }

    // Draw subheadline
    if (subheadline) {
        const subY = text.position === 'top' ? currentY + 20 : textY + 30;
        ctx.font = `400 ${text.subheadlineSize}px ${text.headlineFont}`;
        ctx.fillStyle = hexToRgba(text.subheadlineColor, text.subheadlineOpacity / 100);

        const lines = wrapText(ctx, subheadline, dims.width - padding * 2);
        const lineHeight = text.subheadlineSize * 1.4;

        lines.forEach((line, i) => {
            ctx.fillText(line, dims.width / 2, subY + i * lineHeight);
        });
    }
}

function drawNoise() {
    const dims = getCanvasDimensions();
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    const data = imageData.data;
    const intensity = state.background.noiseIntensity / 100 * 50;

    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * intensity;
        data[i] = Math.min(255, Math.max(0, data[i] + noise));
        data[i + 1] = Math.min(255, Math.max(0, data[i + 1] + noise));
        data[i + 2] = Math.min(255, Math.max(0, data[i + 2] + noise));
    }

    ctx.putImageData(imageData, 0, 0);
}

function roundRect(ctx, x, y, width, height, radius) {
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);

        if (metrics.width > maxWidth && currentLine) {
            lines.push(currentLine);
            currentLine = word;
        } else {
            currentLine = testLine;
        }
    });

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function exportCurrent() {
    if (state.screenshots.length === 0) {
        alert('Please upload a screenshot first');
        return;
    }

    // Ensure canvas is up-to-date (especially important for 3D mode)
    updateCanvas();

    const link = document.createElement('a');
    link.download = `screenshot-${state.selectedIndex + 1}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

async function exportAll() {
    if (state.screenshots.length === 0) {
        alert('Please upload screenshots first');
        return;
    }

    const originalIndex = state.selectedIndex;
    const zip = new JSZip();

    for (let i = 0; i < state.screenshots.length; i++) {
        state.selectedIndex = i;
        updateCanvas();

        await new Promise(resolve => setTimeout(resolve, 100));

        // Get canvas data as base64, strip the data URL prefix
        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');

        zip.file(`screenshot-${i + 1}.png`, base64Data, { base64: true });
    }

    state.selectedIndex = originalIndex;
    updateCanvas();

    // Generate and download the ZIP file
    const content = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.download = 'screenshots.zip';
    link.href = URL.createObjectURL(content);
    link.click();
    URL.revokeObjectURL(link.href);
}

// Initialize the app
initSync();

// ===========================
// MOBILE RESPONSIVE SUPPORT
// ===========================

// Check if we're on mobile
function isMobileView() {
    return window.innerWidth <= 768;
}

// Mobile UI state
let mobileSheetExpanded = false;
let mobileSheetStartY = 0;
let mobileSheetCurrentY = 0;
let mobileSheetIsDragging = false;

// Initialize mobile functionality
function initMobile() {
    console.log('initMobile called');
    if (!document.getElementById('mobile-bottom-sheet')) {
        console.log('mobile-bottom-sheet not found');
        return;
    }

    try {
        setupMobileBottomSheet();
        console.log('setupMobileBottomSheet done');
    } catch (e) { console.error('setupMobileBottomSheet error:', e); }

    try {
        setupMobileTabs();
        console.log('setupMobileTabs done');
    } catch (e) { console.error('setupMobileTabs error:', e); }

    try {
        setupMobileFAB();
        console.log('setupMobileFAB done');
    } catch (e) { console.error('setupMobileFAB error:', e); }

    try {
        setupMobileHeader();
        console.log('setupMobileHeader done');
    } catch (e) { console.error('setupMobileHeader error:', e); }

    try {
        setupMobileControlSync();
        console.log('setupMobileControlSync done');
    } catch (e) { console.error('setupMobileControlSync error:', e); }

    try {
        // Initial sync of mobile UI with state
        syncMobileUIWithState();
        console.log('syncMobileUIWithState done');
    } catch (e) { console.error('syncMobileUIWithState error:', e); }

    console.log('initMobile complete');
}

// Bottom sheet drag handling
function setupMobileBottomSheet() {
    const sheet = document.getElementById('mobile-bottom-sheet');
    const handle = document.getElementById('sheet-handle');

    if (!sheet || !handle) return;

    // Handle tap to toggle
    handle.addEventListener('click', (e) => {
        if (!mobileSheetIsDragging) {
            toggleMobileSheet();
        }
    });

    // Touch events for drag
    handle.addEventListener('touchstart', (e) => {
        mobileSheetIsDragging = false;
        mobileSheetStartY = e.touches[0].clientY;
        sheet.style.transition = 'none';
    }, { passive: true });

    handle.addEventListener('touchmove', (e) => {
        mobileSheetCurrentY = e.touches[0].clientY;
        const deltaY = mobileSheetCurrentY - mobileSheetStartY;

        if (Math.abs(deltaY) > 5) {
            mobileSheetIsDragging = true;
        }

        if (mobileSheetExpanded) {
            // Sheet is expanded, allow dragging down
            if (deltaY > 0) {
                sheet.style.transform = `translateY(${deltaY}px)`;
            }
        } else {
            // Sheet is collapsed, allow dragging up
            if (deltaY < 0) {
                const maxDrag = window.innerHeight * 0.85 - 70;
                const drag = Math.max(deltaY, -maxDrag);
                sheet.style.transform = `translateY(calc(100% - 70px + ${drag}px))`;
            }
        }
    }, { passive: true });

    handle.addEventListener('touchend', (e) => {
        sheet.style.transition = 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)';

        const deltaY = mobileSheetCurrentY - mobileSheetStartY;
        const threshold = 50;

        if (mobileSheetExpanded) {
            if (deltaY > threshold) {
                collapseMobileSheet();
            } else {
                expandMobileSheet();
            }
        } else {
            if (deltaY < -threshold) {
                expandMobileSheet();
            } else {
                collapseMobileSheet();
            }
        }

        // Reset drag flag after a short delay
        setTimeout(() => {
            mobileSheetIsDragging = false;
        }, 100);
    });

    // Click outside to collapse (on canvas area)
    document.querySelector('.canvas-area')?.addEventListener('click', () => {
        if (mobileSheetExpanded && isMobileView()) {
            collapseMobileSheet();
        }
    });
}

function toggleMobileSheet() {
    if (mobileSheetExpanded) {
        collapseMobileSheet();
    } else {
        expandMobileSheet();
    }
}

function expandMobileSheet() {
    const sheet = document.getElementById('mobile-bottom-sheet');
    if (sheet) {
        sheet.classList.add('expanded');
        sheet.style.transform = '';
        mobileSheetExpanded = true;
    }
}

function collapseMobileSheet() {
    const sheet = document.getElementById('mobile-bottom-sheet');
    if (sheet) {
        sheet.classList.remove('expanded');
        sheet.style.transform = '';
        mobileSheetExpanded = false;
    }
}

// Mobile tab switching
function setupMobileTabs() {
    const tabs = document.querySelectorAll('.mobile-tab');
    const panels = document.querySelectorAll('.mobile-panel');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const panelId = tab.dataset.panel;

            // Update tab active state
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update panel visibility
            panels.forEach(p => p.classList.remove('active'));
            const panel = document.getElementById('panel-' + panelId);
            if (panel) {
                panel.classList.add('active');
            }

            // Expand sheet when tab is clicked
            if (!mobileSheetExpanded) {
                expandMobileSheet();
            }

            // Scroll to top of panel
            document.getElementById('sheet-content')?.scrollTo(0, 0);
        });
    });
}

// Mobile FAB buttons
function setupMobileFAB() {
    // Upload button
    const uploadBtn = document.getElementById('mobile-upload-btn');
    const mobileFileInput = document.getElementById('mobile-file-input');

    if (uploadBtn && mobileFileInput) {
        uploadBtn.addEventListener('click', () => {
            mobileFileInput.click();
        });

        mobileFileInput.addEventListener('change', (e) => {
            handleFiles(e.target.files);
        });
    }

    // Export button
    const exportBtn = document.getElementById('mobile-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            if (state.screenshots.length === 0) {
                // Switch to screenshots tab and expand sheet
                document.querySelector('.mobile-tab[data-panel="screenshots"]')?.click();
            } else {
                exportCurrent();
            }
        });
    }
}

// Mobile header buttons
function setupMobileHeader() {
    const aboutBtn = document.getElementById('mobile-about-btn');
    const settingsBtn = document.getElementById('mobile-settings-btn');

    if (aboutBtn) {
        aboutBtn.addEventListener('click', () => {
            document.getElementById('about-modal').classList.add('visible');
        });
    }

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            openSettingsModal();
        });
    }
}

// Setup mobile controls to sync with state
function setupMobileControlSync() {
    // Mobile upload zone
    const mobileUploadZone = document.getElementById('mobile-upload-zone');
    const mobileFileInput = document.getElementById('mobile-file-input');

    if (mobileUploadZone && mobileFileInput) {
        mobileUploadZone.addEventListener('click', () => mobileFileInput.click());
        mobileUploadZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            mobileUploadZone.classList.add('dragover');
        });
        mobileUploadZone.addEventListener('dragleave', () => {
            mobileUploadZone.classList.remove('dragover');
        });
        mobileUploadZone.addEventListener('drop', (e) => {
            e.preventDefault();
            mobileUploadZone.classList.remove('dragover');
            handleFiles(e.dataTransfer.files);
        });
    }

    // Device selector
    document.querySelectorAll('#mobile-device-selector .device-option').forEach(opt => {
        opt.addEventListener('click', () => {
            // Update both mobile and desktop selectors
            document.querySelectorAll('.device-option').forEach(o => o.classList.remove('selected'));
            document.querySelectorAll(`.device-option[data-device="${opt.dataset.device}"]`).forEach(o => o.classList.add('selected'));

            state.outputDevice = opt.dataset.device;

            const showCustom = state.outputDevice === 'custom';
            document.getElementById('custom-size-inputs').style.display = showCustom ? 'block' : 'none';
            document.getElementById('mobile-custom-size-inputs').style.display = showCustom ? 'block' : 'none';

            updateCanvas();
        });
    });

    // Custom size inputs
    setupMobileRangeSync('mobile-custom-width', 'custom-width', (val) => {
        state.customWidth = parseInt(val) || 1290;
        updateCanvas();
    });
    setupMobileRangeSync('mobile-custom-height', 'custom-height', (val) => {
        state.customHeight = parseInt(val) || 2796;
        updateCanvas();
    });

    // Background type selector
    document.querySelectorAll('#mobile-bg-type-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update all background type selectors
            document.querySelectorAll('#bg-type-selector button, #mobile-bg-type-selector button').forEach(b => {
                b.classList.toggle('active', b.dataset.type === btn.dataset.type);
            });

            state.background.type = btn.dataset.type;

            // Update options visibility for both desktop and mobile
            ['gradient-options', 'solid-options', 'image-options', 'mobile-gradient-options', 'mobile-solid-options', 'mobile-image-options'].forEach(id => {
                const el = document.getElementById(id);
                if (el) {
                    const type = id.replace('mobile-', '').replace('-options', '');
                    el.style.display = type === state.background.type ? 'block' : 'none';
                }
            });

            updateCanvas();
        });
    });

    // Gradient presets
    document.querySelectorAll('#mobile-gradient-presets .preset-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            // Update all preset selections
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            document.querySelectorAll(`.preset-swatch[data-gradient="${swatch.dataset.gradient}"]`).forEach(s => s.classList.add('selected'));

            // Parse and apply gradient (same logic as desktop)
            const gradientStr = swatch.dataset.gradient;
            const angleMatch = gradientStr.match(/(\d+)deg/);
            const colorMatches = gradientStr.matchAll(/(#[a-fA-F0-9]{6})\s+(\d+)%/g);

            if (angleMatch) {
                state.background.gradient.angle = parseInt(angleMatch[1]);
            }

            const stops = [];
            for (const match of colorMatches) {
                stops.push({ color: match[1], position: parseInt(match[2]) });
            }
            if (stops.length >= 2) {
                state.background.gradient.stops = stops;
            }

            syncMobileUIWithState();
            updateGradientStopsUI();
            updateCanvas();
        });
    });

    // Gradient angle
    setupMobileSlider('mobile-gradient-angle', 'gradient-angle', 'mobile-gradient-angle-value', 'gradient-angle-value', '°', (val) => {
        state.background.gradient.angle = parseInt(val);
        updateCanvas();
    });

    // Noise toggle
    setupMobileToggle('mobile-noise-toggle', 'noise-toggle', () => {
        state.background.noise = !state.background.noise;
        document.getElementById('noise-options').style.display = state.background.noise ? 'block' : 'none';
        document.getElementById('mobile-noise-options').style.display = state.background.noise ? 'block' : 'none';
        updateCanvas();
    });

    // Noise intensity
    setupMobileSlider('mobile-noise-intensity', 'noise-intensity', 'mobile-noise-intensity-value', 'noise-intensity-value', '%', (val) => {
        state.background.noiseIntensity = parseInt(val);
        updateCanvas();
    });

    // Screenshot scale
    setupMobileSlider('mobile-screenshot-scale', 'screenshot-scale', 'mobile-screenshot-scale-value', 'screenshot-scale-value', '%', (val) => {
        state.screenshot.scale = parseInt(val);
        updateCanvas();
    });

    // Screenshot position Y
    setupMobileSlider('mobile-screenshot-y', 'screenshot-y', 'mobile-screenshot-y-value', 'screenshot-y-value', '%', (val) => {
        state.screenshot.y = parseInt(val);
        updateCanvas();
    });

    // Screenshot position X
    setupMobileSlider('mobile-screenshot-x', 'screenshot-x', 'mobile-screenshot-x-value', 'screenshot-x-value', '%', (val) => {
        state.screenshot.x = parseInt(val);
        updateCanvas();
    });

    // Corner radius
    setupMobileSlider('mobile-corner-radius', 'corner-radius', 'mobile-corner-radius-value', 'corner-radius-value', 'px', (val) => {
        state.screenshot.cornerRadius = parseInt(val);
        updateCanvas();
    });

    // Screenshot rotation
    setupMobileSlider('mobile-screenshot-rotation', 'screenshot-rotation', 'mobile-screenshot-rotation-value', 'screenshot-rotation-value', '°', (val) => {
        state.screenshot.rotation = parseInt(val);
        updateCanvas();
    });

    // Shadow toggle
    setupMobileToggle('mobile-shadow-toggle', 'shadow-toggle', () => {
        state.screenshot.shadow.enabled = !state.screenshot.shadow.enabled;
        document.getElementById('shadow-options').style.display = state.screenshot.shadow.enabled ? 'block' : 'none';
        document.getElementById('mobile-shadow-options').style.display = state.screenshot.shadow.enabled ? 'block' : 'none';
        updateCanvas();
    });

    // Shadow settings
    setupMobileSlider('mobile-shadow-blur', 'shadow-blur', 'mobile-shadow-blur-value', 'shadow-blur-value', 'px', (val) => {
        state.screenshot.shadow.blur = parseInt(val);
        updateCanvas();
    });
    setupMobileSlider('mobile-shadow-opacity', 'shadow-opacity', 'mobile-shadow-opacity-value', 'shadow-opacity-value', '%', (val) => {
        state.screenshot.shadow.opacity = parseInt(val);
        updateCanvas();
    });
    setupMobileSlider('mobile-shadow-y', 'shadow-y', 'mobile-shadow-y-value', 'shadow-y-value', 'px', (val) => {
        state.screenshot.shadow.y = parseInt(val);
        updateCanvas();
    });
    setupMobileSlider('mobile-shadow-x', 'shadow-x', 'mobile-shadow-x-value', 'shadow-x-value', 'px', (val) => {
        state.screenshot.shadow.x = parseInt(val);
        updateCanvas();
    });

    // Frame toggle
    setupMobileToggle('mobile-frame-toggle', 'frame-toggle', () => {
        state.screenshot.frame.enabled = !state.screenshot.frame.enabled;
        document.getElementById('frame-options').style.display = state.screenshot.frame.enabled ? 'block' : 'none';
        document.getElementById('mobile-frame-options').style.display = state.screenshot.frame.enabled ? 'block' : 'none';
        updateCanvas();
    });

    // Frame settings
    setupMobileSlider('mobile-frame-width', 'frame-width', 'mobile-frame-width-value', 'frame-width-value', 'px', (val) => {
        state.screenshot.frame.width = parseInt(val);
        updateCanvas();
    });
    setupMobileSlider('mobile-frame-opacity', 'frame-opacity', 'mobile-frame-opacity-value', 'frame-opacity-value', '%', (val) => {
        state.screenshot.frame.opacity = parseInt(val);
        updateCanvas();
    });

    // 3D toggle
    setupMobileToggle('mobile-use-3d-toggle', 'use-3d-toggle', () => {
        state.use3D = !state.use3D;

        // Show/hide options
        document.getElementById('rotation-3d-options').style.display = state.use3D ? 'block' : 'none';
        document.getElementById('mobile-rotation-3d-options').style.display = state.use3D ? 'block' : 'none';
        document.getElementById('2d-only-settings').style.display = state.use3D ? 'none' : 'block';
        document.getElementById('mobile-2d-only-settings').style.display = state.use3D ? 'none' : 'block';
        document.getElementById('position-presets-section').style.display = state.use3D ? 'none' : 'block';
        document.getElementById('mobile-position-presets-section').style.display = state.use3D ? 'none' : 'block';

        if (typeof showThreeJS === 'function') {
            showThreeJS(state.use3D);
        }
        updateCanvas();
    });

    // 3D rotation controls
    setupMobileSlider('mobile-rotation-3d-x', 'rotation-3d-x', 'mobile-rotation-3d-x-value', 'rotation-3d-x-value', '°', (val) => {
        state.rotation3D.x = parseInt(val);
        if (typeof updateThreeJS === 'function') updateThreeJS();
        updateCanvas();
    });
    setupMobileSlider('mobile-rotation-3d-y', 'rotation-3d-y', 'mobile-rotation-3d-y-value', 'rotation-3d-y-value', '°', (val) => {
        state.rotation3D.y = parseInt(val);
        if (typeof updateThreeJS === 'function') updateThreeJS();
        updateCanvas();
    });
    setupMobileSlider('mobile-rotation-3d-z', 'rotation-3d-z', 'mobile-rotation-3d-z-value', 'rotation-3d-z-value', '°', (val) => {
        state.rotation3D.z = parseInt(val);
        if (typeof updateThreeJS === 'function') updateThreeJS();
        updateCanvas();
    });
    setupMobileSlider('mobile-scale-3d', 'scale-3d', 'mobile-scale-3d-value', 'scale-3d-value', '%', (val) => {
        state.scale3D = parseInt(val);
        if (typeof updateThreeJS === 'function') updateThreeJS();
        updateCanvas();
    });

    // Position presets
    document.querySelectorAll('#mobile-position-presets .position-preset').forEach(preset => {
        preset.addEventListener('click', () => {
            // Update all preset selections
            document.querySelectorAll('.position-preset').forEach(p => p.classList.remove('active'));
            document.querySelectorAll(`.position-preset[data-preset="${preset.dataset.preset}"]`).forEach(p => p.classList.add('active'));

            applyPositionPreset(preset.dataset.preset);
            syncMobileUIWithState();
        });
    });

    // Text controls
    setupMobileTextarea('mobile-headline-text', 'headline-text', (val) => {
        const textSettings = getTextSettings();
        if (!textSettings.headlines) textSettings.headlines = {};
        textSettings.headlines[textSettings.currentHeadlineLang || 'en'] = val;
        updateCanvas();
    });

    setupMobileTextarea('mobile-subheadline-text', 'subheadline-text', (val) => {
        const textSettings = getTextSettings();
        if (!textSettings.subheadlines) textSettings.subheadlines = {};
        textSettings.subheadlines[textSettings.currentSubheadlineLang || 'en'] = val;
        updateCanvas();
    });

    setupMobileSlider('mobile-headline-size', 'headline-size', 'mobile-headline-size-value', 'headline-size-value', 'px', (val) => {
        state.text.headlineSize = parseInt(val);
        updateCanvas();
    });

    setupMobileSlider('mobile-subheadline-size', 'subheadline-size', 'mobile-subheadline-size-value', 'subheadline-size-value', 'px', (val) => {
        state.text.subheadlineSize = parseInt(val);
        updateCanvas();
    });

    setupMobileSlider('mobile-subheadline-opacity', 'subheadline-opacity', 'mobile-subheadline-opacity-value', 'subheadline-opacity-value', '%', (val) => {
        state.text.subheadlineOpacity = parseInt(val);
        updateCanvas();
    });

    setupMobileSlider('mobile-text-offset-y', 'text-offset-y', 'mobile-text-offset-y-value', 'text-offset-y-value', '%', (val) => {
        state.text.offsetY = parseInt(val);
        updateCanvas();
    });

    setupMobileSlider('mobile-line-height', 'line-height', 'mobile-line-height-value', 'line-height-value', '%', (val) => {
        state.text.lineHeight = parseInt(val);
        updateCanvas();
    });

    // Text position buttons
    document.querySelectorAll('#mobile-text-position button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#text-position button, #mobile-text-position button').forEach(b => {
                b.classList.toggle('active', b.dataset.position === btn.dataset.position);
            });
            state.text.position = btn.dataset.position;
            updateCanvas();
        });
    });

    // Export buttons
    document.getElementById('mobile-export-current')?.addEventListener('click', exportCurrent);
    document.getElementById('mobile-export-all')?.addEventListener('click', exportAll);

    // Project controls
    setupMobileProjectControls();
}

// Helper: Setup slider sync between mobile and desktop
function setupMobileSlider(mobileId, desktopId, mobileValueId, desktopValueId, suffix, callback) {
    const mobileInput = document.getElementById(mobileId);
    const desktopInput = document.getElementById(desktopId);

    if (mobileInput) {
        mobileInput.addEventListener('input', (e) => {
            const val = e.target.value;
            if (desktopInput) desktopInput.value = val;

            const mobileValue = document.getElementById(mobileValueId);
            const desktopValue = document.getElementById(desktopValueId);
            if (mobileValue) mobileValue.textContent = val + suffix;
            if (desktopValue) desktopValue.textContent = val + suffix;

            callback(val);
        });
    }
}

// Helper: Setup toggle sync between mobile and desktop
function setupMobileToggle(mobileId, desktopId, callback) {
    const mobileToggle = document.getElementById(mobileId);
    const desktopToggle = document.getElementById(desktopId);

    if (mobileToggle) {
        mobileToggle.addEventListener('click', () => {
            mobileToggle.classList.toggle('active');
            if (desktopToggle) desktopToggle.classList.toggle('active');
            callback();
        });
    }
}

// Helper: Setup textarea sync
function setupMobileTextarea(mobileId, desktopId, callback) {
    const mobileTextarea = document.getElementById(mobileId);
    const desktopTextarea = document.getElementById(desktopId);

    if (mobileTextarea) {
        mobileTextarea.addEventListener('input', (e) => {
            if (desktopTextarea) desktopTextarea.value = e.target.value;
            callback(e.target.value);
        });
    }
}

// Helper: Setup range sync
function setupMobileRangeSync(mobileId, desktopId, callback) {
    const mobileInput = document.getElementById(mobileId);
    const desktopInput = document.getElementById(desktopId);

    if (mobileInput) {
        mobileInput.addEventListener('input', (e) => {
            if (desktopInput) desktopInput.value = e.target.value;
            callback(e.target.value);
        });
    }
}

// Mobile project controls
function setupMobileProjectControls() {
    // Sync project selector
    const mobileSelector = document.getElementById('mobile-project-selector');
    const desktopSelector = document.getElementById('project-selector');

    if (mobileSelector) {
        mobileSelector.addEventListener('change', (e) => {
            if (desktopSelector) desktopSelector.value = e.target.value;
            switchProject(e.target.value);
        });
    }

    // Project buttons
    document.getElementById('mobile-new-project-btn')?.addEventListener('click', () => {
        document.getElementById('new-project-btn')?.click();
    });
    document.getElementById('mobile-save-project-btn')?.addEventListener('click', () => {
        document.getElementById('save-project-btn')?.click();
    });
    document.getElementById('mobile-rename-project-btn')?.addEventListener('click', () => {
        document.getElementById('rename-project-btn')?.click();
    });
    document.getElementById('mobile-delete-project-btn')?.addEventListener('click', () => {
        document.getElementById('delete-project-btn')?.click();
    });
}

// Sync mobile UI with current state
function syncMobileUIWithState() {
    // Device selector
    document.querySelectorAll('#mobile-device-selector .device-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.device === state.outputDevice);
    });
    const mobileCustomInputs = document.getElementById('mobile-custom-size-inputs');
    if (mobileCustomInputs) {
        mobileCustomInputs.style.display = state.outputDevice === 'custom' ? 'block' : 'none';
    }

    // Background type
    document.querySelectorAll('#mobile-bg-type-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === state.background.type);
    });

    const mobileGradientOptions = document.getElementById('mobile-gradient-options');
    const mobileSolidOptions = document.getElementById('mobile-solid-options');
    const mobileImageOptions = document.getElementById('mobile-image-options');
    if (mobileGradientOptions) mobileGradientOptions.style.display = state.background.type === 'gradient' ? 'block' : 'none';
    if (mobileSolidOptions) mobileSolidOptions.style.display = state.background.type === 'solid' ? 'block' : 'none';
    if (mobileImageOptions) mobileImageOptions.style.display = state.background.type === 'image' ? 'block' : 'none';

    // Gradient
    syncMobileValue('mobile-gradient-angle', state.background.gradient.angle);
    syncMobileValueLabel('mobile-gradient-angle-value', state.background.gradient.angle + '°');

    // Noise
    document.getElementById('mobile-noise-toggle')?.classList.toggle('active', state.background.noise);
    const mobileNoiseOptions = document.getElementById('mobile-noise-options');
    if (mobileNoiseOptions) mobileNoiseOptions.style.display = state.background.noise ? 'block' : 'none';
    syncMobileValue('mobile-noise-intensity', state.background.noiseIntensity);
    syncMobileValueLabel('mobile-noise-intensity-value', state.background.noiseIntensity + '%');

    // Screenshot settings
    syncMobileValue('mobile-screenshot-scale', state.screenshot.scale);
    syncMobileValueLabel('mobile-screenshot-scale-value', state.screenshot.scale + '%');
    syncMobileValue('mobile-screenshot-y', state.screenshot.y);
    syncMobileValueLabel('mobile-screenshot-y-value', state.screenshot.y + '%');
    syncMobileValue('mobile-screenshot-x', state.screenshot.x);
    syncMobileValueLabel('mobile-screenshot-x-value', state.screenshot.x + '%');
    syncMobileValue('mobile-corner-radius', state.screenshot.cornerRadius);
    syncMobileValueLabel('mobile-corner-radius-value', state.screenshot.cornerRadius + 'px');
    syncMobileValue('mobile-screenshot-rotation', state.screenshot.rotation);
    syncMobileValueLabel('mobile-screenshot-rotation-value', state.screenshot.rotation + '°');

    // Shadow
    document.getElementById('mobile-shadow-toggle')?.classList.toggle('active', state.screenshot.shadow.enabled);
    const mobileShadowOptions = document.getElementById('mobile-shadow-options');
    if (mobileShadowOptions) mobileShadowOptions.style.display = state.screenshot.shadow.enabled ? 'block' : 'none';
    syncMobileValue('mobile-shadow-blur', state.screenshot.shadow.blur);
    syncMobileValueLabel('mobile-shadow-blur-value', state.screenshot.shadow.blur + 'px');
    syncMobileValue('mobile-shadow-opacity', state.screenshot.shadow.opacity);
    syncMobileValueLabel('mobile-shadow-opacity-value', state.screenshot.shadow.opacity + '%');
    syncMobileValue('mobile-shadow-y', state.screenshot.shadow.y);
    syncMobileValueLabel('mobile-shadow-y-value', state.screenshot.shadow.y + 'px');
    syncMobileValue('mobile-shadow-x', state.screenshot.shadow.x);
    syncMobileValueLabel('mobile-shadow-x-value', state.screenshot.shadow.x + 'px');

    // Frame
    document.getElementById('mobile-frame-toggle')?.classList.toggle('active', state.screenshot.frame.enabled);
    const mobileFrameOptions = document.getElementById('mobile-frame-options');
    if (mobileFrameOptions) mobileFrameOptions.style.display = state.screenshot.frame.enabled ? 'block' : 'none';
    syncMobileValue('mobile-frame-width', state.screenshot.frame.width);
    syncMobileValueLabel('mobile-frame-width-value', state.screenshot.frame.width + 'px');
    syncMobileValue('mobile-frame-opacity', state.screenshot.frame.opacity);
    syncMobileValueLabel('mobile-frame-opacity-value', state.screenshot.frame.opacity + '%');

    // 3D
    document.getElementById('mobile-use-3d-toggle')?.classList.toggle('active', state.use3D);
    const mobile3DOptions = document.getElementById('mobile-rotation-3d-options');
    const mobile2DSettings = document.getElementById('mobile-2d-only-settings');
    const mobilePositionPresets = document.getElementById('mobile-position-presets-section');
    if (mobile3DOptions) mobile3DOptions.style.display = state.use3D ? 'block' : 'none';
    if (mobile2DSettings) mobile2DSettings.style.display = state.use3D ? 'none' : 'block';
    if (mobilePositionPresets) mobilePositionPresets.style.display = state.use3D ? 'none' : 'block';

    syncMobileValue('mobile-rotation-3d-x', state.rotation3D.x);
    syncMobileValueLabel('mobile-rotation-3d-x-value', state.rotation3D.x + '°');
    syncMobileValue('mobile-rotation-3d-y', state.rotation3D.y);
    syncMobileValueLabel('mobile-rotation-3d-y-value', state.rotation3D.y + '°');
    syncMobileValue('mobile-rotation-3d-z', state.rotation3D.z);
    syncMobileValueLabel('mobile-rotation-3d-z-value', state.rotation3D.z + '°');
    syncMobileValue('mobile-scale-3d', state.scale3D);
    syncMobileValueLabel('mobile-scale-3d-value', state.scale3D + '%');

    // Text
    const currentHeadline = state.text.headlines ? (state.text.headlines[state.text.currentHeadlineLang || 'en'] || '') : '';
    const mobileHeadlineText = document.getElementById('mobile-headline-text');
    if (mobileHeadlineText) mobileHeadlineText.value = currentHeadline;

    syncMobileValue('mobile-headline-size', state.text.headlineSize);
    syncMobileValueLabel('mobile-headline-size-value', state.text.headlineSize + 'px');

    const currentSubheadline = state.text.subheadlines ? (state.text.subheadlines[state.text.currentSubheadlineLang || 'en'] || '') : '';
    const mobileSubheadlineText = document.getElementById('mobile-subheadline-text');
    if (mobileSubheadlineText) mobileSubheadlineText.value = currentSubheadline;

    syncMobileValue('mobile-subheadline-size', state.text.subheadlineSize);
    syncMobileValueLabel('mobile-subheadline-size-value', state.text.subheadlineSize + 'px');
    syncMobileValue('mobile-subheadline-opacity', state.text.subheadlineOpacity);
    syncMobileValueLabel('mobile-subheadline-opacity-value', state.text.subheadlineOpacity + '%');
    syncMobileValue('mobile-text-offset-y', state.text.offsetY);
    syncMobileValueLabel('mobile-text-offset-y-value', state.text.offsetY + '%');
    syncMobileValue('mobile-line-height', state.text.lineHeight);
    syncMobileValueLabel('mobile-line-height-value', state.text.lineHeight + '%');

    // Text position
    document.querySelectorAll('#mobile-text-position button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.position === state.text.position);
    });

    // Update mobile screenshot list
    updateMobileScreenshotList();

    // Update mobile project selector
    updateMobileProjectSelector();
}

// Helper functions for syncing values
function syncMobileValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function syncMobileValueLabel(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

// Update mobile screenshot list
function updateMobileScreenshotList() {
    const mobileList = document.getElementById('mobile-screenshot-list');
    if (!mobileList) return;

    mobileList.innerHTML = '';

    state.screenshots.forEach((screenshot, index) => {
        const item = document.createElement('div');
        item.className = 'screenshot-item' + (index === state.selectedIndex ? ' selected' : '');
        item.innerHTML = `
            <img src="${screenshot.image.src}" class="screenshot-thumb" alt="Screenshot ${index + 1}">
            <div class="screenshot-info">
                <div class="screenshot-name">${screenshot.name}</div>
                <div class="screenshot-device">${screenshot.deviceType}</div>
            </div>
            <button class="screenshot-delete" data-index="${index}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        item.addEventListener('click', (e) => {
            if (!e.target.closest('.screenshot-delete')) {
                state.selectedIndex = index;
                updateScreenshotList();
                updateMobileScreenshotList();
                syncMobileUIWithState();
                updateCanvas();
            }
        });

        item.querySelector('.screenshot-delete').addEventListener('click', (e) => {
            e.stopPropagation();
            state.screenshots.splice(index, 1);
            if (state.selectedIndex >= state.screenshots.length) {
                state.selectedIndex = Math.max(0, state.screenshots.length - 1);
            }
            updateScreenshotList();
            updateMobileScreenshotList();
            updateCanvas();
        });

        mobileList.appendChild(item);
    });
}

// Update mobile project selector
function updateMobileProjectSelector() {
    const mobileSelector = document.getElementById('mobile-project-selector');
    if (!mobileSelector) return;

    mobileSelector.innerHTML = '';
    projects.forEach(project => {
        const option = document.createElement('option');
        option.value = project.id;
        option.textContent = project.name;
        option.selected = project.id === currentProjectId;
        mobileSelector.appendChild(option);
    });
}

// Override updateScreenshotList to also update mobile list
const originalUpdateScreenshotList = updateScreenshotList;
updateScreenshotList = function() {
    originalUpdateScreenshotList();
    updateMobileScreenshotList();
};

// Override syncUIWithState to also sync mobile
const originalSyncUIWithState = syncUIWithState;
syncUIWithState = function() {
    originalSyncUIWithState();
    syncMobileUIWithState();
};

// Override updateProjectSelector to also update mobile
const originalUpdateProjectSelector = updateProjectSelector;
updateProjectSelector = function() {
    originalUpdateProjectSelector();
    updateMobileProjectSelector();
};

// Initialize mobile - call directly since script loads after DOM
let mobileInitialized = false;
function safeInitMobile() {
    if (mobileInitialized) return;
    mobileInitialized = true;
    initMobile();
}

// Try to init immediately if DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', safeInitMobile);
} else {
    // DOM is already ready, init immediately
    safeInitMobile();
}

// Also init on load (backup)
window.addEventListener('load', safeInitMobile);