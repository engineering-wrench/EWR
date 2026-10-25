// Сравнение результатов движка с эталоном оракула.
// Правила — docs/engine/PLAN-CLONE.md §5 («что считаем 1:1»):
//   * OP/DC: относительная 1e-6, абсолютная 1e-9;
//   * TRAN: сетка времени обязана совпадать (по умолчанию бит-в-бит), значения — как OP/DC;
//   * статус сходимости (doAnalyses_rc) и ошибки — обязаны совпадать как статус.
// Сравниваются «сырые» результаты шима (plots с ref/values), а не приборы UI.

/** Допуски по умолчанию (см. §5). */
export const DEFAULT_TOL = {
  rel: 1e-6, // относительная для значений
  abs: 1e-9, // абсолютная для значений
  timeAbs: 0, // допустимое расхождение сетки времени (0 = бит-в-бит)
};

function numEq(a, b, tol) {
  if (a === b) return true;
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.abs(a - b);
  return diff <= tol.abs || diff <= tol.rel * Math.min(Math.abs(a), Math.abs(b));
}

function fmt(x) {
  if (typeof x === 'number') return Number.isInteger(x) ? String(x) : x.toExponential(9);
  return JSON.stringify(x);
}

function cmpValue(g, a, tol, tag, diffs) {
  if (Array.isArray(g) || Array.isArray(a)) {
    const ga = g || [];
    const aa = a || [];
    if (ga.length !== aa.length) {
      diffs.push(`${tag}: длина ${aa.length} != эталон ${ga.length}`);
      return;
    }
    for (let i = 0; i < ga.length; i++) cmpValue(ga[i], aa[i], tol, `${tag}[${i}]`, diffs);
    return;
  }
  if (!numEq(g, a, tol)) diffs.push(`${tag}: ${fmt(a)} != эталон ${fmt(g)}`);
}

/**
 * Сравнить результат оракула с эталоном.
 * @param {object} golden эталон (обычно tools/oracle/golden/*.json)
 * @param {object} actual прогон (runOracle/captureGolden)
 * @param {Partial<typeof DEFAULT_TOL>} [tol]
 * @returns {{ok:boolean, diffs:string[]}}
 */
export function compareResults(golden, actual, tol = {}) {
  const t = { ...DEFAULT_TOL, ...tol };
  const diffs = [];

  const gErr = golden.errors || [];
  const aErr = actual.errors || [];
  if (gErr.length !== aErr.length) {
    diffs.push(`errors: ${aErr.length} != эталон ${gErr.length}`);
  } else {
    for (let i = 0; i < gErr.length; i++) {
      if (gErr[i].flags !== aErr[i].flags || gErr[i].message !== aErr[i].message) {
        diffs.push(`errors[${i}]: ${JSON.stringify(aErr[i])} != ${JSON.stringify(gErr[i])}`);
      }
    }
  }

  if (golden.doAnalyses_rc !== actual.doAnalyses_rc) {
    diffs.push(`doAnalyses_rc: ${actual.doAnalyses_rc} != эталон ${golden.doAnalyses_rc}`);
  }

  const gp = golden.plots || [];
  const ap = actual.plots || [];
  if (gp.length !== ap.length) {
    diffs.push(`plots: ${ap.length} != эталон ${gp.length}`);
    return { ok: diffs.length === 0, diffs };
  }
  for (let i = 0; i < gp.length; i++) {
    const g = gp[i];
    const a = ap[i];
    const tag = `plot[${i}](${g.name})`;
    for (const k of ['name', 'refType', 'dataType', 'ended']) {
      if (g[k] !== a[k]) diffs.push(`${tag}.${k}: ${fmt(a[k])} != ${fmt(g[k])}`);
    }
    if (JSON.stringify(g.names) !== JSON.stringify(a.names)) {
      diffs.push(`${tag}.names: ${JSON.stringify(a.names)} != ${JSON.stringify(g.names)}`);
    }
    const gpts = g.points || [];
    const apts = a.points || [];
    if (gpts.length !== apts.length) {
      diffs.push(`${tag}.points: ${apts.length} != эталон ${gpts.length} (сетка/точки)`);
      continue;
    }
    for (let j = 0; j < gpts.length; j++) {
      const tt = `${tag}[${j}]`;
      if (!numEq(gpts[j].ref, apts[j].ref, { rel: 0, abs: t.timeAbs })) {
        diffs.push(`${tt}.t: ${fmt(apts[j].ref)} != эталон ${fmt(gpts[j].ref)}`);
      }
      cmpValue(gpts[j].values, apts[j].values, t, `${tt}.v`, diffs);
      if (diffs.length > 50) {
        diffs.push('… (обрезано)');
        return { ok: false, diffs };
      }
    }
  }
  return { ok: diffs.length === 0, diffs };
}

/**
 * Сравнение «контракта интерфейса» DLL (enum): устройства/анализы/параметры.
 * Сверяется проекция (имена, выводы, id/типы параметров) — без указателей.
 */
export function enumProjection(enumJson) {
  const parm = (p) => ({ keyword: p.keyword, id: p.id, dataType: p.dataType });
  return {
    simulator: enumJson.simulator,
    description: enumJson.description,
    version: enumJson.version,
    devices: (enumJson.devices || []).map((d) => ({
      name: d.name,
      terms: d.terms,
      termNames: d.termNames,
      instanceParms: (d.instanceParms || []).map(parm),
      modelParms: (d.modelParms || []).map(parm),
    })),
    analyses: (enumJson.analyses || []).map((a) => ({
      name: a.name,
      parms: (a.parms || []).map(parm),
    })),
    nodeParms: (enumJson.nodeParms || []).map(parm),
    specSigs: enumJson.specSigs || [],
  };
}

/**
 * Сравнить каталог интерфейса с эталоном (golden/enum.json).
 * @returns {{ok:boolean, diffs:string[]}}
 */
export function compareEnum(golden, actual) {
  const g = enumProjection(golden);
  const a = enumProjection(actual);
  const diffs = [];
  const seen = new Set();
  const walk = (gp, ap, tag) => {
    if (Array.isArray(gp)) {
      if (!Array.isArray(ap) || gp.length !== ap.length) {
        diffs.push(`${tag}: элементов ${ap?.length} != эталон ${gp.length}`);
        return;
      }
      for (let i = 0; i < gp.length; i++) walk(gp[i], ap[i], `${tag}[${i}]`);
      return;
    }
    if (gp && typeof gp === 'object') {
      for (const k of Object.keys(gp)) walk(gp[k], ap?.[k], `${tag}.${k}`);
      seen.add(tag);
      return;
    }
    if (JSON.stringify(gp) !== JSON.stringify(ap)) {
      diffs.push(`${tag}: ${JSON.stringify(ap)} != эталон ${JSON.stringify(gp)}`);
    }
  };
  walk(g, a, 'enum');
  return { ok: diffs.length === 0, diffs };
}

export default { compareResults, compareEnum, enumProjection, DEFAULT_TOL };
