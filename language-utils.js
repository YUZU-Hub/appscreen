// Language utilities for localized screenshot management
// This file handles language detection, localized image management, and translation dialogs

// Current screenshot index for translations modal
let currentTranslationsIndex = null;

/**
 * Extract the base filename without language suffix
 * e.g., "screenshot_de.png" -> "screenshot", "image-fr.png" -> "image"
 * @param {string} filename - The filename to parse
 * @returns {string} - Base filename without language suffix and extension
 */
function getBaseFilename(filename) {
    // Remove extension
    const withoutExt = filename.replace(/\.[^.]+$/, '');

    // All supported language codes from languageFlags
    const supportedLangs = Object.keys(languageFlags);

    // Sort by length (longest first) to match pt-br before pt
    const sortedLangs = [...supportedLangs].sort((a, b) => b.length - a.length);

    for (const lang of sortedLangs) {
        // Match patterns like: _pt-br, -pt-br, _pt_br, -pt_br, _de, -de
        const escapedLang = lang.replace('-', '[-_]?');
        const pattern = new RegExp(`[_-]${escapedLang}(?:[_-][a-z]{2})?$`, 'i');
        if (pattern.test(withoutExt)) {
            return withoutExt.replace(pattern, '');
        }
    }

    return withoutExt;
}

/**
 * Find an existing screenshot with a matching base filename
 * @param {string} filename - The filename to check
 * @returns {number} - Index of matching screenshot, or -1 if not found
 */
function findScreenshotByBaseFilename(filename) {
    const baseName = getBaseFilename(filename);

    for (let i = 0; i < state.screenshots.length; i++) {
        const screenshot = state.screenshots[i];
        if (!screenshot.localizedImages) continue;

        // Check each localized image's filename
        for (const lang of Object.keys(screenshot.localizedImages)) {
            const localizedName = screenshot.localizedImages[lang]?.name;
            if (localizedName && getBaseFilename(localizedName) === baseName) {
                return i;
            }
        }
    }

    return -1;
}

/**
 * Detect language code from filename
 * Supports patterns like: screenshot_de.png, screenshot-fr.png, screenshot_pt-br.png
 * @param {string} filename - The filename to parse
 * @returns {string} - Language code (e.g., 'de', 'fr', 'pt-br') or 'en' as fallback
 */
function detectLanguageFromFilename(filename) {
    // All supported language codes from languageFlags (defined in app.js)
    const supportedLangs = Object.keys(languageFlags);

    // Normalize filename for matching
    const lower = filename.toLowerCase();

    // Check for longer codes first (pt-br, zh-tw, en-gb) to avoid false matches
    const sortedLangs = [...supportedLangs].sort((a, b) => b.length - a.length);

    for (const lang of sortedLangs) {
        // Match patterns like: _pt-br., -pt-br., _pt_br., -pt_br.
        // Also: _de., -de., _DE., -DE., _de-DE., etc.
        const escapedLang = lang.replace('-', '[-_]?');
        const pattern = new RegExp(`[_-]${escapedLang}(?:[_-][a-z]{2})?\\.`, 'i');
        if (pattern.test(lower)) {
            return lang;
        }
    }

    return 'en'; // fallback to English
}

/**
 * Get the appropriate image for a screenshot based on current language
 * Falls back to first available language if current language has no image
 * @param {Object} screenshot - The screenshot object
 * @returns {Image|null} - The Image object to use for rendering
 */
function getScreenshotImage(screenshot) {
    if (!screenshot) return null;

    const lang = state.currentLanguage;

    // Try current language first
    if (screenshot.localizedImages?.[lang]?.image) {
        return screenshot.localizedImages[lang].image;
    }

    // Fallback to first available language in project order
    for (const l of state.projectLanguages) {
        if (screenshot.localizedImages?.[l]?.image) {
            return screenshot.localizedImages[l].image;
        }
    }

    // Fallback to any available language
    if (screenshot.localizedImages) {
        for (const l of Object.keys(screenshot.localizedImages)) {
            if (screenshot.localizedImages[l]?.image) {
                return screenshot.localizedImages[l].image;
            }
        }
    }

    // Legacy fallback for old screenshot format
    return screenshot.image || null;
}

