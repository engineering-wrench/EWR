// Парсер формата EWB: декодированный текст -> нетлист (spec для движка).
//
// Вход: ТЕКСТОВАЯ сериализация EWB (выход tools/ewb2txt.mjs). Не занимается
// бинарным декодированием — только разбором уже декодированного текста.
//
//   import { toSpec } from '/engine/parser.js';
//   const { spec, warnings, stats } = toSpec(decodedText);
//   const res = simulate(spec, { analysis: 'op' });
//
// Модель (по данным RE, проверено на CIRCUITS/*):
//   * Circuit.Elements[]        — ВСЕ элементы в порядке файла (Comp, Instrument,
//                                 ExtComp, MacroIcon); индекс провода = позиция в этом
//                                 списке (проверено: 2-выводные Comp дают ровно терминалы 0/1);
//   * Circuit.Wires.wire[]      — соединения: pos:i4 = [elemA,pinA,elemB,pinB],
//                                 node_p = номер электр. узла;
//   * элемент тип — по префиксу RefID (R,C,L,V,I,D,CONN,M,0/T) и PartNum;
//   * земля (RefID "0"/PartNum 8) помечает ВСЕ свои узлы как землю;
//   * CONN — узел-соединитель (все терминалы = один узел);
//   * M (мультиметр/амперметр) с 2 терминалами — связь 0 Ом (иначе R/V-топология
//     «висит»), с 1 терминалом — пробник (игнор);
//   * трансформаторы T и прочее неподдержанное — пропускаются (warnings).
//
// Компоненты-«призраки» (список элементов без подключения по проводам) не
// попадают в нетлист, т.к. не участвуют в соединениях.

// --- Токенайзер ----------------------------------------------------------
// Токены: слово, строка "..." (с escape \" ), '{', '}'.
function tokenize(text) {
    const t = [];
    let i = 0;
    const n = text.length;
    while (i < n) {
        const c = text[i];
        if (c === '{' || c === '}') { t.push({ k: c }); i++; continue; }
        if (c === '"') {
            let j = i + 1;
            let s = '';
            while (j < n) {
                if (text[j] === '\\' && j + 1 < n) { s += text[j + 1]; j += 2; continue; }
                if (text[j] === '"') break;
                s += text[j++];
            }
            t.push({ k: 's', v: s });
            i = j + 1;
            continue;
        }
        if (c === ' ' || c === '\r' || c === '\n' || c === '\t') { i++; continue; }
        let j = i;
        let w = '';
        while (j < n && !' \r\n\t{}"'.includes(text[j])) w += text[j++];
        if (w) { t.push({ k: 'w', v: w }); i = j; } else i++;
    }
    return t;
}

// --- Дерево --------------------------------------------------------------
// Блок: { name, children:[...] }; лист: { name, type, value }.
export function parseEwbText(text) {
    const tokens = tokenize(text);
    let p = 0;
    const peek = () => tokens[p];
    const next = () => tokens[p++];

    function parseValue(marker) {
        const colon = marker.indexOf(':');
        let count = 1;
        let body = marker;
        if (colon >= 0) { count = +marker.slice(colon + 1); body = marker.slice(0, colon); }
        if (body === 'R' || body === 'A') { const s = next(); return { type: body, value: s ? s.v : '' }; }
        const arr = [];
        for (let k = 0; k < count && p < tokens.length; k++) arr.push(Number(next().v));
        return { type: body === 'i' ? 'i' : 'r', value: count === 1 ? arr[0] : arr };
    }

    function parseNodes() {
        const out = [];
        for (;;) {
            const tk = peek();
            if (!tk) break;
            if (tk.k === '}') { next(); break; }
            if (tk.k === 's') { next(); continue; } // «мусорные» строки-артефакты
            const name = next().v;
            const nt = peek();
            if (nt && nt.k === '{') { next(); out.push({ name, children: parseNodes() }); }
            else if (nt && nt.k === 'w') { const marker = next().v; out.push({ name, ...parseValue(marker) }); }
            else out.push({ name, type: 'x', value: null });
        }
        return out;
    }

    const rootName = next().v;
    if (peek() && peek().k === '{') next();
    return { name: rootName, children: parseNodes() };
}

