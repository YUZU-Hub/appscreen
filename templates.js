// ============================================================================
// Layout templates
// ----------------------------------------------------------------------------
// A template is a whole-project recipe: where the device sits and where the text
// sits, applied to every screen at once so a set looks designed rather than
// assembled. Templates differ by POSITIONING (text top / bottom / beside the
// device, device floating / bleeding / tilted / in perspective…), and several of
// them alternate between two arrangements so consecutive screens don't look like
// carbon copies.
//
// Text length is handled by construction. Every template drops the headline +
// subheadline into a TEXT ZONE (the rectangle already supported by the renderer)
// with "same size for all languages" on: the block is measured and re-wrapped
// until it fits the box in EVERY project language, so a short English headline
// and a German one three times as long both land inside the same rectangle, at
// the same size in every language, without a word ever being broken. The size
// given here is a ceiling — screens with short text keep it, screens with long
// translations step down — so the set keeps one typographic scale instead of
// ballooning wherever the text happens to be short.
//
// Two options guard content the template must not touch:
//   · the first screen is often a hero image delivered ready-made — it is left
//     exactly as it is;
//   · the background colours already chosen for the project can be kept.
// ============================================================================

// ---- Background palettes -------------------------------------------------
// Each set is one gradient (2 colours); screens cycle through the sets so a
// project gets a coherent, varied family of backgrounds rather than one flat
// colour repeated.
const TEMPLATE_PALETTES = {
    midnight: { angle: 160, sets: [['#0f172a', '#1e3a8a'], ['#111827', '#312e81'], ['#0b1120', '#1d4ed8'], ['#131c31', '#3730a3'], ['#0f172a', '#2563eb']] },
    violet:   { angle: 145, sets: [['#2e1065', '#7c3aed'], ['#1e1b4b', '#6d28d9'], ['#3b0764', '#8b5cf6'], ['#241046', '#5b21b6'], ['#2b0b3f', '#a855f7']] },
    sunset:   { angle: 135, sets: [['#7c2d12', '#f97316'], ['#831843', '#fb7185'], ['#9a3412', '#fbbf24'], ['#701a45', '#f472b6'], ['#7c2d12', '#fb923c']] },
    ocean:    { angle: 150, sets: [['#083344', '#0891b2'], ['#0c4a6e', '#38bdf8'], ['#042f2e', '#14b8a6'], ['#0e7490', '#67e8f9'], ['#075985', '#22d3ee']] },
    forest:   { angle: 155, sets: [['#052e16', '#15803d'], ['#064e3b', '#10b981'], ['#14532d', '#4ade80'], ['#022c22', '#059669'], ['#1a2e05', '#65a30d']] },
    mono:     { angle: 180, sets: [['#111113', '#2c2c2e'], ['#0a0a0b', '#242426'], ['#151517', '#333336'], ['#0d0d0f', '#1f1f22'], ['#18181b', '#3f3f46']] }
};

