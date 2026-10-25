// Сериализатор: spec движка -> текст EWB (минимальный, но валидный для нашего
// парсера parser.js). Нужен для СОХРАНЕНИЯ сцены в .ewb (через ewb-codec.encodeType1).
// Корректность цикла save/load проверяется в test/ewb-codec.test.mjs.
//
// Итоговый конвейер сохранения:
//   spec -> serializeNetlist(spec) -> encodeType1(text) -> скачивание .ewb
// Обратный: decode(bytes) -> toSpec(text) -> spec'.

import { GROUND_NAMES } from './netlist.js';

const PART = { resistor: 1, vsource: 2, capacitor: 3, inductor: 4, diode: 5, isource: 6, ground: 8 };
const isGroundName = (n) => GROUND_NAMES.includes(String(n).trim().toLowerCase());

// Группировка терминалов по узлам: Map(netName -> [{ci, ti}]).
// Чистая функция — используется и здесь (сериализация), и в file-io (сборка сцены).
export function groupTerminals(spec) {
    const byNet = new Map();
    (spec.components || []).forEach((c, ci) => c.nodes.forEach((n, ti) => {
        if (!byNet.has(n)) byNet.set(n, []);
        byNet.get(n).push({ ci, ti });
    }));
    return byNet;
}

export function serializeNetlist(spec) {
    const src = (spec && spec.components) || [];
    const hasGround = src.some((c) => c.nodes.some(isGroundName));
    const elems = src.map((c) => ({ id: c.id, type: c.type, nodes: c.nodes.slice(), value: c.value, dc: c.dc }));
    if (hasGround) elems.push({ id: '0', type: 'ground', nodes: ['gnd'], __ground: true });

    // Числовые id узлов (земля = 0) -> node_p в точности как у настоящего EWB.
    const names = new Set();
    for (const e of elems) for (const n of e.nodes) names.add(n);
    const netId = new Map();
    for (const n of names) if (isGroundName(n)) netId.set(n, 0);
    let next = 1;
    for (const n of [...names].sort()) if (!netId.has(n)) netId.set(n, next++);

    // Терминалы по узлам (узлы = {ci,ti}); соединения цепляем одной цепочкой.
    const netTerms = new Map();
    elems.forEach((c, ci) => c.nodes.forEach((n, ti) => {
        const k = netId.get(n);
        if (!netTerms.has(k)) netTerms.set(k, []);
        netTerms.get(k).push({ ci, ti });
    }));
    const L = [];
    L.push('Project ', '{ ', '  Circuit ', '{ ');
    L.push('    Elements ', '{ ');
    for (const c of elems) {
        const pn = PART[c.type] || 1;
        const val = c.__ground ? 0
            : (c.type === 'vsource' || c.type === 'isource')
                ? (c.dc != null ? c.dc : 0)
                : (c.value != null ? c.value : 0);
        L.push(`      Comp { Common { RefID A "${c.id}" } PartNum i ${pn} ModelName R "" Status i 0 Value r:5 ${val} 0 0 0 0 }`);
    }
    L.push('    } ', '    Wires ', '{ ');
    for (const [k, list] of netTerms) {
        for (let i = 1; i < list.length; i++) {
            const a = list[0]; const b = list[i];
            L.push(`      wire { pos i:4 ${a.ci} ${a.ti} ${b.ci} ${b.ti} colour i 0 wire_id i 0 node_p A "${k}" }`);
        }
    }
    L.push('    } ', '  } ', '} ');

    return L.join('\n') + '\n';
}

export default { serializeNetlist };
