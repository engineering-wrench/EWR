// ewb-facade.js — мост «сцена редактора → CKT-дека → результаты для UI».
//
// Фаза I плана клона (`docs/engine/PLAN-CLONE.md` §4). Сцена редактора
// (`WireSystem.scene()`) описывает компоненты и связи в терминах `inst:port`;
// здесь она переводится в деку CKT (`Site/engine/spice/ckt.js`), запускается
// через `CKTdoJob` и превращается в удобный для интерфейса результат:
//
//   const r = simulateScene(WireSystem.scene(), { analysis: 'op' });
//   r.nodeVoltages;      // { n1: 10, n2: 5 }
//   r.readings;          // показания приборов
//   r.series;            // временные/частотные ряды для осциллографа
//
// Модуль — чистый ESM без DOM: тестируется в Node, используется браузером.
//
// Границы: фундамент нового движка — только OP/TRAN/AC и устройства
// R/C/L/V/I/SW. Неподдерживаемые элементы (диоды, транзисторы, цифра) попадают
// в `skipped` и не мешают расчёту остальной схемы. Это осознанно: полный набор
// устройств — фазы P2/P3/X.

import * as ckt from './spice/ckt.js';
import { EWB_BY_ID } from './ewb-devices.js';

// ─────────────────────────── ТИПЫ РЕДАКТОРА ───────────────────────────

/**
 * Категория компонента редактора → тип устройства фасада.
 * Повторяет (и немного расширяет) `mapComponentType` из `logic/js/sim.js`,
 * включая `meter` — так парсер `.ewb` называет измерительные приборы.
 *
 * @param {string} id
 * @returns {string|null}
 */
export function mapEditorType(id) {
  const t = String(id || '').toLowerCase();
  // Основной путь — данные палитры (PartNum/ExtComp → тип), шаг 5b плана I4.
  // Незнакомые движку типы (connector/transformer/…) возвращаются как есть:
  // `sceneToDeck` отправит их в `skipped` с причиной, а не потеряет молча.
  const tile = EWB_BY_ID[t];
  if (tile && tile.device !== 'unknown') return tile.device === 'meter' ? 'instrument' : tile.device;
  // Ниже — исторические id (до шага 5b).
  if (['resistor', 'res'].includes(t)) return 'resistor';
  if (['capacitor', 'cap'].includes(t)) return 'capacitor';
  if (['inductor', 'ind'].includes(t)) return 'inductor';
  if (['diode', 'led', 'zener'].includes(t)) return 'diode';
  if (['vsource', 'generator', 'source', 'battery', 'signal', 'gens', 'funcgen'].includes(t)) return 'vsource';
  if (['isource', 'current-source', 'currentsource'].includes(t)) return 'isource';
  if (['ground', 'gnd', 'earth', 'earthing', 'point'].includes(t)) return 'ground';
  if (
    ['multimeter', 'ammeter', 'voltmeter', 'meter', 'oscilograph', 'osc',
      'logic', 'wordgen', 'bode', 'grapher', 'stenograhp', 'digital'].includes(t)
  ) return 'instrument';
  return null;
}

/** Устройство CKT по типу фасада. */
const DEVICE_MAP = {
  resistor: { dev: 'Resistor', param: 'resistance', fallback: 10 },
  capacitor: { dev: 'Capacitor', param: 'capacitance', fallback: 1e-6 },
  inductor: { dev: 'Inductor', param: 'inductance', fallback: 1e-3 },
  vsource: { dev: 'Vsource', param: 'dc', fallback: 5 },
  isource: { dev: 'Isource', param: 'dc', fallback: 0 },
};

function num(value, fallback) {
  if (value == null || value === '') return fallback;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function safeName(value, fallback) {
  const s = String(value == null ? '' : value).trim();
  // Имена узлов/элементов в CKT — произвольные строки; пробелы/двоеточия
  // заменяем, чтобы имена оставались читаемыми в отчётах и тестах.
  return (s || fallback).replace(/[\s:]+/g, '_');
}

/** Классификация прибора по id символа. */
function instrumentKind(editorId) {
  const t = String(editorId || '').toLowerCase();
  if (/ammeter|amp[-_]?meter|a[-_]?meter/.test(t)) return 'ammeter';
  if (/oscil|(?<!f)osc|scope|grapher|bode|logic|wordgen|stenograhp/.test(t)) return 'scope';
  return 'voltmeter'; // мультиметр по умолчанию — вольтметр
}

// ─────────────────────────── СЦЕНА → ДЕКА ───────────────────────────

function makeUnionFind() {
  const parent = new Map();
  const find = (k) => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) {
      parent.set(r, parent.get(parent.get(r)));
      r = parent.get(r);
    }
    return r;
  };
  return { find, union: (a, b) => parent.set(find(a), find(b)) };
}