// --- Помощники поиска по дереву ---
const kids = (blk, name) => (blk && blk.children ? blk.children : []).filter((c) => c.name === name);
const first = (blk, name) => (blk && blk.children ? blk.children : []).find((c) => c.name === name);
const findBlock = (blk, name) => { const c = kids(blk, name); return c.length ? c[0] : null; };

// --- Определение типа устройства по RefID/PartNum ---
export function deviceType(ref, partnum) {
    const r = String(ref == null ? '' : ref).trim();
    const m = r.match(/^([A-Za-z]+)/);
    const pre = m ? m[1].toLowerCase() : '';
    if (r === '0' || pre === 'gnd' || pre === 'ground' || +partnum === 8) return 'ground';
    if (pre === 'r') return 'resistor';
    if (pre === 'c') return 'capacitor';
    if (pre === 'l') return 'inductor';
    if (pre === 'v') return 'vsource';
    if (pre === 'i') return 'isource';
    if (pre === 'd' || pre === 'led' || pre === 'zener') return 'diode';
    if (pre === 'conn') return 'connector';
    if (pre === 'm') return 'meter';
    if (pre === 't') return 'transformer';
    if (+partnum === 1) return 'resistor';
    if (+partnum === 2 || +partnum === 0) return 'vsource';
    if (+partnum === 9) return 'connector';
    if (+partnum === 12 || +partnum === 13) return 'meter';
    if (+partnum === 14) return 'transformer';
    return 'unknown';
}

// union-find по именам узлов (node_p — строки)
function makeUnionFind() {
    const parent = new Map();
    const find = (k) => {
        if (!parent.has(k)) parent.set(k, k);
        let r = k;
        while (parent.get(r) !== r) { parent.set(r, parent.get(parent.get(r))); r = parent.get(r); }
        return r;
    };
    return { find, union: (a, b) => parent.set(find(a), find(b)) };
}

