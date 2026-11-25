// Мост «движок ↔ фронтенд» EWR.
//
//   * exposes window.EWR_SIM = { simulate, simulateScene, runEditorScene,
//     buildNetlist, assignNets, mapComponentType, selfTest }
//   * Run-переключатель (#switch в EWR.html) при включении собирает РЕАЛЬНУЮ
//     сцену редактора (`WireSystem.scene()`), гоняет её через новый движок
//     (`Site/engine/ewb-facade.js` → CKT) и пишет результат в строку статуса
//     и на приборы;
//   * assignNets() — чистая функция сборки нетлиста из графа соединений для
//     сохранения (legacy-формат `.ewb`); новый движок использует facade.
//
// Весь DOM-код защищён (typeof document), поэтому модуль импортируется и в Node.

import { simulate as legacySimulate, buildNetlist } from '../../engine/index.js';
import { simulateScene, formatValue } from '../../engine/ewb-facade.js';
import { EWB_BY_ID } from '../../engine/ewb-devices.js';

// --- чистая логика (тестируется в Node) ----------------------------------

// Тип по id плитки берётся из сгенерированной таблицы палитры (ewb-devices.js).
// Списки ниже — запасной путь для старых сцен и внешних id.

// Тип устройства из `ewb.device` → тип, который понимает мост редактора.
// Мост/legacy-нетлист знает только часть приборов; остальные (connector,
// transformer, ExtComp) остаются null и в спецификацию не попадают.
const BRIDGE_DEVICE = {
    resistor: 'resistor',
    capacitor: 'capacitor',
    inductor: 'inductor',
    diode: 'diode',
    vsource: 'vsource',
    isource: 'isource',
    ground: 'ground',
    meter: 'instrument',
};

// Сопоставление категории компонента редактора с типом устройства движка.
export function mapComponentType(id) {
    const t = String(id || '').toLowerCase();
    const tile = EWB_BY_ID[t];
    if (tile && tile.device !== 'unknown') return BRIDGE_DEVICE[tile.device] || null;
    // Ниже — только исторические id (до шага 5b плана I4).
    if (['resistor', 'res'].includes(t)) return 'resistor';
    if (['capacitor', 'cap'].includes(t)) return 'capacitor';
    if (['inductor', 'ind'].includes(t)) return 'inductor';
    if (['diode', 'led', 'zener'].includes(t)) return 'diode';
    if (['vsource', 'generator', 'source', 'battery', 'signal', 'gens', 'funcgen', 'ac-voltage-source'].includes(t)) return 'vsource';
    if (['isource', 'current-source', 'currentsource', 'dc-current-source', 'ac-current-source'].includes(t)) return 'isource';
    // `point` — это соединитель (PartNum 9), а не земля: земля — только ground/gnd.
    if (['ground', 'gnd', 'earth', 'earthing'].includes(t)) return 'ground';
    if (['multimeter', 'ammeter', 'voltmeter', 'meter', 'oscilograph', 'osc', 'logic', 'wordgen', 'bode', 'grapher', 'stenograhp', 'digital'].includes(t)) return 'instrument';
    return null;
}

// Собирает нетлист из компонентов и списка соединений (для сохранения .ewb).
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

// Самопроверка нового движка: делитель 10В/1к/1к -> U(n2)=5В.
export function selfTest() {
    const scene = {
        components: [
            { inst: 'V1', editorId: 'generator', etype: 'vsource', value: '10', ports: ['p1', 'p2'] },
            { inst: 'R1', editorId: 'resistor', etype: 'resistor', value: '1000', ports: ['p1', 'p2'] },
            { inst: 'R2', editorId: 'resistor', etype: 'resistor', value: '1000', ports: ['p1', 'p2'] },
            { inst: 'G1', editorId: 'point', etype: 'ground', value: '', ports: ['p1'] },
        ],
        links: [
            ['V1:p1', 'R1:p1'],
            ['R1:p2', 'R2:p1'],
            ['V1:p2', 'G1:p1'],
            ['R2:p2', 'G1:p1'],
        ],
    };
    const r = simulateScene(scene, { analysis: 'op' });
    if (!r.ok) {
        return { r, text: 'Движок: ошибка симуляции — ' + (r.message || 'неизвестная') };
    }
    const u2 = r.nodeVoltages.n2;
    const i1 = r.branchCurrents.V1;
    return {
        r,
        text: `Движок активен · U(n2)=${Number(u2).toFixed(3)} В · I=${Math.abs(i1 * 1000).toFixed(2)} мА`,
    };
}

