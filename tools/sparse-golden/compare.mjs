/**
 * compare.mjs — сравнение вывода C-драйвера и JS-интерпретатора Sparse 1.3
 * (golden-тест 1:1). Токены-числа сравниваются как double бит-в-бит
 * (Object.is после round-trip-разбора), остальные — по строке.
 *
 * Не часть движка: только тестовый tooling.
 */

/** Разбор C-числа ("%.17g"/"inf"/"nan"/"-0") → number или null. */
function parseNum(s) {
  if (s === 'inf') return Infinity;
  if (s === '-inf') return -Infinity;
  if (s === 'nan' || s === '-nan') return NaN;
  if (s === '-0') return -0;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s)) return null;
  return Number(s);
}

function tokEq(a, b) {
  if (a === b) return true;
  const na = parseNum(a);
  const nb = parseNum(b);
  if (na === null || nb === null) return false;
  if (Number.isNaN(na) && Number.isNaN(nb)) return true;
  return Object.is(na, nb);
}

/**
 * Сравнить выводы. Возвращает массив строк-расхождений (пусто = совпало).
 */
export function compareGolden(cLines, jsLines) {
  const problems = [];
  if (cLines.length !== jsLines.length) {
    problems.push(`разное число строк: C=${cLines.length} JS=${jsLines.length}`);
  }
  const n = Math.min(cLines.length, jsLines.length);
  for (let i = 0; i < n; i++) {
    const a = cLines[i].trim().split(/\s+/);
    const b = jsLines[i].trim().split(/\s+/);
    const same = a.length === b.length && a.every((x, k) => tokEq(x, b[k]));
    if (!same) {
      problems.push(`строка ${i + 1}: C=[${cLines[i]}] JS=[${jsLines[i]}]`);
    }
  }
  return problems;
}
