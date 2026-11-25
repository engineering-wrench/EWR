/**
 * ckt.js — скелет CKT (Circuit) из SPICE3F4/XSPICE: узлы, модели, элементы,
 * задачи, реестры устройств/анализов и диспетчер анализов.
 *
 * Источники порта (1:1 по структуре и поведению):
 *   `vendor/spice3f4/src/lib/ckt/` — cktinit, cktnewn, cktneweq, cktlinkeq,
 *   cktgrnd, cktfnode, ckti2nod, cktbindn, cktnum2n, cktnames, cktnodn,
 *   cktmcrt, cktfndm, cktcrte, cktfdev, cktntask, cktnewan, cktfnda, cktsetap,
 *   cktaskaq, cktsetnp, cktasknq, cktsetup, ckttemp, cktic, cktdojob;
 *   `vendor/spice3f4/src/include/{cktdefs,ifsim,devdefs,jobdefs,optdefs}.h` —
 *   структуры и константы;
 *   `tools/oracle/golden/enum.json` — публичный каталог DLL (84 устройства,
 *   10 анализов) — источник `catalog.js`.
 *
 * Границы P1.2: здесь НЕТ Ньютона/интеграции/LTE (P1.3) и нет реализаций
 * устройств/анализов (P1.4+/P3). Хуки `SPICEdev` и `SPICEanalysis` объявлены
 * (null) и вызываются диспетчером — это точки расширения следующих фаз.
 * Анализам-заглушкам соответствует `an_func = analysisNotImplemented`
 * (возвращает E_UNSUPP и заполняет `ckt.errMsg`), чтобы «пустой» прогон нельзя
 * было спутать с успешным расчётом.
 *
 * Соглашения JS-порта (см. также `sparse.js`, `ni.js`):
 *  - поля структур сохраняют имена C (`CKTnodes`, `GENinstances`, `TSKtrtol`…);
 *  - «выходные параметры» C (`GENERIC **node`, `int *type`) возвращаются
 *    объектом `{ error, ... }`; функции-действия (`cktDoJob`, `cktSetup`, …)
 *    возвращают просто код ошибки, как в C;
 *  - `MALLOC` в F4 = zeroed-память ⇒ все поля явно инициализированы нулями/null;
 *  - `IFuid` в C — интернированный указатель, в JS — строка; сравнение имён
 *    поэтому побайтовое (`===`), как `strcmp`/сравнение указателей у фронтенда;
 *  - ошибки — коды `iferrmsg.h` (`E_*`), текст — в `ckt.errMsg`/`ckt.errRtn`.
 */

import {
  OK,
  E_NOMEM,
  E_BADMATRIX,
  SMPmatSize,
  SMPmakeElt,
  SMPclear,
  SMPcClear,
} from './sparse.js';
import {
  niInit,
  niReinit,
  niDestroy,
  NIUNINITIALIZED,
  E_ITERLIM,
  E_ORDER,
  E_METHOD,
} from './ni.js';
import {
  DEVICES as CATALOG_DEVICES,
  ANALYSES as CATALOG_ANALYSES,
} from './catalog.js';
import { installDevices } from './devices/index.js';
import { installAnalyses } from './analyses/index.js';

export { OK, E_NOMEM, E_BADMATRIX, E_ITERLIM, E_ORDER, E_METHOD };

// ─────────────────────────── КОДЫ ОШИБОК (iferrmsg.h) ───────────────────────────

export const E_PANIC = 1; // E_INTERN
export const E_EXISTS = 2;
export const E_NODEV = 3;
export const E_NOMOD = 4;
export const E_NOANAL = 5;
export const E_NOTERM = 6;
export const E_BADPARM = 7;
export const E_NODECON = 9;
export const E_UNSUPP = 10;
export const E_PARMVAL = 11;
export const E_NOTEMPTY = 12;
export const E_NOCHANGE = 13;
export const E_NOTFOUND = 14;
export const E_BAD_DOMAIN = 15;
/** `E_TIMESTEP` (sperror.h, E_PRIVATE+6): transient timestep too small. */
export const E_TIMESTEP = 106;
/** `E_PAUSE` (iferrmsg.h): analysis paused by frontend. */
export const E_PAUSE = -1;

// ─────────────────────────── КОНСТАНТЫ (cktdefs.h / jobdefs.h) ───────────────────────────

/** Типы уравнений узла. */
export const SP_VOLTAGE = 3;
export const SP_CURRENT = 4;

/** Параметры узла (cktdefs.h). */
export const PARM_NS = 1;
export const PARM_IC = 2;
export const PARM_NODETYPE = 3;

/** Методы интегрирования. */
export const TRAPEZOIDAL = 1;
export const GEAR = 2;

/** `HUGE` из `hw_ieee.h` (F4); в XSPICE `prefixcms.h` — 1e31. */
export const HUGE = 1.8e308;

/** Домены анализа (jobdefs.h). */
export const NODOMAIN = 0;
export const TIMEDOMAIN = 1;
export const FREQUENCYDOMAIN = 2;
export const SWEEPDOMAIN = 3;

/** Биты `CKTmode` (cktdefs.h). */
export const MODE = 0x3;
export const MODETRAN = 0x1;
export const MODEAC = 0x2;
export const MODEDC = 0x70;
export const MODEDCOP = 0x10;
export const MODETRANOP = 0x20;
export const MODEDCTRANCURVE = 0x40;
export const INITF = 0x3f00;
export const MODEINITFLOAT = 0x100;
export const MODEINITJCT = 0x200;
export const MODEINITFIX = 0x400;
export const MODEINITSMSIG = 0x800;
export const MODEINITTRAN = 0x1000;
export const MODEINITPRED = 0x2000;
export const MODEUIC = 0x10000;

/** Флаги `IFerror` (ifsim.h). */
export const ERR_WARNING = 0x1;
export const ERR_FATAL = 0x2;
export const ERR_INFO = 0x8;

/** `CONSTKoverQ` из `XSPIinit` (снято пробой глобалов DLL: 0x544e3c). */
export const CONSTKoverQ = 8.6170869180581252e-5;

// ─────────────────────────── РЕЕСТР УСТРОЙСТВ (SPICEdev) ───────────────────────────

/**
 * Устройства движка: метаданные из `catalog.js` (снимок DLL) + хуки `SPICEdev`
 * (`devdefs.h`). Хуки пока `null`: их заполняют фазы P1.4–P2 (R/C/L/V/I, диод,
 * BJT, …), XSPICE код-модели — фаза X.
 *
 * Контракты хуков (сигнатуры C сохранены, «указатели» заменены значениями):
 *  - `DEVnewModel(model)` / `DEVnewInstance(inst)` — инициализация
 *    device-специфичных полей (в C — zeroed-MALLOC в `CKTmodCrt`/`CKTcrtElt`);
 *  - `DEVparam(param, value, inst, selector)` / `DEVmodParam(param, value,
 *    model)` — установка параметров (C: `CKTparam`/`CKTmodParam`);
 *  - `DEVsetup(matrix, model, ckt, state)` — `state` = `{ value }`, аналог `int*`
 *    (число состояний); возвращает код ошибки;
 *  - `DEVtemperature(model, ckt)`, `DEVload(model, ckt)`, `DEVacLoad(model, ckt)`,
 *    `DEVunsetup(model, ckt)`, `DEVtrunc(model, ckt, timePtr)`, … — код ошибки;
 *  - `DEVdestroy(ckt, type)` — удалить все модели/инстансы типа (в C —
 *    `GENmodel**`, в JS тип+каталог; используется только `cktDestroy`).
 */
export const DEVICES = CATALOG_DEVICES.map((d) => ({
  ...d,
  // В C структуры model/instance выделяются zeroed-MALLOC'ом, поэтому
  // device-специфичные поля начинаются с нулей. В JS эти два хука дают
  // устройству возможность проставить начальные значения полей.
  DEVnewModel: null,
  DEVnewInstance: null,
  DEVparam: null,
  DEVmodParam: null,
  DEVload: null,
  DEVsetup: null,
  DEVunsetup: null,
  DEVpzSetup: null,
  DEVtemperature: null,
  DEVtrunc: null,
  DEVfindBranch: null,
  DEVacLoad: null,
  DEVaccept: null,
  DEVdestroy: null,
  DEVmodDelete: null,
  DEVdelete: null,
  DEVsetic: null,
  DEVask: null,
  DEVmodAsk: null,
  DEVpzLoad: null,
  DEVconvTest: null,
}));

// P1.4: подключить реализации устройств (res/cap/ind/mutual/vsrc/isrc/sw/csw).
installDevices(DEVICES);

/** Число устройств (C: `DEVmaxnum`). */
export const DEVmaxnum = DEVICES.length;

/**
 * Индекс устройства по точному имени (`CKTtypelook`: `strcmp`).
 * Имена регистрозависимы; в каталоге есть пары-омонимы
 * (`Capacitor`/`capacitor`, `Inductor`/`inductor`) — это разные устройства DLL.
 *
 * @param {string} name
 * @returns {number} индекс или -1
 */
export function cktDevIndex(name) {
  for (let i = 0; i < DEVmaxnum; i++) {
    if (DEVICES[i].name === name) return i;
  }
  return -1;
}

// ─────────────────────────── РЕЕСТР АНАЛИЗОВ (SPICEanalysis) ───────────────────────────

/**
 * Домены/`do_ic` из F4 (`vendor/spice3f4/src/lib/ckt/*setp*.c`, `cktsopt.c`).
 * Индекс — тип задачи DLL (порядок `analInfo` = порядок `enum.json`).
 */
