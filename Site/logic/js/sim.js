// Мост «движок ↔ фронтенд» EWR.
//
//   * exposes window.EWR_SIM = { simulate, buildNetlist, assignNets, mapComponentType, selfTest }
//   * Run-переключатель (#switch в EWR.html) при включении прогоняет
//     самопроверку движка и пишет результат в строку статуса (#status);
//   * assignNets() — чистая функция сборки нетлиста из графа соединений
//     (union-find + назначение земли). Готова к подключению к сцене редактора,
//     когда у размещаемых компонентов появятся уникальные id (см. docs/engine/PLAN.md).
//
// Весь DOM-код защищён (typeof document), поэтому модуль импортируется и в Node.

import { simulate, buildNetlist } from '../../engine/index.js';

// --- чистая логика (тестируется в Node) ----------------------------------

// Сопоставление категории компонента редактора с типом устройства движка.
export function mapComponentType(id) {
    const t = String(id || '').toLowerCase();
    if (['resistor', 'res'].includes(t)) return 'resistor';
    if (['capacitor', 'cap'].includes(t)) return 'capacitor';
    if (['inductor', 'ind'].includes(t)) return 'inductor';
    if (['diode', 'led', 'zener'].includes(t)) return 'diode';
    if (['vsource', 'generator', 'source', 'battery', 'signal', 'gens', 'funcgen'].includes(t)) return 'vsource';
    if (['ground', 'gnd', 'earth', 'earthing', 'point'].includes(t)) return 'ground';
    if (['multimeter', 'ammeter', 'voltmeter', 'oscilograph', 'osc', 'logic', 'wordgen', 'bode', 'grapher', 'stenograhp', 'digital'].includes(t)) return 'instrument';
    return null;
}

// Собирает нетлист из компонентов и списка соединений.
//   components: [{ id, engineType, value, terminals:[key,…] }]
//   edges:      [[keyA, keyB], …]  (key === `${id}/${terminal}`)
// Возвращает { spec, meters, ground } либо { spec:null, reason } если нет земли.
export function assignNets(components, edges) {
    const parent = new Map();
    const find = (k) => {
        if (!parent.has(k)) parent.set(k, k);
        let r = k;
        while (parent.get(r) !== r) { parent.set(r, parent.get(parent.get(r))); r = parent.get(r); }
        return r;
    };
    const union = (a, b) => parent.set(find(a), find(b));

    for (const c of components) for (const t of c.terminals) find(t);
    for (const e of edges || []) { union(e[0], e[1]); find(e[0]); find(e[1]); }

    // Земля: явный компонент ground ИЛИ минус первого источника.
    let groundKey = null;
    for (const c of components) if (c.engineType === 'ground') { groundKey = c.terminals[0]; break; }
    if (!groundKey) {
        const vs = components.find((c) => c.engineType === 'vsource');
        if (vs) groundKey = vs.terminals[1];
    }
    if (!groundKey) {
        return { spec: null, ground: null, meters: [], reason: 'no-ground' };
    }

    const groundRoot = find(groundKey);
    const nameOf = new Map([[groundRoot, 'gnd']]);
    const netName = (key) => {
        const r = find(key);
        if (!nameOf.has(r)) nameOf.set(r, 'n' + nameOf.size);
        return nameOf.get(r);
    };

    const spec = { components: [] };
    const meters = [];
    for (const c of components) {
        if (c.engineType === 'ground') continue;
        const nodes = c.terminals.map(netName);
        if (c.engineType === 'instrument') {
            meters.push({ id: c.id, netA: nodes[0], netB: nodes[1] });
            continue;
        }
        const comp = { id: c.id, type: c.engineType, nodes };
        if (c.engineType === 'vsource') comp.dc = c.value != null ? c.value : 5;
        else if (c.value != null) comp.value = c.value;
        if (c.engineType === 'diode') { comp.is = 1e-14; comp.n = 1; }
        spec.components.push(comp);
    }
    return { spec, meters, ground: groundRoot };
}

// Самопроверка: делитель 10В/1к/1к -> U(n2)=5В. Используется Run-кнопкой.
export function selfTest() {
    const spec = {
        components: [
            { id: 'V1', type: 'vsource', dc: 10, nodes: ['n1', 'gnd'] },
            { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
            { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
        ],
    };
    const r = simulate(spec, { analysis: 'op' });
    return {
        r,
        text: `Движок активен · U(n2)=${r.nodeVoltages.n2.toFixed(3)} В · I=${Math.abs(r.branchCurrents.V1 * 1000).toFixed(2)} мА`,
    };
}

// --- DOM-интеграция (только в браузере) ----------------------------------
if (typeof document !== 'undefined') {
    const boot = () => {
        window.EWR_SIM = { simulate, buildNetlist, assignNets, mapComponentType, selfTest };

        const sw = document.getElementById('switch');
        const status = document.getElementById('status');
        if (!sw) return;
        sw.addEventListener('click', () => {
            // Ждём, пока interface.js переключит фон ON/OFF, затем читаем состояние.
            setTimeout(() => {
                const img = sw.style.backgroundImage || '';
                const on = /ON\.bmp/i.test(img);
                if (!status) return;
                if (on) {
                    try {
                        status.textContent = selfTest().text;
                    } catch (e) {
                        status.textContent = 'Движок: ошибка симуляции — ' + e.message;
                    }
                } else {
                    status.textContent = 'Симуляция остановлена';
                }
            }, 0);
        });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}

export default { simulate, buildNetlist, assignNets, mapComponentType, selfTest };
