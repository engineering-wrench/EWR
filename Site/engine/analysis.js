// Решающий движок EWR: штамповка MNA и решатели.
//   * DC (операционная точка): Ньютон–Рафсон + gmin/source stepping;
//   * TRAN (временной анализ): трапеция/неявный Эйлер, фиксированный шаг, UIC;
//   * AC (частотный): линейный анализ в комплексе.
// Здесь — вся «математика». UI/инструменты подают нетлист и читают результат.

import { createSystem } from './system.js';
import { cx } from './linalg.js';
import {
    VT, num, deviceVoltage, nodeVoltage, branchCurrent,
    instantSource, buildNetlist,
} from './netlist.js';

// --- Диод: нелинейность и линеаризация ----------------------------------
// Уравнение Шокли: Id = Is (exp(Vd/(n·Vt)) − 1).
function diodeParams(d) {
    return { is: num(d.params.is, 1e-14), n: num(d.params.n, 1), vt: VT * num(d.params.n, 1) };
}
function diodeEval(d) {
    const { is, vt } = diodeParams(d);
    const v = d._v;
    const ev = Math.exp(v / vt);
    return { id: is * (ev - 1), gd: (is * ev) / vt };
}
function diodeVcrit(d) {
    const { is, vt } = diodeParams(d);
    return vt * Math.log(vt / (Math.SQRT2 * is));
}
// Ограничение приращения напряжения p-n перехода (SPICE pnjlim).
function pnjlim(vnew, vold, vt, vcrit) {
    if (vnew > vcrit && Math.abs(vnew - vold) > 2 * vt) {
        if (vold > 0) {
            const arg = 1 + (vnew - vold) / vt;
            return arg > 0 ? vold + vt * Math.log(arg) : vcrit;
        }
        return vnew > 0 ? vt * Math.log(Math.max(vnew / vt, 1 + 1e-12)) : vnew;
    }
    return vnew;
}

// --- примитивы штамповки -------------------------------------------------

// Проводимость G между узлами p и n (p,-1 = земля).
function stampG(sys, p, n, G) {
    sys.addA(p, p, G);
    sys.addA(n, n, G);
    sys.addA(p, n, -G);
    sys.addA(n, p, -G);
}
// Ток I, впрыскиваемый в узел k (k = -1 => земля, игнор).
function inject(sys, k, I) { sys.addB(k, I); }
// Ветвь с доп. током e: ток течёт p->n внутри элемента (KCL).
function branchKCL(sys, p, n, e) {
    sys.addA(p, e, 1);
    sys.addA(n, e, -1);
}
// Источник напряжения: KCL + уравнение ветви vp-vn = V (строка e).
function stampVs(sys, p, n, e, V) {
    branchKCL(sys, p, n, e);
    sys.addA(e, p, 1);
    sys.addA(e, n, -1);
    sys.addB(e, V);
}

// --- штамповка всех элементов (реальные DC/TRAN) -------------------------
function stampAll(sys, nl, ctx) {
    for (const d of nl.devices) {
        switch (d.type) {
            case 'resistor': {
                const R = num(d.params.value != null ? d.params.value : d.params.r, 1);
                stampG(sys, d.nodes[0], d.nodes[1], 1 / R);
                break;
            }
            case 'isource': {
                const I = instantSource(d, ctx.mode, ctx.time, ctx.scale);
                // ток p->n через источник, выдаётся в узел (nodes[1])
                inject(sys, d.nodes[0], -I);
                inject(sys, d.nodes[1], I);
                break;
            }
            case 'vsource': {
                const e = nl.N + d.extra;
                const V = instantSource(d, ctx.mode, ctx.time, ctx.scale);
                stampVs(sys, d.nodes[0], d.nodes[1], e, V);
                break;
            }
            case 'inductor': {
                const e = nl.N + d.extra;
                branchKCL(sys, d.nodes[0], d.nodes[1], e);
                if (ctx.mode === 'dc') {
                    // короткое замыкание: vp - vn = 0
                    sys.addA(e, d.nodes[0], 1);
                    sys.addA(e, d.nodes[1], -1);
                    sys.addB(e, 0);
                } else {
                    const L = num(d.params.value != null ? d.params.value : d.params.l, 0);
                    const dt = ctx.dt;
                    const trap = ctx.method === 'trap';
                    const k = trap ? (2 * L) / dt : L / dt; // реактивное «сопротивление»
                    sys.addA(e, d.nodes[0], 1);
                    sys.addA(e, d.nodes[1], -1);
                    sys.addA(e, e, -k);
                    const rhs = trap
                        ? (-(2 * L / dt) * d._prev.i - d._prev.v)
                        : (-(L / dt) * d._prev.i);
                    sys.addB(e, rhs);
                }
                break;
            }
            case 'capacitor': {
                if (ctx.mode === 'dc') break; // разрыв (i = 0)
                const C = num(d.params.value != null ? d.params.value : d.params.c, 0);
                const dt = ctx.dt;
                const trap = ctx.method === 'trap';
                const Gc = trap ? (2 * C) / dt : C / dt;
                stampG(sys, d.nodes[0], d.nodes[1], Gc);
                const Ieq = trap ? Gc * d._prev.v + d._prev.i : Gc * d._prev.v;
                inject(sys, d.nodes[0], Ieq);
                inject(sys, d.nodes[1], -Ieq);
                break;
            }
            case 'diode': {
                const { gd } = diodeEval(d);
                stampG(sys, d.nodes[0], d.nodes[1], gd + ctx.gmin);
                const { id } = diodeEval(d);
                const Ieq = gd * d._v - id;
                inject(sys, d.nodes[0], Ieq);
                inject(sys, d.nodes[1], -Ieq);
                break;
            }
            default:
                throw new Error(`analysis: неизвестный тип элемента "${d.type}"`);
        }
    }
}

