window.App = window.App || {};
(function () {
    const A = window.App;

    // Галерея исходных элементов EWB: показывает нарезку BITMAP-полос,
    // даёт поле описания, загрузку фото-референса и отправляет элемент
    // на холст как подложку для обводки.
    const gallery = {
        elements: [],
        byId: new Map(),
        selected: null,
        filter: { text: '', strip: '' },
        photos: new Map(),      // id → { name, type, dataUrl }
        drawn: [],              // уже нарисованные компоненты (manifest + symbol.svg)
        drawnByKey: new Map(),  // 'id:<id>' / 'source:<id>' → drawn
        loaded: false,

        init() {
            A.$('btn-library').addEventListener('click', () => this.open());
            A.$('btn-source-library').addEventListener('click', () => this.open());
            A.$('lib-close').addEventListener('click', () => this.close());
            A.$('lib-search').addEventListener('input', e => {
                this.filter.text = e.target.value.toLowerCase().trim();
                this.renderGrid();
            });
            A.$('lib-group').addEventListener('change', e => {
                this.filter.strip = e.target.value;
                this.renderGrid();
            });
            A.$('lib-desc').addEventListener('input', e => this.saveDescription(e.target.value));
            A.$('lib-photo-btn').addEventListener('click', () => A.$('lib-photo-file').click());
            A.$('lib-photo-file').addEventListener('change', e => this.loadPhoto(e));
            A.$('lib-photo-remove').addEventListener('click', () => this.removePhoto());
            A.$('lib-use').addEventListener('click', () => this.useSelected());

            // Клик по затемнению закрывает окно.
            A.$('library').addEventListener('mousedown', e => {
                if (e.target === A.$('library')) this.close();
            });
            document.addEventListener('keydown', e => {
                if (e.key === 'Escape' && !A.$('library').hidden) this.close();
            });

            // Прямая ссылка на библиотеку: index.html#library
            if (location.hash === '#library') this.open();
        },

        async open() {
            A.$('library').hidden = false;
            if (!this.loaded) {
                await this.load();
            } else {
                // Обновляем пометки «сделан» после сохранения/слияния.
                await this.loadDrawn();
                this.renderGrid();
                if (this.selected) this.select(this.selected.id);
            }
        },

        close() {
            A.$('library').hidden = true;
        },

        async load() {
            try {
                const res = await fetch('elements/index.json', { cache: 'no-cache' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                this.elements = data.elements || [];
                this.byId = new Map(this.elements.map(el => [el.id, el]));
                await this.loadDrawn();
                this.loaded = true;
                this.renderGroupFilter();
                this.renderGrid();
                A.$('lib-count').textContent = this.elements.length + ' шт.';
            } catch (err) {
                A.$('lib-grid').innerHTML =
                    '<p class="sp-empty">Не удалось загрузить элементы/index.json: ' + escapeHtml(err.message) +
                    '<br>Запустите скрипт <code>node Component-editor/tools/slice-elements.mjs</code> ' +
                    'и откройте страницу через Live Server.</p>';
            }
        },

        /** Уже нарисованные компоненты из studio/repo/Site (если запущен studio). */
        async loadDrawn() {
            this.drawn = [];
            this.drawnByKey = new Map();
            try {
                const res = await fetch('/api/drawn-components', { cache: 'no-store' });
                if (!res.ok) return;
                const data = await res.json();
                this.drawn = Array.isArray(data.components) ? data.components : [];
            } catch (_) {
                return; // обычный Live Server — просто без пометок «сделан»
            }
            for (const item of this.drawn) {
                if (item.id) this.drawnByKey.set('id:' + item.id, item);
                if (item.dir) this.drawnByKey.set('dir:' + item.dir, item);
                if (item.source) this.drawnByKey.set('source:' + item.source, item);
            }
        },

        /** Возвращает нарисованный компонент для элемента библиотеки. */
        drawnOf(el) {
            if (!el) return null;
            return this.drawnByKey.get('source:' + el.id) ||
                this.drawnByKey.get('id:' + el.id) ||
                this.drawnByKey.get('dir:' + el.id) || null;
        },

        renderGroupFilter() {
            const sel = A.$('lib-group');
            const strips = [...new Set(this.elements.map(el => el.strip))].sort();
            sel.innerHTML = '<option value="">Все полосы</option>' +
                strips.map(s => `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`).join('');
        },

        renderGrid() {
            const grid = A.$('lib-grid');
            const text = this.filter.text;
            const list = this.elements.filter(el => {
                if (this.filter.strip && el.strip !== this.filter.strip) return false;
                if (!text) return true;
                const desc = this.descriptionOf(el.id).toLowerCase();
                return el.id.toLowerCase().includes(text) || desc.includes(text);
            });
            A.$('lib-count').textContent = list.length + ' / ' + this.elements.length;

            const html = list.map(el => {
                const active = this.selected && this.selected.id === el.id ? ' active' : '';
                const drawn = this.drawnOf(el);
                const done = drawn ? ' lib-item--done' : '';
                const desc = this.descriptionOf(el.id);
                return `<button type="button" class="lib-item${active}${done}" data-id="${escapeAttr(el.id)}"
                            title="${escapeAttr(el.id)}${desc ? ' — ' + escapeAttr(desc) : ''}${drawn ? ' · сделан' : ''}">
                            <img loading="lazy" src="elements/${escapeAttr(el.icon || el.file)}" alt="">
                            ${drawn ? '<span class="lib-done" title="Компонент уже нарисован">✓</span>' : ''}
                            <span>${escapeHtml(el.id.replace('ewb-', ''))}</span>
                        </button>`;
            }).join('');
            grid.innerHTML = html || '<p class="sp-empty">Ничего не найдено</p>';
            grid.querySelectorAll('.lib-item').forEach(btn => {
                btn.addEventListener('click', () => this.select(btn.dataset.id));
            });
        },

        select(id) {
            const el = this.byId.get(id);
            if (!el) return;
            this.selected = el;
            this.renderGrid();

            const img = A.$('lib-preview');
            img.src = 'elements/' + (el.icon || el.file);
            img.hidden = false;
            A.$('lib-preview-empty').hidden = true;

            A.$('lib-desc').value = this.descriptionOf(id);
            const drawn = this.drawnOf(el);
            A.$('lib-meta').innerHTML =
                `<div><b>${escapeHtml(el.id)}</b></div>` +
                `<div>${el.width}×${el.height} px · ${escapeHtml(el.strip)}</div>` +
                `<div>статус: <b class="${drawn ? 'lib-status-done' : ''}">${drawn ? 'сделан' : 'не сделан'}</b></div>` +
                (drawn ? `<div>компонент: <span class="lib-src">${escapeHtml(drawn.dir)}</span></div>` : '') +
                `<div>иконка: <span class="lib-src">${escapeHtml(el.icon || el.file)}</span></div>` +
                `<div>элемент: <span class="lib-src">${escapeHtml(el.symbol || '—')}</span></div>` +
                `<div class="lib-src">${escapeHtml(el.source)}</div>`;

            const useBtn = A.$('lib-use');
            useBtn.textContent = drawn ? 'Открыть на редактирование' : 'Перерисовать этот элемент';

            this.renderPhoto();
        },

        descriptionKey(id) { return 'ewr.componentEditor.desc.' + id; },

        descriptionOf(id) {
            try { return localStorage.getItem(this.descriptionKey(id)) || ''; } catch (_) { return ''; }
        },

        saveDescription(text) {
            if (!this.selected) return;
            try { localStorage.setItem(this.descriptionKey(this.selected.id), text); } catch (_) { /* приватный режим */ }
            A.state.meta.description = text;
            const d = A.$('exp-description');
            if (d) d.value = text;
        },

        loadPhoto(e) {
            const file = e.target.files && e.target.files[0];
            e.target.value = '';
            if (!file || !this.selected) return;
            const reader = new FileReader();
            reader.onload = () => {
                this.photos.set(this.selected.id, {
                    name: file.name,
                    type: file.type || 'image/png',
                    dataUrl: String(reader.result)
                });
                A.state.meta.photo = this.photos.get(this.selected.id);
                this.renderPhoto();
                // Сразу показываем фото под холстом, чтобы можно было обводить.
                this.installPhotoAsBackground(this.photos.get(this.selected.id));
            };
            reader.readAsDataURL(file);
        },

        removePhoto() {
            if (!this.selected) return;
            this.photos.delete(this.selected.id);
            A.state.meta.photo = null;
            this.renderPhoto();
            A.setStatus('Фото-референс убран');
        },

        renderPhoto() {
            const box = A.$('lib-photo-preview');
            const ph = this.selected ? this.photos.get(this.selected.id) : null;
            if (!ph) {
                box.hidden = true;
                return;
            }
            A.$('lib-photo-img').src = ph.dataUrl;
            A.$('lib-photo-name').textContent = ph.name + ' · ' + Math.round(ph.dataUrl.length / 1024) + ' КБ';
            box.hidden = false;
        },

        installPhotoAsBackground(ph) {
            const img = new Image();
            img.onload = () => {
                A.background.install(ph.dataUrl, img.naturalWidth, img.naturalHeight, {
                    target: 760, opacity: 0.55, kind: 'photo',
                    status: 'Фото-референс на холсте: ' + img.naturalWidth + '×' + img.naturalHeight
                });
            };
            img.src = ph.dataUrl;
        },

        async useSelected() {
            if (!this.selected) return;
            const el = this.selected;
            const drawn = this.drawnOf(el);
            if (drawn) {
                await this.openDrawn(drawn, el);
                return;
            }
            const desc = A.$('lib-desc').value;
            this.saveDescription(desc);

            // Запоминаем источник и фото для экспорта (новый компонент, не правка).
            A.state.meta = {
                elementId: el.id,
                source: el.source,
                description: desc,
                photo: this.photos.get(el.id) || null,
                originRoot: null,
                originDir: null,
                preserveIcon: false,
            };

            // Заполняем поля экспорта.
            A.$('exp-id').value = el.id;
            A.$('exp-name').value = 'Элемент ' + el.strip.replace('BITMAP', '') + ' №' + el.index;
            A.$('exp-category').value = 'component';
            A.$('exp-description').value = desc;
            A.$('exp-source').textContent = 'Источник: ' + el.source + ' · ячейка ' + el.index;

            const ph = this.photos.get(el.id);
            const refSrc = ph ? ph.dataUrl : ('elements/' + (el.symbol || el.icon || el.file));
            const img = new Image();
            img.onload = () => {
                if (ph) {
                    // Пользователь уже загрузил своё фото — оно важнее исходной иконки.
                    A.background.install(refSrc, img.naturalWidth, img.naturalHeight, {
                        target: 760, opacity: 0.55, kind: 'photo',
                        status: 'Фото-референс на холсте: ' + img.naturalWidth + '×' + img.naturalHeight
                    });
                } else {
                    A.background.install(refSrc, img.naturalWidth, img.naturalHeight, {
                        target: 340, opacity: 0.65, kind: 'element',
                        status: 'Элемент ' + el.id + ' — подложка для обводки'
                    });
                }
            };
            img.src = refSrc;

            // Подгоняем область обрезки под квадрат 1:1 вокруг центра.
            A.crop.reset();
            this.close();
            A.setTool('select');
        },

        /** Открывает уже нарисованный компонент на холсте для правки. */
        async openDrawn(drawn, el) {
            try {
                const [svgRes, manRes] = await Promise.all([
                    fetch(drawn.symbolUrl, { cache: 'no-store' }),
                    fetch(drawn.manifestUrl, { cache: 'no-store' }),
                ]);
                if (!svgRes.ok) throw new Error('symbol.svg: HTTP ' + svgRes.status);
                const svgText = await svgRes.text();
                let manifest = null;
                if (manRes.ok) {
                    try { manifest = await manRes.json(); } catch (_) { manifest = null; }
                }

                // Убираем старую подложку, но не трогаем выбранный элемент галереи.
                if (A.refs.bg) A.refs.bg.remove();
                A.state.bg = { el: null, naturalW: 0, naturalH: 0 };
                A.background.renderControls(false);

                const info = A.tools.loadSvgText(svgText);
                if (manifest && Array.isArray(manifest.ports)) A.ports.loadPorts(manifest.ports);

                if (info.viewBox) {
                    A.crop.set(info.viewBox.x, info.viewBox.y, info.viewBox.w, info.viewBox.h);
                } else {
                    A.crop.fitToContent();
                }

                const desc = (manifest && manifest.description) || info.desc || this.descriptionOf(el.id);
                const name = (manifest && manifest.name) || ('Элемент ' + el.strip.replace('BITMAP', '') + ' №' + el.index);
                const category = (manifest && manifest.category) || 'component';
                const source = (manifest && manifest.source) || drawn.source || el.id;

                A.state.meta = {
                    elementId: source,
                    source,
                    description: desc,
                    photo: null,
                    originRoot: drawn.rootKey,
                    originDir: drawn.dir,
                    preserveIcon: true,
                };

                A.$('exp-id').value = (manifest && manifest.id) || drawn.id || el.id;
                A.$('exp-name').value = name;
                A.$('exp-category').value = category;
                A.$('exp-description').value = desc;
                A.$('exp-source').textContent = 'Открыт готовый компонент: ' + drawn.dir +
                    ' · ' + drawn.rootKey;
                A.$('lib-desc').value = desc;
                try { localStorage.setItem(this.descriptionKey(el.id), desc); } catch (_) { /* приватный режим */ }

                this.close();
                A.setTool('select');
                A.setStatus('Открыт для редактирования: ' + drawn.dir + ' (' + info.count + ' элементов)');
            } catch (err) {
                window.alert('Не удалось открыть готовый компонент: ' + err.message);
            }
        },

        // Сброс метаданных при «Очистить холст».
        reset() {
            this.selected = null;
            A.state.meta = { elementId: '', source: '', description: '', photo: null };
            A.$('exp-description').value = '';
            A.$('exp-source').textContent = 'Элемент не выбран — рисуйте с нуля или откройте «Библиотеку элементов».';
            this.renderPhoto();
        }
    };

    function escapeAttr(v) {
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function escapeHtml(v) {
        return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    A.gallery = gallery;
})();