// ---- Template catalogue ---------------------------------------------------
// Geometry is declarative:
//   device.top   — where the TOP edge of the device lands, as a fraction of the
//                  canvas height (may be negative or > 1 to bleed off an edge).
//                  Converted to the renderer's `y` by templateDeviceY().
//   device.scale — device height as a % of the canvas height.
//   zone         — the text rectangle, in % of the canvas.
// `steps` cycles over the screens a template is applied to, so a two-step
// template alternates between its two arrangements.
const LAYOUT_TEMPLATES = [
    {
        id: 'text-top',
        name: 'Titre en haut',
        hint: 'Texte en haut, appareil qui déborde en bas. Le classique de l’App Store.',
        palette: 'midnight',
        steps: [{
            zone: { x: 7, y: 4, width: 86, height: 19 },
            text: { headlineSize: 130, subheadlineSize: 58, lineHeight: 112 },
            device: { scale: 80, x: 50, top: 0.28 }
        }]
    },
    {
        id: 'text-bottom',
        name: 'Titre en bas',
        hint: 'Appareil qui déborde en haut, texte posé en bas.',
        palette: 'midnight',
        steps: [{
            zone: { x: 7, y: 76, width: 86, height: 19 },
            text: { headlineSize: 130, subheadlineSize: 58, lineHeight: 112 },
            device: { scale: 80, x: 50, top: -0.08 }
        }]
    },
    {
        id: 'float-top',
        name: 'Flottant · titre haut',
        hint: 'Appareil entier, détaché du bord, texte au-dessus.',
        palette: 'violet',
        steps: [{
            zone: { x: 7, y: 5, width: 86, height: 24 },
            text: { headlineSize: 140, subheadlineSize: 62, lineHeight: 112 },
            device: { scale: 64, x: 50, top: 0.34 }
        }]
    },
    {
        id: 'float-bottom',
        name: 'Flottant · titre bas',
        hint: 'Appareil entier en haut, texte en bas.',
        palette: 'violet',
        steps: [{
            zone: { x: 7, y: 70, width: 86, height: 25 },
            text: { headlineSize: 140, subheadlineSize: 62, lineHeight: 112 },
            device: { scale: 64, x: 50, top: 0.02 }
        }]
    },
    {
        id: 'alternate',
        name: 'Alterné haut / bas',
        hint: 'Le texte passe d’un écran à l’autre du haut vers le bas.',
        palette: 'ocean',
        steps: [
            {
                zone: { x: 7, y: 4, width: 86, height: 19 },
                text: { headlineSize: 130, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 80, x: 50, top: 0.28 }
            },
            {
                zone: { x: 7, y: 76, width: 86, height: 19 },
                text: { headlineSize: 130, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 80, x: 50, top: -0.08 }
            }
        ]
    },
    {
        id: 'tilt',
        name: 'Incliné alterné',
        hint: 'Appareil penché à gauche puis à droite, texte en haut.',
        palette: 'sunset',
        steps: [
            {
                zone: { x: 7, y: 4, width: 86, height: 20 },
                text: { headlineSize: 132, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 70, x: 50, top: 0.32, rotation: -8 }
            },
            {
                zone: { x: 7, y: 4, width: 86, height: 20 },
                text: { headlineSize: 132, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 70, x: 50, top: 0.32, rotation: 8 }
            }
        ]
    },
    {
        id: 'perspective',
        name: 'Perspective alternée',
        hint: 'Appareil vu de biais, un côté puis l’autre.',
        palette: 'ocean',
        steps: [
            {
                zone: { x: 7, y: 4, width: 86, height: 20 },
                text: { headlineSize: 132, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 70, x: 50, top: 0.32, perspective: 14 }
            },
            {
                zone: { x: 7, y: 4, width: 86, height: 20 },
                text: { headlineSize: 132, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 70, x: 50, top: 0.32, perspective: -14 }
            }
        ]
    },
    {
        id: 'diagonal',
        name: 'Décalé gauche / droite',
        hint: 'Appareil poussé sur un bord puis sur l’autre, légèrement penché.',
        palette: 'sunset',
        steps: [
            {
                zone: { x: 7, y: 5, width: 86, height: 22 },
                text: { headlineSize: 134, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 62, x: 32, top: 0.33, rotation: -6 }
            },
            {
                zone: { x: 7, y: 5, width: 86, height: 22 },
                text: { headlineSize: 134, subheadlineSize: 58, lineHeight: 112 },
                device: { scale: 62, x: 68, top: 0.33, rotation: 6 }
            }
        ]
    },
    {
        id: 'minimal',
        name: 'Minimal',
        hint: 'Petit appareil, beaucoup de vide, titre court et net.',
        palette: 'mono',
        steps: [{
            zone: { x: 10, y: 9, width: 80, height: 18 },
            text: { headlineSize: 126, subheadlineSize: 54, lineHeight: 108 },
            device: { scale: 52, x: 50, top: 0.40 }
        }]
    },
    {
        id: 'showcase',
        name: 'Vitrine · zoom',
        hint: 'Appareil très grand qui sort du cadre, bandeau de titre étroit en haut.',
        palette: 'forest',
        steps: [{
            zone: { x: 6, y: 3, width: 88, height: 16 },
            text: { headlineSize: 118, subheadlineSize: 52, lineHeight: 108 },
            device: { scale: 88, x: 50, top: 0.24 }
        }]
    },
    {
        id: 'headline-hero',
        name: 'Grand titre',
        hint: 'Zone de texte généreuse : pensé pour les titres longs et les langues verbeuses.',
        palette: 'violet',
        steps: [{
            zone: { x: 7, y: 6, width: 86, height: 34 },
            text: { headlineSize: 170, subheadlineSize: 76, lineHeight: 114 },
            device: { scale: 58, x: 50, top: 0.46 }
        }]
    },
    {
        id: 'spotlight',
        name: 'Plein cadre · légende',
        hint: 'La capture remplit l’écran, le texte se pose dessus sur un bandeau translucide.',
        palette: 'mono',
        steps: [{
            zone: { x: 7, y: 70, width: 86, height: 22 },
            text: {
                // Roomy line height + extra title→subtitle spacing so the
                // per-line bands read as separate labels instead of one
                // jagged block.
                headlineSize: 122, subheadlineSize: 54, lineHeight: 134,
                subheadlineSpacing: 22,
                headlineBgColor: '#000000', headlineBgOpacity: 45,
                subheadlineBgColor: '#000000', subheadlineBgOpacity: 35
            },
            device: { scale: 100, x: 50, top: 0 }
        }]
    },
    {
        id: 'side-by-side',
        name: 'Côte à côte',
        hint: 'Texte d’un côté, appareil de l’autre — pour les formats larges (iPad, Mac, web).',
        palette: 'ocean',
        steps: [
            {
                zone: { x: 5, y: 24, width: 32, height: 52 },
                text: { position: 'top', headlineSize: 110, subheadlineSize: 50, lineHeight: 112 },
                device: { scale: 48, x: 74, top: 0.26 }
            },
            {
                zone: { x: 63, y: 24, width: 32, height: 52 },
                text: { position: 'top', headlineSize: 110, subheadlineSize: 50, lineHeight: 112 },
                device: { scale: 48, x: 26, top: 0.26 }
            }
        ]
    }
];