// --- Главное: дерево -> нетлист для движка ---
export function extractNetlist(tree) {
    const warnings = [];
    const circuit = findBlock(tree, 'Circuit');
    if (!circuit) return { spec: null, warnings: ['нет блока Circuit'], stats: {} };
    const elements = findBlock(circuit, 'Elements');
    const wiresBlk = findBlock(circuit, 'Wires');
    const elems = elements ? elements.children.filter((c) => c.children) : []; // индекс провода = позиция в этом списке
    const comps = elems.filter((c) => c.name === 'Comp');
    const wires = wiresBlk ? kids(wiresBlk, 'wire') : [];

    // 1) терминал -> узел : "idx:term" -> node_p
    const term2net = new Map();
    const compTerms = new Map(); // idx -> [{t, net}]
    for (const w of wires) {
        const pos = first(w, 'pos');
        const nodep = first(w, 'node_p');
        if (!pos || !Array.isArray(pos.value) || !nodep) continue;
        const [iA, tA, iB, tB] = pos.value;
        const keyed = (net, i, t) => {
            term2net.set(`${i}:${t}`, net);
            if (!compTerms.has(i)) compTerms.set(i, []);
            compTerms.get(i).push({ t, net });
        };
        keyed(String(nodep.value), iA, tA);
        keyed(String(nodep.value), iB, tB);
    }

    // цвет устройства для каждого индекса (индекс = позиция в Circuit.Elements)
    const typeOfIdx = (idx) => {
        const c = elems[idx];
        if (!c) return 'unknown';
        if (c.name !== 'Comp') return c.name.toLowerCase(); // instrument/extcomp/macroicon
        const refid = findBlock(findBlock(c, 'Common') || { children: [] }, 'RefID');
        const pn = first(c, 'PartNum');
        return deviceType(refid ? refid.value : '', pn ? pn.value : null);
    };

    // 2) union-find по узлам. Мультиметры/амперметры (2+ терминала) — связь 0 Ом,
    //    иначе R/V-топология «висит». Соединители CONN — лишь маркеры узлов
    //    (node_p уже определил сеть), поэтому НЕ объединяем.
    const uf = makeUnionFind();
    for (const [idx, terms] of compTerms) {
        if (typeOfIdx(idx) !== 'meter') continue;
        const nets = [...new Set(terms.map((x) => x.net))];
        for (let k = 1; k < nets.length; k++) uf.union(nets[0], nets[k]);
    }

    // 3) корни земли: все узлы, коснувшиеся символов земли
    const groundRoots = new Set();
    for (const [idx, terms] of compTerms) {
        if (typeOfIdx(idx) === 'ground') for (const x of terms) groundRoots.add(uf.find(x.net));
    }

    // 4) формирование имён узлов
    const nameOf = (net) => {
        const root = uf.find(net);
        if (groundRoots.has(root)) return 'gnd';
        return 'n' + root;
    };

    // 5) устройства движка
    const TWO = new Set(['resistor', 'capacitor', 'inductor', 'vsource', 'isource', 'diode']);
    const components = [];
    const stats = { comps: comps.length, elements: elems.length, wired: compTerms.size, wires: wires.length, emitted: 0, skipped: {} };
    for (const [idx, terms] of compTerms) {
        const type = typeOfIdx(idx);
        if (!TWO.has(type)) {
            if (type === 'connector' || type === 'meter' || type === 'ground') { /* обработано */ }
            else { stats.skipped[type] = (stats.skipped[type] || 0) + 1; }
            continue;
        }
        // уникальные узлы в порядке роста индекса терминала
        const sorted = [...terms].sort((a, b) => a.t - b.t);
        const distinct = [];
        for (const x of sorted) { const nm = nameOf(x.net); if (!distinct.includes(nm)) distinct.push(nm); }
        const c = elems[idx];
        const refid = findBlock(findBlock(c, 'Common') || { children: [] }, 'RefID');
        const id = refid ? String(refid.value) : 'E' + idx;
        if (distinct.length < 2) { warnings.push(`${id} (${type}): ${distinct.length} разг. узел(ов) — пропущен`); continue; }
        if (distinct.length > 2) warnings.push(`${id} (${type}): ${distinct.length} выводов — используем первые два`);

        const nodes = [distinct[0], distinct[1]];
        const val = first(c, 'Value');
        const primary = val ? (Array.isArray(val.value) ? val.value[0] : val.value) : null;
        const comp = { id, type, nodes };
        if (type === 'diode') { comp.is = 1e-14; comp.n = 1; }
        else if (type === 'vsource' || type === 'isource') comp.dc = primary != null ? primary : 0;
        else comp.value = primary != null ? primary : 0;
        components.push(comp);
        stats.emitted++;
    }

    // земля по умолчанию, если символa земли не было (минус первого источника)
    if (groundRoots.size === 0 && !components.some((c) => c.nodes.includes('gnd'))) {
        const vs = components.find((c) => c.type === 'vsource');
        if (vs) {
            // переименовать второй узел источника в gnd: потребовало бы перестройку имён;
            // проще добавить ворнинг — решатель сам сообщит о «висящей» цепи.
            warnings.push('не найден символ земли — добавьте ground или проверьте схему');
        } else {
            warnings.push('нет источников и земли — нечего симулировать');
        }
    }

    return { spec: components.length ? { components } : null, warnings, stats };
}

// Удобная обёртка: декодированный текст сразу в spec.
export function toSpec(text) {
    return extractNetlist(parseEwbText(text));
}

export default { parseEwbText, extractNetlist, toSpec, deviceType };