const ANALYSIS_DEFAULTS = [
  { domain: NODOMAIN, do_ic: 0 }, // 0 options
  { domain: FREQUENCYDOMAIN, do_ic: 1 }, // 1 AC
  { domain: SWEEPDOMAIN, do_ic: 1 }, // 2 DC
  { domain: NODOMAIN, do_ic: 1 }, // 3 OP
  { domain: TIMEDOMAIN, do_ic: 1 }, // 4 TRAN
  { domain: NODOMAIN, do_ic: 1 }, // 5 PZ
  { domain: NODOMAIN, do_ic: 0 }, // 6 TF
  { domain: FREQUENCYDOMAIN, do_ic: 1 }, // 7 DISTO
  { domain: FREQUENCYDOMAIN, do_ic: 1 }, // 8 NOISE
  { domain: FREQUENCYDOMAIN, do_ic: 1 }, // 9 SENS
];

/**
 * Заглушка анализа: вызывается диспетчером, но расчёт не реализован.
 * Возвращает E_UNSUPP и пишет понятную ошибку в `ckt.errMsg`.
 */
function analysisNotImplemented(ckt) {
  const job = ckt.CKTcurJob;
  const info = job ? ANALYSES[job.JOBtype] : null;
  const name = info ? `"${info.name}"` : `type ${job ? job.JOBtype : '?'}`;
  return fail(
    ckt,
    E_UNSUPP,
    'CKTdoJob',
    `analysis ${name} is not implemented yet (P1.2 CKT skeleton; см. PLAN-CLONE P1.6/P3)`,
  );
}

/**
 * Анализы движка: метаданные из `catalog.js` + поля `SPICEanalysis`
 * (`jobdefs.h`). `an_init`/`an_func`/`setParm`/`askQuest` — изменяемые хуки:
 * их выставляют модули анализов (`Site/engine/spice/analyses/*`, фазы P1.6/P3)
 * через `cktSetAnalysisImpl` (или напрямую, как глобальную таблицу `analInfo`).
 */
export const ANALYSES = CATALOG_ANALYSES.map((a) => {
  const defaults = ANALYSIS_DEFAULTS[a.index] || { domain: NODOMAIN, do_ic: 0 };
  return {
    ...a,
    size: 0,
    domain: defaults.domain,
    do_ic: defaults.do_ic,
    an_init: null,
    // options (type 0) в C тоже имеет an_func = NULL и никогда не попадает
    // в список job'ов (CKTnewAnal type 0 возвращает саму task).
    an_func: a.index === 0 ? null : analysisNotImplemented,
    setParm: null,
    askQuest: null,
  };
});

// P1.6: подключить реализации анализов (OP/TRAN).
installAnalyses(ANALYSES);

/** Число анализов (C: `ANALmaxnum`). */
export const ANALmaxnum = ANALYSES.length;

/**
 * Тип анализа по имени (регистронезависимо — удобство фронтенда; сам C
 * `CKTnewAnal` принимает только индекс) или по числу.
 *
 * @param {string|number} type
 * @returns {number} индекс или -1
 */
export function cktAnalIndex(type) {
  if (typeof type === 'number') {
    return Number.isInteger(type) && type >= 0 && type < ANALmaxnum ? type : -1;
  }
  if (typeof type === 'string') {
    const lower = type.toLowerCase();
    for (let i = 0; i < ANALmaxnum; i++) {
      if (ANALYSES[i].name.toLowerCase() === lower) return i;
    }
  }
  return -1;
}

/**
 * Подменить реализацию анализа (аналог заполнения `analInfo[type]` в C).
 * Принимает `{ an_init, an_func, setParm, askQuest, do_ic, domain, size }`.
 *
 * @param {string|number} type
 * @param {object} impl
 * @returns {{error:number, errMsg?:string}}
 */
export function cktSetAnalysisImpl(type, impl) {
  const idx = cktAnalIndex(type);
  if (idx < 0) {
    return { error: E_BADPARM, errMsg: `unknown analysis type: ${type}` };
  }
  Object.assign(ANALYSES[idx], impl);
  return { error: OK };
}

// ─────────────────────────── СЛУЖЕБНОЕ ───────────────────────────

/**
 * Записать ошибку в circuit (аналог глобалов `errMsg`/`errRtn` из C, но
 * привязано к цепи — так тесты и параллельные прогоны не мешают друг другу).
 */
function fail(ckt, code, routine, message) {
  if (ckt) {
    ckt.errRtn = routine;
    ckt.errMsg = message;
  }
  return code;
}

/** Монопонические секунды для статистики (C: `IFseconds` фронтенда). */
function nowSeconds() {
  const perf = globalThis.performance;
  if (perf && typeof perf.now === 'function') return perf.now() / 1000;
  return Date.now() / 1000;
}

/** STATistics (optdefs.h) — нули, как zeroed-MALLOC. */
function newStatistics() {
  return {
    STATnumIter: 0,
    STATtranIter: 0,
    STAToldIter: 0,
    STATtimePts: 0,
    STATaccepted: 0,
    STATrejected: 0,
    STATtotAnalTime: 0,
    STATtranTime: 0,
    STATloadTime: 0,
    STATdecompTime: 0,
    STATsolveTime: 0,
    STATreorderTime: 0,
    STATtranDecompTime: 0,
    STATtranSolveTime: 0,
  };
}

/** Новый узел (CKTnode); zeroed-поля как в C. */
function newNode(name) {
  return {
    name: name ?? null,
    type: SP_VOLTAGE,
    number: 0,
    ic: 0,
    nodeset: 0,
    ptr: null,
    next: null,
    icGiven: false,
    nsGiven: false,
  };
}

/** Новый инстанс (GENinstance). */
function newInstance(name, model) {
  return {
    GENmodPtr: model,
    GENnextInstance: null,
    GENname: name,
    GENstate: 0,
    GENnode1: 0,
    GENnode2: 0,
    GENnode3: 0,
    GENnode4: 0,
    GENnode5: 0,
  };
}

/** Новая модель (GENmodel). */
function newModel(type, name) {
  return {
    GENmodType: type,
    GENnextModel: null,
    GENinstances: null,
    GENmodName: name ?? null,
  };
}

// ─────────────────────────── ЦЕПЬ ───────────────────────────

/**
 * CKTinit — создать цепь. Порт `cktinit.c` (F4) + `NIinit`: матрица создаётся
 * сразу, все опции — дефолты F4 (task-дефолты, отличающиеся `trtol`, ставит
 * `CKTdoJob`; публичный дефолт DLL — `trtol=1.0`, см. engine-behavior §4.2).
 *
 * @returns {{error:number, ckt:object|null}}
 */
export function cktInit() {
  const ckt = {
    CKThead: new Array(DEVmaxnum).fill(null),
    CKTstat: newStatistics(),
    CKTstates: new Array(8).fill(null),
    CKTtime: 0,
    CKTdelta: 0,
    CKTdeltaOld: new Float64Array(7),
    CKTtemp: 300.15,
    CKTnomTemp: 300.15,
    CKTvt: 0,
    CKTag: new Float64Array(7),
    CKTorder: 1,
    CKTmaxOrder: 2,
    CKTintegrateMethod: TRAPEZOIDAL,
    CKTmatrix: null,
    CKTniState: 0,
    CKTrhs: null,
    CKTrhsOld: null,
    CKTrhsSpare: null,
    CKTirhs: null,
    CKTirhsOld: null,
    CKTirhsSpare: null,
    CKTrhsOp: null,
    CKTsenRhs: null,
    CKTseniRhs: null,
    CKTmaxEqNum: 1,
    CKTcurrentAnalysis: 0,
    CKTnodes: null,
    CKTlastNode: null,
    CKTnumStates: 0,
    CKTmode: 0,
    CKTbypass: 1,
    CKTdcMaxIter: 100,
    CKTdcTrcvMaxIter: 50,
    CKTtranMaxIter: 10,
    CKTbreakSize: 0,
    CKTbreak: 0,
    CKTsaveDelta: 0,
    CKTminBreak: 0,
    CKTbreaks: null,
    CKTabstol: 1e-12,
    CKTpivotAbsTol: 1e-13,
    CKTpivotRelTol: 1e-3,
    CKTreltol: 1e-3,
    CKTchgtol: 1e-14,
    CKTvoltTol: 1e-6,
    CKTgmin: 1e-12,
    CKTdelmin: 0,
    CKTtrtol: 7,
    CKTfinalTime: 0,
    CKTstep: 0,
    CKTmaxStep: 0,
    CKTinitTime: 0,
    CKTomega: 0,
    CKTsrcFact: 1,
    CKTdiagGmin: 0,
    CKTnumSrcSteps: 10,
    CKTnumGminSteps: 10,
    CKTnoncon: 0,
    CKTdefaultMosL: 1e-4,
    CKTdefaultMosW: 1e-4,
    CKTdefaultMosAD: 0,
    CKTdefaultMosAS: 0,
    CKThadNodeset: 0,
    CKTfixLimit: 0,
    CKTnoOpIter: 0,
    CKTisSetup: 0,
    CKTtryToCompact: 0,
    CKTbadMos3: 0,
    CKTkeepOpInfo: 0,
    CKTcurJob: null,
    CKTsenInfo: null,
    CKTtimePoints: null,
    CKTdeltaList: null,
    CKTtimeListSize: 0,
    CKTtimeIndex: 0,
    CKTsizeIncr: 0,
    CKTtroubleNode: 0,
    CKTtroubleElt: null,
    // выходной «фронтенд» (в C — SPfrontEnd->OUTp*): см. cktOut* ниже
    CKTplots: [],
    CKTnextPlotId: 1,
    CKTopenPlots: [],
    CKTerrors: [],
    CKTsteps: [],
    // диагностика (в C — глобалы errMsg/errRtn)
    errMsg: null,
    errRtn: null,
  };

  const error = niInit(ckt);
  if (error) {
    return { error: fail(ckt, error, 'CKTinit', 'NIinit: cannot allocate matrix'), ckt };
  }
  return { error: OK, ckt };
}

