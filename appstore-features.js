// App Store workflow enhancements: full-language management, per-language and
// folder uploads (fastlane-aware), CSV text import/export, and main-language sync.
// Loaded after app.js + language-utils.js; it extends/overrides a few globals.

// ---- Language code normalization (fastlane / App Store → internal codes) ----
const LANG_CODE_MAP = {
    'en-us': 'en', 'en-gb': 'en-gb', 'en-au': 'en-au', 'en-ca': 'en-ca',
    'de-de': 'de', 'fr-fr': 'fr', 'fr-ca': 'fr-ca', 'es-es': 'es', 'es-mx': 'es-mx',
    'es-419': 'es-mx', 'pt-pt': 'pt', 'pt-br': 'pt-br', 'zh-hans': 'zh', 'zh-cn': 'zh',
    'zh-hant': 'zh-tw', 'zh-tw': 'zh-tw', 'ar-sa': 'ar', 'nl-nl': 'nl',
    'nb': 'no', 'nb-no': 'no', 'nn': 'no'
};

function normalizeLangCode(raw) {
    if (!raw) return null;
    const c = String(raw).trim().toLowerCase().replace(/_/g, '-');
    if (LANG_CODE_MAP[c]) return LANG_CODE_MAP[c];
    if (typeof languageNames !== 'undefined' && languageNames[c]) return c;
    const base = c.split('-')[0];
    if (typeof languageNames !== 'undefined' && languageNames[base]) return base;
    return null; // not a recognized language
}

// ---- Add every App Store language to the project ----
function addAllAppStoreLanguages() {
    Object.keys(languageNames).forEach(lang => {
        if (!state.projectLanguages.includes(lang)) addProjectLanguage(lang);
    });
    updateLanguagesList();
    updateAddLanguageSelect();
    updateLanguageMenu();
    saveState();
}

// ---- Count screenshots that have an image for a language ----
function countImagesForLanguage(lang) {
    return state.screenshots.filter(s => s.localizedImages && entryHasImage(s.localizedImages[lang])).length;
}

// ---- Assign one image File to a specific language (silent, batch-friendly) ----
function assignImageFileToLanguage(file, lang) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const ratio = Math.min(img.width, img.height) / Math.max(img.width, img.height);
                const deviceType = ratio > 0.6 ? 'iPad' : 'iPhone';
                const idx = findScreenshotByBaseFilename(file.name);
                if (idx !== -1) {
                    addLocalizedImage(idx, lang, img, e.target.result, file.name);
                } else {
                    createNewScreenshot(img, e.target.result, file.name, lang, deviceType);
                }
                resolve();
            };
            // Surface decode failures instead of dropping the file silently
            // (collected by reportImportFailures after the batch).
            img.onerror = () => { if (typeof _importFailures !== 'undefined') _importFailures.push(file.name); resolve(); };
            img.src = e.target.result;
        };
        reader.onerror = () => { if (typeof _importFailures !== 'undefined') _importFailures.push(file.name); resolve(); };
        reader.readAsDataURL(file);
    });
}

async function uploadFilesForLanguage(lang, fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    if (typeof showUploadProgress === 'function') showUploadProgress('Import des images…', '');
    try {
        if (!state.projectLanguages.includes(lang)) addProjectLanguage(lang);
        // Sort by name so screens line up across languages.
        files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        for (let i = 0; i < files.length; i++) {
            if (typeof showUploadProgress === 'function') showUploadProgress('Import des images… (' + (i + 1) + '/' + files.length + ')', files[i].name);
            await assignImageFileToLanguage(files[i], lang);
        }
        updateLanguagesList();
        if (typeof updateScreenshotList === 'function') updateScreenshotList();
        updateCanvas();
        // Hold the user until the server confirmed the save.
        if (typeof showUploadProgress === 'function') showUploadProgress('Enregistrement sur le serveur…', '');
        saveState();
        if (typeof waitForServerConfirmation === 'function') await waitForServerConfirmation(currentProjectId);
    } finally {
        if (typeof hideUploadProgress === 'function') hideUploadProgress();
    }
    if (typeof reportImportFailures === 'function') await reportImportFailures();
}

// ---- Folder import (fastlane-aware): classify by sub-folder name ----
async function importFolderFiles(fileList) {
    const files = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (!files.length) return;
    // Decide each file's language from its parent folder, else from its filename.
    const tagged = files.map(f => {
        const rel = f.webkitRelativePath || f.name;
        const parts = rel.split('/');
        let lang = null;
        if (parts.length >= 2) lang = normalizeLangCode(parts[parts.length - 2]);
        if (!lang) lang = detectLanguageFromFilename(f.name);
        if (!lang) lang = 'en';
        return { f, lang };
    });
    // Group by language, sort within each so screens align.
    const byLang = {};
    tagged.forEach(({ f, lang }) => { (byLang[lang] = byLang[lang] || []).push(f); });
    const total = tagged.length;
    if (typeof showUploadProgress === 'function') showUploadProgress('Import des images…', '');
    try {
        let done = 0;
        for (const lang of Object.keys(byLang)) {
            if (!state.projectLanguages.includes(lang)) addProjectLanguage(lang);
            byLang[lang].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
            for (const f of byLang[lang]) {
                done++;
                if (typeof showUploadProgress === 'function') showUploadProgress('Import des images… (' + done + '/' + total + ')', f.name);
                await assignImageFileToLanguage(f, lang);
            }
        }
        updateLanguagesList();
        if (typeof updateScreenshotList === 'function') updateScreenshotList();
        updateCanvas();
        // Hold the user until the server confirmed the save.
        if (typeof showUploadProgress === 'function') showUploadProgress('Enregistrement sur le serveur…', '');
        saveState();
        if (typeof waitForServerConfirmation === 'function') await waitForServerConfirmation(currentProjectId);
    } finally {
        if (typeof hideUploadProgress === 'function') hideUploadProgress();
    }
    if (typeof reportImportFailures === 'function') await reportImportFailures();
    const langs = Object.keys(byLang).map(l => `${languageFlags[l] || ''} ${languageNames[l] || l}`).join(', ');
    if (typeof showAppAlert === 'function') showAppAlert(`Imported ${total} image(s) across: ${langs}`, 'info');
}

// ---- CSV text template (export / import) ----
function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function screenshotLabel(i) {
    const s = state.screenshots[i];
    if (s && s.localizedImages) {
        const first = Object.values(s.localizedImages).find(v => v && v.name);
        if (first && first.name) return getBaseFilename(first.name);
    }
    return `Screenshot ${i + 1}`;
}

function downloadTextCsvTemplate() {
    const langs = state.projectLanguages;
    const rows = [['screenshot', 'name', 'language', 'headline', 'subheadline']];
    const count = Math.max(state.screenshots.length, 1);
    for (let i = 0; i < count; i++) {
        const s = state.screenshots[i];
        for (const lang of langs) {
            const headline = s && s.text && s.text.headlines ? (s.text.headlines[lang] || '') : '';
            const sub = s && s.text && s.text.subheadlines ? (s.text.subheadlines[lang] || '') : '';
            rows.push([i + 1, screenshotLabel(i), lang, headline, sub]);
        }
    }
    const csv = rows.map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'appscreen-text.csv';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
}