function normalizeComponent(c, index) {
  const inst = safeName(c.inst ?? c.id, `C${index + 1}`);
  const editorId = String(c.editorId ?? c.component ?? c.id ?? '');
  const engineType = c.etype || mapEditorType(editorId) || null;
  const ports = (Array.isArray(c.ports) && c.ports.length ? c.ports : ['p1', 'p2'])
    .map((p) => String(p));
  return {
    ...c,
    inst,
    editorId,
    engineType,
    ports,
    key: (port) => `${inst}:${port}`,
  };
}

/** Список анализов по запрошенному режиму (OP всегда первым). */
function buildAnalyses(options) {
  const mode = String(options.analysis || 'op').toLowerCase();
  const list = [{ type: 'OP', name: 'op1' }];
  if (mode === 'tran') {
    const tstep = num(options.tstep, 1e-5);
    list.push({
      type: 'TRAN',
      name: 'tran1',
      params: {
        tstop: num(options.tstop, 1e-3),
        tstep,
        tmax: num(options.tmax, tstep),
      },
    });
  } else if (mode === 'ac') {
    list.push({
      type: 'AC',
      name: 'ac1',
      params: {
        start: num(options.fstart, 10),
        stop: num(options.fstop, 1e5),
        numsteps: Math.max(2, Math.floor(num(options.points, 31))),
        lin: 1,
      },
    });
  }
  return list;
}

/**
 * Преобразовать сцену редактора в деку CKT.
 *
 * @param {{components:object[], links:string[][]}} scene
 * @param {object} [options] — `{ analysis, tstop, tstep, tmax, fstart, fstop,
 *   points, defaultSourceVoltage, acmag }`
 * @returns {object} `{ error, message, deck, nets, terminalNet, ground, meters,
 *   scopes, skipped, components, warnings }`
 */
