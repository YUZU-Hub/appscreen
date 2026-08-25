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
function stripLanguageSuffix(filename) {
    // Remove the final extension once; both detection and grouping work on this
    const withoutExt = filename.replace(/\.[^.]+$/, '');

    // All supported language codes from languageFlags (defined in app.js)
    const supportedLangs = Object.keys(languageFlags);

    // Sort by length (longest first) to match pt-br before pt
    const sortedLangs = [...supportedLangs].sort((a, b) => b.length - a.length);

    for (const lang of sortedLangs) {
        // Match suffixes anchored at the END of the basename, with a REQUIRED
        // separator: _pt-br, -pt-br, _pt_br, -pt_br, _de, -de, _de-DE
        const escapedLang = lang.replace(/-/g, '[-_]');
        const pattern = new RegExp(`[_-]${escapedLang}(?:[-_][a-z]{2,4})?$`, 'i');
        if (pattern.test(withoutExt)) {
            return { base: withoutExt.replace(pattern, ''), lang };
        }
    }

    return { base: withoutExt, lang: null };
}

function getBaseFilename(filename) {
    return stripLanguageSuffix(filename).base;
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
    // Same stripped basename + end-anchored suffix matching as getBaseFilename,
    // so detection and grouping always agree
    return stripLanguageSuffix(filename).lang || 'en'; // fallback to English
}

/**
 * Get the appropriate image for a screenshot based on current language
 * Falls back to first available language if current language has no image
 * @param {Object} screenshot - The screenshot object
 * @returns {Image|null} - The Image object to use for rendering
 */
function getScreenshotImage(screenshot) {
    if (!screenshot) return null;

    // Return a loaded bitmap, lazily decoding the entry from disk if needed
    // (ensureEntryImage lives in app.js; returns null until loaded, then re-renders).
    const pick = (entry) => {
        if (!entry || !entry.src) return null;
        if (entry.image) return entry.image;
        return typeof ensureEntryImage === 'function' ? ensureEntryImage(entry) : null;
    };

    const li = screenshot.localizedImages;
    if (li) {
        const lang = state.currentLanguage;
        if (li[lang]?.src) return pick(li[lang]);
        for (const l of state.projectLanguages) if (li[l]?.src) return pick(li[l]);
        for (const l of Object.keys(li)) if (li[l]?.src) return pick(li[l]);
    }

    // Legacy fallback for old screenshot format
    return screenshot.image || null;
}

/**
 * Check if a localized image entry has a usable image source
 * Based on having a SOURCE (ref or data URL), not a decoded bitmap —
 * images load lazily, so .image may be absent until shown.
 * @param {Object} entry - Localized image entry
 * @returns {boolean} - True if the entry has an image source
 */
function entryHasImage(entry) {
    return !!(entry && entry.src);
}

/**
 * Get list of languages that have images for a screenshot
 * @param {Object} screenshot - The screenshot object
 * @returns {string[]} - Array of language codes that have images
 */
