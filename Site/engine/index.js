// Публичный API движка симуляции EWR (клиентский «бэкенд»).
//
// Фронтенд и тесты используют только этот модуль:
//   import { simulate, analyze, buildNetlist, GROUND_NAMES } from '/engine/index.js';
//
//   const r = simulate(spec, { analysis: 'op' });   // операционная точка
//   const r = simulate(spec, { analysis: 'tran', tstop: 5e-3, tstep: 1e-6, uic: true });
//   const r = simulate(spec, { analysis: 'ac', fstart: 10, fstop: 1e5, points: 40, sweep: 'dec' });
//
// Формат spec (нетлист) — см. netlist.js.

export { buildNetlist, isGround, GROUND_NAMES, VT } from './netlist.js';
export { analyze, simulate, dcOp, transient, ac, solveDC } from './analysis.js';
export { luSolve, luSolveComplex, cx } from './linalg.js';
export { createSystem } from './system.js';

export const ENGINE_VERSION = '0.1.0';