// Minimal RFC-4180-ish CSV parser (handles quotes, commas, newlines).
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQuotes = false;
    text = text.replace(/^﻿/, '');
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQuotes) {
            if (ch === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += ch;
        } else {
            if (ch === '"') inQuotes = true;
            else if (ch === ',') { row.push(field); field = ''; }
            else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
            else if (ch === '\r') { /* skip */ }
            else field += ch;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows;
}

function importTextCsv(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const rows = parseCsv(String(e.target.result));
        if (!rows.length) return;
        const header = rows[0].map(h => h.trim().toLowerCase());
        const col = (name) => header.indexOf(name);
        const ci = col('screenshot'), cl = col('language'), ch = col('headline'), cs = col('subheadline');
        if (cl === -1 || (ch === -1 && cs === -1)) {
            if (typeof showAppAlert === 'function') showAppAlert('CSV must have at least: language + headline/subheadline columns.', 'error');
            return;
        }
        let applied = 0;
        for (let r = 1; r < rows.length; r++) {
            const cells = rows[r];
            if (!cells || cells.every(c => c.trim() === '')) continue;
            const idx = ci !== -1 ? (parseInt(cells[ci], 10) - 1) : (r - 1);
            const lang = normalizeLangCode(cells[cl]);
            if (!lang || idx < 0 || idx >= state.screenshots.length) continue;
            if (!state.projectLanguages.includes(lang)) addProjectLanguage(lang);
            const s = state.screenshots[idx];
            s.text.headlines = s.text.headlines || {};
            s.text.subheadlines = s.text.subheadlines || {};
            if (ch !== -1 && cells[ch] !== undefined) {
                s.text.headlines[lang] = cells[ch];
                if (s.text.headlineLanguages && !s.text.headlineLanguages.includes(lang)) s.text.headlineLanguages.push(lang);
            }
            if (cs !== -1 && cells[cs] !== undefined) {
                s.text.subheadlines[lang] = cells[cs];
                if (s.text.subheadlineLanguages && !s.text.subheadlineLanguages.includes(lang)) s.text.subheadlineLanguages.push(lang);
            }
            applied++;
        }
        if (typeof syncUIWithState === 'function') syncUIWithState();
        updateCanvas();
        saveState();
        if (typeof showAppAlert === 'function') showAppAlert(`Applied ${applied} text row(s) from CSV.`, 'info');
    };
    reader.readAsText(file);
}

// ---- Propagate the main language's text/layout to all languages ----
function propagateFromMainLanguage() {
    const main = state.projectLanguages[0];
    if (!main) return;
    state.screenshots.forEach(s => {
        if (!s.text) return;
        s.text.headlines = s.text.headlines || {};
        s.text.subheadlines = s.text.subheadlines || {};
        const h = s.text.headlines[main] || '';
        const sub = s.text.subheadlines[main] || '';
        const layoutMain = s.text.languageSettings ? s.text.languageSettings[main] : null;
        state.projectLanguages.forEach(lang => {
            if (lang === main) return;
            s.text.headlines[lang] = h;
            s.text.subheadlines[lang] = sub;
            if (layoutMain && s.text.languageSettings) {
                s.text.languageSettings[lang] = JSON.parse(JSON.stringify(layoutMain));
            }
        });
    });
}

// Live sync: when enabled and editing the main language, mirror to all others.
if (typeof window !== 'undefined' && typeof setTextValue === 'function') {
    const _origSetTextValue = setTextValue;
    // eslint-disable-next-line no-global-assign
    setTextValue = function (key, value) {
        _origSetTextValue(key, value);
        if (state.syncMainLanguage && state.currentLanguage === state.projectLanguages[0]) {
            propagateFromMainLanguage();
        }
    };
}

// ---- Override updateLanguagesList: language cards + per-language drop zones ----
function updateLanguagesList() {
    const container = document.getElementById('languages-list');
    if (!container) return;
    container.innerHTML = '';

    const chip = document.getElementById('lang-count-chip');
    if (chip) chip.textContent = state.projectLanguages.length;

    state.projectLanguages.forEach((lang, i) => {
        const flag = languageFlags[lang] || '🏳️';
        const name = languageNames[lang] || lang.toUpperCase();
        const isCurrent = lang === state.currentLanguage;
        const isMain = i === 0;
        const isOnly = state.projectLanguages.length === 1;
        const count = countImagesForLanguage(lang);

        const item = document.createElement('div');
        item.className = 'lang-card';
        item.innerHTML = `
            <div class="lang-card-head">
                <div class="lang-flag-tile">${flag}</div>
                <div class="lang-meta">
                    <div class="lang-name-row">
                        <span class="lang-name">${name}</span>
                        ${isMain ? '<span class="lang-badge main">Main</span>' : ''}
                        ${isCurrent ? '<span class="lang-badge current">Current</span>' : ''}
                    </div>
                    <div class="lang-sub">${lang} · ${count} screenshot${count === 1 ? '' : 's'}</div>
                </div>
                <button class="lang-remove" ${isOnly ? 'disabled' : ''} title="${isOnly ? 'Cannot remove the only language' : 'Remove language'}">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
                </button>
            </div>
            <div class="lang-dropzone${count > 0 ? ' has-img' : ''}" tabindex="0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/></svg>
                <span>Drop ${name} screenshots here, or click to browse</span>
                <input type="file" accept="image/*" multiple hidden>
            </div>
        `;

        const removeBtn = item.querySelector('.lang-remove');
        if (!isOnly) removeBtn.addEventListener('click', () => removeProjectLanguage(lang));

        const dz = item.querySelector('.lang-dropzone');
        const input = item.querySelector('input[type=file]');
        dz.addEventListener('click', () => input.click());
        dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
        input.addEventListener('change', () => { if (input.files.length) uploadFilesForLanguage(lang, input.files); input.value = ''; });
        ['dragenter', 'dragover'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.add('dragover'); }));
        ['dragleave', 'dragend'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover'); }));
        dz.addEventListener('drop', (e) => {
            e.preventDefault(); e.stopPropagation(); dz.classList.remove('dragover');
            if (e.dataTransfer.files.length) uploadFilesForLanguage(lang, e.dataTransfer.files);
        });

        container.appendChild(item);
    });
}

// ---- Wire up the new buttons once the DOM is ready ----
function initAppStoreFeatures() {
    const addAllBtn = document.getElementById('add-all-languages-btn');
    if (addAllBtn) addAllBtn.addEventListener('click', addAllAppStoreLanguages);

    const syncToggle = document.getElementById('sync-main-language');
    if (syncToggle) {
        syncToggle.checked = !!state.syncMainLanguage;
        syncToggle.addEventListener('change', () => {
            state.syncMainLanguage = syncToggle.checked;
            if (syncToggle.checked) { propagateFromMainLanguage(); updateCanvas(); }
            saveState();
        });
    }
    const propagateBtn = document.getElementById('propagate-main-btn');
    if (propagateBtn) propagateBtn.addEventListener('click', () => {
        propagateFromMainLanguage();
        if (typeof syncUIWithState === 'function') syncUIWithState();
        updateCanvas(); saveState();
        if (typeof showAppAlert === 'function') showAppAlert('Main language copied to all languages.', 'info');
    });

    const csvDownloadBtn = document.getElementById('csv-template-btn');
    if (csvDownloadBtn) csvDownloadBtn.addEventListener('click', downloadTextCsvTemplate);
    const csvImportInput = document.getElementById('csv-import-input');
    const csvImportBtn = document.getElementById('csv-import-btn');
    if (csvImportBtn && csvImportInput) {
        csvImportBtn.addEventListener('click', () => csvImportInput.click());
        csvImportInput.addEventListener('change', () => { if (csvImportInput.files[0]) importTextCsv(csvImportInput.files[0]); csvImportInput.value = ''; });
    }

    const folderInput = document.getElementById('folder-import-input');
    const folderBtn = document.getElementById('folder-import-btn');
    if (folderBtn && folderInput) {
        folderBtn.addEventListener('click', () => folderInput.click());
        folderInput.addEventListener('change', () => { if (folderInput.files.length) importFolderFiles(folderInput.files); folderInput.value = ''; });
    }
}