/**
 * CKTdestroy — освободить цепь: хуки `DEVdestroy`, состояния, матрица, узлы.
 * Порт `cktdest.c` (без SEN-части — P3).
 *
 * @param {object} ckt
 * @returns {number} код ошибки
 */
export function cktDestroy(ckt) {
  if (!ckt) return E_BADPARM;
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVdestroy && ckt.CKThead[i] !== null) {
      dev.DEVdestroy(ckt, i);
    }
    ckt.CKThead[i] = null;
  }
  for (let i = 0; i < ckt.CKTstates.length; i++) ckt.CKTstates[i] = null;
  niDestroy(ckt);
  ckt.CKTbreaks = null;
  ckt.CKTbreakSize = 0;
  ckt.CKTnodes = null;
  ckt.CKTlastNode = null;
  ckt.CKTmaxEqNum = 1;
  ckt.CKTisSetup = 0;
  ckt.CKTcurJob = null;
  return OK;
}

// ─────────────────────────── УЗЛЫ ───────────────────────────

/**
 * CKTground — назначить узел земли (номер 0). Порт `cktgrnd.c`:
 * если земля уже названа — старое имя сохраняется, возвращается E_EXISTS.
 *
 * @param {object} ckt
 * @param {string|null} name
 * @returns {{error:number, node:object|null}}
 */
export function cktGround(ckt, name) {
  if (!ckt) return { error: E_BADPARM, node: null };
  if (ckt.CKTnodes) {
    if (ckt.CKTnodes.name !== null) {
      return { error: E_EXISTS, node: ckt.CKTnodes };
    }
    ckt.CKTnodes.name = name ?? null;
    ckt.CKTnodes.type = SP_VOLTAGE;
    ckt.CKTnodes.number = 0;
    return { error: OK, node: ckt.CKTnodes };
  }
  const node = newNode(name);
  node.number = 0;
  ckt.CKTnodes = node;
  ckt.CKTlastNode = node;
  return { error: OK, node };
}

/**
 * CKTnewNode — добавить узел напряжения. Порт `cktnewn.c`: при первом вызове
 * неявно создаётся земля (номер 0, имя null), новый узел получает
 * `CKTmaxEqNum++`.
 *
 * @param {object} ckt
 * @param {string} name
 * @returns {{error:number, node:object|null}}
 */
export function cktNewNode(ckt, name) {
  if (!ckt) return { error: E_BADPARM, node: null };
  if (!ckt.CKTnodes) {
    const ground = newNode(null);
    ground.number = 0;
    ckt.CKTnodes = ground;
    ckt.CKTlastNode = ground;
  }
  const node = newNode(name);
  ckt.CKTlastNode.next = node;
  ckt.CKTlastNode = node;
  node.number = ckt.CKTmaxEqNum++;
  return { error: OK, node };
}

/**
 * CKTmkNode — «черновой» узел без номера (порт `cktmknod.c`).
 * @returns {{error:number, node:object|null}}
 */
export function cktMkNode() {
  return { error: OK, node: newNode(null) };
}

/**
 * CKTlinkEq — включить готовый узел в список уравнений и выдать номер.
 * Порт `cktlnkeq.c` (при пустом списке сначала создаётся земля).
 *
 * @returns {number} код ошибки
 */
export function cktLinkEq(ckt, node) {
  if (!ckt) return E_BADPARM;
  if (!ckt.CKTnodes) {
    const ground = newNode(null);
    ground.number = 0;
    ckt.CKTnodes = ground;
    ckt.CKTlastNode = ground;
  }
  if (!node) return E_BADPARM;
  ckt.CKTlastNode.next = node;
  ckt.CKTlastNode = node;
  node.number = ckt.CKTmaxEqNum++;
  node.next = null;
  return OK;
}

/**
 * CKTnewEq — создать узел/уравнение по имени (порт `cktneweq.c`).
 * @returns {{error:number, node:object|null}}
 */
export function cktNewEq(ckt, name) {
  if (!ckt) return { error: E_BADPARM, node: null };
  const { error, node } = cktMkNode();
  if (error) return { error, node: null };
  node.name = name ?? null;
  const linkError = cktLinkEq(ckt, node);
  return { error: linkError, node: linkError ? null : node };
}

/**
 * Уникальное имя ветви в стиле фронтенда SPICE (`V1#branch`).
 * В C имя выдаёт `IFnewUid(basename, suffix)`; при совпадении добавляем
 * числовой суффикс, чтобы список узлов оставался однозначным.
 */
function uniqueBranchName(ckt, basename, suffix) {
  const base = `${basename ?? 'auto'}#${suffix ?? 'branch'}`;
  let name = base;
  let n = 2;
  for (;;) {
    let taken = false;
    for (let here = ckt.CKTnodes; here; here = here.next) {
      if (here.name === name) {
        taken = true;
        break;
      }
    }
    if (!taken) return name;
    name = `${base}_${n++}`;
  }
}

/**
 * CKTmkCur — создать уравнение тока (ветвь) с именем `<basename>#<suffix>`.
 * Порт `cktmkcur.c`: узел типа `SP_CURRENT` и `CKTlinkEq`.
 *
 * @returns {{error:number, node:object|null}}
 */
export function cktMkCur(ckt, basename, suffix) {
  if (!ckt) return { error: E_BADPARM, node: null };
  const made = cktMkNode();
  if (made.error) return made;
  const node = made.node;
  node.name = uniqueBranchName(ckt, basename, suffix);
  node.type = SP_CURRENT;
  const error = cktLinkEq(ckt, node);
  return { error, node: error ? null : node };
}

/**
 * CKTmkVolt — создать внутренний узел типа `SP_VOLTAGE` с именем
 * `<basename>#<suffix>` (порт `cktmkvol.c`; в DLL суффикс — `"internal"`,
 * используется диодом при `rs != 0`).
 *
 * @returns {{error:number, node:object|null}}
 */
export function cktMkVolt(ckt, basename, suffix) {
  if (!ckt) return { error: E_BADPARM, node: null };
  const made = cktMkNode();
  if (made.error) return made;
  const node = made.node;
  node.name = uniqueBranchName(ckt, basename, suffix);
  node.type = SP_VOLTAGE;
  const error = cktLinkEq(ckt, node);
  return { error, node: error ? null : node };
}

/**
 * CKTdltNNum — удалить узел/уравнение по номеру (порт `cktdltn.c`).
 * Уменьшает `CKTmaxEqNum`; номера оставшихся узлов не перенумеровываются
 * (как в C).
 *
 * @returns {number} код ошибки
 */
export function cktDltNNum(ckt, num) {
  if (!ckt) return E_BADPARM;
  let prev = null;
  let found = null;
  let foundPrev = null;
  for (let here = ckt.CKTnodes; here; here = here.next) {
    if (here.number === num) {
      found = here;
      foundPrev = prev;
    }
    prev = here;
  }
  if (!found) return OK;

  ckt.CKTmaxEqNum -= 1;
  if (!foundPrev) ckt.CKTnodes = found.next;
  else foundPrev.next = found.next;
  if (found === ckt.CKTlastNode) ckt.CKTlastNode = foundPrev;
  return OK;
}

/**
 * CKTfndBranch — найти номер ветви по имени управляющего источника.
 * Порт `cktfbran.c`: перебирает `DEVfindBranch` всех устройств.
 *
 * @returns {number} номер ветви или 0
 */
export function cktFndBranch(ckt, name) {
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVfindBranch && ckt.CKThead[i] !== null) {
      const j = dev.DEVfindBranch(ckt, ckt.CKThead[i], name);
      if (j !== 0) return j;
    }
  }
  return 0;
}

/**
 * CKTfndNode — найти узел по имени. Порт `cktfnode.c`.
 * @returns {{error:number, node:object|null}}
 */
export function cktFindNode(ckt, name) {
  if (!ckt) return { error: E_BADPARM, node: null };
  for (let here = ckt.CKTnodes; here; here = here.next) {
    if (here.name === name) return { error: OK, node: here };
  }
  return { error: E_NOTFOUND, node: null };
}

/**
 * CKTnum2nod — найти узел по номеру. Порт `cktnum2n.c`.
 * @returns {object|null}
 */
export function cktNum2Nod(ckt, number) {
  if (!ckt) return null;
  for (let here = ckt.CKTnodes; here; here = here.next) {
    if (here.number === number) return here;
  }
  return null;
}

/**
 * CKTnodName — имя узла по номеру; `"UNKNOWN NODE"` как в C. Порт `cktnodn.c`.
 * @returns {string}
 */
export function cktNodeName(ckt, number) {
  const node = cktNum2Nod(ckt, number);
  return node && node.name !== null ? node.name : 'UNKNOWN NODE';
}

/**
 * CKTnames — имена всех узлов, кроме земли (порядок списка CKTnodes).
 * Порт `cktnames.c`: `numNames = CKTmaxEqNum - 1`.
 *
 * @returns {{error:number, names:string[]}}
 */
export function cktNames(ckt) {
  if (!ckt) return { error: E_BADPARM, names: [] };
  const names = [];
  if (!ckt.CKTnodes) return { error: OK, names };
  for (let here = ckt.CKTnodes.next; here; here = here.next) {
    names.push(here.name);
  }
  return { error: OK, names };
}

