window.App = window.App || {};
(function () {
    const A = window.App;

    const background = {
        init() {
            A.$('btn-bg-load').addEventListener('click', () => A.$('bg-file').click());
            A.$('bg-file').addEventListener('change', e => this.loadFile(e));
            A.$('bg-opacity').addEventListener('input', e => this.setOpacity(Number(e.target.value)));
            A.$('bg-scale').addEventListener('input', e => this.setScale(Number(e.target.value)));
            A.$('bg-visible').addEventListener('change', e => this.setVisible(e.target.checked));
            A.$('btn-bg-remove').addEventListener('click', () => this.remove());
        },

        loadFile(e) {
            const file = e.target.files && e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result);
                const img = new Image();
                img.onload = () => {
                    this.install(dataUrl, img.naturalWidth, img.naturalHeight);
                };
                img.src = dataUrl;
            };
            reader.readAsDataURL(file);
            e.target.value = '';
        },

        install(src, naturalW, naturalH) {
            if (A.refs.bg) A.refs.bg.remove();
            const { w, h } = A.state.viewBox;
            const scale = Math.min(w / naturalW, h / naturalH);
            const iw = naturalW * scale, ih = naturalH * scale;

            const el = A.svgEl('image', {
                href: src,
                x: (w - iw) / 2, y: (h - ih) / 2,
                width: iw, height: ih,
                opacity: 0.5,
                style: 'pointer-events:visiblePainted; cursor:move; image-rendering:auto'
            });

            A.refs.bg = el;
            A.refs.svg.insertBefore(el, A.refs.shapes);

            A.state.bg.el = el;
            A.state.bg.naturalW = naturalW;
            A.state.bg.naturalH = naturalH;

            A.$('bg-opacity').value = 50;
            A.$('bg-scale').value = Math.round(scale * 100);
            A.$('bg-visible').checked = true;
            this.renderControls(true);
            A.setStatus('Подложка загружена: ' + naturalW + '×' + naturalH);
        },

        _size() {
            const b = A.state.bg;
            const base = Math.min((A.state.viewBox.w / b.naturalW), (A.state.viewBox.h / b.naturalH));
            return { w: b.naturalW * base, h: b.naturalH * base };
        },

        _applyScale(scaleFactor, keepCenter) {
            const el = A.refs.bg;
            if (!el) return;
            const { w, h } = this._size();
            const nw = w * scaleFactor, nh = h * scaleFactor;
            const cx = keepCenter ? Number(el.getAttribute('x')) + Number(el.getAttribute('width')) / 2 : A.state.viewBox.w / 2;
            const cy = keepCenter ? Number(el.getAttribute('y')) + Number(el.getAttribute('height')) / 2 : A.state.viewBox.h / 2;
            el.setAttribute('x', cx - nw / 2);
            el.setAttribute('y', cy - nh / 2);
            el.setAttribute('width', nw);
            el.setAttribute('height', nh);
        },

        setScale(percent) {
            if (!A.refs.bg) return;
            this._applyScale(percent / 100, true);
            A.setStatus('Подложка: масштаб ' + percent + '%');
        },

        setOpacity(value) {
            if (A.refs.bg) A.refs.bg.setAttribute('opacity', value / 100);
        },

        setVisible(visible) {
            if (A.refs.bg) A.refs.bg.setAttribute('display', visible ? '' : 'none');
            if (visible && A.refs.bg) A.refs.bg.removeAttribute('display');
        },

        moveTo(x, y) {
            if (!A.refs.bg) return;
            A.refs.bg.setAttribute('x', x);
            A.refs.bg.setAttribute('y', y);
        },

        remove() {
            if (A.refs.bg) {
                A.refs.bg.remove();
                A.refs.bg = null;
            }
            A.state.bg = { el: null, naturalW: 0, naturalH: 0 };
            this.renderControls(false);
            A.setStatus('Подложка удалена');
        },

        renderControls(hasBg) {
            document.getElementById('bg-controls').style.display = hasBg ? '' : 'none';
        }
    };

    A.background = background;
})();