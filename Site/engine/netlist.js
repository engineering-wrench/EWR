// Модель схемы и построение нетлиста для движка EWR.
//
// Вход (spec) — JSON, независимый от UI:
//   {
//     components: [
//       { id:"R1", type:"resistor", value:1000, nodes:["n1","n2"] },
//       { id:"V1", type:"vsource", dc:10, nodes:["n1","gnd"] },     // "+" на n1
//       { id:"C1", type:"capacitor", value:1e-6, ic:0, nodes:["n2","gnd"] },
//       { id:"L1", type:"inductor", value:1e-3, ic:0, nodes:["a","gnd"] },
//       { id:"D1", type:"diode", is:1e-14, n:1, nodes:["a","c"] },   // анод a, катод c
//       { id:"I1", type:"isource", dc:1e-3, nodes:["gnd","n"] }      // ток p->n, выдаётся в n
//     ]
//   }
// Земля: любое имя из GROUND_NAMES. Узлы нумеруются от 0. Для источников
// напряжения и индуктивностей выделяется доп. неизвестное «ток ветви».

export const GROUND_NAMES = ['gnd', '0', 'ground', 'com', 'vss'];
export const VT = 0.025852; // термический потенциал kT/q при 300 К

export function isGround(name) {
    return GROUND_NAMES.includes(String(name).trim().toLowerCase());
}

export function num(v, def = 0) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : def;
}

// true — для компонентов, которым нужен ток ветви как неизвестное MNA.
export function needsBranchCurrent(type) {
    return type === 'vsource' || type === 'inductor';
}

export function buildNetlist(spec) {
    if (!spec || !Array.isArray(spec.components)) {
        throw new Error('netlist: spec.components должен быть массивом');
    }
    // 1) собрать немассив имён узлов (земля исключается), отсортировать для
    //    детерминированной нумерации между запусками/тестами.
    const names = new Set();
    for (const c of spec.components) {
        if (!Array.isArray(c.nodes) || c.nodes.length < 1) {
            throw new Error(`netlist: у ${c.id || c.type} отсутствуют nodes`);
        }
        for (const nm of c.nodes) if (!isGround(nm)) names.add(nm);
    }
    const nodeList = [...names].sort();
    const nodeIndex = new Map(nodeList.map((nm, i) => [nm, i]));
    const N = nodeList.length;
    const idx = (nm) => (isGround(nm) ? -1 : nodeIndex.get(nm));

    // 2) устройства + распределение доп. токов (vsource, inductor).
    let extra = 0;
    const devices = spec.components.map((c) => {
        const d = {
            id: c.id || '?',
            type: c.type,
            nodes: c.nodes.map(idx),
            params: { ...c },
            _v: 0, // текущее напряжение на элементе (для линеаризации диода)
        };
        if (needsBranchCurrent(c.type)) d.extra = extra++;
        if (c.type === 'capacitor') d._prev = { v: num(c.ic), i: 0 };
        else if (c.type === 'inductor') d._prev = { v: 0, i: num(c.ic) };
        else d._prev = { v: 0, i: 0 };
        return d;
    });

    const M = extra;
    return { nodeList, nodeIndex, N, M, size: N + M, devices };
}

// --- чтение решения ------------------------------------------------------

// Напряжение узла k из вектора решения (k = -1 => земля => 0).
export function nodeVoltage(x, k) { return k < 0 ? 0 : x[k]; }

// Напряжение на элементе (nodes[0] - nodes[1]).
export function deviceVoltage(x, d) {
    return nodeVoltage(x, d.nodes[0]) - nodeVoltage(x, d.nodes[1]);
}

// Ток ветви для vsource/inductor (доп. неизвестное). Направление p->n.
export function branchCurrent(nl, x, d) {
    return x[nl.N + d.extra];
}

// Напряжение на элементе из индексов нетлиста (без передачи x — для вызова с d._v).
export function deviceV(d) { return d._v; }

// --- источники: мгновенные значения ------------------------------------

// Значение независимого источника (DC*.scale для DC-операционной точки).
export function sourceValue(d, mode, t, scale) {
    const p = d.params;
    if (mode === 'dc') return dcLevel(p) * (scale != null ? scale : 1);
    if (p.pwl) return pwlAt(p.pwl, t);
    if (p.pulse) return pulseAt(p.pulse, t);
    return dcLevel(p);
}

function dcLevel(p) {
    return num(p.dc != null ? p.dc : p.value);
}

// Кусочно-линейный источник: pwl = [[t, v], ...].
export function pwlAt(points, t) {
    if (!Array.isArray(points) || !points.length) return 0;
    if (t <= points[0][0]) return num(points[0][1]);
    for (let i = 1; i < points.length; i++) {
        const [t0, v0] = points[i - 1];
        const [t1, v1] = points[i];
        if (t <= t1) {
            if (t1 === t0) return num(v1);
            const a = (t - t0) / (t1 - t0);
            return num(v0) + a * (num(v1) - num(v0));
        }
    }
    return num(points[points.length - 1][1]);
}

// Прямоугольный источник: { v1, v2, delay, width, period, rise, fall }.
export function pulseAt(s, t) {
    const per = num(s.period);
    const delay = num(s.delay);
    const width = num(s.width, per / 2);
    const rise = num(s.rise, 0), fall = num(s.fall, 0);
    const v1 = num(s.v1), v2 = num(s.v2);
    if (!per || t < delay) return t < delay ? v1 : v1;
    const tt = (t - delay) % per;
    const on = tt < width ? v2 : v1;
    // Простейшие фронты (линейные), если заданы rise/fall.
    if (rise > 0 && tt < rise) return v1 + (v2 - v1) * (tt / rise);
    if (fall > 0 && tt >= width && tt < width + fall) return v2 + (v1 - v2) * ((tt - width) / fall);
    return on;
}

// Мгновенное значение для источника в анализе (vsource/isource).
export function instantSource(d, mode, t, scale) {
    return sourceValue(d, mode, t, scale);
}
