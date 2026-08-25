// Resizable + collapsible left/right panels.
// Adds drag handles at the sidebar boundaries and collapse/reopen toggles,
// driving the .app-container grid via CSS variables. State persists locally.
(function () {
    function init() {
        const container = document.querySelector('.app-container');
        if (!container) return;
        const left = document.querySelector('.sidebar:not(.sidebar-right)');
        const right = document.querySelector('.sidebar-right');

        const KEY = { lw: 'panelLeftW', rw: 'panelRightW', lc: 'panelLeftCollapsed', rc: 'panelRightCollapsed' };
        const MIN = 220, MAX = 600;
        const clamp = (v) => Math.max(MIN, Math.min(MAX, v));
        const state = {
            leftW: parseInt(localStorage.getItem(KEY.lw), 10) || 320,
            rightW: parseInt(localStorage.getItem(KEY.rw), 10) || 340,
            leftCollapsed: localStorage.getItem(KEY.lc) === '1',
            rightCollapsed: localStorage.getItem(KEY.rc) === '1',
        };

        function apply() {
            container.style.setProperty('--left-w', (state.leftCollapsed ? 0 : state.leftW) + 'px');
            container.style.setProperty('--right-w', (state.rightCollapsed ? 0 : state.rightW) + 'px');
            container.classList.toggle('left-collapsed', state.leftCollapsed);
            container.classList.toggle('right-collapsed', state.rightCollapsed);
        }
        function save() {
            localStorage.setItem(KEY.lw, state.leftW);
            localStorage.setItem(KEY.rw, state.rightW);
            localStorage.setItem(KEY.lc, state.leftCollapsed ? '1' : '0');
            localStorage.setItem(KEY.rc, state.rightCollapsed ? '1' : '0');
        }
        function refreshCanvas() {
            if (typeof updateSidePreviews === 'function') { try { updateSidePreviews(); } catch (e) {} }
        }

        // ---- Drag handles (positioned at the grid boundaries) ----
        function makeHandle(side) {
            const h = document.createElement('div');
            h.className = 'panel-resize-handle ' + side;
            h.title = 'Drag to resize · double-click to ' + (side === 'left' ? 'collapse' : 'collapse');
            container.appendChild(h);
            h.addEventListener('mousedown', (e) => {
                e.preventDefault();
                h.classList.add('dragging');
                const startX = e.clientX;
                const startW = side === 'left' ? state.leftW : state.rightW;
                const onMove = (ev) => {
                    const dx = ev.clientX - startX;
                    if (side === 'left') state.leftW = clamp(startW + dx);
                    else state.rightW = clamp(startW - dx);
                    apply();
                };
                const onUp = () => {
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.body.classList.remove('panel-resizing');
                    h.classList.remove('dragging');
                    save();
                    refreshCanvas();
                };
                document.body.classList.add('panel-resizing');
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
            });
            h.addEventListener('dblclick', () => {
                if (side === 'left') state.leftCollapsed = true; else state.rightCollapsed = true;
                apply(); save(); refreshCanvas();
            });
            return h;
        }

        // ---- Collapse buttons in the sidebar headers ----
        const CHEV_LEFT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg>';
        const CHEV_RIGHT = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>';

        function addCollapseBtn(sideEl, side) {
            const header = sideEl.querySelector('.sidebar-header');
            if (!header) return;
            const btn = document.createElement('button');
            btn.className = 'panel-collapse-btn ' + side;
            btn.title = 'Collapse panel';
            btn.innerHTML = side === 'left' ? CHEV_LEFT : CHEV_RIGHT;
            header.appendChild(btn);
            btn.addEventListener('click', () => {
                if (side === 'left') state.leftCollapsed = true; else state.rightCollapsed = true;
                apply(); save(); refreshCanvas();
            });
        }

        // ---- Floating reopen tabs (shown when collapsed) ----
        function addReopen(side) {
            const tab = document.createElement('button');
            tab.className = 'panel-reopen ' + side;
            tab.title = 'Show panel';
            tab.innerHTML = side === 'left' ? CHEV_RIGHT : CHEV_LEFT;
            container.appendChild(tab);
            tab.addEventListener('click', () => {
                if (side === 'left') state.leftCollapsed = false; else state.rightCollapsed = false;
                apply(); save(); refreshCanvas();
            });
        }

        if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
        if (left) { makeHandle('left'); addCollapseBtn(left, 'left'); addReopen('left'); }
        if (right) { makeHandle('right'); addCollapseBtn(right, 'right'); addReopen('right'); }
        apply();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