/**
 * Get list of languages that have images for a screenshot
 * @param {Object} screenshot - The screenshot object
 * @returns {string[]} - Array of language codes that have images
 */
function getAvailableLanguagesForScreenshot(screenshot) {
    if (!screenshot?.localizedImages) return [];

    return Object.keys(screenshot.localizedImages).filter(
        lang => screenshot.localizedImages[lang]?.image
    );
}

/**
 * Check if a screenshot has images for all project languages
 * @param {Object} screenshot - The screenshot object
 * @returns {boolean} - True if all project languages have images
 */
function isScreenshotComplete(screenshot) {
    if (!screenshot?.localizedImages) return false;
    if (state.projectLanguages.length === 0) return true;

    return state.projectLanguages.every(
        lang => screenshot.localizedImages[lang]?.image
    );
}

/**
 * Migrate old screenshot format to new localized format
 * Moves image to localizedImages.en (or detected language)
 * @param {Object} screenshot - The screenshot object to migrate
 * @param {string} detectedLang - Optional detected language from filename
 */
function migrateScreenshotToLocalized(screenshot, detectedLang = 'en') {
    if (!screenshot) return;

    // Already migrated
    if (screenshot.localizedImages && Object.keys(screenshot.localizedImages).length > 0) {
        return;
    }

    // Initialize localizedImages if needed
    if (!screenshot.localizedImages) {
        screenshot.localizedImages = {};
    }

    // Move legacy image to localized storage
    if (screenshot.image) {
        screenshot.localizedImages[detectedLang] = {
            image: screenshot.image,
            src: screenshot.image.src,
            name: screenshot.name || 'screenshot.png'
        };
    }
}

/**
 * Add a localized image to a screenshot
 * @param {number} screenshotIndex - Index of the screenshot
 * @param {string} lang - Language code
 * @param {Image} image - The Image object
 * @param {string} src - Data URL of the image
 * @param {string} name - Filename
 */
function addLocalizedImage(screenshotIndex, lang, image, src, name) {
    const screenshot = state.screenshots[screenshotIndex];
    if (!screenshot) return;

    if (!screenshot.localizedImages) {
        screenshot.localizedImages = {};
    }

    screenshot.localizedImages[lang] = {
        image: image,
        src: src,
        name: name
    };

    // Update displays
    updateScreenshotList();
    updateCanvas();
    saveState();
}

/**
 * Remove a localized image from a screenshot
 * @param {number} screenshotIndex - Index of the screenshot
 * @param {string} lang - Language code to remove
 */
function removeLocalizedImage(screenshotIndex, lang) {
    const screenshot = state.screenshots[screenshotIndex];
    if (!screenshot?.localizedImages?.[lang]) return;

    delete screenshot.localizedImages[lang];

    // Update displays
    updateScreenshotList();
    updateCanvas();
    saveState();

    // Refresh modal if open
    if (currentTranslationsIndex === screenshotIndex) {
        updateScreenshotTranslationsList();
    }
}

// ==========================================
// Screenshot Translations Modal Functions
// ==========================================

/**
 * Open the screenshot translations modal for a specific screenshot
 * @param {number} index - Index of the screenshot to manage
 */
function openScreenshotTranslationsModal(index) {
    currentTranslationsIndex = index;
    const modal = document.getElementById('screenshot-translations-modal');
    if (!modal) return;

    modal.classList.add('visible');
    updateScreenshotTranslationsList();
}

/**
 * Close the screenshot translations modal
 */