/**
 * CKTbindNode — привязать вывод устройства к узлу. Порт `cktbindn.c`:
 * проверяется только число выводов устройства (`DEVpublic.terms`).
 *
 * @returns {number} код ошибки
 */
export function cktBindNode(ckt, fast, term, node) {
  if (!fast || !fast.GENmodPtr) return E_BADPARM;
  const type = fast.GENmodPtr.GENmodType;
  if (!DEVICES[type]) return E_BADPARM;
  if (!node) return E_BADPARM;
  const mappednode = node.number;
  if (DEVICES[type].terms >= term && term > 0) {
    switch (term) {
      case 1: fast.GENnode1 = mappednode; break;
      case 2: fast.GENnode2 = mappednode; break;
      case 3: fast.GENnode3 = mappednode; break;
      case 4: fast.GENnode4 = mappednode; break;
      case 5: fast.GENnode5 = mappednode; break;
      default: return E_NOTERM;
    }
    return OK;
  }
  return E_NOTERM;
}

/**
 * CKTinst2Node — узел и его имя по устройству и номеру вывода.
 * Порт `ckti2nod.c`.
 *
 * @returns {{error:number, node:object|null, nodeName:string|null}}
 */
export function cktInst2Node(ckt, instPtr, terminal) {
  if (!ckt || !instPtr || !instPtr.GENmodPtr) {
    return { error: E_BADPARM, node: null, nodeName: null };
  }
  const type = instPtr.GENmodPtr.GENmodType;
  if (!DEVICES[type] || !(DEVICES[type].terms >= terminal && terminal > 0)) {
    return { error: E_NOTERM, node: null, nodeName: null };
  }
  let nodenum;
  switch (terminal) {
    case 1: nodenum = instPtr.GENnode1; break;
    case 2: nodenum = instPtr.GENnode2; break;
    case 3: nodenum = instPtr.GENnode3; break;
    case 4: nodenum = instPtr.GENnode4; break;
    case 5: nodenum = instPtr.GENnode5; break;
    default: return { error: E_NOTERM, node: null, nodeName: null };
  }
  for (let here = ckt.CKTnodes; here; here = here.next) {
    if (here.number === nodenum) {
      return { error: OK, node: here, nodeName: here.name };
    }
  }
  return { error: E_NOTFOUND, node: null, nodeName: null };
}

/**
 * CKTsetNodPm — параметры узла: `nodeset`/`ic`/`type`. Порт `cktsetnp.c`.
 * Значение в C — union `IFvalue`; здесь передаётся числом напрямую.
 *
 * @returns {number} код ошибки
 */
export function cktSetNodPm(ckt, node, parm, value) {
  if (!node) return E_BADPARM;
  switch (parm) {
    case PARM_NS:
      node.nodeset = value;
      node.nsGiven = true;
      return OK;
    case PARM_IC:
      node.ic = value;
      node.icGiven = true;
      return OK;
    case PARM_NODETYPE:
      node.type = value;
      return OK;
    default:
      return E_BADPARM;
  }
}

/**
 * CKTaskNodQst — спросить параметр узла. Порт `cktasknq.c`.
 * @returns {{error:number, value:number|undefined}}
 */
export function cktAskNodQst(ckt, node, parm) {
  if (!node) return { error: E_BADPARM, value: undefined };
  switch (parm) {
    case PARM_NS: return { error: OK, value: node.nodeset };
    case PARM_IC: return { error: OK, value: node.ic };
    case PARM_NODETYPE: return { error: OK, value: node.type };
    default: return { error: E_BADPARM, value: undefined };
  }
}

// ─────────────────────────── ПАРАМЕТРЫ УСТРОЙСТВ ───────────────────────────

/**
 * Индекс параметра инстанса по ключевому слову (`instanceParms` из каталога).
 * В C это делает фронтенд, перебирая `IFparm`-таблицу устройства.
 *
 * @param {number} type
 * @param {string} keyword
 * @returns {number} id параметра или -1
 */
export function cktParamIndex(type, keyword) {
  const dev = DEVICES[type];
  if (!dev || !Array.isArray(dev.instanceParms)) return -1;
  for (const p of dev.instanceParms) {
    if (p.keyword === keyword) return p.id;
  }
  return -1;
}

/**
 * Индекс параметра модели по ключевому слову (`modelParms` каталога).
 *
 * @param {number} type
 * @param {string} keyword
 * @returns {number} id параметра или -1
 */
export function cktModParamIndex(type, keyword) {
  const dev = DEVICES[type];
  if (!dev || !Array.isArray(dev.modelParms)) return -1;
  for (const p of dev.modelParms) {
    if (p.keyword === keyword) return p.id;
  }
  return -1;
}

/**
 * CKTparam — установить параметр инстанса (порт `cktparam.c`).
 * Значение — «сырое» JS-значение: число, строка (имя) или массив (вектор).
 *
 * @returns {number} код ошибки
 */
export function cktParam(ckt, fast, param, value, selector = null) {
  if (!fast || !fast.GENmodPtr) return E_BADPARM;
  const type = fast.GENmodPtr.GENmodType;
  const dev = DEVICES[type];
  if (!dev || !dev.DEVparam) return E_BADPARM;
  return dev.DEVparam(param, value, fast, selector);
}

/**
 * CKTmodParam — установить параметр модели (порт `cktmpar.c`).
 *
 * @returns {number} код ошибки
 */
export function cktModParam(ckt, modfast, param, value, selector = null) {
  if (!modfast) return E_BADPARM;
  const type = modfast.GENmodType;
  const dev = DEVICES[type];
  if (!dev || !dev.DEVmodParam) return E_BADPARM;
  return dev.DEVmodParam(param, value, modfast, selector);
}

/**
 * Установить параметр инстанса по ключевому слову (удобный фасад для тестов
 * и будущего `.ewb`-фронтенда). Неизвестное слово → E_BADPARM.
 */
export function cktParamByName(ckt, fast, keyword, value) {
  if (!fast || !fast.GENmodPtr) return E_BADPARM;
  const param = cktParamIndex(fast.GENmodPtr.GENmodType, keyword);
  if (param < 0) return E_BADPARM;
  return cktParam(ckt, fast, param, value);
}

/** Установить параметр модели по ключевому слову. */
export function cktModParamByName(ckt, modfast, keyword, value) {
  if (!modfast) return E_BADPARM;
  const param = cktModParamIndex(modfast.GENmodType, keyword);
  if (param < 0) return E_BADPARM;
  return cktModParam(ckt, modfast, param, value);
}

// ─────────────────────────── МОДЕЛИ И ЭЛЕМЕНТЫ ───────────────────────────

/**
 * CKTfndMod — найти модель по типу и/или имени. Порт `cktfndm.c`.
 * `type = -1` — искать по всем типам (найденный тип возвращается).
 *
 * @param {object} ckt
 * @param {{type?:number, modfast?:object|null, modname?:string|null}} opts
 * @returns {{error:number, type:number, model:object|null}}
 */
export function cktFindMod(ckt, opts = {}) {
  if (!ckt) return { error: E_BADPARM, type: -1, model: null };
  let type = opts.type ?? -1;
  const modfast = opts.modfast ?? null;
  const modname = opts.modname ?? null;

  if (modfast !== null) {
    return { error: OK, type: modfast.GENmodType, model: modfast };
  }
  if (type >= 0 && type < DEVmaxnum) {
    for (let mods = ckt.CKThead[type]; mods; mods = mods.GENnextModel) {
      if (mods.GENmodName === modname) {
        return { error: OK, type, model: mods };
      }
    }
    return { error: E_NOMOD, type, model: null };
  }
  if (type === -1) {
    for (type = 0; type < DEVmaxnum; type++) {
      for (let mods = ckt.CKThead[type]; mods; mods = mods.GENnextModel) {
        if (mods.GENmodName === modname) {
          return { error: OK, type, model: mods };
        }
      }
    }
    return { error: E_NOMOD, type: -1, model: null };
  }
  return { error: E_BADPARM, type, model: null };
}

/**
 * CKTmodCrt — создать модель типа `type` с именем `name` (или вернуть
 * существующую с E_EXISTS). Порт `cktmcrt.c`.
 *
 * @returns {{error:number, model:object|null}}
 */
export function cktModCrt(ckt, type, name) {
  if (!ckt) return { error: E_BADPARM, model: null };
  if (!Number.isInteger(type) || type < 0 || type >= DEVmaxnum) {
    return { error: fail(ckt, E_BADPARM, 'CKTmodCrt', `unknown device type: ${type}`), model: null };
  }
  const found = cktFindMod(ckt, { type, modname: name ?? null });
  if (found.error === E_NOMOD) {
    const model = newModel(type, name);
    const dev = DEVICES[type];
    if (dev.DEVnewModel) dev.DEVnewModel(model);
    model.GENnextModel = ckt.CKThead[type];
    ckt.CKThead[type] = model;
    return { error: OK, model };
  }
  if (found.error === OK) {
    return { error: E_EXISTS, model: found.model };
  }
  return { error: found.error, model: null };
}

/**
 * CKTfndDev — найти инстанс по имени (в модели/типе/по всем типам).
 * Порт `cktfdev.c`. `fast` (готовый инстанс) имеет приоритет.
 *
 * @param {object} ckt
 * @param {{type?:number, fast?:object|null, name?:string, modfast?:object|null, modname?:string|null}} opts
 * @returns {{error:number, type:number, instance:object|null}}
 */