// ============================================================================
// "All languages" canvas view — one rendered row per language for the current
// screenshot, each a drop zone to upload that language's image.
// ============================================================================
let allLanguagesMode = false;

function assignFileToScreenshotLang(file, idx, lang) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            if (!state.projectLanguages.includes(lang)) addProjectLanguage(lang);
            addLocalizedImage(idx, lang, img, e.target.result, file.name);
            renderAllLanguagesView();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// Matrix view: every screenshot (rows) × every language (columns). Cells are
// rendered in rAF-batched chunks so large matrices never block the UI.
let _alvRenderToken = 0;
const ALV_CELL_W = 96;

function renderAlvCell(cell) {
    const i = +cell.dataset.index;
    const lang = cell.dataset.lang;
    const ss = state.screenshots[i];
    if (!ss) return;
    const dims = getCanvasDimensions(i);
    const scale = ALV_CELL_W / dims.width;

    const savedLang = state.currentLanguage;
    const sH = ss.text.currentHeadlineLang, sS = ss.text.currentSubheadlineLang;
    state.currentLanguage = lang;
    ss.text.currentHeadlineLang = lang;
    ss.text.currentSubheadlineLang = lang;
    const canvas = document.createElement('canvas');
    // Rasterize at thumbnail size, not at output size: a cell is 96px wide, so a
    // full-resolution buffer was ~15 MB and a full-resolution render each, times
    // screenshots × languages.
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    try { renderScreenshotToCanvas(i, canvas, canvas.getContext('2d'), dims, scale, scale * dpr); } catch (e) {}
    // Overlap detection for this view+language (uses the rect from the render above).
    let overlaps = false;
    try {
        const otxt = Object.assign({}, ss.text, { currentHeadlineLang: lang, currentSubheadlineLang: lang });
        overlaps = typeof computeTextFit === 'function' && computeTextFit(canvas.getContext('2d'), dims, otxt).overlaps;
    } catch (e) {}
    state.currentLanguage = savedLang;
    ss.text.currentHeadlineLang = sH;
    ss.text.currentSubheadlineLang = sS;

    const dispW = ALV_CELL_W, dispH = ALV_CELL_W * dims.height / dims.width;
    canvas.style.width = dispW + 'px';
    canvas.style.height = dispH + 'px';

    const wrap = document.createElement('div');
    wrap.className = 'alv-cell-canvas';
    wrap.appendChild(canvas);
    if (overlaps) {
        const ssAutoFit = !!(ss.text && ss.text.autoFit);
        const badge = document.createElement('div');
        badge.className = 'alv-overlap-badge' + (ssAutoFit ? ' fixed' : '');
        badge.textContent = ssAutoFit ? '⤓ fit' : '⚠ overlap';
        badge.title = ssAutoFit
            ? 'Text would overlap the image — auto-fitted to fit'
            : 'Text overlaps the image in this language — enable Auto-fit text';
        wrap.appendChild(badge);
    }
    // Panorama slice guides
    const span = (ss.screenshot && ss.screenshot.spanScreens) || 1;
    for (let k = 1; k < span; k++) {
        const line = document.createElement('div');
        line.className = 'alv-guide';
        line.style.left = (dispW * k / span) + 'px';
        wrap.appendChild(line);
    }
    cell.querySelector('.alv-cell-body').replaceChildren(wrap);
}

function renderAllLanguagesView() {
    const view = document.getElementById('all-languages-view');
    if (!view) return;
    const token = ++_alvRenderToken; // cancels any in-flight batch render
    view.innerHTML = '';

    if (!state.screenshots.length) {
        view.innerHTML = '<div class="alv-empty">Upload screenshots to see them in every language.</div>';
        return;
    }
    const langs = state.projectLanguages;

    // Header row: corner + a flag per language.
    const head = document.createElement('div');
    head.className = 'alv-grid-row alv-grid-head';
    head.style.setProperty('--alv-cols', langs.length);
    const corner = document.createElement('div');
    corner.className = 'alv-corner';
    corner.textContent = `${state.screenshots.length}×${langs.length}`;
    head.appendChild(corner);
    langs.forEach((lang, c) => {
        const h = document.createElement('div');
        h.className = 'alv-colhead';
        h.innerHTML = `<span class="flag">${languageFlags[lang] || '🏳️'}</span><span class="nm">${languageNames[lang] || lang}</span>${c === 0 ? '<span class="alv-main">Main</span>' : ''}`;
        head.appendChild(h);
    });
    view.appendChild(head);

    const cells = [];
    state.screenshots.forEach((ss, i) => {
        const row = document.createElement('div');
        row.className = 'alv-grid-row';
        row.style.setProperty('--alv-cols', langs.length);
        const label = document.createElement('div');
        label.className = 'alv-rowlabel' + (i === state.selectedIndex ? ' active' : '');
        label.textContent = (typeof screenshotLabel === 'function') ? screenshotLabel(i) : ('Screenshot ' + (i + 1));
        label.title = 'Click to edit this screenshot';
        label.addEventListener('click', () => { state.selectedIndex = i; if (typeof updateScreenshotList === 'function') updateScreenshotList(); if (typeof syncUIWithState === 'function') syncUIWithState(); updateCanvas(); });
        row.appendChild(label);

        langs.forEach(lang => {
            const hasImg = !!(ss.localizedImages && entryHasImage(ss.localizedImages[lang]));
            const cell = document.createElement('div');
            cell.className = 'alv-cell' + (hasImg ? '' : ' empty');
            cell.dataset.index = i;
            cell.dataset.lang = lang;
            cell.title = `${languageNames[lang] || lang} — drop or click to set this screenshot`;
            const body = document.createElement('div');
            body.className = 'alv-cell-body';
            const hint = document.createElement('div');
            hint.className = 'alv-hint';
            hint.textContent = hasImg ? 'Replace' : 'Drop';
            cell.appendChild(body);
            cell.appendChild(hint);

            const input = document.createElement('input');
            input.type = 'file'; input.accept = 'image/*'; input.hidden = true;
            cell.appendChild(input);
            cell.addEventListener('click', () => input.click());
            input.addEventListener('change', () => { if (input.files[0]) assignFileToScreenshotLang(input.files[0], i, lang); input.value = ''; });
            ['dragenter', 'dragover'].forEach(ev => cell.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); cell.classList.add('dragover'); }));
            ['dragleave', 'dragend'].forEach(ev => cell.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); cell.classList.remove('dragover'); }));
            cell.addEventListener('drop', (e) => {
                e.preventDefault(); e.stopPropagation(); cell.classList.remove('dragover');
                if (e.dataTransfer.files[0]) assignFileToScreenshotLang(e.dataTransfer.files[0], i, lang);
            });
            row.appendChild(cell);
            cells.push(cell);
        });
        view.appendChild(row);
    });

    // Render cells in batched chunks so a big matrix never blocks the UI.
    // setTimeout (not rAF) so it still runs when the tab is backgrounded.
    let ci = 0;
    const renderBatch = () => {
        if (token !== _alvRenderToken) return; // superseded by a newer render
        const end = Math.min(ci + 14, cells.length);
        for (; ci < end; ci++) renderAlvCell(cells[ci]);
        if (ci < cells.length) setTimeout(renderBatch, 0);
    };
    renderBatch();
}

