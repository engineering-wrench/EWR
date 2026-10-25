// Быстрый смоук: импорт движка из Node и прогон делителя напряжения.
// Запуск: node Site/engine/smoke.mjs
import { simulate } from './index.js';

const divider = {
    components: [
        { id: 'V1', type: 'vsource', dc: 10, nodes: ['n1', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
        { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
    ],
};

const op = simulate(divider, { analysis: 'op' });
console.log('OP nodeVoltages:', op.nodeVoltages);
console.log('OP branchCurrents:', op.branchCurrents);

const rc = {
    components: [
        { id: 'V1', type: 'vsource', dc: 5, nodes: ['n1', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
        { id: 'C1', type: 'capacitor', value: 1e-6, ic: 0, nodes: ['n2', 'gnd'] },
    ],
};
const tran = simulate(rc, { analysis: 'tran', tstop: 5e-3, tstep: 1e-6, uic: true });
const idx = (t) => Math.round(t / 1e-6);
const at1 = tran.v['n2'][idx(1e-3)];
const analytic = 5 * (1 - Math.exp(-1));
console.log('TRAN v(n2)@1ms =', at1.toFixed(4), ' analytic =', analytic.toFixed(4));