export function cktFindDev(ckt, opts = {}) {
  if (!ckt) return { error: E_BADPARM, type: -1, instance: null };
  let type = opts.type ?? -1;
  const fast = opts.fast ?? null;
  const name = opts.name;
  const modfast = opts.modfast ?? null;
  const modname = opts.modname ?? null;

  if (fast !== null) {
    return { error: OK, type: fast.GENmodPtr.GENmodType, instance: fast };
  }
  if (modfast !== null) {
    for (let here = modfast.GENinstances; here; here = here.GENnextInstance) {
      if (here.GENname === name) {
        return { error: OK, type: modfast.GENmodType, instance: here };
      }
    }
    return { error: E_NODEV, type: modfast.GENmodType, instance: null };
  }
  if (type >= 0 && type < DEVmaxnum) {
    for (let mods = ckt.CKThead[type]; mods; mods = mods.GENnextModel) {
      if (modname === null || mods.GENmodName === modname) {
        for (let here = mods.GENinstances; here; here = here.GENnextInstance) {
          if (here.GENname === name) {
            return { error: OK, type, instance: here };
          }
        }
        if (mods.GENmodName === modname) {
          return { error: E_NODEV, type, instance: null };
        }
      }
    }
    return { error: E_NOMOD, type, instance: null };
  }
  if (type === -1) {
    for (type = 0; type < DEVmaxnum; type++) {
      for (let mods = ckt.CKThead[type]; mods; mods = mods.GENnextModel) {
        if (modname === null || mods.GENmodName === modname) {
          for (let here = mods.GENinstances; here; here = here.GENnextInstance) {
            if (here.GENname === name) {
              return { error: OK, type, instance: here };
            }
          }
          if (mods.GENmodName === modname) {
            return { error: E_NODEV, type, instance: null };
          }
        }
      }
    }
    return { error: E_NODEV, type: -1, instance: null };
  }
  return { error: E_BADPARM, type, instance: null };
}

/**
 * CKTcrtElt — создать инстанс устройства в модели (или вернуть существующий
 * с E_EXISTS). Порт `cktcrte.c`. Новый инстанс вставляется в голову списка
 * модели (порядок LIFO, как в C).
 *
 * @returns {{error:number, instance:object|null}}
 */
export function cktCrtElt(ckt, model, name) {
  if (!ckt) return { error: E_BADPARM, instance: null };
  if (!model) return { error: E_NOMOD, instance: null };
  const type = model.GENmodType;
  if (!DEVICES[type]) return { error: E_BADPARM, instance: null };

  const found = cktFindDev(ckt, { type, name, modfast: model });
  if (found.error === OK) {
    return { error: E_EXISTS, instance: found.instance };
  }
  if (found.error !== E_NODEV) {
    return { error: found.error, instance: null };
  }

  const inst = newInstance(name, model);
  const dev = DEVICES[type];
  if (dev.DEVnewInstance) dev.DEVnewInstance(inst);
  inst.GENnextInstance = model.GENinstances;
  model.GENinstances = inst;
  return { error: OK, instance: inst };
}

// ─────────────────────────── ЗАДАЧА И АНАЛИЗЫ ───────────────────────────

/**
 * CKTnewTask — создать задачу (набор опций + список job'ов).
 * Порт `cktntask.c` **в редакции XSPICE**: `trtol = 1.0` (публичный дефолт
 * DLL, engine-behavior §4.2), остальные значения — F4.
 *
 * @returns {{error:number, task:object|null}}
 */
export function cktNewTask(ckt, name) {
  if (!ckt) return { error: E_BADPARM, task: null };
  const task = {
    // JOB taskOptions (в C — первое поле TSKtask; используется как job type 0)
    JOBtype: 0,
    JOBnextJob: null,
    JOBname: null,
    jobs: null,
    TSKname: name ?? null,
    TSKtemp: 300.15,
    TSKnomTemp: 300.15,
    TSKmaxOrder: 2,
    TSKintegrateMethod: TRAPEZOIDAL,
    TSKcurrentAnalysis: 0,
    TSKbypass: 1,
    TSKdcMaxIter: 100, // itl1
    TSKdcTrcvMaxIter: 50, // itl2
    TSKtranMaxIter: 10, // itl4
    TSKnumSrcSteps: 10, // srcsteps / itl6
    TSKnumGminSteps: 10,
    TSKminBreak: 0, // не инициализируется и в C (zeroed MALLOC)
    TSKabstol: 1e-12,
    TSKpivotAbsTol: 1e-13,
    TSKpivotRelTol: 1e-3,
    TSKreltol: 1e-3,
    TSKchgtol: 1e-14,
    TSKvoltTol: 1e-6,
    TSKgmin: 1e-12,
    TSKdelmin: 0, // не инициализируется и в C
    TSKtrtol: 1, // XSPICE-правка 4/17/91 (DLL), не F4-семёрка
    TSKdefaultMosL: 1e-4,
    TSKdefaultMosW: 1e-4,
    TSKdefaultMosAD: 0,
    TSKdefaultMosAS: 0,
    TSKfixLimit: 0,
    TSKnoOpIter: 0,
    TSKtryToCompact: 0,
    TSKbadMos3: 0,
    TSKkeepOpInfo: 0,
  };
  return { error: OK, task };
}

/**
 * CKTnewAnal — добавить анализ в задачу. Порт `cktnewan.c`.
 * Особый случай `type == 0` (options): job'ом становится сама task, в список
 * `task.jobs` ничего не добавляется.
 *
 * @param {object} ckt
 * @param {string|number} type — индекс DLL или имя (`'op'`, `'TRAN'`, …)
 * @param {string} name — имя job'а (как в `CKTfndAnal`)
 * @param {object} task
 * @returns {{error:number, job:object|null}}
 */
export function cktNewAnal(ckt, type, name, task) {
  if (!ckt) return { error: E_BADPARM, job: null };
  if (!task) return { error: E_BADPARM, job: null };
  const idx = cktAnalIndex(type);
  if (idx < 0) {
    return {
      error: fail(ckt, E_BADPARM, 'CKTnewAnal', `unknown analysis type: ${type}`),
      job: null,
    };
  }
  if (idx === 0) {
    task.JOBname = name ?? null;
    task.JOBtype = 0;
    return { error: OK, job: task };
  }
  const job = {
    JOBtype: idx,
    JOBnextJob: task.jobs,
    JOBname: name ?? null,
  };
  if (idx === cktAnalIndex('TRAN')) {
    // TRANan (trandefs.h): zeroed-MALLOC в C, поля ставит TRANsetParm.
    job.TRANfinalTime = 0;
    job.TRANstep = 0;
    job.TRANmaxStep = 0;
    job.TRANinitTime = 0;
    job.TRANmode = 0;
    job.TRANplot = null;
  }
  if (idx === cktAnalIndex('AC')) {
    // ACAN (acdefs.h): zeroed-MALLOC в C, поля ставит ACsetParm.
    job.ACstartFreq = 0;
    job.ACstopFreq = 0;
    job.ACfreqDelta = 0;
    job.ACsaveFreq = 0;
    job.ACstepType = 0;
    job.ACnumberSteps = 0;
  }
  task.jobs = job;
  return { error: OK, job };
}

/**
 * CKTfndAnal — найти job по имени в задаче. Порт `cktfnda.c`.
 * @returns {{error:number, job:object|null}}
 */
export function cktFindAnal(ckt, name, task) {
  if (!ckt || !task) return { error: E_BADPARM, job: null };
  for (let here = task.jobs; here; here = here.JOBnextJob) {
    if (here.JOBname === name) return { error: OK, job: here };
  }
  return { error: E_NOTFOUND, job: null };
}

/**
 * CKTsetAnalPm — установить параметр анализа (через хук `setParm`).
 * Порт `cktsetap.c`; в P1.2 хуки анализов ещё null ⇒ E_BADPARM.
 *
 * @returns {number} код ошибки
 */
export function cktSetAnalPm(ckt, analPtr, parm, value, selector = null) {
  if (!ckt || !analPtr) return E_BADPARM;
  const type = analPtr.JOBtype;
  const info = ANALYSES[type];
  if (!info || !info.setParm) return E_BADPARM;
  return info.setParm(ckt, analPtr, parm, value, selector);
}

/**
 * Индекс параметра анализа по ключевому слову (`parms` каталога).
 *
 * @param {string|number} type
 * @param {string} keyword
 * @returns {number} id параметра или -1
 */
export function cktAnalParamIndex(type, keyword) {
  const idx = cktAnalIndex(type);
  if (idx < 0) return -1;
  const info = ANALYSES[idx];
  if (!Array.isArray(info.parms)) return -1;
  for (const p of info.parms) {
    if (p.keyword === keyword) return p.id;
  }
  return -1;
}

/** Установить параметр анализа по ключевому слову (удобство фронтенда). */
export function cktSetAnalPmByName(ckt, analPtr, keyword, value, selector = null) {
  if (!analPtr) return E_BADPARM;
  const parm = cktAnalParamIndex(analPtr.JOBtype, keyword);
  if (parm < 0) return E_BADPARM;
  return cktSetAnalPm(ckt, analPtr, parm, value, selector);
}

/**
 * CKTaskAnalQ — спросить параметр анализа (через хук `askQuest`).
 * Порт `cktaskaq.c`. Контракт хука: `(ckt, job, parm, selector) →
 * { error, value }`.
 *
 * @returns {{error:number, value:*}}
 */
export function cktAskAnalQst(ckt, analPtr, parm, selector = null) {
  if (!ckt || !analPtr) return { error: E_BADPARM, value: undefined };
  const type = analPtr.JOBtype;
  const info = ANALYSES[type];
  if (!info || !info.askQuest) return { error: E_BADPARM, value: undefined };
  return info.askQuest(ckt, analPtr, parm, selector);
}