function setCanvasView(view) {
    allLanguagesMode = view === 'all-languages';
    const strip = document.querySelector('.preview-strip');
    const alv = document.getElementById('all-languages-view');
    if (strip) strip.style.display = allLanguagesMode ? 'none' : '';
    if (alv) alv.style.display = allLanguagesMode ? 'flex' : 'none';
    document.querySelectorAll('#canvas-view-toggle button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (allLanguagesMode) renderAllLanguagesView();
}

// Live-ish refresh: debounced re-render when the canvas updates while in ALV mode.
let _alvTimer = null;
function scheduleAlvRender() {
    if (!allLanguagesMode) return;
    clearTimeout(_alvTimer);
    _alvTimer = setTimeout(renderAllLanguagesView, 180);
}
if (typeof updateCanvas === 'function') {
    const _origUpdateCanvas = updateCanvas;
    // eslint-disable-next-line no-global-assign
    updateCanvas = function () {
        _origUpdateCanvas.apply(this, arguments);
        scheduleAlvRender();
        try { updateSpanGuides(); } catch (e) {}
    };
}

// Dashed guide lines over the preview showing where a panorama is sliced.
// Rendered as a DOM overlay (not on the canvas) so it never affects exports.
function updateSpanGuides() {
    const wrapper = document.getElementById('canvas-wrapper');
    const canvasEl = document.getElementById('preview-canvas');
    if (!wrapper || !canvasEl) return;
    let overlay = document.getElementById('span-guides');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'span-guides';
        overlay.style.cssText = 'position:absolute;pointer-events:none;z-index:6;';
        if (getComputedStyle(wrapper).position === 'static') wrapper.style.position = 'relative';
        wrapper.appendChild(overlay);
    }
    const ss = state.screenshots[state.selectedIndex];
    const span = (ss && ss.screenshot && ss.screenshot.spanScreens) || 1;
    const w = canvasEl.offsetWidth, h = canvasEl.offsetHeight;
    overlay.style.left = canvasEl.offsetLeft + 'px';
    overlay.style.top = canvasEl.offsetTop + 'px';
    overlay.style.width = w + 'px';
    overlay.style.height = h + 'px';
    overlay.innerHTML = '';
    if (span <= 1) { overlay.style.display = 'none'; return; }
    overlay.style.display = 'block';
    for (let k = 1; k < span; k++) {
        const line = document.createElement('div');
        line.style.cssText = `position:absolute;top:0;left:${w * k / span}px;width:0;height:${h}px;border-left:2px dashed rgba(255,255,255,0.55);`;
        overlay.appendChild(line);
    }
}

function initCanvasViewToggle() {
    document.querySelectorAll('#canvas-view-toggle button').forEach(btn => {
        btn.addEventListener('click', () => setCanvasView(btn.dataset.view));
    });
}

// ============================================================================
// Device notch (2D "Device Model") + text background controls
// ============================================================================
// Per-model corner-radius defaults (slider value; render scales it).
// iPad corners are far subtler than a phone's (~2-3% of width), so a low value
// here is what makes the mockup actually read as an iPad rather than a big phone.
const DEVICE_2D_RADIUS = { iphone: 52, samsung: 34, ipad: 12, mac: 16 };

function initDeviceTextExtras() {
    // 2D Device Model (iPhone / Samsung) — auto-adapts corner radius + notch.
    document.querySelectorAll('#device-model-2d-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            const model = btn.dataset.model2d;
            document.querySelectorAll('#device-model-2d-selector button').forEach(b => b.classList.toggle('active', b === btn));
            setScreenshotSetting('deviceModel2D', model);
            // Adapt corner radius to the model
            const r = DEVICE_2D_RADIUS[model] ?? 24;
            setScreenshotSetting('cornerRadius', r);
            const slider = document.getElementById('corner-radius');
            const val = document.getElementById('corner-radius-value');
            if (slider) slider.value = r;
            if (val) val.textContent = r + 'px';
            // Sensible default notch for the model (iPads and Macs have none).
            const defNotch = model === 'ipad' || model === 'mac' ? 'none' : model === 'samsung' ? 'punch' : 'island';
            setScreenshotSetting('frame.notch', defNotch);
            document.querySelectorAll('#notch-selector button').forEach(b => b.classList.toggle('active', b.dataset.notch === defNotch));
            // Switch the output canvas to this device class's dimensions, unless the
            // current size already matches (don't clobber a deliberate sub-size).
            const classPrefix = model === 'ipad' ? 'ipad' : model === 'samsung' ? 'android' : model === 'mac' ? 'mac' : 'iphone';
            const defaultSize = model === 'ipad' ? 'ipad-13' : model === 'samsung' ? 'android-phone-hd' : model === 'mac' ? 'mac-2880' : 'iphone-6.9';
            if (typeof state !== 'undefined' && !(state.outputDevice || '').startsWith(classPrefix)) {
                state.outputDevice = defaultSize;
                if (typeof syncUIWithState === 'function') syncUIWithState();
            }
            // The Mac finish selector is only relevant for the Mac model.
            const finishRow = document.getElementById('mac-finish-row');
            if (finishRow) finishRow.style.display = model === 'mac' ? 'block' : 'none';
            updateCanvas();
        });
    });

    // Mac finish (Silver / Space Black) — only shown for the Mac device model.
    document.querySelectorAll('#mac-finish-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#mac-finish-selector button').forEach(b => b.classList.toggle('active', b === btn));
            setScreenshotSetting('deviceMacFinish', btn.dataset.macfinish);
            updateCanvas();
        });
    });

    // Device bezel toggle
    const bezelToggle = document.getElementById('bezel-toggle');
    if (bezelToggle) bezelToggle.addEventListener('click', function () {
        this.classList.toggle('active');
        setScreenshotSetting('bezelEnabled', this.classList.contains('active'));
        updateCanvas();
    });

    // Notch / camera selector
    document.querySelectorAll('#notch-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#notch-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            setScreenshotSetting('frame.notch', btn.dataset.notch);
            updateCanvas();
        });
    });

    // Span screens (panorama)
    document.querySelectorAll('#span-screens-selector button').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#span-screens-selector button').forEach(b => b.classList.toggle('active', b === btn));
            setScreenshotSetting('spanScreens', parseInt(btn.dataset.span, 10));
            const hint = document.getElementById('span-hint');
            if (hint) hint.style.display = parseInt(btn.dataset.span, 10) > 1 ? 'block' : 'none';
            updateCanvas();
        });
    });

    // Text background: ON/OFF toggle that reveals the color + opacity controls.
    const bindBg = (toggleId, controlsId, colorId, opacityId, valueId, colorKey, opacityKey) => {
        const toggle = document.getElementById(toggleId);
        const controls = document.getElementById(controlsId);
        const color = document.getElementById(colorId);
        const opacity = document.getElementById(opacityId);
        const val = document.getElementById(valueId);
        const lastKey = opacityKey + '_last';
        // Reflect on/off in the toggle + show/hide the color & opacity controls.
        const reflect = (op) => {
            if (toggle) toggle.classList.toggle('active', op > 0);
            if (controls) controls.style.display = op > 0 ? 'block' : 'none';
            if (opacity) opacity.value = op > 0 ? op : (opacity.value || 100);
            if (val) val.textContent = (op > 0 ? op : parseInt(opacity ? opacity.value : 100, 10)) + '%';
        };
        if (toggle) toggle.addEventListener('click', () => {
            const txt = (typeof getTextSettings === 'function') ? getTextSettings() : {};
            const currentlyOn = (txt[opacityKey] || 0) > 0;
            if (!currentlyOn) {
                const op = txt[lastKey] || 100;
                setTextSetting(opacityKey, op);
                reflect(op);
            } else {
                setTextSetting(lastKey, txt[opacityKey] || 100);
                setTextSetting(opacityKey, 0);
                reflect(0);
            }
            updateCanvas();
        });
        if (color) color.addEventListener('input', () => {
            setTextSetting(colorKey, color.value);
            updateCanvas();
        });
        if (opacity) opacity.addEventListener('input', () => {
            const v = parseInt(opacity.value, 10);
            setTextSetting(opacityKey, v);
            if (val) val.textContent = v + '%';
            if (toggle) toggle.classList.toggle('active', v > 0);
            updateCanvas();
        });
    };
    bindBg('headline-bg-toggle', 'headline-bg-controls', 'headline-bg-color', 'headline-bg-opacity', 'headline-bg-opacity-value', 'headlineBgColor', 'headlineBgOpacity');
    bindBg('subheadline-bg-toggle', 'subheadline-bg-controls', 'subheadline-bg-color', 'subheadline-bg-opacity', 'subheadline-bg-opacity-value', 'subheadlineBgColor', 'subheadlineBgOpacity');
}

