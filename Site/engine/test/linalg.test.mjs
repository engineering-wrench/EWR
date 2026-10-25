import { test } from 'node:test';
import assert from 'node:assert/strict';
import { luSolve, luSolveComplex, cx } from '../linalg.js';

test('luSolve: 3x3 с уникальным решением', () => {
    // 2x + y - z = 8 ; -3x - y + 2z = -11 ; -2x + y + 2z = -3  => x=2,y=3,z=-1
    const A = [[2, 1, -1], [-3, -1, 2], [-2, 1, 2]];
    const b = [8, -11, -3];
    const x = luSolve(A, b);
    assert.ok(Math.abs(x[0] - 2) < 1e-9);
    assert.ok(Math.abs(x[1] - 3) < 1e-9);
    assert.ok(Math.abs(x[2] + 1) < 1e-9);
});

test('luSolve: требует перестановки строк (нулевой ведущий)', () => {
    const A = [[0, 1], [1, 0]];
    const b = [2, 5];
    const x = luSolve(A, b); // x=[5,2]
    assert.deepEqual(x, [5, 2]);
});

test('luSolve: вырожденная матрица бросает ошибку', () => {
    assert.throws(() => luSolve([[1, 2], [2, 4]], [1, 2]));
});

test('luSolveComplex: (1+i)x + y = 2+i ; x + (1-i)y = i', () => {
    // решаем и проверяем подстановкой
    const A = [[cx(1, 1), cx(1, 0)], [cx(1, 0), cx(1, -1)]];
    const b = [cx(2, 1), cx(0, 1)];
    const x = luSolveComplex(A, b);
    // проверка A·x = b
    const r0 = { re: A[0][0].re * x[0].re - A[0][0].im * x[0].im + A[0][1].re * x[1].re - A[0][1].im * x[1].im,
                 im: A[0][0].re * x[0].im + A[0][0].im * x[0].re + A[0][1].re * x[1].im + A[0][1].im * x[1].re };
    const r1 = { re: A[1][0].re * x[0].re - A[1][0].im * x[0].im + A[1][1].re * x[1].re - A[1][1].im * x[1].im,
                 im: A[1][0].re * x[0].im + A[1][0].im * x[0].re + A[1][1].re * x[1].im + A[1][1].im * x[1].re };
    assert.ok(Math.hypot(r0.re - b[0].re, r0.im - b[0].im) < 1e-9);
    assert.ok(Math.hypot(r1.re - b[1].re, r1.im - b[1].im) < 1e-9);
});