/** Спросить параметр анализа по ключевому слову. */
export function cktAskAnalQstByName(ckt, analPtr, keyword, selector = null) {
  if (!analPtr) return { error: E_BADPARM, value: undefined };
  const parm = cktAnalParamIndex(analPtr.JOBtype, keyword);
  if (parm < 0) return { error: E_BADPARM, value: undefined };
  return cktAskAnalQst(ckt, analPtr, parm, selector);
}

/**
 * CKTdelTask — удалить задачу и её job'ы (в JS — снять ссылки; память соберёт GC).
 * Порт `CKTdelTask.c`.
 *
 * @returns {number} код ошибки
 */
export function cktDelTask(ckt, task) {
  if (!ckt || !task) return E_BADPARM;
  task.jobs = null;
  task.JOBnextJob = null;
  return OK;
}

// ─────────────────────────── SETUP / TEMP / IC ───────────────────────────

/**
 * CKTsetup — подготовить цепь к расчёту. Порт F4 `cktsetup.c`:
 * `NIinit` (новая матрица), хуки `DEVsetup` (создают элементы матрицы и
 * считают состояния), аллокация `CKTstates`, затем `NIreinit`.
 *
 * Отличие от XSPICE-редакции (там `CKTisSetup` не выставляется, а `NIinit`
 * сделан в `CKTinit`) зафиксировано как открытый вопрос Q-C01 в
 * `docs/re/engine-quirks.md`; до сверки оракулом выбран F4-вариант (lineage:
 * числовое ядро DLL — F4).
 *
 * @returns {number} код ошибки
 */
export function cktSetup(ckt) {
  if (!ckt) return E_BADPARM;
  if (ckt.CKTisSetup) return E_NOCHANGE;

  ckt.CKTnumStates = 0;
  let error = niInit(ckt);
  if (error) return fail(ckt, error, 'CKTsetup', 'NIinit: cannot allocate matrix');
  ckt.CKTisSetup = 1;

  const matrix = ckt.CKTmatrix;
  const state = { value: 0 };
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVsetup && ckt.CKThead[i] !== null) {
      error = dev.DEVsetup(matrix, ckt.CKThead[i], ckt, state);
      if (error) return fail(ckt, error, 'CKTsetup', `DEVsetup failed for ${dev.name}`);
    }
  }
  ckt.CKTnumStates = state.value;

  for (let i = 0; i <= ckt.CKTmaxOrder + 1; i++) {
    ckt.CKTstates[i] = ckt.CKTnumStates ? new Float64Array(ckt.CKTnumStates) : null;
  }

  if (ckt.CKTniState & NIUNINITIALIZED) {
    error = niReinit(ckt);
    if (error) return fail(ckt, error, 'CKTsetup', 'NIreinit: cannot allocate RHS');
  }
  return OK;
}

/**
 * CKTunsetup — освободить результаты setup перед повторным запуском.
 * Порт F4 `CKTunsetup` (`cktsetup.c`): состояния, хуки `DEVunsetup`,
 * `NIdestroy` (матрица и RHS).
 *
 * @returns {number} код ошибки
 */
export function cktUnsetup(ckt) {
  if (!ckt) return E_BADPARM;
  if (!ckt.CKTisSetup) return OK;

  for (let i = 0; i < ckt.CKTstates.length; i++) ckt.CKTstates[i] = null;

  let error = OK;
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVunsetup && ckt.CKThead[i] !== null) {
      const e2 = dev.DEVunsetup(ckt.CKThead[i], ckt);
      if (!error && e2) error = e2;
    }
  }
  ckt.CKTisSetup = 0;
  if (error) return error;

  niDestroy(ckt);
  return OK;
}

/**
 * CKTtemp — температурная подготовка: `CKTvt = CONSTKoverQ * CKTtemp`
 * (константа снята из DLL) + хуки `DEVtemperature`. Порт `ckttemp.c`.
 *
 * @returns {number} код ошибки
 */
export function cktTemp(ckt) {
  if (!ckt) return E_BADPARM;
  ckt.CKTvt = CONSTKoverQ * ckt.CKTtemp;
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVtemperature && ckt.CKThead[i] !== null) {
      const error = dev.DEVtemperature(ckt.CKThead[i], ckt);
      if (error) return error;
    }
  }
  return OK;
}

/**
 * CKTic — разложить `nodeset`/`ic` по RHS и диагонали матрицы (порт `cktic.c`).
 * Вызывается диспетчером для анализов с `do_ic`.
 *
 * В C матрица к этому моменту уже размечена device-setup'ом. В P1.2 устройств
 * нет, поэтому добавлена защита: если номер узла больше размера RHS — это
 * E_BADMATRIX (иначе запись в Float64Array молча потерялась бы).
 *
 * @returns {number} код ошибки
 */
export function cktIc(ckt) {
  if (!ckt) return E_BADPARM;
  if (!ckt.CKTmatrix || !ckt.CKTrhs) {
    return fail(ckt, E_BADMATRIX, 'CKTic', 'CKTic requires matrix and RHS (call CKTsetup first)');
  }
  const size = SMPmatSize(ckt.CKTmatrix);
  for (let i = 0; i <= size; i++) ckt.CKTrhs[i] = 0;

  for (let node = ckt.CKTnodes; node; node = node.next) {
    if (node.nsGiven) {
      if (node.number >= ckt.CKTrhs.length) {
        return fail(ckt, E_BADMATRIX, 'CKTic', `matrix too small for node ${node.number}`);
      }
      node.ptr = SMPmakeElt(ckt.CKTmatrix, node.number, node.number);
      if (node.ptr === null) return E_NOMEM;
      ckt.CKThadNodeset = 1;
      ckt.CKTrhs[node.number] = node.nodeset;
    }
    if (node.icGiven) {
      if (node.number >= ckt.CKTrhs.length) {
        return fail(ckt, E_BADMATRIX, 'CKTic', `matrix too small for node ${node.number}`);
      }
      if (!node.ptr) {
        node.ptr = SMPmakeElt(ckt.CKTmatrix, node.number, node.number);
        if (node.ptr === null) return E_NOMEM;
      }
      ckt.CKTrhs[node.number] = node.ic;
    }
  }

  if (ckt.CKTmode & MODEUIC) {
    for (let i = 0; i < DEVmaxnum; i++) {
      const dev = DEVICES[i];
      if (dev.DEVsetic && ckt.CKThead[i] !== null) {
        const error = dev.DEVsetic(ckt.CKThead[i], ckt);
        if (error) return error;
      }
    }
  }
  return OK;
}

// ─────────────────────────── ИТЕРАЦИИ / LTE ───────────────────────────

/**
 * CKTload — обнулить RHS и матрицу и дать устройствам штамповать (порт
 * `CKTload.c` в редакции XSPICE).
 *
 * Отличия XSPICE от F4 (Q-C03):
 *  - `nodeset`/`ic` **добавляются** к RHS (`+=`) и диагонали (`+= 1`), без
 *    `ZeroNoncurRow` и без установки диагонали в 1/1e10;
 *  - сброс `CKTtroubleNode` при `CKTnoncon` убран;
 *  - MIF-флаги и `enh->rshunt_data` — фазы X/I, здесь отсутствуют.
 *
 * @param {object} ckt
 * @returns {number} код ошибки
 */
export function cktLoad(ckt) {
  if (!ckt) return E_BADPARM;
  if (!ckt.CKTmatrix || !ckt.CKTrhs) {
    return fail(ckt, E_BADMATRIX, 'CKTload', 'CKTload requires matrix and RHS');
  }
  const start = nowSeconds();
  const size = SMPmatSize(ckt.CKTmatrix);
  for (let i = 0; i <= size; i++) ckt.CKTrhs[i] = 0;
  SMPclear(ckt.CKTmatrix);

  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVload && ckt.CKThead[i] !== null) {
      const error = dev.DEVload(ckt.CKThead[i], ckt);
      if (error) return error;
    }
  }

  if (ckt.CKTmode & MODEDC) {
    if (ckt.CKTmode & (MODEINITJCT | MODEINITFIX)) {
      for (let node = ckt.CKTnodes; node; node = node.next) {
        if (!node.nsGiven) continue;
        // В C `node->ptr` уже выделен `CKTic`; в JS подстраховываемся, чтобы
        // не разыменовать null (числа от этого не меняются).
        if (!node.ptr) node.ptr = SMPmakeElt(ckt.CKTmatrix, node.number, node.number);
        if (!node.ptr) return fail(ckt, E_NOMEM, 'CKTload', 'cannot allocate nodeset element');
        ckt.CKTrhs[node.number] += node.nodeset;
        node.ptr.real += 1;
      }
    }
    if (ckt.CKTmode & MODETRANOP && !(ckt.CKTmode & MODEUIC)) {
      for (let node = ckt.CKTnodes; node; node = node.next) {
        if (!node.icGiven) continue;
        if (!node.ptr) node.ptr = SMPmakeElt(ckt.CKTmatrix, node.number, node.number);
        if (!node.ptr) return fail(ckt, E_NOMEM, 'CKTload', 'cannot allocate ic element');
        ckt.CKTrhs[node.number] += node.ic;
        node.ptr.real += 1;
      }
    }
  }

  ckt.CKTstat.STATloadTime += nowSeconds() - start;
  return OK;
}

/**
 * CKTconvTest — прогнать `DEVconvTest` всех устройств (порт `cktop.c` в
 * редакции XSPICE).
 *
 * Квирк Q-C02: F4 возвращает `OK` даже при `CKTnoncon != 0` (из-за этого
 * DEVconvTest фактически не работали); XSPICE возвращает `1`. Берём XSPICE.
 *
 * @param {object} ckt
 * @returns {number} 1 — устройство сообщило о несходимости, иначе OK/код ошибки
 */
