// Демонстрация подключения движка к фронтенду.
// Импортирует ядро из /engine/index.js и показывает живые результаты:
//   DC — таблица напряжений/токов; TRAN — график на канвасе («осциллограф»);
//   AC — АЧХ в дБ (лог-ось частоты).
// Открыть: Site/engine/demo.html через Live Server (root = Site/, порт :5502).

import { simulate, ENGINE_VERSION } from './index.js';

const $ = (s) => document.querySelector(s);
document.getElementById('ver').textContent = 'v' + ENGINE_VERSION;

// ---- пресеты схем ----
const divider = () => ({
    components: [
        { id: 'V1', type: 'vsource', dc: 10, nodes: ['n1', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
        { id: 'R2', type: 'resistor', value: 1000, nodes: ['n2', 'gnd'] },
    ],
});
const rc = () => ({
    components: [
        { id: 'V1', type: 'vsource', dc: 5, nodes: ['n1', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['n1', 'n2'] },
        { id: 'C1', type: 'capacitor', value: 1e-6, ic: 0, nodes: ['n2', 'gnd'] },
    ],
});
const rcFilter = () => ({
    components: [
        { id: 'V1', type: 'vsource', ac: 1, nodes: ['in', 'gnd'] },
        { id: 'R1', type: 'resistor', value: 1000, nodes: ['in', 'n2'] },
        { id: 'C1', type: 'capacitor', value: 1e-6, nodes: ['n2', 'gnd'] },
    ],
});

const fmt = (x, d = 4) => (Number.isFinite(x) ? Number(x).toFixed(d) : String(x));

// ---- отрисовка ----
function drawPlot(canvas, series, opts = {}) {
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    const padL = 46, padR = 10, padT = 12, padB = 24;
    ctx.clearRect(0, 0, W, H);
    // границы
    let xmax = -Infinity, xmin = Infinity, ymax = -Infinity, ymin = Infinity;
    for (const s of series) for (const p of s.points) {
        xmax = Math.max(xmax, p.x); xmin = Math.min(xmin, p.x);
        ymax = Math.max(ymax, p.y); ymin = Math.min(ymin, p.y);
    }
    if (xmax === -Infinity) return;
    if (Math.abs(ymax - ymin) < 1e-12) { ymax += 1; ymin -= 1; }
    const sx = (x) => padL + ((x - xmin) / (xmax - xmin)) * (W - padL - padR);
    const sy = (y) => H - padB - ((y - ymin) / (ymax - ymin)) * (H - padT - padB);
    // сетка + оси
    ctx.strokeStyle = '#2a2f3a'; ctx.lineWidth = 1; ctx.fillStyle = '#8b93a1'; ctx.font = '11px monospace';
    for (let g = 0; g <= 4; g++) {
        const y = padT + (g / 4) * (H - padT - padB);
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText(fmt(ymax - (g / 4) * (ymax - ymin), 2), 4, y + 3);
    }
    ctx.strokeStyle = '#3a4250';
    ctx.beginPath(); ctx.moveTo(padL, padT); ctx.lineTo(padL, H - padB); ctx.lineTo(W - padR, H - padB); ctx.stroke();
    ctx.fillText(opts.xlabel || 'x', W / 2, H - 6);
    ctx.fillText(opts.ylabel || 'y', 6, padT - 2);
    // серии
    for (const s of series) {
        ctx.strokeStyle = s.color; ctx.lineWidth = 1.6; ctx.beginPath();
        s.points.forEach((p, i) => { const X = sx(p.x), Y = sy(p.y); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
        ctx.stroke();
    }
    // легенда
    series.forEach((s, i) => {
        ctx.fillStyle = s.color; ctx.fillRect(W - padR - 120, padT + i * 16, 10, 3);
        ctx.fillText(s.label, W - padR - 105, padT + 6 + i * 16);
    });
}

function table(rows) {
    return '<table>' + rows.map((r) => '<tr>' + r.map((c) => `<td class="mono">${c}</td>`).join('') + '</tr>').join('') + '</table>';
}

// ---- обработчики ----
document.getElementById('btn-dc').onclick = () => {
    const r = simulate(divider(), { analysis: 'op' });
    const rows = [['Узел', 'U, В']];
    for (const [n, v] of Object.entries(r.nodeVoltages)) rows.push([n, fmt(v)]);
    rows.push(['I(V1), А', fmt(r.branchCurrents.V1)]);
    $('#readout').innerHTML = '<b>DC — делитель 10 В / 1 кОм / 1 кОм</b><br>' + table(rows);
    drawPlot($('#scope'), [], {});
};

document.getElementById('btn-tran').onclick = () => {
    const r = simulate(rc(), { analysis: 'tran', tstop: 5e-3, tstep: 1e-6, uic: true });
    const pts = r.t.map((t, i) => ({ x: t * 1e3, y: r.v['n2'][i] }));
    drawPlot($('#scope'), [{ points: pts, color: '#7ee787', label: 'U(n2), В' }], { xlabel: 't, мс', ylabel: 'U, В' });
    const at = (t) => r.v['n2'][Math.round(t / 1e-6)];
    $('#readout').innerHTML = `<b>TRAN — зарядка RC (τ = 1 мс)</b><br>U(n2, 1 мс) = ${fmt(at(1e-3), 3)} В · аналитика = ${fmt(5 * (1 - Math.exp(-1)), 3)} В`;
};

document.getElementById('btn-ac').onclick = () => {
    const r = simulate(rcFilter(), { analysis: 'ac', freqs: [1, 3, 10, 30, 100, 159, 1e3, 3e3, 1e4, 1e5, 1e6] });
    const mag = (c) => Math.hypot(c.re, c.im);
    const logf = (f) => Math.log10(f);
    const pts = r.f.map((f, i) => ({ x: logf(f), y: 20 * Math.log10(mag(r.v['n2'][i]) / mag(r.v['in'][i])) }));
    drawPlot($('#scope'), [{ points: pts, color: '#79c0ff', label: '|H|, дБ' }], { xlabel: 'log10(f, Гц)', ylabel: 'дБ' });
    $('#readout').innerHTML = `<b>AC — RC-фильтр нижних частот</b><br>Срез f = 1/(2πRC) = ${fmt(1 / (2 * Math.PI * 1000 * 1e-6), 2)} Гц, на срезе |H| ≈ -3.01 дБ.`;
};

// авто-старт с DC для наглядности
document.getElementById('btn-dc').click();
