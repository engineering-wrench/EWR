// Контейнер системы MNA (метод узловых потенциалов с доп. токами).
// Два варианта: реальный (DC/TRAN) и комплексный (AC). Индексы источника
// (ground) задаются как -1; обращения к ним в addA/addB игнорируются.

import { luSolve, luSolveComplex } from './linalg.js';

function guard(i, size) { return i >= 0 && i < size; }

function makeReal(size) {
    const A = Array.from({ length: size }, () => new Float64Array(size));
    const b = new Float64Array(size);
    return {
        size,
        complex: false,
        addA(i, j, v) { if (guard(i, size) && guard(j, size)) A[i][j] += v; },
        addB(i, v) { if (guard(i, size)) b[i] += v; },
        solve() { return luSolve(Array.from(A, (r) => Array.from(r)), Array.from(b)); },
    };
}

function makeComplex(size) {
    const ZERO = () => ({ re: 0, im: 0 });
    const A = Array.from({ length: size }, () => Array.from({ length: size }, ZERO));
    const b = Array.from({ length: size }, ZERO);
    return {
        size,
        complex: true,
        addA(i, j, v) {
            if (guard(i, size) && guard(j, size)) {
                const re = typeof v === 'number' ? v : v.re;
                const im = typeof v === 'number' ? 0 : v.im;
                A[i][j].re += re; A[i][j].im += im;
            }
        },
        addB(i, v) {
            if (guard(i, size)) {
                const re = typeof v === 'number' ? v : v.re;
                const im = typeof v === 'number' ? 0 : v.im;
                b[i].re += re; b[i].im += im;
            }
        },
        solve() {
            const Ac = A.map((row) => row.map((c) => ({ re: c.re, im: c.im })));
            const bc = b.map((c) => ({ re: c.re, im: c.im }));
            return luSolveComplex(Ac, bc);
        },
    };
}

export function createSystem(size, complex = false) {
    return complex ? makeComplex(size) : makeReal(size);
}