export function sceneToDeck(scene, options = {}) {
  const source = scene && typeof scene === 'object' ? scene : {};
  const components = Array.isArray(source.components)
    ? source.components.map(normalizeComponent)
    : [];
  const links = Array.isArray(source.links) ? source.links : [];
  const warnings = [];

  if (!components.length) {
    return { error: 'empty', message: 'В схеме нет компонентов', warnings };
  }

  // 1) union-find по терминалам. `links` — пары `inst:port`.
  const uf = makeUnionFind();
  for (const c of components) for (const p of c.ports) uf.find(c.key(p));
  for (const link of links) {
    if (!Array.isArray(link) || link.length < 2) continue;
    const a = String(link[0]);
    const b = String(link[1]);
    if (!a || !b) continue;
    uf.union(a, b);
  }

  // 2) земля: явный символ ground, иначе минус первого источника.
  let groundKey = null;
  for (const c of components) {
    if (c.engineType === 'ground') {
      groundKey = c.key(c.ports[0]);
      break;
    }
  }
  if (!groundKey) {
    const vs = components.find((c) => c.engineType === 'vsource' && c.ports.length >= 2);
    if (vs) groundKey = vs.key(vs.ports[1]);
  }
  if (!groundKey) {
    return {
      error: 'no-ground',
      message: 'Нет земли: добавьте компонент ground или источник напряжения',
      warnings,
    };
  }

  const groundRoot = uf.find(groundKey);
  const nameByRoot = new Map([[groundRoot, '0']]);
  const nameOf = (key) => {
    const root = uf.find(key);
    if (!nameByRoot.has(root)) nameByRoot.set(root, `n${nameByRoot.size}`);
    return nameByRoot.get(root);
  };

  // 3) элементы и приборы.
  const elements = [];
  const meters = [];
  const scopes = [];
  const skipped = [];
  const terminalNet = new Map();

  const defaultSourceVoltage = num(options.defaultSourceVoltage, 5);

  for (const c of components) {
    for (const p of c.ports) terminalNet.set(c.key(p), nameOf(c.key(p)));

    if (c.engineType === 'ground') continue;

    const nodeA = nameOf(c.key(c.ports[0]));
    const nodeB = c.ports.length >= 2 ? nameOf(c.key(c.ports[1])) : '0';

    if (c.engineType === 'instrument') {
      const kind = instrumentKind(c.editorId);
      if (kind === 'ammeter') {
        // Амперметр — 0-вольтовый источник последовательно с цепью.
        const name = safeName(`AM_${c.inst}`, `AM${meters.length + 1}`);
        elements.push({ name, dev: 'Vsource', nodes: [nodeA, nodeB], params: { dc: 0 } });
        meters.push({ inst: c.inst, kind: 'ammeter', nodeA, nodeB, element: name, unit: 'А' });
      } else {
        meters.push({
          inst: c.inst,
          kind,
          nodeA,
          nodeB,
          element: null,
          unit: kind === 'scope' ? 'В' : 'В',
        });
        if (kind === 'scope') scopes.push({ inst: c.inst, nodeA, nodeB });
      }
      continue;
    }

    const spec = DEVICE_MAP[c.engineType];
    if (!spec) {
      skipped.push({
        inst: c.inst,
        type: c.engineType || c.editorId || 'unknown',
        reason: 'устройство ещё не портировано',
      });
      continue;
    }
    if (c.ports.length < 2) {
      skipped.push({ inst: c.inst, type: c.engineType, reason: 'меньше двух выводов' });
      continue;
    }

    const rawValue = c.value != null ? c.value : c.dc;
    const fallback = c.engineType === 'vsource' ? defaultSourceVoltage : spec.fallback;
    const value = num(rawValue, fallback);

    const params = { [spec.param]: value };
    // Дополнительные параметры, если сцена их несёт (например, загруженная
    // из `.ewb` схема с PULSE/PWL/SINE).
    for (const key of ['pulse', 'sine', 'exp', 'pwl', 'sffm', 'acmag', 'acphase', 'ic']) {
      if (c[key] != null) params[key] = c[key];
    }
    elements.push({ name: c.inst, dev: spec.dev, nodes: [nodeA, nodeB], params });
  }

  // 4) AC: если у источника не задана AC-амплитуда — ставим единичную.
  const analyses = buildAnalyses(options);
  if (analyses.some((a) => a.type === 'AC')) {
    const v = elements.find((e) => e.dev === 'Vsource' && !e.element);
    if (v && v.params.acmag == null && v.params.pulse == null) {
      v.params.acmag = num(options.acmag, 1);
    }
  }

  if (!elements.length) {
    return {
      error: 'no-elements',
      message: 'В схеме нет элементов, поддерживаемых движком',
      warnings,
      skipped,
    };
  }

  // 5) Карта сетей (для отчётов/тестов).
  const netMap = new Map();
  for (const [term, net] of terminalNet) {
    if (!netMap.has(net)) netMap.set(net, []);
    netMap.get(net).push(term);
  }
  const nets = [...netMap.entries()].map(([name, terminals]) => ({ name, terminals }));

  return {
    error: null,
    message: null,
    deck: { elements, analyses },
    nets,
    terminalNet,
    ground: '0',
    meters,
    scopes,
    skipped,
    warnings,
    components,
  };
}

// ─────────────────────────── ДЕКА → CKT ───────────────────────────

/**
 * Собрать цепь CKT по деке и прогнать анализы (`CKTdoJob`).
 *
 * Формат деки совпадает с корпусом оракула (`tools/oracle/corpus/*.json`):
 * `{ elements: [{name, dev, nodes, params, modelParams}], analyses: [...] }`.
 *
 * @param {object} deck
 * @returns {{rc:number, ckt:object|null, error:string|null, message:string|null}}
 */
