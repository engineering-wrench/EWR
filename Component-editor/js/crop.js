window.App = window.App || {};
(function () {
    const A = window.App;

    // Область обрезки: прямоугольник в координатах холста.
    // Экспортируется только содержимое этой области; viewBox экспорта = область обрезки.
    const crop = {
        MIN_SIZE: 20,
        drag: null,

        init() {
            this.rect = A.$('crop-rect');
            this.dim = A.$('crop-dim');
            this.hole = A.$('crop-mask-hole');
            this.handles = A.$('crop-handles');
            this.label = A.$('crop-size-label');

            this.inpX = A.$('crop-x');
            this.inpY = A.$('crop-y');
            this.inpW = A.$('crop-w');
            this.inpH = A.$('crop-h');

            A.$('btn-crop-apply').addEventListener('click', () => this.applyInputs());
            A.$('btn-crop-reset').addEventListener('click', () => this.reset());
            A.$('btn-crop-content').addEventListener('click', () => this.fitToContent());

            this.rect.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                e.stopPropagation();
                this.startDrag(e, 'move', null);
            });

            this.handles.addEventListener('mousedown', e => {
                if (e.button !== 0) return;
                const h = e.target.closest('.crop-handle');
                if (!h) return;
                e.stopPropagation();
                this.startDrag(e, 'resize', h.dataset.handle);
            });

            this.set(A.state.crop.x, A.state.crop.y, A.state.crop.w, A.state.crop.h, true);
        },

        get() {
            return { x: A.state.crop.x, y: A.state.crop.y, w: A.state.crop.w, h: A.state.crop.h };
        },

        set(x, y, w, h, silent) {
            const vb = A.state.viewBox;
            w = Math.max(this.MIN_SIZE, Math.min(w, vb.w));
            h = Math.max(this.MIN_SIZE, Math.min(h, vb.h));
            x = Math.max(0, Math.min(x, vb.w - w));
            y = Math.max(0, Math.min(y, vb.h - h));

            A.state.crop = { x, y, w, h };
            this.render();

            if (!silent) {
                if (this.inpX) this.inpX.value = Math.round(x);
                if (this.inpY) this.inpY.value = Math.round(y);
                if (this.inpW) this.inpW.value = Math.round(w);
                if (this.inpH) this.inpH.value = Math.round(h);
                A.setStatus('Область обрезки: ' + Math.round(x) + ',' + Math.round(y) + ' ' + Math.round(w) + '×' + Math.round(h));
            }
        },

        applyInputs() {
            const n = id => Number(A.$(id).value) || 0;
            this.set(n('crop-x'), n('crop-y'), n('crop-w'), n('crop-h'));
        },

        reset() {
            const vb = A.state.viewBox;
            this.set((vb.w - 800) / 2, (vb.h - 800) / 2, 800, 800);
        },

        fitToContent() {
            const vb = A.state.viewBox;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            A.refs.shapes.querySelectorAll(':scope > *').forEach(el => {
                const b = el.getBBox && el.getBBox();
                if (!b || (b.width === 0 && b.height === 0)) return;
                minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
                maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
            });
            A.state.ports.forEach(p => {
                minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
                maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
            });
            if (!isFinite(minX)) { this.reset(); return; }
            const pad = 20;
            minX = Math.max(0, Math.floor(minX - pad));
            minY = Math.max(0, Math.floor(minY - pad));
            maxX = Math.min(vb.w, Math.ceil(maxX + pad));
            maxY = Math.min(vb.h, Math.ceil(maxY + pad));
            this.set(minX, minY, Math.max(this.MIN_SIZE, maxX - minX), Math.max(this.MIN_SIZE, maxY - minY));
        },

        startDrag(e, mode, handle) {
            this.drag = {
                mode,
                handle,
                start: A.clientToSvg(e.clientX, e.clientY),
                crop: { ...this.get() }
            };
            e.preventDefault();
        },

        onMouseMove(e) {
            const d = this.drag;
            if (!d) return;
            const pt = A.clientToSvg(e.clientX, e.clientY);
            const dx = pt.x - d.start.x;
            const dy = pt.y - d.start.y;
            const c = d.crop;

            if (d.mode === 'move') {
                this.set(c.x + dx, c.y + dy, c.w, c.h);
                return;
            }

            const min = this.MIN_SIZE;
            let x = c.x, y = c.y, w = c.w, h = c.h;
            if (d.handle.includes('w')) { x = c.x + dx; w = c.w - dx; }
            if (d.handle.includes('e')) { w = c.w + dx; }
            if (d.handle.includes('n')) { y = c.y + dy; h = c.h - dy; }
            if (d.handle.includes('s')) { h = c.h + dy; }
            if (d.handle.includes('w') && w < min) { x = x + w - min; w = min; }
            if (d.handle.includes('n') && h < min) { y = y + h - min; h = min; }
            this.set(x, y, w, h);
        },

        onMouseUp() {
            this.drag = null;
        },

        render() {
            const { x, y, w, h } = A.state.crop;
            if (this.rect) {
                this.rect.setAttribute('x', x);
                this.rect.setAttribute('y', y);
                this.rect.setAttribute('width', w);
                this.rect.setAttribute('height', h);
            }
            if (this.hole) {
                this.hole.setAttribute('x', x);
                this.hole.setAttribute('y', y);
                this.hole.setAttribute('width', w);
                this.hole.setAttribute('height', h);
            }
            if (this.label) {
                const ly = Math.max(12, y - 10);
                this.label.setAttribute('x', x);
                this.label.setAttribute('y', ly);
                this.label.textContent = Math.round(w) + ' × ' + Math.round(h);
            }
            if (this.handles) {
                const hs = { nw: [x, y], ne: [x + w, y], sw: [x, y + h], se: [x + w, y + h] };
                this.handles.querySelectorAll('.crop-handle').forEach(el => {
                    const [hx, hy] = hs[el.dataset.handle];
                    el.setAttribute('x', hx - 5);
                    el.setAttribute('y', hy - 5);
                });
            }
        }
    };

    window.addEventListener('mousemove', e => crop.onMouseMove(e));
    window.addEventListener('mouseup', () => crop.onMouseUp());

    A.crop = crop;
})();
