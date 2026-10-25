// Загрузка/сохранение/новая схема — встраивание в кнопки EWR.html.
//
//   * open  — выбрать .ewb (или .txt) → декод → парсер → собрать сцену (с проводами,
//             нераспознанные элементы — плейсхолдеры);
//   * save — текущая сцена → нетлист → сериализация → .ewb (Type-1) → скачивание;
//   * new  — очистить холст.
//
// Зависит от ядра (/engine/*) и от реестра/проводов редактора. DOM-код защищён,
// чтобы ломать редактор при любых ошибках файла он не мог.

import { decode, encodeType1 } from '../../engine/ewb-codec.js';
import { toSpec } from '../../engine/parser.js';
import { serializeNetlist, groupTerminals } from '../../engine/ewb-text.js';
import { buildComponentNode, buildPlaceholderNode } from './registry.js';
import WireSystem from './wires.js';
import { assignNets, mapComponentType } from './sim.js';

// Какие движковые типы имеют «настоящий» символ в редакторе. Остальные — плейсхолдер.
const EDITOR_MAP = { resistor: 'resistor' };

function setStatus(text) {
    const st = document.getElementById('status');
    if (st) st.textContent = text;
}

function clearScene() {
    const main = document.getElementById('main-windows');
    if (!main) return;
    [...main.querySelectorAll('.component-svg')].forEach((n) => {
        WireSystem.removeNodeWires(n);
        n.remove();
    });
    if (typeof WireSystem.clear === 'function') WireSystem.clear();
}

// Разместить компоненты по сетке и соединить их проводами по узлам.
async function buildScene(spec) {
    const main = document.getElementById('main-windows');
    if (!main) return;
    clearScene();

    const comps = spec.components || [];
    const nets = [...groupTerminals(spec).entries()]; // [ [net, [{ci,ti}]], … ]
    const placed = [];
    const gx = 130, gy = 110, ox = 50, oy = 40;

    for (let i = 0; i < comps.length; i++) {
        const c = comps[i];
        const x = ox + (i % 5) * gx;
        const y = oy + Math.floor(i / 5) * gy;
        const editorId = EDITOR_MAP[c.type];
        let node = null;
        if (editorId) {
            try { node = await buildComponentNode(editorId, buildValues(c)); } catch (e) { node = null; }
        }
        if (!node) node = buildPlaceholderNode({ id: c.id, type: c.type, value: c.value != null ? c.value : c.dc, nodes: c.nodes });
        node.style.position = 'absolute';
        node.style.left = x + 'px';
        node.style.top = y + 'px';
        if (c.type) node.dataset.etype = c.type;
        const val = c.value != null ? c.value : c.dc;
        if (val != null) node.dataset.compvalue = String(val);
        main.appendChild(node);
        placed.push({ node, ports: [...node.querySelectorAll('.port')] });
    }

    // Соединяем терминалы одного узла «звездой» от первого терминала (keepExisting).
    for (const [, terms] of nets) {
        if (terms.length < 2) continue;
        const a = placed[terms[0].ci];
        const pa = a && a.ports[terms[0].ti];
        for (let k = 1; k < terms.length; k++) {
            const bk = placed[terms[k].ci];
            const pk = bk && bk.ports[terms[k].ti];
            if (a && pa && bk && pk) WireSystem.connect(a.node, pa, bk.node, pk, true);
        }
    }
}

// Значения data-slot для известного символа (напр., сопротивление резистора).
function buildValues(c) {
    if (c.type === 'resistor') return { resistanse: c.value != null ? c.value : 10 };
    return {};
}

function onOpenFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        try {
            const bytes = new Uint8Array(reader.result);
            let spec = null;
            if (/\.txt$/i.test(file.name)) {
                const text = new TextDecoder('latin1').decode(bytes);
                spec = toSpec(text).spec;
            } else {
                const text = decode(bytes);
                spec = toSpec(text).spec;
            }
            if (!spec) { setStatus('Не удалось разобрать цепь: ' + file.name); return; }
            buildScene(spec)
                .then(() => setStatus(`Открыто «${file.name}»: ${spec.components.length} элем.`))
                .catch((e) => setStatus('Ошибка сборки сцены: ' + e.message));
        } catch (e) {
            setStatus('Ошибка открытия: ' + e.message);
        }
    };
    reader.onerror = () => setStatus('Не удалось прочитать файл');
    reader.readAsArrayBuffer(file);
}

function downloadBytes(bytes, filename) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function onSave() {
    let sc;
    try { sc = WireSystem.scene(); } catch (e) { setStatus('Сохранение недоступно: ' + e.message); return; }
    const components = sc.components.map((c) => ({
        id: c.editorId || c.inst,
        engineType: c.etype || mapComponentType(c.editorId) || null,
        value: c.value != null && c.value !== '' ? parseFloat(c.value) : undefined,
        terminals: c.ports.map((p) => `${c.inst}:${p}`),
    })).filter((c) => c.engineType); // только распознанные типы
    const { spec } = assignNets(components, sc.links);
    if (!spec || !spec.components.length) { setStatus('Нечего сохранять (нет распознанных элементов/земли)'); return; }
    const text = serializeNetlist(spec);
    const bytes = encodeType1(text);
    downloadBytes(bytes, 'circuit.ewb');
    setStatus(`Сохранено circuit.ewb: ${spec.components.length} элем.`);
}

function boot() {
    // Файловый инпут создаём лениво (не зависит от тайминга плиток меню).
    let input = null;
    const ensureInput = () => {
        if (!input) {
            input = document.createElement('input');
            input.type = 'file';
            input.accept = '.ewb,.EWB,.txt';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.addEventListener('change', () => {
                if (input.files && input.files[0]) onOpenFile(input.files[0]);
                input.value = '';
            });
        }
        return input;
    };

    // Плитки меню (new/open/save/...) создаются АСИНХРОННО в splitImage (после
    // загрузки картинки), поэтому цепляемся через делегирование на документе —
    // это работает независимо от того, когда плитки появятся в DOM.
    document.addEventListener('click', (e) => {
        const id = e.target && e.target.id;
        if (id === 'open') { e.preventDefault(); ensureInput().click(); }
        else if (id === 'save') { e.preventDefault(); onSave(); }
        else if (id === 'new') { e.preventDefault(); clearScene(); setStatus('Новая схема'); }
    });
}

if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}

export default { onOpenFile, onSave, clearScene, buildScene };