export function runDeck(deck) {
  const elements = deck && Array.isArray(deck.elements) ? deck.elements : [];
  const analyses = deck && Array.isArray(deck.analyses) ? deck.analyses : [];
  if (!elements.length) {
    return { rc: ckt.E_BADPARM, ckt: null, error: 'empty', message: 'Пустая дека' };
  }

  const init = ckt.cktInit();
  if (init.error) {
    return { rc: init.error, ckt: null, error: 'init', message: `CKTinit: код ${init.error}` };
  }
  const c = init.ckt;

  const nodes = new Map();
  nodes.set('0', ckt.cktGround(c, '0').node);
  const ensureNode = (name) => {
    if (nodes.has(name)) return nodes.get(name);
    const created = ckt.cktNewNode(c, name);
    if (created.error) throw new Error(`узел ${name}: код ${created.error}`);
    nodes.set(name, created.node);
    return created.node;
  };

  try {
    for (const el of elements) {
      const type = ckt.cktDevIndex(el.dev);
      if (type < 0) {
        return {
          rc: ckt.E_NODEV,
          ckt: c,
          error: 'device',
          message: `Устройство «${el.dev}» отсутствует в каталоге`,
        };
      }
      const createdModel = ckt.cktModCrt(c, type, el.modelName ?? `${el.name}_mod`);
      if (createdModel.error) {
        return {
          rc: createdModel.error,
          ckt: c,
          error: 'model',
          message: `Модель ${el.name}: код ${createdModel.error}`,
        };
      }
      const created = ckt.cktCrtElt(c, createdModel.model, el.name);
      if (created.error && created.error !== ckt.E_EXISTS) {
        return {
          rc: created.error,
          ckt: c,
          error: 'instance',
          message: `Элемент ${el.name}: код ${created.error}`,
        };
      }
      for (const [key, value] of Object.entries(el.modelParams || {})) {
        const rc = ckt.cktModParamByName(c, createdModel.model, key, value);
        if (rc) return { rc, ckt: c, error: 'model-param', message: `${el.name}.${key}: код ${rc}` };
      }
      for (const [key, value] of Object.entries(el.params || {})) {
        const rc = ckt.cktParamByName(c, created.instance, key, value);
        if (rc) return { rc, ckt: c, error: 'param', message: `${el.name}.${key}: код ${rc}` };
      }
      el.nodes.forEach((nodeName, i) => {
        const rc = ckt.cktBindNode(c, created.instance, i + 1, ensureNode(nodeName));
        if (rc) throw new Error(`${el.name} вывод ${i + 1}: код ${rc}`);
      });
    }

    const task = ckt.cktNewTask(c, 'gui').task;
    for (const an of analyses) {
      const created = ckt.cktNewAnal(c, an.type, an.name, task);
      if (created.error) {
        return {
          rc: created.error,
          ckt: c,
          error: 'analysis',
          message: `Анализ ${an.type}: код ${created.error}`,
        };
      }
      for (const [key, value] of Object.entries(an.params || {})) {
        const rc = ckt.cktSetAnalPmByName(c, created.job, key, value);
        if (rc) return { rc, ckt: c, error: 'analysis-param', message: `${an.type}.${key}: код ${rc}` };
      }
    }

    const rc = ckt.cktDoJob(c, 1, task);
    return { rc, ckt: c, error: rc ? 'analysis' : null, message: rc ? `CKTdoJob: код ${rc}` : null };
  } catch (err) {
    return { rc: ckt.E_BADPARM, ckt: c, error: 'exception', message: err.message };
  }
}

// ─────────────────────────── CKT → РЕЗУЛЬТАТ ДЛЯ UI ───────────────────────────

function isBranch(name) {
  return typeof name === 'string' && /#branch$/.test(name);
}