function syncDeviceTextExtras() {
    const ss = typeof getScreenshotSettings === 'function' ? getScreenshotSettings() : null;
    const txt = typeof getTextSettings === 'function' ? getTextSettings() : null;
    if (ss) {
        const notch = (ss.frame && ss.frame.notch) || 'none';
        document.querySelectorAll('#notch-selector button').forEach(b => b.classList.toggle('active', b.dataset.notch === notch));
        const model2d = ss.deviceModel2D || 'iphone';
        document.querySelectorAll('#device-model-2d-selector button').forEach(b => b.classList.toggle('active', b.dataset.model2d === model2d));
        const macFinish = ss.deviceMacFinish || 'silver';
        document.querySelectorAll('#mac-finish-selector button').forEach(b => b.classList.toggle('active', b.dataset.macfinish === macFinish));
        const finishRow = document.getElementById('mac-finish-row');
        if (finishRow) finishRow.style.display = (model2d === 'mac' && !ss.use3D) ? 'block' : 'none';
        const bezelToggle = document.getElementById('bezel-toggle');
        if (bezelToggle) bezelToggle.classList.toggle('active', !!ss.bezelEnabled);
        const span = ss.spanScreens || 1;
        document.querySelectorAll('#span-screens-selector button').forEach(b => b.classList.toggle('active', parseInt(b.dataset.span, 10) === span));
        const spanHint = document.getElementById('span-hint');
        if (spanHint) spanHint.style.display = span > 1 ? 'block' : 'none';
        // In 3D, the notch still applies (baked into the texture) but the bezel/model
        // selectors are 2D-only; keep the Notch sub-control visible, hide the rest.
        const group = document.getElementById('device-model-2d-group');
        if (group) group.style.display = 'block';
        const sel = document.getElementById('device-model-2d-selector');
        const bz = bezelToggle ? bezelToggle.closest('.toggle-row') : null;
        if (sel) sel.style.display = ss.use3D ? 'none' : 'flex';
        if (bz) bz.style.display = ss.use3D ? 'none' : 'flex';
    }
    if (txt) {
        const setCtl = (toggleId, controlsId, colorId, opacityId, valueId, color, opacity) => {
            const t = document.getElementById(toggleId), ctrls = document.getElementById(controlsId),
                  c = document.getElementById(colorId), o = document.getElementById(opacityId), v = document.getElementById(valueId);
            const op = opacity || 0;
            if (c && color) c.value = color;
            if (o) o.value = op > 0 ? op : 100;
            if (v) v.textContent = (op > 0 ? op : 100) + '%';
            if (t) t.classList.toggle('active', op > 0);
            if (ctrls) ctrls.style.display = op > 0 ? 'block' : 'none';
        };
        setCtl('headline-bg-toggle', 'headline-bg-controls', 'headline-bg-color', 'headline-bg-opacity', 'headline-bg-opacity-value', txt.headlineBgColor || '#000000', txt.headlineBgOpacity || 0);
        setCtl('subheadline-bg-toggle', 'subheadline-bg-controls', 'subheadline-bg-color', 'subheadline-bg-opacity', 'subheadline-bg-opacity-value', txt.subheadlineBgColor || '#000000', txt.subheadlineBgOpacity || 0);
    }
}

// Keep the new controls in sync when the app refreshes the UI (screenshot switch, etc.)
if (typeof syncUIWithState === 'function') {
    const _origSyncUI = syncUIWithState;
    // eslint-disable-next-line no-global-assign
    syncUIWithState = function () {
        _origSyncUI.apply(this, arguments);
        try { syncDeviceTextExtras(); } catch (e) {}
    };
}

// Delete the selected screenshot.
function deleteSelectedScreenshot() {
    if (!state.screenshots.length) return;
    state.screenshots.splice(state.selectedIndex, 1);
    if (state.selectedIndex >= state.screenshots.length) {
        state.selectedIndex = Math.max(0, state.screenshots.length - 1);
    }
    if (typeof updateScreenshotList === 'function') updateScreenshotList();
    if (typeof syncUIWithState === 'function') syncUIWithState();
    if (typeof updateGradientStopsUI === 'function') updateGradientStopsUI();
    updateCanvas();
    if (typeof saveState === 'function') saveState();
}

// Keyboard: Delete / Backspace removes the selected screenshot (unless typing
// in a field or a modal is open).
// Wire the undo/redo toolbar buttons to the history system in app.js.
function initHistoryButtons() {
    const u = document.getElementById('undo-btn');
    const r = document.getElementById('redo-btn');
    if (u) u.addEventListener('click', () => { if (typeof undo === 'function') undo(); });
    if (r) r.addEventListener('click', () => { if (typeof redo === 'function') redo(); });
    if (typeof updateUndoRedoUI === 'function') updateUndoRedoUI();
}