/** Короткая строка результата для статус-бара (без DOM). */
export function describeResult(result) {
    if (!result || !result.ok) {
        const reason = result && result.message ? result.message : 'неизвестная ошибка';
        return 'Симуляция: ' + reason;
    }
    const parts = [];
    for (const r of result.readings || []) {
        const label = r.kind === 'ammeter' ? 'I' : 'U';
        parts.push(`${r.inst} ${label}=${formatValue(r.value, r.unit)}`);
    }
    if (!parts.length) {
        const nodes = Object.entries(result.nodeVoltages || {});
        for (const [name, value] of nodes.slice(0, 8)) {
            parts.push(`${name}=${formatValue(value, 'В')}`);
        }
    }
    if (result.skipped && result.skipped.length) {
        const names = [...new Set(result.skipped.map((s) => s.type))].join(', ');
        parts.push(`пропущено: ${names}`);
    }
    return parts.length ? parts.join(' · ') : 'Симуляция выполнена';
}

// --- DOM-интеграция (только в браузере) ----------------------------------

if (typeof document !== 'undefined') {
    // Ленивый импорт WireSystem: модуль проводов обращается к DOM на верхнем
    // уровне и не должен загружаться в Node-тестах моста.
    async function currentScene() {
        const mod = await import('./wires.js');
        return mod.default.scene();
    }

    function findComponentNode(inst) {
        const nodes = document.querySelectorAll('.component-svg');
        for (const node of nodes) if (node.dataset.inst === inst) return node;
        return null;
    }

    // Показать значение на приборе: слот SVG, если он есть, иначе бейдж.
    function showReadout(componentNode, text) {
        if (!componentNode) return;
        const slot = componentNode.querySelector('svg [data-slot="value"]');
        if (slot) { slot.textContent = text; return; }
        let badge = componentNode.querySelector('.sim-readout');
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'sim-readout';
            componentNode.appendChild(badge);
        }
        badge.textContent = text;
    }

    function updateReadouts(result) {
        for (const r of result.readings || []) {
            const unit = r.kind === 'ammeter' ? 'А' : r.unit || 'В';
            showReadout(findComponentNode(r.inst), formatValue(r.value, unit));
        }
    }

    // Прогон реальной сцены редактора новым движком.
    // options: { analysis: 'op'|'tran'|'ac', tstop, tstep, fstart, fstop, points }
    async function runEditorScene(options = {}) {
        const scene = await currentScene();
        const result = simulateScene(scene, { analysis: 'op', ...options });
        return { scene, result };
    }

    const boot = () => {
        window.EWR_SIM = {
            simulate: legacySimulate,
            simulateScene,
            runEditorScene,
            buildNetlist,
            assignNets,
            mapComponentType,
            selfTest,
            describeResult,
        };

        const sw = document.getElementById('switch');
        const status = document.getElementById('status');
        if (!sw) return;

        // Кнопка Run: ON — прогон текущей схемы, OFF — остановка.
        let running = false;
        sw.addEventListener('click', () => {
            // interface.js переключает фон ON/OFF первым (его слушатель
            // зарегистрирован раньше), поэтому читаем состояние в следующем
            // тике, как и раньше.
            setTimeout(async () => {
                const img = sw.style.backgroundImage || '';
                const on = /ON\.bmp/i.test(img);
                running = on;
                if (!status) return;
                if (!on) {
                    status.textContent = 'Симуляция остановлена';
                    return;
                }
                try {
                    const { scene, result } = await runEditorScene({ analysis: 'op' });
                    if (!scene.components.length) {
                        status.textContent = 'Схема пуста — разместите компоненты и нажмите Run';
                        return;
                    }
                    updateReadouts(result);
                    status.textContent = describeResult(result);
                } catch (e) {
                    status.textContent = 'Движок: ошибка симуляции — ' + e.message;
                } finally {
                    // `running` нужен внешним модулям (например, приборам).
                    window.EWR_SIM.running = running;
                }
            }, 0);
        });
    };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
}

export { legacySimulate as simulate };
export default {
    simulate: legacySimulate,
    simulateScene,
    buildNetlist,
    assignNets,
    mapComponentType,
    selfTest,
    describeResult,
};