// ---- Geometry helpers -----------------------------------------------------

// Convert a wanted TOP edge (fraction of the canvas height) into the renderer's
// vertical position setting. Mirrors drawScreenshotToContext(): the device is
// `scale`% of the canvas height and its offset range is clamped to 15% so the
// slider still moves something at full scale.
function templateDeviceY(scale, top) {
    const s = scale / 100;
    const move = Math.max(1 - s, 0.15);
    const y = (0.5 + (top - (1 - s) / 2) / move) * 100;
    return Math.round(Math.max(-200, Math.min(300, y)));
}

// Where the template puts the text vertically when the zone is switched off
// later: keep the fallback anchored to the same edge as the zone.
function templateTextPosition(step) {
    if (step.text && step.text.position) return step.text.position;
    const z = step.zone;
    return (z.y + z.height / 2) < 50 ? 'top' : 'bottom';
}

function templateOffsetY(step) {
    const z = step.zone;
    return templateTextPosition(step) === 'top'
        ? Math.round(z.y)
        : Math.round(Math.max(0, 100 - (z.y + z.height)));
}

function getLayoutTemplate(id) {
    return LAYOUT_TEMPLATES.find(t => t.id === id) || null;
}

// ---- Applying a template --------------------------------------------------

// Layout keys a template owns. Everything else about the text (fonts, colours,
// weights, the content itself) is the user's and is left untouched.
function applyTemplateTextLayout(text, step) {
    const L = step.text || {};
    const position = templateTextPosition(step);
    const offsetY = templateOffsetY(step);
    const layout = {
        position: position,
        offsetY: offsetY,
        lineHeight: L.lineHeight || 112,
        headlineSize: L.headlineSize || 110,
        subheadlineSize: L.subheadlineSize || 52
    };

    Object.assign(text, layout);

    // The same layout has to be written into the per-language entries too: when
    // "per-language layout" is on the renderer reads those and ignores the keys
    // above, so writing only one of the two would make the template a no-op.
    const langs = new Set(Object.keys(text.languageSettings || {}));
    (state.projectLanguages || []).forEach(l => langs.add(l));
    (text.headlineLanguages || []).forEach(l => langs.add(l));
    (text.subheadlineLanguages || []).forEach(l => langs.add(l));
    langs.forEach(lang => {
        Object.assign(getTextLanguageSettings(text, lang), layout);
    });

    // Text background band: only the templates that put text over the device ask
    // for one — every other template clears it so switching template doesn't
    // leave a stray band behind. Same for the extra title→subtitle spacing.
    text.headlineBgColor = L.headlineBgColor || text.headlineBgColor || '#000000';
    text.headlineBgOpacity = L.headlineBgOpacity || 0;
    text.subheadlineBgColor = L.subheadlineBgColor || text.subheadlineBgColor || '#000000';
    text.subheadlineBgOpacity = L.subheadlineBgOpacity || 0;
    text.subheadlineSpacing = L.subheadlineSpacing || 0;

    return text;
}