function closeScreenshotTranslationsModal() {
    currentTranslationsIndex = null;
    const modal = document.getElementById('screenshot-translations-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
}

/**
 * Update the list of languages in the translations modal
 */
function updateScreenshotTranslationsList() {
    const container = document.getElementById('screenshot-translations-list');
    if (!container || currentTranslationsIndex === null) return;

    const screenshot = state.screenshots[currentTranslationsIndex];
    if (!screenshot) return;

    container.innerHTML = '';

    state.projectLanguages.forEach(lang => {
        const hasImage = screenshot.localizedImages?.[lang]?.image;
        const flag = languageFlags[lang] || '🏳️';
        const name = languageNames[lang] || lang.toUpperCase();

        const item = document.createElement('div');
        item.className = 'translation-item' + (hasImage ? ' has-image' : '');

        if (hasImage) {
            // Create thumbnail
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = 40;
            thumbCanvas.height = 86;
            const ctx = thumbCanvas.getContext('2d');
            const img = screenshot.localizedImages[lang].image;
            const scale = Math.min(40 / img.width, 86 / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (40 - w) / 2, (86 - h) / 2, w, h);

            item.innerHTML = `
                <div class="translation-thumb">
                    <img src="${thumbCanvas.toDataURL()}" alt="${name}">
                </div>
                <div class="translation-info">
                    <span class="flag">${flag}</span>
                    <span class="name">${name}</span>
                </div>
                <button class="translation-remove" title="Remove ${name} screenshot">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            `;

            item.querySelector('.translation-remove').addEventListener('click', () => {
                removeLocalizedImage(currentTranslationsIndex, lang);
            });
        } else {
            item.innerHTML = `
                <div class="translation-thumb empty">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <path d="M21 15l-5-5L5 21"/>
                    </svg>
                </div>
                <div class="translation-info">
                    <span class="flag">${flag}</span>
                    <span class="name">${name}</span>
                </div>
                <button class="translation-upload" title="Upload ${name} screenshot">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                        <polyline points="17 8 12 3 7 8"/>
                        <line x1="12" y1="3" x2="12" y2="15"/>
                    </svg>
                    Upload
                </button>
            `;

            item.querySelector('.translation-upload').addEventListener('click', () => {
                uploadScreenshotForLanguage(lang);
            });
        }

        container.appendChild(item);
    });
}

/**
 * Trigger file upload for a specific language
 * @param {string} lang - Language code to upload for
 */
function uploadScreenshotForLanguage(lang) {
    const input = document.getElementById('translation-file-input');
    if (!input) return;

    // Store the target language
    input.dataset.targetLang = lang;
    input.click();
}

/**
 * Handle file selection for translation upload
 * @param {Event} event - The change event from file input
 */
function handleTranslationFileSelect(event) {
    const input = event.target;
    const lang = input.dataset.targetLang;
    const file = input.files?.[0];

    if (!file || !lang || currentTranslationsIndex === null) {
        input.value = '';
        return;
    }

    if (!file.type.startsWith('image/')) {
        input.value = '';
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            addLocalizedImage(currentTranslationsIndex, lang, img, e.target.result, file.name);
            updateScreenshotTranslationsList();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);

    input.value = '';
}

// ==========================================
// Export Language Dialog Functions
// ==========================================

/**
 * Show export language choice dialog
 * @param {Function} callback - Function to call with choice ('current' or 'all')
 */
function showExportLanguageDialog(callback) {
    const modal = document.getElementById('export-language-modal');
    if (!modal) {
        // Fallback if modal doesn't exist
        callback('current');
        return;
    }

    // Store callback for later
    window._exportLanguageCallback = callback;

    // Update current language display
    const currentLangDisplay = document.getElementById('export-current-lang');
    if (currentLangDisplay) {
        const flag = languageFlags[state.currentLanguage] || '🏳️';
        const name = languageNames[state.currentLanguage] || state.currentLanguage.toUpperCase();
        currentLangDisplay.textContent = `${flag} ${name}`;
    }

    modal.classList.add('visible');
}

/**
 * Close export language dialog and execute callback
 * @param {string} choice - 'current' or 'all'
 */
function closeExportLanguageDialog(choice) {
    const modal = document.getElementById('export-language-modal');
    if (modal) {
        modal.classList.remove('visible');
    }

    if (window._exportLanguageCallback && choice) {
        window._exportLanguageCallback(choice);
        window._exportLanguageCallback = null;
    }
}
