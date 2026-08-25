// Update checker. Detects when the server/container has been redeployed with a
// newer build and lets the user reload the whole app to apply it.
// Primary signal = a content hash of a core asset (robust across any host /
// missing-or-cached ETag headers); falls back to ETag/Last-Modified/size.
(function () {
    const ASSET = 'app.js';        // changes on every code deploy
    const POLL_MS = 5 * 60 * 1000; // background poll every 5 min (+ on focus)
    const FOCUS_THROTTLE = 30000;
    let baseline = null;
    let available = false;
    let btn = null;
    let lastFocusCheck = 0;

    // Fast 53-bit string hash (cyrb53).
    function hash(str) {
        let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
        for (let i = 0; i < str.length; i++) {
            const ch = str.charCodeAt(i);
            h1 = Math.imul(h1 ^ ch, 2654435761);
            h2 = Math.imul(h2 ^ ch, 1597334677);
        }
        h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
        h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
        h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
        h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
        return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
    }

    async function fetchSignature() {
        const url = ASSET + '?_=' + Date.now();
        try {
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return null;
            const text = await res.text();
            return 'h' + hash(text) + '.' + text.length;
        } catch (e) {
            // Fallback to header-based signal if a full GET fails.
            try {
                const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
                const sig = (r.headers.get('etag') || '') + '|' + (r.headers.get('last-modified') || '') + '|' + (r.headers.get('content-length') || '');
                return sig.replace(/[|]+/g, '') ? sig : null;
            } catch (e2) {
                return null;
            }
        }
    }

    function setAvailable(v) {
        available = v;
        if (!btn) return;
        btn.classList.toggle('available', v);
        btn.title = v ? 'Update available — click to reload the app' : 'Up to date';
    }

    function flash(msg) {
        if (typeof showAppAlert === 'function') { try { showAppAlert(msg, 'info'); return; } catch (e) {} }
        if (btn) { const t = btn.title; btn.title = msg; setTimeout(() => { btn.title = t; }, 1600); }
    }

    // Returns true if an update is available.
    async function check(manual) {
        if (manual && btn) btn.classList.add('checking');
        const sig = await fetchSignature();
        if (btn) btn.classList.remove('checking');
        if (!sig) { if (manual) flash("Couldn't check for updates"); return false; }
        if (baseline === null) { baseline = sig; if (manual) flash('Up to date — you have the latest version'); return false; }
        if (sig !== baseline) { setAvailable(true); return true; }
        if (manual) flash('Up to date — you have the latest version');
        return false;
    }

    async function doUpdate() {
        try { if ('caches' in window) { const ks = await caches.keys(); await Promise.all(ks.map(k => caches.delete(k))); } } catch (e) {}
        try {
            if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
            }
        } catch (e) {}
        location.reload();
    }

    function init() {
        btn = document.getElementById('update-btn');
        if (!btn) return;
        btn.addEventListener('click', async () => {
            // Always re-check on click, then apply immediately if there's an update.
            const hasUpdate = (await check(true)) || available;
            if (hasUpdate) {
                const ok = window.confirm('A new version of the app is available. Update now?\nYour project is saved automatically.');
                if (ok) doUpdate();
            }
        });
        check();
        setInterval(() => check(false), POLL_MS);
        const onFocus = () => { const now = Date.now(); if (now - lastFocusCheck > FOCUS_THROTTLE) { lastFocusCheck = now; check(false); } };
        window.addEventListener('focus', onFocus);
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') onFocus(); });

        window.__appUpdater = {
            check, doUpdate, setAvailable, fetchSignature,
            get available() { return available; },
            get baseline() { return baseline; },
        };
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
