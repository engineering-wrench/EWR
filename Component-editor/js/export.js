window.App = window.App || {};
(function () {
    const A = window.App;

    const exp = {
        dirHandle: null,
        apiInfo: null,

        init() {
            A.$('btn-add-slot').addEventListener('click', () => this.addSlotRow('', '', '', ''));
            A.$('btn-collect-slots').addEventListener('click', () => this.collectSlots());
            A.$('btn-save-project').addEventListener('click', () => this.exportToProject());
            A.$('btn-export').addEventListener('click', () => this.exportToFolder());
            A.$('btn-export-download').addEventListener('click', () => this.exportDownload());
            A.$('exp-description').addEventListener('input', e => {
                A.state.meta.description = e.target.value;
            });
            this.detectServer();
        },

        refresh() {
            this.collectSlots();
            this.renderPortSummary();
            this.syncSource();
        },

        syncSource() {
            const meta = A.state.meta;
            const src = A.$('exp-source');
            if (!src) return;
            src.textContent = meta.elementId
                ? 'Источник: ' + meta.elementId + ' · ' + (meta.source || '')
                : 'Элемент не выбран — рисуйте с нуля или откройте «Библиотеку элементов».';
            if (meta.description) A.$('exp-description').value = meta.description;
            A.$('exp-folder-hint').textContent = this.dirHandle
                ? 'Папка назначения выбрана. Экспорт создаст подпапку <id>/ в ней.'
                : 'Папка не выбрана. При экспорте браузер спросит папку, рядом с проектом появится подпапка <id>/.';
        },

        collectSlots() {
            const slots = new Set();
            A.refs.shapes.querySelectorAll('[data-slot]').forEach(el => {
                const s = (el.getAttribute('data-slot') || '').trim();
                if (s) slots.add(s);
            });
            const existing = Array.from(document.querySelectorAll('.exp-slot-row .es-slot-inp')).map(i => i.value.trim());
            slots.forEach(s => {
                const el = A.refs.shapes.querySelector('[data-slot="' + cssEscape(s) + '"]');
                const def = el ? (el.getAttribute('data-default') || el.textContent || '') : '';
                if (!existing.includes(s)) this.addSlotRow(s, 'Значение', '', def);
            });
            if (slots.size === 0 && document.querySelectorAll('.exp-slot-row').length === 0) {
                this.addSlotRow('', '', '', '');
            }
            this.renderPortSummary();
        },

        addSlotRow(slot, label, unit, def) {
            const wrap = document.createElement('div');
            wrap.className = 'exp-slot-row';
            wrap.innerHTML = `
                <div class="es-head">
                    <span class="es-slot">data-slot = '<input class="es-slot-inp" value="${escapeAttr(slot)}" placeholder="value">'</span>
                    <button type="button" class="pr-del">✕</button>
                </div>
                <input class="es-label-inp" value="${escapeAttr(label)}" placeholder="Название параметра (напр. Значение)">
                <input class="es-unit-inp" value="${escapeAttr(unit)}" placeholder="Единица (напр. Ом)">
                <input class="es-def-inp" value="${escapeAttr(def)}" placeholder="Значение по умолчанию">
            `;
            wrap.querySelector('.pr-del').onclick = () => wrap.remove();
            document.getElementById('exp-slots').appendChild(wrap);
            this.renderPortSummary();
        },

        renderPortSummary() {
            const box = document.getElementById('exp-port-summary');
            const ports = A.state.ports;
            if (!ports.length) {
                box.textContent = 'Портов нет — добавьте инструментом «Порт».';
                return;
            }
            const dirText = { left: '←', right: '→', up: '↑', down: '↓' };
            const crop = A.state.crop;
            const missing = ports.filter(p => !dirText[p.dir]);
            const warn = missing.length
                ? `<div style="color:#e66">⚠ У ${missing.length} порта(ов) не задано направление выхода: ${missing.map(p => p.id).join(', ')}</div>`
                : '';
            box.innerHTML = warn + ports.map(p =>
                `<div>${escapeHtml(p.id)} → (${p.x - crop.x | 0}, ${p.y - crop.y | 0}) [${p.role}] ${dirText[p.dir] || '· auto'}</div>`).join('');
        },

        /**
         * Собирает SVG из холста.
         * opts.scale — масштаб в долях (1 = 100%);
         * opts.fitW/opts.fitH — вписать в заданный размер с центрированием.
         */
        buildSvg(opts = {}) {
            const crop = A.state.crop;
            const parts = [];
            A.refs.shapes.querySelectorAll(':scope > *').forEach(el => {
                const clone = el.cloneNode(true);
                clone.removeAttribute('data-tool');
                parts.push(clone.outerHTML);
            });
            const name = document.getElementById('exp-name').value.trim();
            const desc = document.getElementById('exp-description').value.trim();
            const meta = (name ? `<title>${escapeHtml(name)}</title>` : '') +
                (desc ? `<desc>${escapeHtml(desc)}</desc>` : '');

            let scale = Number(opts.scale) > 0 ? Number(opts.scale) : 1;
            let outW = crop.w * scale;
            let outH = crop.h * scale;
            let dx = 0;
            let dy = 0;
            if (opts.fitW > 0 && opts.fitH > 0) {
                scale = Math.min(opts.fitW / crop.w, opts.fitH / crop.h);
                outW = opts.fitW;
                outH = opts.fitH;
                dx = (outW - crop.w * scale) / 2;
                dy = (outH - crop.h * scale) / 2;
            }
            outW = Math.max(1, Math.round(outW));
            outH = Math.max(1, Math.round(outH));
            const transform = `translate(${round(dx - crop.x * scale)} ${round(dy - crop.y * scale)}) scale(${round(scale)})`;

            return `<svg xmlns="http://www.w3.org/2000/svg" width="${outW}" height="${outH}" viewBox="0 0 ${outW} ${outH}">` +
                meta + `<g transform="${transform}">` + parts.join('') + '</g></svg>';
        },

        buildManifest() {
            const crop = A.state.crop;
            const parameters = {};
            document.querySelectorAll('.exp-slot-row').forEach(row => {
                const slot = row.querySelector('.es-slot-inp').value.trim();
                if (!slot) return;
                parameters[slot] = {
                    label: row.querySelector('.es-label-inp').value.trim() || 'Значение',
                    unit: row.querySelector('.es-unit-inp').value.trim(),
                    slot,
                    default: row.querySelector('.es-def-inp').value
                };
            });
            const ports = A.state.ports.map(p => ({
                id: p.id,
                label: p.label,
                role: p.role,
                dir: p.dir || 'auto',
                x: Math.round(p.x - crop.x),
                y: Math.round(p.y - crop.y)
            }));

            return {
                id: document.getElementById('exp-id').value.trim() || 'component',
                name: document.getElementById('exp-name').value.trim() || 'Компонент',
                category: document.getElementById('exp-category').value.trim() || 'component',
                description: document.getElementById('exp-description').value.trim(),
                source: A.state.meta.elementId || '',
                size: { w: Math.round(crop.w), h: Math.round(crop.h) },
                icon: 'icon.png',
                symbol: 'symbol.svg',
                parameters,
                ports
            };
        },

        validate() {
            const id = document.getElementById('exp-id').value.trim() || 'component';
            if (!A.state.ports.length) {
                if (!window.confirm('У компонента нет точек подключения. Экспортировать всё равно?')) return null;
            }
            const dirSet = new Set(['left', 'right', 'up', 'down']);
            const missing = A.state.ports.filter(p => !dirSet.has(p.dir));
            if (missing.length) {
                window.alert('Направление выхода обязательно для каждого порта.\n' +
                    'Не задано: ' + missing.map(p => p.id + ' (' + p.dir + ')').join(', ') +
                    '.\n\nВыберите направление стрелкой во вкладке «Порты».');
                return null;
            }
            return id;
        },

        /** Файлы компонента в переносимом виде: для папки, скачивания и POST. */
        async collectFiles(manifest, svg) {
            const files = [
                { name: 'symbol.svg', encoding: 'utf8', data: svg },
                { name: 'manifest.json', encoding: 'utf8', data: JSON.stringify(manifest, null, 4) },
                { name: 'description.txt', encoding: 'utf8', data: descriptionText(manifest) },
            ];

            // Иконка элемента (PNG): рендер текущего SVG, иначе — исходный PNG.
            // У открытого готового компонента иконку не перезаписываем.
            const elMeta = A.state.meta;
            const el = elMeta.elementId && A.gallery && A.gallery.byId
                ? A.gallery.byId.get(elMeta.elementId) : null;
            let iconBlob = null;
            if (!elMeta.preserveIcon) {
                try {
                    iconBlob = await rasterizeSvg(svg, manifest.size.w, manifest.size.h);
                } catch (_) { /* отрисуем из исходника ниже */ }
                if (!iconBlob && el) {
                    try {
                        const res = await fetch('elements/' + (el.icon || el.file));
                        if (res.ok) iconBlob = await res.blob();
                    } catch (_) { /* иконка не критична */ }
                }
                if (iconBlob) {
                    files.push({ name: 'icon.png', encoding: 'base64', data: await blobToBase64(iconBlob) });
                }
            }

            // Исходная картинка элемента (если выбрана в библиотеке).
            if (el) {
                try {
                    const res = await fetch('elements/' + (el.icon || el.file));
                    if (res.ok) {
                        files.push({ name: 'source.png', encoding: 'base64', data: await blobToBase64(await res.blob()) });
                    }
                } catch (_) { /* картинка не критична */ }
            }
            // Фото пользователя.
            if (elMeta.photo && elMeta.photo.dataUrl) {
                const blob = await (await fetch(elMeta.photo.dataUrl)).blob();
                const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg');
                files.push({ name: 'reference.' + ext, encoding: 'base64', data: await blobToBase64(blob) });
            }
            return files;
        },

        // Прямая запись в папку проекта (Component-editor/components/<id>/).
        // Требует запущенного `npm run studio` (tools/serve.mjs).
        async exportToProject() {
            const id = this.validate();
            if (!id) return;
            if (!this.apiInfo) await this.detectServer();
            if (!this.apiInfo) {
                window.alert('Прямая запись недоступна.\n\n' +
                    'Запустите сервер проекта:\n  npm run studio\n' +
                    'и откройте http://127.0.0.1:5501/\n\n' +
                    'Или используйте «Экспорт в выбранную папку…».');
                return;
            }

            try {
                const svg = this.buildSvg();
                const manifest = this.buildManifest();
                const files = await this.collectFiles(manifest, svg);
                const meta = A.state.meta || {};
                // Отредактированный компонент сохраняем обратно в исходную папку.
                const body = {
                    id: meta.originDir || id,
                    files,
                };
                if (meta.originRoot) body.root = meta.originRoot;
                const res = await fetch('/api/save-component', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok || !data.ok) throw new Error(data.error || ('HTTP ' + res.status));
                this.syncSource();
                A.setStatus('Сохранено в проект: ' + (data.dirRel || data.dir));
                A.$('exp-project-hint').innerHTML =
                    'Последнее сохранение: <code>' + escapeHtml(data.dirRel || data.dir) + '</code>';
            } catch (err) {
                window.alert('Не удалось сохранить в проект: ' + err.message);
            }
        },

        // Экспорт в выбранную папку: <выбранная>/<id>/symbol.svg + icon.png + …
        async exportToFolder() {
            const id = this.validate();
            if (!id) return;

            if (!window.showDirectoryPicker) {
                window.alert('Браузер не поддерживает выбор папки (File System Access API).\n' +
                    'Используйте «Скачать symbol.svg + icon.png + manifest.json» или Chrome/Edge.');
                return;
            }

            try {
                if (!this.dirHandle) {
                    this.dirHandle = await window.showDirectoryPicker({ id: 'ewr-components', mode: 'readwrite' });
                }
                const root = this.dirHandle;
                const dir = await root.getDirectoryHandle(safeName(id), { create: true });

                const svg = this.buildSvg();
                const manifest = this.buildManifest();
                const files = await this.collectFiles(manifest, svg);
                for (const f of files) {
                    if (f.encoding === 'base64') {
                        await writeBlob(dir, f.name, base64ToBlob(f.data, mimeForName(f.name)));
                    } else {
                        await writeText(dir, f.name, f.data, mimeForName(f.name));
                    }
                }

                this.syncSource();
                A.setStatus('Экспортировано в папку: ' + safeName(id) + '/');
            } catch (err) {
                if (err && err.name === 'AbortError') return;
                window.alert('Не удалось сохранить в папку: ' + err.message);
            }
        },

        // Запасной вариант: отдельные скачивания (symbol.svg + icon.png + manifest.json).
        async exportDownload() {
            const id = this.validate();
            if (!id) return;
            const svg = this.buildSvg();
            const manifest = this.buildManifest();
            const files = await this.collectFiles(manifest, svg);
            for (const f of files) {
                if (f.encoding === 'base64') {
                    download(`${safeName(id)}/${f.name}`, base64ToBlob(f.data, mimeForName(f.name)), mimeForName(f.name));
                } else {
                    download(`${safeName(id)}/${f.name}`, f.data, mimeForName(f.name));
                }
            }
            A.setStatus('Скачано: ' + safeName(id) + '/');
        }
    };

    /** Проверка локального сервера проекта (tools/serve.mjs). */
    exp.detectServer = async function () {
        try {
            const res = await fetch('/api/info', { cache: 'no-store' });
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const info = await res.json();
            this.apiInfo = info;
            const hint = A.$('exp-project-hint');
            if (hint) {
                hint.innerHTML = 'Прямая запись в <code>' + escapeHtml(info.outDirRel || info.outDir) +
                    '/&lt;id&gt;/</code>.';
            }
        } catch (_) {
            this.apiInfo = null;
            const hint = A.$('exp-project-hint');
            if (hint) {
                hint.innerHTML = 'Прямая запись недоступна: запустите <code>npm run studio</code> ' +
                    'и откройте <code>http://127.0.0.1:5501/</code>.';
            }
        }
        return this.apiInfo;
    };

    function descriptionText(manifest) {
        const line = manifest.name + '\n' + '='.repeat(Math.max(1, manifest.name.length)) + '\n\n';
        return line + (manifest.description || '(описание не задано)') + '\n\n' +
            'Источник: ' + (manifest.source || 'нарисовано вручную') + '\n';
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = () => reject(r.error || new Error('FileReader'));
            r.readAsDataURL(blob);
        });
    }

    function base64ToBlob(b64, mime) {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        return new Blob([bytes], { type: mime || 'application/octet-stream' });
    }

    function mimeForName(name) {
        const ext = String(name).split('.').pop().toLowerCase();
        return {
            svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            json: 'application/json', txt: 'text/plain', md: 'text/markdown',
        }[ext] || 'application/octet-stream';
    }

    async function writeText(dir, name, text, mime) {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(new Blob([text], { type: mime }));
        await w.close();
    }

    async function writeBlob(dir, name, blob) {
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(blob);
        await w.close();
    }

    /** Рендер SVG в PNG-иконку (не больше maxSide px по длинной стороне). */
    async function rasterizeSvg(svgText, w, h, maxSide = 256) {
        const scale = Math.min(1, maxSide / Math.max(w, h));
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const url = URL.createObjectURL(new Blob([svgText], { type: 'image/svg+xml' }));
        try {
            const img = await new Promise((resolve, reject) => {
                const i = new Image();
                i.onload = () => resolve(i);
                i.onerror = () => reject(new Error('SVG не загрузился'));
                i.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = cw;
            canvas.height = ch;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);
            return await new Promise((resolve, reject) => {
                canvas.toBlob(b => b ? resolve(b) : reject(new Error('canvas.toBlob вернул null')), 'image/png');
            });
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    function safeName(name) {
        return String(name).replace(/[\\/:*?"<>|]/g, '-').replace(/^\.+$/, '_') || 'component';
    }

    function cssEscape(v) {
        return String(v).replace(/["\\]/g, '\\$&');
    }

    /** Короткая запись числа в SVG (без «плавающего хвоста»). */
    function round(v) {
        return Math.round(Number(v) * 10000) / 10000;
    }

    function escapeAttr(v) {
        return String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
    }

    function escapeHtml(v) {
        return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function download(name, content, mime) {
        const blob = new Blob([content], { type: mime });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }

    A.export = exp;
})();