// --- штамповка AC (комплексная) ------------------------------------------
function stampAc(sys, nl, ctx) {
    const { omega } = ctx;
    for (const d of nl.devices) {
        switch (d.type) {
            case 'resistor': {
                const R = num(d.params.value != null ? d.params.value : d.params.r, 1);
                stampGC(sys, d.nodes[0], d.nodes[1], cx(1 / R, 0));
                break;
            }
            case 'capacitor': {
                const C = num(d.params.value != null ? d.params.value : d.params.c, 0);
                stampGC(sys, d.nodes[0], d.nodes[1], cx(0, omega * C)); // Y = jωC
                break;
            }
            case 'inductor': {
                // ветвь с доп. током: vp-vn = jωL·i  (Z = jωL)
                const e = nl.N + d.extra;
                branchKCL(sys, d.nodes[0], d.nodes[1], e);
                sys.addA(e, d.nodes[0], cx(1, 0));
                sys.addA(e, d.nodes[1], cx(-1, 0));
                const L = num(d.params.value != null ? d.params.value : d.params.l, 0);
                sys.addA(e, e, cx(0, -omega * L));
                break;
            }
            case 'isource': {
                const { re, im } = acSource(d);
                sys.addB(d.nodes[0], cx(-re, -im));
                sys.addB(d.nodes[1], cx(re, im));
                break;
            }
            case 'vsource': {
                const e = nl.N + d.extra;
                const { re, im } = acSource(d);
                stampVsC(sys, d.nodes[0], d.nodes[1], e, cx(re, im));
                break;
            }
            case 'diode': {
                // малосигнальная проводимость около рабочей точки (из dcOp)
                const { gd } = diodeEval(d);
                stampGC(sys, d.nodes[0], d.nodes[1], cx(gd, 0));
                break;
            }
            default:
                throw new Error(`analysis(ac): неизвестный тип "${d.type}"`);
        }
    }
}
function stampGC(sys, p, n, G) {
    sys.addA(p, p, G); sys.addA(n, n, G); sys.addA(p, n, cx(-G.re, -G.im)); sys.addA(n, p, cx(-G.re, -G.im));
}
function stampVsC(sys, p, n, e, V) {
    branchKCL(sys, p, n, e);
    sys.addA(e, p, cx(1, 0)); sys.addA(e, n, cx(-1, 0)); sys.addB(e, V);
}
// Комплексная амплитуда AC-источника: p.ac = число | {mag, phase(град)}.
function acSource(d) {
    const a = d.params.ac;
    if (a == null) return cx(0, 0);
    if (typeof a === 'number') return cx(a, 0);
    const mag = num(a.mag);
    const ph = (num(a.phase) * Math.PI) / 180;
    return cx(mag * Math.cos(ph), mag * Math.sin(ph));
}

// --- шаг Ньютона (общий для DC и TRAN) -----------------------------------
// Обновляет d._v по решению, применяя ограничение для диодов.
// Возвращает максимальное ИЗМЕНЕНИЕ смещения d._v (dv) — ключ к сходимости
// нелинейных элементов: пока gd мал, напряжение на p-n переходе «подтекает»
// (dv велико); сходимость только когда dv тоже мало.
function updateBiases(nl, x) {
    let maxdv = 0;
    for (const d of nl.devices) {
        let v = deviceVoltage(x, d);
        if (d.type === 'diode') {
            const { vt } = diodeParams(d);
            const vLim = pnjlim(v, d._v, vt, diodeVcrit(d));
            maxdv = Math.max(maxdv, Math.abs(vLim - d._v));
            v = vLim;
        }
        d._v = v;
    }
    return maxdv;
}

