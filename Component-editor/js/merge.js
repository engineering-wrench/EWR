window.App = window.App || {};
(function () {
    const A = window.App;

    // Категории и элементы палитры EWR. Данные скопированы из
    // Site/logic/js/interface.js (idListCategoryEl / idListComponent):
    // сам Site не меняем, а повторяем интерфейс вкладок в студии.
    // tile — номер плитки в исходной BMP-полосе (24 px): из него берётся иконка.
    const CATEGORY_TABS = [
        { id: 'save_component', label: 'Сохранить', tile: 0 },
        { id: 'sources', label: 'Источники', tile: 1 },
        { id: 'component', label: 'Компоненты', tile: 2 },
        { id: 'diod', label: 'Диоды', tile: 3 },
        { id: 'transistor', label: 'Транзисторы', tile: 4 },
        { id: 'analog', label: 'Аналоговые', tile: 5 },
        { id: 'mixed', label: 'Смешанные', tile: 6 },
        { id: 'digit', label: 'Цифровые', tile: 7 },
        { id: 'logic', label: 'Логика', tile: 8 },
        { id: 'function', label: 'Функции', tile: 11 },
        { id: 'text', label: 'Текст', tile: 12 },
        { id: 'instrument', label: 'Приборы', tile: 13 },
    ];

    // Из idListComponent: '???'-плитки пропущены, tile — исходная позиция.
    const CATEGORY_ELEMENTS = {
        component: [
            { id: 'point', label: 'Точка', tile: 0 },
            { id: 'resistor', label: 'Резистор', tile: 1 },
            { id: 'capacitor', label: 'Конденсатор', tile: 2 },
            { id: 'inductor', label: 'Катушка индуктивности', tile: 3 },
        ],
        instrument: [
            { id: 'multimeter', label: 'Мультиметр', tile: 0 },
            { id: 'generator', label: 'Генератор сигналов', tile: 1 },
            { id: 'oscilograph', label: 'Осциллограф', tile: 2 },
            { id: 'stenograhp', label: 'Логический анализатор', tile: 3 },
            { id: 'digital', label: 'Цифровой прибор', tile: 4 },
        ],
        text: [
            { id: 'net', label: 'Сеть/узел', tile: 2 },
            { id: 'paper', label: 'Лист', tile: 3 },
            { id: 'rotor', label: 'Ротор', tile: 6 },
            { id: 'up', label: 'Вверх', tile: 8 },
            { id: 'down', label: 'Вниз', tile: 9 },
            { id: 'vertical', label: 'Вертикально', tile: 10 },
            { id: 'text', label: 'Текст', tile: 11 },
            { id: 'draft', label: 'Черновик', tile: 12 },
        ],
    };

    const merge = {
        items: [],
        byId: new Map(),
        byCategory: new Map(),
        categories: [],
        apiById: new Map(),
        selectedCategory: 'component',
        selected: null,
        scale: 1,
        fit: false,
        loaded: false,
        loading: null,
        server: false,
        mainTiles: null,
        stripCache: new Map(),
        iconCache: new Map(),

        init() {
            A.$('merge-scale').addEventListener('input', () => {
                this.fit = false;
                this.updateSizeHint();
            });
            A.$('merge-fit').addEventListener('click', () => this.fitToElement());
            A.$('merge-reset').addEventListener('click', () => {
                this.fit = false;
                A.$('merge-scale').value = 100;
                this.updateSizeHint();
            });
            A.$('btn-merge').addEventListener('click', () => this.merge());
            this.loadPalette();
        },

        refresh() {
            if (!this.loaded && !this.loading) this.loadPalette();
            this.updateSizeHint();
        },

        async loadPalette() {
            this.loading = (async () => {
                let api = [];
                try {
                    const res = await fetch('/api/palette', { cache: 'no-store' });
                    if (!res.ok) throw new Error('HTTP ' + res.status);
                    const data = await res.json();
                    api = Array.isArray(data.elements) ? data.elements : [];
                    this.server = true;
                } catch (_) {
                    this.server = false;
                }
                this.apiById = new Map(api.map(el => [el.id, el]));

                const items = [];
                const seen = new Set();
                for (const [category, list] of Object.entries(CATEGORY_ELEMENTS)) {
                    for (const el of list) {
                        items.push({
                            id: el.id,
                            label: el.label,
                            category,
                            tile: el.tile,
                            actual: this.apiById.get(el.id) || null,
                        });
                        seen.add(el.id);
                    }
                }
                // Дополнительные манифесты из Site/components, которых нет в списке EWR.
                for (const el of api) {
                    if (seen.has(el.id)) continue;
                    items.push({
                        id: el.id,
                        label: el.name || el.id,
                        category: el.category || 'component',
                        tile: null,
                        actual: el,
                    });
                }

                this.items = items;
                this.byId = new Map(items.map(it => [it.id, it]));
                this.categories = CATEGORY_TABS.slice();
                for (const it of items) {
                    if (!this.categories.some(c => c.id === it.category)) {
                        this.categories.push({ id: it.category, label: it.category, tile: null });
                    }
                }
                this.byIdCategory = new Map();
                for (const it of items) {
                    if (!this.byIdCategory.has(it.category)) this.byIdCategory.set(it.category, []);
                    this.byIdCategory.get(it.category).push(it);
                }

                this.loaded = true;
                this.renderCategoryTabs();
                this.renderElements();
                this.updateServerHint();
            })();
            await this.loading;
            this.loading = null;
        },

        updateServerHint() {
            const hint = A.$('merge-hint');
            if (!hint) return;
            if (this.server) {
                hint.innerHTML = 'Слияние пишет <code>Site/components/&lt;id&gt;/symbol.svg</code>. ' +
                    'Иконка (BMP-плитка палитры) и manifest.json существующего элемента не меняются.';
            } else {
                hint.innerHTML = 'Сервер студии не найден — запустите <code>npm run studio</code>. ' +
                    'Без него список палитры можно посмотреть, но слияние недоступно.';
            }
        },

        renderCategoryTabs() {
            const box = A.$('merge-cats');
            if (!box) return;
            box.innerHTML = '';
            for (const cat of this.categories) {
                const count = (this.byIdCategory.get(cat.id) || []).length;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'merge-cat' + (cat.id === this.selectedCategory ? ' active' : '');
                btn.title = cat.label + (count ? ' · ' + count + ' элем.' : ' · нет элементов');
                btn.dataset.category = cat.id;
                btn.disabled = count === 0;
                btn.innerHTML = '<span class="merge-cat-icon"></span>' +
                    '<span class="merge-cat-label">' + escapeHtml(cat.label) + '</span>';
                btn.addEventListener('click', () => this.selectCategory(cat.id));
                box.appendChild(btn);
                if (cat.tile != null) {
                    this.mainTile(cat.tile).then(url => {
                        if (!url) return;
                        const icon = btn.querySelector('.merge-cat-icon');
                        icon.style.backgroundImage = 'url("' + url + '")';
                    });
                }
            }
        },

        selectCategory(id) {
            if (this.selectedCategory === id) return;
            this.selectedCategory = id;
            this.renderCategoryTabs();
            this.renderElements();
        },

        renderElements() {
            const box = A.$('merge-elements');
            if (!box) return;
            const list = this.byIdCategory.get(this.selectedCategory) || [];
            if (!list.length) {
                box.innerHTML = '<p class="sp-empty">В этой категории пока нет именованных элементов палитры. ' +
                    'Нарисуйте символ и сохраните его через вкладку «Экспорт».</p>';
                return;
            }
            box.innerHTML = '';
            for (const item of list) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'merge-el' + (this.selected && this.selected.id === item.id ? ' active' : '');
                btn.dataset.id = item.id;
                const exists = item.actual
                    ? (item.actual.hasSymbol ? 'есть symbol.svg' : 'манифест есть, symbol.svg нет')
                    : 'элемента ещё нет в Site/components — будет создан';
                btn.title = item.id + ' · ' + item.label + ' · ' + exists;
                btn.innerHTML = '<span class="merge-el-icon"></span>' +
                    '<span class="merge-el-label">' + escapeHtml(item.label) + '</span>' +
                    '<span class="merge-el-id">' + escapeHtml(item.id) + '</span>';
                btn.addEventListener('click', () => this.selectElement(item.id));
                box.appendChild(btn);
                this.elementIcon(item).then(src => {
                    const icon = btn.querySelector('.merge-el-icon');
                    if (!src) {
                        icon.textContent = item.id.slice(0, 2);
                        icon.classList.add('merge-el-icon--text');
                        return;
                    }
                    const img = document.createElement('img');
                    img.alt = '';
                    img.src = src;
                    icon.appendChild(img);
                });
            }
        },

        selectElement(id) {
            const item = this.byId.get(id);
            if (!item) return;
            this.selected = item;
            this.fit = false;
            this.renderElements();
            this.renderTarget();
            this.updateSizeHint();
        },

        renderTarget() {
            const box = A.$('merge-target');
            if (!box) return;
            const item = this.selected;
            if (!item) {
                box.innerHTML = '<p class="sp-empty">Элемент не выбран</p>';
                return;
            }
            const a = item.actual;
            const size = a && a.size ? a.size.w + '×' + a.size.h + ' px' : 'неизвестен';
            const stateText = a
                ? (a.hasSymbol ? 'в палитре (symbol.svg уже есть)' : 'в палитре (symbol.svg будет создан)')
                : 'будет добавлен в Site/components';
            box.innerHTML =
                '<div><b>' + escapeHtml(item.id) + '</b> · ' + escapeHtml(item.label) + '</div>' +
                '<div>категория: <code>' + escapeHtml(item.category) + '</code></div>' +
                '<div>размер элемента: ' + escapeHtml(size) + '</div>' +
                '<div>состояние: ' + escapeHtml(stateText) + '</div>';
        },

        fitToElement() {
            const size = this.selected && this.selected.actual && this.selected.actual.size;
            if (!size || !size.w || !size.h) {
                window.alert('У выбранного элемента нет размера в manifest.json — выберите другой элемент или задайте масштаб вручную.');
                return;
            }
            const crop = A.state.crop;
            const scale = Math.min(size.w / crop.w, size.h / crop.h);
            this.fit = true;
            A.$('merge-scale').value = Math.round(scale * 100);
            this.updateSizeHint();
        },

        /** Итоговый размер/масштаб с учётом режима «вписать». */
        outSize() {
            const crop = A.state.crop;
            const size = this.selected && this.selected.actual && this.selected.actual.size;
            if (this.fit && size && size.w > 0 && size.h > 0) {
                const scale = Math.min(size.w / crop.w, size.h / crop.h);
                return {
                    fit: true,
                    scale,
                    w: Math.round(size.w),
                    h: Math.round(size.h),
                    dx: (size.w - crop.w * scale) / 2,
                    dy: (size.h - crop.h * scale) / 2,
                };
            }
            const pct = Math.min(1000, Math.max(1, Number(A.$('merge-scale').value) || 100));
            const scale = pct / 100;
            return {
                fit: false,
                scale,
                w: Math.max(1, Math.round(crop.w * scale)),
                h: Math.max(1, Math.round(crop.h * scale)),
                dx: 0,
                dy: 0,
            };
        },

        updateSizeHint() {
            const hint = A.$('merge-size-hint');
            if (!hint) return;
            const spec = this.outSize();
            const target = this.selected && this.selected.actual && this.selected.actual.size;
            const targetText = target
                ? ' · размер элемента ' + target.w + '×' + target.h
                : '';
            hint.textContent = 'Итоговый размер: ' + spec.w + ' × ' + spec.h + ' px' +
                (spec.fit ? ' (вписано)' : '') + targetText;
        },

        /** Манифест создаётся только для элемента, которого ещё нет в палитре. */
        buildManifest(spec) {
            const crop = A.state.crop;
            const ports = A.state.ports.map(p => ({
                id: p.id,
                label: p.label,
                role: p.role,
                dir: p.dir || 'auto',
                x: Math.round((p.x - crop.x) * spec.scale + spec.dx),
                y: Math.round((p.y - crop.y) * spec.scale + spec.dy),
            }));
            return {
                id: this.selected.id,
                name: this.selected.label,
                category: this.selected.category,
                description: 'Слито из Component-editor',
                source: this.selected.id,
                size: { w: spec.w, h: spec.h },
                symbol: 'symbol.svg',
                parameters: {},
                ports,
            };
        },

        async merge() {
            if (!this.selected) {
                window.alert('Выберите элемент палитры слева.');
                return;
            }
            if (!this.server) {
                window.alert('Прямая запись недоступна.\n\n' +
                    'Запустите сервер студии:\n  npm run studio\n' +
                    'и откройте http://127.0.0.1:5501/');
                return;
            }

            if (this.selected.actual && this.selected.actual.hasSymbol) {
                if (!window.confirm('У элемента «' + this.selected.id + '» уже есть symbol.svg.\nЗаменить его нарисованным SVG?')) {
                    return;
                }
            }

            const spec = this.outSize();
            const svg = A.export.buildSvg(spec.fit
                ? { fitW: spec.w, fitH: spec.h }
                : { scale: spec.scale });
            // Для существующего элемента пишем в его папку (dir), а не по manifest.id.
            const targetId = this.selected.actual
                ? (this.selected.actual.dir || this.selected.id)
                : this.selected.id;
            const body = { id: targetId, svg };
            if (!this.selected.actual) body.manifest = this.buildManifest(spec);

            try {
                const res = await fetch('/api/merge-symbol', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));

                // Обновляем состояние элемента без повторной загрузки всей палитры.
                const actual = this.selected.actual || {
                    id: this.selected.id,
                    name: this.selected.label,
                    category: this.selected.category,
                    size: { w: spec.w, h: spec.h },
                    hasIcon: false,
                    hasSymbol: false,
                };
                actual.hasSymbol = true;
                actual.size = actual.size || { w: spec.w, h: spec.h };
                this.selected.actual = actual;
                this.apiById.set(actual.id, actual);

                this.renderElements();
                this.renderTarget();
                A.setStatus('Слито: ' + (data.dirRel || data.dir) + '/symbol.svg');
                A.$('merge-hint').innerHTML =
                    'Последнее слияние: <code>' + escapeHtml(data.dirRel || data.dir) + '/symbol.svg</code>' +
                    ' · масштаб ' + Math.round(spec.scale * 100) + ' %';
            } catch (err) {
                window.alert('Не удалось слить SVG: ' + err.message);
            }
        },

        async mainTile(index) {
            try {
                if (!this.mainTiles) {
                    this.mainTiles = (async () => {
                        const img = await loadImage('/site-title/main_el.bmp');
                        return sliceTiles(img, 24);
                    })();
                }
                const tiles = await this.mainTiles;
                return tiles[index] || '';
            } catch (_) {
                return '';
            }
        },

        async elementIcon(item) {
            if (item.actual && item.actual.hasIcon) {
                return '/site-components/' + encodeURIComponent(item.actual.dir || item.id) + '/' +
                    encodeURIComponent(item.actual.icon || 'icon.png');
            }
            const key = item.category + ':' + item.tile;
            if (this.iconCache.has(key)) return this.iconCache.get(key);
            const promise = (async () => {
                if (item.tile == null) return '';
                try {
                    const img = await loadImage('/site-title/' + item.category + '.bmp');
                    const tiles = await sliceTiles(img, 24);
                    return tiles[item.tile] || '';
                } catch (_) {
                    return '';
                }
            })();
            this.iconCache.set(key, promise);
            return promise;
        },
    };

    /** Загрузка картинки (BMP отдаёт сервер студии). */
    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('не загрузилось: ' + src));
            img.src = src;
        });
    }

    /** Нарезка полосы на квадратные плитки и возврат data-URL каждой. */
    function sliceTiles(img, cut) {
        const cols = Math.floor(img.width / cut);
        const rows = Math.floor(img.height / cut);
        const tiles = [];
        for (let y = 0; y < rows; y++) {
            for (let x = 0; x < cols; x++) {
                const canvas = document.createElement('canvas');
                canvas.width = cut;
                canvas.height = cut;
                canvas.getContext('2d').drawImage(
                    img, x * cut, y * cut, cut, cut, 0, 0, cut, cut
                );
                tiles.push(canvas.toDataURL('image/png'));
            }
        }
        return tiles;
    }

    function escapeHtml(v) {
        return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    A.merge = merge;
})();