function initDeleteShortcut() {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Delete' && e.key !== 'Backspace') return;
        const t = document.activeElement;
        const tag = t && t.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
        if (document.querySelector('.modal-overlay.visible')) return;
        if (!state.screenshots.length) return;
        e.preventDefault();
        deleteSelectedScreenshot();
    });
}

// "Dupliquer le design depuis…" — pick another view and copy ITS design into the
// view currently displayed (the reverse of the old "sync to all"). An optional
// checkbox also copies the source's current-language screenshot image.
// Repopulate the source dropdown with every view except the one on screen.
function refreshCopyDesignSource() {
    const sel = document.getElementById('copy-design-source');
    if (!sel) return;
    const controls = sel.closest('.copy-design-controls');
    const btn = document.getElementById('copy-design-btn');
    const shots = state.screenshots || [];
    const cur = state.selectedIndex;
    const others = shots.map((s, i) => ({ s, i })).filter(o => o.i !== cur);
    const prev = sel.value;

    sel.innerHTML = '';
    if (others.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.textContent = 'Aucune autre vue';
        sel.appendChild(opt);
        sel.disabled = true;
        if (btn) btn.disabled = true;
        if (controls) controls.classList.add('disabled');
        return;
    }
    sel.disabled = false;
    if (btn) btn.disabled = false;
    if (controls) controls.classList.remove('disabled');

    others.forEach(({ s, i }) => {
        const opt = document.createElement('option');
        opt.value = String(i);
        opt.textContent = (s.name && s.name.trim()) ? s.name : ('Vue ' + (i + 1));
        sel.appendChild(opt);
    });
    // Keep the previous choice if it's still a valid "other" view.
    if (prev !== '' && others.some(o => String(o.i) === prev)) sel.value = prev;
}

// Copy design (background / device / text styling / elements) from source → target,
// and optionally the source's current-language screenshot image.
function copyDesignFromView(sourceIndex, targetIndex, includeImage) {
    const source = state.screenshots[sourceIndex];
    const target = state.screenshots[targetIndex];
    if (!source || !target) return;

    // Reuse the existing deep-copy of background/device/text-style/elements; it
    // preserves the target's own text content (only the styling is copied).
    if (typeof transferStyle === 'function') {
        transferStyle(sourceIndex, targetIndex);
    }

    if (includeImage) {
        const lang = (state.currentLanguage) || 'en';
        const srcImg = source.localizedImages && source.localizedImages[lang];
        if (srcImg && srcImg.src) {
            target.localizedImages = target.localizedImages || {};
            target.localizedImages[lang] = { src: srcImg.src, name: srcImg.name, image: srcImg.image };
            target.image = srcImg.image || target.image; // legacy single-image field
            if (typeof syncUIWithState === 'function') syncUIWithState();
            if (typeof updateScreenshotList === 'function') updateScreenshotList();
            if (typeof updateCanvas === 'function') updateCanvas();
        } else if (typeof showAppAlert === 'function') {
            showAppAlert('La vue source n’a pas d’image pour cette langue — design copié sans le screenshot.', 'info');
        }
    }

    refreshCopyDesignSource();
}

function initCopyDesignButton() {
    const sel = document.getElementById('copy-design-source');
    const btn = document.getElementById('copy-design-btn');
    if (!sel || !btn) return;
    // Always show fresh options when the dropdown is opened.
    sel.addEventListener('mousedown', refreshCopyDesignSource);
    btn.addEventListener('click', () => {
        const sourceIndex = parseInt(sel.value, 10);
        const targetIndex = state.selectedIndex;
        if (isNaN(sourceIndex) || sourceIndex === targetIndex) {
            if (typeof showAppAlert === 'function') showAppAlert('Choisissez une autre vue comme source.', 'info');
            return;
        }
        const includeImage = !!(document.getElementById('copy-design-include-image') || {}).checked;
        copyDesignFromView(sourceIndex, targetIndex, includeImage);
    });
    refreshCopyDesignSource();
}
// Backwards-compatible name (kept in case other code references it).
function initSyncDesignButton() { initCopyDesignButton(); }

// ============================================================================
// Copy text layout/options + device placement/size from ANOTHER project onto
// the current one (e.g. reuse an iPhone presentation for an iPad project).
// Screenshots are matched by position; text CONTENT and images are preserved.
// ============================================================================

// Text fields that describe styling/layout — NOT the text content itself.
const COPY_TEXT_STYLE_KEYS = [
    'headlineEnabled', 'headlineFont', 'headlineSize', 'headlineWeight', 'headlineItalic',
    'headlineUnderline', 'headlineStrikethrough', 'headlineColor', 'headlineBgColor', 'headlineBgOpacity',
    'subheadlineEnabled', 'subheadlineFont', 'subheadlineSize', 'subheadlineWeight', 'subheadlineItalic',
    'subheadlineUnderline', 'subheadlineStrikethrough', 'subheadlineColor', 'subheadlineOpacity',
    'subheadlineBgColor', 'subheadlineBgOpacity', 'subheadlineSpacing',
    'position', 'offsetY', 'lineHeight', 'perLanguageLayout', 'perScreenText'
];

// Device fields = placement/size/decoration. Deliberately EXCLUDES the device-model
// selectors (deviceModel2D/use3D/device3D) so copying an iPhone layout onto an iPad
// project doesn't turn the iPad back into an iPhone.
const COPY_DEVICE_KEYS = ['scale', 'x', 'y', 'rotation', 'perspective', 'cornerRadius', 'bezelEnabled', 'spanScreens'];
const COPY_DEVICE_OBJECTS = ['rotation3D', 'shadow', 'frame'];

function _copyClone(v) { return JSON.parse(JSON.stringify(v)); }

function _blankTextContent(t) {
    t.headlines = {}; t.subheadlines = {};
    delete t.panelHeadlines; delete t.panelSubheadlines; delete t.panelTexts;
}

// Copy only styling/layout from source text onto target, preserving target content.
function applyTextStyle(targetText, sourceText) {
    COPY_TEXT_STYLE_KEYS.forEach(k => { if (k in sourceText) targetText[k] = sourceText[k]; });
    if (sourceText.languageSettings) targetText.languageSettings = _copyClone(sourceText.languageSettings);
    // Panorama: each panel carries its own style — copy per panel, keep content.
    if (Array.isArray(sourceText.panelTexts)) {
        if (!Array.isArray(targetText.panelTexts)) targetText.panelTexts = [];
        sourceText.panelTexts.forEach((sp, p) => {
            if (!sp) return;
            if (targetText.panelTexts[p]) {
                applyTextStyle(targetText.panelTexts[p], sp);
            } else {
                const tp = _copyClone(sp);
                _blankTextContent(tp);
                targetText.panelTexts[p] = tp;
            }
        });
    }
}

function applyDevicePlacement(targetSs, sourceSs) {
    COPY_DEVICE_KEYS.forEach(k => { if (k in sourceSs) targetSs[k] = sourceSs[k]; });
    COPY_DEVICE_OBJECTS.forEach(k => { if (sourceSs[k]) targetSs[k] = _copyClone(sourceSs[k]); });
}