// Один шаг Ньютона–Рафсона: строит, решает, обновляет смещения.
function newtonStep(nl, ctx, x) {
    const sys = createSystem(nl.size, false);
    stampAll(sys, nl, ctx);
    const x2 = sys.solve();
    const dv = updateBiases(nl, x2);
    let dx = 0;
    for (let i = 0; i < nl.size; i++) dx = Math.max(dx, Math.abs(x2[i] - x[i]));
    return { x: x2, dx, dv };
}

// Решение DC (одного «шага» Ньютона до сходимости).
export function solveDC(nl, opts = {}) {
    const { gmin = 0, scale = 1, x0 = null, maxIter = 200, reltol = 1e-4, vabstol = 1e-7 } = opts;
    const hasNL = nl.devices.some((d) => d.type === 'diode');
    let x = x0 ? x0.slice() : new Array(nl.size).fill(0);
    for (const d of nl.devices) d._v = 0;
    for (let it = 0; it < maxIter; it++) {
        const r = newtonStep(nl, { mode: 'dc', gmin, scale }, x);
        let refV = 1;
        for (const d of nl.devices) if (d.type === 'diode') refV = Math.max(refV, Math.abs(d._v));
        const converged = r.dx < vabstol + reltol * maxAbs(r.x) &&
            (!hasNL || r.dv < 1e-7 + 1e-3 * refV);
        x = r.x;
        if (converged) return { x, converged: true, it };
    }
    return { x, converged: false, it: maxIter };
}

// Операционная точка с gmin-stepping и (при неудаче) source-stepping.
export function dcOp(nl, opts = {}) {
    const { gminStart = 1e-3, gminMin = 1e-12 } = opts;
    let x0 = null, ok = false, x = new Array(nl.size).fill(0);
    for (let g = gminStart; g >= gminMin; g /= 10) {
        const r = solveDC(nl, { gmin: g, x0, ...opts });
        x = r.x; ok = r.converged; x0 = x;
    }
    if (!ok) {
        // source stepping: вводим источники постепенно 0 → 1
        x0 = null;
        for (const s of [0, 0.05, 0.1, 0.2, 0.4, 0.7, 1]) {
            const r = solveDC(nl, { gmin: 0, scale: s, x0, ...opts });
            x = r.x; x0 = x; ok = r.converged || ok;
        }
    }
    return finalize(nl, x);
}

// --- Временной анализ ----------------------------------------------------
export function transient(nl, opts = {}) {
    const tstop = num(opts.tstop, 1e-3);
    const tstep = num(opts.tstep, tstop / 200);
    const method = opts.method === 'be' ? 'be' : 'trap';
    const uic = !!opts.uic;
    const hasNL = nl.devices.some((d) => d.type === 'diode');

    let x;
    if (uic) {
        x = new Array(nl.size).fill(0);
    } else {
        const res = dcOp(nl, opts);
        x = res.x;
    }
    // инициализация состояний реактивных элементов
    for (const d of nl.devices) {
        if (d.type === 'capacitor') d._prev = { v: deviceVoltage(x, d), i: 0 };
        else if (d.type === 'inductor') d._prev = { v: 0, i: num(d.params.ic) };
        if (uic && (d.type === 'capacitor' || d.type === 'inductor')) d._v = deviceVoltage(x, d);
    }
    for (const d of nl.devices) if (d.type !== 'capacitor' && d.type !== 'inductor') d._v = deviceVoltage(x, d);

    const steps = Math.max(1, Math.round(tstop / tstep));
    const out = { t: [0], v: {}, i: {} };
    initProbes(out, nl);
    recordSample(out, nl, x, 0);

    let t = 0;
    for (let k = 1; k <= steps; k++) {
        t = k * tstep;
        const ctx = { mode: 'tran', dt: tstep, time: t, method, gmin: 0, scale: 1 };
        if (!hasNL) {
            const sys = createSystem(nl.size, false);
            stampAll(sys, nl, ctx);
            x = sys.solve();
            updateStates(nl, x, tstep, method);
        } else {
            for (let it = 0; it < 100; it++) {
                const r = newtonStep(nl, ctx, x);
                x = r.x;
                if (r.dx < 1e-10 + 1e-6 * maxAbs(x) && r.dv < 1e-7) break;
            }
            updateStates(nl, x, tstep, method);
        }
        recordSample(out, nl, x, t);
    }
    return { analysis: 'tran', t: out.t, v: out.v, i: out.i, _nl: nl };
}

// Обновляет состояния ёмкостей/индуктивностей по решению шага.
function updateStates(nl, x, dt, method) {
    const trap = method === 'trap';
    for (const d of nl.devices) {
        if (d.type === 'capacitor') {
            const C = num(d.params.value != null ? d.params.value : d.params.c, 0);
            const Gc = trap ? (2 * C) / dt : C / dt;
            const v = deviceVoltage(x, d);
            const i = trap ? Gc * (v - d._prev.v) - d._prev.i : Gc * (v - d._prev.v);
            d._prev = { v, i };
        } else if (d.type === 'inductor') {
            d._prev = { v: deviceVoltage(x, d), i: branchCurrent(nl, x, d) };
        }
    }
}

