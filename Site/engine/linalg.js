// Численное ядро EWR: модуль линейной алгебры.
// Малые плотные системы MNA (схемы EWB — десятки-сотни узлов) решаются
// плотным LU с частичным выбором ведущего элемента. Реализованы РЕАЛЬНЫЙ и
// КОМПЛЕКСНЫЙ решатели. Чистые функции, без DOM — работают и в браузере, и в Node.

// Решение Ax=b методом Гаусса (LU) с частичным выбором по столбцу.
// A: number[][] (n×n), b: number[] (n). Возвращает number[] длины n.
export function luSolve(A, b) {
    const n = b.length;
    const M = A.map((row) => Float64Array.from(row));
    const x = Float64Array.from(b);
    for (let k = 0; k < n; k++) {
        let piv = k;
        let best = Math.abs(M[k][k]);
        for (let i = k + 1; i < n; i++) {
            const a = Math.abs(M[i][k]);
            if (a > best) { best = a; piv = i; }
        }
        if (best === 0) throw new Error('linalg: вырожденная матрица (нет ведущего элемента)');
        if (piv !== k) {
            const tr = M[piv]; M[piv] = M[k]; M[k] = tr;
            const s = x[piv]; x[piv] = x[k]; x[k] = s;
        }
        const akk = M[k][k];
        for (let i = k + 1; i < n; i++) {
            const f = M[i][k] / akk;
            M[i][k] = 0;
            const Mi = M[i], Mk = M[k];
            for (let j = k + 1; j < n; j++) Mi[j] -= f * Mk[j];
            x[i] -= f * x[k];
        }
    }
    for (let i = n - 1; i >= 0; i--) {
        let s = x[i];
        const Mi = M[i];
        for (let j = i + 1; j < n; j++) s -= Mi[j] * x[j];
        x[i] = s / Mi[i];
    }
    return Array.from(x);
}

// Комплексное число представляем объектом { re, im }.
export const cx = (re, im = 0) => ({ re, im });

// Комплексное LU-решение Ac·x = bc, где элементы — { re, im }.
export function luSolveComplex(A, b) {
    const n = b.length;
    const M = A.map((row) => row.map((c) => ({ re: c.re, im: c.im })));
    const x = b.map((c) => ({ re: c.re, im: c.im }));
    const cdiv = (a, bb) => {
        const d = bb.re * bb.re + bb.im * bb.im || 1e-300;
        return { re: (a.re * bb.re + a.im * bb.im) / d, im: (a.im * bb.re - a.re * bb.im) / d };
    };
    const cmul = (a, bb) => ({ re: a.re * bb.re - a.im * bb.im, im: a.re * bb.im + a.im * bb.re });
    for (let k = 0; k < n; k++) {
        let piv = k;
        let best = Math.hypot(M[k][k].re, M[k][k].im);
        for (let i = k + 1; i < n; i++) {
            const a = Math.hypot(M[i][k].re, M[i][k].im);
            if (a > best) { best = a; piv = i; }
        }
        if (best === 0) throw new Error('linalg: вырожденная комплексная матрица');
        if (piv !== k) { const tr = M[piv]; M[piv] = M[k]; M[k] = tr; const s = x[piv]; x[piv] = x[k]; x[k] = s; }
        const akk = M[k][k];
        for (let i = k + 1; i < n; i++) {
            const f = cdiv(M[i][k], akk);
            M[i][k] = { re: 0, im: 0 };
            for (let j = k + 1; j < n; j++) {
                const prod = cmul(f, M[k][j]);
                M[i][j] = { re: M[i][j].re - prod.re, im: M[i][j].im - prod.im };
            }
            const pb = cmul(f, x[k]);
            x[i] = { re: x[i].re - pb.re, im: x[i].im - pb.im };
        }
    }
    for (let i = n - 1; i >= 0; i--) {
        let s = { re: x[i].re, im: x[i].im };
        for (let j = i + 1; j < n; j++) {
            const prod = cmul(M[i][j], x[j]);
            s = { re: s.re - prod.re, im: s.im - prod.im };
        }
        x[i] = cdiv(s, M[i][i]);
    }
    return x;
}