async function copyLayoutFromProject(sourceId, copyText, copyDevice) {
    if (!copyText && !copyDevice) return;
    if (typeof RemoteStore === 'undefined' || !RemoteStore.get) {
        if (typeof showAppAlert === 'function') await showAppAlert('Le serveur n’est pas disponible.', 'error');
        return;
    }
    let rec;
    try { rec = await RemoteStore.get(sourceId); } catch (e) { rec = null; }
    if (!rec || !Array.isArray(rec.screenshots) || rec.screenshots.length === 0) {
        if (typeof showAppAlert === 'function') await showAppAlert('Impossible de lire le projet source.', 'error');
        return;
    }
    const n = Math.min(state.screenshots.length, rec.screenshots.length);
    let count = 0;
    for (let i = 0; i < n; i++) {
        const src = rec.screenshots[i];
        const tgt = state.screenshots[i];
        if (!src || !tgt) continue;
        if (copyDevice && src.screenshot && tgt.screenshot) applyDevicePlacement(tgt.screenshot, src.screenshot);
        if (copyText && src.text) {
            if (typeof normalizeTextSettings === 'function') tgt.text = normalizeTextSettings(tgt.text);
            applyTextStyle(tgt.text, src.text);
        }
        count++;
    }
    if (typeof setActivePanelIndex === 'function') setActivePanelIndex(0);
    if (typeof syncUIWithState === 'function') syncUIWithState();
    if (typeof updateScreenshotList === 'function') updateScreenshotList();
    if (typeof updateCanvas === 'function') updateCanvas();

    const name = (Array.isArray(projects) ? (projects.find(p => p.id === sourceId) || {}).name : '') || 'projet source';
    let msg = `Mise en page copiée depuis « ${name} » sur ${count} écran(s).`;
    if (rec.screenshots.length !== state.screenshots.length) {
        msg += ` (Source : ${rec.screenshots.length} écran(s) — actuel : ${state.screenshots.length}.)`;
    }
    if (typeof showAppAlert === 'function') await showAppAlert(msg, 'info');
}

function refreshCopyLayoutSource() {
    const sel = document.getElementById('copy-layout-source');
    if (!sel) return;
    const list = (Array.isArray(projects) ? projects : []).filter(p => p.id !== currentProjectId);
    const prev = sel.value;
    sel.innerHTML = '';
    if (list.length === 0) {
        const opt = document.createElement('option');
        opt.value = ''; opt.textContent = 'Aucun autre projet';
        sel.appendChild(opt);
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    list.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        const cnt = (typeof p.screenshotCount === 'number') ? ` (${p.screenshotCount})` : '';
        opt.textContent = (p.name && p.name.trim() ? p.name : p.id) + cnt;
        sel.appendChild(opt);
    });
    if (prev && list.some(p => p.id === prev)) sel.value = prev;
}

function initCopyLayoutModal() {
    const openBtn = document.getElementById('copy-layout-project-btn');
    const modal = document.getElementById('copy-layout-modal');
    if (!openBtn || !modal) return;
    const cancel = document.getElementById('copy-layout-cancel');
    const confirm = document.getElementById('copy-layout-confirm');
    const close = () => modal.classList.remove('visible');

    openBtn.addEventListener('click', async () => {
        modal.classList.add('visible');
        refreshCopyLayoutSource();
        // Pull the latest project list from the server, then refresh again.
        if (typeof syncWithRemote === 'function') {
            try { await syncWithRemote(); refreshCopyLayoutSource(); } catch (e) {}
        }
    });
    if (cancel) cancel.addEventListener('click', close);
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    if (confirm) confirm.addEventListener('click', async () => {
        const sel = document.getElementById('copy-layout-source');
        const sourceId = sel && sel.value;
        if (!sourceId) {
            if (typeof showAppAlert === 'function') await showAppAlert('Choisissez un projet source.', 'info');
            return;
        }
        const copyText = !!(document.getElementById('copy-layout-text') || {}).checked;
        const copyDevice = !!(document.getElementById('copy-layout-device') || {}).checked;
        if (!copyText && !copyDevice) {
            if (typeof showAppAlert === 'function') await showAppAlert('Sélectionnez au moins un élément à copier.', 'info');
            return;
        }
        close();
        await copyLayoutFromProject(sourceId, copyText, copyDevice);
    });
}

function initAllExtras() {
    initAppStoreFeatures();
    initCanvasViewToggle();
    initDeviceTextExtras();
    initDeleteShortcut();
    initCopyDesignButton();
    initCopyLayoutModal();
    initHistoryButtons();
    try { syncDeviceTextExtras(); } catch (e) {}
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAllExtras);
} else {
    initAllExtras();
}

// ============================================================================
// Title–subtitle spacing + per-screen panorama text
// ============================================================================
function renderPerScreenTextUI() {
    const tab = document.getElementById('tab-text');
    if (!tab) return;
    let box = document.getElementById('per-screen-text-box');
    if (!box) {
        // Sits at the TOP of the Text tab: pick a screen, then edit it with the
        // controls below (which route to that screen's own text object).
        box = document.createElement('div');
        box.id = 'per-screen-text-box';
        tab.insertBefore(box, tab.firstChild);
    }

    const ss = state.screenshots[state.selectedIndex];
    const span = (ss && ss.screenshot && ss.screenshot.spanScreens) || 1;
    if (!ss || span <= 1) { box.style.display = 'none'; box.innerHTML = ''; return; }
    box.style.display = 'block';

    // Read the CONTAINER (not getText(), which redirects to the active panel) —
    // the perScreenText flag and panel list live on the container.
    const container = getContainerText();
    const on = !!container.perScreenText;
    const active = (typeof getActivePanelIndex === 'function')
        ? Math.min(getActivePanelIndex(), span - 1) : 0;

    let html =
        '<div class="control-group"><div class="toggle-row">' +
        '<span class="toggle-label">Text per screen (' + span + ' panels)</span>' +
        '<div class="toggle' + (on ? ' active' : '') + '" id="per-screen-text-toggle"></div>' +
        '</div>' +
        '<p class="control-hint" style="margin-top:6px;">Each screen gets its own headline, subheadline and styling. Pick a screen, then edit it with the controls below.</p>' +
        '</div>';
    if (on) {
        html += '<div class="control-group"><div class="ps-screen-tabs">';
        for (let p = 0; p < span; p++) {
            html += '<button type="button" class="ps-screen-tab' + (p === active ? ' active' : '') +
                '" data-p="' + p + '">Screen ' + (p + 1) + '</button>';
        }
        html += '</div></div>';
    }
    html += '<div class="divider"></div>';
    box.innerHTML = html;

    box.querySelector('#per-screen-text-toggle').addEventListener('click', function () {
        const c = getContainerText();
        const turnOn = !c.perScreenText;
        c.perScreenText = turnOn;
        if (turnOn && typeof ensurePanelTexts === 'function') ensurePanelTexts(c, span);
        if (turnOn && typeof setActivePanelIndex === 'function') setActivePanelIndex(0);
        if (typeof syncUIWithState === 'function') syncUIWithState();
        updateCanvas();
    });

    if (on) {
        box.querySelectorAll('.ps-screen-tab').forEach(btn => btn.addEventListener('click', () => {
            if (typeof setActivePanelIndex === 'function') setActivePanelIndex(+btn.dataset.p);
            if (typeof syncUIWithState === 'function') syncUIWithState();
            updateCanvas();
        }));
    }
}