function getAvailableLanguagesForScreenshot(screenshot) {
    if (!screenshot?.localizedImages) return [];

    // Based on having an image SOURCE (ref or data URL), not a decoded bitmap —
    // images load lazily now, so .image may be absent until shown.
    return Object.keys(screenshot.localizedImages).filter(
        lang => screenshot.localizedImages[lang]?.src
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
        lang => screenshot.localizedImages[lang]?.src
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

    // Pending-upload ledger (app.js): the file is only "saved" once the server
    // has confirmed both its bytes and the record referencing it.
    if (typeof trackPendingUpload === 'function') trackPendingUpload(lang, name, src);

    // Auto-add language to project if not already present
    if (!state.projectLanguages.includes(lang)) {
        addProjectLanguage(lang);
    }

    // Update displays
    updateScreenshotList();
    updateCanvas();
    if (typeof scheduleSaveState === 'function') scheduleSaveState(); else saveState();
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
        const entry = screenshot.localizedImages?.[lang];
        const hasImage = !!(entry && entry.src);
        // Load the thumbnail straight from the server blob URL (lazy, HTTP-cached)
        // instead of requiring an already-decoded bitmap.
        const thumbUrl = hasImage ? (typeof blobUrlForRef === 'function' ? blobUrlForRef(entry.src) : entry.src) : null;
        const flag = languageFlags[lang] || '🏳️';
        const name = languageNames[lang] || lang.toUpperCase();

        const item = document.createElement('div');
        item.className = 'translation-item' + (hasImage ? ' has-image' : '');

        if (hasImage) {
            item.innerHTML = `
                <div class="translation-thumb">
                    <img src="${thumbUrl}" alt="${name}" loading="lazy">
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
    const idx = currentTranslationsIndex;

    if (!file || !lang || idx === null) {
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
            addLocalizedImage(idx, lang, img, e.target.result, file.name);
            if (currentTranslationsIndex === idx) {
                updateScreenshotTranslationsList();
            }
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

    const callback = window._exportLanguageCallback;
    window._exportLanguageCallback = null;
    if (callback && choice) {
        callback(choice);
    }
}

// ==========================================
// Duplicate Screenshot Dialog Functions
// ==========================================

// Pending duplicate resolution
let currentDuplicateResolve = null;

/**
 * Show duplicate screenshot dialog
 * @param {Object} params - Parameters for the dialog
 * @param {number} params.existingIndex - Index of existing screenshot
 * @param {string} params.detectedLang - Detected language of new file
 * @param {Image} params.newImage - New image object
 * @param {string} params.newSrc - Data URL of new image
 * @param {string} params.newName - Filename of new file
 * @returns {Promise<string>} - User choice: 'replace', 'create', or 'ignore'
 */
function showDuplicateDialog(params) {
    return new Promise((resolve) => {
        currentDuplicateResolve = resolve;

        const modal = document.getElementById('duplicate-screenshot-modal');
        if (!modal) {
            resolve('create'); // fallback
            return;
        }

        const screenshot = state.screenshots[params.existingIndex];
        const existingThumb = document.getElementById('duplicate-existing-thumb');
        const newThumb = document.getElementById('duplicate-new-thumb');
        const existingName = document.getElementById('duplicate-existing-name');
        const newName = document.getElementById('duplicate-new-name');
        const langNameEl = document.getElementById('duplicate-lang-name');

        // Get existing thumbnail for the specific language being replaced. Use the
        // entry's source (ref/data URL) via a loadable URL — the bitmap may not be
        // decoded yet (lazy loading).
        const existingEntry = screenshot.localizedImages?.[params.detectedLang];
        const existingUrl = existingEntry && existingEntry.src
            ? (typeof blobUrlForRef === 'function' ? blobUrlForRef(existingEntry.src) : existingEntry.src)
            : null;
        if (existingThumb) {
            if (existingUrl) {
                existingThumb.innerHTML = `<img src="${existingUrl}" alt="Existing">`;
            } else {
                // No existing image for this language - show empty placeholder
                existingThumb.innerHTML = `
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--text-secondary); opacity: 0.5;">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <circle cx="8.5" cy="8.5" r="1.5"/>
                        <path d="M21 15l-5-5L5 21"/>
                    </svg>
                `;
            }
        }

        // Set new thumbnail
        if (newThumb && params.newImage) {
            newThumb.innerHTML = `<img src="${params.newSrc}" alt="New">`;
        }

        // Set filenames
        if (existingName) {
            const existingLangName = screenshot.localizedImages?.[params.detectedLang]?.name;
            if (existingLangName) {
                existingName.textContent = existingLangName;
            } else {
                // Show that no image exists for this language yet
                const flag = languageFlags[params.detectedLang] || '🏳️';
                existingName.textContent = `No ${flag} image`;
            }
        }
        if (newName) {
            newName.textContent = params.newName;
        }

        // Set language name in replace description
        if (langNameEl) {
            const flag = languageFlags[params.detectedLang] || '🏳️';
            const name = languageNames[params.detectedLang] || params.detectedLang.toUpperCase();
            langNameEl.textContent = `${flag} ${name}`;
        }

        // Store params for handlers
        modal.dataset.existingIndex = params.existingIndex;
        modal.dataset.detectedLang = params.detectedLang;
        window._duplicateNewImage = params.newImage;
        window._duplicateNewSrc = params.newSrc;
        window._duplicateNewName = params.newName;

        modal.classList.add('visible');
    });
}

/**
 * Close duplicate dialog with a choice
 * @param {string} choice - 'replace', 'create', or 'ignore'
 */
function closeDuplicateDialog(choice) {
    const modal = document.getElementById('duplicate-screenshot-modal');
    if (modal) {
        modal.classList.remove('visible');
    }

    if (currentDuplicateResolve) {
        currentDuplicateResolve(choice);
        currentDuplicateResolve = null;
    }

    // Clean up stored data
    window._duplicateNewImage = null;
    window._duplicateNewSrc = null;
    window._duplicateNewName = null;
}

/**
 * Initialize duplicate dialog event listeners
 */
function initDuplicateDialogListeners() {
    const replaceBtn = document.getElementById('duplicate-replace');
    const createBtn = document.getElementById('duplicate-create-new');
    const ignoreBtn = document.getElementById('duplicate-ignore');

    if (replaceBtn) {
        replaceBtn.addEventListener('click', () => closeDuplicateDialog('replace'));
    }
    if (createBtn) {
        createBtn.addEventListener('click', () => closeDuplicateDialog('create'));
    }
    if (ignoreBtn) {
        ignoreBtn.addEventListener('click', () => closeDuplicateDialog('ignore'));
    }
}