function branchOwner(name) {
  return String(name).replace(/#branch$/, '');
}

function pickPlot(plots, analysis) {
  const mode = String(analysis || 'op').toLowerCase();
  const byName = (re) => plots.find((p) => re.test(String(p.name || '')));
  if (mode === 'tran') return byName(/tran/i) || plots[plots.length - 1] || null;
  if (mode === 'ac') return byName(/ac/i) || plots[plots.length - 1] || null;
  return byName(/^op/i) || plots[0] || null;
}

function pointValues(plot, pointIndex) {
  const point = plot && plot.points ? plot.points[pointIndex] : null;
  if (!point || !plot) return new Map();
  return new Map(plot.names.map((name, i) => [name, point.values[i]]));
}

/** Из значения узла (число или комплекс) получить число для UI. */
function scalar(value) {
  if (Array.isArray(value)) {
    const [re, im] = value;
    return { re, im, mag: Math.hypot(re, im), phase: Math.atan2(im, re) };
  }
  return value;
}

/**
 * Превратить состояние CKT после прогона в результат для интерфейса.
 *
 * @param {object} c — цепь CKT
 * @param {object} meta — результат `sceneToDeck`
 * @param {object} [options]
 * @returns {object}
 */
export function resultFromCkt(c, meta = {}, options = {}) {
  const analysis = String(options.analysis || 'op').toLowerCase();
  const plots = Array.isArray(c && c.CKTplots) ? c.CKTplots : [];
  const plot = pickPlot(plots, analysis);
  const names = plot ? plot.names.slice() : [];
  const lastIndex = plot && plot.points.length ? plot.points.length - 1 : 0;
  const byName = pointValues(plot, lastIndex);

  const nodeVoltages = {};
  const branchCurrents = {};
  const valuesByName = {};
  for (const [name, value] of byName) {
    valuesByName[name] = scalar(value);
    if (isBranch(name)) branchCurrents[branchOwner(name)] = scalar(value);
    else nodeVoltages[name] = scalar(value);
  }

  // Приборы: вольтметр/осциллограф — разность узлов, амперметр — ток ветви.
  const readings = [];
  for (const m of meta.meters || []) {
    const va = m.nodeA === '0' ? 0 : nodeVoltages[m.nodeA];
    const vb = m.nodeB === '0' ? 0 : nodeVoltages[m.nodeB];
    const isComplex = (v) => v && typeof v === 'object' && typeof v.re === 'number';
    let value;
    if (m.kind === 'ammeter') {
      value = branchCurrents[m.element];
    } else if (isComplex(va) || isComplex(vb)) {
      const a = isComplex(va) ? va : { re: va || 0, im: 0 };
      const b = isComplex(vb) ? vb : { re: vb || 0, im: 0 };
      value = scalar([a.re - b.re, a.im - b.im]);
    } else {
      value = (va || 0) - (vb || 0);
    }
    readings.push({ ...m, value });
    valuesByName[`meter:${m.inst}`] = value;
  }

  // Ряды для осциллографа/графера.
  const series = {};
  if (plot) {
    plot.names.forEach((name, index) => {
      series[name] = plot.points.map((p) => ({
        ref: p.ref,
        value: scalar(p.values[index]),
      }));
    });
  }

  const errors = c && Array.isArray(c.CKTerrors) ? c.CKTerrors : [];
  return {
    ok: Boolean(c) && errors.every((e) => !(e.flags & 0x2)),
    analysis,
    plotName: plot ? plot.name : null,
    names,
    nodeVoltages,
    branchCurrents,
    valuesByName,
    readings,
    series,
    plots,
    errors,
    nets: meta.nets || [],
    skipped: meta.skipped || [],
    warnings: meta.warnings || [],
    deck: meta.deck || null,
    ckt: c || null,
  };
}

/**
 * Полный цикл: сцена редактора → дека → прогон → результат для UI.
 *
 * @param {object} scene — `WireSystem.scene()`
 * @param {object} [options]
 * @returns {object}
 */
export function simulateScene(scene, options = {}) {
  const meta = sceneToDeck(scene, options);
  if (meta.error) {
    return {
      ok: false,
      error: meta.error,
      message: meta.message,
      analysis: String(options.analysis || 'op').toLowerCase(),
      nodeVoltages: {},
      branchCurrents: {},
      valuesByName: {},
      readings: [],
      series: {},
      plots: [],
      errors: [],
      nets: meta.nets || [],
      skipped: meta.skipped || [],
      warnings: meta.warnings || [],
      deck: null,
      ckt: null,
    };
  }

  const run = runDeck(meta.deck);
  if (!run.ckt) {
    return {
      ok: false,
      error: run.error,
      message: run.message,
      analysis: String(options.analysis || 'op').toLowerCase(),
      nodeVoltages: {},
      branchCurrents: {},
      valuesByName: {},
      readings: [],
      series: {},
      plots: [],
      errors: [],
      nets: meta.nets,
      skipped: meta.skipped,
      warnings: meta.warnings,
      deck: meta.deck,
      ckt: null,
    };
  }

  const result = resultFromCkt(run.ckt, meta, options);
  if (run.rc) {
    result.ok = false;
    if (!result.message) result.message = run.message;
  }
  result.rc = run.rc;
  if (!result.ok && !result.message) {
    result.message = result.errors.length ? result.errors[result.errors.length - 1].message : run.message;
  }
  return result;
}

/** Форматирование значения для строки статуса (без DOM). */
export function formatValue(value, unit = 'В') {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '—';
  if (typeof value === 'object' && value.mag != null) {
    return `${formatNumber(value.mag)} ${unit} ∠${((value.phase * 180) / Math.PI).toFixed(1)}°`;
  }
  return `${formatNumber(value)} ${unit}`;
}

function formatNumber(value) {
  const abs = Math.abs(value);
  if (abs !== 0 && (abs < 1e-3 || abs >= 1e6)) return value.toExponential(3);
  return Number(value.toFixed(4)).toString();
}

export default { mapEditorType, sceneToDeck, runDeck, resultFromCkt, simulateScene, formatValue };