function initTextSpacingAndPerScreen() {
    const sp = document.getElementById('subheadline-spacing');
    const spv = document.getElementById('subheadline-spacing-value');
    if (sp) sp.addEventListener('input', () => {
        setTextSetting('subheadlineSpacing', parseInt(sp.value, 10));
        if (spv) spv.textContent = sp.value + 'px';
        updateCanvas();
    });
    document.querySelectorAll('#span-screens-selector button').forEach(b =>
        b.addEventListener('click', () => setTimeout(renderPerScreenTextUI, 0)));
    renderPerScreenTextUI();
}

function syncTextSpacingAndPerScreen() {
    const txt = (typeof getTextSettings === 'function') ? getTextSettings() : null;
    if (txt) {
        const sp = document.getElementById('subheadline-spacing');
        const spv = document.getElementById('subheadline-spacing-value');
        if (sp) sp.value = txt.subheadlineSpacing || 0;
        if (spv) spv.textContent = (txt.subheadlineSpacing || 0) + 'px';
    }
    renderPerScreenTextUI();
}

if (typeof syncUIWithState === 'function') {
    const _origSyncUI2 = syncUIWithState;
    let _psLastIndex = -1;
    // eslint-disable-next-line no-global-assign
    syncUIWithState = function () {
        // Reset the per-screen panel selection when the selected screenshot
        // changes, BEFORE the Text tab reloads — otherwise the controls would
        // load a stale panel index from the previously edited screenshot.
        if (_psLastIndex !== state.selectedIndex) {
            if (typeof setActivePanelIndex === 'function') { try { setActivePanelIndex(0); } catch (e) {} }
            _psLastIndex = state.selectedIndex;
        }
        _origSyncUI2.apply(this, arguments);
        try { syncTextSpacingAndPerScreen(); } catch (e) {}
    };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initTextSpacingAndPerScreen);
else initTextSpacingAndPerScreen();

// ============================================================================
// Text/image overlap guard: detect text overlapping the device in any language,
// and optionally auto-shrink the text (per view + language) so it fits.
// ============================================================================

// Languages that have text or are part of the project, for a given screenshot.
function ogLangsForScreenshot(ss) {
    const set = new Set();
    ['headlines', 'subheadlines'].forEach(k => {
        if (ss.text && ss.text[k]) Object.keys(ss.text[k]).forEach(l => { if (ss.text[k][l]) set.add(l); });
    });
    (state.projectLanguages || []).forEach(l => set.add(l));
    if (!set.size) set.add(state.currentLanguage || 'en');
    return Array.from(set);
}

// Languages of `ss` (index i) where the text overlaps the device image.
function ogOverlapLangs(i) {
    const ss = state.screenshots[i];
    if (!ss || typeof computeTextFit !== 'function') return [];
    const dims = getCanvasDimensions(i);
    const tmp = document.createElement('canvas');
    tmp.width = 8; tmp.height = 8;
    const tctx = tmp.getContext('2d');
    const prevLang = state.currentLanguage;
    const out = [];
    ogLangsForScreenshot(ss).forEach(L => {
        state.currentLanguage = L;
        window.__imgRect = { has: false };
        const img = (typeof getScreenshotImage === 'function') ? getScreenshotImage(ss) : null;
        if (img && !(ss.screenshot && ss.screenshot.use3D)) {
            try { drawScreenshotToContext(tctx, dims, img, ss.screenshot); } catch (e) {}
        }
        const txt = Object.assign({}, ss.text, { currentHeadlineLang: L, currentSubheadlineLang: L });
        let fit;
        try { fit = computeTextFit(tctx, dims, txt); } catch (e) { fit = { overlaps: false }; }
        if (fit.overlaps) out.push(L);
    });
    state.currentLanguage = prevLang;
    return out;
}

function ogFlag(lang) {
    return (typeof languageFlags === 'object' && languageFlags[lang]) ? languageFlags[lang] : lang.toUpperCase();
}

function initOverlapGuard() {
    renderOverlapGuardUI();
}

// Auto-fit is stored per screenshot (text.autoFit). Read/write the CURRENT
// screenshot's flag (falling back to project defaults when nothing is selected).
function ogGetAutoFit() {
    try { return !!(typeof getContainerText === 'function' && getContainerText().autoFit); } catch (e) { return false; }
}
function ogSetAutoFit(on) {
    try {
        if (typeof getContainerText === 'function') getContainerText().autoFit = on;
    } catch (e) {}
}

function renderOverlapGuardUI() {
    const tab = document.getElementById('tab-text');
    if (!tab) return;
    let box = document.getElementById('overlap-guard-box');
    if (!box) {
        box = document.createElement('div');
        box.id = 'overlap-guard-box';
        box.className = 'overlap-guard-box';
        tab.insertBefore(box, tab.firstChild);
    }
    box.innerHTML =
        '<div class="og-row">' +
        '  <div class="og-title">Auto-fit text <span class="og-sub">this screen · avoid image overlap</span></div>' +
        '  <div class="toggle' + (ogGetAutoFit() ? ' active' : '') + '" id="autofit-toggle"></div>' +
        '</div>' +
        '<div class="og-status" id="autofit-status"></div>';

    box.querySelector('#autofit-toggle').addEventListener('click', function () {
        this.classList.toggle('active');
        ogSetAutoFit(this.classList.contains('active'));
        updateCanvas();
        updateOverlapStatus();
        const view = document.getElementById('all-languages-view');
        if (view && view.offsetParent !== null && typeof renderAllLanguagesView === 'function') renderAllLanguagesView();
    });
    updateOverlapStatus();
}

// Keep the toggle in sync with the selected screenshot's flag (called on switch).
function updateAutoFitToggle() {
    const t = document.getElementById('autofit-toggle');
    if (t) t.classList.toggle('active', ogGetAutoFit());
}

function updateOverlapStatus() {
    updateAutoFitToggle();
    const el = document.getElementById('autofit-status');
    if (!el) return;
    let langs = [];
    try { langs = ogOverlapLangs(state.selectedIndex); } catch (e) {}
    if (!langs.length) {
        el.innerHTML = '<span class="og-ok">✓ No text/image overlap</span>';
        return;
    }
    const flags = langs.map(ogFlag).join(' ');
    el.innerHTML = '<span class="og-warn">⚠ Overlap in ' + langs.length + ' language' + (langs.length > 1 ? 's' : '') + ':</span> ' +
        '<span class="og-flags">' + flags + '</span>' +
        '<span class="og-note">' + (ogGetAutoFit() ? ' — auto-fitted to fit.' : ' — turn on Auto-fit to shrink.') + '</span>';
}

initOverlapGuard();

// Debounced overlap status refresh: ogOverlapLangs does a full offscreen render
// per language, so don't run it on every syncUIWithState call.
let _ogStatusTimer = null;
function scheduleOverlapStatus() {
    clearTimeout(_ogStatusTimer);
    _ogStatusTimer = setTimeout(() => { try { updateOverlapStatus(); } catch (e) {} }, 300);
}

if (typeof syncUIWithState === 'function') {
    const _origSyncUIOG = syncUIWithState;
    // eslint-disable-next-line no-global-assign
    syncUIWithState = function () {
        _origSyncUIOG.apply(this, arguments);
        try { updateAutoFitToggle(); } catch (e) {}
        scheduleOverlapStatus();
    };
}
