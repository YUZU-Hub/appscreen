// State management
const state = {
    screenshots: [],
    selectedIndex: 0,
    transferTarget: null, // Index of screenshot waiting to receive style transfer
    outputDevice: 'iphone-6.9',
    currentLanguage: 'en', // Global current language for all text
    projectLanguages: ['en'], // Languages available in this project
    customWidth: 1290,
    customHeight: 2796,
    // Default settings applied to new screenshots
    defaults: {
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
            y: 60,
            x: 50,
            rotation: 0,
            perspective: 0,
            cornerRadius: 24,
            deviceModel2D: 'iphone', // 2D device model: 'iphone' | 'ipad' | 'samsung' | 'mac' | 'watch'
            deviceMacFinish: 'silver', // Mac chassis finish: 'silver' | 'space-black'
            deviceWatchFinish: 'midnight', // Apple Watch case finish, see WATCH_FINISHES
            bezelEnabled: false,      // draw a device bezel/shell in 2D
            spanScreens: 1,           // panorama: span this screenshot across N output slots
            use3D: false,
            device3D: 'iphone',
            rotation3D: { x: 0, y: 0, z: 0 },
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
                color: '#1d1d1f',
                width: 12,
                opacity: 100,
                notch: 'none' // 'none' | 'island' | 'notch'
            }
        },
        text: {
            headlineEnabled: true,
            headlineBgColor: '#000000',
            headlineBgOpacity: 0, // 0 = no text background
            subheadlineBgColor: '#000000',
            subheadlineBgOpacity: 0,
            subheadlineSpacing: 0, // extra px between title and subtitle
            perScreenText: false,  // panorama: a separate text per screen panel
            panelHeadlines: {},    // { lang: [text per panel] }
            panelSubheadlines: {},
            headlines: { en: '' },
            headlineLanguages: ['en'],
            currentHeadlineLang: 'en',
            headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            headlineSize: 100,
            headlineWeight: '600',
            headlineItalic: false,
            headlineUnderline: false,
            headlineStrikethrough: false,
            headlineColor: '#ffffff',
            perLanguageLayout: false,
            languageSettings: {
                en: {
                    headlineSize: 100,
                    subheadlineSize: 50,
                    position: 'top',
                    offsetY: 12,
                    lineHeight: 110
                }
            },
            currentLayoutLang: 'en',
            position: 'top',
            offsetY: 12,
            lineHeight: 110,
            subheadlineEnabled: false,
            subheadlines: { en: '' },
            subheadlineLanguages: ['en'],
            currentSubheadlineLang: 'en',
            subheadlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            subheadlineSize: 50,
            subheadlineWeight: '400',
            subheadlineItalic: false,
            subheadlineUnderline: false,
            subheadlineStrikethrough: false,
            subheadlineColor: '#ffffff',
            subheadlineOpacity: 70,
            // Optional text zone: when enabled the headline + subheadline are
            // confined to this rectangle (percentages of the canvas) and the font is
            // auto-reduced so the whole text fits inside, entirely and without
            // breaking any word across lines.
            textZone: {
                enabled: false,
                uniform: true,
                // Off: the font size below is a ceiling — long text shrinks to fit
                // the zone, short text stays at its designed size, so screens keep
                // one typographic scale. On: the text also GROWS until it reaches
                // the edge of the box. See computeZoneFit().
                fill: false,
                x: 8,
                y: 6,
                width: 84,
                height: 26
            }
        },
        elements: [],
        popouts: []
    }
};

const baseTextDefaults = JSON.parse(JSON.stringify(state.defaults.text));

// Legacy migration: auto-fit text used to be a single global toggle persisted in
// localStorage. It is now stored per screenshot (text.autoFit). For screenshots
// saved before this change (no autoFit key), fall back to the old global value so
// existing users keep their preference until they toggle each screen.
let legacyAutoFitDefault = false;
try { legacyAutoFitDefault = localStorage.getItem('autoFitText') === '1'; } catch (e) {}

// Runtime-only state (not persisted)
let selectedElementId = null;
let selectedPopoutId = null;
let draggingElement = null;

// Preload laurel SVG images for element frames
const laurelImages = {};
['laurel-simple-left', 'laurel-detailed-left'].forEach(name => {
    const img = new Image();
    img.src = `img/${name}.svg`;
    laurelImages[name] = img;
});

// Helper functions to get/set current screenshot settings
function getCurrentScreenshot() {
    if (state.screenshots.length === 0) return null;
    return state.screenshots[state.selectedIndex];
}

function getBackground() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? screenshot.background : state.defaults.background;
}

function getScreenshotSettings() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? screenshot.screenshot : state.defaults.screenshot;
}

// Which panel the Text tab is currently editing (per-screen panorama mode).
let __activePanelIndex = 0;
function getActivePanelIndex() { return __activePanelIndex; }
function setActivePanelIndex(i) { __activePanelIndex = Math.max(0, i | 0); }

function spanForScreenshot(screenshot) {
    return (screenshot && screenshot.screenshot && screenshot.screenshot.spanScreens) || 1;
}

// Ensure container.panelTexts holds `span` full text objects, seeding any missing
// one from the container's current style/content (and migrating legacy per-panel
// text captured before full-style panels existed).
function ensurePanelTexts(container, span) {
    if (!Array.isArray(container.panelTexts)) container.panelTexts = [];
    for (let p = 0; p < span; p++) {
        if (!container.panelTexts[p]) {
            const seed = JSON.parse(JSON.stringify(container));
            delete seed.panelTexts;
            delete seed.panelHeadlines;
            delete seed.panelSubheadlines;
            seed.perScreenText = false;
            const ph = container.panelHeadlines || {};
            const ps = container.panelSubheadlines || {};
            Object.keys(ph).forEach(lang => {
                if (ph[lang] && ph[lang][p]) { seed.headlines = seed.headlines || {}; seed.headlines[lang] = ph[lang][p]; }
            });
            Object.keys(ps).forEach(lang => {
                if (ps[lang] && ps[lang][p]) { seed.subheadlines = seed.subheadlines || {}; seed.subheadlines[lang] = ps[lang][p]; }
            });
            container.panelTexts[p] = seed;
        }
    }
}

// Panels follow the container's current language selection so editing/rendering
// always act on the language the user is viewing.
function syncPanelLanguage(panel, container) {
    panel.currentHeadlineLang = container.currentHeadlineLang;
    panel.currentSubheadlineLang = container.currentSubheadlineLang;
    panel.currentLayoutLang = container.currentLayoutLang;
}

// In per-screen panorama mode each panel carries its OWN full text object; the
// Text tab edits the active panel. Otherwise it edits the screenshot's text.
function activeTextTarget(screenshot) {
    const container = screenshot.text;
    const span = spanForScreenshot(screenshot);
    if (!container.perScreenText || span <= 1) return container;
    ensurePanelTexts(container, span);
    let p = __activePanelIndex;
    if (p > span - 1) p = span - 1;
    if (p < 0) p = 0;
    container.panelTexts[p] = normalizeTextSettings(container.panelTexts[p]);
    syncPanelLanguage(container.panelTexts[p], container);
    return container.panelTexts[p];
}

function getText() {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        screenshot.text = normalizeTextSettings(screenshot.text);
        return activeTextTarget(screenshot);
    }
    state.defaults.text = normalizeTextSettings(state.defaults.text);
    return state.defaults.text;
}

// The renderer and per-screen UI need the CONTAINER (which holds panelTexts +
// the perScreenText flag), not the active panel that getText() may redirect to.
function getContainerText() {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        screenshot.text = normalizeTextSettings(screenshot.text);
        return screenshot.text;
    }
    state.defaults.text = normalizeTextSettings(state.defaults.text);
    return state.defaults.text;
}

function getTextLayoutLanguage(text) {
    if (text.currentLayoutLang) return text.currentLayoutLang;
    if (text.headlineEnabled !== false) return text.currentHeadlineLang || 'en';
    if (text.subheadlineEnabled) return text.currentSubheadlineLang || 'en';
    return text.currentHeadlineLang || text.currentSubheadlineLang || 'en';
}

function getTextLanguageSettings(text, lang) {
    if (!text.languageSettings) text.languageSettings = {};
    if (!text.languageSettings[lang]) {
        const sourceLang = text.currentLayoutLang || text.currentHeadlineLang || text.currentSubheadlineLang || 'en';
        const sourceSettings = text.languageSettings[sourceLang];
        text.languageSettings[lang] = {
            headlineSize: sourceSettings ? sourceSettings.headlineSize : (text.headlineSize || 100),
            subheadlineSize: sourceSettings ? sourceSettings.subheadlineSize : (text.subheadlineSize || 50),
            position: sourceSettings ? sourceSettings.position : (text.position || 'top'),
            offsetY: sourceSettings ? sourceSettings.offsetY : (typeof text.offsetY === 'number' ? text.offsetY : 12),
            lineHeight: sourceSettings ? sourceSettings.lineHeight : (text.lineHeight || 110)
        };
    }
    return text.languageSettings[lang];
}

function getEffectiveLayout(text, lang) {
    if (!text.perLanguageLayout) {
        return {
            headlineSize: text.headlineSize || 100,
            subheadlineSize: text.subheadlineSize || 50,
            position: text.position || 'top',
            offsetY: typeof text.offsetY === 'number' ? text.offsetY : 12,
            lineHeight: text.lineHeight || 110
        };
    }
    return getTextLanguageSettings(text, lang);
}

function normalizeTextSettings(text) {
    const merged = JSON.parse(JSON.stringify(baseTextDefaults));
    if (text) {
        Object.assign(merged, text);
        if (text.languageSettings) {
            merged.languageSettings = JSON.parse(JSON.stringify(text.languageSettings));
        }
    }

    merged.headlines = merged.headlines || { en: '' };
    merged.headlineLanguages = merged.headlineLanguages || ['en'];
    merged.currentHeadlineLang = merged.currentHeadlineLang || merged.headlineLanguages[0] || 'en';
    merged.currentLayoutLang = merged.currentLayoutLang || merged.currentHeadlineLang || 'en';

    if (typeof merged.autoFit !== 'boolean') merged.autoFit = legacyAutoFitDefault;

    // Text zone: keep a complete rectangle even for projects saved before this
    // feature shipped (or with a partial zone object).
    merged.textZone = Object.assign(
        { enabled: false, uniform: true, fill: false, x: 8, y: 6, width: 84, height: 26 },
        (merged.textZone && typeof merged.textZone === 'object') ? merged.textZone : {}
    );

    merged.subheadlines = merged.subheadlines || { en: '' };
    merged.subheadlineLanguages = merged.subheadlineLanguages || ['en'];
    merged.currentSubheadlineLang = merged.currentSubheadlineLang || merged.subheadlineLanguages[0] || 'en';

    if (!merged.languageSettings) merged.languageSettings = {};
    const languages = new Set([...merged.headlineLanguages, ...merged.subheadlineLanguages]);
    if (languages.size === 0) languages.add('en');
    languages.forEach((lang) => {
        getTextLanguageSettings(merged, lang);
    });

    return merged;
}

function getElements() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? (screenshot.elements || []) : [];
}

function getSelectedElement() {
    if (!selectedElementId) return null;
    return getElements().find(el => el.id === selectedElementId) || null;
}

function getElementText(el) {
    if (el.texts) {
        return el.texts[state.currentLanguage]
            || el.texts['en']
            || Object.values(el.texts).find(v => v)
            || el.text || '';
    }
    return el.text || '';
}

function setElementProperty(id, key, value) {
    const elements = getElements();
    const el = elements.find(e => e.id === id);
    if (el) {
        el[key] = value;
        updateCanvas();
        updateElementsList();
    }
}

// ===== Popout accessors =====
function getPopouts() {
    const screenshot = getCurrentScreenshot();
    return screenshot ? (screenshot.popouts || []) : [];
}

function getSelectedPopout() {
    if (!selectedPopoutId) return null;
    return getPopouts().find(p => p.id === selectedPopoutId) || null;
}

function setPopoutProperty(id, key, value) {
    const popouts = getPopouts();
    const p = popouts.find(po => po.id === id);
    if (p) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = p;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            p[key] = value;
        }
        updateCanvas();
        updatePopoutProperties();
    }
}

function addPopout() {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    const img = getScreenshotImage(screenshot);
    if (!img) return;
    if (!screenshot.popouts) screenshot.popouts = [];
    const p = {
        id: crypto.randomUUID(),
        cropX: 25, cropY: 25, cropWidth: 30, cropHeight: 30,
        x: 70, y: 30,
        width: 30,
        rotation: 0, opacity: 100, cornerRadius: 12,
        shadow: { enabled: true, color: '#000000', blur: 30, opacity: 40, x: 0, y: 15 },
        border: { enabled: true, color: '#ffffff', width: 3, opacity: 100 }
    };
    screenshot.popouts.push(p);
    selectedPopoutId = p.id;
    updateCanvas();
    updatePopoutsList();
    updatePopoutProperties();
}

function deletePopout(id) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.popouts) return;
    screenshot.popouts = screenshot.popouts.filter(p => p.id !== id);
    if (selectedPopoutId === id) selectedPopoutId = null;
    updateCanvas();
    updatePopoutsList();
    updatePopoutProperties();
}

function movePopout(id, direction) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.popouts) return;
    const idx = screenshot.popouts.findIndex(p => p.id === id);
    if (idx === -1) return;
    if (direction === 'up' && idx < screenshot.popouts.length - 1) {
        [screenshot.popouts[idx], screenshot.popouts[idx + 1]] = [screenshot.popouts[idx + 1], screenshot.popouts[idx]];
    } else if (direction === 'down' && idx > 0) {
        [screenshot.popouts[idx], screenshot.popouts[idx - 1]] = [screenshot.popouts[idx - 1], screenshot.popouts[idx]];
    }
    updateCanvas();
    updatePopoutsList();
}

function addGraphicElement(img, src, name) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'graphic',
        x: 50, y: 50,
        width: 20,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        image: img,
        src: src,
        name: name || 'Graphic',
        text: '',
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    selectedElementId = el.id;
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

function addTextElement() {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'text',
        x: 50, y: 50,
        width: 40,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        image: null,
        src: null,
        name: 'Text',
        text: 'Your Text',
        texts: { [state.currentLanguage]: 'Your Text' },
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    selectedElementId = el.id;
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

// ===== Lucide SVG loading & caching =====
const lucideSVGCache = new Map(); // name -> raw SVG text

async function fetchLucideSVG(name) {
    if (lucideSVGCache.has(name)) return lucideSVGCache.get(name);
    const url = `https://unpkg.com/lucide-static@latest/icons/${name}.svg`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch icon: ${name}`);
    const svgText = await resp.text();
    lucideSVGCache.set(name, svgText);
    return svgText;
}

function colorizeLucideSVG(svgText, color, strokeWidth) {
    return svgText
        .replace(/stroke="currentColor"/g, `stroke="${color}"`)
        .replace(/stroke-width="[^"]*"/g, `stroke-width="${strokeWidth}"`);
}

async function getLucideImage(name, color, strokeWidth) {
    const rawSVG = await fetchLucideSVG(name);
    const colorized = colorizeLucideSVG(rawSVG, color, strokeWidth);
    const blob = new Blob([colorized], { type: 'image/svg+xml' });
    const blobURL = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(blobURL); resolve(img); };
        img.onerror = (e) => { URL.revokeObjectURL(blobURL); reject(e); };
        img.src = blobURL;
    });
}

async function updateIconImage(el) {
    if (el.type !== 'icon') return;
    try {
        el.image = await getLucideImage(el.iconName, el.iconColor, el.iconStrokeWidth);
        updateCanvas();
    } catch (e) {
        console.error('Failed to update icon image:', e);
    }
}

function addEmojiElement(emoji, name) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'emoji',
        x: 50, y: 50,
        width: 15,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        emoji: emoji,
        name: name || 'Emoji',
        image: null,
        src: null,
        text: '',
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    selectedElementId = el.id;
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

async function addIconElement(iconName) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    if (!screenshot.elements) screenshot.elements = [];
    const el = {
        id: crypto.randomUUID(),
        type: 'icon',
        x: 50, y: 50,
        width: 15,
        rotation: 0,
        opacity: 100,
        layer: 'above-text',
        iconName: iconName,
        iconColor: '#ffffff',
        iconStrokeWidth: 2,
        iconShadow: { enabled: false, color: '#000000', blur: 20, opacity: 40, x: 0, y: 10 },
        image: null,
        src: null,
        name: iconName,
        text: '',
        font: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
        fontSize: 60,
        fontWeight: '600',
        fontColor: '#ffffff',
        italic: false,
        frame: 'none',
        frameColor: '#ffffff',
        frameScale: 100
    };
    screenshot.elements.push(el);
    selectedElementId = el.id;
    updateElementsList();
    updateElementProperties();
    // Async: fetch icon SVG
    try {
        el.image = await getLucideImage(iconName, el.iconColor, el.iconStrokeWidth);
        updateCanvas();
    } catch (e) {
        console.error('Failed to load icon:', e);
    }
    updateCanvas();
}

function deleteElement(id) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.elements) return;
    screenshot.elements = screenshot.elements.filter(e => e.id !== id);
    if (selectedElementId === id) selectedElementId = null;
    updateCanvas();
    updateElementsList();
    updateElementProperties();
}

function moveElementLayer(id, direction) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot || !screenshot.elements) return;
    const idx = screenshot.elements.findIndex(e => e.id === id);
    if (idx === -1) return;
    if (direction === 'up' && idx < screenshot.elements.length - 1) {
        [screenshot.elements[idx], screenshot.elements[idx + 1]] = [screenshot.elements[idx + 1], screenshot.elements[idx]];
    } else if (direction === 'down' && idx > 0) {
        [screenshot.elements[idx], screenshot.elements[idx - 1]] = [screenshot.elements[idx - 1], screenshot.elements[idx]];
    }
    updateCanvas();
    updateElementsList();
}

// Add reset buttons to all slider control rows
function setupSliderResetButtons() {
    document.querySelectorAll('.control-row input[type="range"]').forEach(slider => {
        const row = slider.closest('.control-row');
        if (!row || row.querySelector('.slider-reset-btn')) return;

        const btn = document.createElement('button');
        btn.className = 'slider-reset-btn';
        btn.title = 'Reset to default';
        btn.type = 'button';
        btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 1 3 6.75"/><polyline points="3 16 3 10 9 10"/></svg>';
        btn.addEventListener('click', () => {
            slider.value = slider.defaultValue;
            slider.dispatchEvent(new Event('input', { bubbles: true }));
        });
        row.appendChild(btn);
    });
}

// Format number to at most 1 decimal place
function formatValue(num) {
    const rounded = Math.round(num * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toString() : rounded.toFixed(1);
}

function setBackground(key, value) {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = screenshot.background;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            screenshot.background[key] = value;
        }
    }
}

function setScreenshotSetting(key, value) {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        if (key.includes('.')) {
            const parts = key.split('.');
            let obj = screenshot.screenshot;
            for (let i = 0; i < parts.length - 1; i++) {
                obj = obj[parts[i]];
            }
            obj[parts[parts.length - 1]] = value;
        } else {
            screenshot.screenshot[key] = value;
        }
    }
}

function setTextSetting(key, value) {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        screenshot.text = normalizeTextSettings(screenshot.text);
        activeTextTarget(screenshot)[key] = value;
    }
}

function setCurrentScreenshotAsDefault() {
    const screenshot = getCurrentScreenshot();
    if (screenshot) {
        state.defaults.background = JSON.parse(JSON.stringify(screenshot.background));
        state.defaults.screenshot = JSON.parse(JSON.stringify(screenshot.screenshot));
        state.defaults.text = JSON.parse(JSON.stringify(screenshot.text));
    }
}

// Language flags mapping
const languageFlags = {
    'en': '🇺🇸', 'en-au': '🇦🇺', 'en-ca': '🇨🇦', 'en-gb': '🇬🇧', 'de': '🇩🇪',
    'fr': '🇫🇷', 'fr-ca': '🇨🇦', 'es': '🇪🇸', 'es-mx': '🇲🇽',
    'it': '🇮🇹', 'pt': '🇵🇹', 'pt-br': '🇧🇷', 'nl': '🇳🇱', 'ru': '🇷🇺',
    'ja': '🇯🇵', 'ko': '🇰🇷', 'zh': '🇨🇳', 'zh-tw': '🇹🇼', 'ar': '🇸🇦',
    'hi': '🇮🇳', 'tr': '🇹🇷', 'pl': '🇵🇱', 'sv': '🇸🇪', 'da': '🇩🇰',
    'no': '🇳🇴', 'fi': '🇫🇮', 'th': '🇹🇭', 'vi': '🇻🇳', 'id': '🇮🇩',
    'uk': '🇺🇦', 'ca': '🇪🇸', 'cs': '🇨🇿', 'el': '🇬🇷', 'he': '🇮🇱',
    'hr': '🇭🇷', 'hu': '🇭🇺', 'ms': '🇲🇾', 'ro': '🇷🇴', 'sk': '🇸🇰',
    'sl': '🇸🇮', 'bn': '🇧🇩', 'gu': '🇮🇳', 'kn': '🇮🇳', 'ml': '🇮🇳',
    'mr': '🇮🇳', 'or': '🇮🇳', 'pa': '🇮🇳', 'ta': '🇮🇳', 'te': '🇮🇳', 'ur': '🇵🇰'
};

// Google Fonts configuration
const googleFonts = {
    loaded: new Set(),
    loading: new Set(),
    // Popular fonts that are commonly used for marketing/app store
    popular: [
        'Inter', 'Poppins', 'Roboto', 'Open Sans', 'Montserrat', 'Lato', 'Raleway',
        'Nunito', 'Playfair Display', 'Oswald', 'Merriweather', 'Source Sans Pro',
        'PT Sans', 'Ubuntu', 'Rubik', 'Work Sans', 'Quicksand', 'Mulish', 'Barlow',
        'DM Sans', 'Manrope', 'Space Grotesk', 'Plus Jakarta Sans', 'Outfit', 'Sora',
        'Lexend', 'Figtree', 'Albert Sans', 'Urbanist', 'Satoshi', 'General Sans',
        'Bebas Neue', 'Anton', 'Archivo', 'Bitter', 'Cabin', 'Crimson Text',
        'Dancing Script', 'Fira Sans', 'Heebo', 'IBM Plex Sans', 'Josefin Sans',
        'Karla', 'Libre Franklin', 'Lora', 'Noto Sans', 'Nunito Sans', 'Pacifico',
        'Permanent Marker', 'Roboto Condensed', 'Roboto Mono', 'Roboto Slab',
        'Shadows Into Light', 'Signika', 'Slabo 27px', 'Source Code Pro', 'Titillium Web',
        'Varela Round', 'Zilla Slab', 'Arimo', 'Barlow Condensed', 'Catamaran',
        'Comfortaa', 'Cormorant Garamond', 'Dosis', 'EB Garamond', 'Exo 2',
        'Fira Code', 'Hind', 'Inconsolata', 'Indie Flower', 'Jost', 'Kanit',
        'Libre Baskerville', 'Maven Pro', 'Mukta', 'Nanum Gothic', 'Noticia Text',
        'Oxygen', 'Philosopher', 'Play', 'Prompt', 'Rajdhani', 'Red Hat Display',
        'Righteous', 'Saira', 'Sen', 'Spectral', 'Teko', 'Vollkorn', 'Yanone Kaffeesatz',
        'Zeyada', 'Amatic SC', 'Archivo Black', 'Asap', 'Assistant', 'Bangers',
        'BioRhyme', 'Cairo', 'Cardo', 'Chivo', 'Concert One', 'Cormorant',
        'Cousine', 'DM Serif Display', 'DM Serif Text', 'Dela Gothic One',
        'El Messiri', 'Encode Sans', 'Eczar', 'Fahkwang', 'Gelasio'
    ],
    // System fonts that don't need loading
    system: [
        { name: 'SF Pro Display', value: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'" },
        { name: 'SF Pro Rounded', value: "'SF Pro Rounded', -apple-system" },
        { name: 'Helvetica Neue', value: "'Helvetica Neue', Helvetica" },
        { name: 'Avenir Next', value: "'Avenir Next', Avenir" },
        { name: 'Georgia', value: "Georgia, serif" },
        { name: 'Arial', value: "Arial, sans-serif" },
        { name: 'Times New Roman', value: "'Times New Roman', serif" },
        { name: 'Courier New', value: "'Courier New', monospace" },
        { name: 'Verdana', value: "Verdana, sans-serif" },
        { name: 'Trebuchet MS', value: "'Trebuchet MS', sans-serif" }
    ],
    // Cache for all Google Fonts (loaded on demand)
    allFonts: null
};

// Load a Google Font dynamically
async function loadGoogleFont(fontName) {
    // Check if it's a system font
    const isSystem = googleFonts.system.some(f => f.name === fontName);
    if (isSystem) return;

    // If already loaded, just ensure the current weight is available
    if (googleFonts.loaded.has(fontName)) {
        const text = getTextSettings();
        const weight = text.headlineWeight || '600';
        try {
            await document.fonts.load(`${weight} 16px "${fontName}"`);
        } catch (e) {
            // Font already loaded, weight might not exist but that's ok
        }
        return;
    }

    // If currently loading, wait for it
    if (googleFonts.loading.has(fontName)) {
        // Wait a bit and check again
        await new Promise(resolve => setTimeout(resolve, 100));
        if (googleFonts.loading.has(fontName)) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        return;
    }

    googleFonts.loading.add(fontName);

    try {
        const link = document.createElement('link');
        link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(fontName)}:wght@300;400;500;600;700;800;900&display=swap`;
        link.rel = 'stylesheet';

        // Wait for stylesheet to load first
        await new Promise((resolve, reject) => {
            link.onload = resolve;
            link.onerror = reject;
            document.head.appendChild(link);
        });

        // Wait for the font to actually load with the required weights
        const text = getTextSettings();
        const headlineWeight = text.headlineWeight || '600';
        const subheadlineWeight = text.subheadlineWeight || '400';

        // Load all weights we might need
        await Promise.all([
            document.fonts.load(`400 16px "${fontName}"`),
            document.fonts.load(`${headlineWeight} 16px "${fontName}"`),
            document.fonts.load(`${subheadlineWeight} 16px "${fontName}"`)
        ]);

        googleFonts.loaded.add(fontName);
        googleFonts.loading.delete(fontName);
    } catch (error) {
        console.warn(`Failed to load font: ${fontName}`, error);
        googleFonts.loading.delete(fontName);
    }
}

// Fetch all Google Fonts from the API (cached)
async function fetchAllGoogleFonts() {
    if (googleFonts.allFonts) {
        return googleFonts.allFonts;
    }

    try {
        // Try to fetch from Google Fonts API v2
        // API key is optional - the API works without it but has lower rate limits
        const apiKey = state.settings?.googleFontsApiKey || '';
        const url = new URL('https://www.googleapis.com/webfonts/v1/webfonts');
        url.searchParams.set('sort', 'popularity');
        if (apiKey) {
            url.searchParams.set('key', apiKey);
        }
        
        try {
            const response = await fetch(url);
            if (response.ok) {
                const data = await response.json();
                if (data.items && data.items.length > 0) {
                    // Extract font family names from API response
                    googleFonts.allFonts = data.items.map(font => font.family);
                    console.log(`Loaded ${googleFonts.allFonts.length} fonts from Google Fonts API`);
                    return googleFonts.allFonts;
                }
            } else if (response.status === 429) {
                console.warn('Google Fonts API rate limit reached, using fallback font list');
            } else {
                console.warn(`Google Fonts API returned status ${response.status}, using fallback font list`);
            }
        } catch (apiError) {
            console.warn('Failed to fetch from Google Fonts API, using fallback font list:', apiError);
        }

        // Fallback to curated list of 1000+ popular fonts
        // This list covers the most commonly used fonts on Google Fonts
        googleFonts.allFonts = [
            ...googleFonts.popular,
            'ABeeZee', 'Abel', 'Abhaya Libre', 'Abril Fatface', 'Aclonica', 'Acme',
            'Actor', 'Adamina', 'Advent Pro', 'Aguafina Script', 'Akronim', 'Aladin',
            'Aldrich', 'Alef', 'Alegreya', 'Alegreya Sans', 'Alegreya Sans SC', 'Alex Brush',
            'Alfa Slab One', 'Alice', 'Alike', 'Alike Angular', 'Allan', 'Allerta',
            'Allison', 'Allura', 'Almendra', 'Amaranth', 'Amatic SC', 'Amethysta',
            'Amiko', 'Amiri', 'Amita', 'Anaheim', 'Andada', 'Andika', 'Angkor',
            'Annie Use Your Telescope', 'Anonymous Pro', 'Antic', 'Antic Didone',
            'Antonio', 'Arapey', 'Arbutus', 'Arbutus Slab', 'Architects Daughter',
            'Archivo Narrow', 'Aref Ruqaa', 'Arima Madurai', 'Arvo', 'Asap Condensed',
            'Asar', 'Asset', 'Astloch', 'Asul', 'Athiti', 'Atkinson Hyperlegible',
            'Atomic Age', 'Aubrey', 'Audiowide', 'Autour One', 'Average', 'Average Sans',
            'Averia Gruesa Libre', 'Averia Libre', 'Averia Sans Libre', 'Averia Serif Libre',
            'B612', 'B612 Mono', 'Bad Script', 'Bahiana', 'Bahianita', 'Bai Jamjuree',
            'Baloo', 'Baloo 2', 'Balsamiq Sans', 'Balthazar', 'Baskervville',
            'Battambang', 'Baumans', 'Bellefair', 'Belleza', 'Bellota', 'Bellota Text',
            'BenchNine', 'Bentham', 'Berkshire Swash', 'Beth Ellen', 'Bevan',
            'Big Shoulders Display', 'Big Shoulders Text', 'Bigelow Rules', 'Bigshot One',
            'Bilbo', 'Bilbo Swash Caps', 'Blinker', 'Bodoni Moda', 'Bokor', 'Bonbon',
            'Boogaloo', 'Bowlby One', 'Bowlby One SC', 'Brawler', 'Bree Serif',
            'Brygada 1918', 'Bubblegum Sans', 'Bubbler One', 'Buda', 'Buenard',
            'Bungee', 'Bungee Hairline', 'Bungee Inline', 'Bungee Outline', 'Bungee Shade',
            'Butcherman', 'Butterfly Kids', 'Cabin Condensed', 'Cabin Sketch', 'Caesar Dressing',
            'Cagliostro', 'Caladea', 'Calistoga', 'Calligraffitti', 'Cambay', 'Cambo',
            'Candal', 'Cantarell', 'Cantata One', 'Cantora One', 'Capriola', 'Cardo',
            'Carme', 'Carrois Gothic', 'Carrois Gothic SC', 'Carter One', 'Castoro',
            'Caveat', 'Caveat Brush', 'Cedarville Cursive', 'Ceviche One', 'Chakra Petch',
            'Changa', 'Changa One', 'Chango', 'Charm', 'Charmonman', 'Chathura',
            'Chau Philomene One', 'Chela One', 'Chelsea Market', 'Chenla', 'Cherry Cream Soda',
            'Cherry Swash', 'Chewy', 'Chicle', 'Chilanka', 'Chonburi', 'Cinzel',
            'Cinzel Decorative', 'Clicker Script', 'Coda', 'Coda Caption', 'Codystar',
            'Coiny', 'Combo', 'Comforter', 'Comforter Brush', 'Comic Neue', 'Coming Soon',
            'Commissioner', 'Condiment', 'Content', 'Contrail One', 'Convergence',
            'Cookie', 'Copse', 'Corben', 'Corinthia', 'Cormorant Infant', 'Cormorant SC',
            'Cormorant Unicase', 'Cormorant Upright', 'Courgette', 'Courier Prime',
            'Covered By Your Grace', 'Crafty Girls', 'Creepster', 'Crete Round',
            'Crimson Pro', 'Croissant One', 'Crushed', 'Cuprum', 'Cute Font',
            'Cutive', 'Cutive Mono', 'Damion', 'Dangrek', 'Darker Grotesque',
            'David Libre', 'Dawning of a New Day', 'Days One', 'Dekko', 'Delius',
            'Delius Swash Caps', 'Delius Unicase', 'Della Respira', 'Denk One',
            'Devonshire', 'Dhurjati', 'Didact Gothic', 'Diplomata', 'Diplomata SC',
            'Do Hyeon', 'Dokdo', 'Domine', 'Donegal One', 'Dongle', 'Doppio One',
            'Dorsa', 'Droid Sans', 'Droid Sans Mono', 'Droid Serif', 'Duru Sans',
            'Dynalight', 'Eagle Lake', 'East Sea Dokdo', 'Eater', 'Economica',
            'Eczar', 'Edu NSW ACT Foundation', 'Edu QLD Beginner', 'Edu SA Beginner',
            'Edu TAS Beginner', 'Edu VIC WA NT Beginner', 'Electrolize', 'Elsie',
            'Elsie Swash Caps', 'Emblema One', 'Emilys Candy', 'Encode Sans Condensed',
            'Encode Sans Expanded', 'Encode Sans Semi Condensed', 'Encode Sans Semi Expanded',
            'Engagement', 'Englebert', 'Enriqueta', 'Ephesis', 'Epilogue', 'Erica One',
            'Esteban', 'Estonia', 'Euphoria Script', 'Ewert', 'Exo', 'Expletus Sans',
            'Explora', 'Fahkwang', 'Fanwood Text', 'Farro', 'Farsan', 'Fascinate',
            'Fascinate Inline', 'Faster One', 'Fasthand', 'Fauna One', 'Faustina',
            'Federant', 'Federo', 'Felipa', 'Fenix', 'Festive', 'Finger Paint',
            'Fira Sans Condensed', 'Fira Sans Extra Condensed', 'Fjalla One', 'Fjord One',
            'Flamenco', 'Flavors', 'Fleur De Leah', 'Flow Block', 'Flow Circular',
            'Flow Rounded', 'Fondamento', 'Fontdiner Swanky', 'Forum', 'Francois One',
            'Frank Ruhl Libre', 'Fraunces', 'Freckle Face', 'Fredericka the Great',
            'Fredoka', 'Fredoka One', 'Freehand', 'Fresca', 'Frijole', 'Fruktur',
            'Fugaz One', 'Fuggles', 'Fuzzy Bubbles', 'GFS Didot', 'GFS Neohellenic',
            'Gabriela', 'Gaegu', 'Gafata', 'Galada', 'Galdeano', 'Galindo', 'Gamja Flower',
            'Gayathri', 'Gelasio', 'Gemunu Libre', 'Genos', 'Gentium Basic', 'Gentium Book Basic',
            'Gentium Book Plus', 'Gentium Plus', 'Geo', 'Georama', 'Geostar', 'Geostar Fill',
            'Germania One', 'Gideon Roman', 'Gidugu', 'Gilda Display', 'Girassol',
            'Give You Glory', 'Glass Antiqua', 'Glegoo', 'Gloria Hallelujah', 'Glory',
            'Gluten', 'Goblin One', 'Gochi Hand', 'Goldman', 'Gorditas', 'Gothic A1',
            'Gotu', 'Goudy Bookletter 1911', 'Gowun Batang', 'Gowun Dodum', 'Graduate',
            'Grand Hotel', 'Grandstander', 'Grape Nuts', 'Gravitas One', 'Great Vibes',
            'Grechen Fuemen', 'Grenze', 'Grenze Gotisch', 'Grey Qo', 'Griffy', 'Gruppo',
            'Gudea', 'Gugi', 'Gupter', 'Gurajada', 'Gwendolyn', 'Habibi', 'Hachi Maru Pop',
            'Hahmlet', 'Halant', 'Hammersmith One', 'Hanalei', 'Hanalei Fill', 'Handlee',
            'Hanuman', 'Happy Monkey', 'Harmattan', 'Headland One', 'Hepta Slab',
            'Herr Von Muellerhoff', 'Hi Melody', 'Hina Mincho', 'Hind Guntur', 'Hind Madurai',
            'Hind Siliguri', 'Hind Vadodara', 'Holtwood One SC', 'Homemade Apple', 'Homenaje',
            'Hubballi', 'Hurricane', 'IBM Plex Mono', 'IBM Plex Sans Condensed', 'IBM Plex Serif',
            'IM Fell DW Pica', 'IM Fell DW Pica SC', 'IM Fell Double Pica', 'IM Fell Double Pica SC',
            'IM Fell English', 'IM Fell English SC', 'IM Fell French Canon', 'IM Fell French Canon SC',
            'IM Fell Great Primer', 'IM Fell Great Primer SC', 'Ibarra Real Nova', 'Iceberg',
            'Iceland', 'Imbue', 'Imperial Script', 'Imprima', 'Inconsolata', 'Inder', 'Ingrid Darling',
            'Inika', 'Inknut Antiqua', 'Inria Sans', 'Inria Serif', 'Inspiration', 'Inter Tight',
            'Irish Grover', 'Island Moments', 'Istok Web', 'Italiana', 'Italianno', 'Itim',
            'Jacques Francois', 'Jacques Francois Shadow', 'Jaldi', 'JetBrains Mono', 'Jim Nightshade',
            'Joan', 'Jockey One', 'Jolly Lodger', 'Jomhuria', 'Jomolhari', 'Josefin Slab',
            'Joti One', 'Jua', 'Judson', 'Julee', 'Julius Sans One', 'Junge', 'Jura',
            'Just Another Hand', 'Just Me Again Down Here', 'K2D', 'Kadwa', 'Kaisei Decol',
            'Kaisei HarunoUmi', 'Kaisei Opti', 'Kaisei Tokumin', 'Kalam', 'Kameron', 'Kanit',
            'Kantumruy', 'Kantumruy Pro', 'Karantina', 'Karla', 'Karma', 'Katibeh', 'Kaushan Script',
            'Kavivanar', 'Kavoon', 'Kdam Thmor Pro', 'Keania One', 'Kelly Slab', 'Kenia',
            'Khand', 'Khmer', 'Khula', 'Kings', 'Kirang Haerang', 'Kite One', 'Kiwi Maru',
            'Klee One', 'Knewave', 'KoHo', 'Kodchasan', 'Koh Santepheap', 'Kolker Brush',
            'Kosugi', 'Kosugi Maru', 'Kotta One', 'Koulen', 'Kranky', 'Kreon', 'Kristi',
            'Krona One', 'Krub', 'Kufam', 'Kulim Park', 'Kumar One', 'Kumar One Outline',
            'Kumbh Sans', 'Kurale', 'La Belle Aurore', 'Lacquer', 'Laila', 'Lakki Reddy',
            'Lalezar', 'Lancelot', 'Langar', 'Lateef', 'League Gothic', 'League Script',
            'League Spartan', 'Leckerli One', 'Ledger', 'Lekton', 'Lemon', 'Lemonada',
            'Lexend Deca', 'Lexend Exa', 'Lexend Giga', 'Lexend Mega', 'Lexend Peta',
            'Lexend Tera', 'Lexend Zetta', 'Libre Barcode 128', 'Libre Barcode 128 Text',
            'Libre Barcode 39', 'Libre Barcode 39 Extended', 'Libre Barcode 39 Extended Text',
            'Libre Barcode 39 Text', 'Libre Barcode EAN13 Text', 'Libre Bodoni', 'Libre Caslon Display',
            'Libre Caslon Text', 'Life Savers', 'Lilita One', 'Lily Script One', 'Limelight',
            'Linden Hill', 'Literata', 'Liu Jian Mao Cao', 'Livvic', 'Lobster', 'Lobster Two',
            'Londrina Outline', 'Londrina Shadow', 'Londrina Sketch', 'Londrina Solid',
            'Long Cang', 'Lora', 'Love Light', 'Love Ya Like A Sister', 'Loved by the King',
            'Lovers Quarrel', 'Luckiest Guy', 'Lusitana', 'Lustria', 'Luxurious Roman',
            'Luxurious Script', 'M PLUS 1', 'M PLUS 1 Code', 'M PLUS 1p', 'M PLUS 2',
            'M PLUS Code Latin', 'M PLUS Rounded 1c', 'Ma Shan Zheng', 'Macondo', 'Macondo Swash Caps',
            'Mada', 'Magra', 'Maiden Orange', 'Maitree', 'Major Mono Display', 'Mako', 'Mali',
            'Mallanna', 'Mandali', 'Manjari', 'Mansalva', 'Manuale', 'Marcellus', 'Marcellus SC',
            'Marck Script', 'Margarine', 'Markazi Text', 'Marko One', 'Marmelad', 'Martel',
            'Martel Sans', 'Marvel', 'Mate', 'Mate SC', 'Material Icons', 'Material Icons Outlined',
            'Material Icons Round', 'Material Icons Sharp', 'Material Icons Two Tone', 'Material Symbols Outlined',
            'Material Symbols Rounded', 'Material Symbols Sharp', 'Maven Pro', 'McLaren', 'Mea Culpa',
            'Meddon', 'MedievalSharp', 'Medula One', 'Meera Inimai', 'Megrim', 'Meie Script',
            'Meow Script', 'Merienda', 'Merienda One', 'Merriweather Sans', 'Metal', 'Metal Mania',
            'Metamorphous', 'Metrophobic', 'Michroma', 'Milonga', 'Miltonian', 'Miltonian Tattoo',
            'Mina', 'Miniver', 'Miriam Libre', 'Mirza', 'Miss Fajardose', 'Mitr', 'Mochiy Pop One',
            'Mochiy Pop P One', 'Modak', 'Modern Antiqua', 'Mogra', 'Mohave', 'Molengo', 'Molle',
            'Monda', 'Monofett', 'Monoton', 'Monsieur La Doulaise', 'Montaga', 'Montagu Slab',
            'MonteCarlo', 'Montez', 'Montserrat Alternates', 'Montserrat Subrayada', 'Moo Lah Lah',
            'Moon Dance', 'Moul', 'Moulpali', 'Mountains of Christmas', 'Mouse Memoirs', 'Mr Bedfort',
            'Mr Dafoe', 'Mr De Haviland', 'Mrs Saint Delafield', 'Mrs Sheppards', 'Ms Madi', 'Mukta Mahee',
            'Mukta Malar', 'Mukta Vaani', 'Muli', 'Murecho', 'MuseoModerno', 'My Soul', 'Mystery Quest',
            'NTR', 'Nanum Brush Script', 'Nanum Gothic Coding', 'Nanum Myeongjo', 'Nanum Pen Script',
            'Neonderthaw', 'Nerko One', 'Neucha', 'Neuton', 'New Rocker', 'New Tegomin', 'News Cycle',
            'Newsreader', 'Niconne', 'Niramit', 'Nixie One', 'Nobile', 'Nokora', 'Norican', 'Nosifer',
            'Notable', 'Nothing You Could Do', 'Noticia Text', 'Noto Color Emoji', 'Noto Emoji',
            'Noto Kufi Arabic', 'Noto Music', 'Noto Naskh Arabic', 'Noto Nastaliq Urdu', 'Noto Rashi Hebrew',
            'Noto Sans Arabic', 'Noto Sans Bengali', 'Noto Sans Devanagari', 'Noto Sans Display',
            'Noto Sans Georgian', 'Noto Sans Hebrew', 'Noto Sans HK', 'Noto Sans JP', 'Noto Sans KR',
            'Noto Sans Mono', 'Noto Sans SC', 'Noto Sans TC', 'Noto Sans Thai', 'Noto Serif',
            'Noto Serif Bengali', 'Noto Serif Devanagari', 'Noto Serif Display', 'Noto Serif Georgian',
            'Noto Serif Hebrew', 'Noto Serif JP', 'Noto Serif KR', 'Noto Serif SC', 'Noto Serif TC',
            'Noto Serif Thai', 'Nova Cut', 'Nova Flat', 'Nova Mono', 'Nova Oval', 'Nova Round',
            'Nova Script', 'Nova Slim', 'Nova Square', 'Numans', 'Nunito', 'Nunito Sans', 'Nuosu SIL',
            'Odibee Sans', 'Odor Mean Chey', 'Offside', 'Oi', 'Old Standard TT', 'Oldenburg', 'Ole',
            'Oleo Script', 'Oleo Script Swash Caps', 'Oooh Baby', 'Open Sans Condensed', 'Oranienbaum',
            'Orbit', 'Orbitron', 'Oregano', 'Orelega One', 'Orienta', 'Original Surfer', 'Oswald',
            'Otomanopee One', 'Outfit', 'Over the Rainbow', 'Overlock', 'Overlock SC', 'Overpass',
            'Overpass Mono', 'Ovo', 'Oxanium', 'Oxygen Mono', 'PT Mono', 'PT Sans Caption',
            'PT Sans Narrow', 'PT Serif', 'PT Serif Caption', 'Pacifico', 'Padauk', 'Padyakke Expanded One',
            'Palanquin', 'Palanquin Dark', 'Palette Mosaic', 'Pangolin', 'Paprika', 'Parisienne',
            'Passero One', 'Passion One', 'Passions Conflict', 'Pathway Gothic One', 'Patrick Hand',
            'Patrick Hand SC', 'Pattaya', 'Patua One', 'Pavanam', 'Paytone One', 'Peddana',
            'Peralta', 'Permanent Marker', 'Petemoss', 'Petit Formal Script', 'Petrona', 'Phetsarath',
            'Philosopher', 'Piazzolla', 'Piedra', 'Pinyon Script', 'Pirata One', 'Plaster', 'Play',
            'Playball', 'Playfair Display SC', 'Podkova', 'Poiret One', 'Poller One', 'Poly', 'Pompiere',
            'Pontano Sans', 'Poor Story', 'Poppins', 'Port Lligat Sans', 'Port Lligat Slab', 'Potta One',
            'Pragati Narrow', 'Praise', 'Prata', 'Preahvihear', 'Press Start 2P', 'Pridi', 'Princess Sofia',
            'Prociono', 'Prompt', 'Prosto One', 'Proza Libre', 'Public Sans', 'Puppies Play', 'Puritan',
            'Purple Purse', 'Qahiri', 'Quando', 'Quantico', 'Quattrocento', 'Quattrocento Sans', 'Questrial',
            'Quicksand', 'Quintessential', 'Qwigley', 'Qwitcher Grypen', 'Racing Sans One', 'Radio Canada',
            'Radley', 'Rajdhani', 'Rakkas', 'Raleway Dots', 'Ramabhadra', 'Ramaraja', 'Rambla', 'Rammetto One',
            'Rampart One', 'Ranchers', 'Rancho', 'Ranga', 'Rasa', 'Rationale', 'Ravi Prakash', 'Readex Pro',
            'Recursive', 'Red Hat Mono', 'Red Hat Text', 'Red Rose', 'Redacted', 'Redacted Script', 'Redressed',
            'Reem Kufi', 'Reenie Beanie', 'Reggae One', 'Revalia', 'Rhodium Libre', 'Ribeye', 'Ribeye Marrow',
            'Righteous', 'Risque', 'Road Rage', 'Roboto Flex', 'Rochester', 'Rock Salt', 'RocknRoll One',
            'Rokkitt', 'Romanesco', 'Ropa Sans', 'Rosario', 'Rosarivo', 'Rouge Script', 'Rowdies', 'Rozha One',
            'Rubik Beastly', 'Rubik Bubbles', 'Rubik Burned', 'Rubik Dirt', 'Rubik Distressed', 'Rubik Glitch',
            'Rubik Marker Hatch', 'Rubik Maze', 'Rubik Microbe', 'Rubik Mono One', 'Rubik Moonrocks',
            'Rubik Puddles', 'Rubik Wet Paint', 'Ruda', 'Rufina', 'Ruge Boogie', 'Ruluko', 'Rum Raisin',
            'Ruslan Display', 'Russo One', 'Ruthie', 'Rye', 'STIX Two Math', 'STIX Two Text', 'Sacramento',
            'Sahitya', 'Sail', 'Saira Condensed', 'Saira Extra Condensed', 'Saira Semi Condensed', 'Saira Stencil One',
            'Salsa', 'Sanchez', 'Sancreek', 'Sansita', 'Sansita Swashed', 'Sarabun', 'Sarala', 'Sarina', 'Sarpanch',
            'Sassy Frass', 'Satisfy', 'Sawarabi Gothic', 'Sawarabi Mincho', 'Scada', 'Scheherazade New', 'Schoolbell',
            'Scope One', 'Seaweed Script', 'Secular One', 'Sedgwick Ave', 'Sedgwick Ave Display', 'Sen',
            'Send Flowers', 'Sevillana', 'Seymour One', 'Shadows Into Light Two', 'Shalimar', 'Shanti',
            'Share', 'Share Tech', 'Share Tech Mono', 'Shippori Antique', 'Shippori Antique B1', 'Shippori Mincho',
            'Shippori Mincho B1', 'Shizuru', 'Shojumaru', 'Short Stack', 'Shrikhand', 'Siemreap', 'Sigmar One',
            'Signika Negative', 'Silkscreen', 'Simonetta', 'Single Day', 'Sintony', 'Sirin Stencil', 'Six Caps',
            'Skranji', 'Slabo 13px', 'Slackey', 'Smokum', 'Smooch', 'Smooch Sans', 'Smythe', 'Sniglet',
            'Snippet', 'Snowburst One', 'Sofadi One', 'Sofia', 'Sofia Sans', 'Sofia Sans Condensed',
            'Sofia Sans Extra Condensed', 'Sofia Sans Semi Condensed', 'Solitreo', 'Solway', 'Song Myung',
            'Sophia', 'Sora', 'Sorts Mill Goudy', 'Source Code Pro', 'Source Sans 3', 'Source Serif 4',
            'Source Serif Pro', 'Space Mono', 'Spartan', 'Special Elite', 'Spectral SC', 'Spicy Rice',
            'Spinnaker', 'Spirax', 'Splash', 'Spline Sans', 'Spline Sans Mono', 'Squada One', 'Square Peg',
            'Sree Krushnadevaraya', 'Sriracha', 'Srisakdi', 'Staatliches', 'Stalemate', 'Stalinist One',
            'Stardos Stencil', 'Stick', 'Stick No Bills', 'Stint Ultra Condensed', 'Stint Ultra Expanded',
            'Stoke', 'Strait', 'Style Script', 'Stylish', 'Sue Ellen Francisco', 'Suez One', 'Sulphur Point',
            'Sumana', 'Sunflower', 'Sunshiney', 'Supermercado One', 'Sura', 'Suranna', 'Suravaram', 'Suwannaphum',
            'Swanky and Moo Moo', 'Syncopate', 'Syne', 'Syne Mono', 'Syne Tactile', 'Tajawal', 'Tangerine',
            'Tapestry', 'Taprom', 'Tauri', 'Taviraj', 'Teko', 'Telex', 'Tenali Ramakrishna', 'Tenor Sans',
            'Text Me One', 'Texturina', 'Thasadith', 'The Girl Next Door', 'The Nautigal', 'Tienne', 'Tillana',
            'Tilt Neon', 'Tilt Prism', 'Tilt Warp', 'Timmana', 'Tinos', 'Tiro Bangla', 'Tiro Devanagari Hindi',
            'Tiro Devanagari Marathi', 'Tiro Devanagari Sanskrit', 'Tiro Gurmukhi', 'Tiro Kannada', 'Tiro Tamil',
            'Tiro Telugu', 'Titan One', 'Trade Winds', 'Train One', 'Trirong', 'Trispace', 'Trocchi',
            'Trochut', 'Truculenta', 'Trykker', 'Tulpen One', 'Turret Road', 'Twinkle Star', 'Ubuntu Condensed',
            'Ubuntu Mono', 'Uchen', 'Ultra', 'Uncial Antiqua', 'Underdog', 'Unica One', 'UnifrakturCook',
            'UnifrakturMaguntia', 'Unkempt', 'Unlock', 'Unna', 'Updock', 'Urbanist', 'Varta', 'Vast Shadow',
            'Vazirmatn', 'Vesper Libre', 'Viaoda Libre', 'Vibes', 'Vibur', 'Vidaloka', 'Viga', 'Voces',
            'Volkhov', 'Vollkorn SC', 'Voltaire', 'Vujahday Script', 'Waiting for the Sunrise', 'Wallpoet',
            'Walter Turncoat', 'Warnes', 'Water Brush', 'Waterfall', 'Wellfleet', 'Wendy One', 'Whisper',
            'WindSong', 'Wire One', 'Wix Madefor Display', 'Wix Madefor Text', 'Work Sans', 'Xanh Mono',
            'Yaldevi', 'Yanone Kaffeesatz', 'Yantramanav', 'Yatra One', 'Yellowtail', 'Yeon Sung', 'Yeseva One',
            'Yesteryear', 'Yomogi', 'Yrsa', 'Ysabeau', 'Ysabeau Infant', 'Ysabeau Office', 'Ysabeau SC',
            'Yuji Boku', 'Yuji Hentaigana Akari', 'Yuji Hentaigana Akebono', 'Yuji Mai', 'Yuji Syuku',
            'Yusei Magic', 'ZCOOL KuaiLe', 'ZCOOL QingKe HuangYou', 'ZCOOL XiaoWei', 'Zen Antique',
            'Zen Antique Soft', 'Zen Dots', 'Zen Kaku Gothic Antique', 'Zen Kaku Gothic New', 'Zen Kurenaido',
            'Zen Loop', 'Zen Maru Gothic', 'Zen Old Mincho', 'Zen Tokyo Zoo', 'Zeyada', 'Zhi Mang Xing',
            'Zilla Slab Highlight'
        ];
        // Remove duplicates
        googleFonts.allFonts = [...new Set(googleFonts.allFonts)].sort();
        return googleFonts.allFonts;
    } catch (error) {
        console.error('Failed to load font list:', error);
        return googleFonts.popular;
    }
}

// Font picker state - separate state for each picker
const fontPickerState = {
    headline: { category: 'popular', search: '' },
    subheadline: { category: 'popular', search: '' },
    element: { category: 'popular', search: '' }
};

// Initialize all font pickers
function initFontPicker() {
    initSingleFontPicker('headline', {
        picker: 'font-picker',
        trigger: 'font-picker-trigger',
        dropdown: 'font-picker-dropdown',
        search: 'font-search',
        list: 'font-picker-list',
        preview: 'font-picker-preview',
        hidden: 'headline-font',
        stateKey: 'headlineFont'
    });

    initSingleFontPicker('subheadline', {
        picker: 'subheadline-font-picker',
        trigger: 'subheadline-font-picker-trigger',
        dropdown: 'subheadline-font-picker-dropdown',
        search: 'subheadline-font-search',
        list: 'subheadline-font-picker-list',
        preview: 'subheadline-font-picker-preview',
        hidden: 'subheadline-font',
        stateKey: 'subheadlineFont'
    });

    initSingleFontPicker('element', {
        picker: 'element-font-picker',
        trigger: 'element-font-picker-trigger',
        dropdown: 'element-font-picker-dropdown',
        search: 'element-font-search',
        list: 'element-font-picker-list',
        preview: 'element-font-picker-preview',
        hidden: 'element-font',
        stateKey: 'font',
        getFont: () => { const el = getSelectedElement(); return el ? el.font : ''; },
        setFont: (value) => { if (selectedElementId) setElementProperty(selectedElementId, 'font', value); }
    });
}

// Initialize a single font picker instance
function initSingleFontPicker(pickerId, ids) {
    const trigger = document.getElementById(ids.trigger);
    const dropdown = document.getElementById(ids.dropdown);
    const searchInput = document.getElementById(ids.search);
    const picker = document.getElementById(ids.picker);

    if (!trigger || !dropdown) return;

    // Toggle dropdown
    trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        // Close other font picker dropdowns
        document.querySelectorAll('.font-picker-dropdown.open').forEach(d => {
            if (d.id !== ids.dropdown) d.classList.remove('open');
        });
        dropdown.classList.toggle('open');
        if (dropdown.classList.contains('open')) {
            searchInput.focus();
            renderFontList(pickerId, ids);
        }
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest(`#${ids.picker}`)) {
            dropdown.classList.remove('open');
        }
    });

    // Search input
    searchInput.addEventListener('input', (e) => {
        fontPickerState[pickerId].search = e.target.value.toLowerCase();
        renderFontList(pickerId, ids);
    });

    // Prevent dropdown close when clicking inside
    dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
    });

    // Category buttons
    const categoryButtons = picker.querySelectorAll('.font-category');
    categoryButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            categoryButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            fontPickerState[pickerId].category = btn.dataset.category;
            renderFontList(pickerId, ids);
        });
    });

    // Initial render
    renderFontList(pickerId, ids);
}

// Render the font list for a specific picker
async function renderFontList(pickerId, ids) {
    const fontList = document.getElementById(ids.list);
    if (!fontList) return;

    const pickerState = fontPickerState[pickerId];
    let fonts = [];
    const currentFont = ids.getFont ? ids.getFont() : getTextSettings()[ids.stateKey];

    if (pickerState.category === 'system') {
        fonts = googleFonts.system.map(f => ({
            name: f.name,
            value: f.value,
            category: 'system'
        }));
    } else if (pickerState.category === 'popular') {
        fonts = googleFonts.popular.map(name => ({
            name,
            value: `'${name}', sans-serif`,
            category: 'google'
        }));
    } else {
        // All fonts
        const allFonts = await fetchAllGoogleFonts();
        fonts = [
            ...googleFonts.system.map(f => ({
                name: f.name,
                value: f.value,
                category: 'system'
            })),
            ...allFonts.map(name => ({
                name,
                value: `'${name}', sans-serif`,
                category: 'google'
            }))
        ];
    }

    // Filter by search
    if (pickerState.search) {
        fonts = fonts.filter(f => f.name.toLowerCase().includes(pickerState.search));
    }

    // Limit to prevent performance issues
    const displayFonts = fonts.slice(0, 100);

    if (displayFonts.length === 0) {
        fontList.innerHTML = '<div class="font-picker-empty">No fonts found</div>';
        return;
    }

    fontList.innerHTML = displayFonts.map(font => {
        const isSelected = currentFont && (currentFont.includes(font.name) || currentFont === font.value);
        const isLoaded = font.category === 'system' || googleFonts.loaded.has(font.name);
        const isLoading = googleFonts.loading.has(font.name);

        return `
            <div class="font-option ${isSelected ? 'selected' : ''}"
                 data-font-name="${font.name}"
                 data-font-value="${font.value}"
                 data-font-category="${font.category}">
                <span class="font-option-name" style="font-family: ${isLoaded ? font.value : 'inherit'}">${font.name}</span>
                ${isLoading ? '<span class="font-option-loading">Loading...</span>' :
                `<span class="font-option-category">${font.category}</span>`}
            </div>
        `;
    }).join('');

    // Add click handlers
    fontList.querySelectorAll('.font-option').forEach(option => {
        option.addEventListener('click', async () => {
            const fontName = option.dataset.fontName;
            const fontValue = option.dataset.fontValue;
            const fontCategory = option.dataset.fontCategory;

            // Load Google Font if needed
            if (fontCategory === 'google') {
                option.querySelector('.font-option-category').textContent = 'Loading...';
                option.querySelector('.font-option-category').classList.add('font-option-loading');
                await loadGoogleFont(fontName);
                option.querySelector('.font-option-name').style.fontFamily = fontValue;
                option.querySelector('.font-option-category').textContent = 'google';
                option.querySelector('.font-option-category').classList.remove('font-option-loading');
            }

            // Update state
            document.getElementById(ids.hidden).value = fontValue;
            if (ids.setFont) {
                ids.setFont(fontValue);
            } else {
                setTextValue(ids.stateKey, fontValue);
            }

            // Update preview
            const preview = document.getElementById(ids.preview);
            preview.textContent = fontName;
            preview.style.fontFamily = fontValue;

            // Update selection in list
            fontList.querySelectorAll('.font-option').forEach(opt => opt.classList.remove('selected'));
            option.classList.add('selected');

            // Close dropdown
            document.getElementById(ids.dropdown).classList.remove('open');

            updateCanvas();
        });

        // Preload font on hover for better UX
        option.addEventListener('mouseenter', () => {
            const fontName = option.dataset.fontName;
            const fontCategory = option.dataset.fontCategory;
            if (fontCategory === 'google' && !googleFonts.loaded.has(fontName)) {
                loadGoogleFont(fontName).then(() => {
                    option.querySelector('.font-option-name').style.fontFamily = option.dataset.fontValue;
                });
            }
        });
    });
}

// Update font picker preview from state
function updateFontPickerPreview() {
    updateSingleFontPickerPreview('headline-font', 'font-picker-preview', 'headlineFont');
    updateSingleFontPickerPreview('subheadline-font', 'subheadline-font-picker-preview', 'subheadlineFont');
}

function updateSingleFontPickerPreview(hiddenId, previewId, stateKey) {
    const preview = document.getElementById(previewId);
    const hiddenInput = document.getElementById(hiddenId);
    if (!preview || !hiddenInput) return;

    const text = getTextSettings();
    const fontValue = text[stateKey];
    if (!fontValue) return;

    hiddenInput.value = fontValue;

    // Extract font name from value
    let fontName = 'SF Pro Display';
    const systemFont = googleFonts.system.find(f => f.value === fontValue);
    if (systemFont) {
        fontName = systemFont.name;
    } else {
        // Try to extract from Google Font value like "'Roboto', sans-serif"
        const match = fontValue.match(/'([^']+)'/);
        if (match) {
            fontName = match[1];
            // Load the font if it's a Google Font
            loadGoogleFont(fontName);
        }
    }

    preview.textContent = fontName;
    preview.style.fontFamily = fontValue;
}

function updateElementFontPickerPreview(el) {
    const preview = document.getElementById('element-font-picker-preview');
    const hiddenInput = document.getElementById('element-font');
    if (!preview || !hiddenInput || !el) return;

    const fontValue = el.font;
    if (!fontValue) return;

    hiddenInput.value = fontValue;

    let fontName = 'SF Pro Display';
    const systemFont = googleFonts.system.find(f => f.value === fontValue);
    if (systemFont) {
        fontName = systemFont.name;
    } else {
        const match = fontValue.match(/'([^']+)'/);
        if (match) {
            fontName = match[1];
            loadGoogleFont(fontName);
        }
    }

    preview.textContent = fontName;
    preview.style.fontFamily = fontValue;
}

// Device dimensions
const deviceDimensions = {
    'iphone-6.9': { width: 1320, height: 2868 },
    'iphone-6.7': { width: 1290, height: 2796 },
    'iphone-6.5': { width: 1284, height: 2778 },
    'iphone-5.5': { width: 1242, height: 2208 },
    'ipad-13': { width: 2064, height: 2752 },
    'ipad-12.9': { width: 2048, height: 2732 },
    'ipad-11': { width: 1668, height: 2388 },
    // Apple Watch — App Store Connect accepts exactly these six sizes, one per
    // MODEL FAMILY (not per case size): a Series 11 42mm still uploads at the
    // 46mm size, an SE 3 40mm at the 44mm size. Keys must keep the `watch`
    // prefix — the 2D device-model handler matches the output device by family
    // prefix (appstore-features.js, initDeviceTextExtras).
    'watch-ultra3': { width: 422, height: 514 },
    'watch-ultra': { width: 410, height: 502 },
    'watch-46': { width: 416, height: 496 },
    'watch-45': { width: 396, height: 484 },
    'watch-44': { width: 368, height: 448 },
    'watch-42': { width: 312, height: 390 },
    'mac-2880': { width: 2880, height: 1800 },
    'mac-2560': { width: 2560, height: 1600 },
    'mac-1440': { width: 1440, height: 900 },
    'mac-1280': { width: 1280, height: 800 },
    'android-phone': { width: 1080, height: 1920 },
    'android-phone-hd': { width: 1440, height: 2560 },
    'android-tablet-7': { width: 1200, height: 1920 },
    'android-tablet-10': { width: 1600, height: 2560 },
    'web-og': { width: 1200, height: 630 },
    'web-twitter': { width: 1200, height: 675 },
    'web-hero': { width: 1920, height: 1080 },
    'web-feature': { width: 1024, height: 500 }
};

// The default watch size when the user picks the Watch device model.
const DEFAULT_WATCH_DEVICE = 'watch-46';

// Is `key` (default: the project's output size) an Apple Watch canvas? Watch
// canvases are an order of magnitude smaller than every other output size
// (416 px wide vs 1320), so a few renderer defaults tuned in absolute pixels
// — shadows, the auto-fit floor — key off this.
function isWatchOutput(key) {
    return String(key === undefined ? state.outputDevice : key).startsWith('watch');
}

// 3D mockups are driven by the GLB models in models/ (three-renderer.js
// deviceConfigs). There is no Apple Watch model, so watch output stays 2D.
function output3DSupported() {
    return !isWatchOutput();
}

// Human family label for an output size key, for the screenshot list.
function outputDeviceFamilyLabel(key) {
    const k = String(key === undefined ? state.outputDevice : key);
    if (k.startsWith('watch')) return 'Apple Watch';
    if (k.startsWith('ipad')) return 'iPad';
    if (k.startsWith('mac')) return 'Mac';
    if (k.startsWith('android')) return 'Android';
    if (k.startsWith('web')) return 'Web';
    if (k === 'custom') return 'Custom';
    return 'iPhone';
}

// The 2D device model that goes with an output size family. Mirrors the
// model→size map the Device Model buttons use, in the other direction.
function outputDeviceModel2D(key) {
    const k = String(key === undefined ? state.outputDevice : key);
    if (k.startsWith('watch')) return 'watch';
    if (k.startsWith('ipad')) return 'ipad';
    if (k.startsWith('mac')) return 'mac';
    if (k.startsWith('android')) return 'samsung';
    return 'iphone';
}

// Pixel size of any output key, `custom` included — deviceDimensions alone
// can't answer for `custom`, and `hasOwnProperty` keeps inherited Object keys
// ('constructor', 'toString', …) from passing as valid device names.
function outputDeviceSize(key) {
    if (key === 'custom') return { width: state.customWidth, height: state.customHeight };
    return Object.prototype.hasOwnProperty.call(deviceDimensions, key) ? deviceDimensions[key] : null;
}

// DOM elements
const canvas = document.getElementById('preview-canvas');
const ctx = canvas.getContext('2d');
const canvasLeft = document.getElementById('preview-canvas-left');
const ctxLeft = canvasLeft.getContext('2d');
const canvasRight = document.getElementById('preview-canvas-right');
const ctxRight = canvasRight.getContext('2d');
const canvasFarLeft = document.getElementById('preview-canvas-far-left');
const ctxFarLeft = canvasFarLeft.getContext('2d');
const canvasFarRight = document.getElementById('preview-canvas-far-right');
const ctxFarRight = canvasFarRight.getContext('2d');
const sidePreviewLeft = document.getElementById('side-preview-left');
const sidePreviewRight = document.getElementById('side-preview-right');
const sidePreviewFarLeft = document.getElementById('side-preview-far-left');
const sidePreviewFarRight = document.getElementById('side-preview-far-right');
const previewStrip = document.querySelector('.preview-strip');
const canvasWrapper = document.getElementById('canvas-wrapper');

let isSliding = false;
let skipSidePreviewRender = false;  // Flag to skip re-rendering side previews after pre-render

// Two-finger horizontal swipe to navigate between screenshots
let swipeAccumulator = 0;
const SWIPE_THRESHOLD = 50; // Minimum accumulated delta to trigger navigation

// Prevent browser back/forward gesture on the entire canvas area
canvasWrapper.addEventListener('wheel', (e) => {
    // Prevent horizontal scroll from triggering browser back/forward
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
    }
}, { passive: false });

previewStrip.addEventListener('wheel', (e) => {
    // Only handle horizontal scrolling (two-finger swipe on trackpad)
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;

    e.preventDefault();
    e.stopPropagation();

    if (isSliding) return;
    if (state.screenshots.length <= 1) return;

    swipeAccumulator += e.deltaX;

    if (swipeAccumulator > SWIPE_THRESHOLD) {
        // Swipe left = go to next screenshot
        const nextIndex = state.selectedIndex + 1;
        if (nextIndex < state.screenshots.length) {
            slideToScreenshot(nextIndex, 'right');
        }
        swipeAccumulator = 0;
    } else if (swipeAccumulator < -SWIPE_THRESHOLD) {
        // Swipe right = go to previous screenshot
        const prevIndex = state.selectedIndex - 1;
        if (prevIndex >= 0) {
            slideToScreenshot(prevIndex, 'left');
        }
        swipeAccumulator = 0;
    }
}, { passive: false });
const fileInput = document.getElementById('file-input');
const screenshotList = document.getElementById('screenshot-list');
const noScreenshot = document.getElementById('no-screenshot');

// SERVER-ONLY STORAGE. The MCP server's disk is the one and only project store:
// a project is on the server or it doesn't exist. The browser persists nothing
// but the current-project id (a UI preference, in localStorage). Older builds
// kept a full IndexedDB mirror — it is deleted at startup (legacy cleanup).
const LEGACY_DB_NAME = 'AppStoreScreenshotGenerator';

let currentProjectId = 'default';
let projects = [{ id: 'default', name: 'Default Project', screenshotCount: 0 }];

// Optimistic concurrency: the server revision the open project is based on. It's
// set from each successful pull/push and sent back as the base rev, so the server
// can reject (409) a stale tab's autosave instead of letting it overwrite newer
// data — e.g. screenshots/text Claude (MCP) pushed while this tab sat idle. On a
// 409 (or when the freshness check spots a newer server rev) we reload the
// server's copy rather than clobber it. remoteRev caches the last-seen rev per id.
let currentProjectRev = 0;
const remoteRev = new Map();
// True while we're reloading the server's newer copy into the editor, so saveState
// doesn't echo that freshly-loaded data straight back out as a redundant push.
let _reloadingFromServer = false;
// True while a push to the server is actually in flight, so the live event stream
// doesn't mistake our own save for a remote change and reload on top of it.
let _remotePushInFlight = false;
// The live update stream (Server-Sent Events). Lets MCP/Claude edits show up in
// this tab instantly, with no manual refresh.
let _remoteEventSource = null;

// One-time cleanup of the legacy IndexedDB mirror (older builds cached projects
// in the browser; that cache no longer exists — the server is the only store).
function deleteLegacyDatabase() {
    try {
        if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase(LEGACY_DB_NAME);
    } catch (e) { /* best effort */ }
}

// The only persisted UI preference: which project is open.
function loadProjectsMeta() {
    try {
        const saved = localStorage.getItem('currentProjectId');
        if (saved) currentProjectId = saved;
    } catch (e) { /* localStorage unavailable — session-only */ }
}

function saveProjectsMeta() {
    try {
        localStorage.setItem('currentProjectId', currentProjectId);
    } catch (e) { /* best effort */ }
}

// ===== Remote project store =====
// The MCP server's disk is the ONLY project store. The list of projects, every
// record and every image live there; the browser holds the open project in
// memory and pushes each change. Nothing project-related persists browser-side.

// ===== Pending-upload ledger ===============================================
// Guarantee: a file that enters the editor can NOT silently disappear before the
// SERVER has confirmed it (blob present + record referencing it accepted).
//
// Every imported image is recorded here (in memory — the blocking upload overlay
// plus the beforeunload warning cover the tab-close window) and removed only on
// server confirmation. Whenever the app adopts the server's copy of a project
// (the server is the source of truth: SSE update, freshness reload, push
// conflict, reconnect), pending entries are re-applied into the fresh server
// record and pushed again. Server truth is preserved: a stale entry never
// overwrites a slot the server has since filled — entries only complete the
// save of the user's own recent upload.
const PENDING_UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // give up + warn after 7 days
const PENDING_UPLOAD_FRESH_MS = 10 * 60 * 1000; // a fresh entry may overwrite (it's the user's latest intent)
let _pendingUploads = {}; // { [projectId]: [{ lang, name, base, src, ts }] }

async function getPendingUploads() {
    return _pendingUploads;
}
function persistPendingUploads() { /* in-memory only — nothing to persist */ }

// Record an image that just entered the editor (called from every import path).
function trackPendingUpload(lang, name, src) {
    if (!src || typeof src !== 'string' || !src.startsWith('data:image/')) return;
    const l = lang || 'en';
    const pid = currentProjectId; // capture now — the user may switch projects before the async hop
    getPendingUploads().then(all => {
        const list = all[pid] = all[pid] || [];
        const base = (typeof getBaseFilename === 'function') ? getBaseFilename(name || '') : (name || '');
        const entry = { lang: l, name: name || '', base, src, ts: Date.now() };
        const i = list.findIndex(e => e.base === base && e.lang === l);
        if (i >= 0) list[i] = entry; else list.push(entry);
        persistPendingUploads();
    }).catch(() => {});
}

// After a successful push: drop every entry whose slot landed in the accepted
// record with its blob verified present (not in missingRefs).
function confirmPendingUploads(projectId, refRecord, missingRefs) {
    getPendingUploads().then(all => {
        const list = all[projectId];
        if (!list || !list.length) return;
        const missing = new Set(missingRefs || []);
        const slots = new Map(); // "base\u0000lang" -> src in the accepted record
        (refRecord.screenshots || []).forEach(s => {
            const b = (typeof getBaseFilename === 'function') ? getBaseFilename(s.name || '') : (s.name || '');
            const li = s.localizedImages || {};
            Object.keys(li).forEach(lang => {
                if (li[lang] && li[lang].src) slots.set(b + '\u0000' + lang, li[lang].src);
            });
        });
        const before = list.length;
        const kept = list.filter(e => {
            if (Date.now() - e.ts > PENDING_UPLOAD_MAX_AGE_MS) return false; // aged out
            const src = slots.get(e.base + '\u0000' + e.lang);
            if (!src) return true; // slot absent from the accepted record — still pending
            if (typeof src === 'string' && src.startsWith(REF_SCHEME) && missing.has(src.slice(REF_SCHEME.length))) {
                return true; // record accepted but the blob is missing server-side — still pending
            }
            return false; // confirmed on the server → done
        });
        if (kept.length !== before) {
            if (kept.length) all[projectId] = kept; else delete all[projectId];
            persistPendingUploads();
        }
    }).catch(() => {});
}

// Re-apply pending entries into a (fresh-from-server) project record. Pure data
// operation — no DOM, no Image decoding — so it also works for closed projects.
// Server-truth rule: an entry only fills an EMPTY slot, unless it is FRESH
// (uploaded minutes ago — the user's own replacement that must not be lost).
// Returns { changed, keep }: keep = entries still awaiting confirmation.
function applyPendingUploadsToRecord(rec, list) {
    let changed = false;
    const now = Date.now();
    const keep = [];
    for (const e of (list || [])) {
        if (now - e.ts > PENDING_UPLOAD_MAX_AGE_MS) {
            console.warn('Upload en attente abandonné (trop ancien):', e.name, e.lang);
            continue;
        }
        let s = null;
        for (const sc of (rec.screenshots || [])) {
            const b = (typeof getBaseFilename === 'function') ? getBaseFilename(sc.name || '') : (sc.name || '');
            if (b === e.base) { s = sc; break; }
        }
        if (!s) {
            // The screenshot this upload created doesn't exist server-side → recreate
            // it from the project defaults (same shape as createNewScreenshot).
            const d = rec.defaults || {};
            const clone = (o) => o ? JSON.parse(JSON.stringify(o)) : undefined;
            s = {
                src: '', name: e.name || e.base, deviceType: undefined, localizedImages: {},
                background: clone(d.background), screenshot: clone(d.screenshot), text: clone(d.text),
                elements: [], popouts: [], overrides: {}
            };
            rec.screenshots = rec.screenshots || [];
            rec.screenshots.push(s);
        }
        s.localizedImages = s.localizedImages || {};
        const slot = s.localizedImages[e.lang];
        const fresh = (now - e.ts) < PENDING_UPLOAD_FRESH_MS;
        if (slot && slot.src && !fresh) continue; // server's copy wins for stale entries
        if (!slot || !slot.src || slot.src !== e.src) {
            s.localizedImages[e.lang] = { src: e.src, name: e.name || e.base };
            changed = true;
        }
        keep.push(e); // pending until a push confirms it
    }
    return { changed, keep };
}

// Re-apply + push the pending entries of one project (record-level). Returns true
// if a push was scheduled.
async function reapplyPendingUploads(projectId) {
    try {
        const all = await getPendingUploads();
        const list = all[projectId];
        if (!list || !list.length) return false;
        const rec = await RemoteStore.get(projectId); // server is the only store
        if (!rec) return false;
        const res = applyPendingUploadsToRecord(rec, list);
        if (res.keep.length) all[projectId] = res.keep; else delete all[projectId];
        persistPendingUploads();
        if (res.changed) {
            const meta = projects.find(p => p.id === projectId);
            scheduleRemotePush({ ...rec, name: meta ? meta.name : (rec.name || projectId) });
            return true;
        }
        return false;
    } catch (e) {
        console.warn('Ré-application des uploads en attente échouée:', e);
        return false;
    }
}

// ===== Image compression =====
// Screenshots are the bulk of what a project stores: a 40-language project keeps
// 40 copies of every screen, so the bytes each one costs decide whether the
// project weighs 20 MB or 500 MB. Imported images are therefore re-encoded
// before they enter the project — to WebP (30-50% under the same-quality JPEG)
// and, when they carry more pixels than any output size can show, downscaled.
//
// Preferences live in localStorage (per browser, not per project); the same
// values are sent to the server when re-compressing images already stored (see
// optimizeStoredImages).
const IMAGE_OPT_DEFAULTS = {
    quality: 0.82,
    // Longest edge, in pixels. 2880 covers every stock App Store output size
    // (mac-2880 = 2880, iphone-6.9 = 2868). Projects that render WIDER than that
    // — a panorama spanning several screens, or a custom output size — raise it
    // themselves, see effectiveMaxEdge(). 0 = keep whatever the file came with.
    maxEdge: 2880,
    format: 'auto', // 'auto' → WebP when the browser can encode it, else JPEG
};

// The largest edge at which THIS project can actually draw an image: its output
// canvas, widened by the biggest panorama span in use. Downscaling below this is
// the one way compression could soften an export (the export itself is always a
// full-resolution PNG re-rendered from the canvas), so it is a hard floor under
// the user's "maximum size" setting rather than something the setting can undercut.
function projectRenderLongEdge() {
    try {
        const base = state.outputDevice === 'custom'
            ? { width: state.customWidth || 1290, height: state.customHeight || 2796 }
            : (deviceDimensions[state.outputDevice] || deviceDimensions['iphone-6.9']);
        let span = 1;
        for (const s of state.screenshots || []) {
            const n = s && s.screenshot && s.screenshot.spanScreens;
            if (n > span) span = n;
        }
        return Math.max(base.width * span, base.height);
    } catch (e) { return 0; }
}

function effectiveMaxEdge(cfg) {
    if (!cfg.maxEdge) return 0; // "keep original size"
    return Math.max(cfg.maxEdge, projectRenderLongEdge());
}

function getImageOptSettings() {
    const num = (v, d) => { const n = parseFloat(v); return isFinite(n) ? n : d; };
    try {
        return {
            quality: Math.min(1, Math.max(0.3, num(localStorage.getItem('imageQuality'), IMAGE_OPT_DEFAULTS.quality))),
            maxEdge: Math.max(0, num(localStorage.getItem('imageMaxEdge'), IMAGE_OPT_DEFAULTS.maxEdge)),
            format: localStorage.getItem('imageFormat') || IMAGE_OPT_DEFAULTS.format,
        };
    } catch (e) { return { ...IMAGE_OPT_DEFAULTS }; }
}

// Canvas WebP encoding is not universal (older Safari silently hands back a PNG
// instead), so probe it once and fall back to JPEG when it isn't there.
let _canEncodeWebP = null;
function canEncodeWebP() {
    if (_canEncodeWebP !== null) return _canEncodeWebP;
    try {
        const c = document.createElement('canvas');
        c.width = c.height = 1;
        _canEncodeWebP = c.toDataURL('image/webp').indexOf('data:image/webp') === 0;
    } catch (e) { _canEncodeWebP = false; }
    return _canEncodeWebP;
}

function targetImageMime(format) {
    const wanted = format || getImageOptSettings().format;
    if (wanted === 'jpeg') return 'image/jpeg';
    return canEncodeWebP() ? 'image/webp' : 'image/jpeg';
}

// Downscale in halving steps. A single drawImage that shrinks by more than ~2x
// samples too few source pixels and aliases badly (text in screenshots turns to
// mush); halving repeatedly keeps it clean.
function downscaleToCanvas(img, w, h) {
    let srcW = img.naturalWidth || img.width;
    let srcH = img.naturalHeight || img.height;
    let src = img;
    while (srcW > w * 2 && srcH > h * 2) {
        const stepW = Math.max(w, Math.round(srcW / 2));
        const stepH = Math.max(h, Math.round(srcH / 2));
        const step = document.createElement('canvas');
        step.width = stepW; step.height = stepH;
        const sctx = step.getContext('2d');
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(src, 0, 0, stepW, stepH);
        src = step; srcW = stepW; srcH = stepH;
    }
    const out = document.createElement('canvas');
    out.width = w; out.height = h;
    const ctx = out.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    // Both target codecs are written opaque here (screenshots and background
    // photos are), so flatten any alpha on white rather than losing it to black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(src, 0, 0, w, h);
    return out;
}

// Re-encode a data URL smaller: capped at `maxEdge` on the longest side and
// written as WebP/JPEG. Vector and animated formats are passed through untouched
// (a canvas round-trip would rasterize an SVG and drop every frame but the first
// of a GIF), as is anything the re-encode fails to actually shrink.
//
// `allowRecompress` (default false) decides what happens to an image that is
// ALREADY in a lossy format and small enough: by default it is left alone, so
// repeated saves can't stack generation after generation of artefacts on it.
function optimizeImageDataUrl(dataUrl, opts = {}) {
    return new Promise((resolve) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) return resolve(dataUrl);
        if (/^data:image\/(svg|gif)/i.test(dataUrl)) return resolve(dataUrl);
        const cfg = { ...getImageOptSettings(), ...opts };
        const mime = targetImageMime(cfg.format);
        const isLossy = /^data:image\/(jpeg|webp)/i.test(dataUrl);
        const img = new Image();
        img.onload = () => {
            try {
                const w0 = img.naturalWidth || img.width;
                const h0 = img.naturalHeight || img.height;
                if (!w0 || !h0) return resolve(dataUrl);
                const longest = Math.max(w0, h0);
                const cap = effectiveMaxEdge(cfg);
                const scale = (cap > 0 && longest > cap) ? cap / longest : 1;
                // Nothing to gain: already compressed and already small enough.
                if (scale === 1 && isLossy && !cfg.allowRecompress) return resolve(dataUrl);
                const w = Math.max(1, Math.round(w0 * scale));
                const h = Math.max(1, Math.round(h0 * scale));
                const canvas = downscaleToCanvas(img, w, h);
                let out = canvas.toDataURL(mime, cfg.quality);
                if (mime === 'image/webp' && out.indexOf('data:image/webp') !== 0) {
                    out = canvas.toDataURL('image/jpeg', cfg.quality); // encoder lied — fall back
                }
                resolve(out && out.length < dataUrl.length ? out : dataUrl);
            } catch (e) { resolve(dataUrl); }
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

// Compress an image the user just imported, before it enters the project — so
// the editor holds (and later uploads) the small version, not the original.
// Returns null when nothing changed or the result can't be decoded back.
//
// This is the one place that re-encodes an already-lossy file: import happens
// exactly once per file, so converting the user's JPEG into the app's storage
// format costs a single generation (and is dropped anyway if it doesn't come out
// smaller). Every later save leaves it alone.
async function optimizeImportedImage(dataUrl) {
    let out;
    try { out = await optimizeImageDataUrl(dataUrl, { allowRecompress: true }); } catch (e) { return null; }
    if (!out || out === dataUrl) return null;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ src: out, image: img });
        img.onerror = () => resolve(null); // keep the original rather than lose the file
        img.src = out;
    });
}

// Decode a data: URL to raw bytes + mime.
function dataUrlToBytes(dataUrl) {
    const comma = dataUrl.indexOf(',');
    const header = dataUrl.slice(5, comma); // e.g. "image/jpeg;base64"
    const mime = header.split(';')[0] || 'application/octet-stream';
    const body = dataUrl.slice(comma + 1);
    let bytes;
    if (/;base64/i.test(header)) {
        const bin = atob(body);
        bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
        bytes = new TextEncoder().encode(decodeURIComponent(body));
    }
    return { bytes, mime };
}

async function sha256Hex(bytes) {
    const buf = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const EXT_FROM_MIME = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' };

// data:URL -> blob name, for images confirmed present on the server (set after a
// successful upload, or after fetching a blob from the server). Lets the heal
// path map missing blob names back to bytes this session still holds.
const refCache = new Map();
const REF_SCHEME = 'appdisk://';

// Externalize a project's images for upload: compress raster images (see
// optimizeImageDataUrl — a no-op for anything already compressed and small
// enough, so images that came in through the import path aren't touched twice),
// replace every inline data:image URL with a content-hash reference
// ("appdisk://<sha>.<ext>"), and collect the unique image blobs to upload as
// binary. Identical images (e.g. the same screenshot across many languages) are
// deduped to a single blob, so the project JSON stays tiny and the transfer is
// small and fast — no more giant base64 payloads hitting body-size limits.
async function externalizeForUpload(record) {
    const clone = JSON.parse(JSON.stringify(record));
    const blobs = new Map(); // name -> { bytes, mime }
    const seen = new Map();  // original dataUrl -> ref (avoid recompressing duplicates)
    const refs = new Map();  // original dataUrl -> blob name (committed to refCache on success)

    const handle = async (val, keepFormat) => {
        if (typeof val === 'string' && val.startsWith('data:image/')) {
            const seenKey = (keepFormat ? 'k:' : 'c:') + val;
            if (seen.has(seenKey)) return seen.get(seenKey);
            const compressed = keepFormat ? val : await optimizeImageDataUrl(val);
            const { bytes, mime } = dataUrlToBytes(compressed);
            const hash = (await sha256Hex(bytes)).slice(0, 40);
            const ext = EXT_FROM_MIME[mime] || 'png';
            const name = hash + '.' + ext;
            if (!blobs.has(name)) blobs.set(name, { bytes, mime });
            const ref = REF_SCHEME + name;
            seen.set(seenKey, ref);
            refs.set(val, name);
            return ref;
        }
        return val;
    };
    const walk = async (obj, keepFormat) => {
        if (Array.isArray(obj)) {
            for (let i = 0; i < obj.length; i++) {
                const mapped = await handle(obj[i], keepFormat);
                if (mapped !== obj[i]) obj[i] = mapped;
                else if (obj[i] && typeof obj[i] === 'object') await walk(obj[i], keepFormat);
            }
        } else if (obj && typeof obj === 'object') {
            for (const k of Object.keys(obj)) {
                // Element/popout graphics can be transparent PNGs — never flatten
                // them to JPEG. Only screenshots/backgrounds get compressed.
                const childKeep = keepFormat || k === 'elements' || k === 'popouts';
                const mapped = await handle(obj[k], childKeep);
                if (mapped !== obj[k]) obj[k] = mapped;
                else if (obj[k] && typeof obj[k] === 'object') await walk(obj[k], childKeep);
            }
        }
    };
    await walk(clone, false);
    return {
        record: clone,
        blobs: Array.from(blobs, ([name, v]) => ({ name, bytes: v.bytes, mime: v.mime })),
        refs,
    };
}

// Session cache of resolved blobs (name -> data URL), so switching back to a
// project doesn't re-fetch/re-decode. The browser also HTTP-caches the blobs
// (immutable), so even a fresh page load only downloads each image once.
const blobDataUrlCache = new Map();

async function fetchBlobDataUrl(base, id, name) {
    if (blobDataUrlCache.has(name)) return blobDataUrlCache.get(name);
    try {
        const r = await fetch(base + '/projects/' + id + '/blobs/' + name, { headers: RemoteStore._headers(false) });
        if (!r.ok) return null;
        const blob = await r.blob();
        const dataUrl = await new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.onerror = () => res(null);
            fr.readAsDataURL(blob);
        });
        if (dataUrl) { blobDataUrlCache.set(name, dataUrl); refCache.set(dataUrl, name); }
        return dataUrl;
    } catch (e) { return null; }
}

// Fetch the unique blob names referenced by `targets` (parallel, bounded
// concurrency so we don't fire hundreds of requests at once) and write each
// resolved data URL back into its location. Shared by both resolvers below.
async function applyResolvedRefs(base, id, targets) {
    const names = [...new Set(targets.map(t => t.name))];
    const resolved = new Map();
    const CONCURRENCY = 8;
    let i = 0;
    const worker = async () => {
        while (i < names.length) {
            const name = names[i++];
            const du = await fetchBlobDataUrl(base, id, name);
            if (du) resolved.set(name, du);
        }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, names.length) }, worker));
    for (const t of targets) { const du = resolved.get(t.name); if (du) t.obj[t.key] = du; }
}

// Inverse of refify: replace EVERY "appdisk://<name>" ref with a data URL from the
// server's blob store (parallel). Used for export, where all languages' bytes are
// needed. Failed fetches leave the ref (image just won't show — offline). Mutates.
async function resolveRefsInRecord(record) {
    if (!record || typeof record !== 'object') return record;
    const base = RemoteStore.baseUrl();
    if (!base) return record; // no server reachable → can't resolve (offline)
    const targets = [];
    const walk = (obj) => {
        const keys = Array.isArray(obj) ? obj.map((_, i) => i) : Object.keys(obj);
        for (const k of keys) {
            const v = obj[k];
            if (typeof v === 'string' && v.startsWith(REF_SCHEME)) {
                targets.push({ obj, key: k, name: v.slice(REF_SCHEME.length) });
            } else if (v && typeof v === 'object') {
                walk(v);
            }
        }
    };
    walk(record);
    await applyResolvedRefs(base, encodeURIComponent(currentProjectId), targets);
    return record;
}

// Turn an image source (data URL, "appdisk://<name>" ref, or http URL) into a URL
// the browser can load directly. Refs become the server's blob URL (immutable,
// HTTP-cached). Returns null if a ref can't be resolved (no server).
function blobUrlForRef(src) {
    if (typeof src !== 'string' || !src) return null;
    if (src.startsWith('data:') || /^https?:\/\//i.test(src)) return src;
    if (src.startsWith(REF_SCHEME)) {
        const base = RemoteStore.baseUrl();
        if (!base) return null;
        // <img> loads can't send headers — pass the auth token (if any) as a query param.
        const token = localStorage.getItem('mcpServerToken');
        return base + '/projects/' + encodeURIComponent(currentProjectId) + '/blobs/' + src.slice(REF_SCHEME.length)
            + (token ? '?token=' + encodeURIComponent(token) : '');
    }
    return src;
}

// Coalesce the re-renders triggered when several lazily-loaded images arrive at
// once (e.g. on a language switch): batch them into a single repaint per frame.
let _canvasRefreshQueued = false;
function scheduleCanvasRefresh() {
    if (_canvasRefreshQueued) return;
    _canvasRefreshQueued = true;
    const run = () => {
        _canvasRefreshQueued = false;
        updateCanvas();
        try { updateSidePreviews(); } catch (e) {}
    };
    (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(run) : setTimeout(run, 16));
}

// Lazily decode a localized-image entry's bitmap (from the server blob URL or its
// data URL), caching the Image on the entry. Returns the Image if already loaded,
// else kicks off loading, returns null, and re-renders when it arrives. This is
// what makes the app load "only what's shown" instead of every language up front.
// `silent` skips the re-render (used when prefetching off-screen languages).
function ensureEntryImage(entry, silent) {
    if (!entry) return null;
    if (entry.image) return entry.image;
    // Don't retry a failed load on every render (getScreenshotImage runs each
    // repaint — a 404/CORS failure would otherwise storm the server during a drag).
    if (entry._loading || entry._failedSrc === entry.src) return null;
    const url = blobUrlForRef(entry.src);
    if (!url) return null;
    entry._loading = true;
    const img = new Image();
    img.decoding = 'async';
    if (!url.startsWith('data:')) img.crossOrigin = 'anonymous'; // keep canvas export-clean
    img.onload = () => {
        entry.image = img;
        entry._loading = false;
        entry._failedSrc = null;
        if (!silent) scheduleCanvasRefresh();
    };
    img.onerror = () => { entry._loading = false; entry._failedSrc = entry.src; };
    img.src = url;
    return null;
}

// After the current language is shown, quietly pre-decode the NEXT language's
// images in the background so switching to it is instant. Bounded to one language
// (not all) to keep things light.
let _prefetchTimer = null;
function scheduleLanguagePrefetch() {
    if (_prefetchTimer) clearTimeout(_prefetchTimer);
    _prefetchTimer = setTimeout(() => {
        _prefetchTimer = null;
        const langs = state.projectLanguages || [];
        if (langs.length < 2) return;
        const idx = Math.max(0, langs.indexOf(state.currentLanguage));
        const nextLang = langs[(idx + 1) % langs.length];
        if (!nextLang || nextLang === state.currentLanguage) return;
        for (const s of state.screenshots) {
            const e = s.localizedImages && s.localizedImages[nextLang];
            if (e && e.src && !e.image && !e._loading) ensureEntryImage(e, true /* silent */);
        }
    }, 1200);
}

// Resolve only what the INITIAL render needs: each screenshot's background +
// elements + legacy src + the CURRENT language's image. Other languages stay as
// refs and load lazily (getScreenshotImage → ensureEntryImage) when selected.
// Parallel + bounded. Mutates record.
async function resolveProjectRefs(record, lang) {
    if (!record || typeof record !== 'object') return record;
    const base = RemoteStore.baseUrl();
    if (!base) return record;
    const targets = [];
    const addRef = (obj, key) => {
        const v = obj && obj[key];
        if (typeof v === 'string' && v.startsWith(REF_SCHEME)) targets.push({ obj, key, name: v.slice(REF_SCHEME.length) });
    };
    const order = [lang, ...(record.projectLanguages || []), 'en'];
    for (const s of record.screenshots || []) {
        addRef(s, 'src'); // legacy single image
        if (s.background) addRef(s.background, 'image');
        for (const el of (s.elements || [])) { addRef(el, 'src'); addRef(el, 'image'); }
        const li = s.localizedImages;
        if (li) {
            const isRefEntry = (l) => li[l] && typeof li[l].src === 'string' && li[l].src.startsWith(REF_SCHEME);
            const pick = order.find(isRefEntry) || Object.keys(li).find(isRefEntry);
            if (pick) addRef(li[pick], 'src');
        }
    }
    await applyResolvedRefs(base, encodeURIComponent(currentProjectId), targets);
    return record;
}

const RemoteStore = {
    baseUrl() {
        // Fall back to the page-derived default (same origin → ".../mcp") when no
        // URL is saved, so a fresh browser / private window still finds the
        // server and its projects (localStorage isn't shared with incognito).
        const saved = localStorage.getItem('mcpServerUrl');
        const url = saved || (typeof defaultMcpUrl === 'function' ? defaultMcpUrl() : null);
        if (!url) return null;
        // Keep the configured path (e.g. ".../mcp"): the server mounts the REST
        // API under both "/" and "/mcp", and a reverse proxy may only forward
        // "/mcp/*" to it. We just append "/projects" to whatever is resolved.
        return url.replace(/\/+$/, '');
    },
    isExplicit() { return !!localStorage.getItem('mcpServerUrl'); },
    enabled() { return !!this.baseUrl(); },
    _headers(json) {
        const h = json ? { 'Content-Type': 'application/json' } : {};
        const t = localStorage.getItem('mcpServerToken');
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    },
    async list() {
        const b = this.baseUrl(); if (!b) return null;
        try {
            const r = await fetch(b + '/projects', { headers: this._headers(false) });
            return r.ok ? await r.json() : null;
        } catch (e) { return null; }
    },
    async get(id) {
        const b = this.baseUrl(); if (!b) return null;
        try {
            // ?refs=1 → compact refs record (no inlined bytes). loadState resolves
            // the image blobs from the server on demand (disk-only).
            const r = await fetch(b + '/projects/' + encodeURIComponent(id) + '?refs=1', { headers: this._headers(false) });
            if (!r.ok) return null;
            const rec = await r.json();
            if (rec && typeof rec.rev === 'number') remoteRev.set(id, rec.rev);
            return rec;
        } catch (e) { return null; }
    },
    // Disk the project's images take on the server (deduplicated: the same
    // screenshot shared by 40 languages counts once). null when unavailable —
    // an older server without the endpoint answers 404.
    async storage(id) {
        const b = this.baseUrl(); if (!b) return null;
        try {
            const r = await fetch(b + '/projects/' + encodeURIComponent(id) + '/storage', { headers: this._headers(false) });
            return r.ok ? await r.json() : null;
        } catch (e) { return null; }
    },
    // Ask the server to re-encode a project's stored images (smaller codec, and
    // no more pixels than the output size can show). Returns the stats object,
    // or { error } — this one can take a while on a big project, so the caller
    // shows progress rather than a spinner-less wait.
    async optimizeImages(id, opts) {
        const b = this.baseUrl(); if (!b) return { error: 'no server' };
        try {
            const r = await fetch(b + '/projects/' + encodeURIComponent(id) + '/optimize', {
                method: 'POST', headers: this._headers(true), body: JSON.stringify(opts || {})
            });
            if (r.status === 404 || r.status === 405) return { error: 'unsupported' };
            const j = await r.json().catch(() => null);
            if (!r.ok) return { error: (j && j.error) || ('HTTP ' + r.status) };
            return j;
        } catch (e) { return { error: String(e && e.message || e) }; }
    },
    // Serialize all pushes so two uploads never run at once: otherwise their
    // progress writes to the single sync pill interleave and the "Envoi des
    // images n/N" counter jumps around randomly. Also prevents overlapping
    // pushes from racing on shared state.
    _putChain: Promise.resolve(),
    // Send one batch of blobs in a single request (binary framing). Returns true
    // on success, false on a real failure, or 'no-batch-endpoint' when the server
    // is too old (then the caller falls back to per-blob PUTs).
    async _uploadBatch(eid, batch) {
        const b = this.baseUrl(); if (!b) return false;
        const header = JSON.stringify(batch.map(x => ({ name: x.name, size: x.bytes.length })));
        const headerBytes = new TextEncoder().encode(header);
        const head = new Uint8Array(4);
        new DataView(head.buffer).setUint32(0, headerBytes.length, false);
        const body = new Blob([head, headerBytes, ...batch.map(x => x.bytes)]);
        let r;
        try {
            r = await fetch(b + '/projects/' + eid + '/blobs/batch', {
                method: 'POST', headers: { ...this._headers(false), 'Content-Type': 'application/octet-stream' }, body
            });
        } catch (e) { return false; }
        if (r.status === 404 || r.status === 405) return 'no-batch-endpoint';
        if (!r.ok) return false;
        try { const j = await r.json(); return !j.errors || j.errors.length === 0; } catch (e) { return true; }
    },
    // Upload blobs grouped into few batches (one round-trip per ~40 MB / 40 images
    // instead of one per image), with a per-blob PUT fallback for old servers.
    // items: [{ name, bytes, mime }]. onProgress(done, total). Returns true/false.
    async uploadBlobs(id, items, onProgress) {
        const b = this.baseUrl(); if (!b) return false;
        if (!items.length) return true;
        const eid = encodeURIComponent(id);
        const MAX_BYTES = 40 * 1024 * 1024, MAX_COUNT = 40;
        let done = 0, useBatch = true, i = 0;
        const total = items.length;
        const putOne = async (it) => {
            const r = await fetch(b + '/projects/' + eid + '/blobs/' + it.name, {
                method: 'PUT', headers: { ...this._headers(false), 'Content-Type': it.mime || 'application/octet-stream' }, body: it.bytes
            });
            return r.ok;
        };
        while (i < items.length) {
            const batch = [];
            let size = 0;
            while (i < items.length && batch.length < MAX_COUNT && (batch.length === 0 || size + items[i].bytes.length <= MAX_BYTES)) {
                batch.push(items[i]); size += items[i].bytes.length; i++;
            }
            if (useBatch) {
                const res = await this._uploadBatch(eid, batch);
                if (res === 'no-batch-endpoint') {
                    useBatch = false; // old server — PUT this batch one by one, then continue
                    for (const it of batch) { if (!(await putOne(it))) return false; done++; if (onProgress) onProgress(done, total); }
                    continue;
                }
                if (!res) return false;
                done += batch.length; if (onProgress) onProgress(done, total);
            } else {
                for (const it of batch) { if (!(await putOne(it))) return false; done++; if (onProgress) onProgress(done, total); }
            }
        }
        return true;
    },
    put(record) {
        const task = () => this._put(record);
        const next = this._putChain.then(task, task);
        this._putChain = next.catch(() => {}); // keep the chain alive on failure
        return next;
    },
    async _put(record) {
        const b = this.baseUrl(); if (!b || !record || !record.id) return false;
        const id = encodeURIComponent(record.id);
        this._lastPutConflict = false;
        _remotePushInFlight = true;
        try {
            setSyncStatus('syncing', 'Préparation des images…');
            const { record: refRecord, blobs, refs } = await externalizeForUpload(record);

            // Ask which image blobs the server still needs (dedup across pushes).
            let toUpload = blobs;
            try {
                const r = await fetch(b + '/projects/' + id + '/blobs/check', {
                    method: 'POST', headers: this._headers(true), body: JSON.stringify({ names: blobs.map(x => x.name) })
                });
                if (r.ok) {
                    const missing = new Set((await r.json()).missing || []);
                    toUpload = blobs.filter(x => missing.has(x.name));
                }
            } catch (e) { /* fall back to uploading all */ }

            // Upload missing image blobs — batched (few round-trips), raw binary.
            if (toUpload.length) {
                const ok = await this.uploadBlobs(record.id, toUpload, (d, t) => {
                    setSyncStatus('syncing', 'Envoi des images… ' + d + '/' + t);
                });
                if (!ok) {
                    setSyncStatus('error', 'Échec de l’envoi des images');
                    return false;
                }
            }

            // Finally PUT the tiny references-only project record.
            setSyncStatus('syncing', 'Enregistrement du projet…');
            // Base revision computed HERE, at send time — not when the save was
            // scheduled. Pushes are serialized (_putChain), so by now any earlier
            // push has resolved and currentProjectRev is up to date. Using the live
            // rev avoids a stale base that would 409 against our OWN earlier push
            // (the false "modifié ailleurs" when edits outrun the network).
            const baseRev = (record.id === currentProjectId)
                ? currentProjectRev
                : (remoteRev.has(record.id) ? remoteRev.get(record.id)
                   : (typeof record.rev === 'number' ? record.rev : undefined));
            if (baseRev != null) refRecord.rev = baseRev; else delete refRecord.rev;
            const headers = this._headers(true);
            if (baseRev != null) headers['If-Match'] = String(baseRev);
            const r = await fetch(b + '/projects/' + id, {
                method: 'PUT', headers, body: JSON.stringify(refRecord)
            });
            if (r.status === 409) {
                // Someone else (Claude/MCP, another tab) wrote a newer revision.
                // The SERVER is the source of truth: adopt its copy. Pending uploads
                // are NOT lost — reloadProjectFromServer re-applies the ledger into
                // the fresh server record and schedules their push.
                this._lastPutConflict = true;
                setSyncStatus('syncing', 'Projet modifié ailleurs — synchronisation…');
                await reloadProjectFromServer(record.id);
                setSyncStatus('ok', 'Synchronisé depuis le serveur');
                return false;
            }
            if (r.ok) {
                // Confirmed on the server — remember which bytes map to which blob
                // (drives the self-heal path).
                for (const [dataUrl, name] of refs) refCache.set(dataUrl, name);
                let missingRefs = [];
                try {
                    const j = await r.json();
                    if (j && typeof j.rev === 'number') {
                        // Adopt the new revision so our next push isn't seen as stale.
                        remoteRev.set(record.id, j.rev);
                        if (record.id === currentProjectId) currentProjectRev = j.rev;
                    }
                    if (j && Array.isArray(j.missingRefs)) missingRefs = j.missingRefs;
                } catch (e) { /* response without body — ignore */ }

                // The server verified every image reference of the accepted record.
                // If any blob is missing on its disk, re-upload the bytes we still
                // hold (this session's push, or the resolved-blob cache) — and warn
                // LOUDLY about anything we cannot repair: silence is how images
                // used to "disappear".
                if (missingRefs.length) {
                    const still = await this._healMissingBlobs(record.id, missingRefs, refs);
                    if (still.length) {
                        const labels = labelRefsInRecord(refRecord, still);
                        console.warn('Images référencées introuvables sur le serveur:', still, labels);
                        setSyncStatus('error', '⚠ ' + still.length + ' image(s) introuvable(s) sur le serveur'
                            + (labels.length ? ' — ' + labels.slice(0, 3).join(', ') + (labels.length > 3 ? '…' : '') : ''));
                    } else {
                        setSyncStatus('ok', 'Enregistré (images réparées sur le serveur)');
                    }
                    confirmPendingUploads(record.id, refRecord, still);
                    return true;
                }
                confirmPendingUploads(record.id, refRecord, []);
            }
            setSyncStatus(r.ok ? 'ok' : 'error', r.ok ? 'Enregistré sur le serveur' : 'Échec de l’enregistrement (HTTP ' + r.status + ')');
            return r.ok;
        } catch (e) {
            console.warn('MCP project push failed:', e);
            setSyncStatus('error', 'Serveur injoignable');
            return false;
        } finally {
            _remotePushInFlight = false;
        }
    },
    // Re-upload blobs the server reported missing, from any bytes this browser
    // still holds: this push's dataUrl→name map, or the session blob cache
    // (name→dataUrl, filled whenever a ref was resolved for display). Returns
    // the names that could NOT be repaired.
    async _healMissingBlobs(projectId, missingNames, pushRefs) {
        const b = this.baseUrl(); if (!b) return missingNames;
        const byName = new Map();
        try { for (const [dataUrl, name] of (pushRefs || [])) byName.set(name, dataUrl); } catch (e) {}
        try { for (const [name, dataUrl] of blobDataUrlCache) if (!byName.has(name)) byName.set(name, dataUrl); } catch (e) {}
        const stillMissing = [];
        for (const name of missingNames) {
            const dataUrl = byName.get(name);
            if (!dataUrl) { stillMissing.push(name); continue; }
            try {
                const { bytes, mime } = dataUrlToBytes(dataUrl);
                const r = await fetch(b + '/projects/' + encodeURIComponent(projectId) + '/blobs/' + name, {
                    method: 'PUT', headers: { ...this._headers(false), 'Content-Type': mime }, body: bytes
                });
                if (!r.ok) stillMissing.push(name);
            } catch (e) { stillMissing.push(name); }
        }
        return stillMissing;
    },
    async del(id) {
        const b = this.baseUrl(); if (!b) return false;
        try {
            const r = await fetch(b + '/projects/' + encodeURIComponent(id), { method: 'DELETE', headers: this._headers(false) });
            return r.ok;
        } catch (e) { return false; }
    },
};

// Human labels ("screen-3.png (de)") for blob refs inside a record — so a warning
// about a missing image tells the user WHICH screenshot/language is affected.
function labelRefsInRecord(refRecord, names) {
    const wanted = new Set(names || []);
    const labels = [];
    (refRecord.screenshots || []).forEach((s, i) => {
        const li = s.localizedImages || {};
        Object.keys(li).forEach(lang => {
            const src = li[lang] && li[lang].src;
            if (typeof src === 'string' && src.startsWith(REF_SCHEME) && wanted.has(src.slice(REF_SCHEME.length))) {
                labels.push((s.name || ('Screen ' + (i + 1))) + ' (' + lang + ')');
            }
        });
        const bg = s.background && s.background.image;
        if (typeof bg === 'string' && bg.startsWith(REF_SCHEME) && wanted.has(bg.slice(REF_SCHEME.length))) {
            labels.push('fond de ' + (s.name || ('Screen ' + (i + 1))));
        }
    });
    return labels;
}

// Ids of projects known to live on the server's disk. Empty when no server is
// configured or it's unreachable.
let remoteProjectIds = new Set();

// True while loadState() is still hydrating screenshots (images load async, after
// the promise resolves). saveState() is suppressed during this window so the
// transient empty state is never pushed to the server.
let projectLoading = false;
// Monotonic token: every loadState() call bumps it and captures its own value.
// When loads overlap (e.g. importing a 2nd project while the 1st is still
// hydrating), only the LATEST load may touch state / clear projectLoading / save
// — a stale load's async image callbacks must do nothing, or they would clobber
// the new project with the old one's (or an empty) state. (Was a data-loss bug.)
let loadStateSeq = 0;
function setProjectLoading(v) {
    projectLoading = v;
    if (v) {
        // Safety net: never stay blocked if image loads never complete.
        clearTimeout(setProjectLoading._t);
        setProjectLoading._t = setTimeout(() => { projectLoading = false; _reloadingFromServer = false; }, 8000);
    } else {
        clearTimeout(setProjectLoading._t);
    }
}

// Floating indicator shown while a project is being saved to the server's disk.
// state: 'syncing' | 'ok' | 'error' | 'idle'.
// ===== Blocking upload overlay =====
// Shown from the moment files enter the app until the SERVER confirms the save
// ("c'est soit sur le serveur, soit ça ne l'est pas du tout"). The user waits;
// the duplicate-image dialog renders above it (higher z-index) and stays usable.
let _uploadOverlayVisible = false;
function showUploadProgress(status, detail) {
    if (typeof document === 'undefined') return;
    _uploadOverlayVisible = true;
    const m = document.getElementById('upload-progress-modal');
    const s = document.getElementById('upload-progress-status');
    const d = document.getElementById('upload-progress-detail');
    if (s && status != null) s.textContent = status;
    if (d) d.textContent = detail || '';
    if (m) m.classList.add('visible');
}
function hideUploadProgress() {
    if (typeof document === 'undefined') return;
    _uploadOverlayVisible = false;
    const m = document.getElementById('upload-progress-modal');
    if (m) m.classList.remove('visible');
}

function setSyncStatus(state, msg) {
    if (typeof document === 'undefined') return;
    // While the blocking upload overlay is up, mirror the push progress messages
    // ("Envoi des images… 3/12", "Enregistrement du projet…") into it.
    if (_uploadOverlayVisible && msg) {
        const d = document.getElementById('upload-progress-detail');
        if (d) d.textContent = msg;
    }
    let el = document.getElementById('sync-pill');
    if (!el) {
        el = document.createElement('div');
        el.id = 'sync-pill';
        (document.body || document.documentElement).appendChild(el);
    }
    el.className = 'sync-pill ' + state;
    el.innerHTML = (state === 'syncing' ? '<span class="sync-spinner"></span>' : '')
        + '<span>' + (msg || '') + '</span>';
    clearTimeout(setSyncStatus._t);
    if (state === 'idle') { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    if (state === 'ok' || state === 'error') {
        setSyncStatus._t = setTimeout(() => { el.style.display = 'none'; }, state === 'ok' ? 1800 : 4500);
    }
}

// Debounced push of a project to the server (coalesces rapid edits). Keyed PER
// PROJECT id: scheduling a push for project B must not cancel project A's pending
// push (a single shared timer used to drop A's push entirely — data could be left
// un-synced after switching/importing projects).
const _remotePushPending = new Map(); // id -> { timer, record }
const _pushRetryCount = new Map();    // id -> consecutive failures

// Run one scheduled push and handle its outcome (retry with backoff on transient
// failure). Shared by the debounce timer and flushRemotePushNow. Resolves true
// only when the SERVER confirmed the save.
function _executeScheduledPush(id, rec) {
    if (!rec) return Promise.resolve(false);
    return RemoteStore.put(rec).then(ok => {
        if (ok) {
            _pushRetryCount.delete(id);
            remoteProjectIds.add(rec.id); // track server-side existence (internal)
            return true;
        }
        // A 409 is owned by the reload path (server wins + pending uploads
        // re-applied + re-pushed there) — don't ALSO retry here.
        if (RemoteStore._lastPutConflict) return false;
        // Transient failure (network, server restart): retry with backoff
        // from the FRESHEST cached copy, so an unconfirmed save can't sit
        // silently un-synced until the next user edit.
        const n = (_pushRetryCount.get(id) || 0) + 1;
        _pushRetryCount.set(id, n);
        if (n > 5) {
            setSyncStatus('error', 'Synchronisation impossible — modifications NON enregistrées sur le serveur');
            return false;
        }
        const delay = Math.min(60000, 5000 * Math.pow(2, n - 1));
        setTimeout(() => {
            if (_remotePushPending.has(id)) return; // a newer push got scheduled meanwhile
            if (id === currentProjectId) {
                // Rebuild from the live editor state (the only browser-side copy)
                // and let saveState schedule the fresh push.
                saveState();
            } else {
                // Not open in the editor — retry the same record snapshot.
                scheduleRemotePush(rec);
            }
        }, delay);
        return false;
    });
}

function scheduleRemotePush(record) {
    if (!RemoteStore.enabled() || !record || !record.id) return;
    const id = record.id;
    const entry = _remotePushPending.get(id) || {};
    entry.record = record;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
        _remotePushPending.delete(id);
        _executeScheduledPush(id, entry.record);
    }, 1500);
    _remotePushPending.set(id, entry);
}

// Fire any debounced push for `id` immediately and resolve once it completed.
// Resolves true when nothing was pending (already in sync) or the push succeeded.
function flushRemotePushNow(id) {
    const entry = _remotePushPending.get(id);
    if (!entry) return Promise.resolve(true);
    if (entry.timer) clearTimeout(entry.timer);
    _remotePushPending.delete(id);
    return _executeScheduledPush(id, entry.record);
}

// Block until the server has confirmed the project's pending save. A 409 round
// (reload + pending-upload re-apply) schedules a follow-up push — loop a few
// rounds so that follow-up is awaited too.
async function waitForServerConfirmation(id, maxRounds = 3) {
    if (!RemoteStore.enabled()) return true; // no server configured — nothing to wait for
    for (let i = 0; i < maxRounds; i++) {
        const ok = await flushRemotePushNow(id);
        if (ok) return true;
        if (!_remotePushPending.has(id)) return false; // failed with no follow-up scheduled
    }
    return false;
}

// A save is only DONE once the server confirmed it. Warn before closing while a
// push is queued/in flight or uploads await confirmation: the server is the only
// store, so anything unconfirmed exists nowhere else than this tab's memory.
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (e) => {
        let pendingUploads = false;
        try { pendingUploads = !!(_pendingUploads && Object.keys(_pendingUploads).length); } catch (err) {}
        if (_remotePushPending.size > 0 || _remotePushInFlight || pendingUploads) {
            e.preventDefault();
            e.returnValue = '';
        }
    });
}

// Load the project list from the server — THE ONLY PROJECT STORE. No browser
// cache exists anymore: what the server lists is what exists, period. The sole
// exception is a project living only in this session's memory (created while
// offline / just now): it stays in the list and is created server-side by its
// next save.
async function syncWithRemote() {
    if (!RemoteStore.enabled()) {
        setSyncStatus('error', 'Aucun serveur configuré — rien ne sera enregistré');
        return;
    }
    setSyncStatus('syncing', 'Synchronisation…');
    const serverList = await RemoteStore.list();
    if (serverList === null) {
        console.warn('MCP project sync: server unreachable.');
        setSyncStatus('error', 'Serveur injoignable — modifications non enregistrées');
        return;
    }

    const next = serverList.map(p => ({ id: p.id, name: p.name, screenshotCount: p.screenshotCount || 0 }));
    const serverIds = new Set(next.map(p => p.id));

    // Keep session-only projects (not yet on the server) IF the editor actually
    // holds content for them — their next save creates them server-side.
    for (const p of projects) {
        if (serverIds.has(p.id)) continue;
        const isOpenWithContent = p.id === currentProjectId && state.screenshots.length > 0;
        const hasQueuedWork = _remotePushPending.has(p.id) || !!_pendingUploads[p.id];
        if (isOpenWithContent || hasQueuedWork) next.push(p);
    }
    projects = next;
    if (!projects.length) projects = [{ id: 'default', name: 'Default Project', screenshotCount: 0 }];
    if (!projects.find(p => p.id === currentProjectId)) currentProjectId = projects[0].id;
    remoteProjectIds = serverIds;
    saveProjectsMeta();

    // Resume any uploads from this session that were never server-confirmed.
    try {
        const all = await getPendingUploads();
        for (const pid of Object.keys(all)) await reapplyPendingUploads(pid);
    } catch (e) { console.warn('Reprise des uploads en attente échouée:', e); }

    setSyncStatus('ok', 'Synchronisé');
    startRemoteEventStream(); // (re)open the live update stream now the server is reachable
}

// Pull a project fresh from the server and, if it's the open one, reload it into
// the editor. Used when the server holds newer data than this tab (a 409 on push,
// or the freshness poll spotting a higher rev) so we converge on the server's
// version instead of overwriting it.
async function reloadProjectFromServer(id) {
    if (!RemoteStore.enabled() || !id) return false;
    const rec = await RemoteStore.get(id); // also updates remoteRev[id]
    if (!rec) return false;
    // Re-apply any not-yet-server-confirmed uploads into the fresh server copy
    // BEFORE it reaches the editor. The server stays the source of truth for
    // everything else; this only completes the save of the user's own files
    // (they must never disappear because Claude/MCP wrote in between).
    try {
        const all = await getPendingUploads();
        const list = all[id];
        if (list && list.length) {
            const res = applyPendingUploadsToRecord(rec, list);
            if (res.keep.length) all[id] = res.keep; else delete all[id];
            persistPendingUploads();
            if (res.changed) {
                const meta = projects.find(p => p.id === id);
                scheduleRemotePush({ ...rec, name: meta ? meta.name : (rec.name || id) });
            }
        }
    } catch (e) { console.warn('Ré-application des uploads en attente échouée:', e); }
    if (id === currentProjectId) {
        _reloadingFromServer = true;
        try {
            currentProjectRev = (typeof rec.rev === 'number') ? rec.rev : 0;
            resetStateToDefaults();
            await loadState(rec); // inject the record we just fetched — no second download
            syncUIWithState();
            updateScreenshotList();
            updateGradientStopsUI();
            updateProjectSelector();
            updateCanvas();
            resetHistory(); // the project content was replaced from the server
            // If hydration is still running, leave the guard up: checkAllLoaded()
            // clears it once images finish, so the freshly-downloaded data isn't
            // echo-pushed straight back to the server.
            if (!projectLoading) {
                if (_saveStateTimer) { clearTimeout(_saveStateTimer); _saveStateTimer = null; }
                _reloadingFromServer = false;
            }
        } catch (e) {
            _reloadingFromServer = false;
            throw e;
        }
    } else {
        const p = projects.find(x => x.id === id);
        if (p) { p.screenshotCount = rec.screenshots?.length || 0; saveProjectsMeta(); updateProjectSelector(); }
    }
    return true;
}

// Detect when the server's copy of the OPEN project is newer than this tab's base
// rev (e.g. Claude/MCP pushed screenshots while we sat idle) and reload it, so a
// later autosave can't silently overwrite that newer data. Runs cheaply on window
// focus / tab visibility and on a slow background poll.
let _freshnessChecking = false;
async function checkRemoteFreshness() {
    if (_freshnessChecking || _reloadingFromServer) return;
    if (!RemoteStore.enabled() || !currentProjectId) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (_remotePushPending.has(currentProjectId)) return; // a local edit is queued; let it push first
    _freshnessChecking = true;
    try {
        const list = await RemoteStore.list();
        if (!list) return;
        const sp = list.find(p => p.id === currentProjectId);
        if (!sp || typeof sp.rev !== 'number') return;
        if (sp.rev > (currentProjectRev || 0)) {
            await reloadProjectFromServer(currentProjectId);
            setSyncStatus('ok', 'Rechargé (modifié par Claude/MCP)');
        }
    } catch (e) {
        /* network blip — try again on the next focus/poll */
    } finally {
        _freshnessChecking = false;
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('focus', () => { checkRemoteFreshness(); });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) checkRemoteFreshness(); });
    setInterval(() => { checkRemoteFreshness(); }, 30000);
}

// Subscribe to the server's live update stream (SSE). Any change — from Claude/MCP
// or another tab — arrives here within milliseconds, so the open project reflects
// it instantly without a manual refresh. EventSource auto-reconnects on drop; the
// focus/visibility/poll checks above remain as a fallback if a proxy buffers SSE.
function startRemoteEventStream() {
    if (typeof EventSource === 'undefined') return;
    const b = RemoteStore.enabled() ? RemoteStore.baseUrl() : null;
    if (_remoteEventSource) { try { _remoteEventSource.close(); } catch (e) {} _remoteEventSource = null; }
    if (!b) return;
    let es;
    // EventSource can't send headers — pass the auth token (if any) as a query param.
    const token = localStorage.getItem('mcpServerToken');
    try { es = new EventSource(b + '/events' + (token ? '?token=' + encodeURIComponent(token) : '')); }
    catch (e) { return; }
    _remoteEventSource = es;

    es.addEventListener('saved', (e) => {
        let d; try { d = JSON.parse(e.data); } catch (err) { return; }
        if (!d || !d.id) return;
        if (typeof d.rev === 'number') remoteRev.set(d.id, d.rev);
        if (d.id !== currentProjectId) return;
        // Ignore our own save (in flight or queued) — the PUT response carries the
        // authoritative rev; a real conflict is still caught by the 409 path.
        if (_remotePushInFlight || _reloadingFromServer || _remotePushPending.has(d.id)) return;
        if (typeof d.rev === 'number' && d.rev > (currentProjectRev || 0)) {
            setSyncStatus('syncing', 'Mise à jour de Claude/MCP…');
            reloadProjectFromServer(currentProjectId).then(() => {
                setSyncStatus('ok', 'Mis à jour (Claude/MCP)');
            });
        }
    });

    es.addEventListener('deleted', (e) => {
        let d; try { d = JSON.parse(e.data); } catch (err) { return; }
        if (!d || !d.id) return;
        remoteProjectIds.delete(d.id);
        remoteRev.delete(d.id);
        // Server truth, live: the project no longer exists — drop it from the list.
        // Skip if WE initiated the deletion (deleteProject already handles the UI).
        if (projects.some(p => p.id === d.id) && !_remotePushInFlight) {
            projects = projects.filter(p => p.id !== d.id);
            if (!projects.length) projects = [{ id: 'default', name: 'Default Project', screenshotCount: 0 }];
            if (d.id === currentProjectId) {
                currentProjectId = projects[0].id;
                saveProjectsMeta();
                switchProject(currentProjectId, { skipSave: true }).catch(() => {});
                setSyncStatus('ok', 'Projet supprimé par Claude/MCP');
            }
        }
        if (typeof updateProjectSelector === 'function') updateProjectSelector();
    });

    // On error EventSource reconnects on its own (honoring the server's retry hint).
}

// Update project selector dropdown
function updateProjectSelector() {
    const menu = document.getElementById('project-menu');
    menu.innerHTML = '';

    // Find current project
    const currentProject = projects.find(p => p.id === currentProjectId) || projects[0];

    // Update trigger display - always use actual state for current project
    document.getElementById('project-trigger-name').textContent = currentProject.name;
    const count = state.screenshots.length;
    document.getElementById('project-trigger-meta').textContent = `${count} screenshot${count !== 1 ? 's' : ''}`;

    // Build menu options
    projects.forEach(project => {
        const option = document.createElement('div');
        option.className = 'project-option' + (project.id === currentProjectId ? ' selected' : '');
        option.dataset.projectId = project.id;

        const screenshotCount = project.id === currentProjectId ? state.screenshots.length : (project.screenshotCount || 0);

        option.innerHTML = `
            <span class="project-option-name">${mcpEscapeHtml(project.name)}</span>
            <span class="project-option-right">
                <span class="project-option-meta">${screenshotCount} screenshot${screenshotCount !== 1 ? 's' : ''}</span>
            </span>
        `;

        option.addEventListener('click', (e) => {
            e.stopPropagation();
            if (project.id !== currentProjectId) {
                switchProject(project.id);
            }
            document.getElementById('project-dropdown').classList.remove('open');
        });

        menu.appendChild(option);
    });
}

// Initialize
async function init() {
    try {
        deleteLegacyDatabase(); // older builds cached projects in IndexedDB — gone
        loadProjectsMeta();     // just the current-project id (localStorage)
        await syncWithRemote(); // fetch the project list from the ONLY store: the server
        updateProjectSelector();
        await loadState();      // fetch the open project from the server
        syncUIWithState();
        updateCanvas();
        resetHistory();
    } catch (e) {
        console.error('Initialization error:', e);
        // Continue with defaults
        syncUIWithState();
        updateCanvas();
        resetHistory();
    }
    // Auto-connect to the MCP server so the connection status persists across
    // reloads. Uses the resolved URL (saved, else auto-detected from the page
    // origin) so a fresh/private window connects too. Silent on failure.
    try {
        const url = RemoteStore.baseUrl();
        if (url && typeof connectMcpServer === 'function') {
            connectMcpServer(url, localStorage.getItem('mcpServerToken') || '', { silent: !RemoteStore.isExplicit() });
        }
    } catch (e) { /* non-fatal */ }
}

// Set up event listeners immediately (don't wait for async init)
function initSync() {
    setupEventListeners();
    setupElementEventListeners();
    setupPopoutEventListeners();
    setupSliderResetButtons();
    initFontPicker();
    updateGradientStopsUI();
    updateCanvas();
    // Then load saved data asynchronously
    init();
}

// Save state — push the current project to the server (the only store)
// Debounced persistence: writing the full project (which can be 100+ MB of
// localized image data) on every render makes editing janky.
// scheduleSaveState() coalesces writes; saveState() still forces an immediate,
// reliable write (used on structural changes and flushed before unload).
let _saveStateTimer = null;
function scheduleSaveState() {
    if (_saveStateTimer) clearTimeout(_saveStateTimer);
    _saveStateTimer = setTimeout(() => { _saveStateTimer = null; saveState(); }, 700);
}
if (typeof window !== 'undefined') {
    const flush = () => { if (_saveStateTimer) { clearTimeout(_saveStateTimer); _saveStateTimer = null; saveState(); } };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
}

// ============================================================================
// Undo / Redo (history)
// ============================================================================
// Snapshot-based history of the editing state. A snapshot deep-clones the
// editable slice of `state` but KEEPS decoded Image objects by reference (so
// undo/redo never re-decodes images). Edits are coalesced: a burst of changes
// (dragging a slider, typing) collapses into a single undo step after a short
// idle, and the step records the state from BEFORE the burst.
let _undoStack = [];
let _redoStack = [];
let _committedSnapshot = null;   // last committed state (what redo returns to)
let _committedFp = null;         // cheap fingerprint of the committed state
let _historyBaseline = null;     // state to undo TO for the in-progress burst
let _historyTimer = null;
let _historySuspended = false;   // true while applying undo/redo (don't record)
const HISTORY_MAX = 80;
const HISTORY_DEBOUNCE_MS = 450;

// Deep clone plain data while preserving Image/Canvas elements by reference.
function cloneKeepingImages(obj) {
    if (obj == null || typeof obj !== 'object') return obj;
    if (typeof HTMLImageElement !== 'undefined' && obj instanceof HTMLImageElement) return obj;
    if (typeof HTMLCanvasElement !== 'undefined' && obj instanceof HTMLCanvasElement) return obj;
    if (Array.isArray(obj)) return obj.map(cloneKeepingImages);
    const out = {};
    for (const k of Object.keys(obj)) out[k] = cloneKeepingImages(obj[k]);
    return out;
}

// Transient lazy-load fields on localized-image entries (decoded bitmap, load
// flags) must never enter history: they change from pure render events, and a
// snapshot carrying `_loading: true` would block reloading forever after undo.
function stripTransientImageFields(screenshots) {
    for (const s of screenshots || []) {
        const li = s && s.localizedImages;
        if (!li) continue;
        for (const lang of Object.keys(li)) {
            const e = li[lang];
            if (!e) continue;
            delete e.image;
            delete e._loading;
            delete e._failedSrc;
        }
    }
}

function captureHistoryState() {
    const snap = cloneKeepingImages({
        selectedIndex: state.selectedIndex,
        currentLanguage: state.currentLanguage,
        outputDevice: state.outputDevice,
        customWidth: state.customWidth,
        customHeight: state.customHeight,
        projectLanguages: state.projectLanguages,
        defaults: state.defaults,
        screenshots: state.screenshots,
    });
    stripTransientImageFields(snap.screenshots);
    return snap;
}

// Cheap content fingerprint: image OBJECTS and transient lazy-load fields are
// dropped, but src strings remain (collapsed to their length when huge), so
// image swaps and every settings/text change are detected. Navigation-only
// state (selected index, current language) is excluded on purpose.
function historyFingerprint() {
    try {
        return JSON.stringify({
            d: state.outputDevice,
            w: state.customWidth, h: state.customHeight, langs: state.projectLanguages,
            df: state.defaults,
            s: state.screenshots,
        }, (k, v) => {
            if (k === '_loading' || k === '_failedSrc') return undefined;
            if (k === 'image' && v === null) return undefined;
            if (typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement) return undefined;
            if (typeof HTMLCanvasElement !== 'undefined' && v instanceof HTMLCanvasElement) return undefined;
            if (typeof v === 'string' && ((v.length > 256 && v.startsWith('data:')) || v.length > 10240)) return 'len:' + v.length;
            return v;
        });
    } catch (e) { return String(Math.random()); }
}

function applyHistoryState(snap) {
    const s = cloneKeepingImages(snap);
    state.selectedIndex = s.selectedIndex;
    state.currentLanguage = s.currentLanguage;
    state.outputDevice = s.outputDevice;
    state.customWidth = s.customWidth;
    state.customHeight = s.customHeight;
    state.projectLanguages = s.projectLanguages;
    state.defaults = s.defaults;
    state.screenshots = s.screenshots;
    // Snapshots strip decoded bitmaps from localized entries — re-trigger lazy
    // resolution (off-screen languages stay deferred), and keep the legacy
    // single `image` field in sync with the current language.
    state.screenshots.forEach(sc => {
        const li = sc.localizedImages;
        const cur = li && li[state.currentLanguage];
        if (cur && cur.src && !cur.image) ensureEntryImage(cur);
        sc.image = (cur && cur.image) ? cur.image : (sc.image || null);
    });

    _historySuspended = true;
    try {
        if (typeof syncUIWithState === 'function') syncUIWithState();
        if (typeof updateScreenshotList === 'function') updateScreenshotList();
        if (typeof updateGradientStopsUI === 'function') updateGradientStopsUI();
        if (typeof renderPerScreenTextUI === 'function') { try { renderPerScreenTextUI(); } catch (e) {} }
        if (typeof updateCanvas === 'function') updateCanvas();
        // updateCanvas only SCHEDULES a debounced save; force it to run now, while
        // still suspended, so the timer can't fire later (unsuspended) and record
        // the undo/redo as a brand-new change.
        saveState();
    } finally {
        _historySuspended = false;
    }
    _committedSnapshot = captureHistoryState();
    _committedFp = historyFingerprint();
    updateUndoRedoUI();
}

// Forget all history and treat the current state as the committed baseline.
// Called after loading/switching/reloading a project.
function resetHistory() {
    _undoStack = [];
    _redoStack = [];
    _historyBaseline = null;
    if (_historyTimer) { clearTimeout(_historyTimer); _historyTimer = null; }
    _committedSnapshot = captureHistoryState();
    _committedFp = historyFingerprint();
    updateUndoRedoUI();
}

// Called (debounced) from saveState on every change. Records one undo step per
// burst, holding the state from before the burst began.
function recordHistoryDebounced() {
    if (_historySuspended) return;
    if (projectLoading) return; // hydration in progress — baseline isn't real yet
    if (_committedSnapshot === null) { _committedSnapshot = captureHistoryState(); _committedFp = historyFingerprint(); }
    if (_historyBaseline === null) _historyBaseline = _committedSnapshot;
    if (_historyTimer) clearTimeout(_historyTimer);
    _historyTimer = setTimeout(commitHistory, HISTORY_DEBOUNCE_MS);
    updateUndoRedoUI();
}

function commitHistory() {
    if (_historyTimer) { clearTimeout(_historyTimer); _historyTimer = null; }
    if (projectLoading) return; // hydration in progress — baseline isn't real yet
    if (_historyBaseline === null) return;
    const baseline = _historyBaseline;
    _historyBaseline = null;
    const nowFp = historyFingerprint();
    if (nowFp === _committedFp) return; // nothing actually changed
    _undoStack.push(baseline);
    if (_undoStack.length > HISTORY_MAX) _undoStack.shift();
    _redoStack = [];
    _committedSnapshot = captureHistoryState();
    _committedFp = nowFp;
    updateUndoRedoUI();
}

function canUndo() { return _undoStack.length > 0 || _historyBaseline !== null; }
function canRedo() { return _redoStack.length > 0; }

function undo() {
    // Flush any in-progress burst so its step is on the stack first.
    if (_historyTimer || _historyBaseline !== null) commitHistory();
    if (_undoStack.length === 0) return;
    const prev = _undoStack.pop();
    _redoStack.push(_committedSnapshot);
    applyHistoryState(prev);
}

function redo() {
    if (_historyTimer || _historyBaseline !== null) commitHistory();
    if (_redoStack.length === 0) return;
    const next = _redoStack.pop();
    _undoStack.push(_committedSnapshot);
    if (_undoStack.length > HISTORY_MAX) _undoStack.shift();
    applyHistoryState(next);
}

function updateUndoRedoUI() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.disabled = !canUndo();
    if (r) r.disabled = !canRedo();
}

// Keyboard: Cmd/Ctrl+Z = undo, Cmd/Ctrl+Shift+Z or Ctrl+Y = redo. Never hijack
// undo while typing in a field (let the browser's native text undo work there)
// — but range/color/checkbox inputs have no text undo, so allow it there. Also
// stay out of the way while a modal is open.
if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
        const key = (e.key || '').toLowerCase();
        if (key !== 'z' && key !== 'y') return;
        if (!(e.metaKey || e.ctrlKey)) return;
        const t = document.activeElement;
        const tag = t && t.tagName;
        if (tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
        if (tag === 'INPUT') {
            const type = (t.type || 'text').toLowerCase();
            if (['text', 'search', 'number', 'url', 'email', 'tel', 'password'].includes(type)) return;
        }
        if (document.querySelector('.modal-overlay.visible')) return;
        if (key === 'y' || (key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
        else if (key === 'z') { e.preventDefault(); undo(); }
    });
}

function saveState() {
    if (_saveStateTimer) { clearTimeout(_saveStateTimer); _saveStateTimer = null; }
    // Don't persist a half-loaded project: loadState() resolves before its async
    // image loads finish populating state.screenshots, so a save here would write
    // an empty project to the server, destroying data.
    if (projectLoading) return;
    // While reloading the server's newer copy into the editor, don't echo it back
    // out as a save (it would be a redundant push of identical data).
    if (_reloadingFromServer) return;

    // Convert screenshots to base64 for storage, including per-screenshot settings and localized images
    const screenshotsToSave = state.screenshots.map(s => {
        // Save localized images (without Image objects, just src/name)
        const localizedImages = {};
        if (s.localizedImages) {
            Object.keys(s.localizedImages).forEach(lang => {
                const langData = s.localizedImages[lang];
                if (langData?.src) {
                    localizedImages[lang] = {
                        src: langData.src,
                        name: langData.name
                    };
                }
            });
        }

        return {
            src: s.image?.src || '', // Legacy compatibility
            name: s.name,
            deviceType: s.deviceType,
            localizedImages: localizedImages,
            background: s.background,
            screenshot: s.screenshot,
            text: s.text,
            elements: (s.elements || []).map(el => ({
                ...el,
                image: undefined // Don't serialize Image objects
            })),
            popouts: s.popouts || [],
            overrides: s.overrides
        };
    });

    const stateToSave = {
        id: currentProjectId,
        formatVersion: 2, // Version 2: new 3D positioning formula
        rev: currentProjectRev, // base rev for optimistic concurrency on the server
        screenshots: screenshotsToSave,
        selectedIndex: state.selectedIndex,
        outputDevice: state.outputDevice,
        customWidth: state.customWidth,
        customHeight: state.customHeight,
        currentLanguage: state.currentLanguage,
        projectLanguages: state.projectLanguages,
        defaults: state.defaults
    };

    // Update screenshot count in project metadata
    const project = projects.find(p => p.id === currentProjectId);
    if (project) {
        project.screenshotCount = state.screenshots.length;
        saveProjectsMeta();
    }

    // Save = push to the server (debounced) — the one and only store.
    // Deep-cloned NOW: the record is serialized 1.5s later, and live references
    // would let edits made in the meantime leak into a payload claiming this rev.
    try {
        scheduleRemotePush(JSON.parse(JSON.stringify({ ...stateToSave, name: project ? project.name : currentProjectId })));
    } catch (e) {
        console.error('Error scheduling remote push:', e);
    }

    // Record an undo step for this change (coalesced; skipped during undo/redo).
    recordHistoryDebounced();
}

// Migrate 3D positions from old formula to new formula
// Old: xOffset = ((x-50)/50)*2, yOffset = -((y-50)/50)*3
// New: xOffset = ((x-50)/50)*(1-scale)*0.9, yOffset = -((y-50)/50)*(1-scale)*2
function migrate3DPosition(screenshotSettings) {
    if (!screenshotSettings?.use3D) return; // Only migrate 3D screenshots

    const scale = (screenshotSettings.scale || 70) / 100;
    const oldX = screenshotSettings.x ?? 50;
    const oldY = screenshotSettings.y ?? 50;

    // Convert old position to new position that produces same visual offset
    // newX = 50 + (oldX - 50) * oldFactor / newFactor
    const xFactor = 2 / ((1 - scale) * 0.9);
    const yFactor = 3 / ((1 - scale) * 2);

    screenshotSettings.x = Math.max(0, Math.min(100, 50 + (oldX - 50) * xFactor));
    screenshotSettings.y = Math.max(0, Math.min(100, 50 + (oldY - 50) * yFactor));
}

// Reconstruct Image objects for graphic/icon elements from saved data
function reconstructElementImages(elements) {
    if (!elements || !Array.isArray(elements)) return [];
    return elements.map(el => {
        const restored = { ...el };
        if (el.type === 'graphic' && el.src) {
            const img = new Image();
            img.src = el.src;
            restored.image = img;
        } else if (el.type === 'icon' && el.iconName) {
            // Async fetch; image will be null initially, then updateCanvas() when ready
            getLucideImage(el.iconName, el.iconColor || '#ffffff', el.iconStrokeWidth || 2)
                .then(img => {
                    restored.image = img;
                    updateCanvas();
                })
                .catch(e => console.error('Failed to reconstruct icon:', e));
        }
        return restored;
    });
}

// Load state — fetch the current project from the server (the only store)
function loadState(injectedRecord) {
    // Claim this load synchronously, so any still-in-flight previous load goes
    // stale the instant we're called (before its async image callbacks fire).
    const myToken = ++loadStateSeq;

    return new Promise((resolve) => {
        (async () => {
                // Any load started after us (newer token) makes us "stale".
                const isStale = () => myToken !== loadStateSeq;
                // SERVER-ONLY: the record comes from the server (or was injected by
                // reloadProjectFromServer to avoid a double download). There is no
                // browser-side store. No server / unknown project → fresh defaults.
                let parsed = injectedRecord || null;
                if (!parsed && RemoteStore.enabled()) {
                    parsed = await RemoteStore.get(currentProjectId);
                }
                if (isStale()) { resolve(); return; } // superseded before the fetch returned
                // Adopt the server revision this project is based on (0 if local-only
                // or pre-rev), so the next push sends the correct base rev.
                currentProjectRev = (parsed && typeof parsed.rev === 'number') ? parsed.rev : 0;
                // Hold saves while we (a) pull disk-only image bytes from the
                // server and (b) decode them, so nothing half-loaded is persisted.
                setProjectLoading(!!(parsed && parsed.screenshots && parsed.screenshots.length));
                if (parsed) {
                    // Disk-only + fast load: resolve only the CURRENT language's
                    // images (+ backgrounds/elements) now; other languages stay as
                    // refs and load lazily on demand. Avoids fetching every language.
                    await resolveProjectRefs(parsed, parsed.currentLanguage || state.currentLanguage || 'en');
                    // A newer load superseded us during the await → abort without
                    // touching state (it now belongs to the newer project).
                    if (isStale()) { resolve(); return; }
                    // Check if this is an old-style project (no per-screenshot settings)
                    const isOldFormat = !parsed.defaults && (parsed.background || parsed.screenshot || parsed.text);
                    const hasScreenshotsWithoutSettings = parsed.screenshots?.some(s => !s.background && !s.screenshot && !s.text);
                    const needsMigration = isOldFormat || hasScreenshotsWithoutSettings;

                    // Check if we need to migrate 3D positions (formatVersion < 2)
                    const needs3DMigration = !parsed.formatVersion || parsed.formatVersion < 2;

                    // Load screenshots with their per-screenshot settings
                    state.screenshots = [];

                    // Build migrated settings from old format if needed
                    let migratedBackground = state.defaults.background;
                    let migratedScreenshot = state.defaults.screenshot;
                    let migratedText = state.defaults.text;

                    if (isOldFormat) {
                        if (parsed.background) {
                            migratedBackground = {
                                type: parsed.background.type || 'gradient',
                                gradient: parsed.background.gradient || state.defaults.background.gradient,
                                solid: parsed.background.solid || state.defaults.background.solid,
                                image: null,
                                imageFit: parsed.background.imageFit || 'cover',
                                imageBlur: parsed.background.imageBlur || 0,
                                overlayColor: parsed.background.overlayColor || '#000000',
                                overlayOpacity: parsed.background.overlayOpacity || 0,
                                noise: parsed.background.noise || false,
                                noiseIntensity: parsed.background.noiseIntensity || 10
                            };
                        }
                        if (parsed.screenshot) {
                            migratedScreenshot = { ...state.defaults.screenshot, ...parsed.screenshot };
                        }
                        if (parsed.text) {
                            migratedText = { ...state.defaults.text, ...parsed.text };
                        }
                    }

                    if (parsed.screenshots && parsed.screenshots.length > 0) {
                        setProjectLoading(true); // block saves until images finish loading
                        let loadedCount = 0;
                        const totalToLoad = parsed.screenshots.length;

                        parsed.screenshots.forEach((s, index) => {
                            // Check if we have new localized format or old single-image format
                            const hasLocalizedImages = s.localizedImages && Object.keys(s.localizedImages).length > 0;

                            if (!hasLocalizedImages && !s.src) {
                                if (isStale()) return; // superseded by a newer load
                                // Blank screen (no image)
                                const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                if (needs3DMigration) {
                                    migrate3DPosition(screenshotSettings);
                                }
                                state.screenshots[index] = {
                                    image: null,
                                    name: s.name || 'Blank Screen',
                                    deviceType: s.deviceType,
                                    localizedImages: {},
                                    background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                    screenshot: screenshotSettings,
                                    text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                    elements: reconstructElementImages(s.elements),
                                    popouts: s.popouts || [],
                                    overrides: s.overrides || {}
                                };
                                loadedCount++;
                                checkAllLoaded();
                            } else if (hasLocalizedImages) {
                                // New format: load all localized images. A broken/slow
                                // image must NOT stall loading — onerror still completes
                                // (keeping src so the image data is never dropped).
                                const langKeys = Object.keys(s.localizedImages);
                                let langLoadedCount = 0;
                                const localizedImages = {};

                                const finishScreenshot = () => {
                                    if (isStale()) return; // superseded by a newer load
                                    const firstLang = Object.keys(localizedImages)[0];
                                    const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                    if (needs3DMigration) {
                                        migrate3DPosition(screenshotSettings);
                                    }
                                    state.screenshots[index] = {
                                        image: firstLang ? localizedImages[firstLang]?.image : null, // Legacy compat
                                        name: s.name,
                                        deviceType: s.deviceType,
                                        localizedImages: localizedImages,
                                        background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                        screenshot: screenshotSettings,
                                        text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                        elements: reconstructElementImages(s.elements),
                                        popouts: s.popouts || [],
                                        overrides: s.overrides || {}
                                    };
                                    loadedCount++;
                                    checkAllLoaded();
                                };
                                const langDone = () => { if (++langLoadedCount === langKeys.length) finishScreenshot(); };

                                langKeys.forEach(lang => {
                                    const langData = s.localizedImages[lang];
                                    const src = langData?.src;
                                    if (src && src.startsWith(REF_SCHEME)) {
                                        // Deferred ref (not the current language): keep the entry but
                                        // DON'T decode now — it loads lazily on demand via
                                        // getScreenshotImage(). This is the key to fast loading.
                                        localizedImages[lang] = { image: null, src, name: langData.name || s.name };
                                        langDone();
                                    } else if (src) {
                                        const langImg = new Image();
                                        langImg.decoding = 'async';
                                        langImg.onload = () => {
                                            localizedImages[lang] = { image: langImg, src, name: langData.name || s.name };
                                            langDone();
                                        };
                                        langImg.onerror = () => {
                                            // Preserve src even if the bitmap fails to decode.
                                            localizedImages[lang] = { image: null, src, name: langData.name || s.name };
                                            langDone();
                                        };
                                        langImg.src = src;
                                    } else {
                                        langDone();
                                    }
                                });
                            } else {
                                // Old format: migrate to localized images
                                const finishOld = (img) => {
                                    if (isStale()) return; // superseded by a newer load
                                    const detectedLang = typeof detectLanguageFromFilename === 'function'
                                        ? detectLanguageFromFilename(s.name || '')
                                        : 'en';
                                    const localizedImages = {};
                                    localizedImages[detectedLang] = { image: img, src: s.src, name: s.name };

                                    const screenshotSettings = s.screenshot || JSON.parse(JSON.stringify(migratedScreenshot));
                                    if (needs3DMigration) {
                                        migrate3DPosition(screenshotSettings);
                                    }
                                    state.screenshots[index] = {
                                        image: img,
                                        name: s.name,
                                        deviceType: s.deviceType,
                                        localizedImages: localizedImages,
                                        background: s.background || JSON.parse(JSON.stringify(migratedBackground)),
                                        screenshot: screenshotSettings,
                                        text: s.text || JSON.parse(JSON.stringify(migratedText)),
                                        elements: reconstructElementImages(s.elements),
                                        popouts: s.popouts || [],
                                        overrides: s.overrides || {}
                                    };
                                    loadedCount++;
                                    checkAllLoaded();
                                };
                                const img = new Image();
                                img.decoding = 'async';
                                img.onload = () => finishOld(img);
                                img.onerror = () => finishOld(null); // preserve src even if decode fails
                                img.src = s.src;
                            }
                        });

                        function checkAllLoaded() {
                            if (isStale()) return; // a newer load owns the state now
                            if (loadedCount === totalToLoad) {
                                setProjectLoading(false); // images loaded — saves allowed again
                                updateScreenshotList();
                                syncUIWithState();
                                updateGradientStopsUI();
                                updateCanvas();
                                if (_reloadingFromServer) {
                                    // Hydration of the server's copy is done — drop the
                                    // pending save it scheduled so the just-downloaded
                                    // data isn't echo-pushed back to the server.
                                    if (_saveStateTimer) { clearTimeout(_saveStateTimer); _saveStateTimer = null; }
                                    _reloadingFromServer = false;
                                }
                                // Re-baseline undo history on the fully-hydrated state:
                                // the resetHistory() callers run right after loadState()
                                // resolves, BEFORE images populate state.screenshots, so
                                // their baseline would capture an empty project.
                                resetHistory();
                                scheduleLanguagePrefetch(); // warm the next language in the background

                                if (needsMigration && parsed.screenshots.length > 0) {
                                    showMigrationPrompt();
                                }
                            }
                        }
                    } else {
                        // No screenshots - still need to update UI
                        updateScreenshotList();
                        syncUIWithState();
                        updateGradientStopsUI();
                        updateCanvas();
                    }

                    state.selectedIndex = parsed.selectedIndex || 0;
                    // Validate the key, don't just check it's non-empty: the
                    // server stores outputDevice as an unconstrained string, so
                    // a size written by a newer client would otherwise reach
                    // getCanvasDimensions() and render at the fallback size
                    // without anyone noticing.
                    const loadedDevice = parsed.outputDevice;
                    state.outputDevice = outputDeviceSize(loadedDevice) ? loadedDevice : 'iphone-6.9';
                    state.customWidth = parsed.customWidth || 1320;
                    state.customHeight = parsed.customHeight || 2868;

                    // Load global language settings
                    state.currentLanguage = parsed.currentLanguage || 'en';
                    state.projectLanguages = parsed.projectLanguages || ['en'];

                    // Load defaults (new format) or use migrated settings
                    if (parsed.defaults) {
                        state.defaults = parsed.defaults;
                        // Ensure elements array exists (may be missing from older saves)
                        if (!state.defaults.elements) state.defaults.elements = [];
                    } else {
                        state.defaults.background = migratedBackground;
                        state.defaults.screenshot = migratedScreenshot;
                        state.defaults.text = migratedText;
                    }
                } else {
                    // New project, reset to defaults
                    resetStateToDefaults();
                    updateScreenshotList();
                }
                resolve();
        })().catch((e) => {
            console.error('Error loading state:', e);
            resolve();
        });
    });
}

// Show migration prompt for old-style projects
function showMigrationPrompt() {
    const modal = document.getElementById('migration-modal');
    if (modal) {
        modal.classList.add('visible');
    }
}

function hideMigrationPrompt() {
    const modal = document.getElementById('migration-modal');
    if (modal) {
        modal.classList.remove('visible');
    }
}

function convertProject() {
    // Project is already converted in memory, just save it
    saveState();
    hideMigrationPrompt();
}

// Reset state to defaults (without clearing storage)
function resetStateToDefaults() {
    state.screenshots = [];
    state.selectedIndex = 0;
    state.outputDevice = 'iphone-6.9';
    state.customWidth = 1320;
    state.customHeight = 2868;
    state.currentLanguage = 'en';
    state.projectLanguages = ['en'];
    state.defaults = {
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
            y: 60,
            x: 50,
            rotation: 0,
            perspective: 0,
            cornerRadius: 24,
            deviceModel2D: 'iphone',
            deviceMacFinish: 'silver',
            deviceWatchFinish: 'midnight',
            bezelEnabled: false,
            spanScreens: 1,
            use3D: false,
            device3D: 'iphone',
            rotation3D: { x: 0, y: 0, z: 0 },
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
                color: '#1d1d1f',
                width: 12,
                opacity: 100,
                notch: 'none' // 'none' | 'island' | 'notch'
            }
        },
        text: {
            headlineEnabled: true,
            headlineBgColor: '#000000',
            headlineBgOpacity: 0, // 0 = no text background
            subheadlineBgColor: '#000000',
            subheadlineBgOpacity: 0,
            subheadlineSpacing: 0, // extra px between title and subtitle
            perScreenText: false,  // panorama: a separate text per screen panel
            panelHeadlines: {},    // { lang: [text per panel] }
            panelSubheadlines: {},
            headlines: { en: '' },
            headlineLanguages: ['en'],
            currentHeadlineLang: 'en',
            headlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            headlineSize: 100,
            headlineWeight: '600',
            headlineItalic: false,
            headlineUnderline: false,
            headlineStrikethrough: false,
            headlineColor: '#ffffff',
            perLanguageLayout: false,
            languageSettings: {
                en: {
                    headlineSize: 100,
                    subheadlineSize: 50,
                    position: 'top',
                    offsetY: 12,
                    lineHeight: 110
                }
            },
            currentLayoutLang: 'en',
            position: 'top',
            offsetY: 12,
            lineHeight: 110,
            subheadlineEnabled: false,
            subheadlines: { en: '' },
            subheadlineLanguages: ['en'],
            currentSubheadlineLang: 'en',
            subheadlineFont: "-apple-system, BlinkMacSystemFont, 'SF Pro Display'",
            subheadlineSize: 50,
            subheadlineWeight: '400',
            subheadlineItalic: false,
            subheadlineUnderline: false,
            subheadlineStrikethrough: false,
            subheadlineColor: '#ffffff',
            subheadlineOpacity: 70
        }
    };
}

// Switch to a different project
async function switchProject(projectId, { skipSave = false } = {}) {
    // Save current project first (skipped when it was just deleted — saving
    // would re-push it to the server)
    if (!skipSave) saveState();

    currentProjectId = projectId;
    saveProjectsMeta();

    // Reset and load new project
    resetStateToDefaults();
    await loadState();

    syncUIWithState();
    updateScreenshotList();
    updateGradientStopsUI();
    updateProjectSelector();
    updateCanvas();
    resetHistory(); // undo history is per-project; start fresh
}

// Create a new project
async function createProject(name) {
    const id = 'project_' + Date.now();
    projects.push({ id, name, screenshotCount: 0 });
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
        await showAppAlert('Cannot delete the only project', 'info');
        return;
    }

    const deletedId = currentProjectId;

    // Remove from projects list
    const index = projects.findIndex(p => p.id === deletedId);
    if (index > -1) {
        projects.splice(index, 1);
    }

    // Drop any pending (debounced) persistence of the deleted project so nothing
    // can re-push it to the server after the delete.
    if (_saveStateTimer) { clearTimeout(_saveStateTimer); _saveStateTimer = null; }
    if (_historyTimer) { clearTimeout(_historyTimer); _historyTimer = null; }
    _historyBaseline = null;
    const pendingPush = _remotePushPending.get(deletedId);
    if (pendingPush) {
        if (pendingPush.timer) clearTimeout(pendingPush.timer);
        _remotePushPending.delete(deletedId);
    }

    // Delete on the server — the only store (no-op if not configured).
    RemoteStore.del(deletedId);
    remoteProjectIds.delete(deletedId);
    // Its pending uploads are moot now.
    getPendingUploads().then(all => {
        if (all[deletedId]) { delete all[deletedId]; persistPendingUploads(); }
    }).catch(() => {});

    // Switch to first available project (without saving the deleted one)
    saveProjectsMeta();
    await switchProject(projects[0].id, { skipSave: true });
    updateProjectSelector();
}

async function duplicateProject(sourceProjectId, customName) {
    // Server-only: read the source from the server, clone it under a new id and
    // create it server-side. The clone's image refs point at the same content-
    // addressed blobs, so no image bytes travel at all.
    if (sourceProjectId === currentProjectId) saveState(); // flush latest edits
    await waitForServerConfirmation(sourceProjectId);
    const projectData = await RemoteStore.get(sourceProjectId);
    if (!projectData) {
        await showAppAlert('Impossible de lire le projet sur le serveur', 'error');
        return;
    }

    const newId = 'project_' + Date.now();
    const sourceProject = projects.find(p => p.id === sourceProjectId);
    const newName = customName || (sourceProject ? sourceProject.name : 'Project') + ' (Copy)';

    const clonedData = JSON.parse(JSON.stringify(projectData));
    clonedData.id = newId;
    delete clonedData.rev; // new project — fresh revision chain

    showUploadProgress('Duplication du projet…', newName);
    try {
        const ok = await RemoteStore.put({ ...clonedData, name: newName });
        if (!ok) {
            await showAppAlert('La duplication a échoué (serveur injoignable ?)', 'error');
            return;
        }
    } finally {
        hideUploadProgress();
    }

    projects.push({ id: newId, name: newName, screenshotCount: clonedData.screenshots?.length || 0 });
    remoteProjectIds.add(newId);
    saveProjectsMeta();
    await switchProject(newId);
    updateProjectSelector();
}

function duplicateScreenshot(index) {
    const original = state.screenshots[index];
    if (!original) return;

    const clone = JSON.parse(JSON.stringify({
        name: original.name,
        deviceType: original.deviceType,
        background: original.background,
        screenshot: original.screenshot,
        text: original.text,
        overrides: original.overrides
    }));

    const nameParts = clone.name.split('.');
    if (nameParts.length > 1) {
        const ext = nameParts.pop();
        clone.name = nameParts.join('.') + ' (Copy).' + ext;
    } else {
        clone.name = clone.name + ' (Copy)';
    }

    clone.localizedImages = {};
    if (original.localizedImages) {
        Object.keys(original.localizedImages).forEach(lang => {
            const langData = original.localizedImages[lang];
            if (langData?.src) {
                const img = new Image();
                img.src = langData.src;
                clone.localizedImages[lang] = {
                    image: img,
                    src: langData.src,
                    name: langData.name
                };
            }
        });
    }

    if (original.image?.src) {
        const img = new Image();
        img.src = original.image.src;
        clone.image = img;
    }

    // Deep copy elements (reconstruct Image objects for graphics and icons)
    clone.elements = (original.elements || []).map(el => {
        const copy = JSON.parse(JSON.stringify({ ...el, image: undefined }));
        if ((el.type === 'graphic' || el.type === 'icon') && el.image) {
            copy.image = el.image;
        }
        copy.id = crypto.randomUUID();
        return copy;
    });

    clone.popouts = (original.popouts || []).map(p => {
        const copy = JSON.parse(JSON.stringify(p));
        copy.id = crypto.randomUUID();
        return copy;
    });

    state.screenshots.splice(index + 1, 0, clone);
    state.selectedIndex = index + 1;

    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    updateCanvas();
}

// Populate frame color swatches for the given device and highlight the active one
function updateFrameColorSwatches(deviceType, activeColorId) {
    const container = document.getElementById('frame-color-swatches');
    if (!container) return;

    const presets = typeof frameColorPresets !== 'undefined' ? frameColorPresets[deviceType] : null;
    if (!presets) {
        container.innerHTML = '';
        return;
    }

    // Default to first preset if none specified
    if (!activeColorId) activeColorId = presets[0].id;

    container.innerHTML = presets.map(p =>
        `<div class="frame-color-swatch${p.id === activeColorId ? ' active' : ''}" ` +
        `data-color-id="${p.id}" title="${p.label}" ` +
        `style="background: ${p.swatch}"></div>`
    ).join('');

    // Attach click handlers
    container.querySelectorAll('.frame-color-swatch').forEach(swatch => {
        swatch.addEventListener('click', () => {
            const colorId = swatch.dataset.colorId;
            container.querySelectorAll('.frame-color-swatch').forEach(s => s.classList.remove('active'));
            swatch.classList.add('active');

            setScreenshotSetting('frameColor', colorId);

            if (typeof setPhoneFrameColor === 'function') {
                setPhoneFrameColor(colorId, deviceType);
            }

            updateCanvas();
        });
    });
}

// Sync UI controls with current state
function syncUIWithState() {
    // Update language button
    updateLanguageButton();

    // Device selector dropdown
    document.querySelectorAll('.output-size-menu .device-option').forEach(opt => {
        opt.classList.toggle('selected', opt.dataset.device === state.outputDevice);
    });

    // Update dropdown trigger text
    const selectedOption = document.querySelector(`.output-size-menu .device-option[data-device="${state.outputDevice}"]`);
    if (selectedOption) {
        document.getElementById('output-size-name').textContent = selectedOption.querySelector('.device-option-name').textContent;
        if (state.outputDevice === 'custom') {
            document.getElementById('output-size-dims').textContent = `${state.customWidth} × ${state.customHeight}`;
        } else {
            document.getElementById('output-size-dims').textContent = selectedOption.querySelector('.device-option-size').textContent;
        }
    }

    // Show/hide custom inputs
    const customInputs = document.getElementById('custom-size-inputs');
    customInputs.classList.toggle('visible', state.outputDevice === 'custom');
    document.getElementById('custom-width').value = state.customWidth;
    document.getElementById('custom-height').value = state.customHeight;

    // Get current screenshot's settings
    const bg = getBackground();
    const ss = getScreenshotSettings();
    const txt = getText();

    // Background type
    document.querySelectorAll('#bg-type-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === bg.type);
    });
    document.getElementById('gradient-options').style.display = bg.type === 'gradient' ? 'block' : 'none';
    document.getElementById('solid-options').style.display = bg.type === 'solid' ? 'block' : 'none';
    document.getElementById('image-options').style.display = bg.type === 'image' ? 'block' : 'none';

    // Gradient
    document.getElementById('gradient-angle').value = bg.gradient.angle;
    document.getElementById('gradient-angle-value').textContent = formatValue(bg.gradient.angle) + '°';
    updateGradientStopsUI();

    // Solid color
    document.getElementById('solid-color').value = bg.solid;
    document.getElementById('solid-color-hex').value = bg.solid;

    // Image background
    document.getElementById('bg-image-fit').value = bg.imageFit;
    document.getElementById('bg-blur').value = bg.imageBlur;
    document.getElementById('bg-blur-value').textContent = formatValue(bg.imageBlur) + 'px';
    document.getElementById('bg-overlay-color').value = bg.overlayColor;
    document.getElementById('bg-overlay-hex').value = bg.overlayColor;
    document.getElementById('bg-overlay-opacity').value = bg.overlayOpacity;
    document.getElementById('bg-overlay-opacity-value').textContent = formatValue(bg.overlayOpacity) + '%';

    // Noise
    document.getElementById('noise-toggle').classList.toggle('active', bg.noise);
    document.getElementById('noise-intensity').value = bg.noiseIntensity;
    document.getElementById('noise-intensity-value').textContent = formatValue(bg.noiseIntensity) + '%';

    // Screenshot settings
    document.getElementById('screenshot-scale').value = ss.scale;
    document.getElementById('screenshot-scale-value').textContent = formatValue(ss.scale) + '%';
    document.getElementById('screenshot-y').value = ss.y;
    document.getElementById('screenshot-y-value').textContent = formatValue(ss.y) + '%';
    document.getElementById('screenshot-x').value = ss.x;
    document.getElementById('screenshot-x-value').textContent = formatValue(ss.x) + '%';
    document.getElementById('corner-radius').value = ss.cornerRadius;
    document.getElementById('corner-radius-value').textContent = formatValue(ss.cornerRadius) + 'px';
    document.getElementById('screenshot-rotation').value = ss.rotation;
    document.getElementById('screenshot-rotation-value').textContent = formatValue(ss.rotation) + '°';

    // Shadow
    document.getElementById('shadow-toggle').classList.toggle('active', ss.shadow.enabled);
    document.getElementById('shadow-color').value = ss.shadow.color;
    document.getElementById('shadow-color-hex').value = ss.shadow.color;
    document.getElementById('shadow-blur').value = ss.shadow.blur;
    document.getElementById('shadow-blur-value').textContent = formatValue(ss.shadow.blur) + 'px';
    document.getElementById('shadow-opacity').value = ss.shadow.opacity;
    document.getElementById('shadow-opacity-value').textContent = formatValue(ss.shadow.opacity) + '%';
    document.getElementById('shadow-x').value = ss.shadow.x;
    document.getElementById('shadow-x-value').textContent = formatValue(ss.shadow.x) + 'px';
    document.getElementById('shadow-y').value = ss.shadow.y;
    document.getElementById('shadow-y-value').textContent = formatValue(ss.shadow.y) + 'px';

    // Frame/Border
    document.getElementById('frame-toggle').classList.toggle('active', ss.frame.enabled);
    document.getElementById('frame-color').value = ss.frame.color;
    document.getElementById('frame-color-hex').value = ss.frame.color;
    document.getElementById('frame-width').value = ss.frame.width;
    document.getElementById('frame-width-value').textContent = formatValue(ss.frame.width) + 'px';
    document.getElementById('frame-opacity').value = ss.frame.opacity;
    document.getElementById('frame-opacity-value').textContent = formatValue(ss.frame.opacity) + '%';

    // Text
    const headlineLang = txt.currentHeadlineLang || 'en';
    const subheadlineLang = txt.currentSubheadlineLang || 'en';
    const layoutLang = getTextLayoutLanguage(txt);
    const headlineLayout = getEffectiveLayout(txt, headlineLang);
    const subheadlineLayout = getEffectiveLayout(txt, subheadlineLang);
    const layoutSettings = getEffectiveLayout(txt, layoutLang);
    const currentHeadline = txt.headlines ? (txt.headlines[headlineLang] || '') : (txt.headline || '');
    document.getElementById('headline-text').value = currentHeadline;
    document.getElementById('headline-font').value = txt.headlineFont;
    updateFontPickerPreview();
    document.getElementById('headline-size').value = headlineLayout.headlineSize;
    document.getElementById('headline-color').value = txt.headlineColor;
    document.getElementById('headline-weight').value = txt.headlineWeight;
    // Sync text style buttons
    document.querySelectorAll('#headline-style button').forEach(btn => {
        const style = btn.dataset.style;
        const key = 'headline' + style.charAt(0).toUpperCase() + style.slice(1);
        btn.classList.toggle('active', txt[key] || false);
    });
    document.querySelectorAll('#text-position button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.position === layoutSettings.position);
    });
    document.getElementById('text-offset-y').value = layoutSettings.offsetY;
    document.getElementById('text-offset-y-value').textContent = formatValue(layoutSettings.offsetY) + '%';
    document.getElementById('line-height').value = layoutSettings.lineHeight;
    document.getElementById('line-height-value').textContent = formatValue(layoutSettings.lineHeight) + '%';
    const currentSubheadline = txt.subheadlines ? (txt.subheadlines[subheadlineLang] || '') : (txt.subheadline || '');
    document.getElementById('subheadline-text').value = currentSubheadline;
    document.getElementById('subheadline-font').value = txt.subheadlineFont || txt.headlineFont;
    document.getElementById('subheadline-size').value = subheadlineLayout.subheadlineSize;
    document.getElementById('subheadline-color').value = txt.subheadlineColor;
    document.getElementById('subheadline-opacity').value = txt.subheadlineOpacity;
    document.getElementById('subheadline-opacity-value').textContent = formatValue(txt.subheadlineOpacity) + '%';
    document.getElementById('subheadline-weight').value = txt.subheadlineWeight || '400';
    // Sync subheadline style buttons
    document.querySelectorAll('#subheadline-style button').forEach(btn => {
        const style = btn.dataset.style;
        const key = 'subheadline' + style.charAt(0).toUpperCase() + style.slice(1);
        btn.classList.toggle('active', txt[key] || false);
    });

    // Per-language layout toggle
    document.getElementById('per-language-layout-toggle').classList.toggle('active', txt.perLanguageLayout || false);

    // Text zone toggle/sliders/overlay
    if (typeof updateTextZoneUI === 'function') updateTextZoneUI();

    // Headline/Subheadline toggles
    const headlineEnabled = txt.headlineEnabled !== false; // default true for backwards compatibility
    const subheadlineEnabled = txt.subheadlineEnabled || false;
    document.getElementById('headline-toggle').classList.toggle('active', headlineEnabled);
    document.getElementById('subheadline-toggle').classList.toggle('active', subheadlineEnabled);

    // Language UIs
    updateHeadlineLanguageUI();
    updateSubheadlineLanguageUI();

    // 3D mode. Output sizes with no GLB model (Apple Watch) are 2D-only: hide
    // the 3D button and clear the flag rather than silently rendering an
    // iPhone in its place.
    // Deliberately does not clear a stored use3D: syncUIWithState is a pure
    // read of state into the UI, and every render path already ANDs with
    // output3DSupported(). Leaving the flag alone also means a project that
    // visits a watch size and comes back keeps its 3D setting.
    const can3D = output3DSupported();
    const btn3D = document.querySelector('#device-type-selector button[data-type="3d"]');
    if (btn3D) btn3D.style.display = can3D ? '' : 'none';
    const use3D = can3D && (ss.use3D || false);
    const device3D = ss.device3D || 'iphone';
    const rotation3D = ss.rotation3D || { x: 0, y: 0, z: 0 };
    document.querySelectorAll('#device-type-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.type === (use3D ? '3d' : '2d'));
    });
    document.querySelectorAll('#device-3d-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.model === device3D);
    });
    updateFrameColorSwatches(device3D, ss.frameColor);
    document.getElementById('rotation-3d-options').style.display = use3D ? 'block' : 'none';
    document.getElementById('rotation-3d-x').value = rotation3D.x;
    document.getElementById('rotation-3d-x-value').textContent = formatValue(rotation3D.x) + '°';
    document.getElementById('rotation-3d-y').value = rotation3D.y;
    document.getElementById('rotation-3d-y-value').textContent = formatValue(rotation3D.y) + '°';
    document.getElementById('rotation-3d-z').value = rotation3D.z;
    document.getElementById('rotation-3d-z-value').textContent = formatValue(rotation3D.z) + '°';

    // Hide 2D-only settings in 3D mode, show 3D tip
    document.getElementById('2d-only-settings').style.display = use3D ? 'none' : 'block';
    document.getElementById('position-presets-section').style.display = use3D ? 'none' : 'block';
    document.getElementById('frame-color-section').style.display = use3D ? 'block' : 'none';
    document.getElementById('3d-tip').style.display = use3D ? 'flex' : 'none';

    // Show/hide 3D renderer and switch model if needed
    if (typeof showThreeJS === 'function') {
        showThreeJS(use3D);
    }
    if (use3D && typeof switchPhoneModel === 'function') {
        switchPhoneModel(device3D);
    }

    // Elements
    selectedElementId = null;
    updateElementsList();
    updateElementProperties();

    // Popouts
    selectedPopoutId = null;
    updatePopoutsList();
    updatePopoutProperties();
}

// ===== Elements Tab UI =====

function updateElementsList() {
    const listEl = document.getElementById('elements-list');
    const emptyEl = document.getElementById('elements-empty');
    if (!listEl) return;

    const elements = getElements();

    // Remove old items (keep the empty message)
    listEl.querySelectorAll('.element-item').forEach(el => el.remove());

    if (elements.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }

    if (emptyEl) emptyEl.style.display = 'none';

    elements.forEach(el => {
        const item = document.createElement('div');
        item.className = 'element-item' + (el.id === selectedElementId ? ' selected' : '');
        item.dataset.elementId = el.id;

        const layerLabels = {
            'behind-screenshot': 'Behind',
            'above-screenshot': 'Middle',
            'above-text': 'Front'
        };

        let thumbContent;
        if (el.type === 'graphic' && el.image) {
            thumbContent = `<img src="${el.image.src}" alt="${el.name}">`;
        } else if (el.type === 'emoji') {
            thumbContent = `<span class="emoji-thumb">${el.emoji}</span>`;
        } else if (el.type === 'icon' && el.image) {
            thumbContent = `<img src="${el.image.src}" alt="${el.name}" style="padding: 4px; filter: var(--icon-thumb-filter, none);">`;
        } else {
            thumbContent = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>
            </svg>`;
        }

        item.innerHTML = `
            <div class="element-item-thumb">${thumbContent}</div>
            <div class="element-item-info">
                <div class="element-item-name">${el.type === 'text' ? (getElementText(el) || 'Text') : el.type === 'emoji' ? `${el.emoji} ${el.name}` : el.name}</div>
                <div class="element-item-layer">${layerLabels[el.layer] || el.layer}</div>
            </div>
            <div class="element-item-actions">
                <button class="element-item-btn" data-action="move-up" title="Move up">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button class="element-item-btn" data-action="move-down" title="Move down">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button class="element-item-btn danger" data-action="delete" title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;

        // Click to select
        item.addEventListener('click', (e) => {
            if (e.target.closest('.element-item-btn')) return;
            selectedElementId = el.id;
            updateElementsList();
            updateElementProperties();
        });

        // Action buttons
        item.querySelectorAll('.element-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'delete') deleteElement(el.id);
                else if (action === 'move-up') moveElementLayer(el.id, 'up');
                else if (action === 'move-down') moveElementLayer(el.id, 'down');
            });
        });

        listEl.appendChild(item);
    });
}

function updateElementProperties() {
    const propsEl = document.getElementById('element-properties');
    if (!propsEl) return;

    const el = getSelectedElement();
    if (!el) {
        propsEl.style.display = 'none';
        return;
    }

    propsEl.style.display = '';
    const titleMap = { text: 'Text Element', emoji: `${el.emoji} Emoji`, icon: `Icon: ${el.name}`, graphic: el.name || 'Graphic' };
    document.getElementById('element-properties-title').textContent = titleMap[el.type] || el.name || 'Element';

    document.getElementById('element-layer').value = el.layer;
    document.getElementById('element-x').value = el.x;
    document.getElementById('element-x-value').textContent = formatValue(el.x) + '%';
    document.getElementById('element-y').value = el.y;
    document.getElementById('element-y-value').textContent = formatValue(el.y) + '%';
    document.getElementById('element-width').value = el.width;
    document.getElementById('element-width-value').textContent = formatValue(el.width) + '%';
    document.getElementById('element-rotation').value = el.rotation;
    document.getElementById('element-rotation-value').textContent = formatValue(el.rotation) + '°';
    document.getElementById('element-opacity').value = el.opacity;
    document.getElementById('element-opacity-value').textContent = formatValue(el.opacity) + '%';

    // Type-specific properties
    const textProps = document.getElementById('element-text-properties');
    const iconProps = document.getElementById('element-icon-properties');

    // Hide all type-specific panels first
    textProps.style.display = 'none';
    if (iconProps) iconProps.style.display = 'none';

    if (el.type === 'text') {
        textProps.style.display = '';
        document.getElementById('element-text-input').value = getElementText(el);
        document.getElementById('element-font').value = el.font;
        updateElementFontPickerPreview(el);
        document.getElementById('element-font-size').value = el.fontSize;
        document.getElementById('element-font-color').value = el.fontColor;
        document.getElementById('element-font-weight').value = el.fontWeight;
        document.getElementById('element-italic-btn').classList.toggle('active', el.italic);
        document.getElementById('element-frame').value = el.frame || 'none';
        const frameOpts = document.getElementById('element-frame-options');
        frameOpts.style.display = el.frame && el.frame !== 'none' ? '' : 'none';
        if (el.frame && el.frame !== 'none') {
            document.getElementById('element-frame-color').value = el.frameColor;
            document.getElementById('element-frame-color-hex').value = el.frameColor;
            document.getElementById('element-frame-scale').value = el.frameScale;
            document.getElementById('element-frame-scale-value').textContent = formatValue(el.frameScale) + '%';
        }
    } else if (el.type === 'icon' && iconProps) {
        iconProps.style.display = '';
        document.getElementById('element-icon-color').value = el.iconColor || '#ffffff';
        document.getElementById('element-icon-color-hex').value = el.iconColor || '#ffffff';
        document.getElementById('element-icon-stroke-width').value = el.iconStrokeWidth || 2;
        document.getElementById('element-icon-stroke-width-value').textContent = el.iconStrokeWidth || 2;
        // Shadow
        const shadow = el.iconShadow || { enabled: false, color: '#000000', blur: 20, opacity: 40, x: 0, y: 10 };
        const shadowToggle = document.getElementById('element-icon-shadow-toggle');
        const shadowOpts = document.getElementById('element-icon-shadow-options');
        const shadowRow = shadowToggle?.closest('.toggle-row');
        if (shadowToggle) shadowToggle.classList.toggle('active', shadow.enabled);
        if (shadowRow) shadowRow.classList.toggle('collapsed', !shadow.enabled);
        if (shadowOpts) shadowOpts.style.display = shadow.enabled ? '' : 'none';
        document.getElementById('element-icon-shadow-color').value = shadow.color;
        document.getElementById('element-icon-shadow-color-hex').value = shadow.color;
        document.getElementById('element-icon-shadow-blur').value = shadow.blur;
        document.getElementById('element-icon-shadow-blur-value').textContent = shadow.blur + 'px';
        document.getElementById('element-icon-shadow-opacity').value = shadow.opacity;
        document.getElementById('element-icon-shadow-opacity-value').textContent = shadow.opacity + '%';
        document.getElementById('element-icon-shadow-x').value = shadow.x;
        document.getElementById('element-icon-shadow-x-value').textContent = shadow.x + 'px';
        document.getElementById('element-icon-shadow-y').value = shadow.y;
        document.getElementById('element-icon-shadow-y-value').textContent = shadow.y + 'px';
    }
}

function setupElementEventListeners() {
    // Add Graphic button
    const addGraphicBtn = document.getElementById('add-graphic-btn');
    const graphicInput = document.getElementById('element-graphic-input');
    if (addGraphicBtn && graphicInput) {
        addGraphicBtn.addEventListener('click', () => graphicInput.click());
        graphicInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                const img = new Image();
                img.onload = () => {
                    addGraphicElement(img, ev.target.result, file.name);
                };
                img.src = ev.target.result;
            };
            reader.readAsDataURL(file);
            graphicInput.value = '';
        });
    }

    // Add Text button
    const addTextBtn = document.getElementById('add-text-element-btn');
    if (addTextBtn) {
        addTextBtn.addEventListener('click', () => addTextElement());
    }

    // Add Emoji button
    const addEmojiBtn = document.getElementById('add-emoji-btn');
    if (addEmojiBtn) {
        addEmojiBtn.addEventListener('click', () => showEmojiPicker());
    }

    // Add Icon button
    const addIconBtn = document.getElementById('add-icon-btn');
    if (addIconBtn) {
        addIconBtn.addEventListener('click', () => showIconPicker());
    }

    // Icon color picker
    const iconColor = document.getElementById('element-icon-color');
    const iconColorHex = document.getElementById('element-icon-color-hex');
    if (iconColor) {
        iconColor.addEventListener('input', () => {
            const el = getSelectedElement();
            if (el && el.type === 'icon') {
                el.iconColor = iconColor.value;
                if (iconColorHex) iconColorHex.value = iconColor.value;
                updateIconImage(el);
            }
        });
    }
    if (iconColorHex) {
        iconColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(iconColorHex.value)) {
                const el = getSelectedElement();
                if (el && el.type === 'icon') {
                    el.iconColor = iconColorHex.value;
                    if (iconColor) iconColor.value = iconColorHex.value;
                    updateIconImage(el);
                }
            }
        });
    }

    // Icon stroke width
    const iconStroke = document.getElementById('element-icon-stroke-width');
    const iconStrokeVal = document.getElementById('element-icon-stroke-width-value');
    if (iconStroke) {
        iconStroke.addEventListener('input', () => {
            const val = parseFloat(iconStroke.value);
            if (iconStrokeVal) iconStrokeVal.textContent = val;
            const el = getSelectedElement();
            if (el && el.type === 'icon') {
                el.iconStrokeWidth = val;
                updateIconImage(el);
            }
        });
    }

    // Icon shadow toggle
    const iconShadowToggle = document.getElementById('element-icon-shadow-toggle');
    if (iconShadowToggle) {
        iconShadowToggle.addEventListener('click', () => {
            const el = getSelectedElement();
            if (!el || el.type !== 'icon') return;
            if (!el.iconShadow) el.iconShadow = { enabled: false, color: '#000000', blur: 20, opacity: 40, x: 0, y: 10 };
            el.iconShadow.enabled = !el.iconShadow.enabled;
            updateElementProperties();
            updateCanvas();
        });
    }

    // Icon shadow property helpers
    const bindIconShadow = (inputId, prop, suffix) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(inputId + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const el = getSelectedElement();
            if (!el || el.type !== 'icon' || !el.iconShadow) return;
            el.iconShadow[prop] = parseFloat(input.value);
            if (valEl) valEl.textContent = input.value + suffix;
            updateCanvas();
        });
    };
    bindIconShadow('element-icon-shadow-blur', 'blur', 'px');
    bindIconShadow('element-icon-shadow-opacity', 'opacity', '%');
    bindIconShadow('element-icon-shadow-x', 'x', 'px');
    bindIconShadow('element-icon-shadow-y', 'y', 'px');

    // Icon shadow color
    const iconShadowColor = document.getElementById('element-icon-shadow-color');
    const iconShadowColorHex = document.getElementById('element-icon-shadow-color-hex');
    if (iconShadowColor) {
        iconShadowColor.addEventListener('input', () => {
            const el = getSelectedElement();
            if (el?.type === 'icon' && el.iconShadow) {
                el.iconShadow.color = iconShadowColor.value;
                if (iconShadowColorHex) iconShadowColorHex.value = iconShadowColor.value;
                updateCanvas();
            }
        });
    }
    if (iconShadowColorHex) {
        iconShadowColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(iconShadowColorHex.value)) {
                const el = getSelectedElement();
                if (el?.type === 'icon' && el.iconShadow) {
                    el.iconShadow.color = iconShadowColorHex.value;
                    if (iconShadowColor) iconShadowColor.value = iconShadowColorHex.value;
                    updateCanvas();
                }
            }
        });
    }

    // Property sliders
    const bindSlider = (id, prop, suffix, parser) => {
        const input = document.getElementById(id);
        const valueEl = document.getElementById(id + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parser ? parser(input.value) : parseFloat(input.value);
            if (valueEl) valueEl.textContent = formatValue(val) + suffix;
            if (selectedElementId) setElementProperty(selectedElementId, prop, val);
        });
    };

    bindSlider('element-x', 'x', '%');
    bindSlider('element-y', 'y', '%');
    bindSlider('element-width', 'width', '%');
    bindSlider('element-rotation', 'rotation', '°');
    bindSlider('element-opacity', 'opacity', '%');
    bindSlider('element-font-size', 'fontSize', '', parseInt);
    bindSlider('element-frame-scale', 'frameScale', '%');

    // Layer dropdown
    const layerSelect = document.getElementById('element-layer');
    if (layerSelect) {
        layerSelect.addEventListener('change', () => {
            if (selectedElementId) {
                setElementProperty(selectedElementId, 'layer', layerSelect.value);
            }
        });
    }

    // Text input
    const textInput = document.getElementById('element-text-input');
    if (textInput) {
        textInput.addEventListener('input', () => {
            if (!selectedElementId) return;
            const el = getSelectedElement();
            if (!el) return;
            if (!el.texts) el.texts = {};
            el.texts[state.currentLanguage] = textInput.value;
            el.text = textInput.value; // sync for backwards compat
            updateCanvas();
            updateElementsList();
        });
    }

    // Font color
    const fontColor = document.getElementById('element-font-color');
    if (fontColor) {
        fontColor.addEventListener('input', () => {
            if (selectedElementId) setElementProperty(selectedElementId, 'fontColor', fontColor.value);
        });
    }

    // Font weight
    const fontWeight = document.getElementById('element-font-weight');
    if (fontWeight) {
        fontWeight.addEventListener('change', () => {
            if (selectedElementId) setElementProperty(selectedElementId, 'fontWeight', fontWeight.value);
        });
    }

    // Italic button
    const italicBtn = document.getElementById('element-italic-btn');
    if (italicBtn) {
        italicBtn.addEventListener('click', () => {
            const el = getSelectedElement();
            if (el) {
                setElementProperty(el.id, 'italic', !el.italic);
                italicBtn.classList.toggle('active', el.italic);
            }
        });
    }

    // Frame dropdown
    const frameSelect = document.getElementById('element-frame');
    if (frameSelect) {
        frameSelect.addEventListener('change', () => {
            if (selectedElementId) {
                setElementProperty(selectedElementId, 'frame', frameSelect.value);
                document.getElementById('element-frame-options').style.display =
                    frameSelect.value !== 'none' ? '' : 'none';
            }
        });
    }

    // Frame color
    const frameColor = document.getElementById('element-frame-color');
    const frameColorHex = document.getElementById('element-frame-color-hex');
    if (frameColor) {
        frameColor.addEventListener('input', () => {
            if (selectedElementId) {
                setElementProperty(selectedElementId, 'frameColor', frameColor.value);
                if (frameColorHex) frameColorHex.value = frameColor.value;
            }
        });
    }
    if (frameColorHex) {
        frameColorHex.addEventListener('change', () => {
            if (selectedElementId && /^#[0-9a-fA-F]{6}$/.test(frameColorHex.value)) {
                setElementProperty(selectedElementId, 'frameColor', frameColorHex.value);
                if (frameColor) frameColor.value = frameColorHex.value;
            }
        });
    }

    // Canvas drag interaction for elements
    setupElementCanvasDrag();
}

function setupElementCanvasDrag() {
    const canvasWrapper = document.getElementById('canvas-wrapper');
    const previewCanvas = document.getElementById('preview-canvas');
    if (!previewCanvas) return;

    // Snap guides state
    const SNAP_THRESHOLD = 1.5; // percentage units (of canvas width/height)
    let activeSnapGuides = { x: null, y: null }; // which guides are active

    function getCanvasCoords(e) {
        const rect = previewCanvas.getBoundingClientRect();
        const scaleX = previewCanvas.width / rect.width;
        const scaleY = previewCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function snapToGuides(x, y) {
        const snapped = { x, y };
        activeSnapGuides = { x: null, y: null };

        // Snap to horizontal center (x = 50%)
        if (Math.abs(x - 50) < SNAP_THRESHOLD) {
            snapped.x = 50;
            activeSnapGuides.x = 50;
        }

        // Snap to vertical middle (y = 50%)
        if (Math.abs(y - 50) < SNAP_THRESHOLD) {
            snapped.y = 50;
            activeSnapGuides.y = 50;
        }

        return snapped;
    }

    function hitTestPopouts(canvasX, canvasY) {
        const popouts = getPopouts();
        const dims = getCanvasDimensions();
        const screenshot = getCurrentScreenshot();
        if (!screenshot) return null;
        const img = getScreenshotImage(screenshot);
        if (!img) return null;

        // Test in reverse order (topmost first)
        for (let i = popouts.length - 1; i >= 0; i--) {
            const p = popouts[i];
            const cx = dims.width * (p.x / 100);
            const cy = dims.height * (p.y / 100);
            const displayW = dims.width * (p.width / 100);
            const sw = (p.cropWidth / 100) * img.width;
            const sh = (p.cropHeight / 100) * img.height;
            const cropAspect = sh / sw;
            const displayH = displayW * cropAspect;
            const halfW = displayW / 2;
            const halfH = displayH / 2;

            if (canvasX >= cx - halfW && canvasX <= cx + halfW &&
                canvasY >= cy - halfH && canvasY <= cy + halfH) {
                return p;
            }
        }
        return null;
    }

    function hitTestElements(canvasX, canvasY) {
        const elements = getElements();
        const dims = getCanvasDimensions();
        // Test in reverse order (topmost first)
        const layers = ['above-text', 'above-screenshot', 'behind-screenshot'];
        for (const layer of layers) {
            const layerEls = elements.filter(el => el.layer === layer).reverse();
            for (const el of layerEls) {
                const cx = dims.width * (el.x / 100);
                const cy = dims.height * (el.y / 100);
                const elWidth = dims.width * (el.width / 100);
                let elHeight;

                if (el.type === 'emoji' || el.type === 'icon') {
                    elHeight = elWidth; // square bounding box
                } else if (el.type === 'graphic' && el.image) {
                    elHeight = elWidth * (el.image.height / el.image.width);
                } else {
                    elHeight = el.fontSize * 1.5;
                }

                // Simple bounding box hit test (ignoring rotation for simplicity)
                const halfW = elWidth / 2;
                const halfH = elHeight / 2;

                if (canvasX >= cx - halfW && canvasX <= cx + halfW &&
                    canvasY >= cy - halfH && canvasY <= cy + halfH) {
                    return el;
                }
            }
        }
        return null;
    }

    function applyDragMove(coords) {
        const dx = coords.x - draggingElement.startX;
        const dy = coords.y - draggingElement.startY;
        const rawX = draggingElement.origX + (dx / draggingElement.dims.width) * 100;
        const rawY = draggingElement.origY + (dy / draggingElement.dims.height) * 100;

        const clamped = {
            x: Math.max(0, Math.min(100, rawX)),
            y: Math.max(0, Math.min(100, rawY))
        };
        const snapped = snapToGuides(clamped.x, clamped.y);

        if (draggingElement.isPopout) {
            const p = getPopouts().find(po => po.id === draggingElement.id);
            if (p) {
                p.x = snapped.x;
                p.y = snapped.y;
                updateCanvas();
                drawSnapGuides();
                updatePopoutProperties();
            }
        } else {
            const el = getElements().find(e => e.id === draggingElement.id);
            if (el) {
                el.x = snapped.x;
                el.y = snapped.y;
                updateCanvas();
                drawSnapGuides();
                updateElementProperties();
            }
        }
    }

    function clearDrag() {
        if (draggingElement) {
            draggingElement = null;
            activeSnapGuides = { x: null, y: null };
            canvasWrapper.classList.remove('element-dragging');
            updateCanvas(); // redraw without guides
        }
    }

    previewCanvas.addEventListener('mousedown', (e) => {
        const coords = getCanvasCoords(e);

        // Check popouts first (they render on top of elements above-screenshot)
        const popoutHit = hitTestPopouts(coords.x, coords.y);
        if (popoutHit) {
            e.preventDefault();
            e.stopPropagation();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: popoutHit.id,
                startX: coords.x,
                startY: coords.y,
                origX: popoutHit.x,
                origY: popoutHit.y,
                dims: dims,
                isPopout: true
            };
            selectedPopoutId = popoutHit.id;
            selectedElementId = null;
            updatePopoutsList();
            updatePopoutProperties();
            updateElementsList();
            updateElementProperties();
            canvasWrapper.classList.add('element-dragging');

            const popoutsTab = document.querySelector('.tab[data-tab="popouts"]');
            if (popoutsTab && !popoutsTab.classList.contains('active')) {
                popoutsTab.click();
            }
            return;
        }

        const hit = hitTestElements(coords.x, coords.y);
        if (hit) {
            e.preventDefault();
            e.stopPropagation();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: hit.id,
                startX: coords.x,
                startY: coords.y,
                origX: hit.x,
                origY: hit.y,
                dims: dims,
                isPopout: false
            };
            selectedElementId = hit.id;
            selectedPopoutId = null;
            updateElementsList();
            updateElementProperties();
            updatePopoutsList();
            updatePopoutProperties();
            canvasWrapper.classList.add('element-dragging');

            const elementsTab = document.querySelector('.tab[data-tab="elements"]');
            if (elementsTab && !elementsTab.classList.contains('active')) {
                elementsTab.click();
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!draggingElement) {
            // Hover detection
            const coords = getCanvasCoords(e);
            const popoutHit = hitTestPopouts(coords.x, coords.y);
            const hit = popoutHit || hitTestElements(coords.x, coords.y);
            canvasWrapper.classList.toggle('element-hover', !!hit);
            return;
        }
        e.preventDefault();
        applyDragMove(getCanvasCoords(e));
    });

    window.addEventListener('mouseup', () => clearDrag());

    // Touch support
    previewCanvas.addEventListener('touchstart', (e) => {
        const coords = getCanvasCoords(e);

        const popoutHit = hitTestPopouts(coords.x, coords.y);
        if (popoutHit) {
            e.preventDefault();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: popoutHit.id,
                startX: coords.x,
                startY: coords.y,
                origX: popoutHit.x,
                origY: popoutHit.y,
                dims: dims,
                isPopout: true
            };
            selectedPopoutId = popoutHit.id;
            selectedElementId = null;
            updatePopoutsList();
            updatePopoutProperties();
            return;
        }

        const hit = hitTestElements(coords.x, coords.y);
        if (hit) {
            e.preventDefault();
            const dims = getCanvasDimensions();
            draggingElement = {
                id: hit.id,
                startX: coords.x,
                startY: coords.y,
                origX: hit.x,
                origY: hit.y,
                dims: dims,
                isPopout: false
            };
            selectedElementId = hit.id;
            updateElementsList();
            updateElementProperties();
        }
    }, { passive: false });

    previewCanvas.addEventListener('touchmove', (e) => {
        if (!draggingElement) return;
        e.preventDefault();
        applyDragMove(getCanvasCoords(e));
    }, { passive: false });

    previewCanvas.addEventListener('touchend', () => clearDrag());
}

// Draw snap guide lines over the canvas when dragging near center/middle
function drawSnapGuides() {
    if (!draggingElement) return;

    const el = getSelectedElement();
    if (!el) return;

    const dims = getCanvasDimensions();
    // Scale relative to canvas so guides stay visible in the scaled-down preview
    const scale = dims.width / 400;

    ctx.save();
    ctx.strokeStyle = 'rgba(120, 170, 255, 0.45)';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    ctx.setLineDash([12 * scale, 8 * scale]);

    // Vertical center line (x = 50%)
    if (Math.abs(el.x - 50) < 0.01) {
        const lineX = Math.round(dims.width * 0.5);
        ctx.beginPath();
        ctx.moveTo(lineX, 0);
        ctx.lineTo(lineX, dims.height);
        ctx.stroke();
    }

    // Horizontal middle line (y = 50%)
    if (Math.abs(el.y - 50) < 0.01) {
        const lineY = Math.round(dims.height * 0.5);
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.lineTo(dims.width, lineY);
        ctx.stroke();
    }

    ctx.restore();
}

// ===== Popouts Tab UI =====

function updatePopoutsList() {
    const listEl = document.getElementById('popouts-list');
    const emptyEl = document.getElementById('popouts-empty');
    const addBtn = document.getElementById('add-popout-btn');
    if (!listEl) return;

    const popouts = getPopouts();
    const screenshot = getCurrentScreenshot();
    const hasImage = screenshot && getScreenshotImage(screenshot);

    // Disable add button when no screenshot image
    if (addBtn) {
        addBtn.disabled = !hasImage;
        addBtn.style.opacity = hasImage ? '' : '0.4';
    }

    // Remove old items
    listEl.querySelectorAll('.popout-item').forEach(el => el.remove());

    if (popouts.length === 0) {
        if (emptyEl) emptyEl.style.display = '';
        return;
    }
    if (emptyEl) emptyEl.style.display = 'none';

    popouts.forEach((p, idx) => {
        const item = document.createElement('div');
        item.className = 'popout-item' + (p.id === selectedPopoutId ? ' selected' : '');
        item.dataset.popoutId = p.id;

        // Generate crop preview thumbnail
        const thumbCanvas = document.createElement('canvas');
        thumbCanvas.width = 28;
        thumbCanvas.height = 28;
        const thumbCtx = thumbCanvas.getContext('2d');
        const img = hasImage ? getScreenshotImage(screenshot) : null;
        if (img) {
            const sx = (p.cropX / 100) * img.width;
            const sy = (p.cropY / 100) * img.height;
            const sw = (p.cropWidth / 100) * img.width;
            const sh = (p.cropHeight / 100) * img.height;
            thumbCtx.drawImage(img, sx, sy, sw, sh, 0, 0, 28, 28);
        }

        item.innerHTML = `
            <div class="popout-item-thumb"></div>
            <div class="popout-item-info">
                <div class="popout-item-name">Popout ${idx + 1}</div>
                <div class="popout-item-crop">${Math.round(p.cropWidth)}% × ${Math.round(p.cropHeight)}%</div>
            </div>
            <div class="popout-item-actions">
                <button class="element-item-btn" data-action="move-up" title="Move up">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="18 15 12 9 6 15"/>
                    </svg>
                </button>
                <button class="element-item-btn" data-action="move-down" title="Move down">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <polyline points="6 9 12 15 18 9"/>
                    </svg>
                </button>
                <button class="element-item-btn danger" data-action="delete" title="Delete">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                </button>
            </div>
        `;

        // Insert thumbnail canvas
        const thumbHolder = item.querySelector('.popout-item-thumb');
        if (thumbHolder) thumbHolder.appendChild(thumbCanvas);

        item.addEventListener('click', (e) => {
            if (e.target.closest('.element-item-btn')) return;
            selectedPopoutId = p.id;
            updatePopoutsList();
            updatePopoutProperties();
        });

        item.querySelectorAll('.element-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                if (action === 'delete') deletePopout(p.id);
                else if (action === 'move-up') movePopout(p.id, 'up');
                else if (action === 'move-down') movePopout(p.id, 'down');
            });
        });

        listEl.appendChild(item);
    });
}

function updatePopoutProperties() {
    const propsEl = document.getElementById('popout-properties');
    if (!propsEl) return;

    const p = getSelectedPopout();
    if (!p) {
        propsEl.style.display = 'none';
        return;
    }
    propsEl.style.display = '';

    // Crop region
    document.getElementById('popout-crop-x').value = p.cropX;
    document.getElementById('popout-crop-x-value').textContent = formatValue(p.cropX) + '%';
    document.getElementById('popout-crop-y').value = p.cropY;
    document.getElementById('popout-crop-y-value').textContent = formatValue(p.cropY) + '%';
    document.getElementById('popout-crop-width').value = p.cropWidth;
    document.getElementById('popout-crop-width-value').textContent = formatValue(p.cropWidth) + '%';
    document.getElementById('popout-crop-height').value = p.cropHeight;
    document.getElementById('popout-crop-height-value').textContent = formatValue(p.cropHeight) + '%';

    // Display
    document.getElementById('popout-x').value = p.x;
    document.getElementById('popout-x-value').textContent = formatValue(p.x) + '%';
    document.getElementById('popout-y').value = p.y;
    document.getElementById('popout-y-value').textContent = formatValue(p.y) + '%';
    document.getElementById('popout-width').value = p.width;
    document.getElementById('popout-width-value').textContent = formatValue(p.width) + '%';
    document.getElementById('popout-rotation').value = p.rotation;
    document.getElementById('popout-rotation-value').textContent = formatValue(p.rotation) + '°';
    document.getElementById('popout-opacity').value = p.opacity;
    document.getElementById('popout-opacity-value').textContent = formatValue(p.opacity) + '%';
    document.getElementById('popout-corner-radius').value = p.cornerRadius;
    document.getElementById('popout-corner-radius-value').textContent = formatValue(p.cornerRadius) + 'px';

    // Shadow
    const shadow = p.shadow || { enabled: false, color: '#000000', blur: 30, opacity: 40, x: 0, y: 15 };
    document.getElementById('popout-shadow-toggle').classList.toggle('active', shadow.enabled);
    const shadowRow = document.getElementById('popout-shadow-toggle')?.closest('.toggle-row');
    if (shadowRow) shadowRow.classList.toggle('collapsed', !shadow.enabled);
    document.getElementById('popout-shadow-options').style.display = shadow.enabled ? '' : 'none';
    document.getElementById('popout-shadow-color').value = shadow.color;
    document.getElementById('popout-shadow-color-hex').value = shadow.color;
    document.getElementById('popout-shadow-blur').value = shadow.blur;
    document.getElementById('popout-shadow-blur-value').textContent = formatValue(shadow.blur) + 'px';
    document.getElementById('popout-shadow-opacity').value = shadow.opacity;
    document.getElementById('popout-shadow-opacity-value').textContent = formatValue(shadow.opacity) + '%';
    document.getElementById('popout-shadow-x').value = shadow.x;
    document.getElementById('popout-shadow-x-value').textContent = formatValue(shadow.x) + 'px';
    document.getElementById('popout-shadow-y').value = shadow.y;
    document.getElementById('popout-shadow-y-value').textContent = formatValue(shadow.y) + 'px';

    // Border
    const border = p.border || { enabled: false, color: '#ffffff', width: 3, opacity: 100 };
    document.getElementById('popout-border-toggle').classList.toggle('active', border.enabled);
    const borderRow = document.getElementById('popout-border-toggle')?.closest('.toggle-row');
    if (borderRow) borderRow.classList.toggle('collapsed', !border.enabled);
    document.getElementById('popout-border-options').style.display = border.enabled ? '' : 'none';
    document.getElementById('popout-border-color').value = border.color;
    document.getElementById('popout-border-color-hex').value = border.color;
    document.getElementById('popout-border-width').value = border.width;
    document.getElementById('popout-border-width-value').textContent = formatValue(border.width) + 'px';
    document.getElementById('popout-border-opacity').value = border.opacity;
    document.getElementById('popout-border-opacity-value').textContent = formatValue(border.opacity) + '%';

    // Update crop preview
    updateCropPreview();
}

// Compute image-fit layout within the crop preview canvas (letterboxed)
function getCropPreviewLayout(previewCanvas, img) {
    const w = previewCanvas.width;
    const h = previewCanvas.height;
    const imgAspect = img.width / img.height;
    const canvasAspect = w / h;
    let drawW, drawH, drawX, drawY;
    if (imgAspect > canvasAspect) {
        drawW = w;
        drawH = w / imgAspect;
        drawX = 0;
        drawY = (h - drawH) / 2;
    } else {
        drawH = h;
        drawW = h * imgAspect;
        drawX = (w - drawW) / 2;
        drawY = 0;
    }
    return { drawX, drawY, drawW, drawH };
}

function updateCropPreview() {
    const previewCanvas = document.getElementById('popout-crop-preview');
    if (!previewCanvas) return;
    const p = getSelectedPopout();
    const screenshot = getCurrentScreenshot();
    if (!p || !screenshot) return;
    const img = getScreenshotImage(screenshot);
    if (!img) return;

    // Resize canvas to match sidebar width while keeping image aspect
    const containerWidth = previewCanvas.parentElement?.clientWidth || 280;
    const imgAspect = img.width / img.height;
    const canvasW = containerWidth * 2; // 2x for retina
    const canvasH = Math.round(canvasW / imgAspect);
    previewCanvas.width = canvasW;
    previewCanvas.height = canvasH;
    previewCanvas.style.width = containerWidth + 'px';
    previewCanvas.style.height = Math.round(containerWidth / imgAspect) + 'px';

    const ctx2 = previewCanvas.getContext('2d');
    const layout = getCropPreviewLayout(previewCanvas, img);
    const { drawX, drawY, drawW, drawH } = layout;

    ctx2.clearRect(0, 0, canvasW, canvasH);

    // Draw full image
    ctx2.drawImage(img, drawX, drawY, drawW, drawH);

    // Dim overlay outside crop region
    const rx = drawX + (p.cropX / 100) * drawW;
    const ry = drawY + (p.cropY / 100) * drawH;
    const rw = (p.cropWidth / 100) * drawW;
    const rh = (p.cropHeight / 100) * drawH;

    ctx2.fillStyle = 'rgba(0, 0, 0, 0.55)';
    ctx2.fillRect(0, 0, canvasW, canvasH);

    // Clear crop region to show undimmed image
    ctx2.save();
    ctx2.beginPath();
    ctx2.rect(rx, ry, rw, rh);
    ctx2.clip();
    ctx2.clearRect(rx, ry, rw, rh);
    ctx2.drawImage(img, drawX, drawY, drawW, drawH);
    ctx2.restore();

    // Crop border
    ctx2.strokeStyle = 'rgba(10, 132, 255, 0.9)';
    ctx2.lineWidth = 2;
    ctx2.strokeRect(rx, ry, rw, rh);

    // Corner handles (vector editor style)
    const handleSize = 8;
    const handles = [
        { x: rx, y: ry },                     // top-left
        { x: rx + rw, y: ry },                // top-right
        { x: rx, y: ry + rh },                // bottom-left
        { x: rx + rw, y: ry + rh },           // bottom-right
    ];
    // Edge midpoint handles
    const midHandles = [
        { x: rx + rw / 2, y: ry },            // top-center
        { x: rx + rw / 2, y: ry + rh },       // bottom-center
        { x: rx, y: ry + rh / 2 },            // left-center
        { x: rx + rw, y: ry + rh / 2 },       // right-center
    ];

    ctx2.fillStyle = '#ffffff';
    ctx2.strokeStyle = 'rgba(10, 132, 255, 1)';
    ctx2.lineWidth = 1.5;
    [...handles, ...midHandles].forEach(h => {
        ctx2.fillRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
        ctx2.strokeRect(h.x - handleSize / 2, h.y - handleSize / 2, handleSize, handleSize);
    });
}

// ===== Interactive crop preview drag =====
let cropDragState = null;

function setupCropPreviewDrag() {
    const previewCanvas = document.getElementById('popout-crop-preview');
    if (!previewCanvas) return;

    function getCropCanvasCoords(e) {
        const rect = previewCanvas.getBoundingClientRect();
        const scaleX = previewCanvas.width / rect.width;
        const scaleY = previewCanvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return {
            x: (clientX - rect.left) * scaleX,
            y: (clientY - rect.top) * scaleY
        };
    }

    function hitTestCropHandle(coords) {
        const p = getSelectedPopout();
        const screenshot = getCurrentScreenshot();
        if (!p || !screenshot) return null;
        const img = getScreenshotImage(screenshot);
        if (!img) return null;

        const layout = getCropPreviewLayout(previewCanvas, img);
        const { drawX, drawY, drawW, drawH } = layout;
        const rx = drawX + (p.cropX / 100) * drawW;
        const ry = drawY + (p.cropY / 100) * drawH;
        const rw = (p.cropWidth / 100) * drawW;
        const rh = (p.cropHeight / 100) * drawH;

        const hitR = 12; // hit radius
        const tests = [
            { x: rx, y: ry, handle: 'top-left' },
            { x: rx + rw, y: ry, handle: 'top-right' },
            { x: rx, y: ry + rh, handle: 'bottom-left' },
            { x: rx + rw, y: ry + rh, handle: 'bottom-right' },
            { x: rx + rw / 2, y: ry, handle: 'top' },
            { x: rx + rw / 2, y: ry + rh, handle: 'bottom' },
            { x: rx, y: ry + rh / 2, handle: 'left' },
            { x: rx + rw, y: ry + rh / 2, handle: 'right' },
        ];
        for (const t of tests) {
            if (Math.abs(coords.x - t.x) < hitR && Math.abs(coords.y - t.y) < hitR) {
                return t.handle;
            }
        }
        // Check if inside the crop region (move)
        if (coords.x >= rx && coords.x <= rx + rw && coords.y >= ry && coords.y <= ry + rh) {
            return 'move';
        }
        return null;
    }

    function startCropDrag(e) {
        const coords = getCropCanvasCoords(e);
        const handle = hitTestCropHandle(coords);
        if (!handle) return;

        e.preventDefault();
        const p = getSelectedPopout();
        if (!p) return;
        cropDragState = {
            handle,
            startX: coords.x,
            startY: coords.y,
            origCropX: p.cropX,
            origCropY: p.cropY,
            origCropW: p.cropWidth,
            origCropH: p.cropHeight
        };
    }

    function moveCropDrag(e) {
        if (!cropDragState) {
            // Update cursor based on hover
            const coords = getCropCanvasCoords(e);
            const handle = hitTestCropHandle(coords);
            const cursorMap = {
                'top-left': 'nwse-resize', 'bottom-right': 'nwse-resize',
                'top-right': 'nesw-resize', 'bottom-left': 'nesw-resize',
                'top': 'ns-resize', 'bottom': 'ns-resize',
                'left': 'ew-resize', 'right': 'ew-resize',
                'move': 'move'
            };
            previewCanvas.style.cursor = cursorMap[handle] || 'default';
            return;
        }
        e.preventDefault();
        const coords = getCropCanvasCoords(e);
        const p = getSelectedPopout();
        const screenshot = getCurrentScreenshot();
        if (!p || !screenshot) return;
        const img = getScreenshotImage(screenshot);
        if (!img) return;

        const layout = getCropPreviewLayout(previewCanvas, img);
        const { drawW, drawH } = layout;

        // Convert pixel delta to percentage
        const dxPct = ((coords.x - cropDragState.startX) / drawW) * 100;
        const dyPct = ((coords.y - cropDragState.startY) / drawH) * 100;
        const h = cropDragState.handle;
        const orig = cropDragState;

        let newX = orig.origCropX, newY = orig.origCropY;
        let newW = orig.origCropW, newH = orig.origCropH;

        if (h === 'move') {
            newX = Math.max(0, Math.min(100 - newW, orig.origCropX + dxPct));
            newY = Math.max(0, Math.min(100 - newH, orig.origCropY + dyPct));
        } else {
            if (h.includes('left')) { newX = orig.origCropX + dxPct; newW = orig.origCropW - dxPct; }
            if (h.includes('right') || h === 'right') { newW = orig.origCropW + dxPct; }
            if (h.includes('top')) { newY = orig.origCropY + dyPct; newH = orig.origCropH - dyPct; }
            if (h.includes('bottom') || h === 'bottom') { newH = orig.origCropH + dyPct; }

            // Enforce minimums
            if (newW < 5) { if (h.includes('left')) newX = orig.origCropX + orig.origCropW - 5; newW = 5; }
            if (newH < 5) { if (h.includes('top')) newY = orig.origCropY + orig.origCropH - 5; newH = 5; }

            // Clamp to canvas bounds
            newX = Math.max(0, newX);
            newY = Math.max(0, newY);
            if (newX + newW > 100) newW = 100 - newX;
            if (newY + newH > 100) newH = 100 - newY;
        }

        p.cropX = newX;
        p.cropY = newY;
        p.cropWidth = newW;
        p.cropHeight = newH;
        updateCropPreview();
        updatePopoutProperties();
        updateCanvas();
    }

    function endCropDrag() {
        cropDragState = null;
    }

    previewCanvas.addEventListener('mousedown', startCropDrag);
    window.addEventListener('mousemove', moveCropDrag);
    window.addEventListener('mouseup', endCropDrag);
    previewCanvas.addEventListener('touchstart', startCropDrag, { passive: false });
    previewCanvas.addEventListener('touchmove', (e) => { if (cropDragState) moveCropDrag(e); }, { passive: false });
    previewCanvas.addEventListener('touchend', endCropDrag);
}

function setupPopoutEventListeners() {
    // Add Popout button
    const addBtn = document.getElementById('add-popout-btn');
    if (addBtn) {
        addBtn.addEventListener('click', () => addPopout());
    }

    // Crop sliders
    const bindPopoutSlider = (id, key, suffix) => {
        const input = document.getElementById(id);
        const valueEl = document.getElementById(id + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const val = parseFloat(input.value);
            if (valueEl) valueEl.textContent = formatValue(val) + suffix;
            if (selectedPopoutId) setPopoutProperty(selectedPopoutId, key, val);
            if (key.startsWith('crop')) updateCropPreview();
        });
    };

    bindPopoutSlider('popout-crop-x', 'cropX', '%');
    bindPopoutSlider('popout-crop-y', 'cropY', '%');
    bindPopoutSlider('popout-crop-width', 'cropWidth', '%');
    bindPopoutSlider('popout-crop-height', 'cropHeight', '%');
    bindPopoutSlider('popout-x', 'x', '%');
    bindPopoutSlider('popout-y', 'y', '%');
    bindPopoutSlider('popout-width', 'width', '%');
    bindPopoutSlider('popout-rotation', 'rotation', '°');
    bindPopoutSlider('popout-opacity', 'opacity', '%');
    bindPopoutSlider('popout-corner-radius', 'cornerRadius', 'px');

    // Shadow toggle
    const shadowToggle = document.getElementById('popout-shadow-toggle');
    if (shadowToggle) {
        shadowToggle.addEventListener('click', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.shadow.enabled = !p.shadow.enabled;
            updatePopoutProperties();
            updateCanvas();
        });
    }

    // Shadow properties
    const bindPopoutShadow = (inputId, prop, suffix) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(inputId + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.shadow[prop] = parseFloat(input.value);
            if (valEl) valEl.textContent = formatValue(parseFloat(input.value)) + suffix;
            updateCanvas();
        });
    };
    bindPopoutShadow('popout-shadow-blur', 'blur', 'px');
    bindPopoutShadow('popout-shadow-opacity', 'opacity', '%');
    bindPopoutShadow('popout-shadow-x', 'x', 'px');
    bindPopoutShadow('popout-shadow-y', 'y', 'px');

    // Shadow color
    const shadowColor = document.getElementById('popout-shadow-color');
    const shadowColorHex = document.getElementById('popout-shadow-color-hex');
    if (shadowColor) {
        shadowColor.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (p) { p.shadow.color = shadowColor.value; if (shadowColorHex) shadowColorHex.value = shadowColor.value; updateCanvas(); }
        });
    }
    if (shadowColorHex) {
        shadowColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(shadowColorHex.value)) {
                const p = getSelectedPopout();
                if (p) { p.shadow.color = shadowColorHex.value; if (shadowColor) shadowColor.value = shadowColorHex.value; updateCanvas(); }
            }
        });
    }

    // Border toggle
    const borderToggle = document.getElementById('popout-border-toggle');
    if (borderToggle) {
        borderToggle.addEventListener('click', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.border.enabled = !p.border.enabled;
            updatePopoutProperties();
            updateCanvas();
        });
    }

    // Border properties
    const bindPopoutBorder = (inputId, prop, suffix) => {
        const input = document.getElementById(inputId);
        const valEl = document.getElementById(inputId + '-value');
        if (!input) return;
        input.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (!p) return;
            p.border[prop] = parseFloat(input.value);
            if (valEl) valEl.textContent = formatValue(parseFloat(input.value)) + suffix;
            updateCanvas();
        });
    };
    bindPopoutBorder('popout-border-width', 'width', 'px');
    bindPopoutBorder('popout-border-opacity', 'opacity', '%');

    // Border color
    const borderColor = document.getElementById('popout-border-color');
    const borderColorHex = document.getElementById('popout-border-color-hex');
    if (borderColor) {
        borderColor.addEventListener('input', () => {
            const p = getSelectedPopout();
            if (p) { p.border.color = borderColor.value; if (borderColorHex) borderColorHex.value = borderColor.value; updateCanvas(); }
        });
    }
    if (borderColorHex) {
        borderColorHex.addEventListener('change', () => {
            if (/^#[0-9a-fA-F]{6}$/.test(borderColorHex.value)) {
                const p = getSelectedPopout();
                if (p) { p.border.color = borderColorHex.value; if (borderColor) borderColor.value = borderColorHex.value; updateCanvas(); }
            }
        });
    }

    // Interactive crop preview drag handles
    setupCropPreviewDrag();
}

function setupEventListeners() {
    // Collapsible toggle rows
    document.querySelectorAll('.toggle-row.collapsible').forEach(row => {
        row.addEventListener('click', (e) => {
            // Don't collapse when clicking the toggle switch itself
            if (e.target.closest('.toggle')) return;

            const targetId = row.dataset.target;
            const target = document.getElementById(targetId);
            if (target) {
                row.classList.toggle('collapsed');
                target.style.display = row.classList.contains('collapsed') ? 'none' : 'block';
            }
        });
    });

    // File upload
    fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

    // Add screenshots button
    document.getElementById('add-screenshots-btn').addEventListener('click', () => fileInput.click());

    // Add blank screen button
    document.getElementById('add-blank-btn').addEventListener('click', () => {
        createNewScreenshot(null, null, 'Blank Screen', null, outputDeviceFamilyLabel());
        state.selectedIndex = state.screenshots.length - 1;
        updateScreenshotList();
        syncUIWithState();
        updateGradientStopsUI();
        updateCanvas();
    });

    // Make the entire sidebar content area a drop zone
    const sidebarContent = screenshotList.closest('.sidebar-content');
    sidebarContent.addEventListener('dragover', (e) => {
        // Only handle file drops, not internal screenshot reordering
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            sidebarContent.classList.add('drop-active');
        }
    });
    sidebarContent.addEventListener('dragleave', (e) => {
        // Only remove class if leaving the area entirely
        if (!sidebarContent.contains(e.relatedTarget)) {
            sidebarContent.classList.remove('drop-active');
        }
    });
    sidebarContent.addEventListener('drop', (e) => {
        if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            sidebarContent.classList.remove('drop-active');
            handleFiles(e.dataTransfer.files);
        }
    });

    // Set as Default button (commented out)
    // document.getElementById('set-as-default-btn').addEventListener('click', () => {
    //     if (state.screenshots.length === 0) return;
    //     setCurrentScreenshotAsDefault();
    //     // Show brief confirmation
    //     const btn = document.getElementById('set-as-default-btn');
    //     const originalText = btn.textContent;
    //     btn.textContent = 'Saved!';
    //     btn.style.borderColor = 'var(--accent)';
    //     btn.style.color = 'var(--accent)';
    //     setTimeout(() => {
    //         btn.textContent = originalText;
    //         btn.style.borderColor = '';
    //         btn.style.color = '';
    //     }, 1500);
    // });

    // Project dropdown
    const projectDropdown = document.getElementById('project-dropdown');
    const projectTrigger = document.getElementById('project-trigger');

    projectTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        projectDropdown.classList.toggle('open');
        // Close output size dropdown if open
        document.getElementById('output-size-dropdown').classList.remove('open');
    });

    // Close project dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!projectDropdown.contains(e.target)) {
            projectDropdown.classList.remove('open');
        }
    });

    document.getElementById('new-project-btn').addEventListener('click', () => {
        document.getElementById('project-modal-title').textContent = 'New Project';
        document.getElementById('project-name-input').value = '';
        document.getElementById('project-modal-confirm').textContent = 'Create';
        document.getElementById('project-modal').dataset.mode = 'new';

        const duplicateGroup = document.getElementById('duplicate-from-group');
        const duplicateSelect = document.getElementById('duplicate-from-select');
        if (projects.length > 0) {
            duplicateGroup.style.display = 'block';
            duplicateSelect.innerHTML = '<option value="">None (empty project)</option>';
            projects.forEach(p => {
                const option = document.createElement('option');
                option.value = p.id;
                option.textContent = p.name + (p.screenshotCount ? ` (${p.screenshotCount} screenshots)` : '');
                duplicateSelect.appendChild(option);
            });
        } else {
            duplicateGroup.style.display = 'none';
        }

        document.getElementById('project-modal').classList.add('visible');
        document.getElementById('project-name-input').focus();
    });

    document.getElementById('duplicate-from-select').addEventListener('change', (e) => {
        const selectedId = e.target.value;
        if (selectedId) {
            const selectedProject = projects.find(p => p.id === selectedId);
            if (selectedProject) {
                document.getElementById('project-name-input').value = selectedProject.name + ' (Copy)';
            }
        } else {
            document.getElementById('project-name-input').value = '';
        }
    });

    document.getElementById('rename-project-btn').addEventListener('click', () => {
        const project = projects.find(p => p.id === currentProjectId);
        document.getElementById('project-modal-title').textContent = 'Rename Project';
        document.getElementById('project-name-input').value = project ? project.name : '';
        document.getElementById('project-modal-confirm').textContent = 'Rename';
        document.getElementById('project-modal').dataset.mode = 'rename';
        document.getElementById('duplicate-from-group').style.display = 'none';
        document.getElementById('project-modal').classList.add('visible');
        document.getElementById('project-name-input').focus();
    });

    document.getElementById('duplicate-project-btn').addEventListener('click', async () => {
        const project = projects.find(p => p.id === currentProjectId);
        const baseName = project ? project.name : 'Project';
        saveState(); // flush pending edits so the copy includes the latest images/settings
        await duplicateProject(currentProjectId, baseName + ' (Copy)');
        await showAppAlert('Project duplicated with all screenshots, images and settings.', 'success');
    });

    document.getElementById('delete-project-btn').addEventListener('click', async () => {
        if (projects.length <= 1) {
            await showAppAlert('Cannot delete the only project', 'info');
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

    document.getElementById('project-modal-confirm').addEventListener('click', async () => {
        const name = document.getElementById('project-name-input').value.trim();
        if (!name) {
            await showAppAlert('Please enter a project name', 'info');
            return;
        }

        const mode = document.getElementById('project-modal').dataset.mode;
        if (mode === 'new') {
            const duplicateFromId = document.getElementById('duplicate-from-select').value;
            if (duplicateFromId) {
                await duplicateProject(duplicateFromId, name);
            } else {
                createProject(name);
            }
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

    // Export the CURRENT project as a ZIP backup: a project.json manifest plus the
    // images stored as separate files under images/ (re-importable). Storing
    // images as files instead of inline base64 keeps the archive smaller and lets
    // you inspect/reuse the originals.
    const EXT_TO_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp' };

    function dataUrlToBytes(dataUrl) {
        const comma = dataUrl.indexOf(',');
        const header = dataUrl.slice(5, comma); // e.g. "image/png;base64"
        const mime = header.split(';')[0] || 'image/png';
        const ext = (mime.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg');
        const body = dataUrl.slice(comma + 1);
        let bytes;
        if (/;base64/i.test(header)) {
            const bin = atob(body);
            bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        } else {
            bytes = new TextEncoder().encode(decodeURIComponent(body));
        }
        return { bytes, ext };
    }

    // Deep-walk, replacing every embedded data:image URL with a "zip:images/…"
    // reference and storing the bytes in the archive (identical images dedupe).
    function externalizeImages(obj, zip, ctx) {
        const handle = (val, set) => {
            if (typeof val === 'string' && val.startsWith('data:image/')) {
                let ref = ctx.seen.get(val);
                if (!ref) {
                    const { bytes, ext } = dataUrlToBytes(val);
                    const path = 'images/img_' + (ctx.n++) + '.' + ext;
                    zip.file(path, bytes);
                    ref = 'zip:' + path;
                    ctx.seen.set(val, ref);
                }
                set(ref);
            } else if (val && typeof val === 'object') {
                externalizeImages(val, zip, ctx);
            }
        };
        if (Array.isArray(obj)) obj.forEach((v, i) => handle(v, nv => { obj[i] = nv; }));
        else for (const k of Object.keys(obj)) handle(obj[k], nv => { obj[k] = nv; });
    }

    // Streaming import: upload each image straight from the ZIP (or a legacy
    // inline data URL) to a binary blob, replacing it with an "appdisk://" ref.
    // Bounded memory — one image at a time — so a 500 MB backup never becomes one
    // giant in-memory object, and the final record PUT carries refs only (tiny),
    // never tripping the server's JSON-body limit.
    function collectImageSources(obj, out) {
        if (Array.isArray(obj)) { for (const v of obj) collectImageSources(v, out); }
        else if (obj && typeof obj === 'object') { for (const k of Object.keys(obj)) collectImageSources(obj[k], out); }
        else if (typeof obj === 'string' && (obj.startsWith('zip:') || obj.startsWith('data:image/'))) out.add(obj);
    }
    function replaceStrings(obj, map) {
        const keys = Array.isArray(obj) ? obj.map((_, i) => i) : Object.keys(obj);
        for (const k of keys) {
            const v = obj[k];
            if (typeof v === 'string') { if (map.has(v)) obj[k] = map.get(v); }
            else if (v && typeof v === 'object') replaceStrings(v, map);
        }
    }
    function httpErrorHint(status) {
        if (status === 413) return ' (fichier trop volumineux pour le serveur)';
        if (status === 507) return ' — STOCKAGE SERVEUR NON PERSISTANT : le volume n’est pas monté, corrigez le déploiement avant d’importer';
        return '';
    }
    // fetch with a hard timeout + retries. A stalled upload (server restart,
    // proxy cut) must FAIL with a message — never hang the import forever.
    async function fetchRetry(url, opts, { timeoutMs = 90000, tries = 3 } = {}) {
        let lastErr;
        for (let attempt = 1; attempt <= tries; attempt++) {
            const ctl = new AbortController();
            const t = setTimeout(() => ctl.abort(), timeoutMs);
            try {
                const r = await fetch(url, { ...opts, signal: ctl.signal });
                clearTimeout(t);
                if (r.ok) return r;
                if (r.status === 413 || r.status === 507) return r; // permanent — don't retry
                lastErr = new Error('HTTP ' + r.status);
            } catch (e) {
                clearTimeout(t);
                lastErr = (e && e.name === 'AbortError') ? new Error('délai dépassé (' + (timeoutMs / 1000) + 's)') : e;
            }
            if (attempt < tries) await new Promise(res => setTimeout(res, 2000 * attempt));
        }
        throw lastErr || new Error('échec réseau');
    }
    async function uploadImportBlob(projectId, bytes, ext, name) {
        const base = RemoteStore.baseUrl();
        if (!base) throw new Error('aucun serveur configuré');
        const e = (ext || 'png').toLowerCase();
        const mime = EXT_TO_MIME[e] || 'application/octet-stream';
        const r = await fetchRetry(base + '/projects/' + encodeURIComponent(projectId) + '/blobs/' + name, {
            method: 'PUT', headers: { ...RemoteStore._headers(false), 'Content-Type': mime }, body: bytes
        });
        if (!r.ok) throw new Error('upload image HTTP ' + r.status + httpErrorHint(r.status));
        return REF_SCHEME + name;
    }
    async function importRecordToServer(data, zip, label) {
        const base = RemoteStore.baseUrl();
        if (!base) throw new Error('aucun serveur configuré');
        const sources = new Set();
        collectImageSources(data, sources);
        const list = Array.from(sources);
        const map = new Map();

        // One image in memory at a time, in two passes.
        // Pass 1 — hash: read each image's bytes, compute its content-addressed
        // name, DISCARD the bytes (re-read from the ZIP on upload). Knowing every
        // name up front lets blobs/check tell us which blobs the server already
        // has, so a re-import after a failure RESUMES instead of restarting.
        const readBytes = async (src) => {
            if (src.startsWith('zip:')) {
                const f = zip && zip.file(src.slice(4));
                if (!f) return null; // missing in archive — leave as-is; server verify flags it
                return { bytes: await f.async('uint8array'), ext: (src.slice(4).split('.').pop() || 'png').toLowerCase() };
            }
            const r = dataUrlToBytes(src);
            return { bytes: r.bytes, ext: r.ext };
        };
        const items = [];
        for (let i = 0; i < list.length; i++) {
            const src = list[i];
            showUploadProgress('Préparation des images… (' + (i + 1) + '/' + list.length + ')', label || '');
            const read = await readBytes(src);
            if (!read) continue;
            const name = (await sha256Hex(read.bytes)).slice(0, 40) + '.' + (read.ext || 'png').toLowerCase();
            items.push({ src, ext: read.ext, name }); // bytes NOT kept
        }
        let missing = new Set(items.map(it => it.name));
        try {
            const r = await fetchRetry(base + '/projects/' + encodeURIComponent(data.id) + '/blobs/check', {
                method: 'POST', headers: RemoteStore._headers(true),
                body: JSON.stringify({ names: items.map(it => it.name) })
            }, { timeoutMs: 30000 });
            if (r.ok) missing = new Set((await r.json()).missing || []);
        } catch (e) { /* can't check — upload everything */ }

        // Already-present blobs resume for free.
        for (const it of items) if (!missing.has(it.name)) map.set(it.src, REF_SCHEME + it.name);

        // Pass 2 — upload the missing blobs in BATCHES (few round-trips). Bytes are
        // re-read from the ZIP per batch so peak memory stays ~one batch (≤40 MB),
        // never the whole project.
        const toUpload = items.filter(it => missing.has(it.name));
        const eid = encodeURIComponent(data.id);
        const MAX_BYTES = 40 * 1024 * 1024, MAX_COUNT = 40;
        let done = 0, useBatch = true, idx = 0;
        const total = toUpload.length;
        while (idx < toUpload.length) {
            const batch = [];
            let size = 0;
            while (idx < toUpload.length && batch.length < MAX_COUNT) {
                const it = toUpload[idx];
                const read = await readBytes(it.src);
                if (!read) { idx++; continue; }
                if (batch.length > 0 && size + read.bytes.length > MAX_BYTES) break; // send what we have; re-read this one next batch
                const mime = EXT_TO_MIME[(it.ext || 'png').toLowerCase()] || 'application/octet-stream';
                batch.push({ name: it.name, bytes: read.bytes, mime, src: it.src, ext: it.ext });
                size += read.bytes.length; idx++;
            }
            if (!batch.length) continue;
            showUploadProgress('Import des images… (' + (done + 1) + '–' + (done + batch.length) + '/' + total + ')', label || '');
            let res = useBatch ? await RemoteStore._uploadBatch(eid, batch) : 'fallback';
            if (res === 'no-batch-endpoint' || res === 'fallback') {
                useBatch = false; // old server (or chosen fallback): PUT one by one
                for (const x of batch) { await uploadImportBlob(data.id, x.bytes, x.ext, x.name); map.set(x.src, REF_SCHEME + x.name); }
            } else if (!res) {
                throw new Error('upload du lot d’images échoué');
            } else {
                for (const x of batch) map.set(x.src, REF_SCHEME + x.name);
            }
            done += batch.length;
        }
        replaceStrings(data, map);
        showUploadProgress('Enregistrement du projet…', label || '');
        const r = await fetchRetry(base + '/projects/' + encodeURIComponent(data.id), {
            method: 'PUT', headers: RemoteStore._headers(true), body: JSON.stringify(data)
        });
        if (!r.ok) throw new Error('enregistrement du projet HTTP ' + r.status + httpErrorHint(r.status));
        return true;
    }

    document.getElementById('export-project-btn').addEventListener('click', async () => {
        try {
            saveState(); // flush pending edits so the latest images/settings reach the server
            await waitForServerConfirmation(currentProjectId);
            const rec = await RemoteStore.get(currentProjectId); // the server is the only store
            if (!rec) { await showAppAlert('No project data to export.', 'error'); return; }
            const meta = projects.find(p => p.id === currentProjectId);
            const name = meta ? meta.name : 'Project';

            const zip = new JSZip();
            const recClone = JSON.parse(JSON.stringify(rec));
            // Disk-only: the stored record holds "appdisk://" refs — pull the real
            // image bytes back from the server (all languages) before archiving.
            await resolveRefsInRecord(recClone);
            externalizeImages(recClone, zip, { seen: new Map(), n: 0 });
            const manifest = {
                type: 'appscreen-project-backup',
                version: 2, // v2 = ZIP with images stored as files
                exportedAt: new Date().toISOString(),
                name,
                data: recClone
            };
            zip.file('project.json', JSON.stringify(manifest));
            const blob = await zip.generateAsync({ type: 'blob' });

            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            const safe = name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
            a.download = `appscreen-${safe}-${new Date().toISOString().slice(0, 10)}.zip`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        } catch (e) {
            console.error('Export failed:', e);
            await showAppAlert('Export failed: ' + e.message, 'error');
        }
    });

    // Import project backup (ZIP with images, or legacy JSON).
    const importInput = document.getElementById('import-project-input');
    document.getElementById('import-project-btn').addEventListener('click', () => {
        importInput.click();
    });
    importInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (!RemoteStore.enabled()) {
            await showAppAlert('Aucun serveur configuré — impossible d’importer un projet.', 'error');
            importInput.value = '';
            return;
        }
        try {
            let manifest;
            let zip = null;
            const isZip = /\.zip$/i.test(file.name) || file.type === 'application/zip';
            if (isZip) {
                zip = await JSZip.loadAsync(file);
                const pj = zip.file('project.json');
                if (!pj) throw new Error('project.json not found in the ZIP');
                manifest = JSON.parse(await pj.async('string'));
                // NOTE: images stay as "zip:" refs — importRecordToServer streams
                // each one straight to a blob (no giant in-memory inline step).
            } else {
                manifest = JSON.parse(await file.text());
            }

            if (manifest && manifest.type === 'appscreen-project-backup' && manifest.data) {
                // Import as a NEW project, created directly ON THE SERVER (the
                // only store). Never overwrites; re-importable; portable.
                const newId = 'project_' + Date.now();
                const data = manifest.data;
                data.id = newId;
                delete data.rev; // fresh revision chain on the server
                let name = manifest.name || 'Imported Project';
                if (projects.some(p => p.name === name)) name += ' (Imported)';
                data.name = name;
                showUploadProgress('Import du projet…', name);
                try {
                    await importRecordToServer(data, zip, name);
                } finally {
                    hideUploadProgress();
                }
                projects.push({ id: newId, name, screenshotCount: (data.screenshots && data.screenshots.length) || 0 });
                remoteProjectIds.add(newId);
                saveProjectsMeta();
                await switchProject(newId);
                updateProjectSelector();
                await showAppAlert(`Imported "${name}" with all screenshots, images and settings.`, 'success');
            } else {
                // Legacy full-IndexedDB dump: import each project record to the server.
                const dump = manifest;
                const records = Array.isArray(dump && dump.projects) ? dump.projects : null;
                if (!records || !records.length) throw new Error('format de sauvegarde non reconnu');
                showUploadProgress('Import des projets…', '');
                try {
                    for (let i = 0; i < records.length; i++) {
                        const rec = records[i];
                        if (!rec || !Array.isArray(rec.screenshots)) continue;
                        showUploadProgress('Import des projets… (' + (i + 1) + '/' + records.length + ')', rec.name || rec.id || '');
                        rec.id = 'project_' + Date.now() + '_' + i;
                        delete rec.rev;
                        rec.name = rec.name || ('Imported ' + (i + 1));
                        await importRecordToServer(rec, null, rec.name);
                    }
                } finally {
                    hideUploadProgress();
                }
                await showAppAlert('Backup imported. Reloading…', 'success');
                location.reload();
            }
        } catch (e) {
            console.error('Import failed:', e);
            hideUploadProgress();
            await showAppAlert('Import échoué : ' + (e && e.message ? e.message : e), 'error');
        }
        importInput.value = '';
    });

    // Apply style to all modal buttons
    document.getElementById('apply-style-cancel').addEventListener('click', () => {
        document.getElementById('apply-style-modal').classList.remove('visible');
    });

    document.getElementById('apply-style-confirm').addEventListener('click', () => {
        applyStyleToAll();
        document.getElementById('apply-style-modal').classList.remove('visible');
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

    document.getElementById('apply-style-modal').addEventListener('click', (e) => {
        if (e.target.id === 'apply-style-modal') {
            document.getElementById('apply-style-modal').classList.remove('visible');
        }
    });

    // Language picker events
    document.getElementById('language-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const btn = e.currentTarget;
        const menu = document.getElementById('language-menu');
        menu.classList.toggle('visible');
        if (menu.classList.contains('visible')) {
            // Position menu below button using fixed positioning
            const rect = btn.getBoundingClientRect();
            menu.style.top = (rect.bottom + 4) + 'px';
            menu.style.left = rect.left + 'px';
            updateLanguageMenu();
        }
    });

    // Close language menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.language-picker')) {
            document.getElementById('language-menu').classList.remove('visible');
        }
    });

    // Edit Languages button
    document.getElementById('edit-languages-btn').addEventListener('click', () => {
        openLanguagesModal();
    });

    // Translate All button
    document.getElementById('translate-all-btn').addEventListener('click', () => {
        document.getElementById('language-menu').classList.remove('visible');
        translateAllText();
    });

    // Magical Titles button (in header)
    document.getElementById('magical-titles-btn').addEventListener('click', () => {
        dismissMagicalTitlesTooltip();
        showMagicalTitlesDialog();
    });

    // Magical Titles modal events
    document.getElementById('magical-titles-cancel').addEventListener('click', hideMagicalTitlesDialog);
    document.getElementById('magical-titles-confirm').addEventListener('click', generateMagicalTitles);
    document.getElementById('magical-titles-modal').addEventListener('click', (e) => {
        if (e.target.id === 'magical-titles-modal') hideMagicalTitlesDialog();
    });

    // Languages modal events
    document.getElementById('languages-modal-close').addEventListener('click', closeLanguagesModal);
    document.getElementById('languages-modal-done').addEventListener('click', closeLanguagesModal);
    document.getElementById('languages-modal').addEventListener('click', (e) => {
        if (e.target.id === 'languages-modal') closeLanguagesModal();
    });

    document.getElementById('add-language-select').addEventListener('change', (e) => {
        if (e.target.value) {
            addProjectLanguage(e.target.value);
            e.target.value = '';
        }
    });

    // Screenshot translations modal events
    document.getElementById('screenshot-translations-modal-close').addEventListener('click', closeScreenshotTranslationsModal);
    document.getElementById('screenshot-translations-modal-done').addEventListener('click', closeScreenshotTranslationsModal);
    document.getElementById('screenshot-translations-modal').addEventListener('click', (e) => {
        if (e.target.id === 'screenshot-translations-modal') closeScreenshotTranslationsModal();
    });
    document.getElementById('translation-file-input').addEventListener('change', handleTranslationFileSelect);

    // Export language modal events
    document.getElementById('export-current-only').addEventListener('click', () => {
        closeExportLanguageDialog('current');
    });
    document.getElementById('export-all-languages').addEventListener('click', () => {
        closeExportLanguageDialog('all');
    });
    document.getElementById('export-language-modal-cancel').addEventListener('click', () => {
        closeExportLanguageDialog(null);
    });
    document.getElementById('export-language-modal').addEventListener('click', (e) => {
        if (e.target.id === 'export-language-modal') closeExportLanguageDialog(null);
    });

    // Duplicate screenshot dialog
    initDuplicateDialogListeners();
    document.getElementById('duplicate-screenshot-modal').addEventListener('click', (e) => {
        if (e.target.id === 'duplicate-screenshot-modal') closeDuplicateDialog('ignore');
    });

    // Translate button events
    document.getElementById('translate-headline-btn').addEventListener('click', () => {
        openTranslateModal('headline');
    });

    document.getElementById('translate-subheadline-btn').addEventListener('click', () => {
        openTranslateModal('subheadline');
    });

    document.getElementById('translate-element-btn').addEventListener('click', () => {
        openTranslateModal('element');
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

    // Re-encode images already stored on the server (settings → Image compression)
    const optimizeBtn = document.getElementById('optimize-images-btn');
    if (optimizeBtn) optimizeBtn.addEventListener('click', () => { optimizeStoredImages('current'); });
    const optimizeAllBtn = document.getElementById('optimize-images-all-btn');
    if (optimizeAllBtn) optimizeAllBtn.addEventListener('click', () => { optimizeStoredImages('all'); });

    // Theme selector buttons
    document.querySelectorAll('#theme-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#theme-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyTheme(btn.dataset.theme);
        });
    });

    // Provider radio buttons
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            updateProviderSection(e.target.value);
        });
    });

    // Show/hide key buttons for all providers
    document.querySelectorAll('.settings-show-key').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.dataset.target;
            const input = document.getElementById(targetId);
            if (input) {
                input.type = input.type === 'password' ? 'text' : 'password';
            }
        });
    });

    // MCP server: connect button
    const mcpConnectBtn = document.getElementById('mcp-connect-btn');
    if (mcpConnectBtn) {
        mcpConnectBtn.addEventListener('click', () => {
            const url = normalizeMcpUrl(document.getElementById('settings-mcp-url').value.trim());
            const token = document.getElementById('settings-mcp-token').value.trim();
            // Reflect the corrected URL back into the field.
            document.getElementById('settings-mcp-url').value = url;
            // Persist immediately so a successful connection survives reloads.
            if (url) localStorage.setItem('mcpServerUrl', url); else localStorage.removeItem('mcpServerUrl');
            if (token) localStorage.setItem('mcpServerToken', token); else localStorage.removeItem('mcpServerToken');
            connectMcpServer(url, token);
        });
    }

    document.getElementById('settings-modal').addEventListener('click', (e) => {
        if (e.target.id === 'settings-modal') {
            document.getElementById('settings-modal').classList.remove('visible');
        }
    });

    // Output size dropdown
    const outputDropdown = document.getElementById('output-size-dropdown');
    const outputTrigger = document.getElementById('output-size-trigger');

    outputTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        outputDropdown.classList.toggle('open');
        // Close project dropdown if open
        document.getElementById('project-dropdown').classList.remove('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!outputDropdown.contains(e.target)) {
            outputDropdown.classList.remove('open');
        }
    });

    // Device option selection
    document.querySelectorAll('.output-size-menu .device-option').forEach(opt => {
        opt.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.output-size-menu .device-option').forEach(o => o.classList.remove('selected'));
            opt.classList.add('selected');
            const prevDevice = state.outputDevice;
            state.outputDevice = opt.dataset.device;

            // Moving to/from the Apple Watch is a 3× jump in canvas size, so the
            // absolute text sizes and the 2D device model both have to follow.
            rescaleTextForOutput(prevDevice, state.outputDevice);
            if (isWatchOutput() !== isWatchOutput(prevDevice)) {
                if (isWatchOutput()) adoptWatchDeviceModel(); else dropWatchDeviceModel(state.outputDevice);
                if (typeof syncDeviceTextExtras === 'function') syncDeviceTextExtras();
                syncUIWithState();
            }

            // Update trigger text
            document.getElementById('output-size-name').textContent = opt.querySelector('.device-option-name').textContent;
            document.getElementById('output-size-dims').textContent = opt.querySelector('.device-option-size').textContent;

            // Show/hide custom inputs
            const customInputs = document.getElementById('custom-size-inputs');
            if (state.outputDevice === 'custom') {
                customInputs.classList.add('visible');
            } else {
                customInputs.classList.remove('visible');
                outputDropdown.classList.remove('open');
            }
            updateCanvas();
        });
    });

    // Custom size inputs
    document.getElementById('custom-width').addEventListener('input', (e) => {
        state.customWidth = parseInt(e.target.value) || 1290;
        document.getElementById('output-size-dims').textContent = `${state.customWidth} × ${state.customHeight}`;
        updateCanvas();
    });
    document.getElementById('custom-height').addEventListener('input', (e) => {
        state.customHeight = parseInt(e.target.value) || 2796;
        document.getElementById('output-size-dims').textContent = `${state.customWidth} × ${state.customHeight}`;
        updateCanvas();
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tab.classList.add('active');
            document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
            // Show/hide the text-zone overlay with the Text tab.
            if (typeof updateTextZoneUI === 'function') updateTextZoneUI();
            // Save active tab to localStorage
            localStorage.setItem('activeTab', tab.dataset.tab);
        });
    });

    // Restore active tab from localStorage
    const savedTab = localStorage.getItem('activeTab');
    if (savedTab) {
        const tabBtn = document.querySelector(`.tab[data-tab="${savedTab}"]`);
        if (tabBtn) {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            tabBtn.classList.add('active');
            document.getElementById('tab-' + savedTab).classList.add('active');
        }
    }

    // Background type selector
    document.querySelectorAll('#bg-type-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#bg-type-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setBackground('type', btn.dataset.type);

            document.getElementById('gradient-options').style.display = btn.dataset.type === 'gradient' ? 'block' : 'none';
            document.getElementById('solid-options').style.display = btn.dataset.type === 'solid' ? 'block' : 'none';
            document.getElementById('image-options').style.display = btn.dataset.type === 'image' ? 'block' : 'none';

            updateCanvas();
        });
    });

    // Gradient preset dropdown toggle
    const presetDropdown = document.getElementById('gradient-preset-dropdown');
    const presetTrigger = document.getElementById('gradient-preset-trigger');
    presetTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        presetDropdown.classList.toggle('open');
    });

    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!presetDropdown.contains(e.target)) {
            presetDropdown.classList.remove('open');
        }
    });

    // Position preset dropdown toggle
    const positionPresetDropdown = document.getElementById('position-preset-dropdown');
    const positionPresetTrigger = document.getElementById('position-preset-trigger');
    positionPresetTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        positionPresetDropdown.classList.toggle('open');
    });

    // Close position preset dropdown when clicking outside
    document.addEventListener('click', (e) => {
        if (!positionPresetDropdown.contains(e.target)) {
            positionPresetDropdown.classList.remove('open');
        }
    });

    // Close screenshot menus when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.screenshot-menu-wrapper')) {
            document.querySelectorAll('.screenshot-menu.open').forEach(m => m.classList.remove('open'));
        }
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
                const angle = parseInt(angleMatch[1]);
                setBackground('gradient.angle', angle);
                document.getElementById('gradient-angle').value = angle;
                document.getElementById('gradient-angle-value').textContent = formatValue(angle) + '°';
            }

            const stops = [];
            for (const match of colorMatches) {
                stops.push({ color: match[1], position: parseInt(match[2]) });
            }
            if (stops.length >= 2) {
                setBackground('gradient.stops', stops);
                updateGradientStopsUI();
            }

            updateCanvas();
        });
    });

    // Gradient angle
    document.getElementById('gradient-angle').addEventListener('input', (e) => {
        setBackground('gradient.angle', parseInt(e.target.value));
        document.getElementById('gradient-angle-value').textContent = formatValue(e.target.value) + '°';
        // Deselect preset when manually changing angle
        document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
        updateCanvas();
    });

    // Add gradient stop
    document.getElementById('add-gradient-stop').addEventListener('click', () => {
        const bg = getBackground();
        const lastStop = bg.gradient.stops[bg.gradient.stops.length - 1];
        bg.gradient.stops.push({
            color: lastStop.color,
            position: Math.min(lastStop.position + 20, 100)
        });
        // Deselect preset when adding a stop
        document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
        updateGradientStopsUI();
        updateCanvas();
    });

    // Solid color
    document.getElementById('solid-color').addEventListener('input', (e) => {
        setBackground('solid', e.target.value);
        document.getElementById('solid-color-hex').value = e.target.value;
        updateCanvas();
    });
    document.getElementById('solid-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            setBackground('solid', e.target.value);
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
            const fileName = e.target.files[0].name;
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = async () => {
                    setBackground('image', img);
                    document.getElementById('bg-image-preview').src = event.target.result;
                    document.getElementById('bg-image-preview').style.display = 'block';
                    updateCanvas();
                    // Block until the server confirmed the background image.
                    showUploadProgress('Enregistrement sur le serveur…', fileName);
                    try {
                        saveState();
                        await waitForServerConfirmation(currentProjectId);
                    } finally {
                        hideUploadProgress();
                    }
                };
                img.onerror = () => {
                    _importFailures.push(fileName);
                    reportImportFailures();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(e.target.files[0]);
        }
    });

    document.getElementById('bg-image-fit').addEventListener('change', (e) => {
        setBackground('imageFit', e.target.value);
        updateCanvas();
    });

    document.getElementById('bg-blur').addEventListener('input', (e) => {
        setBackground('imageBlur', parseInt(e.target.value));
        document.getElementById('bg-blur-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('bg-overlay-color').addEventListener('input', (e) => {
        setBackground('overlayColor', e.target.value);
        document.getElementById('bg-overlay-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('bg-overlay-opacity').addEventListener('input', (e) => {
        setBackground('overlayOpacity', parseInt(e.target.value));
        document.getElementById('bg-overlay-opacity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // Noise toggle
    document.getElementById('noise-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const noiseEnabled = this.classList.contains('active');
        setBackground('noise', noiseEnabled);
        const row = this.closest('.toggle-row');
        if (noiseEnabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('noise-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('noise-options').style.display = 'none';
        }
        updateCanvas();
    });

    document.getElementById('noise-intensity').addEventListener('input', (e) => {
        setBackground('noiseIntensity', parseInt(e.target.value));
        document.getElementById('noise-intensity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // Screenshot settings
    document.getElementById('screenshot-scale').addEventListener('input', (e) => {
        setScreenshotSetting('scale', parseInt(e.target.value));
        document.getElementById('screenshot-scale-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('screenshot-y').addEventListener('input', (e) => {
        setScreenshotSetting('y', parseInt(e.target.value));
        document.getElementById('screenshot-y-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('screenshot-x').addEventListener('input', (e) => {
        setScreenshotSetting('x', parseInt(e.target.value));
        document.getElementById('screenshot-x-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('corner-radius').addEventListener('input', (e) => {
        setScreenshotSetting('cornerRadius', parseInt(e.target.value));
        document.getElementById('corner-radius-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('screenshot-rotation').addEventListener('input', (e) => {
        setScreenshotSetting('rotation', parseInt(e.target.value));
        document.getElementById('screenshot-rotation-value').textContent = formatValue(e.target.value) + '°';
        updateCanvas();
    });

    // Shadow toggle
    document.getElementById('shadow-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const shadowEnabled = this.classList.contains('active');
        setScreenshotSetting('shadow.enabled', shadowEnabled);
        const row = this.closest('.toggle-row');
        if (shadowEnabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('shadow-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('shadow-options').style.display = 'none';
        }
        updateCanvas();
    });

    document.getElementById('shadow-color').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.color', e.target.value);
        document.getElementById('shadow-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('shadow-blur').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.blur', parseInt(e.target.value));
        document.getElementById('shadow-blur-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('shadow-opacity').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.opacity', parseInt(e.target.value));
        document.getElementById('shadow-opacity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('shadow-x').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.x', parseInt(e.target.value));
        document.getElementById('shadow-x-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('shadow-y').addEventListener('input', (e) => {
        setScreenshotSetting('shadow.y', parseInt(e.target.value));
        document.getElementById('shadow-y-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    // Frame toggle
    document.getElementById('frame-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const frameEnabled = this.classList.contains('active');
        setScreenshotSetting('frame.enabled', frameEnabled);
        const row = this.closest('.toggle-row');
        if (frameEnabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('frame-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('frame-options').style.display = 'none';
        }
        updateCanvas();
    });

    document.getElementById('frame-color').addEventListener('input', (e) => {
        setScreenshotSetting('frame.color', e.target.value);
        document.getElementById('frame-color-hex').value = e.target.value;
        updateCanvas();
    });

    document.getElementById('frame-color-hex').addEventListener('input', (e) => {
        if (/^#[0-9A-Fa-f]{6}$/.test(e.target.value)) {
            setScreenshotSetting('frame.color', e.target.value);
            document.getElementById('frame-color').value = e.target.value;
            updateCanvas();
        }
    });

    document.getElementById('frame-width').addEventListener('input', (e) => {
        setScreenshotSetting('frame.width', parseInt(e.target.value));
        document.getElementById('frame-width-value').textContent = formatValue(e.target.value) + 'px';
        updateCanvas();
    });

    document.getElementById('frame-opacity').addEventListener('input', (e) => {
        setScreenshotSetting('frame.opacity', parseInt(e.target.value));
        document.getElementById('frame-opacity-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // Per-language layout toggle
    document.getElementById('per-language-layout-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const enabled = this.classList.contains('active');
        const text = getTextSettings();
        if (enabled && !text.perLanguageLayout) {
            // Seed all language settings from current global values
            const languages = new Set([...(text.headlineLanguages || ['en']), ...(text.subheadlineLanguages || ['en'])]);
            if (!text.languageSettings) text.languageSettings = {};
            languages.forEach(lang => {
                text.languageSettings[lang] = {
                    headlineSize: text.headlineSize || 100,
                    subheadlineSize: text.subheadlineSize || 50,
                    position: text.position || 'top',
                    offsetY: typeof text.offsetY === 'number' ? text.offsetY : 12,
                    lineHeight: text.lineHeight || 110
                };
            });
        }
        text.perLanguageLayout = enabled;
        updateCanvas();
    });

    // Headline toggle
    document.getElementById('headline-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const enabled = this.classList.contains('active');
        setTextValue('headlineEnabled', enabled);
        const row = this.closest('.toggle-row');
        if (enabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('headline-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('headline-options').style.display = 'none';
        }
        updateCanvas();
    });

    // Subheadline toggle
    document.getElementById('subheadline-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        const enabled = this.classList.contains('active');
        setTextValue('subheadlineEnabled', enabled);
        const row = this.closest('.toggle-row');
        if (enabled) {
            if (row) row.classList.remove('collapsed');
            document.getElementById('subheadline-options').style.display = 'block';
        } else {
            if (row) row.classList.add('collapsed');
            document.getElementById('subheadline-options').style.display = 'none';
        }
        updateCanvas();
    });

    // Text settings
    document.getElementById('headline-text').addEventListener('input', (e) => {
        const text = getTextSettings();
        if (!text.headlines) text.headlines = { en: '' };
        text.headlines[text.currentHeadlineLang || 'en'] = e.target.value;
        updateCanvas();
    });

    // Font picker is initialized separately via initFontPicker()

    document.getElementById('headline-size').addEventListener('input', (e) => {
        const text = getTextSettings();
        const lang = text.currentHeadlineLang || 'en';
        setTextLanguageValue('headlineSize', parseInt(e.target.value) || 100, lang);
        updateCanvas();
    });

    document.getElementById('headline-color').addEventListener('input', (e) => {
        setTextValue('headlineColor', e.target.value);
        updateCanvas();
    });

    document.getElementById('headline-weight').addEventListener('change', (e) => {
        setTextValue('headlineWeight', e.target.value);
        updateCanvas();
    });

    // Text style buttons (italic, underline, strikethrough)
    document.querySelectorAll('#headline-style button').forEach(btn => {
        btn.addEventListener('click', () => {
            const style = btn.dataset.style;
            const key = 'headline' + style.charAt(0).toUpperCase() + style.slice(1);
            const text = getTextSettings();
            const newValue = !text[key];
            setTextValue(key, newValue);
            btn.classList.toggle('active', newValue);
            updateCanvas();
        });
    });

    document.querySelectorAll('#text-position button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#text-position button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setTextLanguageValue('position', btn.dataset.position);
            updateCanvas();
        });
    });

    document.getElementById('text-offset-y').addEventListener('input', (e) => {
        setTextLanguageValue('offsetY', parseInt(e.target.value));
        document.getElementById('text-offset-y-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    document.getElementById('line-height').addEventListener('input', (e) => {
        setTextLanguageValue('lineHeight', parseInt(e.target.value));
        document.getElementById('line-height-value').textContent = formatValue(e.target.value) + '%';
        updateCanvas();
    });

    // Text zone (auto-fit rectangle) toggle, sliders and draggable overlay.
    setupTextZoneControls();

    document.getElementById('subheadline-text').addEventListener('input', (e) => {
        const text = getTextSettings();
        if (!text.subheadlines) text.subheadlines = { en: '' };
        text.subheadlines[text.currentSubheadlineLang || 'en'] = e.target.value;
        updateCanvas();
    });

    document.getElementById('subheadline-size').addEventListener('input', (e) => {
        const text = getTextSettings();
        const lang = text.currentSubheadlineLang || 'en';
        setTextLanguageValue('subheadlineSize', parseInt(e.target.value) || 50, lang);
        updateCanvas();
    });

    document.getElementById('subheadline-color').addEventListener('input', (e) => {
        setTextValue('subheadlineColor', e.target.value);
        updateCanvas();
    });

    document.getElementById('subheadline-opacity').addEventListener('input', (e) => {
        const value = parseInt(e.target.value) || 70;
        setTextValue('subheadlineOpacity', value);
        document.getElementById('subheadline-opacity-value').textContent = formatValue(value) + '%';
        updateCanvas();
    });

    // Subheadline weight
    document.getElementById('subheadline-weight').addEventListener('change', (e) => {
        setTextValue('subheadlineWeight', e.target.value);
        updateCanvas();
    });

    // Subheadline style buttons (italic, underline, strikethrough)
    document.querySelectorAll('#subheadline-style button').forEach(btn => {
        btn.addEventListener('click', () => {
            const style = btn.dataset.style;
            const key = 'subheadline' + style.charAt(0).toUpperCase() + style.slice(1);
            const text = getTextSettings();
            const newValue = !text[key];
            setTextValue(key, newValue);
            btn.classList.toggle('active', newValue);
            updateCanvas();
        });
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

    // Device type selector (2D/3D)
    document.querySelectorAll('#device-type-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            // No GLB model for this output size (Apple Watch) — stay in 2D.
            if (btn.dataset.type === '3d' && !output3DSupported()) return;
            document.querySelectorAll('#device-type-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const use3D = btn.dataset.type === '3d';
            setScreenshotSetting('use3D', use3D);
            document.getElementById('rotation-3d-options').style.display = use3D ? 'block' : 'none';

            // Hide 2D-only settings in 3D mode, show 3D tip
            document.getElementById('2d-only-settings').style.display = use3D ? 'none' : 'block';
            document.getElementById('position-presets-section').style.display = use3D ? 'none' : 'block';
            document.getElementById('frame-color-section').style.display = use3D ? 'block' : 'none';
            document.getElementById('3d-tip').style.display = use3D ? 'flex' : 'none';

            if (typeof showThreeJS === 'function') {
                showThreeJS(use3D);
            }

            if (use3D && typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }

            updateCanvas();
        });
    });

    // 3D device model selector
    document.querySelectorAll('#device-3d-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#device-3d-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const device3D = btn.dataset.model;
            setScreenshotSetting('device3D', device3D);

            // Reset frame color to first preset for new device
            const presets = typeof frameColorPresets !== 'undefined' ? frameColorPresets[device3D] : null;
            const defaultColor = presets ? presets[0].id : null;
            setScreenshotSetting('frameColor', defaultColor);
            updateFrameColorSwatches(device3D, defaultColor);

            if (typeof switchPhoneModel === 'function') {
                switchPhoneModel(device3D);
            }

            // Apply default frame color after model switch
            if (defaultColor && typeof setPhoneFrameColor === 'function') {
                setTimeout(() => setPhoneFrameColor(defaultColor, device3D), 100);
            }

            updateCanvas();
        });
    });

    // 3D rotation controls
    document.getElementById('rotation-3d-x').addEventListener('input', (e) => {
        const ss = getScreenshotSettings();
        if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
        ss.rotation3D.x = parseInt(e.target.value);
        document.getElementById('rotation-3d-x-value').textContent = formatValue(e.target.value) + '°';
        if (typeof setThreeJSRotation === 'function') {
            setThreeJSRotation(ss.rotation3D.x, ss.rotation3D.y, ss.rotation3D.z);
        }
        updateCanvas(); // Keep export canvas in sync
    });

    document.getElementById('rotation-3d-y').addEventListener('input', (e) => {
        const ss = getScreenshotSettings();
        if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
        ss.rotation3D.y = parseInt(e.target.value);
        document.getElementById('rotation-3d-y-value').textContent = formatValue(e.target.value) + '°';
        if (typeof setThreeJSRotation === 'function') {
            setThreeJSRotation(ss.rotation3D.x, ss.rotation3D.y, ss.rotation3D.z);
        }
        updateCanvas(); // Keep export canvas in sync
    });

    document.getElementById('rotation-3d-z').addEventListener('input', (e) => {
        const ss = getScreenshotSettings();
        if (!ss.rotation3D) ss.rotation3D = { x: 0, y: 0, z: 0 };
        ss.rotation3D.z = parseInt(e.target.value);
        document.getElementById('rotation-3d-z-value').textContent = formatValue(e.target.value) + '°';
        if (typeof setThreeJSRotation === 'function') {
            setThreeJSRotation(ss.rotation3D.x, ss.rotation3D.y, ss.rotation3D.z);
        }
        updateCanvas(); // Keep export canvas in sync
    });
}

// Per-screenshot mode is now always active (all settings are per-screenshot)
function isPerScreenshotTextMode() {
    return true;
}

// Global language picker functions
function updateLanguageMenu() {
    const container = document.getElementById('language-menu-items');
    container.innerHTML = '';

    state.projectLanguages.forEach(lang => {
        const btn = document.createElement('button');
        btn.className = 'language-menu-item' + (lang === state.currentLanguage ? ' active' : '');
        btn.innerHTML = `<span class="flag">${languageFlags[lang] || '🏳️'}</span> ${languageNames[lang] || lang.toUpperCase()}`;
        btn.onclick = () => {
            switchGlobalLanguage(lang);
            document.getElementById('language-menu').classList.remove('visible');
        };
        container.appendChild(btn);
    });
}

function updateLanguageButton() {
    const flag = languageFlags[state.currentLanguage] || '🏳️';
    document.getElementById('language-btn-flag').textContent = flag;
}

function switchGlobalLanguage(lang) {
    state.currentLanguage = lang;

    // Update all screenshots to use this language for display
    state.screenshots.forEach(screenshot => {
        screenshot.text.currentHeadlineLang = lang;
        screenshot.text.currentSubheadlineLang = lang;
    });

    // Update UI
    updateLanguageButton();
    syncUIWithState();
    updateCanvas();
    saveState();
}

// Languages modal functions
function openLanguagesModal() {
    document.getElementById('language-menu').classList.remove('visible');
    document.getElementById('languages-modal').classList.add('visible');
    updateLanguagesList();
    updateAddLanguageSelect();
}

function closeLanguagesModal() {
    document.getElementById('languages-modal').classList.remove('visible');
}

function updateLanguagesList() {
    const container = document.getElementById('languages-list');
    container.innerHTML = '';

    state.projectLanguages.forEach(lang => {
        const item = document.createElement('div');
        item.className = 'language-item';

        const flag = languageFlags[lang] || '🏳️';
        const name = languageNames[lang] || lang.toUpperCase();
        const isCurrent = lang === state.currentLanguage;
        const isOnly = state.projectLanguages.length === 1;

        item.innerHTML = `
            <span class="flag">${flag}</span>
            <span class="name">${name}</span>
            ${isCurrent ? '<span class="current-badge">Current</span>' : ''}
            <button class="remove-btn" ${isOnly ? 'disabled' : ''} title="${isOnly ? 'Cannot remove the only language' : 'Remove language'}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
            </button>
        `;

        const removeBtn = item.querySelector('.remove-btn');
        if (!isOnly) {
            removeBtn.addEventListener('click', () => removeProjectLanguage(lang));
        }

        container.appendChild(item);
    });
}

function updateAddLanguageSelect() {
    const select = document.getElementById('add-language-select');
    select.innerHTML = '<option value="">Add a language...</option>';

    // Add all available languages that aren't already in the project
    Object.keys(languageNames).forEach(lang => {
        if (!state.projectLanguages.includes(lang)) {
            const flag = languageFlags[lang] || '🏳️';
            const name = languageNames[lang];
            const option = document.createElement('option');
            option.value = lang;
            option.textContent = `${flag} ${name}`;
            select.appendChild(option);
        }
    });
}

function addProjectLanguage(lang) {
    if (!lang || state.projectLanguages.includes(lang)) return;

    state.projectLanguages.push(lang);

    // Add the language to all screenshots' text settings
    state.screenshots.forEach(screenshot => {
        if (!screenshot.text.headlineLanguages.includes(lang)) {
            screenshot.text.headlineLanguages.push(lang);
            if (!screenshot.text.headlines) screenshot.text.headlines = { en: '' };
            screenshot.text.headlines[lang] = '';
        }
        if (!screenshot.text.subheadlineLanguages.includes(lang)) {
            screenshot.text.subheadlineLanguages.push(lang);
            if (!screenshot.text.subheadlines) screenshot.text.subheadlines = { en: '' };
            screenshot.text.subheadlines[lang] = '';
        }
    });

    // Also update defaults
    if (!state.defaults.text.headlineLanguages.includes(lang)) {
        state.defaults.text.headlineLanguages.push(lang);
        if (!state.defaults.text.headlines) state.defaults.text.headlines = { en: '' };
        state.defaults.text.headlines[lang] = '';
    }
    if (!state.defaults.text.subheadlineLanguages.includes(lang)) {
        state.defaults.text.subheadlineLanguages.push(lang);
        if (!state.defaults.text.subheadlines) state.defaults.text.subheadlines = { en: '' };
        state.defaults.text.subheadlines[lang] = '';
    }

    updateLanguagesList();
    updateAddLanguageSelect();
    updateLanguageMenu();
    saveState();
}

function removeProjectLanguage(lang) {
    if (state.projectLanguages.length <= 1) return; // Must have at least one language

    const index = state.projectLanguages.indexOf(lang);
    if (index > -1) {
        state.projectLanguages.splice(index, 1);

        // If removing the current language, switch to the first available
        if (state.currentLanguage === lang) {
            switchGlobalLanguage(state.projectLanguages[0]);
        }

        // Remove from all screenshots
        state.screenshots.forEach(screenshot => {
            const hIndex = screenshot.text.headlineLanguages.indexOf(lang);
            if (hIndex > -1) {
                screenshot.text.headlineLanguages.splice(hIndex, 1);
                delete screenshot.text.headlines[lang];
            }
            const sIndex = screenshot.text.subheadlineLanguages.indexOf(lang);
            if (sIndex > -1) {
                screenshot.text.subheadlineLanguages.splice(sIndex, 1);
                delete screenshot.text.subheadlines[lang];
            }
            if (screenshot.text.currentHeadlineLang === lang) {
                screenshot.text.currentHeadlineLang = state.projectLanguages[0];
            }
            if (screenshot.text.currentSubheadlineLang === lang) {
                screenshot.text.currentSubheadlineLang = state.projectLanguages[0];
            }
        });

        // Remove from defaults
        const dhIndex = state.defaults.text.headlineLanguages.indexOf(lang);
        if (dhIndex > -1) {
            state.defaults.text.headlineLanguages.splice(dhIndex, 1);
            delete state.defaults.text.headlines[lang];
        }
        const dsIndex = state.defaults.text.subheadlineLanguages.indexOf(lang);
        if (dsIndex > -1) {
            state.defaults.text.subheadlineLanguages.splice(dsIndex, 1);
            delete state.defaults.text.subheadlines[lang];
        }

        updateLanguagesList();
        updateAddLanguageSelect();
        updateLanguageMenu();
        updateLanguageButton();
        syncUIWithState();
        saveState();
    }
}

// Language helper functions
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
    text.currentLayoutLang = lang;

    // Sync text inputs and layout controls for this language
    updateTextUI(text);
    updateCanvas();
}

function switchSubheadlineLanguage(lang) {
    const text = getTextSettings();
    text.currentSubheadlineLang = lang;
    text.currentLayoutLang = lang;

    // Sync text inputs and layout controls for this language
    updateTextUI(text);
    updateCanvas();
}

function updateHeadlineLanguageUI() {
    // Language flag UI removed - translations now managed through translate modal
}

function updateSubheadlineLanguageUI() {
    // Language flag UI removed - translations now managed through translate modal
}

// Translate modal functions
let currentTranslateTarget = null;

// Full set of App Store Connect localizations (39).
const languageNames = {
    'en': 'English (US)', 'en-au': 'English (Australia)', 'en-ca': 'English (Canada)',
    'en-gb': 'English (UK)', 'de': 'German', 'fr': 'French', 'fr-ca': 'French (Canada)',
    'es': 'Spanish (Spain)', 'es-mx': 'Spanish (Mexico)', 'it': 'Italian',
    'pt': 'Portuguese (Portugal)', 'pt-br': 'Portuguese (Brazil)',
    'nl': 'Dutch', 'ru': 'Russian', 'ja': 'Japanese', 'ko': 'Korean',
    'zh': 'Chinese (Simplified)', 'zh-tw': 'Chinese (Traditional)', 'ar': 'Arabic',
    'hi': 'Hindi', 'tr': 'Turkish', 'pl': 'Polish', 'sv': 'Swedish',
    'da': 'Danish', 'no': 'Norwegian', 'fi': 'Finnish', 'th': 'Thai',
    'vi': 'Vietnamese', 'id': 'Indonesian', 'uk': 'Ukrainian',
    'ca': 'Catalan', 'cs': 'Czech', 'el': 'Greek', 'he': 'Hebrew',
    'hr': 'Croatian', 'hu': 'Hungarian', 'ms': 'Malay', 'ro': 'Romanian', 'sk': 'Slovak',
    'sl': 'Slovenian', 'bn': 'Bangla', 'gu': 'Gujarati', 'kn': 'Kannada',
    'ml': 'Malayalam', 'mr': 'Marathi', 'or': 'Odia', 'pa': 'Punjabi',
    'ta': 'Tamil', 'te': 'Telugu', 'ur': 'Urdu'
};

function openTranslateModal(target) {
    currentTranslateTarget = target;
    const text = getTextSettings();
    const isHeadline = target === 'headline';
    const isElement = target === 'element';

    let languages, texts;
    if (isElement) {
        const el = getSelectedElement();
        if (!el || el.type !== 'text') return;
        document.getElementById('translate-target-type').textContent = 'Element Text';
        languages = state.projectLanguages;
        if (!el.texts) el.texts = {};
        texts = el.texts;
    } else {
        document.getElementById('translate-target-type').textContent = isHeadline ? 'Headline' : 'Subheadline';
        languages = isHeadline ? text.headlineLanguages : text.subheadlineLanguages;
        texts = isHeadline ? text.headlines : text.subheadlines;
    }

    // Populate source language dropdown (first language selected by default)
    const sourceSelect = document.getElementById('translate-source-lang');
    sourceSelect.innerHTML = '';
    languages.forEach((lang, index) => {
        const option = document.createElement('option');
        option.value = lang;
        option.textContent = `${languageFlags[lang]} ${languageNames[lang] || lang}`;
        if (index === 0) option.selected = true;
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
    const sourceLang = document.getElementById('translate-source-lang').value;
    let sourceText;
    if (currentTranslateTarget === 'element') {
        const el = getSelectedElement();
        sourceText = el && el.texts ? (el.texts[sourceLang] || '') : '';
    } else {
        const text = getTextSettings();
        const isHeadline = currentTranslateTarget === 'headline';
        const texts = isHeadline ? text.headlines : text.subheadlines;
        sourceText = texts[sourceLang] || '';
    }

    document.getElementById('source-text-preview').textContent = sourceText || 'No text entered';
}

function applyTranslations() {
    const isElement = currentTranslateTarget === 'element';

    if (isElement) {
        const el = getSelectedElement();
        if (!el) return;
        if (!el.texts) el.texts = {};

        document.querySelectorAll('#translate-targets .translate-target-item').forEach(item => {
            const lang = item.dataset.lang;
            const textarea = item.querySelector('textarea');
            el.texts[lang] = textarea.value;
        });
        el.text = getElementText(el); // sync for backwards compat
        document.getElementById('element-text-input').value = getElementText(el);
    } else {
        const text = getTextSettings();
        const isHeadline = currentTranslateTarget === 'headline';
        const texts = isHeadline ? text.headlines : text.subheadlines;

        document.querySelectorAll('#translate-targets .translate-target-item').forEach(item => {
            const lang = item.dataset.lang;
            const textarea = item.querySelector('textarea');
            texts[lang] = textarea.value;
        });

        const currentLang = isHeadline ? text.currentHeadlineLang : text.currentSubheadlineLang;
        if (isHeadline) {
            document.getElementById('headline-text').value = texts[currentLang] || '';
        } else {
            document.getElementById('subheadline-text').value = texts[currentLang] || '';
            text.subheadlineEnabled = true;
            syncUIWithState();
        }
    }

    saveState();
    updateCanvas();
}

async function aiTranslateAll() {
    const sourceLang = document.getElementById('translate-source-lang').value;
    const isElement = currentTranslateTarget === 'element';
    let texts, languages, sourceText;
    if (isElement) {
        const el = getSelectedElement();
        if (!el) return;
        texts = el.texts || {};
        languages = state.projectLanguages;
        sourceText = texts[sourceLang] || '';
    } else {
        const text = getTextSettings();
        const isHeadline = currentTranslateTarget === 'headline';
        texts = isHeadline ? text.headlines : text.subheadlines;
        languages = isHeadline ? text.headlineLanguages : text.subheadlineLanguages;
        sourceText = texts[sourceLang] || '';
    }

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

    // Get selected provider and API key
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = localStorage.getItem(providerConfig.storageKey);

    if (!apiKey) {
        setTranslateStatus(`Add your LLM API key in Settings to use AI translation.`, 'error');
        return;
    }

    const btn = document.getElementById('ai-translate-btn');
    btn.disabled = true;
    btn.classList.add('loading');
    btn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 2v4m0 12v4m-8-10h4m12 0h4m-5.66-5.66l-2.83 2.83m-5.66 5.66l-2.83 2.83m14.14 0l-2.83-2.83M6.34 6.34L3.51 3.51"/>
        </svg>
        <span>Translating...</span>
    `;

    setTranslateStatus(`Translating to ${targetLangs.length} language(s) with ${providerConfig.name}...`, '');

    // Mark all target items as translating
    targetLangs.forEach(lang => {
        const item = document.querySelector(`.translate-target-item[data-lang="${lang}"]`);
        if (item) item.classList.add('translating');
    });

    try {
        // Build the translation prompt
        const targetLangNames = targetLangs.map(lang => `${languageNames[lang]} (${lang})`).join(', ');

        const prompt = `You are a professional translator for App Store screenshot marketing copy. Translate the following text from ${languageNames[sourceLang]} to these languages: ${targetLangNames}.

The text is a short marketing headline/tagline for an app that must fit on a screenshot, so keep translations:
- SIMILAR LENGTH to the original - do NOT make it longer, as it must fit on screen
- Concise and punchy
- Marketing-focused and compelling
- Culturally appropriate for each target market
- Natural-sounding in each language

IMPORTANT: The translated text will be displayed on app screenshots with limited space. If the source text is short, the translation MUST also be short. Prioritize brevity over literal accuracy.

Source text (${languageNames[sourceLang]}):
"${sourceText}"

Respond ONLY with a valid JSON object mapping language codes to translations. Do not include any other text.
Example format:
{"de": "German translation", "fr": "French translation"}

Translate to these language codes: ${targetLangs.join(', ')}`;

        let responseText;

        if (provider === 'anthropic') {
            responseText = await translateWithAnthropic(apiKey, prompt);
        } else if (provider === 'openai') {
            responseText = await translateWithOpenAI(apiKey, prompt);
        } else if (provider === 'google') {
            responseText = await translateWithGoogle(apiKey, prompt);
        }

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

        if (error.message === 'Failed to fetch') {
            setTranslateStatus('Connection failed. Check your API key in Settings.', 'error');
        } else if (error.message === 'AI_UNAVAILABLE' || error.message.includes('401') || error.message.includes('403')) {
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

// Helper function to show styled alert modal
function showAppAlert(message, type = 'info') {
    return new Promise((resolve) => {
        const iconBg = type === 'error' ? 'rgba(255, 69, 58, 0.2)' :
            type === 'success' ? 'rgba(52, 199, 89, 0.2)' :
                'rgba(10, 132, 255, 0.2)';
        const iconColor = type === 'error' ? '#ff453a' :
            type === 'success' ? '#34c759' :
                'var(--accent)';
        const iconPath = type === 'error' ? '<path d="M12 9v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' :
            type === 'success' ? '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/>' :
                '<path d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>';

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay visible';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-icon" style="background: ${iconBg};">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: ${iconColor};">
                        ${iconPath}
                    </svg>
                </div>
                <p class="modal-message" style="margin: 16px 0;">${message}</p>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-confirm" style="background: var(--accent);">OK</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const okBtn = overlay.querySelector('.modal-btn-confirm');
        const close = () => {
            overlay.remove();
            resolve();
        };
        okBtn.addEventListener('click', close);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) close();
        });
    });
}

// Helper function to show styled confirm modal
function showAppConfirm(message, confirmText = 'Confirm', cancelText = 'Cancel') {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay visible';
        overlay.innerHTML = `
            <div class="modal">
                <div class="modal-icon" style="background: rgba(10, 132, 255, 0.2);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: var(--accent);">
                        <path d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
                    </svg>
                </div>
                <p class="modal-message" style="margin: 16px 0; white-space: pre-line;">${message}</p>
                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-cancel">${cancelText}</button>
                    <button class="modal-btn modal-btn-confirm" style="background: var(--accent);">${confirmText}</button>
                </div>
            </div>
        `;
        document.body.appendChild(overlay);

        const confirmBtn = overlay.querySelector('.modal-btn-confirm');
        const cancelBtn = overlay.querySelector('.modal-btn-cancel');

        confirmBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });
        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        });
    });
}

// Show translate confirmation dialog with source language selector
function showTranslateConfirmDialog(providerName) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay visible';

        // Default to first project language
        const defaultLang = state.projectLanguages[0] || 'en';

        // Build language options
        const languageOptions = state.projectLanguages.map(lang => {
            const flag = languageFlags[lang] || '🏳️';
            const name = languageNames[lang] || lang.toUpperCase();
            const selected = lang === defaultLang ? 'selected' : '';
            return `<option value="${lang}" ${selected}>${flag} ${name}</option>`;
        }).join('');

        // Count texts for each language
        const getTextCount = (lang) => {
            let count = 0;
            state.screenshots.forEach(screenshot => {
                const text = screenshot.text || state.text;
                if (text.headlines?.[lang]?.trim()) count++;
                if (text.subheadlines?.[lang]?.trim()) count++;
            });
            return count;
        };

        const initialCount = getTextCount(defaultLang);
        const targetCount = state.projectLanguages.length - 1;

        overlay.innerHTML = `
            <div class="modal" style="max-width: 380px;">
                <div class="modal-icon" style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #764ba2;">
                        <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6"/>
                    </svg>
                </div>
                <h3 class="modal-title">Translate All Text</h3>
                <p class="modal-message" style="margin-bottom: 16px;">Translate headlines and subheadlines from one language to all other project languages.</p>

                <div style="margin-bottom: 16px;">
                    <label style="display: block; font-size: 12px; color: var(--text-secondary); margin-bottom: 6px;">Source Language</label>
                    <select id="translate-source-lang" style="width: 100%; padding: 10px 12px; background: var(--bg-tertiary); border: 1px solid var(--border); border-radius: 8px; color: var(--text-primary); font-size: 14px; cursor: pointer;">
                        ${languageOptions}
                    </select>
                </div>

                <div style="background: var(--bg-tertiary); border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                        <span style="color: var(--text-secondary);">Texts to translate:</span>
                        <span id="translate-text-count" style="color: var(--text-primary); font-weight: 500;">${initialCount}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px; margin-bottom: 4px;">
                        <span style="color: var(--text-secondary);">Target languages:</span>
                        <span style="color: var(--text-primary); font-weight: 500;">${targetCount}</span>
                    </div>
                    <div style="display: flex; justify-content: space-between; font-size: 13px;">
                        <span style="color: var(--text-secondary);">Provider:</span>
                        <span style="color: var(--text-primary); font-weight: 500;">${providerName}</span>
                    </div>
                </div>

                <div class="modal-buttons">
                    <button class="modal-btn modal-btn-cancel" id="translate-cancel">Cancel</button>
                    <button class="modal-btn modal-btn-confirm" id="translate-confirm" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">Translate</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const select = document.getElementById('translate-source-lang');
        const countEl = document.getElementById('translate-text-count');
        const confirmBtn = document.getElementById('translate-confirm');
        const cancelBtn = document.getElementById('translate-cancel');

        // Update count when language changes
        select.addEventListener('change', () => {
            const count = getTextCount(select.value);
            countEl.textContent = count;
            confirmBtn.disabled = count === 0;
            if (count === 0) {
                confirmBtn.style.opacity = '0.5';
            } else {
                confirmBtn.style.opacity = '1';
            }
        });

        // Initial state
        if (initialCount === 0) {
            confirmBtn.disabled = true;
            confirmBtn.style.opacity = '0.5';
        }

        confirmBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(select.value);
        });

        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            resolve(null);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(null);
            }
        });
    });
}

// Translate all text (headlines + subheadlines) from selected source language to all other project languages
async function translateAllText() {
    if (state.projectLanguages.length < 2) {
        await showAppAlert('Add more languages to your project first (via the language menu).', 'info');
        return;
    }

    // Get selected provider and API key
    const provider = getSelectedProvider();
    const providerConfig = llmProviders[provider];
    const apiKey = localStorage.getItem(providerConfig.storageKey);

    if (!apiKey) {
        await showAppAlert('Add your LLM API key in Settings to use AI translation.', 'error');
        return;
    }

    // Show confirmation dialog with source language selector
    const sourceLang = await showTranslateConfirmDialog(providerConfig.name);
    if (!sourceLang) return; // User cancelled

    const targetLangs = state.projectLanguages.filter(lang => lang !== sourceLang);

    // Collect all texts that need translation
    const textsToTranslate = [];

    // Go through all screenshots and collect headlines/subheadlines
    state.screenshots.forEach((screenshot, index) => {
        const text = screenshot.text || state.text;

        // Headline
        const headline = text.headlines?.[sourceLang] || '';
        if (headline.trim()) {
            textsToTranslate.push({
                type: 'headline',
                screenshotIndex: index,
                text: headline
            });
        }

        // Subheadline
        const subheadline = text.subheadlines?.[sourceLang] || '';
        if (subheadline.trim()) {
            textsToTranslate.push({
                type: 'subheadline',
                screenshotIndex: index,
                text: subheadline
            });
        }
    });

    if (textsToTranslate.length === 0) {
        await showAppAlert(`No text found in ${languageNames[sourceLang] || sourceLang}. Add headlines or subheadlines first.`, 'info');
        return;
    }

    // Create progress dialog with spinner
    const progressOverlay = document.createElement('div');
    progressOverlay.className = 'modal-overlay visible';
    progressOverlay.id = 'translate-progress-overlay';
    progressOverlay.innerHTML = `
        <div class="modal" style="text-align: center; min-width: 320px;">
            <div class="modal-icon" style="background: linear-gradient(135deg, rgba(102, 126, 234, 0.2) 0%, rgba(118, 75, 162, 0.2) 100%);">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color: #764ba2; animation: spin 1s linear infinite;">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
            </div>
            <h3 class="modal-title">Translating...</h3>
            <p class="modal-message" id="translate-progress-text">Sending to AI...</p>
            <p class="modal-message" id="translate-progress-detail" style="font-size: 11px; color: var(--text-tertiary); margin-top: 8px;"></p>
        </div>
        <style>
            @keyframes spin {
                from { transform: rotate(0deg); }
                to { transform: rotate(360deg); }
            }
        </style>
    `;
    document.body.appendChild(progressOverlay);

    const progressText = document.getElementById('translate-progress-text');
    const progressDetail = document.getElementById('translate-progress-detail');

    // Helper to update status
    const updateStatus = (text, detail = '') => {
        if (progressText) progressText.textContent = text;
        if (progressDetail) progressDetail.textContent = detail;
    };

    updateStatus('Sending to AI...', `${textsToTranslate.length} texts to ${targetLangs.length} languages using ${providerConfig.name}`);

    try {
        // Build a single prompt with all texts
        const targetLangNames = targetLangs.map(lang => `${languageNames[lang]} (${lang})`).join(', ');

        // Group texts by screenshot for context-aware prompt
        const screenshotGroups = {};
        textsToTranslate.forEach((item, i) => {
            if (!screenshotGroups[item.screenshotIndex]) {
                screenshotGroups[item.screenshotIndex] = { headline: null, subheadline: null, indices: {} };
            }
            screenshotGroups[item.screenshotIndex][item.type] = item.text;
            screenshotGroups[item.screenshotIndex].indices[item.type] = i;
        });

        // Build context-rich prompt showing screenshot groupings
        let contextualTexts = '';
        Object.keys(screenshotGroups).sort((a, b) => Number(a) - Number(b)).forEach(screenshotIdx => {
            const group = screenshotGroups[screenshotIdx];
            contextualTexts += `\nScreenshot ${Number(screenshotIdx) + 1}:\n`;
            if (group.headline !== null) {
                contextualTexts += `  [${group.indices.headline}] Headline: "${group.headline}"\n`;
            }
            if (group.subheadline !== null) {
                contextualTexts += `  [${group.indices.subheadline}] Subheadline: "${group.subheadline}"\n`;
            }
        });

        const prompt = `You are a professional translator for App Store screenshot marketing copy. Translate the following texts from ${languageNames[sourceLang]} to these languages: ${targetLangNames}.

CONTEXT: These are marketing texts for app store screenshots. Each screenshot has a headline and/or subheadline that work together as a pair. The subheadline typically elaborates on or supports the headline. When translating, ensure:
- Headlines and subheadlines on the same screenshot remain thematically consistent
- Translations across all screenshots maintain a cohesive marketing voice
- SIMILAR LENGTH to the originals - do NOT make translations longer, as they must fit on screen
- Marketing-focused and compelling language
- Culturally appropriate for each target market
- Natural-sounding in each language

IMPORTANT: The translated text will be displayed on app screenshots with limited space. If the source text is short, the translation MUST also be short. Prioritize brevity over literal accuracy.

Source texts (${languageNames[sourceLang]}):
${contextualTexts}

Respond ONLY with a valid JSON object. The structure should be:
{
  "0": {"de": "German translation", "fr": "French translation", ...},
  "1": {"de": "German translation", "fr": "French translation", ...}
}

Where the keys (0, 1, etc.) correspond to the text indices [N] shown above.
Translate to these language codes: ${targetLangs.join(', ')}`;

        let responseText;

        if (provider === 'anthropic') {
            responseText = await translateWithAnthropic(apiKey, prompt);
        } else if (provider === 'openai') {
            responseText = await translateWithOpenAI(apiKey, prompt);
        } else if (provider === 'google') {
            responseText = await translateWithGoogle(apiKey, prompt);
        }

        updateStatus('Processing response...', 'Parsing translations');

        // Clean up response - remove markdown code blocks and extract JSON
        responseText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();

        // Try to extract JSON object if there's extra text
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            responseText = jsonMatch[0];
        }

        console.log('Translation response:', responseText.substring(0, 500) + (responseText.length > 500 ? '...' : ''));

        let translations;
        try {
            translations = JSON.parse(responseText);
        } catch (parseError) {
            console.error('JSON parse error. Response was:', responseText);
            throw new Error('Failed to parse translation response. The AI may have returned incomplete text.');
        }

        updateStatus('Applying translations...', 'Updating screenshots');

        // Apply translations
        let appliedCount = 0;
        textsToTranslate.forEach((item, index) => {
            const itemTranslations = translations[index] || translations[String(index)];
            if (!itemTranslations) return;

            const screenshot = state.screenshots[item.screenshotIndex];
            const text = screenshot.text || state.text;

            targetLangs.forEach(lang => {
                if (itemTranslations[lang]) {
                    if (item.type === 'headline') {
                        if (!text.headlines) text.headlines = {};
                        text.headlines[lang] = itemTranslations[lang];
                    } else {
                        if (!text.subheadlines) text.subheadlines = {};
                        text.subheadlines[lang] = itemTranslations[lang];
                        // Enable subheadline display when translations are added
                        text.subheadlineEnabled = true;
                    }
                    appliedCount++;
                }
            });
        });

        // Update UI
        syncUIWithState();
        updateCanvas();
        saveState();

        // Remove progress overlay
        progressOverlay.remove();

        await showAppAlert(`Successfully translated ${appliedCount} text(s)!`, 'success');

    } catch (error) {
        console.error('Translation error:', error);
        progressOverlay.remove();

        if (error.message === 'Failed to fetch') {
            await showAppAlert('Connection failed. Check your API key in Settings.', 'error');
        } else if (error.message === 'AI_UNAVAILABLE' || error.message.includes('401') || error.message.includes('403')) {
            await showAppAlert('Invalid API key. Update it in Settings (gear icon).', 'error');
        } else {
            await showAppAlert('Translation failed: ' + error.message, 'error');
        }
    }
}

// Provider-specific translation functions
async function translateWithAnthropic(apiKey, prompt) {
    const model = getSelectedModel('anthropic');
    const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
        },
        body: JSON.stringify({
            model: model,
            max_tokens: 4096,
            messages: [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

async function translateWithOpenAI(apiKey, prompt) {
    const model = getSelectedModel('openai');
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model: model,
            max_completion_tokens: 16384,
            messages: [{ role: "user", content: prompt }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        const errorBody = await response.json().catch(() => ({}));
        console.error('OpenAI API Error:', {
            status,
            model,
            error: errorBody
        });
        if (status === 401 || status === 403) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status} - ${errorBody.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

async function translateWithGoogle(apiKey, prompt) {
    const model = getSelectedModel('google');
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }]
        })
    });

    if (!response.ok) {
        const status = response.status;
        if (status === 401 || status === 403 || status === 400) throw new Error('AI_UNAVAILABLE');
        throw new Error(`API request failed: ${status}`);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

function setTranslateStatus(message, type) {
    const status = document.getElementById('ai-translate-status');
    status.textContent = message;
    status.className = 'ai-translate-status' + (type ? ' ' + type : '');
}

// Settings modal functions
// LLM configuration is in llm.js (llmProviders, getSelectedModel, getSelectedProvider)

// Theme management
function applyTheme(preference) {
    if (preference === 'light' || preference === 'dark') {
        document.documentElement.dataset.theme = preference;
    } else {
        delete document.documentElement.dataset.theme;
    }
}

function initTheme() {
    const saved = localStorage.getItem('themePreference') || 'auto';
    applyTheme(saved);
}

// Apply theme immediately (before async init)
initTheme();

// ===== Stored-image compression (settings modal) =====

function formatBytes(n) {
    if (!isFinite(n) || n <= 0) return '0 MB';
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
    return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

function setOptimizeStatus(msg, cls) {
    const el = document.getElementById('optimize-images-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'settings-key-status' + (cls ? ' ' + cls : '');
}

// "N images · 214.3 MB" for the open project, so the setting above it has a
// number to argue with.
async function refreshStorageReadout() {
    const el = document.getElementById('settings-storage-readout');
    if (!el) return;
    if (!RemoteStore.enabled()) { el.textContent = 'No server connected'; return; }
    el.textContent = 'Measuring…';
    const s = await RemoteStore.storage(currentProjectId);
    if (!s) { el.textContent = 'Unavailable (server too old?)'; return; }
    el.textContent = s.images + ' image' + (s.images === 1 ? '' : 's') + ' · ' + formatBytes(s.bytes)
        + (s.missing ? ' · ' + s.missing + ' missing' : '');
}

// Re-encode the images ALREADY stored on the server. Everything happens
// server-side (the browser never downloads the originals) — it rewrites each
// project's refs to the new blobs and the usual GC reclaims the old bytes.
async function optimizeStoredImages(scope) {
    const btn = document.getElementById('optimize-images-btn');
    const allBtn = document.getElementById('optimize-images-all-btn');
    if (!RemoteStore.enabled()) {
        setOptimizeStatus('Connect an MCP server first — it is where the images live.', 'error');
        return;
    }
    const cfg = readImageOptSettingsFromUI();
    const targets = scope === 'all'
        ? projects.map(p => p.id)
        : [currentProjectId];
    const label = scope === 'all'
        ? 'all ' + targets.length + ' project' + (targets.length === 1 ? '' : 's')
        : 'this project';
    const ok = await showAppConfirm(
        'Re-encode the images of ' + label + ' at ' + Math.round(cfg.quality * 100) + '% quality'
        + (cfg.maxEdge ? ', capped at ' + cfg.maxEdge + ' px' : '')
        + '? Images are replaced by smaller versions — this cannot be undone.',
        'Optimize', 'Cancel');
    if (!ok) return;

    if (btn) btn.disabled = true;
    if (allBtn) allBtn.disabled = true;
    // The open project must be fully on the server before we ask the server to
    // rewrite it, or the push that lands afterwards would carry the old images
    // back up.
    showUploadProgress('Optimisation des images…', 'Enregistrement des modifications en cours…');
    try {
        saveState();
        await waitForServerConfirmation(currentProjectId);

        const opts = {
            quality: Math.round(cfg.quality * 100),
            // A browser that can't encode WebP can't decode it either, so don't
            // let the server rewrite this user's images into a format they
            // wouldn't be able to open.
            format: (cfg.format === 'jpeg' || !canEncodeWebP()) ? 'jpeg' : 'webp',
            maxEdge: cfg.maxEdge || 0,
        };
        let before = 0, after = 0, rewritten = 0, images = 0, failed = 0;
        const errors = [];
        for (let i = 0; i < targets.length; i++) {
            const meta = projects.find(p => p.id === targets[i]);
            showUploadProgress('Optimisation des images…',
                (targets.length > 1 ? '(' + (i + 1) + '/' + targets.length + ') ' : '') + (meta ? meta.name : targets[i]));
            const res = await RemoteStore.optimizeImages(targets[i], opts);
            if (!res || res.error) {
                errors.push((meta ? meta.name : targets[i]) + ': '
                    + (res && res.error === 'unsupported' ? 'server too old for this feature' : (res && res.error) || 'failed'));
                continue;
            }
            before += res.beforeBytes || 0;
            after += res.afterBytes || 0;
            rewritten += res.rewritten || 0;
            images += res.images || 0;
            failed += res.failed || 0;
        }

        // The server rewrote the record under us — take its version.
        if (rewritten) await reloadProjectFromServer(currentProjectId);

        const saved = Math.max(0, before - after);
        const pct = before > 0 ? Math.round((saved / before) * 100) : 0;
        const errorText = errors.slice(0, 3).join(' · ') + (errors.length > 3 ? ' · +' + (errors.length - 3) + ' more' : '');
        if (errors.length && !rewritten) {
            setOptimizeStatus(errorText, 'error');
        } else {
            setOptimizeStatus(
                rewritten
                    ? '✓ ' + rewritten + '/' + images + ' image' + (images === 1 ? '' : 's') + ' re-encoded — '
                      + formatBytes(before) + ' → ' + formatBytes(after) + ' (−' + pct + '%)'
                      + (failed ? ' · ' + failed + ' skipped (unreadable)' : '')
                      + (errors.length ? ' · ' + errorText : '')
                    : 'Already optimal — nothing to re-encode.',
                errors.length ? 'error' : 'success');
        }
        await refreshStorageReadout();
    } catch (e) {
        setOptimizeStatus('Failed: ' + (e && e.message || e), 'error');
    } finally {
        hideUploadProgress();
        if (btn) btn.disabled = false;
        if (allBtn) allBtn.disabled = false;
    }
}

function readImageOptSettingsFromUI() {
    const q = parseFloat(document.getElementById('settings-image-quality')?.value);
    const m = parseInt(document.getElementById('settings-image-maxedge')?.value, 10);
    const f = document.getElementById('settings-image-format')?.value;
    const d = getImageOptSettings();
    return {
        quality: isFinite(q) ? q : d.quality,
        maxEdge: isFinite(m) ? m : d.maxEdge,
        format: f || d.format,
    };
}

function openSettingsModal() {
    // Load saved provider
    const savedProvider = getSelectedProvider();
    document.querySelectorAll('input[name="ai-provider"]').forEach(radio => {
        radio.checked = radio.value === savedProvider;
    });

    // Show the correct API section
    updateProviderSection(savedProvider);

    // Load all saved API keys and models
    Object.entries(llmProviders).forEach(([provider, config]) => {
        const savedKey = localStorage.getItem(config.storageKey);
        const input = document.getElementById(`settings-api-key-${provider}`);
        if (input) {
            input.value = savedKey || '';
            input.type = 'password';
        }

        const status = document.getElementById(`settings-key-status-${provider}`);
        if (status) {
            if (savedKey) {
                status.textContent = '✓ API key is saved';
                status.className = 'settings-key-status success';
            } else {
                status.textContent = '';
                status.className = 'settings-key-status';
            }
        }

        // Populate and load saved model selection
        const modelSelect = document.getElementById(`settings-model-${provider}`);
        if (modelSelect) {
            // Populate options from llm.js config
            modelSelect.innerHTML = generateModelOptions(provider);
            // Set saved value
            const savedModel = localStorage.getItem(config.modelStorageKey) || config.defaultModel;
            modelSelect.value = savedModel;
        }
    });

    // Load saved theme preference
    const savedTheme = localStorage.getItem('themePreference') || 'auto';
    document.querySelectorAll('#theme-selector button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.theme === savedTheme);
    });

    // Load saved MCP server config and reflect last known connection state
    const mcpUrlInput = document.getElementById('settings-mcp-url');
    const mcpTokenInput = document.getElementById('settings-mcp-token');
    let savedMcpUrl = localStorage.getItem('mcpServerUrl');
    // Self-heal a stale saved URL (e.g. https://host:3000/mcp from before the fix).
    if (savedMcpUrl) {
        const fixed = normalizeMcpUrl(savedMcpUrl);
        if (fixed !== savedMcpUrl) {
            savedMcpUrl = fixed;
            localStorage.setItem('mcpServerUrl', fixed);
        }
    }
    if (mcpUrlInput) mcpUrlInput.value = savedMcpUrl || defaultMcpUrl();
    if (mcpTokenInput) {
        mcpTokenInput.value = localStorage.getItem('mcpServerToken') || '';
        mcpTokenInput.type = 'password';
    }
    if (mcpState && mcpState.connected) {
        setMcpStatus('connected', `Connected to ${mcpState.info} · ${mcpState.tools.length} tools`);
        renderMcpTools(mcpState.tools);
    } else {
        setMcpStatus('', savedMcpUrl ? 'Saved — click Connect to test.' : 'Auto-detected from this page — click Connect.');
        const toolsEl = document.getElementById('mcp-tools-list');
        if (toolsEl) toolsEl.innerHTML = '';
    }

    // Image compression preferences (+ what the open project currently weighs)
    const imgCfg = getImageOptSettings();
    const pick = (id, value, fallback) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.value = String(value);
        if (!sel.value) sel.value = String(fallback); // stored value isn't an option anymore
    };
    pick('settings-image-quality', imgCfg.quality, IMAGE_OPT_DEFAULTS.quality);
    pick('settings-image-maxedge', imgCfg.maxEdge, IMAGE_OPT_DEFAULTS.maxEdge);
    pick('settings-image-format', imgCfg.format, IMAGE_OPT_DEFAULTS.format);
    setOptimizeStatus('');
    refreshStorageReadout();

    document.getElementById('settings-modal').classList.add('visible');
}

function updateProviderSection(provider) {
    document.querySelectorAll('.settings-api-section').forEach(section => {
        section.style.display = section.dataset.provider === provider ? 'block' : 'none';
    });
}

function saveSettings() {
    // Save theme preference
    const activeThemeBtn = document.querySelector('#theme-selector button.active');
    const themePreference = activeThemeBtn ? activeThemeBtn.dataset.theme : 'auto';
    localStorage.setItem('themePreference', themePreference);
    applyTheme(themePreference);

    // Save selected provider
    const selectedProvider = document.querySelector('input[name="ai-provider"]:checked').value;
    localStorage.setItem('aiProvider', selectedProvider);

    // Save MCP server config
    const mcpUrl = normalizeMcpUrl((document.getElementById('settings-mcp-url')?.value || '').trim());
    const mcpToken = (document.getElementById('settings-mcp-token')?.value || '').trim();
    if (mcpUrl) localStorage.setItem('mcpServerUrl', mcpUrl); else localStorage.removeItem('mcpServerUrl');
    if (mcpToken) localStorage.setItem('mcpServerToken', mcpToken); else localStorage.removeItem('mcpServerToken');

    // Image compression preferences (applied to every image imported from now on)
    const imgCfg = readImageOptSettingsFromUI();
    localStorage.setItem('imageQuality', String(imgCfg.quality));
    localStorage.setItem('imageMaxEdge', String(imgCfg.maxEdge));
    localStorage.setItem('imageFormat', imgCfg.format);

    // Save all API keys and models
    let allValid = true;
    Object.entries(llmProviders).forEach(([provider, config]) => {
        const input = document.getElementById(`settings-api-key-${provider}`);
        const status = document.getElementById(`settings-key-status-${provider}`);
        if (!input || !status) return;

        const key = input.value.trim();

        if (key) {
            // Validate key format
            if (key.startsWith(config.keyPrefix)) {
                localStorage.setItem(config.storageKey, key);
                status.textContent = '✓ API key saved';
                status.className = 'settings-key-status success';
            } else {
                status.textContent = `Invalid format. Should start with ${config.keyPrefix}...`;
                status.className = 'settings-key-status error';
                if (provider === selectedProvider) allValid = false;
            }
        } else {
            localStorage.removeItem(config.storageKey);
            status.textContent = '';
            status.className = 'settings-key-status';
        }

        // Save model selection
        const modelSelect = document.getElementById(`settings-model-${provider}`);
        if (modelSelect) {
            localStorage.setItem(config.modelStorageKey, modelSelect.value);
        }
    });

    if (allValid) {
        setTimeout(() => {
            document.getElementById('settings-modal').classList.remove('visible');
        }, 500);
    }
}

// ===== MCP server connection (browser MCP client over Streamable HTTP) =====

// Last known connection state (runtime only).
let mcpState = { connected: false, tools: [], url: '', info: '' };

// Derive a sensible default MCP server URL from the page's own origin:
//  - Served over HTTPS (production / Cloudflare Tunnel / reverse proxy): assume the
//    server sits behind the same origin on the standard port → https://<host>/mcp
//    (no :3000 — Cloudflare doesn't proxy port 3000 anyway).
//  - Served over HTTP (local dev / LAN, e.g. http://192.168.x.x:8000): the server's
//    default port is 3000 → http://<host>:3000/mcp
// Falls back to localhost for file:// or when the host can't be determined.
function defaultMcpUrl() {
    try {
        const loc = window.location;
        const host = loc.hostname;
        if (host) {
            if (loc.protocol === 'https:') {
                return `https://${host}/mcp`;
            }
            return `http://${host}:3000/mcp`;
        }
    } catch (e) { /* ignore */ }
    return 'http://localhost:3000/mcp';
}

// Auto-correct a known-broken MCP URL: HTTPS on port 3000 is never a real
// deployment (3000 is a dev HTTP port, and Cloudflare won't proxy it) — drop the
// port so it targets 443. Leaves everything else untouched. Used on display and
// on input so a stale saved value like https://host:3000/mcp self-heals.
function normalizeMcpUrl(url) {
    if (!url) return url;
    try {
        const u = new URL(url);
        if (u.protocol === 'https:' && u.port === '3000') {
            u.port = '';
            return u.toString();
        }
    } catch (e) { /* not a URL — leave as typed */ }
    return url;
}

function mcpEscapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

// Parse a JSON-RPC reply that may come back as plain JSON or as an SSE stream
// (event: message\n data: {...}). Returns the parsed message object.
function mcpParseResponse(text) {
    const trimmed = text.trim();
    if (trimmed.startsWith('{')) return JSON.parse(trimmed);
    let last = null;
    for (const line of trimmed.split(/\r?\n/)) {
        const m = line.match(/^data:\s?(.*)$/);
        if (m && m[1]) {
            try { last = JSON.parse(m[1]); } catch (e) { /* ignore non-JSON data lines */ }
        }
    }
    if (!last) throw new Error('Could not parse server response.');
    return last;
}

async function mcpRpc(url, token, method, params) {
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream'
    };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params || {} })
    });
    if (!res.ok) {
        let detail = '';
        try { detail = (await res.text()).slice(0, 200); } catch (e) {}
        throw new Error(`HTTP ${res.status}` + (detail ? ` — ${detail}` : ''));
    }
    const msg = mcpParseResponse(await res.text());
    if (msg.error) throw new Error(msg.error.message || JSON.stringify(msg.error));
    return msg.result;
}

function setMcpStatus(state, msg) {
    const dot = document.getElementById('mcp-status-dot');
    const status = document.getElementById('mcp-connection-status');
    if (dot) {
        dot.className = 'mcp-status-dot' + (state ? ' ' + state : '');
        dot.title = msg || (state || 'Not connected');
    }
    if (status) {
        status.textContent = msg || '';
        const cls = state === 'connected' ? ' success'
            : state === 'error' ? ' error'
            : state === 'connecting' ? ' connecting' : '';
        status.className = 'settings-key-status' + cls;
    }
}

function renderMcpTools(tools) {
    const el = document.getElementById('mcp-tools-list');
    if (!el) return;
    el.innerHTML = (tools || []).map(t => `
        <div class="mcp-tool-item">
            <div class="mcp-tool-name">${mcpEscapeHtml(t.name)}</div>
            ${t.description ? `<div class="mcp-tool-desc">${mcpEscapeHtml(t.description)}</div>` : ''}
        </div>`).join('');
}

// Initiate the MCP connection: handshake + list tools.
// opts.silent: don't show a scary error if it fails (used for auto-connect to an
// auto-detected server that may not exist).
async function connectMcpServer(url, token, opts = {}) {
    const toolsEl = document.getElementById('mcp-tools-list');
    if (!url) {
        if (!opts.silent) setMcpStatus('error', 'Enter a server URL first.');
        return;
    }
    setMcpStatus('connecting', 'Connecting…');
    if (toolsEl) toolsEl.innerHTML = '';
    try {
        const init = await mcpRpc(url, token, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'appscreen-web', version: '1.0.0' }
        });
        const info = init && init.serverInfo
            ? `${init.serverInfo.name} v${init.serverInfo.version}`
            : 'server';
        const list = await mcpRpc(url, token, 'tools/list', {});
        const tools = (list && list.tools) || [];
        mcpState = { connected: true, tools, url, info };
        setMcpStatus('connected', `Connected to ${info} · ${tools.length} tools`);
        renderMcpTools(tools);
        // Now that a server is connected, load its project list (the only store)
        // and refresh the selector.
        syncWithRemote().then(() => updateProjectSelector()).catch(() => {});
    } catch (e) {
        mcpState = { connected: false, tools: [], url, info: '' };
        if (opts.silent) {
            setMcpStatus('', 'Not connected');
            return;
        }
        let hint = String((e && e.message) || e);
        if (/Failed to fetch|NetworkError|load failed/i.test(hint)) {
            hint = 'Could not reach the server. Check the URL, that the server is running, and CORS / mixed content (an HTTPS page cannot call an http:// server except on localhost).';
        }
        setMcpStatus('error', hint);
    }
}

// Helper function to set text value for current screenshot
function setTextValue(key, value) {
    setTextSetting(key, value);
}

function setTextLanguageValue(key, value, lang = null) {
    const text = getTextSettings();
    if (!text.perLanguageLayout) {
        // Global mode - write directly to text
        text[key] = value;
        return;
    }
    const targetLang = lang || getTextLayoutLanguage(text);
    const settings = getTextLanguageSettings(text, targetLang);
    settings[key] = value;
    text.currentLayoutLang = targetLang;
}

// Helper function to get text settings for current screenshot
function getTextSettings() {
    return getText();
}

// Load text UI from current screenshot's settings
function loadTextUIFromScreenshot() {
    updateTextUI(getText());
}

// Load text UI from default settings
function loadTextUIFromGlobal() {
    updateTextUI(state.defaults.text);
}

// ===== Text zone (auto-fit rectangle) =====
// The zone lives on the container text (like autoFit) so it applies to the whole
// screen's text block, including every panorama panel.
function getTextZone() {
    try {
        const t = (typeof getContainerText === 'function') ? getContainerText() : null;
        return (t && t.textZone) ? t.textZone : null;
    } catch (e) { return null; }
}

// Keep the zone rectangle inside the canvas: clamp size, then position so the box
// always stays fully on-screen.
function clampTextZone(z) {
    z.width = Math.max(5, Math.min(100, z.width));
    z.height = Math.max(5, Math.min(100, z.height));
    z.x = Math.max(0, Math.min(100 - z.width, z.x));
    z.y = Math.max(0, Math.min(100 - z.height, z.y));
}

function isTextTabActive() {
    const tab = document.getElementById('tab-text');
    return !!(tab && tab.classList.contains('active'));
}

// Sync the toggle, sliders and the on-canvas overlay with the current zone state.
function updateTextZoneUI() {
    const z = getTextZone();
    const toggle = document.getElementById('text-zone-toggle');
    const controls = document.getElementById('text-zone-controls');
    const overlay = document.getElementById('text-zone-overlay');
    if (!toggle || !z) return;
    const enabled = !!z.enabled;
    toggle.classList.toggle('active', enabled);
    if (controls) controls.style.display = enabled ? '' : 'none';

    const uniformToggle = document.getElementById('text-zone-uniform-toggle');
    if (uniformToggle) uniformToggle.classList.toggle('active', z.uniform !== false);

    const fillToggle = document.getElementById('text-zone-fill-toggle');
    if (fillToggle) fillToggle.classList.toggle('active', !!z.fill);

    const setSlider = (id, val) => {
        const s = document.getElementById(id);
        const v = document.getElementById(id + '-value');
        if (s) s.value = Math.round(val);
        if (v) v.textContent = Math.round(val) + '%';
    };
    setSlider('text-zone-x', z.x);
    setSlider('text-zone-y', z.y);
    setSlider('text-zone-w', z.width);
    setSlider('text-zone-h', z.height);

    if (overlay) {
        const show = enabled && isTextTabActive() && state.screenshots.length > 0;
        overlay.style.display = show ? '' : 'none';
        if (show) {
            overlay.style.left = z.x + '%';
            overlay.style.top = z.y + '%';
            overlay.style.width = z.width + '%';
            overlay.style.height = z.height + '%';
        }
    }
}

function setupTextZoneControls() {
    const toggle = document.getElementById('text-zone-toggle');
    if (!toggle) return;

    toggle.addEventListener('click', () => {
        const z = getTextZone();
        if (!z) return;
        z.enabled = !z.enabled;
        updateTextZoneUI();
        updateCanvas();
    });

    const uniformToggle = document.getElementById('text-zone-uniform-toggle');
    if (uniformToggle) {
        uniformToggle.addEventListener('click', () => {
            const z = getTextZone();
            if (!z) return;
            z.uniform = (z.uniform === false); // toggle (undefined counts as on)
            updateTextZoneUI();
            updateCanvas();
        });
    }

    const fillToggle = document.getElementById('text-zone-fill-toggle');
    if (fillToggle) {
        fillToggle.addEventListener('click', () => {
            const z = getTextZone();
            if (!z) return;
            z.fill = !z.fill;
            updateTextZoneUI();
            updateCanvas();
        });
    }

    const bindSlider = (id, key) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', (e) => {
            const z = getTextZone();
            if (!z) return;
            z[key] = parseInt(e.target.value, 10) || 0;
            clampTextZone(z);
            updateTextZoneUI();
            updateCanvas();
        });
    };
    bindSlider('text-zone-x', 'x');
    bindSlider('text-zone-y', 'y');
    bindSlider('text-zone-w', 'width');
    bindSlider('text-zone-h', 'height');

    setupTextZoneOverlayDrag();
}

// Drag to move and corner-handles to resize the zone directly on the preview.
function setupTextZoneOverlayDrag() {
    const overlay = document.getElementById('text-zone-overlay');
    const wrapper = document.getElementById('canvas-wrapper');
    if (!overlay || !wrapper) return;

    let mode = null;       // 'move' | 'nw' | 'ne' | 'sw' | 'se'
    let startRect = null;  // wrapper bounds at drag start
    let startPt = null;    // pointer start {x, y}
    let startZone = null;  // zone snapshot at drag start

    const onMove = (e) => {
        const z = getTextZone();
        if (!mode || !z || !startRect) return;
        const dxPct = ((e.clientX - startPt.x) / startRect.width) * 100;
        const dyPct = ((e.clientY - startPt.y) / startRect.height) * 100;
        if (mode === 'move') {
            z.x = startZone.x + dxPct;
            z.y = startZone.y + dyPct;
        } else {
            let left = startZone.x;
            let top = startZone.y;
            let right = startZone.x + startZone.width;
            let bottom = startZone.y + startZone.height;
            if (mode.includes('w')) left = startZone.x + dxPct;
            if (mode.includes('e')) right = startZone.x + startZone.width + dxPct;
            if (mode.includes('n')) top = startZone.y + dyPct;
            if (mode.includes('s')) bottom = startZone.y + startZone.height + dyPct;
            const MIN = 5;
            if (right - left < MIN) { if (mode.includes('w')) left = right - MIN; else right = left + MIN; }
            if (bottom - top < MIN) { if (mode.includes('n')) top = bottom - MIN; else bottom = top + MIN; }
            z.x = left; z.y = top; z.width = right - left; z.height = bottom - top;
        }
        clampTextZone(z);
        updateTextZoneUI();
        updateCanvas();
        e.preventDefault();
    };

    const onUp = () => {
        if (!mode) return;
        mode = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
    };

    const start = (e, m) => {
        const z = getTextZone();
        if (!z || !z.enabled) return;
        mode = m;
        startRect = wrapper.getBoundingClientRect();
        startPt = { x: e.clientX, y: e.clientY };
        startZone = { x: z.x, y: z.y, width: z.width, height: z.height };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        e.preventDefault();
        e.stopPropagation();
    };

    overlay.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('tz-handle')) return; // handled below
        start(e, 'move');
    });
    overlay.querySelectorAll('.tz-handle').forEach((h) => {
        h.addEventListener('pointerdown', (e) => start(e, h.dataset.handle));
    });
}

// Update all text UI elements
function updateTextUI(text) {
    const headlineLang = text.currentHeadlineLang || 'en';
    const subheadlineLang = text.currentSubheadlineLang || 'en';
    const layoutLang = getTextLayoutLanguage(text);
    const headlineLayout = getEffectiveLayout(text, headlineLang);
    const subheadlineLayout = getEffectiveLayout(text, subheadlineLang);
    const layoutSettings = getEffectiveLayout(text, layoutLang);
    const headlineText = text.headlines ? (text.headlines[headlineLang] || '') : (text.headline || '');
    const subheadlineText = text.subheadlines ? (text.subheadlines[subheadlineLang] || '') : (text.subheadline || '');

    document.getElementById('headline-text').value = headlineText;
    document.getElementById('headline-font').value = text.headlineFont;
    updateFontPickerPreview();
    document.getElementById('headline-size').value = headlineLayout.headlineSize;
    document.getElementById('headline-color').value = text.headlineColor;
    document.getElementById('headline-weight').value = text.headlineWeight;
    // Sync text style buttons
    document.querySelectorAll('#headline-style button').forEach(btn => {
        const style = btn.dataset.style;
        const key = 'headline' + style.charAt(0).toUpperCase() + style.slice(1);
        btn.classList.toggle('active', text[key] || false);
    });
    document.querySelectorAll('#text-position button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.position === layoutSettings.position);
    });
    document.getElementById('text-offset-y').value = layoutSettings.offsetY;
    document.getElementById('text-offset-y-value').textContent = formatValue(layoutSettings.offsetY) + '%';
    document.getElementById('line-height').value = layoutSettings.lineHeight;
    document.getElementById('line-height-value').textContent = formatValue(layoutSettings.lineHeight) + '%';
    document.getElementById('subheadline-text').value = subheadlineText;
    document.getElementById('subheadline-font').value = text.subheadlineFont || text.headlineFont;
    document.getElementById('subheadline-size').value = subheadlineLayout.subheadlineSize;
    document.getElementById('subheadline-color').value = text.subheadlineColor;
    document.getElementById('subheadline-opacity').value = text.subheadlineOpacity;
    document.getElementById('subheadline-opacity-value').textContent = formatValue(text.subheadlineOpacity) + '%';
    document.getElementById('subheadline-weight').value = text.subheadlineWeight || '400';
    // Sync subheadline style buttons
    document.querySelectorAll('#subheadline-style button').forEach(btn => {
        const style = btn.dataset.style;
        const key = 'subheadline' + style.charAt(0).toUpperCase() + style.slice(1);
        btn.classList.toggle('active', text[key] || false);
    });

    // Text zone toggle/sliders/overlay
    if (typeof updateTextZoneUI === 'function') updateTextZoneUI();
}

function applyPositionPreset(preset) {
    const presets = {
        'centered': { scale: 70, x: 50, y: 50, rotation: 0, perspective: 0 },
        'bleed-bottom': { scale: 85, x: 50, y: 120, rotation: 0, perspective: 0 },
        'bleed-top': { scale: 85, x: 50, y: -20, rotation: 0, perspective: 0 },
        'float-center': { scale: 60, x: 50, y: 50, rotation: 0, perspective: 0 },
        'tilt-left': { scale: 65, x: 50, y: 60, rotation: -8, perspective: 0 },
        'tilt-right': { scale: 65, x: 50, y: 60, rotation: 8, perspective: 0 },
        'perspective': { scale: 65, x: 50, y: 50, rotation: 0, perspective: 15 },
        'float-bottom': { scale: 55, x: 50, y: 70, rotation: 0, perspective: 0 },
        // Trending App Store layouts
        'hero': { scale: 88, x: 50, y: 66, rotation: 0, perspective: 0 },          // big device, headline on top
        'showcase-bottom': { scale: 82, x: 50, y: 135, rotation: 0, perspective: 0 }, // headline top, device bleeds off bottom
        'showcase-top': { scale: 82, x: 50, y: -35, rotation: 0, perspective: 0 },    // headline bottom, device bleeds off top
        'tilt-left-strong': { scale: 62, x: 50, y: 62, rotation: -14, perspective: 0 },
        'tilt-right-strong': { scale: 62, x: 50, y: 62, rotation: 14, perspective: 0 },
        'perspective-left': { scale: 65, x: 50, y: 50, rotation: 0, perspective: -15 },
        'minimal': { scale: 48, x: 50, y: 52, rotation: 0, perspective: 0 },          // small, lots of negative space
        'full-bleed': { scale: 100, x: 50, y: 50, rotation: 0, perspective: 0 }       // device fills the frame
    };

    const p = presets[preset];
    if (!p) return;

    setScreenshotSetting('scale', p.scale);
    setScreenshotSetting('x', p.x);
    setScreenshotSetting('y', p.y);
    setScreenshotSetting('rotation', p.rotation);
    setScreenshotSetting('perspective', p.perspective);

    // Update UI controls
    document.getElementById('screenshot-scale').value = p.scale;
    document.getElementById('screenshot-scale-value').textContent = formatValue(p.scale) + '%';
    document.getElementById('screenshot-x').value = p.x;
    document.getElementById('screenshot-x-value').textContent = formatValue(p.x) + '%';
    document.getElementById('screenshot-y').value = p.y;
    document.getElementById('screenshot-y-value').textContent = formatValue(p.y) + '%';
    document.getElementById('screenshot-rotation').value = p.rotation;
    document.getElementById('screenshot-rotation-value').textContent = formatValue(p.rotation) + '°';

    updateCanvas();
}

function handleFiles(files) {
    // Process files sequentially to handle duplicates one at a time
    processFilesSequentially(Array.from(files).filter(f => f.type.startsWith('image/')));
}

// Handle files from desktop app (receives array of {dataUrl, name})
function handleFilesFromDesktop(filesData) {
    processDesktopFilesSequentially(filesData);
}

async function processDesktopFilesSequentially(filesData) {
    if (!filesData.length) return;
    showUploadProgress('Import des images…', '');
    try {
        for (let i = 0; i < filesData.length; i++) {
            showUploadProgress('Import des images… (' + (i + 1) + '/' + filesData.length + ')', filesData[i].name || '');
            await processDesktopImageFile(filesData[i]);
        }
        showUploadProgress('Enregistrement sur le serveur…', '');
        saveState();
        await waitForServerConfirmation(currentProjectId);
    } finally {
        hideUploadProgress();
    }
    await reportImportFailures();
}

// Import screenshots via Tauri native file dialog
async function importScreenshotsFromTauri() {
    if (!window.__TAURI__) return;
    try {
        const selected = await window.__TAURI__.dialog.open({
            multiple: true,
            filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }]
        });
        if (!selected) return;
        const paths = Array.isArray(selected) ? selected : [selected];
        for (const filePath of paths) {
            const bytes = await window.__TAURI__.fs.readFile(filePath);
            const blob = new Blob([bytes]);
            const dataUrl = await new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
            const name = filePath.split(/[\\/]/).pop();
            await handleFilesFromDesktop([{ dataUrl, name }]);
        }
    } catch (err) {
        console.error('Tauri import error:', err);
    }
}

async function processDesktopImageFile(fileData) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = async () => {
            // Detect device type based on aspect ratio. Watch panels are tiny
            // (the largest is 422x514) and their ratio overlaps the iPad's, so
            // size has to be checked before the ratio.
            const ratio = img.width / img.height;
            let deviceType = 'iPhone';
            if (Math.max(img.width, img.height) <= 560) {
                deviceType = 'Apple Watch';
            } else if (ratio > 0.6) {
                deviceType = 'iPad';
            }

            // Compress before the image enters the project (see processImageFile).
            const optimized = await optimizeImportedImage(fileData.dataUrl);
            const useImg = optimized ? optimized.image : img;
            const useSrc = optimized ? optimized.src : fileData.dataUrl;

            // Detect language from filename
            const detectedLang = detectLanguageFromFilename(fileData.name);

            // Check if this is a localized version of an existing screenshot
            const existingIndex = findScreenshotByBaseFilename(fileData.name);

            if (existingIndex !== -1) {
                // Found a screenshot with matching base filename
                const existingScreenshot = state.screenshots[existingIndex];
                const hasExistingLangImage = existingScreenshot.localizedImages?.[detectedLang]?.src;

                if (hasExistingLangImage) {
                    // There's already an image for this language - show dialog
                    const choice = await showDuplicateDialog({
                        existingIndex: existingIndex,
                        detectedLang: detectedLang,
                        newImage: useImg,
                        newSrc: useSrc,
                        newName: fileData.name
                    });

                    if (choice === 'replace') {
                        addLocalizedImage(existingIndex, detectedLang, useImg, useSrc, fileData.name);
                    } else if (choice === 'create') {
                        createNewScreenshot(useImg, useSrc, fileData.name, detectedLang, deviceType);
                    }
                } else {
                    // No image for this language yet - just add it silently
                    addLocalizedImage(existingIndex, detectedLang, useImg, useSrc, fileData.name);
                }
            } else {
                createNewScreenshot(useImg, useSrc, fileData.name, detectedLang, deviceType);
            }

            // Update 3D texture if in 3D mode
            const ss = getScreenshotSettings();
            if (ss.use3D && typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            updateCanvas();
            resolve();
        };
        // Same decode-failure guard as processImageFile: never hang the batch.
        img.onerror = () => {
            _importFailures.push(fileData.name || 'image');
            resolve();
        };
        img.src = fileData.dataUrl;
    });
}

// Files whose import failed (unreadable / undecodable — e.g. HEIC in some
// browsers). Collected per batch and surfaced: a file that never made it into
// the project must NEVER fail silently.
let _importFailures = [];

async function reportImportFailures() {
    if (!_importFailures.length) return;
    const list = _importFailures.slice();
    _importFailures = [];
    const msg = list.length === 1
        ? 'Ce fichier n’a pas pu être importé (format non supporté ?) : ' + list[0]
        : list.length + ' fichiers n’ont pas pu être importés (format non supporté ?) : ' + list.join(', ');
    console.warn('Import failures:', list);
    if (typeof showAppAlert === 'function') await showAppAlert(msg, 'error');
}

async function processFilesSequentially(files) {
    if (!files.length) return;
    showUploadProgress('Import des images…', '');
    try {
        for (let i = 0; i < files.length; i++) {
            showUploadProgress('Import des images… (' + (i + 1) + '/' + files.length + ')', files[i].name);
            await processImageFile(files[i]);
        }
        // The upload is only DONE once the server confirmed it — flush the
        // debounced save/push and keep the user waiting until the response.
        showUploadProgress('Enregistrement sur le serveur…', '');
        saveState();
        const ok = await waitForServerConfirmation(currentProjectId);
        if (!ok && RemoteStore.enabled() && !RemoteStore._lastPutConflict) {
            if (typeof showAppAlert === 'function') {
                await showAppAlert('L’envoi au serveur a échoué — nouvelle tentative automatique en arrière-plan.', 'error');
            }
        }
    } finally {
        hideUploadProgress();
    }
    await reportImportFailures();
}

async function processImageFile(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
                // Detect device type based on aspect ratio. Watch panels are
                // tiny (the largest is 422x514) and their ratio overlaps the
                // iPad's, so size has to be checked before the ratio.
                const ratio = img.width / img.height;
                let deviceType = 'iPhone';
                if (Math.max(img.width, img.height) <= 560) {
                    deviceType = 'Apple Watch';
                } else if (ratio > 0.6) {
                    deviceType = 'iPad';
                }

                // Compress BEFORE the image enters the project, so the editor
                // holds — and later uploads — the small version, not the
                // multi-megabyte original. Falls back to the original untouched.
                const optimized = await optimizeImportedImage(e.target.result);
                const useImg = optimized ? optimized.image : img;
                const useSrc = optimized ? optimized.src : e.target.result;

                // Detect language from filename
                const detectedLang = detectLanguageFromFilename(file.name);

                // Check if this is a localized version of an existing screenshot
                const existingIndex = findScreenshotByBaseFilename(file.name);

                if (existingIndex !== -1) {
                    // Found a screenshot with matching base filename
                    const existingScreenshot = state.screenshots[existingIndex];
                    const hasExistingLangImage = existingScreenshot.localizedImages?.[detectedLang]?.src;

                    if (hasExistingLangImage) {
                        // There's already an image for this language - show dialog
                        const choice = await showDuplicateDialog({
                            existingIndex: existingIndex,
                            detectedLang: detectedLang,
                            newImage: useImg,
                            newSrc: useSrc,
                            newName: file.name
                        });

                        if (choice === 'replace') {
                            addLocalizedImage(existingIndex, detectedLang, useImg, useSrc, file.name);
                        } else if (choice === 'create') {
                            createNewScreenshot(useImg, useSrc, file.name, detectedLang, deviceType);
                        }
                        // 'ignore' does nothing
                    } else {
                        // No image for this language yet - just add it silently
                        addLocalizedImage(existingIndex, detectedLang, useImg, useSrc, file.name);
                    }
                } else {
                    // No duplicate - create new screenshot
                    createNewScreenshot(useImg, useSrc, file.name, detectedLang, deviceType);
                }

                // Update 3D texture if in 3D mode
                const ss = getScreenshotSettings();
                if (ss.use3D && typeof updateScreenTexture === 'function') {
                    updateScreenTexture();
                }
                updateCanvas();
                resolve();
            };
            // CRITICAL: without onerror, one undecodable file (HEIC, corrupt…)
            // left this promise pending FOREVER and silently swallowed every
            // remaining file of the batch — "files disappearing" at import time.
            img.onerror = () => {
                _importFailures.push(file.name);
                resolve();
            };
            img.src = e.target.result;
        };
        reader.onerror = () => {
            _importFailures.push(file.name);
            resolve();
        };
        reader.readAsDataURL(file);
    });
}

function createNewScreenshot(img, src, name, lang, deviceType) {
    const localizedImages = {};
    if (img && src) {
        localizedImages[lang || 'en'] = {
            image: img,
            src: src,
            name: name
        };
        // Pending-upload ledger: this file is only "saved" once the server confirms it.
        if (typeof trackPendingUpload === 'function') trackPendingUpload(lang || 'en', name, src);
    }

    // Auto-add language to project if not already present
    if (lang && !state.projectLanguages.includes(lang)) {
        addProjectLanguage(lang);
    }

    const textDefaults = normalizeTextSettings(state.defaults.text);
    state.defaults.text = textDefaults;

    // Newly created screens default to Auto-fit text on (per-screen setting).
    const newText = JSON.parse(JSON.stringify(textDefaults));
    newText.autoFit = true;

    // Each screenshot gets its own copy of all settings from defaults
    state.screenshots.push({
        image: img || null, // Keep for legacy compatibility
        name: name || 'Blank Screen',
        deviceType: deviceType,
        localizedImages: localizedImages,
        background: JSON.parse(JSON.stringify(state.defaults.background)),
        screenshot: JSON.parse(JSON.stringify(state.defaults.screenshot)),
        text: newText,
        elements: JSON.parse(JSON.stringify(state.defaults.elements || [])),
        popouts: [],
        // Legacy overrides for backwards compatibility
        overrides: {}
    });

    updateScreenshotList();
    if (state.screenshots.length === 1) {
        state.selectedIndex = 0;
        // Show Magical Titles tooltip hint for first screenshot
        setTimeout(() => showMagicalTitlesTooltip(), 500);
    }
}

let draggedScreenshotIndex = null;

function updateScreenshotList() {
    screenshotList.innerHTML = '';
    const isEmpty = state.screenshots.length === 0;
    noScreenshot.style.display = isEmpty ? 'block' : 'none';

    // Disable right sidebar and export buttons when no screenshots
    const rightSidebar = document.querySelector('.sidebar-right');
    if (rightSidebar) rightSidebar.classList.toggle('disabled', isEmpty);
    const exportCurrent = document.getElementById('export-current');
    const exportAll = document.getElementById('export-all');
    if (exportCurrent) { exportCurrent.disabled = isEmpty; exportCurrent.style.opacity = isEmpty ? '0.4' : ''; exportCurrent.style.pointerEvents = isEmpty ? 'none' : ''; }
    if (exportAll) { exportAll.disabled = isEmpty; exportAll.style.opacity = isEmpty ? '0.4' : ''; exportAll.style.pointerEvents = isEmpty ? 'none' : ''; }

    // Show transfer mode hint if active
    if (state.transferTarget !== null && state.screenshots.length > 1) {
        const hint = document.createElement('div');
        hint.className = 'transfer-hint';
        hint.innerHTML = `
            <span>Select a screenshot to copy style from</span>
            <button class="transfer-cancel" onclick="cancelTransfer()">Cancel</button>
        `;
        screenshotList.appendChild(hint);
    }

    state.screenshots.forEach((screenshot, index) => {
        const item = document.createElement('div');
        const isTransferTarget = state.transferTarget === index;
        const isTransferMode = state.transferTarget !== null;
        item.className = 'screenshot-item' +
            (index === state.selectedIndex ? ' selected' : '') +
            (isTransferTarget ? ' transfer-target' : '') +
            (isTransferMode && !isTransferTarget ? ' transfer-source-option' : '');

        // Enable drag and drop (disabled in transfer mode)
        if (!isTransferMode) {
            item.draggable = true;
            item.dataset.index = index;
        }

        // Show different UI in transfer mode
        const buttonsHtml = isTransferMode ? '' : `
            <div class="screenshot-menu-wrapper">
                <button class="screenshot-menu-btn" data-index="${index}" title="More options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="2"/>
                        <circle cx="12" cy="12" r="2"/>
                        <circle cx="12" cy="19" r="2"/>
                    </svg>
                </button>
                <div class="screenshot-menu" data-index="${index}">
                    <button class="screenshot-menu-item screenshot-translations" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2v3M22 22l-5-10-5 10M14 18h6"/>
                        </svg>
                        Manage Translations...
                    </button>
                    <button class="screenshot-menu-item screenshot-replace" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                            <polyline points="17 8 12 3 7 8"/>
                            <line x1="12" y1="3" x2="12" y2="15"/>
                        </svg>
                        Replace Screenshot...
                    </button>
                    <button class="screenshot-menu-item screenshot-transfer" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Copy style from...
                    </button>
                    <button class="screenshot-menu-item screenshot-apply-all" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            <path d="M14 14l2 2 4-4"/>
                        </svg>
                        Apply style to all...
                    </button>
                    <button class="screenshot-menu-item screenshot-duplicate" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <rect x="9" y="9" width="13" height="13" rx="2"/>
                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                        </svg>
                        Duplicate
                    </button>
                    <button class="screenshot-menu-item screenshot-delete danger" data-index="${index}">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                        Remove
                    </button>
                </div>
            </div>
        `;

        // Get localized thumbnail image
        const thumbImg = getScreenshotImage(screenshot);
        const thumbSrc = thumbImg?.src || '';
        const isBlank = !thumbSrc;

        // Build language flags indicator
        const availableLangs = getAvailableLanguagesForScreenshot(screenshot);
        const isComplete = isScreenshotComplete(screenshot);
        let langFlagsHtml = '';
        if (state.projectLanguages.length > 1) {
            const flags = availableLangs.map(lang => languageFlags[lang] || '🏳️').join('');
            const checkmark = isComplete ? '<span class="screenshot-complete">✓</span>' : '';
            langFlagsHtml = `<span class="screenshot-lang-flags">${flags}${checkmark}</span>`;
        }

        const thumbHtml = isBlank
            ? `<div class="screenshot-thumb blank-thumb">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
              </div>`
            : `<img class="screenshot-thumb" src="${thumbSrc}" alt="${mcpEscapeHtml(screenshot.name)}">`;

        item.innerHTML = `
            <div class="drag-handle">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="6" r="2"/><circle cx="15" cy="6" r="2"/>
                    <circle cx="9" cy="12" r="2"/><circle cx="15" cy="12" r="2"/>
                    <circle cx="9" cy="18" r="2"/><circle cx="15" cy="18" r="2"/>
                </svg>
            </div>
            ${thumbHtml}
            <div class="screenshot-info">
                <div class="screenshot-name">${mcpEscapeHtml(screenshot.name)}</div>
                <div class="screenshot-device">${isTransferTarget ? 'Click source to copy style' : screenshot.deviceType}${langFlagsHtml}</div>
            </div>
            ${buttonsHtml}
        `;

        // Drag and drop handlers
        item.addEventListener('dragstart', (e) => {
            draggedScreenshotIndex = index;
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        item.addEventListener('dragend', () => {
            item.classList.remove('dragging');
            draggedScreenshotIndex = null;
            // Remove all drag-over states
            document.querySelectorAll('.screenshot-item.drag-insert-after, .screenshot-item.drag-insert-before').forEach(el => {
                el.classList.remove('drag-insert-after', 'drag-insert-before');
            });
        });

        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (draggedScreenshotIndex !== null && draggedScreenshotIndex !== index) {
                // Determine if cursor is in top or bottom half
                const rect = item.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                const isAbove = e.clientY < midpoint;

                // Clear all indicators first
                document.querySelectorAll('.screenshot-item.drag-insert-after, .screenshot-item.drag-insert-before').forEach(el => {
                    el.classList.remove('drag-insert-after', 'drag-insert-before');
                });

                // Show line on the item AFTER which the drop will occur
                if (isAbove && index === 0) {
                    // Dropping before the first item - show line above it
                    item.classList.add('drag-insert-before');
                } else if (isAbove && index > 0) {
                    // Dropping before this item = after the previous item
                    const items = screenshotList.querySelectorAll('.screenshot-item');
                    const prevItem = items[index - 1];
                    if (prevItem && !prevItem.classList.contains('dragging')) {
                        prevItem.classList.add('drag-insert-after');
                    }
                } else if (!isAbove) {
                    // Dropping after this item
                    item.classList.add('drag-insert-after');
                }
            }
        });

        item.addEventListener('dragleave', () => {
            // Don't remove here - let dragover on other items handle it
        });

        item.addEventListener('drop', (e) => {
            e.preventDefault();

            // Determine drop position based on cursor
            const rect = item.getBoundingClientRect();
            const midpoint = rect.top + rect.height / 2;
            const dropAbove = e.clientY < midpoint;

            document.querySelectorAll('.screenshot-item.drag-insert-after, .screenshot-item.drag-insert-before').forEach(el => {
                el.classList.remove('drag-insert-after', 'drag-insert-before');
            });

            if (draggedScreenshotIndex !== null && draggedScreenshotIndex !== index) {
                // Calculate target index based on drop position
                let targetIndex = dropAbove ? index : index + 1;

                // Adjust if dragging from before the target
                if (draggedScreenshotIndex < targetIndex) {
                    targetIndex--;
                }

                // Reorder screenshots
                const draggedItem = state.screenshots[draggedScreenshotIndex];
                state.screenshots.splice(draggedScreenshotIndex, 1);
                state.screenshots.splice(targetIndex, 0, draggedItem);

                // Update selected index to follow the selected item
                if (state.selectedIndex === draggedScreenshotIndex) {
                    state.selectedIndex = targetIndex;
                } else if (draggedScreenshotIndex < state.selectedIndex && targetIndex >= state.selectedIndex) {
                    state.selectedIndex--;
                } else if (draggedScreenshotIndex > state.selectedIndex && targetIndex <= state.selectedIndex) {
                    state.selectedIndex++;
                }

                updateScreenshotList();
                updateCanvas();
            }
        });

        item.addEventListener('click', (e) => {
            if (e.target.closest('.screenshot-menu-wrapper') || e.target.closest('.drag-handle')) {
                return;
            }

            // Handle transfer mode click
            if (state.transferTarget !== null) {
                if (index !== state.transferTarget) {
                    // Transfer style from clicked screenshot to target
                    transferStyle(index, state.transferTarget);
                }
                return;
            }

            // Normal selection
            state.selectedIndex = index;
            updateScreenshotList();
            // Sync all UI with current screenshot's settings
            syncUIWithState();
            updateGradientStopsUI();
            // Update 3D texture if in 3D mode
            const ss = getScreenshotSettings();
            if (ss.use3D && typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            updateCanvas();
        });

        // Menu button handler
        const menuBtn = item.querySelector('.screenshot-menu-btn');
        const menu = item.querySelector('.screenshot-menu');
        if (menuBtn && menu) {
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close all other menus first
                document.querySelectorAll('.screenshot-menu.open').forEach(m => {
                    if (m !== menu) m.classList.remove('open');
                });
                menu.classList.toggle('open');
            });
        }

        // Manage Translations button handler
        const translationsBtn = item.querySelector('.screenshot-translations');
        if (translationsBtn) {
            translationsBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                openScreenshotTranslationsModal(index);
            });
        }

        // Replace button handler
        const replaceBtn = item.querySelector('.screenshot-replace');
        if (replaceBtn) {
            replaceBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                replaceScreenshot(index);
            });
        }

        // Transfer button handler
        const transferBtn = item.querySelector('.screenshot-transfer');
        if (transferBtn) {
            transferBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                state.transferTarget = index;
                updateScreenshotList();
            });
        }

        // Apply style to all button handler
        const applyAllBtn = item.querySelector('.screenshot-apply-all');
        if (applyAllBtn) {
            applyAllBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                showApplyStyleModal(index);
            });
        }

        const duplicateBtn = item.querySelector('.screenshot-duplicate');
        if (duplicateBtn) {
            duplicateBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                duplicateScreenshot(index);
            });
        }

        // Delete button handler
        const deleteBtn = item.querySelector('.screenshot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                menu?.classList.remove('open');
                state.screenshots.splice(index, 1);
                if (state.selectedIndex >= state.screenshots.length) {
                    state.selectedIndex = Math.max(0, state.screenshots.length - 1);
                }
                updateScreenshotList();
                syncUIWithState();
                updateGradientStopsUI();
                updateCanvas();
            });
        }

        screenshotList.appendChild(item);
    });

    // Hide add buttons during transfer mode
    const addButtonsContainer = document.querySelector('.sidebar-add-buttons');
    if (addButtonsContainer) {
        addButtonsContainer.style.display = state.transferTarget === null ? '' : 'none';
    }

    // Update project selector to reflect current screenshot count
    updateProjectSelector();

    // Keep the "duplicate design from…" source list in sync with the views.
    if (typeof refreshCopyDesignSource === 'function') refreshCopyDesignSource();
}

function cancelTransfer() {
    state.transferTarget = null;
    updateScreenshotList();
}

function transferStyle(sourceIndex, targetIndex) {
    const source = state.screenshots[sourceIndex];
    const target = state.screenshots[targetIndex];

    if (!source || !target) {
        state.transferTarget = null;
        updateScreenshotList();
        return;
    }

    // Deep copy background settings
    target.background = JSON.parse(JSON.stringify(source.background));
    // Handle background image separately (not JSON serializable)
    if (source.background.image) {
        target.background.image = source.background.image;
    }

    // Deep copy screenshot settings
    target.screenshot = JSON.parse(JSON.stringify(source.screenshot));

    // Copy text styling but preserve actual text content
    const targetHeadlines = target.text.headlines;
    const targetSubheadlines = target.text.subheadlines;
    target.text = JSON.parse(JSON.stringify(source.text));
    // Restore original text content
    target.text.headlines = targetHeadlines;
    target.text.subheadlines = targetSubheadlines;

    // Deep copy elements (reconstruct Image objects for graphics and icons)
    target.elements = (source.elements || []).map(el => {
        const copy = JSON.parse(JSON.stringify({ ...el, image: undefined }));
        if (el.type === 'graphic' && el.image) {
            copy.image = el.image;
        } else if (el.type === 'icon' && el.image) {
            copy.image = el.image;
        }
        copy.id = crypto.randomUUID();
        return copy;
    });

    // Explicitly skip popouts — crop regions are specific to each screenshot's source image

    // Reset transfer mode
    state.transferTarget = null;

    // Update UI
    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    updateCanvas();
}

// Track which screenshot to apply style from
let applyStyleSourceIndex = null;

function showApplyStyleModal(sourceIndex) {
    applyStyleSourceIndex = sourceIndex;
    document.getElementById('apply-style-modal').classList.add('visible');
}

function applyStyleToAll() {
    if (applyStyleSourceIndex === null) return;

    const source = state.screenshots[applyStyleSourceIndex];
    if (!source) {
        applyStyleSourceIndex = null;
        return;
    }

    // Apply style to all other screenshots
    state.screenshots.forEach((target, index) => {
        if (index === applyStyleSourceIndex) return; // Skip source

        // Deep copy background settings
        target.background = JSON.parse(JSON.stringify(source.background));
        // Handle background image separately (not JSON serializable)
        if (source.background.image) {
            target.background.image = source.background.image;
        }

        // Deep copy screenshot settings
        target.screenshot = JSON.parse(JSON.stringify(source.screenshot));

        // Copy text styling but preserve actual text content
        const targetHeadlines = target.text.headlines;
        const targetSubheadlines = target.text.subheadlines;
        target.text = JSON.parse(JSON.stringify(source.text));
        // Restore original text content
        target.text.headlines = targetHeadlines;
        target.text.subheadlines = targetSubheadlines;

        // Deep copy elements (reconstruct Image objects for graphics and icons)
        target.elements = (source.elements || []).map(el => {
            const copy = JSON.parse(JSON.stringify({ ...el, image: undefined }));
            if ((el.type === 'graphic' || el.type === 'icon') && el.image) {
                copy.image = el.image;
            }
            copy.id = crypto.randomUUID();
            return copy;
        });

        // Explicitly skip popouts — crop regions are specific to each screenshot's source image
    });

    applyStyleSourceIndex = null;

    // Update UI
    updateScreenshotList();
    syncUIWithState();
    updateGradientStopsUI();
    updateCanvas();
}

// Replace screenshot image via file picker
function replaceScreenshot(index) {
    const screenshot = state.screenshots[index];
    if (!screenshot) return;

    // Create a hidden file input (removing any orphaned instance first)
    const orphan = document.getElementById('replace-screenshot-input');
    if (orphan) orphan.remove();
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.id = 'replace-screenshot-input';
    fileInput.accept = 'image/*';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    // Clean up if the picker is dismissed without choosing a file
    fileInput.addEventListener('cancel', () => fileInput.remove());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) {
            fileInput.remove();
            return;
        }

        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = async () => {
                // Get the current language
                const lang = state.currentLanguage;

                // Update the localized image for the current language
                if (!screenshot.localizedImages) {
                    screenshot.localizedImages = {};
                }

                screenshot.localizedImages[lang] = {
                    image: img,
                    src: event.target.result,
                    name: file.name
                };
                // Pending-upload ledger: a replacement must not be lost either.
                if (typeof trackPendingUpload === 'function') trackPendingUpload(lang, file.name, event.target.result);

                // Also update legacy image field for compatibility
                screenshot.image = img;

                // Update displays
                updateScreenshotList();
                updateCanvas();
                // Block until the server confirmed the replacement.
                showUploadProgress('Enregistrement sur le serveur…', file.name);
                try {
                    saveState();
                    await waitForServerConfirmation(currentProjectId);
                } finally {
                    hideUploadProgress();
                }
            };
            img.onerror = () => {
                _importFailures.push(file.name);
                reportImportFailures();
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);

        fileInput.remove();
    });

    // Trigger file dialog
    fileInput.click();
}

function updateGradientStopsUI() {
    const container = document.getElementById('gradient-stops');
    container.innerHTML = '';

    const bg = getBackground();
    bg.gradient.stops.forEach((stop, index) => {
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
            const currentBg = getBackground();
            currentBg.gradient.stops[index].color = e.target.value;
            // Deselect preset when manually changing colors
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            updateCanvas();
        });

        div.querySelector('input[type="number"]').addEventListener('input', (e) => {
            const currentBg = getBackground();
            const pos = parseInt(e.target.value);
            if (!Number.isNaN(pos)) currentBg.gradient.stops[index].position = pos;
            // Deselect preset when manually changing positions
            document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
            updateCanvas();
        });

        const deleteBtn = div.querySelector('.screenshot-delete');
        if (deleteBtn) {
            deleteBtn.addEventListener('click', () => {
                const currentBg = getBackground();
                currentBg.gradient.stops.splice(index, 1);
                // Deselect preset when deleting a stop
                document.querySelectorAll('.preset-swatch').forEach(s => s.classList.remove('selected'));
                updateGradientStopsUI();
                updateCanvas();
            });
        }

        container.appendChild(div);
    });
}

// Text and overlay-element sizes are stored in absolute canvas pixels, so they
// only make sense against the canvas they were chosen on. An Apple Watch canvas
// is a third the width of a phone's, which is a big enough jump that a 100px
// headline goes from a comfortable 7.6% of the width to an unusable 24%. When
// the user moves in or out of the watch family, rescale those sizes so the
// design they already have survives the move. (Deliberately limited to that
// boundary: every other output size is within a factor of two of a phone, and
// silently rewriting sizes on an iPhone→iPad switch would be a surprise.)
function rescaleTextForOutput(prevKey, nextKey) {
    if (isWatchOutput(prevKey) === isWatchOutput(nextKey)) return;
    const a = outputDeviceSize(prevKey), b = outputDeviceSize(nextKey);
    if (!a || !b || !a.width || !b.width) return;
    const f = b.width / a.width;
    if (!isFinite(f) || f <= 0) return;
    const SIZE_KEYS = ['headlineSize', 'subheadlineSize', 'subheadlineSpacing'];
    const scaleText = (t) => {
        if (!t || typeof t !== 'object') return;
        SIZE_KEYS.forEach(k => {
            if (typeof t[k] === 'number' && t[k] > 0) t[k] = Math.max(8, Math.round(t[k] * f));
        });
        Object.values(t.languageSettings || {}).forEach(scaleText);
        (t.panelTexts || []).forEach(scaleText);
    };
    scaleText(state.defaults && state.defaults.text);
    (state.screenshots || []).forEach(s => {
        scaleText(s.text);
        (s.elements || []).forEach(el => {
            if (typeof el.fontSize === 'number' && el.fontSize > 0) {
                el.fontSize = Math.max(8, Math.round(el.fontSize * f));
            }
        });
    });
    (state.defaults && state.defaults.elements || []).forEach(el => {
        if (typeof el.fontSize === 'number' && el.fontSize > 0) {
            el.fontSize = Math.max(8, Math.round(el.fontSize * f));
        }
    });
}

// Picking a watch output size means the mockup should be a watch: switch the
// 2D model over so the bezel, corner radius and notch match. This mirrors the
// model→size link the Device Model buttons already have, in the other
// direction. Only runs when moving INTO the watch family, so re-picking a
// different watch size never clobbers deliberate per-screen choices.
function adoptWatchDeviceModel() {
    const radius = deviceModelRadius('watch', 104);
    const adopt = (ss) => {
        if (!ss) return;
        ss.deviceModel2D = 'watch';
        ss.cornerRadius = radius;
        ss.use3D = false;
        // The App Store takes no panoramic watch screenshots, and the Span
        // Screens control is hidden for watch output — so a span left over
        // from a phone project would be stuck on with no way to clear it.
        ss.spanScreens = 1;
        if (ss.frame) ss.frame.notch = 'none';
    };
    (state.screenshots || []).forEach(s => adopt(s.screenshot));
    adopt(state.defaults && state.defaults.screenshot);
}

// …and the other way: leaving the watch family would otherwise leave a watch
// case wrapped around a phone- or tablet-shaped canvas. Only screens still set
// to the watch model are touched, they take the model of whatever family the
// canvas moved to, and the notch is left alone rather than guessed at.
function dropWatchDeviceModel(nextKey) {
    const model = outputDeviceModel2D(nextKey);
    if (model === 'watch') return;
    const radius = deviceModelRadius(model, 52);
    const drop = (ss) => {
        if (!ss || ss.deviceModel2D !== 'watch') return;
        ss.deviceModel2D = model;
        ss.cornerRadius = radius;
    };
    (state.screenshots || []).forEach(s => drop(s.screenshot));
    drop(state.defaults && state.defaults.screenshot);
}

// DEVICE_2D_RADIUS lives in appstore-features.js, which loads after app.js —
// safe to read from a function body, never at module scope.
function deviceModelRadius(model, fallback) {
    return (typeof DEVICE_2D_RADIUS !== 'undefined' && DEVICE_2D_RADIUS[model]) || fallback;
}

// A few renderer defaults are stored in absolute canvas pixels, tuned against a
// phone canvas: shadow blur/offset, and how far text auto-fit is allowed to
// shrink. On an Apple Watch canvas they are ~3x too big, so scale them by how
// much narrower the canvas is. Keyed off ONE screen's width (baseWidth), not
// the panorama-multiplied total, so a spanned screen doesn't lose the
// compensation. 700 sits below every other stock output size (the smallest is
// web-feature at 1024), so nothing but the watch is affected.
function smallCanvasScale(dims) {
    const w = (dims && (dims.baseWidth || dims.width)) || 0;
    return w > 0 && w < 700 ? w / 1320 : 1;
}

function getCanvasDimensions(index) {
    const base = state.outputDevice === 'custom'
        ? { width: state.customWidth, height: state.customHeight }
        : (deviceDimensions[state.outputDevice] || deviceDimensions['iphone-6.9']);
    // Panorama: a screenshot can span N output slots → render at N× width.
    const i = index === undefined ? state.selectedIndex : index;
    const ss = state.screenshots[i];
    const span = (ss && ss.screenshot && ss.screenshot.spanScreens) || 1;
    return { width: base.width * span, height: base.height, span: span, baseWidth: base.width };
}

// Coalesce renders to at most one per animation frame. Many UI handlers (slider
// drags especially) call updateCanvas() many times within a single frame; each
// call used to do a full-resolution main render PLUS up to 4 side-preview
// renders. Now repeated calls collapse into a single render on the next frame.
let _canvasRenderScheduled = false;
function updateCanvas() {
    scheduleSaveState(); // Persist state (debounced — see scheduleSaveState)
    if (_canvasRenderScheduled) return;
    _canvasRenderScheduled = true;
    requestAnimationFrame(() => {
        _canvasRenderScheduled = false;
        renderCanvasNow();
    });
}

// Synchronous full render. Call directly only when the result must be applied in
// the same tick (e.g. the slide transition sets skip-render flags synchronously).
function renderCanvasNow() {
    if (typeof window !== 'undefined') window.__imgRect = { has: false };
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

    // Draw noise overlay on background if enabled
    if (getBackground().noise) {
        drawNoise();
    }

    // Elements behind screenshot
    drawElements(ctx, dims, 'behind-screenshot');

    // Draw screenshot (2D mode) or 3D phone model
    if (state.screenshots.length > 0) {
        const screenshot = state.screenshots[state.selectedIndex];
        const img = screenshot ? getScreenshotImage(screenshot) : null;
        const ss = getScreenshotSettings();
        const use3D = ss.use3D || false;
        if (use3D && output3DSupported() && img && typeof renderThreeJSToCanvas === 'function' && phoneModelLoaded) {
            // In 3D mode, update the screen texture and render the phone model
            if (typeof updateScreenTexture === 'function') {
                updateScreenTexture();
            }
            renderThreeJSToCanvas(canvas, dims.width, dims.height);
        } else if (!use3D || !output3DSupported()) {
            // 2D mode — and the fallback for a stored use3D on an output size
            // with no 3D model, which would otherwise draw nothing at all.
            drawScreenshot();
        }
    }

    // Elements above screenshot but behind text
    drawElements(ctx, dims, 'above-screenshot');

    // Draw popouts (cropped regions from source image)
    drawPopouts(ctx, dims);

    // Draw text
    drawText();

    // Elements above text
    drawElements(ctx, dims, 'above-text');

    // Update side previews — debounced while editing the current screenshot
    // (neighbours don't change), immediate when the selection/layout changes.
    scheduleSidePreviews();
}

// Side previews show the NEIGHBOURING screenshots, which are unaffected by edits
// to the current one — so re-rendering all four every frame during a slider drag
// is wasted work (and they each run the full pipeline, noise loop included). Only
// render them right away when the selection or output layout actually changes;
// otherwise coalesce to a single trailing render once edits settle.
let _sidePreviewTimer = null;
let _lastSidePreviewKey = null;
function scheduleSidePreviews() {
    const key = state.selectedIndex + '|' + state.screenshots.length + '|' +
                state.outputDevice + '|' + state.customWidth + 'x' + state.customHeight;
    if (key !== _lastSidePreviewKey) {
        _lastSidePreviewKey = key;
        if (_sidePreviewTimer) { clearTimeout(_sidePreviewTimer); _sidePreviewTimer = null; }
        updateSidePreviews();
        return;
    }
    if (_sidePreviewTimer) clearTimeout(_sidePreviewTimer);
    _sidePreviewTimer = setTimeout(() => { _sidePreviewTimer = null; updateSidePreviews(); }, 180);
}

// How many real pixels a preview needs: its CSS size, times the display's pixel
// ratio (capped at 2 — beyond that nobody can tell, and the buffer cost is
// quadratic). Previews used to be rasterized at full export resolution and then
// squeezed into a ~400px box by CSS.
function previewRenderScale() {
    const dims = getCanvasDimensions();
    const cssScale = Math.min(400 / dims.width, 700 / dims.height);
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    return Math.min(1, cssScale * dpr);
}

function updateSidePreviews() {
    const dims = getCanvasDimensions();
    // Same scale as main preview
    const maxPreviewWidth = 400;
    const maxPreviewHeight = 700;
    const previewScale = Math.min(maxPreviewWidth / dims.width, maxPreviewHeight / dims.height);

    // Initialize Three.js if any screenshot uses 3D mode (needed for side
    // previews) — unless this output size has no 3D model at all, in which case
    // a stale use3D flag would spin up the renderer for nothing.
    const any3D = output3DSupported() && state.screenshots.some(s => s.screenshot?.use3D);
    if (any3D && typeof showThreeJS === 'function') {
        showThreeJS(true);

        // Preload phone models for adjacent screenshots to prevent flicker
        if (typeof loadCachedPhoneModel === 'function') {
            const adjacentIndices = [state.selectedIndex - 1, state.selectedIndex + 1]
                .filter(i => i >= 0 && i < state.screenshots.length);
            adjacentIndices.forEach(i => {
                const ss = state.screenshots[i]?.screenshot;
                if (ss?.use3D && ss?.device3D) {
                    loadCachedPhoneModel(ss.device3D);
                }
            });
        }
    }

    // Calculate main canvas display width and position side previews with 10px gap
    const mainCanvasWidth = dims.width * previewScale;
    const gap = 10;
    const sideOffset = mainCanvasWidth / 2 + gap;
    const farSideOffset = sideOffset + mainCanvasWidth + gap;

    // Previous screenshot (left, index - 1)
    const prevIndex = state.selectedIndex - 1;
    if (prevIndex >= 0 && state.screenshots.length > 1) {
        sidePreviewLeft.classList.remove('hidden');
        sidePreviewLeft.style.right = `calc(50% + ${sideOffset}px)`;
        // Skip render if already pre-rendered during slide transition
        if (!skipSidePreviewRender) {
            renderScreenshotToCanvas(prevIndex, canvasLeft, ctxLeft, getCanvasDimensions(prevIndex), previewScale, previewRenderScale());
        }
        // Click to select previous with animation
        sidePreviewLeft.onclick = () => {
            if (isSliding) return;
            slideToScreenshot(prevIndex, 'left');
        };
    } else {
        sidePreviewLeft.classList.add('hidden');
    }

    // Far previous screenshot (far left, index - 2)
    const farPrevIndex = state.selectedIndex - 2;
    if (farPrevIndex >= 0 && state.screenshots.length > 2) {
        sidePreviewFarLeft.classList.remove('hidden');
        sidePreviewFarLeft.style.right = `calc(50% + ${farSideOffset}px)`;
        renderScreenshotToCanvas(farPrevIndex, canvasFarLeft, ctxFarLeft, getCanvasDimensions(farPrevIndex), previewScale, previewRenderScale());
    } else {
        sidePreviewFarLeft.classList.add('hidden');
    }

    // Next screenshot (right, index + 1)
    const nextIndex = state.selectedIndex + 1;
    if (nextIndex < state.screenshots.length && state.screenshots.length > 1) {
        sidePreviewRight.classList.remove('hidden');
        sidePreviewRight.style.left = `calc(50% + ${sideOffset}px)`;
        // Skip render if already pre-rendered during slide transition
        if (!skipSidePreviewRender) {
            renderScreenshotToCanvas(nextIndex, canvasRight, ctxRight, getCanvasDimensions(nextIndex), previewScale, previewRenderScale());
        }
        // Click to select next with animation
        sidePreviewRight.onclick = () => {
            if (isSliding) return;
            slideToScreenshot(nextIndex, 'right');
        };
    } else {
        sidePreviewRight.classList.add('hidden');
    }

    // Far next screenshot (far right, index + 2)
    const farNextIndex = state.selectedIndex + 2;
    if (farNextIndex < state.screenshots.length && state.screenshots.length > 2) {
        sidePreviewFarRight.classList.remove('hidden');
        sidePreviewFarRight.style.left = `calc(50% + ${farSideOffset}px)`;
        renderScreenshotToCanvas(farNextIndex, canvasFarRight, ctxFarRight, getCanvasDimensions(farNextIndex), previewScale, previewRenderScale());
    } else {
        sidePreviewFarRight.classList.add('hidden');
    }
}

function slideToScreenshot(newIndex, direction) {
    isSliding = true;
    previewStrip.classList.add('sliding');

    const dims = getCanvasDimensions();
    const maxPreviewWidth = 400;
    const maxPreviewHeight = 700;
    const previewScale = Math.min(maxPreviewWidth / dims.width, maxPreviewHeight / dims.height);
    const slideDistance = dims.width * previewScale + 10; // canvas width + gap

    const newPrevIndex = newIndex - 1;
    const newNextIndex = newIndex + 1;

    // Collect model loading promises for new active AND adjacent screenshots
    const modelPromises = [];
    [newIndex, newPrevIndex, newNextIndex].forEach(index => {
        if (index >= 0 && index < state.screenshots.length) {
            const ss = state.screenshots[index]?.screenshot;
            if (ss?.use3D && ss?.device3D && typeof loadCachedPhoneModel === 'function') {
                modelPromises.push(loadCachedPhoneModel(ss.device3D).catch(() => null));
            }
        }
    });

    // Start loading models immediately (in parallel with animation)
    const modelsReady = modelPromises.length > 0 ? Promise.all(modelPromises) : Promise.resolve();

    // Slide the strip in the opposite direction of the click
    if (direction === 'right') {
        previewStrip.style.transform = `translateX(-${slideDistance}px)`;
    } else {
        previewStrip.style.transform = `translateX(${slideDistance}px)`;
    }

    // Wait for BOTH animation AND models to be ready
    const animationDone = new Promise(resolve => setTimeout(resolve, 300));
    Promise.all([animationDone, modelsReady]).then(() => {
        // Pre-render new side previews to temporary canvases NOW (models are loaded)
        const tempCanvases = [];

        const prerenderToTemp = (index, targetCanvas) => {
            if (index < 0 || index >= state.screenshots.length) return null;
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            renderScreenshotToCanvas(index, tempCanvas, tempCtx, getCanvasDimensions(index), previewScale, previewRenderScale());
            return { tempCanvas, targetCanvas };
        };

        const leftPrerender = prerenderToTemp(newPrevIndex, canvasLeft);
        const rightPrerender = prerenderToTemp(newNextIndex, canvasRight);
        if (leftPrerender) tempCanvases.push(leftPrerender);
        if (rightPrerender) tempCanvases.push(rightPrerender);

        // Disable transition temporarily for instant reset
        previewStrip.style.transition = 'none';
        previewStrip.style.transform = 'translateX(0)';

        // Suppress updateCanvas calls from switchPhoneModel during sync
        window.suppressSwitchModelUpdate = true;

        // Update state
        state.selectedIndex = newIndex;
        updateScreenshotList();
        syncUIWithState();
        updateGradientStopsUI();

        // Copy pre-rendered canvases to actual canvases BEFORE updateCanvas
        // This prevents flicker by having content ready before the swap
        tempCanvases.forEach(({ tempCanvas, targetCanvas }) => {
            targetCanvas.width = tempCanvas.width;
            targetCanvas.height = tempCanvas.height;
            targetCanvas.style.width = tempCanvas.style.width;
            targetCanvas.style.height = tempCanvas.style.height;
            const targetCtx = targetCanvas.getContext('2d');
            targetCtx.drawImage(tempCanvas, 0, 0);
        });

        // Skip side preview re-render since we already pre-rendered them
        skipSidePreviewRender = true;

        // Now do a full render for main preview, far sides, etc. Render NOW (not
        // the debounced updateCanvas) so skipSidePreviewRender applies this tick
        // and the pre-rendered side canvases aren't overwritten (which would flicker).
        renderCanvasNow();

        // Reset flags
        skipSidePreviewRender = false;
        window.suppressSwitchModelUpdate = false;

        // Re-enable transition after a frame
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                previewStrip.style.transition = '';
                previewStrip.classList.remove('sliding');
                isSliding = false;
            });
        });
    });
}

// `renderScale` sizes the canvas's PIXEL BUFFER; `previewScale` only ever sized
// its CSS box. Leaving the buffer at full output resolution meant a 96px matrix
// thumbnail still allocated 1320×2868×4 bytes (~15 MB) and rasterized every
// layer at export resolution — 40 languages × 9 screens was gigabytes of canvas
// and minutes of work for a wall of thumbnails. The context is scaled to match,
// so everything below still draws in output coordinates and needs no changes.
// Omit it (or pass 1) for a full-resolution render, which is what exports do.
function renderScreenshotToCanvas(index, targetCanvas, targetCtx, dims, previewScale, renderScale) {
    const screenshot = state.screenshots[index];
    if (!screenshot) return;
    if (typeof window !== 'undefined') window.__imgRect = { has: false };

    // Get localized image for current language
    const img = getScreenshotImage(screenshot);

    // Set canvas size (this also clears the canvas AND resets the transform,
    // so the scale has to be re-applied after it)
    const rs = renderScale > 0 ? Math.min(1, renderScale) : 1;
    targetCanvas.width = Math.max(1, Math.round(dims.width * rs));
    targetCanvas.height = Math.max(1, Math.round(dims.height * rs));
    targetCanvas.style.width = (dims.width * previewScale) + 'px';
    targetCanvas.style.height = (dims.height * previewScale) + 'px';
    if (rs !== 1) targetCtx.setTransform(rs, 0, 0, rs, 0, 0);

    // Clear canvas explicitly
    targetCtx.clearRect(0, 0, dims.width, dims.height);

    // Draw background for this screenshot
    const bg = screenshot.background;
    drawBackgroundToContext(targetCtx, dims, bg);

    // Draw noise if enabled
    if (bg.noise) {
        drawNoiseToContext(targetCtx, dims, bg.noiseIntensity);
    }

    const elements = screenshot.elements || [];

    // Elements behind screenshot
    drawElementsToContext(targetCtx, dims, elements, 'behind-screenshot');

    // Draw screenshot - 3D if active for this screenshot, otherwise 2D
    const settings = screenshot.screenshot;
    const use3D = settings.use3D || false;

    if (img) {
        if (use3D && output3DSupported() && typeof renderThreeJSForScreenshot === 'function' && phoneModelLoaded) {
            // Render 3D phone model for this specific screenshot
            renderThreeJSForScreenshot(targetCanvas, dims.width, dims.height, index);
        } else {
            // Draw 2D screenshot using localized image
            drawScreenshotToContext(targetCtx, dims, img, settings);
        }
    }

    // Elements above screenshot
    drawElementsToContext(targetCtx, dims, elements, 'above-screenshot');

    // Draw popouts
    const popouts = screenshot.popouts || [];
    drawPopoutsToContext(targetCtx, dims, popouts, img, settings);

    // Draw text
    const txt = screenshot.text;
    drawTextWithPanorama(targetCtx, dims, txt);

    // Elements above text
    drawElementsToContext(targetCtx, dims, elements, 'above-text');
}

function drawBackgroundToContext(context, dims, bg) {
    if (bg.type === 'gradient') {
        const angle = bg.gradient.angle * Math.PI / 180;
        const x1 = dims.width / 2 - Math.cos(angle) * dims.width;
        const y1 = dims.height / 2 - Math.sin(angle) * dims.height;
        const x2 = dims.width / 2 + Math.cos(angle) * dims.width;
        const y2 = dims.height / 2 + Math.sin(angle) * dims.height;

        const gradient = context.createLinearGradient(x1, y1, x2, y2);
        bg.gradient.stops.forEach(stop => {
            gradient.addColorStop(stop.position / 100, stop.color);
        });

        context.fillStyle = gradient;
        context.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'solid') {
        context.fillStyle = bg.solid;
        context.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'image' && bg.image) {
        const img = bg.image;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        let dx = 0, dy = 0, dw = dims.width, dh = dims.height;

        if (bg.imageFit === 'cover') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
        } else if (bg.imageFit === 'contain') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                dh = dims.width / imgRatio;
                dy = (dims.height - dh) / 2;
            } else {
                dw = dims.height * imgRatio;
                dx = (dims.width - dw) / 2;
            }

            context.fillStyle = '#000';
            context.fillRect(0, 0, dims.width, dims.height);
        }

        if (bg.imageBlur > 0) {
            context.filter = `blur(${bg.imageBlur}px)`;
        }

        context.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        context.filter = 'none';

        if (bg.overlayOpacity > 0) {
            context.fillStyle = bg.overlayColor;
            context.globalAlpha = bg.overlayOpacity / 100;
            context.fillRect(0, 0, dims.width, dims.height);
            context.globalAlpha = 1;
        }
    }
}

function drawNoiseToContext(context, dims, intensity) {
    // getImageData/putImageData work in DEVICE pixels and ignore the context
    // transform, so this has to follow the canvas's real buffer — which is
    // smaller than `dims` whenever the caller passed a renderScale.
    const w = context.canvas ? context.canvas.width : dims.width;
    const h = context.canvas ? context.canvas.height : dims.height;
    const imageData = context.getImageData(0, 0, w, h);
    const data = imageData.data;
    const noiseAmount = intensity / 100;

    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * noiseAmount;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }

    context.putImageData(imageData, 0, 0);
}

function drawScreenshotToContext(context, dims, img, settings) {
    if (!img) return;

    const scale = settings.scale / 100;
    let imgWidth = dims.width * scale;
    let imgHeight = (img.height / img.width) * imgWidth;

    if (imgHeight > dims.height * scale) {
        imgHeight = dims.height * scale;
        imgWidth = (img.width / img.height) * imgHeight;
    }

    // Ensure minimum movement range so position works even at 100% scale
    const moveX = Math.max(dims.width - imgWidth, dims.width * 0.15);
    const moveY = Math.max(dims.height - imgHeight, dims.height * 0.15);
    const x = (dims.width - imgWidth) / 2 + (settings.x / 100 - 0.5) * moveX;
    const y = (dims.height - imgHeight) / 2 + (settings.y / 100 - 0.5) * moveY;
    const centerX = x + imgWidth / 2;
    const centerY = y + imgHeight / 2;

    // Record the device rect for text auto-fit / overlap detection.
    if (typeof window !== 'undefined') window.__imgRect = { x, y, w: imgWidth, h: imgHeight, has: true };

    context.save();

    // Apply transformations
    context.translate(centerX, centerY);

    // Apply rotation
    if (settings.rotation !== 0) {
        context.rotate(settings.rotation * Math.PI / 180);
    }

    // Apply perspective (simulated with scale transform)
    if (settings.perspective !== 0) {
        context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
    }

    context.translate(-centerX, -centerY);

    // Scale corner radius with image size
    const radius = (settings.cornerRadius || 0) * (imgWidth / 400);

    // Shadow blur and offset are stored in absolute canvas pixels, tuned against
    // a phone canvas. On an Apple Watch canvas (416px wide) the default blur of
    // 40 is 10% of the width instead of 3%, which buries the device in a smear —
    // so scale them down on canvases far smaller than a phone's. 700 sits below
    // every other stock output size (the smallest is 1024), so nothing else moves.
    const smallCanvas = smallCanvasScale(dims);

    // Draw shadow first (needs a filled shape, not clipped)
    if (settings.shadow && settings.shadow.enabled) {
        const shadowOpacity = settings.shadow.opacity / 100;
        const shadowColor = settings.shadow.color + Math.round(shadowOpacity * 255).toString(16).padStart(2, '0');
        context.shadowColor = shadowColor;
        context.shadowBlur = settings.shadow.blur * smallCanvas;
        context.shadowOffsetX = settings.shadow.x * smallCanvas;
        context.shadowOffsetY = settings.shadow.y * smallCanvas;

        // Draw filled rounded rect for shadow
        context.fillStyle = '#000';
        context.beginPath();
        context.roundRect(x, y, imgWidth, imgHeight, radius);
        context.fill();

        // Reset shadow before drawing image
        context.shadowColor = 'transparent';
        context.shadowBlur = 0;
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 0;
    }

    // Clip and draw image
    context.beginPath();
    context.roundRect(x, y, imgWidth, imgHeight, radius);
    context.clip();
    context.drawImage(img, x, y, imgWidth, imgHeight);

    context.restore();

    // Draw device frame if enabled
    if (settings.frame && settings.frame.enabled) {
        context.save();
        context.translate(centerX, centerY);
        if (settings.rotation !== 0) {
            context.rotate(settings.rotation * Math.PI / 180);
        }
        if (settings.perspective !== 0) {
            context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
        }
        context.translate(-centerX, -centerY);
        drawDeviceFrameToContext(context, x, y, imgWidth, imgHeight, settings);
        context.restore();
    }

    // Draw 2D device bezel + notch / Dynamic Island (independent of the border)
    const hasNotch = settings.frame && settings.frame.notch && settings.frame.notch !== 'none';
    if (settings.bezelEnabled || hasNotch) {
        context.save();
        context.translate(centerX, centerY);
        if (settings.rotation !== 0) context.rotate(settings.rotation * Math.PI / 180);
        if (settings.perspective !== 0) context.transform(1, settings.perspective * 0.01, 0, 1, 0, 0);
        context.translate(-centerX, -centerY);
        if (settings.bezelEnabled) drawDeviceBezel(
            context, x, y, imgWidth, imgHeight, radius,
            settings.deviceModel2D || 'iphone',
            settings.deviceMacFinish || 'silver',
            // The Ultra case shape follows the output size, not a user choice:
            // 422×514 and 410×502 ARE the Ultra panels.
            { finish: settings.deviceWatchFinish || 'midnight', ultra: /^watch-ultra/.test(state.outputDevice) }
        );
        if (hasNotch) drawNotchShape(context, x, y, imgWidth, imgHeight, radius, settings.frame.notch);
        context.restore();
    }
}

function drawDeviceFrameToContext(context, x, y, width, height, settings) {
    const frameColor = settings.frame.color;
    const frameWidth = settings.frame.width * (width / 400);
    const frameOpacity = settings.frame.opacity / 100;
    const radius = (settings.cornerRadius || 0) * (width / 400) + frameWidth;

    context.globalAlpha = frameOpacity;
    context.strokeStyle = frameColor;
    context.lineWidth = frameWidth;
    context.beginPath();
    context.roundRect(x - frameWidth / 2, y - frameWidth / 2, width + frameWidth, height + frameWidth, radius);
    context.stroke();
    context.globalAlpha = 1;
}

// Shared: draw an iPhone notch / Dynamic Island at the top-center of the screen,
// clipped to the screen's rounded rect. Used by both render paths.
function drawNotchShape(context, x, y, width, height, radius, style) {
    if (!style || style === 'none') return;
    context.save();
    context.beginPath();
    context.roundRect(x, y, width, height, radius);
    context.clip();
    context.fillStyle = '#000000';
    if (style === 'island') {
        const w = width * 0.30, h = width * 0.085;
        context.beginPath();
        context.roundRect(x + width / 2 - w / 2, y + width * 0.035, w, h, h / 2);
        context.fill();
    } else if (style === 'notch') {
        const w = width * 0.50, h = width * 0.072, r = h * 0.55;
        context.beginPath();
        context.roundRect(x + width / 2 - w / 2, y - 1, w, h, [0, 0, r, r]);
        context.fill();
    } else if (style === 'punch') {
        // Samsung-style centered punch-hole camera
        const r = width * 0.018;
        context.beginPath();
        context.arc(x + width / 2, y + width * 0.04, r, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

// Shared: draw a 2D device bezel/shell (iPhone, iPad, Samsung, Mac or Apple
// Watch) around the screen. `watch` carries the watch-only extras: { finish,
// ultra } — see drawWatchBezel.
function drawDeviceBezel(context, x, y, width, height, radius, model, macFinish, watch) {
    const isSamsung = model === 'samsung';
    const isIpad = model === 'ipad';
    const isMac = model === 'mac';
    if (isMac) { drawMacBezel(context, x, y, width, height, radius, macFinish); return; }
    if (model === 'watch') { drawWatchBezel(context, x, y, width, height, radius, watch); return; }
    // iPad bezels are uniform and a touch thinner than iPhone; Samsung thinnest.
    const bw = width * (isSamsung ? 0.020 : isIpad ? 0.024 : 0.028);
    context.save();
    // Main dark bezel ring
    context.lineWidth = bw;
    context.strokeStyle = isSamsung ? '#0b0b0d' : isIpad ? '#161618' : '#1d1d1f';
    context.beginPath();
    context.roundRect(x - bw / 2, y - bw / 2, width + bw, height + bw, radius + bw / 2);
    context.stroke();
    // Subtle metallic outer edge
    context.lineWidth = Math.max(1, bw * (isIpad ? 0.16 : 0.14));
    context.strokeStyle = isSamsung ? 'rgba(255,255,255,0.08)' : isIpad ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.20)';
    context.beginPath();
    context.roundRect(x - bw, y - bw, width + bw * 2, height + bw * 2, radius + bw);
    context.stroke();
    context.restore();
}

// Apple Watch case finishes. Sampled from Apple's own product renders: `hi` /
// `mid` / `lo` are the top-highlight, body and bottom-shadow stops of the
// vertical gradient down the metal, `edge` the specular catch-light on the
// outer rim. Aluminium reads near-neutral with a hard highlight; the titanium
// finishes are warmer and lower-contrast.
const WATCH_FINISHES = {
    midnight:  { hi: '#5f626a', mid: '#40434b', lo: '#2b2e35', edge: 'rgba(255,255,255,0.26)' },
    starlight: { hi: '#ebe0d8', mid: '#c0b3ab', lo: '#a2958d', edge: 'rgba(255,255,255,0.60)' },
    silver:    { hi: '#f7f7f9', mid: '#c3c4c3', lo: '#9d9d9b', edge: 'rgba(255,255,255,0.66)' },
    gold:      { hi: '#fef7ee', mid: '#b0a297', lo: '#89745c', edge: 'rgba(255,255,255,0.52)' }
};

// Shared: draw an Apple Watch case around the screen.
//
// Every ratio below is measured from Apple's official device bezel artwork
// (the 46mm and 42mm Series 11 renders agree to under 0.5%, so they are the
// family constants; the Ultra is a genuinely different shape, not a scaled
// Series case). The stack, outermost first, is: metal case → black glass ring
// → screen content. The screen rect itself is never painted over — the case
// and the glass are both drawn as even-odd rings — because the screenshot has
// already been drawn by the time this runs.
//
// `opts` = { finish: keyof WATCH_FINISHES, ultra: boolean }.
function drawWatchBezel(context, x, y, width, height, radius, opts) {
    const o = opts || {};
    const FIN = WATCH_FINISHES[o.finish] || WATCH_FINISHES.midnight;
    const ultra = !!o.ultra;
    const W = width, H = height;

    // ---- Case geometry ----
    // The Series case is centred on the screen with a uniform rim. The Ultra's
    // rim is asymmetric (the crown guard fattens the right side), so its screen
    // sits left of the case centre and the two edges are measured separately.
    const caseW = (ultra ? 1.3128 : 1.19231) * W;
    const caseH = (ultra ? 1.2140 : 1.15726) * H;
    // Vertically the screen is centred on both models; horizontally only the
    // Series is — the Ultra's crown guard fattens the right side, so its screen
    // sits left of centre. Deriving caseY from caseH (rather than from caseW,
    // as the source measurements express it) keeps the case centred whatever
    // aspect the drawn screenshot happens to have.
    const caseX = ultra ? x - 0.0939 * caseW : x - (caseW - W) / 2;
    const caseY = y - (caseH - H) / 2;
    const caseR = (ultra ? 0.2870 : 0.27419) * caseW;

    // Black glass reaches beyond the active pixels before the metal starts —
    // thinner at the top on the Series, uniform on the Ultra.
    const glassSide = (ultra ? 0.0474 : 0.0649) * W;
    const glassTop = (ultra ? 0.0474 : 0.0361) * W;
    const glassX = x - glassSide;
    const glassY = y - glassTop;
    const glassW = W + glassSide * 2;
    const glassH = H + glassTop + glassSide;
    // The glass corner radius follows the SCREEN's, which the user can dial
    // down to 0 — but the case radius is fixed, so a square-cornered glass
    // rect would poke out through the case's rounded corners. Never let it
    // round less than the case does, allowing for the metal between them.
    const metalInset = Math.min(
        glassX - caseX, glassY - caseY,
        (caseX + caseW) - (glassX + glassW), (caseY + caseH) - (glassY + glassH)
    );
    const glassR = Math.max(radius + glassSide, caseR - Math.max(0, metalInset));

    // rounded-rect subpath (no beginPath — these compose into even-odd fills)
    const rr = (rx, ry, rw, rh, r) => {
        const rad = Math.max(0, Math.min(r, rw / 2, rh / 2));
        context.moveTo(rx + rad, ry);
        context.arcTo(rx + rw, ry, rx + rw, ry + rh, rad);
        context.arcTo(rx + rw, ry + rh, rx, ry + rh, rad);
        context.arcTo(rx, ry + rh, rx, ry, rad);
        context.arcTo(rx, ry, rx + rw, ry, rad);
        context.closePath();
    };

    const metal = context.createLinearGradient(0, caseY, 0, caseY + caseH);
    metal.addColorStop(0, FIN.hi);
    metal.addColorStop(0.45, FIN.mid);
    metal.addColorStop(1, FIN.lo);

    context.save();

    // ---- 1) Side hardware, drawn first so the case rounds over the seams ----
    // The Digital Crown is the only part that protrudes on a face-on view (the
    // side button measures flush on Apple's own render, so it is drawn as a
    // hairline seam rather than a bump). On the Ultra even the crown sits
    // almost flush inside its guard rail.
    const crownH = (ultra ? 0.1683 : 0.15679) * caseH;
    const crownY = caseY + (ultra ? 0.2853 : 0.23345) * caseH;
    const crownOut = (ultra ? 0.0090 : 0.04839) * caseW;
    const crownR = crownH * 0.11;

    if (ultra) {
        // Crown guard: a raised slab on the right edge spanning the crown.
        const guardH = caseH * 0.30;
        const guardY = caseY + caseH * 0.24;
        context.fillStyle = metal;
        context.beginPath();
        rr(caseX + caseW - caseW * 0.06, guardY, caseW * 0.09, guardH, caseW * 0.03);
        context.fill();
    } else {
        context.fillStyle = metal;
        context.beginPath();
        // Overlap the case edge so no seam shows once the ring is drawn over it.
        rr(caseX + caseW - crownOut * 0.6, crownY, crownOut * 1.6, crownH, crownR);
        context.fill();
        // Grooved crown face: a couple of darker ridges read as knurling.
        context.strokeStyle = 'rgba(0,0,0,0.30)';
        context.lineWidth = Math.max(0.5, crownOut * 0.10);
        for (let i = 1; i <= 2; i++) {
            const gy = crownY + crownH * (i / 3);
            context.beginPath();
            context.moveTo(caseX + caseW, gy);
            context.lineTo(caseX + caseW + crownOut, gy);
            context.stroke();
        }
    }

    // ---- 2) Metal case: an even-odd ring, screen + glass punched out ----
    context.fillStyle = metal;
    context.beginPath();
    rr(caseX, caseY, caseW, caseH, caseR);
    rr(glassX, glassY, glassW, glassH, glassR);
    context.fill('evenodd');

    // ---- 3) Black glass ring between the metal and the screen ----
    context.fillStyle = '#0a0a0b';
    context.beginPath();
    rr(glassX, glassY, glassW, glassH, glassR);
    rr(x, y, W, H, radius);
    context.fill('evenodd');

    // ---- 3b) Ultra hardware sits ON the case, not proud of it, so it goes
    // on after the ring — drawn before, the ring would cover it.
    if (ultra) {
        // Digital Crown, recessed inside the guard rail.
        context.fillStyle = metal;
        context.beginPath();
        rr(caseX + caseW - caseW * 0.055, crownY, caseW * 0.055 + crownOut, crownH, crownR);
        context.fill();
        context.strokeStyle = 'rgba(0,0,0,0.32)';
        context.lineWidth = Math.max(0.5, caseW * 0.003);
        for (let i = 1; i <= 2; i++) {
            const gy = crownY + crownH * (i / 3);
            context.beginPath();
            context.moveTo(caseX + caseW - caseW * 0.05, gy);
            context.lineTo(caseX + caseW + crownOut, gy);
            context.stroke();
        }
        // Action button — Ultra only, on the LEFT edge, in International Orange.
        const abH = 0.2724 * caseH;
        const abY = caseY + 0.4471 * caseH;
        const abW = caseW * 0.026;
        context.fillStyle = '#e8631a';
        context.beginPath();
        rr(caseX - abW * 0.18, abY, abW * 1.18, abH, abW * 0.35);
        context.fill();
        context.fillStyle = 'rgba(0,0,0,0.22)';
        context.beginPath();
        rr(caseX + abW * 0.62, abY, abW * 0.38, abH, abW * 0.18);
        context.fill();
    }

    // ---- 4) Edge treatments ----
    // Specular catch-light just inside the outer case edge.
    context.strokeStyle = FIN.edge;
    context.lineWidth = Math.max(1, caseW * 0.006);
    context.beginPath();
    rr(caseX + context.lineWidth / 2, caseY + context.lineWidth / 2,
       caseW - context.lineWidth, caseH - context.lineWidth, caseR);
    context.stroke();

    // Side-button seam (Series only — the Ultra's buttons live on the guard).
    if (!ultra) {
        context.strokeStyle = 'rgba(0,0,0,0.35)';
        context.lineWidth = Math.max(1, caseW * 0.004);
        const seamY = caseY + caseH * 0.52;
        context.beginPath();
        context.moveTo(caseX + caseW - caseW * 0.004, seamY - caseH * 0.055);
        context.lineTo(caseX + caseW - caseW * 0.004, seamY + caseH * 0.055);
        context.stroke();
    }

    // Contact shadow where the glass meets the screen, for a little depth.
    context.save();
    context.beginPath();
    rr(x, y, W, H, radius);
    context.clip();
    context.strokeStyle = 'rgba(0,0,0,0.45)';
    context.lineWidth = Math.max(1, W * 0.006);
    context.beginPath();
    rr(x + context.lineWidth / 2, y + context.lineWidth / 2,
       W - context.lineWidth, H - context.lineWidth, radius);
    context.stroke();
    context.restore();

    context.restore();
}

// Shared: draw a Mac (MacBook Pro-style) shell around the screen — a thin
// aluminium-rimmed lid with a dark bezel frame (the screenshot shows through an
// even-odd cutout, never grey metal) and a small camera dot, then a slim
// aluminium base in slight perspective: a lit "open-lid" deck sliver, a two-tone
// front lip with a finger-groove, and a soft contact shadow grounding it all.
// `finish` selects the chassis colour: 'silver' (default) or 'space-black'.
// All geometry scales off the screen so it stays proportional at any resolution.
function drawMacBezel(context, x, y, width, height, radius, finish) {
    // Per-finish aluminium palettes (the dark bezel itself stays black on both).
    const FIN = finish === 'space-black' ? {
        rim: ['#6f7278', '#44474c', '#26282b'],          // lid rim: top hi -> mid -> bottom
        deck: ['#4c4f54', '#3c3f43', '#2d2f33'],         // open-lid deck sliver
        lip: ['#565a60', '#474a4f', '#3a3d42', '#2f3236', '#26282c', '#34373b'], // front lip
        lipSideRGB: '0,0,0', lipSideA: 0.45,             // corner falloff
        grooveRGB: '0,0,0', grooveA: 0.55,               // finger-groove recess
        grooveLight: 'rgba(205,209,215,0.32)',
        edgeHi: 'rgba(255,255,255,0.3)',                 // crisp catch-lights
    } : {
        rim: ['#dfe2e6', '#aeb2b8', '#888c92'],
        deck: ['#f1f2f4', '#dcdfe2', '#c3c6cb'],
        lip: ['#f4f5f7', '#e0e3e6', '#c2c6cb', '#aaaeb4', '#9b9fa5', '#b0b4ba'],
        lipSideRGB: '80,84,90', lipSideA: 0.32,
        grooveRGB: '60,64,70', grooveA: 0.5,
        grooveLight: 'rgba(245,247,250,0.55)',
        edgeHi: 'rgba(255,255,255,0.7)',
    };
    context.save();

    // ---- Proportions (all derived from screen width/height) ----
    const bezel = width * 0.018;             // dark bezel thickness around screen
    const lidLeft = x - bezel;
    const lidTop = y - bezel;
    const lidW = width + bezel * 2;
    const lidH = height + bezel * 2;
    const lidRadius = radius + bezel * 0.85;

    // Base (laptop deck) geometry below the lid (kept under height*0.14 total)
    const deckBandH = height * 0.03;         // lighter "keyboard deck" sliver + seam (open-lid hint)
    const deckTopY = lidTop + lidH;          // top of the deck top-surface band
    const lipTopY = deckTopY + deckBandH;    // top of the front aluminium lip
    const lipH = height * 0.06;              // front lip height
    const baseBottomY = lipTopY + lipH;      // bottom of laptop base
    const baseOverhang = width * 0.075;      // base is wider than lid each side
    const baseLeft = x - baseOverhang;
    const baseRight = x + width + baseOverhang;
    const baseW = baseRight - baseLeft;
    const lipRadius = lipH * 0.5;
    const cx = x + width / 2;

    // helper: rounded-rect subpath (no beginPath, for even-odd composites)
    function rrPath(rx, ry, rw, rh, rr) {
      context.moveTo(rx + rr, ry);
      context.arcTo(rx + rw, ry, rx + rw, ry + rh, rr);
      context.arcTo(rx + rw, ry + rh, rx, ry + rh, rr);
      context.arcTo(rx, ry + rh, rx, ry, rr);
      context.arcTo(rx, ry, rx + rw, ry, rr);
      context.closePath();
    }

    // ============================================================
    // 1) CONTACT SHADOW under the whole machine
    // ============================================================
    context.save();
    context.shadowColor = 'rgba(0,0,0,0.38)';
    context.shadowBlur = height * 0.08;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = height * 0.05;
    context.fillStyle = 'rgba(0,0,0,1)';
    context.beginPath();
    rrPath(baseLeft + baseW * 0.04, lipTopY, baseW * 0.92, lipH, lipRadius);
    context.fill();
    context.restore();

    // reset shadow before crisp parts
    context.shadowColor = 'transparent';
    context.shadowBlur = 0;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = 0;

    // ============================================================
    // 2) LID — aluminium outer rim + dark bezel FRAME (screen stays visible)
    // ============================================================
    // Thin aluminium rim around the whole lid (drawn as ring via even-odd)
    const rim = bezel * 0.32;
    const rimGrad = context.createLinearGradient(0, lidTop - rim, 0, lidTop + lidH + rim);
    rimGrad.addColorStop(0, FIN.rim[0]);
    rimGrad.addColorStop(0.5, FIN.rim[1]);
    rimGrad.addColorStop(1, FIN.rim[2]);
    context.fillStyle = rimGrad;
    context.beginPath();
    rrPath(lidLeft - rim, lidTop - rim, lidW + rim * 2, lidH + rim * 2, lidRadius + rim);
    rrPath(lidLeft, lidTop, lidW, lidH, lidRadius);
    context.fill('evenodd');

    // Dark bezel ring: outer = lid rect, inner = screen rect (screenshot shows through)
    const bezelGrad = context.createLinearGradient(0, lidTop, 0, lidTop + lidH);
    bezelGrad.addColorStop(0, '#1a1b1f');
    bezelGrad.addColorStop(0.5, '#0c0d0f');
    bezelGrad.addColorStop(1, '#141517');
    context.fillStyle = bezelGrad;
    context.beginPath();
    rrPath(lidLeft, lidTop, lidW, lidH, lidRadius);
    rrPath(x, y, width, height, radius);
    context.fill('evenodd');

    // subtle inner shadow line just inside the screen edge for depth
    context.save();
    context.beginPath();
    rrPath(x, y, width, height, radius);
    context.clip();
    context.strokeStyle = 'rgba(0,0,0,0.5)';
    context.lineWidth = Math.max(1, bezel * 0.18);
    context.beginPath();
    rrPath(x + context.lineWidth * 0.5, y + context.lineWidth * 0.5,
           width - context.lineWidth, height - context.lineWidth, radius);
    context.stroke();
    context.restore();

    // Camera notch dot at top-center of bezel
    const camR = Math.max(1, bezel * 0.16);
    context.fillStyle = '#23262c';
    context.beginPath();
    context.arc(cx, lidTop + bezel * 0.5, camR, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#0c1418';
    context.beginPath();
    context.arc(cx, lidTop + bezel * 0.5, camR * 0.55, 0, Math.PI * 2);
    context.fill();

    // ============================================================
    // 3) KEYBOARD-DECK TOP SURFACE SLIVER (the 3D "open lid" hint)
    //    A lighter aluminium band seen in perspective (trapezoid widening
    //    toward the wider base) PLUS a crisp dark seam where the lid bottom
    //    edge meets it — that gap is what sells "the lid is open".
    // ============================================================
    // dark seam / gap directly under the lid (hinge shadow line)
    const seamH = deckBandH * 0.34;
    const seamGrad = context.createLinearGradient(0, deckTopY, 0, deckTopY + seamH);
    seamGrad.addColorStop(0, 'rgba(15,16,18,0.92)');
    seamGrad.addColorStop(1, 'rgba(70,73,78,0.25)');
    context.fillStyle = seamGrad;
    context.beginPath();
    context.moveTo(lidLeft + lidRadius * 0.35, deckTopY);
    context.lineTo(lidLeft + lidW - lidRadius * 0.35, deckTopY);
    context.lineTo(lidLeft + lidW - lidRadius * 0.35 + width * 0.01, deckTopY + seamH);
    context.lineTo(lidLeft + lidRadius * 0.35 - width * 0.01, deckTopY + seamH);
    context.closePath();
    context.fill();

    // the bright top-surface band itself (flat-ish, lit from above)
    const bandTopY = deckTopY + seamH;
    const deckGrad = context.createLinearGradient(0, bandTopY, 0, lipTopY);
    deckGrad.addColorStop(0, FIN.deck[0]);   // bright leading edge of the deck
    deckGrad.addColorStop(0.55, FIN.deck[1]);
    deckGrad.addColorStop(1, FIN.deck[2]);   // toward the front lip
    context.fillStyle = deckGrad;
    context.beginPath();
    context.moveTo(lidLeft + lidRadius * 0.35 - width * 0.01, bandTopY);
    context.lineTo(lidLeft + lidW - lidRadius * 0.35 + width * 0.01, bandTopY);
    context.lineTo(baseRight - lipRadius, lipTopY);
    context.lineTo(baseLeft + lipRadius, lipTopY);
    context.closePath();
    context.fill();

    // crisp bright catch-light along the deck's leading (top) edge
    context.strokeStyle = FIN.edgeHi;
    context.lineWidth = Math.max(1, height * 0.0022);
    context.beginPath();
    context.moveTo(lidLeft + lidRadius * 0.35 - width * 0.01 + 2, bandTopY + context.lineWidth);
    context.lineTo(lidLeft + lidW - lidRadius * 0.35 + width * 0.01 - 2, bandTopY + context.lineWidth);
    context.stroke();

    // ============================================================
    // 4) FRONT ALUMINIUM LIP (two-tone, rounded front, finger groove)
    //    Two-tone: bright top edge (catching overhead light) rolling into
    //    a darker mid front face, then a soft brighter bounce near the floor.
    // ============================================================
    const lipGrad = context.createLinearGradient(0, lipTopY, 0, baseBottomY);
    lipGrad.addColorStop(0, FIN.lip[0]);    // crisp top edge highlight
    lipGrad.addColorStop(0.10, FIN.lip[1]);
    lipGrad.addColorStop(0.34, FIN.lip[2]);
    lipGrad.addColorStop(0.62, FIN.lip[3]); // front face (darker tone)
    lipGrad.addColorStop(0.86, FIN.lip[4]);
    lipGrad.addColorStop(1, FIN.lip[5]);    // soft bounce light at the rounded bottom
    context.fillStyle = lipGrad;
    context.beginPath();
    rrPath(baseLeft, lipTopY, baseW, lipH, lipRadius);
    context.fill();

    // vertical falloff darkening toward the corners (cylindrical look)
    const lipSide = context.createLinearGradient(baseLeft, 0, baseRight, 0);
    lipSide.addColorStop(0, `rgba(${FIN.lipSideRGB},${FIN.lipSideA})`);
    lipSide.addColorStop(0.12, `rgba(${FIN.lipSideRGB},0)`);
    lipSide.addColorStop(0.88, `rgba(${FIN.lipSideRGB},0)`);
    lipSide.addColorStop(1, `rgba(${FIN.lipSideRGB},${FIN.lipSideA})`);
    context.fillStyle = lipSide;
    context.beginPath();
    rrPath(baseLeft, lipTopY, baseW, lipH, lipRadius);
    context.fill();

    // bright top highlight edge of the lip
    context.strokeStyle = FIN.edgeHi;
    context.lineWidth = Math.max(1, height * 0.0028);
    context.beginPath();
    context.moveTo(baseLeft + lipRadius, lipTopY + context.lineWidth * 0.7);
    context.lineTo(baseRight - lipRadius, lipTopY + context.lineWidth * 0.7);
    context.stroke();

    // finger groove: a wide, shallow, soft scoop centered on the front lip.
    // Two stacked soft fills (shadow above, highlight lip below) read as a recess.
    const grooveW = width * 0.2;
    const grooveTop = lipTopY + lipH * 0.12;
    const grooveBot = baseBottomY - lipH * 0.04;
    const grooveH = grooveBot - grooveTop;
    // shadow of the scoop
    const gShadow = context.createLinearGradient(0, grooveTop, 0, grooveBot);
    gShadow.addColorStop(0, `rgba(${FIN.grooveRGB},0)`);
    gShadow.addColorStop(0.35, `rgba(${FIN.grooveRGB},${FIN.grooveA})`);
    gShadow.addColorStop(1, `rgba(${FIN.grooveRGB},0)`);
    context.fillStyle = gShadow;
    context.beginPath();
    rrPath(cx - grooveW / 2, grooveTop, grooveW, grooveH, grooveH * 0.5);
    context.fill();
    // thin bright catch-light along the bottom of the scoop
    context.strokeStyle = FIN.grooveLight;
    context.lineWidth = Math.max(1, lipH * 0.05);
    context.beginPath();
    context.moveTo(cx - grooveW * 0.42, grooveBot - context.lineWidth);
    context.lineTo(cx + grooveW * 0.42, grooveBot - context.lineWidth);
    context.stroke();

    context.restore();
}

// Shared: draw a rounded highlight box behind a single line of text.
// baselineTop = true when the context baseline is 'top', false when 'bottom'.
function drawTextHighlight(context, cx, y, textWidth, fontSize, baselineTop, color, alpha) {
    if (!alpha || alpha <= 0 || textWidth <= 0) return;
    const hpad = fontSize * 0.34, vpad = fontSize * 0.16, r = fontSize * 0.24;
    const top = baselineTop ? y - vpad : y - fontSize - vpad;
    const h = fontSize + vpad * 2;
    context.save();
    context.globalAlpha = alpha;
    context.fillStyle = color;
    context.beginPath();
    context.roundRect(cx - textWidth / 2 - hpad, top, textWidth + hpad * 2, h, r);
    context.fill();
    context.restore();
}

// Panorama: build the text settings for screen `p`. Each panel has its own full
// text object (style + content) in container.panelTexts; older projects fall back
// to per-panel content (panelHeadlines/panelSubheadlines) over the shared style.
function makePanelTxt(txt, p) {
    if (Array.isArray(txt.panelTexts) && txt.panelTexts[p]) {
        txt.panelTexts[p] = normalizeTextSettings(txt.panelTexts[p]);
        const panel = txt.panelTexts[p];
        syncPanelLanguage(panel, txt);
        panel.autoFit = txt.autoFit;
        panel.textZone = txt.textZone;
        return panel;
    }
    const lang = txt.currentHeadlineLang || 'en';
    const slang = txt.currentSubheadlineLang || 'en';
    const ph = (txt.panelHeadlines && txt.panelHeadlines[lang] && txt.panelHeadlines[lang][p]) || '';
    const ps = (txt.panelSubheadlines && txt.panelSubheadlines[slang] && txt.panelSubheadlines[slang][p]) || '';
    return Object.assign({}, txt, {
        headlines: Object.assign({}, txt.headlines, { [lang]: ph }),
        subheadlines: Object.assign({}, txt.subheadlines, { [slang]: ps }),
        perScreenText: false
    });
}

// Draw text, honoring per-screen panorama text (one text block centered per panel).
function drawTextWithPanorama(context, dims, txt) {
    const span = dims.span || 1;
    if (txt && txt.perScreenText && span > 1) {
        const baseW = dims.baseWidth || (dims.width / span);
        for (let p = 0; p < span; p++) {
            context.save();
            context.translate(p * baseW, 0);
            drawTextToContext(context, { width: baseW, height: dims.height }, makePanelTxt(txt, p));
            context.restore();
        }
    } else {
        drawTextToContext(context, dims, txt);
    }
}

// Measure the vertical extent {top, bottom} of the text block without drawing,
// replaying drawTextToContext's layout maths. Returns null if no text.
// Measures the vertical extent of the text block. `fontScale` shrinks the FONT
// size only (used by auto-fit) — the wrap width stays full, so reducing it makes
// the text reflow over the same width and just get shorter, never narrower.
function textVerticalExtent(context, dims, txt, fontScale, wrapWidth) {
    fontScale = fontScale || 1;
    const headlineEnabled = txt.headlineEnabled !== false;
    const subheadlineEnabled = txt.subheadlineEnabled || false;
    const headlineLang = txt.currentHeadlineLang || 'en';
    const subheadlineLang = txt.currentSubheadlineLang || 'en';
    const headlineLayout = getEffectiveLayout(txt, headlineLang);
    const subheadlineLayout = getEffectiveLayout(txt, subheadlineLang);
    const layoutSettings = getEffectiveLayout(txt, getTextLayoutLanguage(txt));
    const headline = headlineEnabled && txt.headlines ? (txt.headlines[headlineLang] || '') : '';
    const subheadline = subheadlineEnabled && txt.subheadlines ? (txt.subheadlines[subheadlineLang] || '') : '';
    if (!headline && !subheadline) return null;
    const hSize = headlineLayout.headlineSize * fontScale;
    const sSize = subheadlineLayout.subheadlineSize * fontScale;
    const padding = dims.width * 0.08;
    const ww = (typeof wrapWidth === 'number' && wrapWidth > 0) ? wrapWidth : (dims.width - padding * 2);
    const isTop = layoutSettings.position === 'top';
    const textY = isTop ? dims.height * (layoutSettings.offsetY / 100) : dims.height * (1 - layoutSettings.offsetY / 100);
    let top = Infinity, bottom = -Infinity, currentY = textY;
    if (headline) {
        context.font = `${txt.headlineItalic ? 'italic' : 'normal'} ${txt.headlineWeight} ${hSize}px ${txt.headlineFont}`;
        const lines = wrapText(context, headline, ww);
        const lineHeight = hSize * (layoutSettings.lineHeight / 100);
        if (!isTop) currentY -= (lines.length - 1) * lineHeight;
        lines.forEach((_, i) => {
            const y = currentY + i * lineHeight;
            top = Math.min(top, isTop ? y : y - hSize);
            bottom = Math.max(bottom, isTop ? y + hSize : y);
        });
        const lastLineY = currentY + (lines.length - 1) * lineHeight;
        const gap = lineHeight - hSize;
        currentY = (isTop ? lastLineY + hSize + gap : lastLineY + gap) + (txt.subheadlineSpacing || 0) * fontScale;
    }
    if (subheadline) {
        context.font = `${txt.subheadlineItalic ? 'italic' : 'normal'} ${txt.subheadlineWeight || '400'} ${sSize}px ${txt.subheadlineFont || txt.headlineFont}`;
        const lines = wrapText(context, subheadline, ww);
        const subLineHeight = sSize * 1.4;
        lines.forEach((_, i) => {
            const y = currentY + i * subLineHeight;
            top = Math.min(top, y);
            bottom = Math.max(bottom, y + sSize);
        });
    }
    if (!isFinite(top) || !isFinite(bottom)) return null;
    return { top, bottom };
}

// Compute whether the text overflows its allotted space, and the scale needed to
// fit it (1 = fits). The text must clear both the device image (last drawn rect in
// window.__imgRect) AND the canvas edge, so big text is never clipped — it shrinks
// to fit even when there is no device image on the screen.
function computeTextFit(context, dims, txt) {
    const rect = (typeof window !== 'undefined') ? window.__imgRect : null;
    const ext = textVerticalExtent(context, dims, txt, 1);
    if (!ext) return { scale: 1, fontScale: 1, overlaps: false };
    const isTop = getEffectiveLayout(txt, getTextLayoutLanguage(txt)).position === 'top';
    const gap = dims.height * 0.02;   // clearance from the device image
    const edge = dims.height * 0.02;  // margin kept from the canvas edge
    const hasDevice = !!(rect && rect.has);
    const blockH = ext.bottom - ext.top;
    // The text is anchored at a fixed edge (top of the block for 'top', bottom for
    // 'bottom') and grows toward the opposite side. Space available is the distance
    // from that anchor to the nearest limit: the device image or the canvas edge.
    let avail;
    if (isTop) {
        let limit = dims.height - edge; // canvas bottom edge
        if (hasDevice) limit = Math.min(limit, rect.y - gap); // device top edge
        avail = limit - ext.top;
    } else {
        let limit = edge; // canvas top edge
        if (hasDevice) limit = Math.max(limit, rect.y + rect.h + gap); // device bottom edge
        avail = ext.bottom - limit;
    }
    const overlaps = blockH > 0 && blockH > avail;
    if (!overlaps) return { scale: 1, fontScale: 1, overlaps: false };
    // Find the largest font scale whose re-wrapped block fits the available height.
    // (Smaller font reflows over the same full width, so the block only shrinks
    // vertically — the width is preserved.)
    // A phone canvas never needs to shrink text below 35%; a watch canvas is a
    // third the width, so the same headline needs three times the headroom
    // before it fits (cf. zoneFitForText's FLOOR of 0.1).
    const FLOOR = smallCanvasScale(dims) < 1 ? 0.10 : 0.35;
    let lo = FLOOR, hi = 1, best = FLOOR;
    for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        const e = textVerticalExtent(context, dims, txt, mid);
        const h = e ? e.bottom - e.top : 0;
        if (h <= avail) { best = mid; lo = mid; } else { hi = mid; }
    }
    return { scale: best, fontScale: best, overlaps: true };
}

// Characters wrapText() may break AFTER: CJK (incl. kana and fullwidth forms) and
// Thai are written without spaces, so a long run of them is not a "word" that has
// to fit on one line — the wrapper breaks them per character. Treating such a run
// as one unbreakable word would shrink the whole block to a fraction of the size
// that actually fits, and with "same size for all languages" that one language
// would drag every other one down with it.
const BREAKABLE_CHAR_RE = /[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u0E00-\u0E7F]/;

// Widest run of characters in `str` that must stay on one line: whitespace and
// breakable (CJK/Thai) characters end a run, and each breakable character counts
// as a run of its own.
function widestUnbreakableRun(context, str) {
    let max = 0;
    let run = '';
    const flush = () => {
        if (run) { max = Math.max(max, context.measureText(run).width); run = ''; }
    };
    for (const ch of String(str)) {
        if (/\s/.test(ch)) { flush(); continue; }
        if (BREAKABLE_CHAR_RE.test(ch)) {
            flush();
            max = Math.max(max, context.measureText(ch).width);
            continue;
        }
        run += ch;
    }
    flush();
    return max;
}

// Largest pixel width of any single unbreakable word across the headline and
// subheadline, measured at `fontScale`. Used by the text zone to keep words from
// being broken mid-word: the zone shrinks until the widest word fits its width.
function maxWordWidth(context, txt, fontScale) {
    fontScale = fontScale || 1;
    const headlineEnabled = txt.headlineEnabled !== false;
    const subheadlineEnabled = txt.subheadlineEnabled || false;
    const headlineLang = txt.currentHeadlineLang || 'en';
    const subheadlineLang = txt.currentSubheadlineLang || 'en';
    const headlineLayout = getEffectiveLayout(txt, headlineLang);
    const subheadlineLayout = getEffectiveLayout(txt, subheadlineLang);
    const headline = headlineEnabled && txt.headlines ? (txt.headlines[headlineLang] || '') : '';
    const subheadline = subheadlineEnabled && txt.subheadlines ? (txt.subheadlines[subheadlineLang] || '') : '';
    let maxW = 0;
    const measureWords = (str) => {
        maxW = Math.max(maxW, widestUnbreakableRun(context, str));
    };
    if (headline) {
        context.font = `${txt.headlineItalic ? 'italic' : 'normal'} ${txt.headlineWeight} ${headlineLayout.headlineSize * fontScale}px ${txt.headlineFont}`;
        measureWords(headline);
    }
    if (subheadline) {
        context.font = `${txt.subheadlineItalic ? 'italic' : 'normal'} ${txt.subheadlineWeight || '400'} ${subheadlineLayout.subheadlineSize * fontScale}px ${txt.subheadlineFont || txt.headlineFont}`;
        measureWords(subheadline);
    }
    return maxW;
}

// Font scale that makes the whole text block FILL the zone rectangle for the
// language currently selected on `txt`: it reflows at the zone width and the font
// grows or shrinks so the wrapped block is as large as possible while still fitting
// the zone height, and the widest single word still fits the zone width on one line
// (no mid-word break). So short text grows and wraps to fill the box; long text
// shrinks.
function zoneFitForText(context, dims, txt, zone) {
    const zw = Math.max(1, dims.width * (zone.width / 100));
    const zh = Math.max(1, dims.height * (zone.height / 100));
    const FLOOR = 0.1, CEIL = 6;
    const fitsHeight = (s) => {
        const e = textVerticalExtent(context, dims, txt, s, zw);
        return !e || (e.bottom - e.top) <= zh;
    };
    // Largest scale in [FLOOR, CEIL] whose re-wrapped block fits the zone height.
    // A bigger font wraps into more (and taller) lines, so height-fit is monotonic
    // in the scale and a binary search finds the tightest fit.
    let best;
    if (fitsHeight(CEIL)) {
        best = CEIL;
    } else {
        let lo = FLOOR, hi = CEIL;
        best = FLOOR;
        for (let i = 0; i < 18; i++) {
            const mid = (lo + hi) / 2;
            if (fitsHeight(mid)) { best = mid; lo = mid; } else { hi = mid; }
        }
    }
    // Never let a word overflow the zone width: cap the scale so the widest word
    // still fits on one line. Word width scales linearly with the font, so this is a
    // direct ratio — it both prevents mid-word breaks and bounds growth on a wide
    // zone to where the longest word spans it.
    const mw = maxWordWidth(context, txt, 1);
    if (mw > 0) best = Math.min(best, zw / mw);
    return Math.max(FLOOR, Math.min(CEIL, best));
}

// Font scale for the zone. By default ("uniform") the scale is the smallest that
// fits EVERY project language, then applied to all of them — so the text stays
// inside the zone and keeps a consistent size no matter the language. With uniform
// off, each language is fitted independently (only the current one is measured).
//
// `fill` decides what happens when the text is SMALLER than the zone:
//   off (default) — the configured font size is a ceiling: long text shrinks to
//     fit, short text is left at its designed size. Screens keep a consistent
//     typographic scale, which is what a set of store screenshots wants.
//   on            — the text also grows until it reaches the edge of the box, so
//     the rectangle is always exactly filled.
// The cap applies to both branches, so a project behaves the same whether it has
// one language or twenty.
function computeZoneFit(context, dims, txt, zone) {
    const cap = zone.fill ? Infinity : 1;
    const langs = (typeof state !== 'undefined' && Array.isArray(state.projectLanguages))
        ? state.projectLanguages : null;
    if (zone.uniform !== false && langs && langs.length > 1) {
        let best = cap;
        for (const L of langs) {
            const t = Object.assign({}, txt, {
                currentHeadlineLang: L,
                currentSubheadlineLang: L,
                currentLayoutLang: L
            });
            best = Math.min(best, zoneFitForText(context, dims, t, zone));
        }
        return best;
    }
    return Math.min(cap, zoneFitForText(context, dims, txt, zone));
}

function drawTextToContext(context, dims, txt) {
    // Check enabled states (default headline to true for backwards compatibility)
    const headlineEnabled = txt.headlineEnabled !== false;
    const subheadlineEnabled = txt.subheadlineEnabled || false;

    const headlineLang = txt.currentHeadlineLang || 'en';
    const subheadlineLang = txt.currentSubheadlineLang || 'en';
    const layoutLang = getTextLayoutLanguage(txt);
    const headlineLayout = getEffectiveLayout(txt, headlineLang);
    const subheadlineLayout = getEffectiveLayout(txt, subheadlineLang);
    const layoutSettings = getEffectiveLayout(txt, layoutLang);

    const headline = headlineEnabled && txt.headlines ? (txt.headlines[headlineLang] || '') : '';
    const subheadline = subheadlineEnabled && txt.subheadlines ? (txt.subheadlines[subheadlineLang] || '') : '';

    if (!headline && !subheadline) return;

    // Optional text zone: confine the headline + subheadline to a user-defined
    // rectangle and shrink the font so the whole block fits inside it, never
    // breaking a word across lines. When active it overrides the normal
    // position/offset placement and the overlap auto-fit.
    const zone = (txt.textZone && txt.textZone.enabled) ? txt.textZone : null;

    // Auto-fit: reduce the FONT SIZE (not the width) so the text reflows over the
    // same full width and only gets shorter, keeping it clear of the device and
    // inside the canvas so it is never clipped.
    let fontScale = 1;
    if (zone) {
        fontScale = computeZoneFit(context, dims, txt, zone);
    } else if (txt && txt.autoFit) {
        const fit = computeTextFit(context, dims, txt);
        if (fit.overlaps && fit.fontScale < 0.999) fontScale = fit.fontScale;
    }
    const hSize = headlineLayout.headlineSize * fontScale;
    const sSize = subheadlineLayout.subheadlineSize * fontScale;

    const padding = dims.width * 0.08;
    // Wrap width and horizontal centre: the zone constrains both so the text
    // reflows inside the zone and is centred within it.
    const wrapWidth = zone ? Math.max(1, dims.width * (zone.width / 100)) : (dims.width - padding * 2);
    const centerX = zone ? (dims.width * (zone.x / 100) + wrapWidth / 2) : (dims.width / 2);
    // Vertical anchor: the zone centres the block inside the rectangle and always
    // grows top→down; otherwise keep the existing top/bottom anchored behaviour.
    const effPosition = zone ? 'top' : layoutSettings.position;
    let textY;
    if (zone) {
        const ext = textVerticalExtent(context, dims, txt, fontScale, wrapWidth);
        const blockH = ext ? (ext.bottom - ext.top) : 0;
        const zoneTop = dims.height * (zone.y / 100);
        const zoneH = dims.height * (zone.height / 100);
        textY = zoneTop + Math.max(0, (zoneH - blockH) / 2);
    } else {
        textY = effPosition === 'top'
            ? dims.height * (layoutSettings.offsetY / 100)
            : dims.height * (1 - layoutSettings.offsetY / 100);
    }

    context.textAlign = 'center';
    context.textBaseline = effPosition === 'top' ? 'top' : 'bottom';

    let currentY = textY;

    // Draw headline
    if (headline) {
        const fontStyle = txt.headlineItalic ? 'italic' : 'normal';
        context.font = `${fontStyle} ${txt.headlineWeight} ${hSize}px ${txt.headlineFont}`;
        context.fillStyle = txt.headlineColor;

        const lines = wrapText(context, headline, wrapWidth);
        const lineHeight = hSize * (layoutSettings.lineHeight / 100);

        // For bottom positioning, offset currentY so lines draw correctly
        if (effPosition === 'bottom') {
            currentY -= (lines.length - 1) * lineHeight;
        }

        let lastLineY;
        const hlBaselineTop = effPosition === 'top';
        lines.forEach((line, i) => {
            const y = currentY + i * lineHeight;
            lastLineY = y;
            if (txt.headlineBgOpacity > 0) {
                drawTextHighlight(context, centerX, y, context.measureText(line).width, hSize, hlBaselineTop, txt.headlineBgColor || '#000000', txt.headlineBgOpacity / 100);
            }
            context.fillText(line, centerX, y);

            // Calculate text metrics for decorations
            const textWidth = context.measureText(line).width;
            const fontSize = hSize;
            const lineThickness = Math.max(2, fontSize * 0.05);
            const x = centerX - textWidth / 2;

            // Draw underline
            if (txt.headlineUnderline) {
                const underlineY = effPosition === 'top'
                    ? y + fontSize * 0.9
                    : y + fontSize * 0.1;
                context.fillRect(x, underlineY, textWidth, lineThickness);
            }

            // Draw strikethrough
            if (txt.headlineStrikethrough) {
                const strikeY = effPosition === 'top'
                    ? y + fontSize * 0.4
                    : y - fontSize * 0.4;
                context.fillRect(x, strikeY, textWidth, lineThickness);
            }
        });

        // Track where subheadline should start (below the bottom edge of headline)
        // The gap between headline and subheadline should be (lineHeight - fontSize)
        // This is the "extra" spacing beyond the text itself
        const gap = lineHeight - hSize;
        if (effPosition === 'top') {
            // For top: lastLineY is top of last line, add fontSize to get bottom, then add gap
            currentY = lastLineY + hSize + gap;
        } else {
            // For bottom: lastLineY is already the bottom of last line, just add gap
            currentY = lastLineY + gap;
        }
        currentY += (txt.subheadlineSpacing || 0) * fontScale; // extra title→subtitle spacing
    }

    // Draw subheadline (always below headline visually)
    if (subheadline) {
        const subFontStyle = txt.subheadlineItalic ? 'italic' : 'normal';
        const subWeight = txt.subheadlineWeight || '400';
        context.font = `${subFontStyle} ${subWeight} ${sSize}px ${txt.subheadlineFont || txt.headlineFont}`;
        context.fillStyle = hexToRgba(txt.subheadlineColor, txt.subheadlineOpacity / 100);

        const lines = wrapText(context, subheadline, wrapWidth);
        const subLineHeight = sSize * 1.4;

        // Subheadline starts after headline with gap determined by headline lineHeight
        // For bottom position, switch to 'top' baseline so subheadline draws downward
        const subY = currentY;
        if (effPosition === 'bottom') {
            context.textBaseline = 'top';
        }

        lines.forEach((line, i) => {
            const y = subY + i * subLineHeight;
            if (txt.subheadlineBgOpacity > 0) {
                drawTextHighlight(context, centerX, y, context.measureText(line).width, sSize, true, txt.subheadlineBgColor || '#000000', txt.subheadlineBgOpacity / 100);
                context.fillStyle = hexToRgba(txt.subheadlineColor, txt.subheadlineOpacity / 100);
            }
            context.fillText(line, centerX, y);

            // Calculate text metrics for decorations
            const textWidth = context.measureText(line).width;
            const fontSize = sSize;
            const lineThickness = Math.max(2, fontSize * 0.05);
            const x = centerX - textWidth / 2;

            // Draw underline (using 'top' baseline for subheadline)
            if (txt.subheadlineUnderline) {
                const underlineY = y + fontSize * 0.9;
                context.fillRect(x, underlineY, textWidth, lineThickness);
            }

            // Draw strikethrough
            if (txt.subheadlineStrikethrough) {
                const strikeY = y + fontSize * 0.4;
                context.fillRect(x, strikeY, textWidth, lineThickness);
            }
        });

        // Restore baseline if we changed it
        if (effPosition === 'bottom') {
            context.textBaseline = 'bottom';
        }
    }
}

// Draw elements for the current screenshot at a specific layer
function drawElements(context, dims, layer) {
    const elements = getElements();
    drawElementsToContext(context, dims, elements, layer);
}

// Draw elements to any context (for side previews and export)
function drawElementsToContext(context, dims, elements, layer) {
    const filtered = elements.filter(el => el.layer === layer);
    filtered.forEach(el => {
        context.save();
        context.globalAlpha = el.opacity / 100;

        const cx = dims.width * (el.x / 100);
        const cy = dims.height * (el.y / 100);
        const elWidth = dims.width * (el.width / 100);

        context.translate(cx, cy);
        if (el.rotation !== 0) {
            context.rotate(el.rotation * Math.PI / 180);
        }

        if (el.type === 'emoji' && el.emoji) {
            const emojiSize = elWidth * 0.85;
            context.font = `${emojiSize}px "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
            context.textAlign = 'center';
            context.textBaseline = 'middle';
            context.fillText(el.emoji, 0, 0);
        } else if (el.type === 'icon' && el.image) {
            // Shadow
            if (el.iconShadow?.enabled) {
                const s = el.iconShadow;
                const hex = s.color || '#000000';
                const r = parseInt(hex.slice(1,3), 16);
                const g = parseInt(hex.slice(3,5), 16);
                const b = parseInt(hex.slice(5,7), 16);
                context.shadowColor = `rgba(${r},${g},${b},${(s.opacity || 0) / 100})`;
                context.shadowBlur = s.blur || 0;
                context.shadowOffsetX = s.x || 0;
                context.shadowOffsetY = s.y || 0;
            }
            // Icons are square (1:1)
            context.drawImage(el.image, -elWidth / 2, -elWidth / 2, elWidth, elWidth);
            // Reset shadow
            if (el.iconShadow?.enabled) {
                context.shadowColor = 'transparent';
                context.shadowBlur = 0;
                context.shadowOffsetX = 0;
                context.shadowOffsetY = 0;
            }
        } else if (el.type === 'graphic' && el.image) {
            const aspect = el.image.height / el.image.width;
            const elHeight = elWidth * aspect;
            context.drawImage(el.image, -elWidth / 2, -elHeight / 2, elWidth, elHeight);
        } else if (el.type === 'text') {
            const elText = getElementText(el);
            if (!elText) { context.restore(); return; }
            const fontStyle = el.italic ? 'italic' : 'normal';
            context.font = `${fontStyle} ${el.fontWeight} ${el.fontSize}px ${el.font}`;
            context.fillStyle = el.fontColor;
            context.textAlign = 'center';
            context.textBaseline = 'middle';

            // Word-wrap text within element width (respects manual line breaks)
            const lines = wrapText(context, elText, elWidth);
            const lineHeight = el.fontSize * 1.05;
            const totalHeight = (lines.length - 1) * lineHeight + el.fontSize;

            // Draw frame behind text if enabled
            if (el.frame && el.frame !== 'none') {
                drawElementFrame(context, el, dims, elWidth, totalHeight);
            }

            // Draw text lines
            const startY = -(totalHeight / 2) + el.fontSize / 2;
            lines.forEach((line, i) => {
                context.fillText(line, 0, startY + i * lineHeight);
            });
        }

        context.restore();
    });
}

// ===== Popout rendering =====
function drawPopouts(context, dims) {
    const screenshot = getCurrentScreenshot();
    if (!screenshot) return;
    const img = getScreenshotImage(screenshot);
    if (!img) return;
    const popouts = screenshot.popouts || [];
    const ss = getScreenshotSettings();
    drawPopoutsToContext(context, dims, popouts, img, ss);
}

function drawPopoutsToContext(context, dims, popouts, img, screenshotSettings) {
    if (!img || !popouts || popouts.length === 0) return;

    popouts.forEach(p => {
        context.save();
        context.globalAlpha = p.opacity / 100;

        // Crop from source image (percentages -> pixels)
        const sx = (p.cropX / 100) * img.width;
        const sy = (p.cropY / 100) * img.height;
        const sw = (p.cropWidth / 100) * img.width;
        const sh = (p.cropHeight / 100) * img.height;

        // Display position and size (percentages -> canvas pixels)
        const displayW = dims.width * (p.width / 100);
        const cropAspect = sh / sw;
        const displayH = displayW * cropAspect;
        const cx = dims.width * (p.x / 100);
        const cy = dims.height * (p.y / 100);

        context.translate(cx, cy);

        // Apply popout's own rotation only (no 3D transform inheritance)
        if (p.rotation !== 0) {
            context.rotate(p.rotation * Math.PI / 180);
        }

        const halfW = displayW / 2;
        const halfH = displayH / 2;
        const radius = p.cornerRadius * (displayW / 300);

        // Draw shadow
        if (p.shadow && p.shadow.enabled) {
            const shadowOpacity = p.shadow.opacity / 100;
            const hex = p.shadow.color || '#000000';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            context.shadowColor = `rgba(${r},${g},${b},${shadowOpacity})`;
            context.shadowBlur = p.shadow.blur;
            context.shadowOffsetX = p.shadow.x;
            context.shadowOffsetY = p.shadow.y;

            context.fillStyle = '#000';
            context.beginPath();
            context.roundRect(-halfW, -halfH, displayW, displayH, radius);
            context.fill();

            context.shadowColor = 'transparent';
            context.shadowBlur = 0;
            context.shadowOffsetX = 0;
            context.shadowOffsetY = 0;
        }

        // Draw border behind the image
        if (p.border && p.border.enabled) {
            const bw = p.border.width;
            context.save();
            context.globalAlpha = (p.opacity / 100) * (p.border.opacity / 100);
            context.fillStyle = p.border.color;
            context.beginPath();
            context.roundRect(-halfW - bw, -halfH - bw, displayW + bw * 2, displayH + bw * 2, radius + bw);
            context.fill();
            context.restore();
        }

        // Clip and draw cropped image
        context.beginPath();
        context.roundRect(-halfW, -halfH, displayW, displayH, radius);
        context.clip();
        context.drawImage(img, sx, sy, sw, sh, -halfW, -halfH, displayW, displayH);

        context.restore();
    });
}

// Draw decorative frames around text elements
function drawElementFrame(context, el, dims, textWidth, textHeight) {
    const scale = el.frameScale / 100;
    const padding = el.fontSize * 0.4 * scale;
    // Measure the widest line (using wrapText to match rendering)
    const elWidth = dims.width * (el.width / 100);
    const lines = wrapText(context, getElementText(el), elWidth);
    const maxLineW = Math.max(...lines.map(l => context.measureText(l).width));
    const frameW = maxLineW + padding * 2;
    const frameH = textHeight + padding * 2;

    context.save();
    context.strokeStyle = el.frameColor;
    context.fillStyle = 'none';
    context.lineWidth = Math.max(2, el.fontSize * 0.04) * scale;

    const isLaurel = el.frame.startsWith('laurel-');
    const hasStar = el.frame.endsWith('-star');

    if (isLaurel) {
        const variant = el.frame.includes('detailed') ? 'laurel-detailed-left' : 'laurel-simple-left';
        drawLaurelSVG(context, variant, frameW, frameH, scale, el.frameColor);
        if (hasStar) {
            drawStar(context, 0, -frameH / 2 - el.fontSize * 0.2 * scale, el.fontSize * 0.3 * scale, el.frameColor);
        }
    } else if (el.frame === 'badge-circle') {
        context.beginPath();
        const radius = Math.max(frameW, frameH) / 2 + padding * 0.5;
        context.arc(0, 0, radius, 0, Math.PI * 2);
        context.stroke();
    } else if (el.frame === 'badge-ribbon') {
        const sw = frameW + padding;
        const sh = frameH + padding * 1.5;
        context.beginPath();
        context.moveTo(-sw / 2, -sh / 2);
        context.lineTo(sw / 2, -sh / 2);
        context.lineTo(sw / 2, sh / 2 - padding);
        context.lineTo(0, sh / 2);
        context.lineTo(-sw / 2, sh / 2 - padding);
        context.closePath();
        context.stroke();
    }

    context.restore();
}

// Draw laurel wreath using SVG image — left branch + mirrored right branch
function drawLaurelSVG(context, variant, w, h, scale, color) {
    const img = laurelImages[variant];
    if (!img || !img.complete || !img.naturalWidth) return;

    // Scale SVG branch to match the frame height
    const branchH = h * 1.1 * scale;
    const aspect = img.naturalWidth / img.naturalHeight;
    const branchW = branchH * aspect;

    // The SVG is black fill — use a temp canvas to recolor it
    const tmp = document.createElement('canvas');
    tmp.width = Math.ceil(branchW);
    tmp.height = Math.ceil(branchH);
    const tctx = tmp.getContext('2d');

    // Draw the SVG scaled into the temp canvas
    tctx.drawImage(img, 0, 0, branchW, branchH);

    // Recolor: draw color on top using source-in composite
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = color;
    tctx.fillRect(0, 0, branchW, branchH);

    // Position: left branch sits to the left of the text area
    const gap = 2 * scale;
    const leftX = -w / 2 - branchW - gap;
    const topY = -branchH / 2;

    // Draw left branch
    context.drawImage(tmp, leftX, topY, branchW, branchH);

    // Draw right branch (mirrored horizontally)
    context.save();
    context.scale(-1, 1);
    context.drawImage(tmp, leftX, topY, branchW, branchH);
    context.restore();
}

// Draw a 5-point star
function drawStar(context, cx, cy, size, color) {
    context.save();
    context.fillStyle = color;
    context.beginPath();
    for (let i = 0; i < 5; i++) {
        const outer = (i * 2 * Math.PI / 5) - Math.PI / 2;
        const inner = outer + Math.PI / 5;
        const ox = cx + Math.cos(outer) * size;
        const oy = cy + Math.sin(outer) * size;
        const ix = cx + Math.cos(inner) * size * 0.4;
        const iy = cy + Math.sin(inner) * size * 0.4;
        if (i === 0) context.moveTo(ox, oy);
        else context.lineTo(ox, oy);
        context.lineTo(ix, iy);
    }
    context.closePath();
    context.fill();
    context.restore();
}

function drawBackground() {
    const dims = getCanvasDimensions();
    const bg = getBackground();

    if (bg.type === 'gradient') {
        const angle = bg.gradient.angle * Math.PI / 180;
        const x1 = dims.width / 2 - Math.cos(angle) * dims.width;
        const y1 = dims.height / 2 - Math.sin(angle) * dims.height;
        const x2 = dims.width / 2 + Math.cos(angle) * dims.width;
        const y2 = dims.height / 2 + Math.sin(angle) * dims.height;

        const gradient = ctx.createLinearGradient(x1, y1, x2, y2);
        bg.gradient.stops.forEach(stop => {
            gradient.addColorStop(stop.position / 100, stop.color);
        });

        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'solid') {
        ctx.fillStyle = bg.solid;
        ctx.fillRect(0, 0, dims.width, dims.height);
    } else if (bg.type === 'image' && bg.image) {
        const img = bg.image;
        let sx = 0, sy = 0, sw = img.width, sh = img.height;
        let dx = 0, dy = 0, dw = dims.width, dh = dims.height;

        if (bg.imageFit === 'cover') {
            const imgRatio = img.width / img.height;
            const canvasRatio = dims.width / dims.height;

            if (imgRatio > canvasRatio) {
                sw = img.height * canvasRatio;
                sx = (img.width - sw) / 2;
            } else {
                sh = img.width / canvasRatio;
                sy = (img.height - sh) / 2;
            }
        } else if (bg.imageFit === 'contain') {
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

        if (bg.imageBlur > 0) {
            ctx.filter = `blur(${bg.imageBlur}px)`;
        }

        ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
        ctx.filter = 'none';

        // Overlay
        if (bg.overlayOpacity > 0) {
            ctx.fillStyle = bg.overlayColor;
            ctx.globalAlpha = bg.overlayOpacity / 100;
            ctx.fillRect(0, 0, dims.width, dims.height);
            ctx.globalAlpha = 1;
        }
    }
}

function drawScreenshot() {
    // Single renderer for the main canvas, the side previews and the export:
    // this used to be a hand-copied twin of drawScreenshotToContext that had
    // drifted — it approximated the device's rounded corners with quadratic
    // curves where the shared renderer uses real elliptical arcs, so the preview
    // and the exported PNG disagreed on every corner and shadow edge.
    const dims = getCanvasDimensions();
    const screenshot = state.screenshots[state.selectedIndex];
    if (!screenshot) return;
    const img = getScreenshotImage(screenshot);
    if (!img) return;
    drawScreenshotToContext(ctx, dims, img, getScreenshotSettings());
}

function drawDeviceFrame(x, y, width, height) {
    const settings = getScreenshotSettings();
    const frameColor = settings.frame.color;
    const frameWidth = settings.frame.width * (width / 400); // Scale with image
    const frameOpacity = settings.frame.opacity / 100;
    const radius = settings.cornerRadius * (width / 400) + frameWidth;

    ctx.globalAlpha = frameOpacity;
    ctx.strokeStyle = frameColor;
    ctx.lineWidth = frameWidth;
    ctx.beginPath();
    roundRect(ctx, x - frameWidth / 2, y - frameWidth / 2, width + frameWidth, height + frameWidth, radius);
    ctx.stroke();
    ctx.globalAlpha = 1;
}

function drawText() {
    // Unified with the shared renderer so auto-fit, text background, spacing and
    // per-screen panorama all behave identically on the main canvas and in
    // previews/export.
    drawTextWithPanorama(ctx, getCanvasDimensions(), getContainerText());
}

function drawNoise() {
    const dims = getCanvasDimensions();
    const imageData = ctx.getImageData(0, 0, dims.width, dims.height);
    const data = imageData.data;
    const intensity = getBackground().noiseIntensity / 100 * 50;

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
    const lines = [];
    const rawLines = String(text).split(/\r?\n/);

    // Break a single token that's wider than maxWidth at the character level
    // (handles long compound words and scripts without spaces like CJK).
    function breakLongWord(word, startLine) {
        let currentLine = startLine;
        for (const ch of word) {
            const test = currentLine + ch;
            if (ctx.measureText(test).width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = ch;
            } else {
                currentLine = test;
            }
        }
        return currentLine;
    }

    rawLines.forEach((rawLine) => {
        if (rawLine === '') {
            lines.push('');
            return;
        }

        const words = rawLine.split(' ');
        let currentLine = '';

        words.forEach(word => {
            // If the word alone overflows, char-break it instead of overflowing.
            if (ctx.measureText(word).width > maxWidth) {
                if (currentLine) { lines.push(currentLine); currentLine = ''; }
                currentLine = breakLongWord(word, '');
                return;
            }
            const testLine = currentLine + (currentLine ? ' ' : '') + word;
            if (ctx.measureText(testLine).width > maxWidth && currentLine) {
                lines.push(currentLine);
                currentLine = word;
            } else {
                currentLine = testLine;
            }
        });

        if (currentLine) {
            lines.push(currentLine);
        }

    });

    return lines;
}

function hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ===== Off-screen export rendering =====
// Exports used to drive the VISIBLE preview canvas: they moved
// state.selectedIndex, called renderCanvasNow() and read the pixels back. That
// made every exported frame pay for a full-size repaint AND for
// scheduleSidePreviews(), which re-renders the four neighbouring previews
// through the whole pipeline (noise loop included) each time the selection
// changes — four extra full renders per screenshot, per language, that nobody
// sees while a ZIP is being built.
//
// Rendering into a detached canvas instead skips all of it. It is the same
// function the side previews use, so the output is pixel-identical to the
// preview; only the destination changes.
let _exportCanvas = null;
let _exportCtx = null;
function getExportSurface() {
    if (!_exportCanvas) {
        _exportCanvas = document.createElement('canvas');
        _exportCtx = _exportCanvas.getContext('2d');
    }
    return { canvas: _exportCanvas, ctx: _exportCtx };
}

// Render one screenshot at full output resolution, off-screen, and return its
// PNG panels (more than one only for panoramas).
function renderScreenshotPanels(index) {
    const { canvas: c, ctx: cx } = getExportSurface();
    const dims = getCanvasDimensions(index);
    renderScreenshotToCanvas(index, c, cx, dims, 1);
    return sliceCanvasToPanels(c, dims.span || 1);
}

// Let the browser paint the progress modal between frames. A plain setTimeout(0)
// costs a millisecond or two; the fixed 16 ms sleep this replaces was clamped up
// to ~38 ms in practice, which on a 40-language export is minutes of waiting.
function yieldToUI() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// Slice a (possibly panoramic) canvas into `span` equal vertical panels.
// Returns an array of PNG data URLs, left-to-right.
function sliceCanvasToPanels(srcCanvas, span) {
    if (!span || span <= 1) return [srcCanvas.toDataURL('image/png')];
    const panelW = Math.round(srcCanvas.width / span);
    const urls = [];
    for (let k = 0; k < span; k++) {
        const c = document.createElement('canvas');
        c.width = panelW;
        c.height = srcCanvas.height;
        const cx = c.getContext('2d');
        cx.drawImage(srcCanvas, k * panelW, 0, panelW, srcCanvas.height, 0, 0, panelW, srcCanvas.height);
        urls.push(c.toDataURL('image/png'));
    }
    return urls;
}

// Make sure every screenshot's image for `lang` (with the same fallback order as
// getScreenshotImage) is decoded before we render to an export canvas — images
// load lazily now, so a fresh language may not be in memory yet.
async function ensureLanguageImagesLoaded(lang) {
    const jobs = [];
    for (const s of state.screenshots) {
        const li = s.localizedImages;
        if (!li) continue;
        let entry = li[lang] && li[lang].src ? li[lang] : null;
        if (!entry) {
            for (const l of [...state.projectLanguages, ...Object.keys(li)]) {
                if (li[l]?.src) { entry = li[l]; break; }
            }
        }
        if (entry && entry.src && !entry.image && !entry._loading) {
            jobs.push(new Promise((res) => {
                const url = blobUrlForRef(entry.src);
                if (!url) return res();
                const img = new Image();
                img.decoding = 'async';
                if (!url.startsWith('data:')) img.crossOrigin = 'anonymous';
                img.onload = () => { entry.image = img; res(); };
                img.onerror = () => res();
                img.src = url;
            }));
        }
    }
    if (jobs.length) await Promise.all(jobs);
}

async function exportCurrent() {
    if (state.screenshots.length === 0) {
        await showAppAlert('Please upload a screenshot first', 'info');
        return;
    }

    // Make sure the current language's images are decoded (lazy loading), then render.
    await ensureLanguageImagesLoaded(state.currentLanguage);

    const panels = renderScreenshotPanels(state.selectedIndex);
    panels.forEach((url, k) => {
        const link = document.createElement('a');
        link.download = panels.length > 1
            ? `screenshot-${state.selectedIndex + 1}-panel-${k + 1}.png`
            : `screenshot-${state.selectedIndex + 1}.png`;
        link.href = url;
        link.click();
    });
}

async function exportAll() {
    if (state.screenshots.length === 0) {
        await showAppAlert('Please upload screenshots first', 'info');
        return;
    }

    // Check if project has multiple languages configured
    const hasMultipleLanguages = state.projectLanguages.length > 1;

    if (hasMultipleLanguages) {
        // Show language choice dialog
        showExportLanguageDialog(async (choice) => {
            if (choice === 'current') {
                await exportAllForLanguage(state.currentLanguage);
            } else if (choice === 'all') {
                await exportAllLanguages();
            }
        });
    } else {
        // Only one language, export directly
        await exportAllForLanguage(state.currentLanguage);
    }
}

// Show export progress modal
function showExportProgress(status, detail, percent) {
    const modal = document.getElementById('export-progress-modal');
    const statusEl = document.getElementById('export-progress-status');
    const detailEl = document.getElementById('export-progress-detail');
    const fillEl = document.getElementById('export-progress-fill');

    if (modal) modal.classList.add('visible');
    if (statusEl) statusEl.textContent = status;
    if (detailEl) detailEl.textContent = detail || '';
    if (fillEl) fillEl.style.width = `${percent}%`;
}

// Hide export progress modal
function hideExportProgress() {
    const modal = document.getElementById('export-progress-modal');
    if (modal) modal.classList.remove('visible');
}

// Export all screenshots for a specific language
async function exportAllForLanguage(lang) {
    const originalIndex = state.selectedIndex;
    const originalLang = state.currentLanguage;
    const zip = new JSZip();
    const total = state.screenshots.length;

    // Show progress
    const langName = languageNames[lang] || lang.toUpperCase();
    showExportProgress('Exporting...', `Preparing ${langName} screenshots`, 0);

    // Save original text languages for each screenshot
    const originalTextLangs = state.screenshots.map(s => ({
        headline: s.text.currentHeadlineLang,
        subheadline: s.text.currentSubheadlineLang
    }));

    // Temporarily switch to the target language (images and text)
    state.currentLanguage = lang;
    state.screenshots.forEach(s => {
        s.text.currentHeadlineLang = lang;
        s.text.currentSubheadlineLang = lang;
    });

    // Decode this language's images before rendering (lazy loading).
    await ensureLanguageImagesLoaded(lang);

    let panelNum = 1; // running counter so panorama panels stay in order
    const pad = (n) => String(n).padStart(2, '0');
    for (let i = 0; i < state.screenshots.length; i++) {
        // Update progress
        const percent = Math.round(((i + 1) / total) * 90); // Reserve 10% for ZIP generation
        showExportProgress('Exporting...', `Screenshot ${i + 1} of ${total}`, percent);
        await yieldToUI();

        // Rendered off-screen: the visible preview and its neighbours are left alone.
        const panels = renderScreenshotPanels(i);
        panels.forEach((dataUrl) => {
            const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
            zip.file(`screenshot-${pad(panelNum++)}.png`, base64Data, { base64: true });
        });
    }

    // Restore original settings
    state.selectedIndex = originalIndex;
    state.currentLanguage = originalLang;
    state.screenshots.forEach((s, i) => {
        s.text.currentHeadlineLang = originalTextLangs[i].headline;
        s.text.currentSubheadlineLang = originalTextLangs[i].subheadline;
    });
    updateCanvas();

    // Generate ZIP
    showExportProgress('Generating ZIP...', '', 95);
    const content = await zip.generateAsync({ type: 'blob' });

    showExportProgress('Complete!', '', 100);
    await new Promise(resolve => setTimeout(resolve, 400));
    hideExportProgress();

    const link = document.createElement('a');
    link.download = `screenshots_${state.outputDevice}_${lang}.zip`;
    link.href = URL.createObjectURL(content);
    link.click();
    URL.revokeObjectURL(link.href);
}

// Export all screenshots for all languages (separate folders)
async function exportAllLanguages() {
    const originalIndex = state.selectedIndex;
    const originalLang = state.currentLanguage;
    const zip = new JSZip();

    const totalLangs = state.projectLanguages.length;
    const totalScreenshots = state.screenshots.length;
    const totalItems = totalLangs * totalScreenshots;
    let completedItems = 0;

    // Show progress
    showExportProgress('Exporting...', 'Preparing all languages', 0);

    // Save original text languages for each screenshot
    const originalTextLangs = state.screenshots.map(s => ({
        headline: s.text.currentHeadlineLang,
        subheadline: s.text.currentSubheadlineLang
    }));

    for (let langIdx = 0; langIdx < state.projectLanguages.length; langIdx++) {
        const lang = state.projectLanguages[langIdx];
        const langName = languageNames[lang] || lang.toUpperCase();

        // Temporarily switch to this language (images and text)
        state.currentLanguage = lang;
        state.screenshots.forEach(s => {
            s.text.currentHeadlineLang = lang;
            s.text.currentSubheadlineLang = lang;
        });

        // Decode this language's images before rendering (lazy loading).
        await ensureLanguageImagesLoaded(lang);

        let panelNum = 1; // running counter so panorama panels stay in order
        for (let i = 0; i < state.screenshots.length; i++) {
            completedItems++;
            const percent = Math.round((completedItems / totalItems) * 90); // Reserve 10% for ZIP
            showExportProgress('Exporting...', `${langName}: Screenshot ${i + 1} of ${totalScreenshots}`, percent);
            await yieldToUI();

            // Rendered off-screen: the visible preview and its neighbours are left alone.
            const panels = renderScreenshotPanels(i);
            panels.forEach((dataUrl) => {
                const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
                // Use language code as folder name
                zip.file(`${lang}/screenshot-${panelNum++}.png`, base64Data, { base64: true });
            });
        }
    }

    // Restore original settings
    state.selectedIndex = originalIndex;
    state.currentLanguage = originalLang;
    state.screenshots.forEach((s, i) => {
        s.text.currentHeadlineLang = originalTextLangs[i].headline;
        s.text.currentSubheadlineLang = originalTextLangs[i].subheadline;
    });
    updateCanvas();

    // Generate ZIP
    showExportProgress('Generating ZIP...', '', 95);
    const content = await zip.generateAsync({ type: 'blob' });

    showExportProgress('Complete!', '', 100);
    await new Promise(resolve => setTimeout(resolve, 400));
    hideExportProgress();

    const link = document.createElement('a');
    link.download = `screenshots_${state.outputDevice}_all-languages.zip`;
    link.href = URL.createObjectURL(content);
    link.click();
    URL.revokeObjectURL(link.href);
}

// ===== Emoji Picker (inline dropdown) =====

let emojiPickerInitialized = false;

function showEmojiPicker() {
    const picker = document.getElementById('emoji-picker');
    const iconPicker = document.getElementById('icon-picker');
    if (!picker) return;

    // Close icon picker if open
    if (iconPicker) iconPicker.style.display = 'none';

    // Toggle
    if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        return;
    }

    picker.style.display = '';
    const searchInput = document.getElementById('emoji-search');
    if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 50);
    }

    // Reset to popular category
    document.querySelectorAll('#emoji-categories .picker-cat').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === 'popular');
    });
    renderEmojiGrid('popular');

    if (!emojiPickerInitialized) {
        emojiPickerInitialized = true;

        // Category tabs
        document.querySelectorAll('#emoji-categories .picker-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#emoji-categories .picker-cat').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const searchVal = document.getElementById('emoji-search').value.trim();
                if (searchVal) {
                    renderEmojiSearchResults(searchVal);
                } else {
                    renderEmojiGrid(btn.dataset.category);
                }
            });
        });

        // Search
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                const val = searchInput.value.trim().toLowerCase();
                if (val) {
                    renderEmojiSearchResults(val);
                } else {
                    const active = document.querySelector('#emoji-categories .picker-cat.active');
                    renderEmojiGrid(active?.dataset.category || 'popular');
                }
            });
        }
    }
}

function renderEmojiGrid(category) {
    const grid = document.getElementById('emoji-grid');
    if (!grid || typeof EMOJI_DATA === 'undefined') return;
    const emojis = EMOJI_DATA[category] || [];
    grid.innerHTML = emojis.map(e =>
        `<div class="picker-grid-item emoji-grid-item" data-emoji="${e.emoji}" data-name="${e.name}" title="${e.name}">${e.emoji}</div>`
    ).join('');
    wireEmojiClicks(grid);
}

function renderEmojiSearchResults(query) {
    const grid = document.getElementById('emoji-grid');
    if (!grid || typeof EMOJI_DATA === 'undefined') return;
    const results = [];
    for (const cat of Object.values(EMOJI_DATA)) {
        for (const e of cat) {
            if (e.name.toLowerCase().includes(query) ||
                e.keywords.some(k => k.includes(query))) {
                if (!results.find(r => r.emoji === e.emoji)) results.push(e);
            }
        }
    }
    grid.innerHTML = results.map(e =>
        `<div class="picker-grid-item emoji-grid-item" data-emoji="${e.emoji}" data-name="${e.name}" title="${e.name}">${e.emoji}</div>`
    ).join('');
    wireEmojiClicks(grid);
}

function wireEmojiClicks(grid) {
    grid.querySelectorAll('.emoji-grid-item').forEach(item => {
        item.onclick = () => {
            addEmojiElement(item.dataset.emoji, item.dataset.name);
            document.getElementById('emoji-picker').style.display = 'none';
        };
    });
}

// ===== Icon Picker (inline dropdown) =====

let iconPickerInitialized = false;
let iconSearchTimeout = null;

const iconImageObserver = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    entries.forEach(entry => {
        if (entry.isIntersecting) {
            const item = entry.target;
            const name = item.dataset.iconName;
            if (name && !item.dataset.loaded) {
                item.dataset.loaded = 'true';
                loadIconPreview(item, name);
            }
            iconImageObserver.unobserve(item);
        }
    });
}, { root: document.getElementById('icon-grid'), rootMargin: '50px' }) : null;

async function loadIconPreview(item, name) {
    try {
        const svgText = await fetchLucideSVG(name);
        const colorized = colorizeLucideSVG(svgText, 'currentColor', 2);
        item.innerHTML = colorized;
        const svg = item.querySelector('svg');
        if (svg) {
            svg.style.width = '20px';
            svg.style.height = '20px';
        }
    } catch (e) {
        item.innerHTML = `<span style="font-size: 9px; color: var(--text-tertiary);">${name}</span>`;
    }
}

function showIconPicker() {
    const picker = document.getElementById('icon-picker');
    const emojiPicker = document.getElementById('emoji-picker');
    if (!picker) return;

    // Close emoji picker if open
    if (emojiPicker) emojiPicker.style.display = 'none';

    // Toggle
    if (picker.style.display !== 'none') {
        picker.style.display = 'none';
        return;
    }

    picker.style.display = '';
    const searchInput = document.getElementById('icon-search');
    if (searchInput) {
        searchInput.value = '';
        setTimeout(() => searchInput.focus(), 50);
    }

    // Reset to popular category
    document.querySelectorAll('#icon-categories .picker-cat').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.category === 'popular');
    });
    renderIconGrid('popular');

    if (!iconPickerInitialized) {
        iconPickerInitialized = true;

        // Category tabs
        document.querySelectorAll('#icon-categories .picker-cat').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#icon-categories .picker-cat').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const searchVal = document.getElementById('icon-search').value.trim();
                if (searchVal) {
                    renderIconSearchResults(searchVal);
                } else {
                    renderIconGrid(btn.dataset.category);
                }
            });
        });

        // Debounced search
        if (searchInput) {
            searchInput.addEventListener('input', () => {
                clearTimeout(iconSearchTimeout);
                iconSearchTimeout = setTimeout(() => {
                    const val = searchInput.value.trim().toLowerCase();
                    if (val) {
                        renderIconSearchResults(val);
                    } else {
                        const active = document.querySelector('#icon-categories .picker-cat.active');
                        renderIconGrid(active?.dataset.category || 'popular');
                    }
                }, 200);
            });
        }
    }
}

function renderIconGrid(category) {
    const grid = document.getElementById('icon-grid');
    if (!grid) return;
    const icons = category === 'popular' ? (typeof LUCIDE_POPULAR !== 'undefined' ? LUCIDE_POPULAR : []) :
                                            (typeof LUCIDE_ALL !== 'undefined' ? LUCIDE_ALL : []);
    grid.innerHTML = icons.map(name =>
        `<div class="picker-grid-item icon-grid-item" data-icon-name="${name}" title="${name}"><div class="icon-placeholder"></div></div>`
    ).join('');
    wireIconClicks(grid);
    if (iconImageObserver) {
        grid.querySelectorAll('.icon-grid-item').forEach(item => {
            iconImageObserver.observe(item);
        });
    }
}

function renderIconSearchResults(query) {
    const grid = document.getElementById('icon-grid');
    if (!grid) return;
    const allIcons = typeof LUCIDE_ALL !== 'undefined' ? LUCIDE_ALL : [];
    const results = allIcons.filter(name => name.includes(query));
    grid.innerHTML = results.map(name =>
        `<div class="picker-grid-item icon-grid-item" data-icon-name="${name}" title="${name}"><div class="icon-placeholder"></div></div>`
    ).join('');
    wireIconClicks(grid);
    if (iconImageObserver) {
        grid.querySelectorAll('.icon-grid-item').forEach(item => {
            iconImageObserver.observe(item);
        });
    }
}

function wireIconClicks(grid) {
    grid.querySelectorAll('.icon-grid-item').forEach(item => {
        item.onclick = () => {
            addIconElement(item.dataset.iconName);
            document.getElementById('icon-picker').style.display = 'none';
        };
    });
}

// Initialize the app
initSync();