// The zone + fit options live on the CONTAINER text (they cover the whole screen,
// panorama panels included).
function applyTemplateZone(containerText, step) {
    containerText.textZone = {
        enabled: true,
        uniform: true,  // one size for every language
        // Shrink-to-fit only: the template's font size is the ceiling, so short
        // headlines don't blow up to twice the size of their neighbours.
        fill: false,
        x: step.zone.x,
        y: step.zone.y,
        width: step.zone.width,
        height: step.zone.height
    };
    // Safety net if the zone is later switched off by hand: the text still
    // shrinks rather than running into the device.
    containerText.autoFit = true;
}

function applyTemplateDevice(screenshotSettings, step) {
    const d = step.device;
    screenshotSettings.scale = d.scale;
    screenshotSettings.x = (typeof d.x === 'number') ? d.x : 50;
    screenshotSettings.y = templateDeviceY(d.scale, d.top);
    screenshotSettings.rotation = d.rotation || 0;
    screenshotSettings.perspective = d.perspective || 0;
}

function applyTemplateBackground(background, tpl, paletteIndex) {
    const palette = TEMPLATE_PALETTES[tpl.palette] || TEMPLATE_PALETTES.midnight;
    const colors = palette.sets[paletteIndex % palette.sets.length];
    background.type = 'gradient';
    background.gradient = {
        angle: palette.angle,
        stops: colors.map((color, i) => ({
            color: color,
            position: Math.round((i / Math.max(1, colors.length - 1)) * 100)
        }))
    };
}

// Screens a template application will actually touch, in order.
function templateTargetIndices(opts) {
    if (opts.scope === 'current') {
        return state.screenshots[state.selectedIndex] ? [state.selectedIndex] : [];
    }
    const all = state.screenshots.map((_, i) => i);
    return opts.skipFirst ? all.filter(i => i !== 0) : all;
}

// A screen's rank in the sequence a FULL application would produce. Derived from
// the screen's own index rather than from its position in the current target
// list, so retouching one screen alone lands on the same alternation step and
// the same background as applying the template to the whole project would.
function templateRank(index, skipFirst) {
    return skipFirst ? Math.max(0, index - 1) : index;
}

function applyLayoutTemplate(templateId, opts) {
    const tpl = getLayoutTemplate(templateId);
    if (!tpl) return 0;

    const targets = templateTargetIndices(opts);
    targets.forEach((index) => {
        const ss = state.screenshots[index];
        if (!ss) return;

        const k = templateRank(index, opts.skipFirst);
        const step = tpl.steps[k % tpl.steps.length];

        applyTemplateDevice(ss.screenshot, step);

        ss.text = normalizeTextSettings(ss.text);
        applyTemplateTextLayout(ss.text, step);
        applyTemplateZone(ss.text, step);
        // Panorama: each panel carries its own text object — give them the same
        // layout so a spanned screen doesn't keep the previous arrangement.
        if (Array.isArray(ss.text.panelTexts)) {
            ss.text.panelTexts = ss.text.panelTexts.map(panel =>
                panel ? applyTemplateTextLayout(normalizeTextSettings(panel), step) : panel
            );
        }

        if (!opts.keepBackground) applyTemplateBackground(ss.background, tpl, k);
    });

    if (targets.length) {
        if (typeof setActivePanelIndex === 'function') setActivePanelIndex(0);
        if (typeof syncUIWithState === 'function') syncUIWithState();
        if (typeof updateGradientStopsUI === 'function') updateGradientStopsUI();
        if (typeof updateScreenshotList === 'function') updateScreenshotList();
        if (typeof updateCanvas === 'function') updateCanvas();
        if (typeof saveState === 'function') saveState();
    }
    return targets.length;
}

