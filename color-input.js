// Lets every color picker accept a typed value in hex (#rgb / #rrggbb, with or
// without '#') OR rgb()/rgba(). Each native <input type="color"> gets a paired
// text field (reusing an existing `<id>-hex` field, or injecting a compact one),
// and typing drives the native picker (and the app's existing handlers).
(function () {
    function clamp255(x) { return Math.max(0, Math.min(255, Math.round(parseFloat(x)))); }
    function toHex2(n) { return n.toString(16).padStart(2, '0'); }

    // Parse hex or rgb()/rgba() → "#rrggbb", or null if invalid.
    function parseColor(str) {
        if (!str) return null;
        const s = String(str).trim().toLowerCase();
        let m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
        if (m) {
            let h = m[1];
            if (h.length === 3) h = h.split('').map(c => c + c).join('');
            return '#' + h;
        }
        m = s.match(/^rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)/);
        if (m) return '#' + [m[1], m[2], m[3]].map(v => toHex2(clamp255(v))).join('');
        return null;
    }

    function partnerFor(colorInput) {
        let text = document.getElementById(colorInput.id + '-hex');
        if (text) return text;
        const wrap = colorInput.closest('.color-input-wrapper');
        if (wrap) {
            const t = wrap.querySelector('input[type="text"]');
            if (t) return t;
        }
        return null;
    }

    function enhance(colorInput) {
        if (!colorInput.id) colorInput.id = 'color-' + Math.random().toString(36).slice(2, 8);
        if (colorInput.dataset.colorEnhanced) return;
        colorInput.dataset.colorEnhanced = '1';

        let text = partnerFor(colorInput);
        if (!text) {
            text = document.createElement('input');
            text.type = 'text';
            text.className = 'color-text-input';
            text.value = colorInput.value;
            colorInput.insertAdjacentElement('afterend', text);
        }
        colorInput.dataset.colorText = text.id || (text.id = colorInput.id + '-hex');
        text.setAttribute('spellcheck', 'false');
        text.setAttribute('autocomplete', 'off');
        if (!text.placeholder) text.placeholder = '#hex / rgb()';
        text.title = 'Enter a hex (#rrggbb or #rgb) or rgb(r, g, b) color';

        const applyFromText = () => {
            const hex = parseColor(text.value);
            if (hex) {
                if ((colorInput.value || '').toLowerCase() !== hex) {
                    colorInput.value = hex;
                    colorInput.dispatchEvent(new Event('input', { bubbles: true }));
                    colorInput.dispatchEvent(new Event('change', { bubbles: true }));
                }
                text.value = hex;
                text.classList.remove('color-invalid');
            } else {
                text.classList.add('color-invalid');
            }
        };
        text.addEventListener('change', applyFromText);
        text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyFromText(); } });
        text.addEventListener('blur', () => { if (!parseColor(text.value)) { text.value = colorInput.value; text.classList.remove('color-invalid'); } });
        // Native picker → reflect into the text field.
        colorInput.addEventListener('input', () => { text.value = colorInput.value; text.classList.remove('color-invalid'); });
    }

    function enhanceAll() {
        document.querySelectorAll('input[type="color"]').forEach(enhance);
    }

    // After the app re-syncs the UI (which sets color inputs' .value directly),
    // refresh the paired text fields.
    function syncTextFields() {
        document.querySelectorAll('input[type="color"][data-color-enhanced]').forEach((ci) => {
            const t = document.getElementById(ci.dataset.colorText);
            if (t && document.activeElement !== t) t.value = ci.value;
        });
    }

    function init() {
        enhanceAll();
        if (typeof syncUIWithState === 'function') {
            const orig = syncUIWithState;
            // eslint-disable-next-line no-global-assign
            syncUIWithState = function () { orig.apply(this, arguments); try { syncTextFields(); } catch (e) {} };
        }
        // Catch dynamically-added color inputs (gradient stops, elements, popouts),
        // debounced so a burst of body mutations only triggers one scan.
        try {
            let enhanceTimer = null;
            const mo = new MutationObserver(() => {
                clearTimeout(enhanceTimer);
                enhanceTimer = setTimeout(enhanceAll, 100);
            });
            mo.observe(document.body, { childList: true, subtree: true });
        } catch (e) {}
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