export function cktConvTest(ckt) {
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVconvTest && ckt.CKThead[i] !== null) {
      const error = dev.DEVconvTest(ckt.CKThead[i], ckt);
      if (error) return error;
    }
    if (ckt.CKTnoncon) return 1;
  }
  return OK;
}

/**
 * CKTtrunc — драйвер LTE-шага: устройства через `DEVtrunc` предлагают шаг,
 * берётся минимум (порт `ckttrunc.c`, ветка без `NEWTRUNC` — она не
 * компилируется в DLL).
 *
 * C: `CKTtrunc(ckt, double *timeStep)`; JS возвращает `{error, timeStep}`.
 * Контракт хука: `DEVtrunc(model, ckt, state)`, где `state = { timeStep }`.
 *
 * @param {object} ckt
 * @param {number} timeStep — текущий предлагаемый шаг
 * @returns {{error:number, timeStep:number}}
 */
export function cktTrunc(ckt, timeStep) {
  let timetemp = HUGE;
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVtrunc && ckt.CKThead[i] !== null) {
      const state = { timeStep: timetemp };
      const error = dev.DEVtrunc(ckt.CKThead[i], ckt, state);
      if (error) return { error, timeStep };
      timetemp = state.timeStep;
    }
  }
  return { error: OK, timeStep: Math.min(2 * timeStep, timetemp) };
}

// ─────────────────────────── ТОЧКИ ОСТАНОВА ───────────────────────────

/**
 * CKTsetBreak — добавить время в таблицу точек останова (порт `cktsetbk.c`).
 * Таблица отсортирована; слишком близкие точки (<= `CKTminBreak`) схлопываются.
 *
 * @param {object} ckt
 * @param {number} time
 * @returns {number} код ошибки
 */
export function cktSetBreak(ckt, time) {
  if (!ckt) return E_BADPARM;
  if (ckt.CKTtime > time) {
    return fail(ckt, E_PANIC, 'CKTsetBreak', 'breakpoint in the past - HELP!');
  }
  const breaks = ckt.CKTbreaks;
  if (!breaks) return fail(ckt, E_BADMATRIX, 'CKTsetBreak', 'no breakpoint table');
  for (let i = 0; i < ckt.CKTbreakSize; i++) {
    if (breaks[i] > time) {
      if (breaks[i] - time <= ckt.CKTminBreak) {
        breaks[i] = time;
        return OK;
      }
      if (time - breaks[i - 1] <= ckt.CKTminBreak) return OK;
      breaks.splice(i, 0, time);
      ckt.CKTbreakSize++;
      return OK;
    }
  }
  if (time - breaks[ckt.CKTbreakSize - 1] <= ckt.CKTminBreak) return OK;
  breaks.push(time);
  ckt.CKTbreakSize++;
  return OK;
}

/**
 * CKTclrBreak — удалить самую раннюю точку останова (порт `cktclrbk.c`).
 *
 * @param {object} ckt
 * @returns {number} код ошибки
 */
export function cktClrBreak(ckt) {
  if (!ckt || !ckt.CKTbreaks) return E_BADPARM;
  const breaks = ckt.CKTbreaks;
  if (ckt.CKTbreakSize > 2) {
    breaks.shift();
    ckt.CKTbreakSize--;
  } else {
    breaks[0] = breaks[1];
    breaks[1] = ckt.CKTfinalTime;
  }
  return OK;
}

/**
 * CKTaccept — принять текущую точку: дать устройствам выставить следующие
 * точки останова (порт `cktaccpt.c`; ветка `PREDICTOR` не компилируется).
 *
 * @param {object} ckt
 * @returns {number} код ошибки
 */
export function cktAccept(ckt) {
  if (!ckt) return E_BADPARM;
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVaccept && ckt.CKThead[i] !== null) {
      const error = dev.DEVaccept(ckt, ckt.CKThead[i]);
      if (error) return error;
    }
  }
  return OK;
}

// ─────────────────────────── ВЫВОД (OUTp*) ───────────────────────────

/** `IF_REAL` (IFsim.h) — тип данных/ref для OP/TRAN. */
export const IF_REAL = 4;
/** `IF_COMPLEX` (IFsim.h) — тип данных для AC (`[[re,im],…]`). */
export const IF_COMPLEX = 8;

/**
 * `OUTpBeginPlot` — открыть plot и перечислить имена узлов/ветвей.
 * Формат совпадает со снимком оракула (`tools/oracle/shim.py`).
 *
 * @returns {{error:number, plot:object|null}}
 */
export function cktOutBeginPlot(ckt, job, plotName, refName, refType, names, dataType) {
  if (!ckt) return { error: E_BADPARM, plot: null };
  const list = Array.isArray(names) ? names.slice() : [];
  const plot = {
    id: ckt.CKTnextPlotId++,
    name: plotName ?? (job ? job.JOBname : null),
    refName: refName ?? null,
    refType,
    dataType,
    names: list,
    points: [],
    ended: false,
  };
  ckt.CKTplots.push(plot);
  ckt.CKTopenPlots.push(plot);
  ckt.CKTsteps.push(
    `plot#${plot.id} ${plot.name} names=${list.length} refType=${refType} dataType=${dataType}`,
  );
  if (job && job.JOBtype === cktAnalIndex('TRAN')) job.TRANplot = plot;
  return { error: OK, plot };
}

/**
 * `OUTpData` — добавить точку (`ref` + вектор значений из `CKTrhsOld[1..]`).
 *
 * @returns {number} код ошибки
 */
export function cktOutData(ckt, plot, ref, values) {
  if (!ckt || !plot) return E_BADPARM;
  const vals = Array.isArray(values) ? values.slice() : Array.from(values);
  plot.points.push({ ref, values: vals });
  return OK;
}

/** `OUTendPlot` — закрыть plot. */
export function cktOutEndPlot(ckt, plot) {
  if (!ckt || !plot) return E_BADPARM;
  plot.ended = true;
  const at = ckt.CKTopenPlots.indexOf(plot);
  if (at >= 0) ckt.CKTopenPlots.splice(at, 1);
  return OK;
}

/**
 * `IFerror` — записать сообщение в журнал цепи (в C — глобальный колбэк
 * фронтенда). Текст не локализуется: ресурсы WEWB32 — не часть clean-room.
 */
export function cktError(ckt, flags, message) {
  if (!ckt) return E_BADPARM;
  ckt.CKTerrors.push({ flags, message });
  return OK;
}

/**
 * CKTdump — выгрузить текущее решение (`CKTrhsOld`) в plot (порт `cktdump.c`).
 *
 * @returns {number} код ошибки
 */
export function cktDump(ckt, ref, plot) {
  if (!ckt || !plot) return E_BADPARM;
  const num = ckt.CKTmaxEqNum - 1;
  return cktOutData(ckt, plot, ref, ckt.CKTrhsOld.subarray(1, num + 1));
}

/**
 * CKTterr — локальная оценка ошибки шага по заряду/потоку устройства
 * (порт `cktterr.c`). Устройства (`CAPtrunc`/`INDtrunc`) вызывают её из
 * `DEVtrunc`, передавая `state = { timeStep }`.
 *
 * @param {number} qcap — индекс заряда/потока в state-векторах
 * @param {object} ckt
 * @param {{timeStep:number}} state
 */
export function cktTerr(qcap, ckt, state) {
  const ccap = qcap + 1;
  const gearCoeff = [0.5, 0.2222222222, 0.1363636364, 0.096, 0.07299270073, 0.0583090379];
  const trapCoeff = [0.5, 0.08333333333];
  const s0 = ckt.CKTstates[0];
  const s1 = ckt.CKTstates[1];

  const volttol =
    ckt.CKTabstol + ckt.CKTreltol * Math.max(Math.abs(s0[ccap]), Math.abs(s1[ccap]));
  let chargetol = Math.max(Math.abs(s0[qcap]), Math.abs(s1[qcap]));
  chargetol = (ckt.CKTreltol * Math.max(chargetol, ckt.CKTchgtol)) / ckt.CKTdelta;
  const tol = Math.max(volttol, chargetol);

  const diff = new Float64Array(8);
  const deltmp = new Float64Array(8);
  for (let i = ckt.CKTorder + 1; i >= 0; i--) diff[i] = ckt.CKTstates[i][qcap];
  for (let i = 0; i <= ckt.CKTorder; i++) deltmp[i] = ckt.CKTdeltaOld[i];

  let j = ckt.CKTorder;
  for (;;) {
    for (let i = 0; i <= j; i++) diff[i] = (diff[i] - diff[i + 1]) / deltmp[i];
    if (--j < 0) break;
    for (let i = 0; i <= j; i++) deltmp[i] = deltmp[i + 1] + ckt.CKTdeltaOld[i];
  }

  let factor;
  switch (ckt.CKTintegrateMethod) {
    case GEAR:
      factor = gearCoeff[ckt.CKTorder - 1];
      break;
    case TRAPEZOIDAL:
      factor = trapCoeff[ckt.CKTorder - 1];
      break;
    default:
      return;
  }

  let del = (ckt.CKTtrtol * tol) / Math.max(ckt.CKTabstol, factor * Math.abs(diff[0]));
  if (ckt.CKTorder === 2) del = Math.sqrt(del);
  else if (ckt.CKTorder > 2) del = Math.exp(Math.log(del) / ckt.CKTorder);
  state.timeStep = Math.min(state.timeStep, del);
}