// ---- Preview thumbnails ---------------------------------------------------
// Drawn from the template's own geometry, so a card can never drift from what
// applying it actually does.

const TPL_FRAME_W = 40;
const TPL_FRAME_H = 60;
const TPL_FRAME_GAP = 7;

function templateFrameSVG(step, clipId) {
    const W = TPL_FRAME_W, H = TPL_FRAME_H;
    const d = step.device;
    const s = d.scale / 100;
    const dw = W * s;
    const dh = H * s;
    const dx = (W - dw) / 2 + (((typeof d.x === 'number' ? d.x : 50) / 100) - 0.5) * Math.max(W - dw, W * 0.15);
    const dy = H * d.top;
    const cx = dx + dw / 2;
    const cy = dy + dh / 2;

    let transform = '';
    if (d.rotation) transform += `rotate(${d.rotation} ${cx.toFixed(2)} ${cy.toFixed(2)}) `;
    if (d.perspective) {
        transform += `translate(${cx.toFixed(2)} ${cy.toFixed(2)}) ` +
                     `matrix(1 ${(d.perspective * 0.01).toFixed(3)} 0 1 0 0) ` +
                     `translate(${(-cx).toFixed(2)} ${(-cy).toFixed(2)})`;
    }

    // Text bars: three lines laid out inside the zone, widths tapering like a
    // wrapped headline followed by a subheadline.
    const z = step.zone;
    const zx = W * z.x / 100, zy = H * z.y / 100;
    const zw = W * z.width / 100, zh = H * z.height / 100;
    const barH = Math.min(2.6, Math.max(1, zh * 0.2));
    const gap = Math.min(1.8, barH * 0.7);
    const block = barH * 3 + gap * 2;
    const top = zy + Math.max(0, (zh - block) / 2);
    const bars = [0.94, 0.72, 0.5].map((w, i) => {
        const bw = zw * w;
        return `<rect class="tpl-bar${i === 2 ? ' tpl-bar-sub' : ''}" x="${(zx + (zw - bw) / 2).toFixed(2)}" ` +
               `y="${(top + i * (barH + gap)).toFixed(2)}" width="${bw.toFixed(2)}" ` +
               `height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}"/>`;
    }).join('');

    return `<clipPath id="${clipId}"><rect x="0" y="0" width="${W}" height="${H}" rx="4"/></clipPath>` +
           `<rect class="tpl-frame" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="4"/>` +
           `<g clip-path="url(#${clipId})">` +
               `<g transform="${transform.trim()}">` +
                   `<rect class="tpl-device" x="${dx.toFixed(2)}" y="${dy.toFixed(2)}" ` +
                   `width="${dw.toFixed(2)}" height="${dh.toFixed(2)}" rx="2"/>` +
               `</g>` +
               `<rect class="tpl-zone" x="${zx.toFixed(2)}" y="${zy.toFixed(2)}" ` +
               `width="${zw.toFixed(2)}" height="${zh.toFixed(2)}" rx="1.5"/>` +
               bars +
           `</g>`;
}

function templatePreviewSVG(tpl) {
    const n = tpl.steps.length;
    const totalW = n * TPL_FRAME_W + (n - 1) * TPL_FRAME_GAP;
    const frames = tpl.steps.map((step, i) =>
        `<g transform="translate(${i * (TPL_FRAME_W + TPL_FRAME_GAP)} 0)">` +
        templateFrameSVG(step, `tplclip-${tpl.id}-${i}`) +
        `</g>`
    ).join('');
    return `<svg class="tpl-preview" viewBox="0 0 ${totalW} ${TPL_FRAME_H}" ` +
           `preserveAspectRatio="xMidYMid meet" aria-hidden="true">${frames}</svg>`;
}

// ---- Modal ----------------------------------------------------------------

let selectedTemplateId = LAYOUT_TEMPLATES[0].id;