// --- Частотный анализ ----------------------------------------------------
export function ac(nl, opts = {}) {
    // Рабочая точка нужна для смещения нелинейных (диод) в AC.
    if (nl.devices.some((d) => d.type === 'diode')) dcOp(nl, opts);
    const freqs = resolveFreqs(opts);
    const out = { f: [], v: {}, i: {} };
    for (const name of nl.nodeList) out.v[name] = [];
    for (const d of nl.devices) if (needsBranch(d.type)) out.i[d.id] = [];
    for (const f of freqs) {
        const omega = 2 * Math.PI * f;
        const sys = createSystem(nl.size, true);
        stampAc(sys, nl, { omega });
        const x = sys.solve();
        out.f.push(f);
        for (const [name, k] of nl.nodeIndex) out.v[name].push(cx(x[k].re, x[k].im));
        for (const d of nl.devices) if (needsBranch(d.type)) out.i[d.id].push({ re: x[nl.N + d.extra].re, im: x[nl.N + d.extra].im });
    }
    return { analysis: 'ac', f: out.f, v: out.v, i: out.i };
}

function needsBranch(type) { return type === 'vsource' || type === 'inductor'; }

function resolveFreqs(opts) {
    if (Array.isArray(opts.freqs)) return opts.freqs.map(num);
    const f0 = num(opts.fstart, 1), f1 = num(opts.fstop, 1e3), n = Math.max(1, num(opts.points, 50));
    if (opts.sweep === 'dec') return Array.from({ length: n }, (_, i) => f0 * Math.pow(f1 / f0, i / (n - 1)));
    if (opts.sweep === 'oct') return Array.from({ length: n }, (_, i) => f0 * Math.pow(2, i / Math.max(1, (n - 1) / 1) * Math.log2(f1 / f0)));
    return Array.from({ length: n }, (_, i) => f0 + ((f1 - f0) * i) / (n - 1));
}

// --- запись пробников ----------------------------------------------------
function initProbes(out, nl) {
    for (const name of nl.nodeList) out.v[name] = [];
    for (const d of nl.devices) if (needsBranch(d.type)) out.i[d.id] = [];
}
function recordSample(out, nl, x, t) {
    out.t.push(t);
    for (const [name, k] of nl.nodeIndex) out.v[name].push(nodeVoltage(x, k));
    for (const d of nl.devices) if (needsBranch(d.type)) out.i[d.id].push(branchCurrent(nl, x, d));
}

function maxAbs(a) { let m = 0; for (const v of a) m = Math.max(m, Math.abs(v)); return m; }

// Оформление результата DC/OP: именованные напряжения/токи + по элементам.
function finalize(nl, x) {
    const nodeVoltages = {};
    for (const [name, k] of nl.nodeIndex) nodeVoltages[name] = nodeVoltage(x, k);
    const branchCurrents = {};
    for (const d of nl.devices) if (needsBranch(d.type)) branchCurrents[d.id] = branchCurrent(nl, x, d);
    const elements = nl.devices.map((d) => {
        const v = deviceVoltage(x, d);
        let i = 0;
        switch (d.type) {
            case 'resistor': i = v / num(d.params.value != null ? d.params.value : d.params.r, 1); break;
            case 'vsource': case 'inductor': i = branchCurrent(nl, x, d); break;
            case 'diode': { const r = diodeEval(d); i = r.id; break; }
            case 'capacitor': i = 0; break; // разрыв в DC
            case 'isource': i = instantSource(d, 'dc', 0, 1); break;
        }
        return { id: d.id, type: d.type, v, i, nodes: nodeNames(nl, d) };
    });
    return { analysis: 'dc', x, nodeVoltages, branchCurrents, elements };
}

function nodeNames(nl, d) {
    return d.nodes.map((k) => (k < 0 ? 'gnd' : nl.nodeList[k]));
}

// --- Публичная точка входа ----------------------------------------------
// analyze(spec, opts) — построить нетлист и запустить нужный анализ.
//   opts.analysis: 'op' | 'dc' | 'tran' | 'ac'
export function analyze(spec, opts = {}) {
    const nl = buildNetlist(spec);
    const kind = opts.analysis || 'op';
    switch (kind) {
        case 'op': case 'dc': return dcOp(nl, opts);
        case 'tran': return transient(nl, opts);
        case 'ac': return ac(nl, opts);
        default: throw new Error(`analysis: неизвестный анализ "${kind}"`);
    }
}

// simulate(spec, opts) = analyze(buildNetlist(spec), opts) (удобная обёртка).
export function simulate(spec, opts = {}) {
    return analyze(spec, opts);
}