// ─────────────────────────── AC-ЗАГРУЗКА ───────────────────────────

/**
 * CKTacLoad — обнулить комплексную матрицу/RHS и вызвать `DEVacLoad`
 * (порт `CKTacLoad` из `acan.c`). В C обычно вызывается `NIacIter`; здесь
 * вынесено отдельно, чтобы устройства P1.4 можно было тестировать без P3.
 *
 * @returns {number} код ошибки
 */
export function cktAcLoad(ckt) {
  if (!ckt || !ckt.CKTmatrix) {
    return fail(ckt, E_BADMATRIX, 'CKTacLoad', 'CKTacLoad requires matrix');
  }
  const size = SMPmatSize(ckt.CKTmatrix);
  for (let i = 0; i <= size; i++) {
    ckt.CKTrhs[i] = 0;
    ckt.CKTirhs[i] = 0;
  }
  SMPcClear(ckt.CKTmatrix);
  for (let i = 0; i < DEVmaxnum; i++) {
    const dev = DEVICES[i];
    if (dev.DEVacLoad && ckt.CKThead[i] !== null) {
      const error = dev.DEVacLoad(ckt.CKThead[i], ckt);
      if (error) return error;
    }
  }
  return OK;
}

// ─────────────────────────── ДИСПЕТЧЕР АНАЛИЗОВ ───────────────────────────

/**
 * CKTdoJob — выполнить все анализы задачи. Порт `cktdojob.c`:
 *  1) копирование опций task → circuit (включая `trtol`);
 *  2) при `reset` — `CKTunsetup` → `CKTsetup` → `CKTtemp`;
 *  3) обход анализов **в порядке таблицы** (`analInfo`/`ANALYSES`), а внутри —
 *     списка `task.jobs` (LIFO, как его строит `CKTnewAnal`);
 *  4) для каждого job: `an_init` → (при `do_ic`) `CKTic` → `an_func`.
 *
 * @param {object} ckt
 * @param {number} reset — 1 = перезапуск с setup (как `doAnalyses(...,1)` оракула)
 * @param {object} task
 * @returns {number} код последней ошибки (C: `error2`)
 */
export function cktDoJob(ckt, reset, task) {
  if (!ckt || !task) return E_BADPARM;
  const startTime = nowSeconds();

  // опции задачи → цепь (порядок и состав — cktdojob.c)
  ckt.CKTtemp = task.TSKtemp;
  ckt.CKTnomTemp = task.TSKnomTemp;
  ckt.CKTmaxOrder = task.TSKmaxOrder;
  ckt.CKTintegrateMethod = task.TSKintegrateMethod;
  ckt.CKTbypass = task.TSKbypass;
  ckt.CKTdcMaxIter = task.TSKdcMaxIter;
  ckt.CKTdcTrcvMaxIter = task.TSKdcTrcvMaxIter;
  ckt.CKTtranMaxIter = task.TSKtranMaxIter;
  ckt.CKTnumSrcSteps = task.TSKnumSrcSteps;
  ckt.CKTnumGminSteps = task.TSKnumGminSteps;
  ckt.CKTminBreak = task.TSKminBreak;
  ckt.CKTabstol = task.TSKabstol;
  ckt.CKTpivotAbsTol = task.TSKpivotAbsTol;
  ckt.CKTpivotRelTol = task.TSKpivotRelTol;
  ckt.CKTreltol = task.TSKreltol;
  ckt.CKTchgtol = task.TSKchgtol;
  ckt.CKTvoltTol = task.TSKvoltTol;
  ckt.CKTgmin = task.TSKgmin;
  ckt.CKTdelmin = task.TSKdelmin;
  ckt.CKTtrtol = task.TSKtrtol;
  ckt.CKTdefaultMosL = task.TSKdefaultMosL;
  ckt.CKTdefaultMosW = task.TSKdefaultMosW;
  ckt.CKTdefaultMosAD = task.TSKdefaultMosAD;
  ckt.CKTdefaultMosAS = task.TSKdefaultMosAS;
  ckt.CKTfixLimit = task.TSKfixLimit;
  ckt.CKTnoOpIter = task.TSKnoOpIter;
  ckt.CKTtryToCompact = task.TSKtryToCompact;
  ckt.CKTbadMos3 = task.TSKbadMos3;
  ckt.CKTkeepOpInfo = task.TSKkeepOpInfo;
  ckt.CKTtroubleNode = 0;
  ckt.CKTtroubleElt = null;

  let error = OK;
  if (reset) {
    ckt.CKTdelta = 0.0;
    ckt.CKTtime = 0.0;
    ckt.CKTcurrentAnalysis = 0;

    error = cktUnsetup(ckt);
    if (!error) error = cktSetup(ckt);
    if (!error) error = cktTemp(ckt);
    if (error) return error;
  }

  let error2 = OK;
  // «Analysis order is important» (cktdojob.c): внешний цикл — по типам анализа,
  // внутренний — по списку job'ов (он LIFO, поэтому TRAN-задача, созданная
  // позже OP, всё равно выполнится после OP).
  for (let i = 0; i < ANALmaxnum; i++) {
    const info = ANALYSES[i];
    for (let job = task.jobs; job; job = job.JOBnextJob) {
      if (job.JOBtype !== i) continue;
      ckt.CKTcurJob = job;
      error = OK;
      if (info.an_init) error = info.an_init(ckt, job);
      if (!error && info.do_ic) error = cktIc(ckt);
      if (!error) {
        if (info.an_func) {
          error = info.an_func(ckt, reset);
        } else {
          error = fail(ckt, E_UNSUPP, 'CKTdoJob', `analysis "${info.name}" has no an_func`);
        }
      }
      if (error) error2 = error;
    }
  }

  ckt.CKTstat.STATtotAnalTime += nowSeconds() - startTime;
  return error2;
}

// ─────────────────────────── EWB-ШВЫ (фаза I) ───────────────────────────

/** Найти номер уравнения по имени/объекту узла (общий помощник швов). */
function seamNodeNumber(ckt, node) {
  if (node && typeof node === 'object' && Number.isInteger(node.number)) return node.number;
  if (typeof node === 'number') return cktNum2Nod(ckt, node) ? node : null;
  if (typeof node === 'string') {
    const found = cktFindNode(ckt, node);
    return found.error === OK && found.node ? found.node.number : null;
  }
  return null;
}

/**
 * `getVoltage` (экспорт XSPICE32.DLL) — напряжение узла для приборов.
 * Принимает имя узла, его номер или объект CKTnode; после прогона читает
 * `CKTrhsOld` (там лежит последнее решение — как у шва DLL).
 *
 * @returns {{error:number, value:number}}
 */
export function getVoltage(ckt, node) {
  if (!ckt || !ckt.CKTrhsOld) {
    return { error: E_BADMATRIX, value: NaN, errMsg: 'getVoltage: нет решения (CKTdoJob не выполнялся)' };
  }
  const number = seamNodeNumber(ckt, node);
  if (number == null) {
    return { error: E_NOTFOUND, value: NaN, errMsg: `getVoltage: узел «${node}» не найден` };
  }
  return { error: OK, value: ckt.CKTrhsOld[number] };
}

/**
 * `getCurrent` (экспорт DLL) — ток ветви/устройства для приборов.
 * Ищет уравнение `"<имя>#branch"` (ветвевые устройства: V/I, индуктивность).
 * Для устройств без ветвевого уравнения возвращает `E_NOTFOUND`.
 *
 * @returns {{error:number, value:number}}
 */
export function getCurrent(ckt, instance) {
  if (!ckt || !ckt.CKTrhsOld) {
    return { error: E_BADMATRIX, value: NaN, errMsg: 'getCurrent: нет решения (CKTdoJob не выполнялся)' };
  }
  let name = instance;
  if (instance && typeof instance === 'object') name = instance.GENname;
  if (typeof name !== 'string' || !name) {
    return { error: E_BADPARM, value: NaN, errMsg: 'getCurrent: ожидается имя элемента' };
  }
  const branchName = /#branch$/.test(name) ? name : `${name}#branch`;
  const found = cktFindNode(ckt, branchName);
  if (found.error !== OK || !found.node) {
    return { error: E_NOTFOUND, value: NaN, errMsg: `getCurrent: ветвь «${branchName}» не найдена` };
  }
  return { error: OK, value: ckt.CKTrhsOld[found.node.number] };
}

const EWB_SEAM_MSG =
  'EWB seam is not wired yet (phase I; см. PLAN-CLONE §4, фаза I)';

/**
 * `getMatrixElement` (экспорт DLL) — элемент матрицы (для отладки/паритета).
 * Не реализован: порт sparse не отдаёт публичного доступа к значениям
 * (сверка штамповки — отдельная задача фазы I/паритета).
 *
 * @returns {{error:number, value:number}}
 */
export function getMatrixElement(_ckt, _row, _col) {
  return { error: E_UNSUPP, value: NaN, errMsg: EWB_SEAM_MSG };
}

/**
 * `setMaxStep` (экспорт DLL) — ограничение максимального шага TRAN из UI
 * (осциллограф/генератор). В C шов пишет `CKTmaxStep`; здесь сохраняем ту же
 * семантику: новый предел не может увеличить уже выбранный шаг.
 *
 * @returns {number} код ошибки
 */
export function setMaxStep(ckt, step) {
  if (!ckt) return E_BADPARM;
  const value = Number(step);
  if (!Number.isFinite(value) || value <= 0) return E_BADPARM;
  ckt.CKTmaxStep = ckt.CKTmaxStep > 0 ? Math.min(ckt.CKTmaxStep, value) : value;
  return OK;
}