function renderTemplateGallery() {
    const gallery = document.getElementById('template-gallery');
    if (!gallery) return;
    gallery.innerHTML = LAYOUT_TEMPLATES.map(tpl =>
        `<button type="button" class="template-card${tpl.id === selectedTemplateId ? ' active' : ''}" ` +
        `data-template="${tpl.id}" title="${tpl.hint.replace(/"/g, '&quot;')}">` +
            `<div class="template-card-preview">${templatePreviewSVG(tpl)}</div>` +
            `<span class="template-card-name">${tpl.name}</span>` +
            `<span class="template-card-hint">${tpl.hint}</span>` +
        `</button>`
    ).join('');

    gallery.querySelectorAll('.template-card').forEach(card => {
        card.addEventListener('click', () => {
            selectedTemplateId = card.dataset.template;
            gallery.querySelectorAll('.template-card').forEach(c =>
                c.classList.toggle('active', c === card));
        });
    });
}

function currentTemplateOptions() {
    const scopeEl = document.getElementById('template-scope');
    return {
        scope: (scopeEl && scopeEl.value === 'current') ? 'current' : 'all',
        skipFirst: !!(document.getElementById('template-skip-first') || {}).checked,
        keepBackground: !!(document.getElementById('template-keep-background') || {}).checked
    };
}

// Live count so the user sees exactly how many screens the options select.
function updateTemplateScopeHint() {
    const hint = document.getElementById('template-scope-hint');
    const skipFirst = document.getElementById('template-skip-first');
    const opts = currentTemplateOptions();
    const isCurrent = opts.scope === 'current';

    if (skipFirst) {
        skipFirst.disabled = isCurrent;
        const row = skipFirst.closest('.copy-design-checkbox');
        if (row) row.classList.toggle('disabled', isCurrent);
    }
    if (!hint) return;

    const n = templateTargetIndices(opts).length;
    if (n === 0) {
        hint.textContent = state.screenshots.length
            ? 'Aucun écran à modifier avec ces options.'
            : 'Aucun écran dans ce projet.';
    } else if (isCurrent) {
        hint.textContent = `Sera appliqué à l’écran ${state.selectedIndex + 1} uniquement.`;
    } else {
        hint.textContent = `Sera appliqué à ${n} écran${n > 1 ? 's' : ''}` +
            (opts.skipFirst && state.screenshots.length ? ' (le 1er est conservé tel quel).' : '.');
    }
}

function openTemplatesModal() {
    const modal = document.getElementById('templates-modal');
    if (!modal) return;
    renderTemplateGallery();
    updateTemplateScopeHint();
    modal.classList.add('visible');
}

function closeTemplatesModal() {
    const modal = document.getElementById('templates-modal');
    if (modal) modal.classList.remove('visible');
}

function initTemplatesModal() {
    const openBtn = document.getElementById('templates-btn');
    const modal = document.getElementById('templates-modal');
    if (!openBtn || !modal) return;

    openBtn.addEventListener('click', openTemplatesModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeTemplatesModal(); });

    const cancel = document.getElementById('templates-cancel');
    if (cancel) cancel.addEventListener('click', closeTemplatesModal);
    const close = document.getElementById('templates-close');
    if (close) close.addEventListener('click', closeTemplatesModal);

    ['template-scope', 'template-skip-first', 'template-keep-background'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateTemplateScopeHint);
    });

    const confirm = document.getElementById('templates-confirm');
    if (confirm) confirm.addEventListener('click', async () => {
        const opts = currentTemplateOptions();
        const tpl = getLayoutTemplate(selectedTemplateId);
        if (!tpl) return;
        if (templateTargetIndices(opts).length === 0) {
            if (typeof showAppAlert === 'function') {
                await showAppAlert('Aucun écran à modifier avec ces options.', 'info');
            }
            return;
        }
        closeTemplatesModal();
        const n = applyLayoutTemplate(selectedTemplateId, opts);
        if (typeof showAppAlert === 'function') {
            let msg = `Template « ${tpl.name} » appliqué à ${n} écran${n > 1 ? 's' : ''}.`;
            if (opts.scope !== 'current' && opts.skipFirst && state.screenshots.length > 0) {
                msg += ' Le 1er écran n’a pas été modifié.';
            }
            if (opts.keepBackground) msg += ' Les fonds ont été conservés.';
            await showAppAlert(msg, 'info');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTemplatesModal);
} else {
    initTemplatesModal();
}
