/**
 * sparse.js — прямой ESM-порт решателя Sparse 1.3 (SPICE3F4) на JavaScript.
 *
 * Источник (эталон порта): `vendor/spice3f4/src/lib/sparse/*.c` + `src/include/spdefs.h`,
 * `spconfig.h`, `spmatrix.h`. Сборка F4 (используется движком XSPICE32):
 *   REAL=YES, spCOMPLEX=1, EXPANDABLE=YES, TRANSLATE=YES, INITIALIZE=NO,
 *   DIAGONAL_PIVOTING=YES, ARRAY_OFFSET=YES, MODIFIED_MARKOWITZ=NO, DELETE=NO,
 *   STRIP=NO, MODIFIED_NODAL=YES, QUAD_ELEMENT=NO, TRANSPOSE=YES, SCALING=NO,
 *   DOCUMENTATION=YES, MULTIPLICATION=YES, DETERMINANT=YES, STABILITY=NO,
 *   CONDITION=NO, PSEUDOCONDITION=NO, spSEPARATED_COMPLEX_VECTORS=1,
 *   spCOMPATIBILITY=0; DEFAULT_THRESHOLD=1e-3, DIAG_PIVOTING_AS_DEFAULT=YES,
 *   DEFAULT_PARTITION=spAUTO_PARTITION, SPACE_FOR_ELEMENTS=6, SPACE_FOR_FILL_INS=4,
 *   ELEMENTS_PER_ALLOCATION=31, MINIMUM_ALLOCATED_SIZE=6, EXPANSION_FACTOR=1.5,
 *   MAX_MARKOWITZ_TIES=100, TIES_MULTIPLIER=5, MACHINE_RESOLUTION=DBL_EPSILON,
 *   LARGEST_SHORT_INTEGER=SHRT_MAX, LARGEST_LONG_INTEGER=LONG_MAX.
 *
 * Задачи порта:
 *  1) бит-в-бит совпадение численных результатов с эталоном — поэтому сохранён
 *     ПОРЯДОК всех арифметических операций, порядок обхода связных списков и
 *     правила тай-брейков выбора пивота (важно для 1:1-паритета с оригиналом);
 *  2) сохранены и «странности» оригинала (см. комментарии в местах порта):
 *     мёртвый код в `searchForSingleton`, второй проход `spMNA_Preorder` с
 *     устаревшими указателями близнецов и т.п.;
 *  3) ошибки и их коды — как в `sperror.h`/`iferrmsg.h`: spZERO_DIAG == spSINGULAR
 *     == E_SINGULAR == 102, spSMALL_PIVOT == spOKAY == OK == 0.
 *
 * Соглашения JS-порта:
 *  - элемент матрицы — объект `{ real, imag, row, col, nextInRow, nextInCol }`;
 *    ссылки на элементы — сами объекты (в C — указатели); `null` играет роль NULL;
 *  - «указатель на указатель» (ElementPtr*) моделируется парой {get,set};
 *  - массивы maps — Int32Array с индексом 0, не используемым (ARRAY_OFFSET=YES);
 *    RHS/Solution — Float64Array, индексы 1..ExtSize (индекс 0 не используется);
 *  - выделения/освобождения памяти как в C не моделируются (GC), счётчики
 *    Elements/Fillins сохранены для отчётности (`spElementCount`/`spFillinCount`).
 *
 * Покрытие C-файлов: spalloc.c, spbuild.c, spfactor.c, spsolve.c, sputils.c
 * (только собранные опциями функции), spsmp.c. Функции, отключённые опциями
 * (SCALING/CONDITION/DELETE/STRIP/PSEUDOCONDITION/INITIALIZE/QUAD_ELEMENT/FORTRAN),
 * не портированы — см. PLAN-CLONE (фаза P1).
 */

// ─────────────────────────── КОНСТАНТЫ (spconfig.h / spmatrix.h / sperror.h) ───────────────────────────

/** Коды ошибок (iferrmsg.h + spmatrix.h). */
export const OK = 0;
export const E_PANIC = 1;
export const E_NOMEM = 8;
export const E_PRIVATE = 100;
export const E_BADMATRIX = E_PRIVATE + 1; // 101
export const E_SINGULAR = E_PRIVATE + 2; // 102

export const spOKAY = OK; // 0
export const spSMALL_PIVOT = spOKAY; // в этой сборке spSMALL_PIVOT == OK (spmatrix.h)
export const spZERO_DIAG = E_SINGULAR; // 102 (в этой сборке совпадает с spSINGULAR)
export const spSINGULAR = E_SINGULAR; // 102
export const spNO_MEMORY = E_NOMEM; // 8
export const spPANIC = E_BADMATRIX; // 101
export const spFATAL = E_BADMATRIX; // 101

/** Типы разбиения (spmatrix.h). */
export const spDEFAULT_PARTITION = 0;
export const spDIRECT_PARTITION = 1;
export const spINDIRECT_PARTITION = 2;
export const spAUTO_PARTITION = 3;

/** Константы матрицы (spconfig.h). */
export const DEFAULT_THRESHOLD = 1.0e-3;
export const DIAG_PIVOTING_AS_DEFAULT = true;
export const DEFAULT_PARTITION = spAUTO_PARTITION;
const MAX_MARKOWITZ_TIES = 100;
const TIES_MULTIPLIER = 5;
const EXPANSION_FACTOR = 1.5;
const MINIMUM_ALLOCATED_SIZE = 6;
const LARGEST_SHORT_INTEGER = 32767; // SHRT_MAX
const LARGEST_LONG_INTEGER = Number.MAX_SAFE_INTEGER; // замена LONG_MAX (продукты счётчиков малы)

/** «Магия» корректности кадра (spdefs.h). */
export const SPARSE_ID = 0x772773;

/** Приблизительная |L1|-норма комплексного числа: ELEMENT_MAG. */
export function elementMag(e) {
  return Math.abs(e.real) + Math.abs(e.imag);
}

/** Перестановка двух значений. */
function swap(a, b) {
  const t = a;
  a = b;
  b = t;
}

// ─────────────────────────────────── СОЗДАНИЕ/УНИЧТОЖЕНИЕ (spalloc.c) ───────────────────────────────────

/**
 * Создание матрицы (spCreate из spalloc.c).
 * В C Size==0 разрешён только при EXPANDABLE (у нас EXPANDABLE=YES).
 * Возвращает объект матрицы или null при «panic» (Size < 0).
 */
export function spCreate(size, complex) {
  if (size < 0) return null; // в C: *pError = spPANIC
  const allocatedSize = Math.max(size, MINIMUM_ALLOCATED_SIZE);
  const m = {
    id: SPARSE_ID,
    complex: !!complex,
    previousMatrixWasComplex: !!complex,
    factored: false,
    elements: 0,
    error: spOKAY,
    fillins: 0,
    reordered: false,
    needsOrdering: true,
    numberOfInterchangesIsOdd: false,
    partitioned: false,
    rowsLinked: false,
    internalVectorsAllocated: false,
    singularCol: 0,
    singularRow: 0,
    size,
    allocatedSize,
    extSize: size,
    allocatedExtSize: allocatedSize,
    currentSize: 0,
    diag: new Array(allocatedSize + 1).fill(null),
    firstInCol: new Array(allocatedSize + 1).fill(null),
    firstInRow: new Array(allocatedSize + 1).fill(null),
    intToExtColMap: new Int32Array(allocatedSize + 1),
    intToExtRowMap: new Int32Array(allocatedSize + 1),
    extToIntColMap: new Int32Array(allocatedSize + 1).fill(-1),
    extToIntRowMap: new Int32Array(allocatedSize + 1).fill(-1),
    markowitzRow: null,
    markowitzCol: null,
    markowitzProd: null,
    doRealDirect: null,
    doCmplxDirect: null,
    intermediate: null,
    destPtr: null,
    relThreshold: DEFAULT_THRESHOLD,
    absThreshold: 0.0,
    maxRowCountInLowerTri: 0,
    singletons: 0,
    pivotsOriginalRow: 0,
    pivotsOriginalCol: 0,
    pivotSelectionMethod: '',
    trashCan: { real: 0.0, imag: 0.0, row: 0, col: 0, nextInRow: null, nextInCol: null },
  };
  for (let i = 1; i <= allocatedSize; i++) {
    m.intToExtRowMap[i] = i;
    m.intToExtColMap[i] = i;
  }
  // ExtToInt*Map[0] = 0, остальные -1 (TRANSLATE)
  m.extToIntColMap[0] = 0;
  m.extToIntRowMap[0] = 0;
  return m;
}

/** Новый элемент матрицы (spcGetElement из spalloc.c; в JS — просто объект). */
function newElement() {
  return { real: 0.0, imag: 0.0, row: 0, col: 0, nextInRow: null, nextInCol: null };
}

/** spDestroy: в JS память освобождает GC; функция сохранена для симметрии API. */
export function spDestroy(_m) {
  // no-op намеренно
}

/** spError: код ошибки матрицы (или spNO_MEMORY для NULL, как в C). */
export function spError(m) {
  return m ? m.error : spNO_MEMORY;
}

/** spWhereSingular: внешние (ext) номера строки/столбца вырожденного пивота. */
export function spWhereSingular(m) {
  if (m.error === spSINGULAR || m.error === spZERO_DIAG) {
    return { row: m.singularRow, col: m.singularCol };
  }
  return { row: 0, col: 0 };
}

/** spGetSize(Matrix, External). */
export function spGetSize(m, external) {
  return external ? m.extSize : m.size;
}

/** spSetReal. */
export function spSetReal(m) {
  m.complex = false;
}

/** spSetComplex. */
export function spSetComplex(m) {
  m.complex = true;
}

/** spFillinCount. */
export function spFillinCount(m) {
  return m.fillins;
}

/** spElementCount. */
export function spElementCount(m) {
  return m.elements;
}

// ──────────────────────────────────── ПОСТРОЕНИЕ МАТРИЦЫ (spbuild.c) ────────────────────────────────────

/** spClear: обнулить значения (с сохранением структуры). */
export function spClear(m) {
  if (m.previousMatrixWasComplex || m.complex) {
    for (let i = m.size; i > 0; i--) {
      for (let e = m.firstInCol[i]; e !== null; e = e.nextInCol) {
        e.real = 0.0;
        e.imag = 0.0;
      }
    }
  } else {
    for (let i = m.size; i > 0; i--) {
      for (let e = m.firstInCol[i]; e !== null; e = e.nextInCol) {
        e.real = 0.0;
      }
    }
  }
  m.trashCan.real = 0.0;
  m.trashCan.imag = 0.0;
  m.error = spOKAY;
  m.factored = false;
  m.singularCol = 0;
  m.singularRow = 0;
  m.previousMatrixWasComplex = m.complex;
}

/**
 * spGetElement: вернуть элемент (Row, Col), создав его при необходимости.
 * Возвращает объект-элемент либо TrashCan (если Row==0 или Col==0).
 */
export function spGetElement(m, row, col) {
  if (row === 0 || col === 0) return m.trashCan;
  const [intRow, intCol] = translate(m, row, col);
  if (intRow !== intCol || m.diag[intRow] === null || m.diag[intRow] === undefined) {
    return findElementInCol(m, intRow, intCol, true);
  }
  return m.diag[intRow];
}

/**
 * spcFindElementInCol: поиск элемента (Row, Col) в столбце, начиная со слота
 * LastAddr (аналог `ElementPtr *LastAddr` из spbuild.c): адрес FirstInCol[i]
 * либо поля NextInCol. Если элемент отсутствует и createIfMissing — он
 * создаётся вставкой по тому же слоту.
 *
 * NB: слот может указывать и на локальную переменную (см. квирк SMPfindElt):
 * тогда при вставке «в голову» элемент остаётся не связанным с FirstInCol.
 */
export function findElementInColSlot(m, lastAddr, row, col, createIfMissing) {
  let pElement = lastAddr.get();
  while (pElement !== null) {
    if (pElement.row < row) {
      // Не дошли до нужного элемента — сдвигаем слот вниз по цепочке.
      lastAddr = fieldSlot(pElement, 'nextInCol');
      pElement = lastAddr.get();
    } else if (pElement.row === row) {
      // Нашли искомый элемент.
      return pElement;
    } else {
      break;
    }
  }
  // Элемента нет: создать при необходимости.
  if (createIfMissing) return createElementBeforeSlot(m, row, col, lastAddr, false);
  return null;
}

/**
 * Поиск/создание элемента с головы столбца (`&FirstInCol[Col]`) — путь
 * spGetElement и обменов в spFactor. SMPfindElt намеренно использует
 * собственный локальный слот (см. ниже), это не опечатка порта.
 */
export function findElementInCol(m, row, col, createIfMissing) {
  return findElementInColSlot(m, headSlot(m.firstInCol, col), row, col, createIfMissing);
}

/**
 * spcLinkRows: построить строковые списки (с сохранением порядка C: вставка
 * в голову строки при обходе столбцов от Size к 1).
 */
export function spcLinkRows(m) {
  const firstInRow = m.firstInRow;
  for (let col = m.size; col >= 1; col--) {
    let e = m.firstInCol[col];
    while (e !== null) {
      e.col = col;
      e.nextInRow = firstInRow[e.row];
      firstInRow[e.row] = e;
      e = e.nextInCol;
    }
  }
  m.rowsLinked = true;
}

/** EnlargeMatrix: увеличить Size и (при необходимости) все массивы кадра. */
function enlargeMatrix(m, newSize) {
  const oldAllocatedSize = m.allocatedSize;
  m.size = newSize;
  if (newSize <= oldAllocatedSize) return;
  newSize = Math.trunc(Math.max(newSize, EXPANSION_FACTOR * oldAllocatedSize));
  m.allocatedSize = newSize;

  m.intToExtColMap = growInt32(m.intToExtColMap, newSize, (i) => i);
  m.intToExtRowMap = growInt32(m.intToExtRowMap, newSize, (i) => i);
  m.diag = growRefArray(m.diag, newSize);
  m.firstInCol = growRefArray(m.firstInCol, newSize);
  m.firstInRow = growRefArray(m.firstInRow, newSize);

  // C: FREE(Markowitz*/Do*Direct/Intermediate); InternalVectorsAllocated = NO
  m.markowitzRow = null;
  m.markowitzCol = null;
  m.markowitzProd = null;
  m.doRealDirect = null;
  m.doCmplxDirect = null;
  m.intermediate = null;
  m.destPtr = null;
  m.internalVectorsAllocated = false;
}

/** ExpandTranslationArrays: расширить ExtToInt-отображения (новые — -1). */
function expandTranslationArrays(m, newSize) {
  m.extSize = newSize;
  const oldAllocatedSize = m.allocatedExtSize;
  if (newSize <= oldAllocatedSize) return;
  newSize = Math.trunc(Math.max(newSize, EXPANSION_FACTOR * oldAllocatedSize));
  m.allocatedExtSize = newSize;
  m.extToIntRowMap = growInt32(m.extToIntRowMap, newSize, () => -1);
  m.extToIntColMap = growInt32(m.extToIntColMap, newSize, () => -1);
}

/** Translate (spbuild.c): внешние индексы строки/столбца → внутренние. */
function translate(m, row, col) {
  // Расширение массивов трансляции, если внешние номера вышли за пределы.
  if (row > m.allocatedExtSize || col > m.allocatedExtSize) {
    expandTranslationArrays(m, Math.max(row, col));
  }
  if (row > m.extSize || col > m.extSize) m.extSize = Math.max(row, col);

  let intRow = m.extToIntRowMap[row];
  if (intRow === -1) {
    m.extToIntRowMap[row] = ++m.currentSize;
    m.extToIntColMap[row] = m.currentSize;
    intRow = m.currentSize;
    if (intRow > m.size) enlargeMatrix(m, intRow);
    m.intToExtRowMap[intRow] = row;
    m.intToExtColMap[intRow] = row;
  }
  let intCol = m.extToIntColMap[col];
  if (intCol === -1) {
    m.extToIntRowMap[col] = ++m.currentSize;
    m.extToIntColMap[col] = m.currentSize;
    intCol = m.currentSize;
    if (intCol > m.size) enlargeMatrix(m, intCol);
    m.intToExtRowMap[intCol] = col;
    m.intToExtColMap[intCol] = col;
  }
  return [intRow, intCol];
}

/** Вырастить Int32Array до длины newSize+1; новые позиции — fill(i). */
function growInt32(arr, newSize, fill) {
  const a = new Int32Array(newSize + 1);
  a.set(arr.subarray(0, Math.min(arr.length, newSize + 1)));
  for (let i = arr.length; i <= newSize; i++) a[i] = fill(i);
  return a;
}

/** Вырастить массив ссылок до длины newSize+1 (новые — null). */
function growRefArray(arr, newSize) {
  const a = new Array(newSize + 1).fill(null);
  for (let i = 1; i < Math.min(arr.length, newSize + 1); i++) a[i] = arr[i];
  return a;
}

// ─────────────────────────────── «УКАЗАТЕЛИ НА ПОЛЯ» СВЯЗНЫХ СПИСКОВ ───────────────────────────────

/** Слот головы массива (аналог `&FirstInCol[i]` / `&FirstInRow[i]`). */
function headSlot(arr, i) {
  return { get: () => arr[i], set: (e) => { arr[i] = e; } };
}

/** Слот поля элемента (аналог `&pElement->NextInCol` / `->NextInRow`). */
function fieldSlot(obj, name) {
  return { get: () => obj[name], set: (e) => { obj[name] = e; } };
}

// ─────────────────────── КОМПЛЕКСНАЯ АРИФМЕТИКА (макросы CMPLX_* из spdefs.h) ───────────────────────

/** Присвоить e значение 1/den (CMPLX_RECIPROCAL), устойчивое деление. */
function reciprocalAssign(e, den) {
  let re;
  let im;
  let r;
  if ((den.real >= den.imag && den.real > -den.imag) || (den.real < den.imag && den.real <= -den.imag)) {
    r = den.imag / den.real;
    re = 1.0 / (den.real + r * den.imag);
    im = -r * re;
  } else {
    r = den.real / den.imag;
    im = -1.0 / (den.imag + r * den.real);
    re = -r * im;
  }
  e.real = re;
  e.imag = im;
}

// ──────────────────────────────────── УПОРЯДОЧИВАНИЕ/ФАКТОРИЗАЦИЯ (spfactor.c) ────────────────────────────────────

/**
 * spOrderAndFactor: выбор пивотов + LU-факторизация.
 * RHS (необязательный) — представительный вектор правой части для Markowitz
 * (в CKT вызывается с NULL).
 */
export function spOrderAndFactor(m, rhs, relThreshold, absThreshold, diagPivoting) {
  m.error = spOKAY;
  const size = m.size;
  if (relThreshold <= 0.0) relThreshold = m.relThreshold;
  if (relThreshold > 1.0) relThreshold = m.relThreshold;
  m.relThreshold = relThreshold;
  if (absThreshold < 0.0) absThreshold = m.absThreshold;
  m.absThreshold = absThreshold;

  let step;
  let reorderingRequired = false;
  if (!m.needsOrdering) {
    // Матрица уже упорядочена — пробуем «быструю» факторизацию без переупорядочивания.
    for (step = 1; step <= size; step++) {
      const pPivot = m.diag[step];
      if (pPivot === null || pPivot === undefined) {
        // NB: в F4 здесь нет проверки NULL (в отличие от ngspice) — оставлено 1:1:
        // такой сценарий невозможен при корректном использовании, падаем у NULL-разыменования.
        pPivot.nextInCol;
      }
      const largestInCol = findLargestInCol(pPivot.nextInCol);
      if (largestInCol * relThreshold < elementMag(pPivot)) {
        if (m.complex) complexRowColElimination(m, pPivot);
        else realRowColElimination(m, pPivot);
      } else {
        reorderingRequired = true;
        break;
      }
    }
    if (!reorderingRequired) {
      m.needsOrdering = false;
      m.reordered = true;
      m.factored = true;
      return m.error;
    }
  } else {
    // Полное упорядочивание требуется.
    step = 1;
    if (!m.rowsLinked) spcLinkRows(m);
    if (!m.internalVectorsAllocated) spcCreateInternalVectors(m);
    if (m.error >= spFATAL) return m.error;
  }

  countMarkowitz(m, rhs, step);
  markowitzProducts(m, step);
  m.maxRowCountInLowerTri = -1;

  for (; step <= size; step++) {
    const pPivot = searchForPivot(m, step, diagPivoting);
    if (pPivot === null) return matrixIsSingular(m, step);
    exchangeRowsAndCols(m, pPivot, step);
    if (m.complex) complexRowColElimination(m, pPivot);
    else realRowColElimination(m, pPivot);
    if (m.error >= spFATAL) return m.error;
    updateMarkowitzNumbers(m, pPivot);
  }

  m.needsOrdering = false;
  m.reordered = true;
  m.factored = true;
  return m.error;
}

/** spFactor: факторизация без переупорядочивания (с автоматическим reorder при необходимости). */
export function spFactor(m) {
  if (m.needsOrdering) {
    return spOrderAndFactor(m, null, 0.0, 0.0, DIAG_PIVOTING_AS_DEFAULT);
  }
  if (!m.partitioned) spPartition(m, spDEFAULT_PARTITION);
  if (m.complex) return factorComplexMatrix(m);

  const size = m.size;
  if (m.diag[1].real === 0.0) return zeroPivot(m, 1);
  m.diag[1].real = 1.0 / m.diag[1].real;

  for (let step = 2; step <= size; step++) {
    const dest = m.intermediate;
    if (m.doRealDirect[step]) {
      // Прямая адресация: сборка столбца в промежуточный вектор.
      for (let e = m.firstInCol[step]; e !== null; e = e.nextInCol) dest[e.row] = e.real;

      let pColumn = m.firstInCol[step];
      while (pColumn.row < step) {
        let pElement = m.diag[pColumn.row];
        pColumn.real = dest[pColumn.row] * pElement.real;
        pElement = pElement.nextInCol;
        while (pElement !== null) {
          dest[pElement.row] -= pColumn.real * pElement.real;
          pElement = pElement.nextInCol;
        }
        pColumn = pColumn.nextInCol;
      }

      let pElement = m.diag[step].nextInCol;
      while (pElement !== null) {
        pElement.real = dest[pElement.row];
        pElement = pElement.nextInCol;
      }

      if (dest[step] === 0.0) return zeroPivot(m, step);
      m.diag[step].real = 1.0 / dest[step];
    } else {
      // Косвенная адресация: вектор хранит ссылки на элементы.
      const pDest = m.destPtr;
      for (let e = m.firstInCol[step]; e !== null; e = e.nextInCol) pDest[e.row] = e;

      let pColumn = m.firstInCol[step];
      while (pColumn.row < step) {
        let pElement = m.diag[pColumn.row];
        const mult = (pDest[pColumn.row].real *= pElement.real);
        pElement = pElement.nextInCol;
        while (pElement !== null) {
          pDest[pElement.row].real -= mult * pElement.real;
          pElement = pElement.nextInCol;
        }
        pColumn = pColumn.nextInCol;
      }

      if (m.diag[step].real === 0.0) return zeroPivot(m, step);
      m.diag[step].real = 1.0 / m.diag[step].real;
    }
  }

  m.factored = true;
  return (m.error = spOKAY);
}

/** FactorComplexMatrix: та же факторизация для комплексного случая. */
function factorComplexMatrix(m) {
  const size = m.size;
  let pElement = m.diag[1];
  if (elementMag(pElement) === 0.0) return zeroPivot(m, 1);
  reciprocalAssign(pElement, pElement);

  for (let step = 2; step <= size; step++) {
    if (m.doCmplxDirect[step]) {
      // Прямая адресация; комплексные числа лежат в intermediate парами.
      const dest = m.intermediate;
      for (let e = m.firstInCol[step]; e !== null; e = e.nextInCol) {
        dest[2 * e.row] = e.real;
        dest[2 * e.row + 1] = e.imag;
      }

      let pColumn = m.firstInCol[step];
      while (pColumn.row < step) {
        let pElement = m.diag[pColumn.row];
        const mr = dest[2 * pColumn.row] * pElement.real - dest[2 * pColumn.row + 1] * pElement.imag;
        const mi = dest[2 * pColumn.row] * pElement.imag + dest[2 * pColumn.row + 1] * pElement.real;
        pColumn.real = mr;
        pColumn.imag = mi;
        pElement = pElement.nextInCol;
        while (pElement !== null) {
          dest[2 * pElement.row] -= mr * pElement.real - mi * pElement.imag;
          dest[2 * pElement.row + 1] -= mr * pElement.imag + mi * pElement.real;
          pElement = pElement.nextInCol;
        }
        pColumn = pColumn.nextInCol;
      }

      let e2 = m.diag[step].nextInCol;
      while (e2 !== null) {
        e2.real = dest[2 * e2.row];
        e2.imag = dest[2 * e2.row + 1];
        e2 = e2.nextInCol;
      }

      if (Math.abs(dest[2 * step]) + Math.abs(dest[2 * step + 1]) === 0.0) return zeroPivot(m, step);
      reciprocalAssign(m.diag[step], { real: dest[2 * step], imag: dest[2 * step + 1] });
    } else {
      const pDest = m.destPtr;
      for (let e = m.firstInCol[step]; e !== null; e = e.nextInCol) pDest[e.row] = e;

      let pColumn = m.firstInCol[step];
      while (pColumn.row < step) {
        let pElement = m.diag[pColumn.row];
        const tr = pDest[pColumn.row];
        const mr = tr.real * pElement.real - tr.imag * pElement.imag;
        const mi = tr.real * pElement.imag + tr.imag * pElement.real;
        tr.real = mr;
        tr.imag = mi;
        pElement = pElement.nextInCol;
        while (pElement !== null) {
          const te = pDest[pElement.row];
          te.real -= mr * pElement.real - mi * pElement.imag;
          te.imag -= mr * pElement.imag + mi * pElement.real;
          pElement = pElement.nextInCol;
        }
        pColumn = pColumn.nextInCol;
      }

      pElement = m.diag[step];
      if (elementMag(pElement) === 0.0) return zeroPivot(m, step);
      reciprocalAssign(pElement, pElement);
    }
  }

  m.factored = true;
  return (m.error = spOKAY);
}

/**
 * spPartition: выбор прямой/косвенной адресации по столбцам.
 * Счётчики Nc/No/Nm в C пишутся в массивы Markowitz (алиасинг), здесь — локальные:
 * до следующего CountMarkowitz их значения не читаются.
 */
export function spPartition(m, mode) {
  if (m.partitioned) return;
  const size = m.size;
  const doRealDirect = m.doRealDirect;
  const doCmplxDirect = m.doCmplxDirect;
  m.partitioned = true;

  if (mode === spDEFAULT_PARTITION) mode = DEFAULT_PARTITION;
  if (mode === spDIRECT_PARTITION) {
    for (let step = 1; step <= size; step++) {
      doRealDirect[step] = 1;
      doCmplxDirect[step] = 1;
    }
    return;
  } else if (mode === spINDIRECT_PARTITION) {
    for (let step = 1; step <= size; step++) {
      doRealDirect[step] = 0;
      doCmplxDirect[step] = 0;
    }
    return;
  }
  // spAUTO_PARTITION

  const nc = new Int32Array(size + 1);
  const no = new Int32Array(size + 1);
  const nm = new Int32Array(size + 1);

  for (let step = 1; step <= size; step++) {
    nc[step] = 0;
    no[step] = 0;
    nm[step] = 0;

    for (let e = m.firstInCol[step]; e !== null; e = e.nextInCol) nc[step]++;

    let pColumn = m.firstInCol[step];
    while (pColumn.row < step) {
      let pElement = m.diag[pColumn.row];
      nm[step]++;
      pElement = pElement.nextInCol;
      while (pElement !== null) {
        no[step]++;
        pElement = pElement.nextInCol;
      }
      pColumn = pColumn.nextInCol;
    }
  }

  for (let step = 1; step <= size; step++) {
    doRealDirect[step] = nm[step] + no[step] > 3 * nc[step] - 2 * nm[step] ? 1 : 0;
    doCmplxDirect[step] = nm[step] + no[step] > 7 * nc[step] - 4 * nm[step] ? 1 : 0;
  }
}

/** spcCreateInternalVectors: Markowitz/Do*Direct/Intermediate. */
export function spcCreateInternalVectors(m) {
  const size = m.size;
  if (m.markowitzRow === null) m.markowitzRow = new Int32Array(size + 1);
  if (m.markowitzCol === null) m.markowitzCol = new Int32Array(size + 1);
  if (m.markowitzProd === null) m.markowitzProd = new Float64Array(size + 2);
  if (m.doRealDirect === null) m.doRealDirect = new Uint8Array(size + 1);
  if (m.doCmplxDirect === null) m.doCmplxDirect = new Uint8Array(size + 1);
  if (m.intermediate === null) m.intermediate = new Float64Array(2 * (size + 1));
  if (m.destPtr === null) m.destPtr = new Array(size + 1).fill(null);
  m.internalVectorsAllocated = true;
}

/** CountMarkowitz: счётчики Markowitz для строк и столбцов. */
function countMarkowitz(m, rhs, step) {
  const size = m.size;
  for (let i = step; i <= size; i++) {
    let count = -1;
    let e = m.firstInRow[i];
    while (e !== null && e.col < step) e = e.nextInRow;
    while (e !== null) {
      count++;
      e = e.nextInRow;
    }
    const extRow = m.intToExtRowMap[i];
    if (rhs !== null && rhs[extRow] !== 0.0) count++;
    m.markowitzRow[i] = count;
  }
  for (let i = step; i <= size; i++) {
    let count = -1;
    let e = m.firstInCol[i];
    while (e !== null && e.row < step) e = e.nextInCol;
    while (e !== null) {
      count++;
      e = e.nextInCol;
    }
    m.markowitzCol[i] = count;
  }
}

/** MarkowitzProducts: произведения счётчиков + число singleton-пивотов. */
function markowitzProducts(m, step) {
  const size = m.size;
  m.singletons = 0;
  for (let i = step; i <= size; i++) {
    let product;
    if (
      (m.markowitzRow[i] > LARGEST_SHORT_INTEGER && m.markowitzCol[i] !== 0) ||
      (m.markowitzCol[i] > LARGEST_SHORT_INTEGER && m.markowitzRow[i] !== 0)
    ) {
      const f = m.markowitzRow[i] * m.markowitzCol[i];
      product = f >= LARGEST_LONG_INTEGER ? LARGEST_LONG_INTEGER : f;
    } else {
      product = m.markowitzRow[i] * m.markowitzCol[i];
    }
    m.markowitzProd[i] = product;
    if (product === 0) m.singletons++;
  }
}

/** SearchForPivot: singleton → быстрый/полный поиск по диагонали → вся матрица. */
function searchForPivot(m, step, diagPivoting) {
  if (m.singletons) {
    const chosen = searchForSingleton(m, step);
    if (chosen !== null) {
      m.pivotSelectionMethod = 's';
      return chosen;
    }
  }
  // DIAGONAL_PIVOTING=YES
  if (diagPivoting) {
    let chosen = quicklySearchDiagonal(m, step);
    if (chosen !== null) {
      m.pivotSelectionMethod = 'q';
      return chosen;
    }
    chosen = searchDiagonal(m, step);
    if (chosen !== null) {
      m.pivotSelectionMethod = 'd';
      return chosen;
    }
  }
  const chosen = searchEntireMatrix(m, step);
  m.pivotSelectionMethod = 'e';
  return chosen;
}

/**
 * SearchForSingleton: поиск singleton-пивота.
 * ВНИМАНИЕ: ниже 1:1 воспроизведён и «странный» код оригинала:
 * ветка `ChosenPivot != NULL → break` перед разыменованием NULL —
 * это недостижимый мёртвый код (MarkowitzCol[I]==0 гарантирует элемент),
 * но его наличие важно для точного соответствия (см. spfactor.c F4).
 */
function searchForSingleton(m, step) {
  let p = m.size + 1;
  m.markowitzProd[m.size + 1] = m.markowitzProd[step];
  let singletons = m.singletons--;
  m.markowitzProd[step - 1] = 0;

  while (singletons-- > 0) {
    while (m.markowitzProd[p--] !== 0) {
      /* пусто */
    }
    let i = p + 1;
    if (i < step) break;
    if (i > m.size) i = step;

    let chosenPivot = m.diag[i];
    if (chosenPivot !== null && chosenPivot !== undefined) {
      const pivotMag = elementMag(chosenPivot);
      if (
        pivotMag > m.absThreshold &&
        pivotMag > m.relThreshold * findBiggestInColExclude(m, chosenPivot, step)
      ) {
        return chosenPivot;
      }
    } else {
      if (m.markowitzCol[i] === 0) {
        chosenPivot = m.firstInCol[i];
        while (chosenPivot !== null && chosenPivot.row < step) chosenPivot = chosenPivot.nextInCol;
        if (chosenPivot !== null) {
          // «Reduced column has no elements, matrix is singular.» — так в F4.
          break;
        }
        const pivotMag = elementMag(chosenPivot); // недостижимо (см. комментарий выше)
        if (
          pivotMag > m.absThreshold &&
          pivotMag > m.relThreshold * findBiggestInColExclude(m, chosenPivot, step)
        ) {
          return chosenPivot;
        } else if (m.markowitzRow[i] === 0) {
          chosenPivot = m.firstInRow[i];
          while (chosenPivot !== null && chosenPivot.col < step) chosenPivot = chosenPivot.nextInRow;
          if (chosenPivot !== null) {
            break;
          }
          const pivotMag2 = elementMag(chosenPivot); // недостижимо
          if (
            pivotMag2 > m.absThreshold &&
            pivotMag2 > m.relThreshold * findBiggestInColExclude(m, chosenPivot, step)
          ) {
            return chosenPivot;
          }
        }
      } else {
        chosenPivot = m.firstInRow[i];
        while (chosenPivot !== null && chosenPivot.col < step) chosenPivot = chosenPivot.nextInRow;
        if (chosenPivot !== null) {
          break;
        }
        const pivotMag = elementMag(chosenPivot); // недостижимо
        if (
          pivotMag > m.absThreshold &&
          pivotMag > m.relThreshold * findBiggestInColExclude(m, chosenPivot, step)
        ) {
          return chosenPivot;
        }
      }
    }
  }

  m.singletons++;
  return null;
}

/**
 * QuicklySearchDiagonal (ветка MODIFIED_MARKOWITZ=NO): быстрый проход по диагонали.
 * Сканирование идёт по убыванию индекса с «часовым» -1 в позиции Step-1.
 */
function quicklySearchDiagonal(m, step) {
  let chosenPivot = null;
  let minMarkowitzProduct = LARGEST_LONG_INTEGER;
  let p = m.size + 2;
  m.markowitzProd[m.size + 1] = m.markowitzProd[step];
  m.markowitzProd[step - 1] = -1;

  for (;;) {
    while (m.markowitzProd[--p] >= minMarkowitzProduct) {
      /* пусто */
    }
    const i = p;
    if (i < step) break;
    let idx = i;
    if (idx > m.size) idx = step;

    const pDiag = m.diag[idx];
    if (pDiag === null || pDiag === undefined) continue;
    const magnitude = elementMag(pDiag);
    if (magnitude <= m.absThreshold) continue;

    if (m.markowitzProd[p] === 1) {
      // Единственный элемент в строке и столбце, кроме диагонали.
      let pOtherInRow = pDiag.nextInRow;
      let pOtherInCol = pDiag.nextInCol;
      if (pOtherInRow === null && pOtherInCol === null) {
        pOtherInRow = m.firstInRow[idx];
        while (pOtherInRow !== null) {
          if (pOtherInRow.col >= step && pOtherInRow.col !== idx) break;
          pOtherInRow = pOtherInRow.nextInRow;
        }
        pOtherInCol = m.firstInCol[idx];
        while (pOtherInCol !== null) {
          if (pOtherInCol.row >= step && pOtherInCol.row !== idx) break;
          pOtherInCol = pOtherInCol.nextInCol;
        }
      }
      if (pOtherInRow !== null && pOtherInCol !== null) {
        if (pOtherInRow.col === pOtherInCol.row) {
          const largestOffDiagonal = Math.max(elementMag(pOtherInRow), elementMag(pOtherInCol));
          if (magnitude >= largestOffDiagonal) {
            return pDiag;
          }
        }
      }
    }

    minMarkowitzProduct = m.markowitzProd[p];
    chosenPivot = pDiag;
  }

  if (chosenPivot !== null) {
    const largestInCol = findBiggestInColExclude(m, chosenPivot, step);
    if (elementMag(chosenPivot) <= m.relThreshold * largestInCol) chosenPivot = null;
  }
  return chosenPivot;
}

/** SearchDiagonal: полный проход по диагонали с проверкой численного качества. */
function searchDiagonal(m, step) {
  const size = m.size;
  let chosenPivot = null;
  let minMarkowitzProduct = LARGEST_LONG_INTEGER;
  let p = size + 2;
  m.markowitzProd[size + 1] = m.markowitzProd[step];
  let numberOfTies = 0;
  let ratioOfAccepted = 0.0;

  for (let j = size + 1; j > step; j--) {
    if (m.markowitzProd[--p] > minMarkowitzProduct) continue;

    const i = j > size ? step : j;
    const pDiag = m.diag[i];
    if (pDiag === null || pDiag === undefined) continue;
    const magnitude = elementMag(pDiag);
    if (magnitude <= m.absThreshold) continue;

    const largestInCol = findBiggestInColExclude(m, pDiag, step);
    if (magnitude <= m.relThreshold * largestInCol) continue;

    if (m.markowitzProd[p] < minMarkowitzProduct) {
      chosenPivot = pDiag;
      minMarkowitzProduct = m.markowitzProd[p];
      ratioOfAccepted = largestInCol / magnitude;
      numberOfTies = 0;
    } else {
      numberOfTies++;
      const ratio = largestInCol / magnitude;
      if (ratio < ratioOfAccepted) {
        chosenPivot = pDiag;
        ratioOfAccepted = ratio;
      }
      if (numberOfTies >= minMarkowitzProduct * TIES_MULTIPLIER) return chosenPivot;
    }
  }
  return chosenPivot;
}

/** SearchEntireMatrix: поиск по всей матрице (последний шанс). */
function searchEntireMatrix(m, step) {
  const size = m.size;
  let chosenPivot = null;
  let largestElementMag = 0.0;
  let minMarkowitzProduct = LARGEST_LONG_INTEGER;
  let pLargestElement = null;
  let numberOfTies = 0;
  let ratioOfAccepted = 0.0;

  for (let i = step; i <= size; i++) {
    let pElement = m.firstInCol[i];
    while (pElement !== null && pElement.row < step) pElement = pElement.nextInCol;
    const largestInCol = findLargestInCol(pElement);
    if (largestInCol === 0.0) continue;

    while (pElement !== null) {
      const magnitude = elementMag(pElement);
      if (magnitude > largestElementMag) {
        largestElementMag = magnitude;
        pLargestElement = pElement;
      }
      const product = m.markowitzRow[pElement.row] * m.markowitzCol[pElement.col];
      if (
        product <= minMarkowitzProduct &&
        magnitude > m.relThreshold * largestInCol &&
        magnitude > m.absThreshold
      ) {
        if (product < minMarkowitzProduct) {
          chosenPivot = pElement;
          minMarkowitzProduct = product;
          ratioOfAccepted = largestInCol / magnitude;
          numberOfTies = 0;
        } else {
          numberOfTies++;
          const ratio = largestInCol / magnitude;
          if (ratio < ratioOfAccepted) {
            chosenPivot = pElement;
            ratioOfAccepted = ratio;
          }
          if (numberOfTies >= minMarkowitzProduct * TIES_MULTIPLIER) return chosenPivot;
        }
      }
      pElement = pElement.nextInCol;
    }
  }

  if (chosenPivot !== null) return chosenPivot;
  if (largestElementMag === 0.0) {
    m.error = spSINGULAR;
    return null;
  }
  m.error = spSMALL_PIVOT; // в этой сборке == spOKAY
  return pLargestElement;
}

/** FindLargestInCol: максимальная |элемент| в столбце начиная с pElement. */
function findLargestInCol(pElement) {
  let largest = 0.0;
  while (pElement !== null) {
    const magnitude = elementMag(pElement);
    if (magnitude > largest) largest = magnitude;
    pElement = pElement.nextInCol;
  }
  return largest;
}

/** FindBiggestInColExclude: максимальный элемент столбца, кроме данного. */
function findBiggestInColExclude(m, pElement, step) {
  const row = pElement.row;
  const col = pElement.col;
  pElement = m.firstInCol[col];
  while (pElement !== null && pElement.row < step) pElement = pElement.nextInCol;

  let largest;
  if (pElement.row !== row) largest = elementMag(pElement);
  else largest = 0.0;

  while ((pElement = pElement.nextInCol) !== null) {
    const magnitude = elementMag(pElement);
    if (magnitude > largest) {
      if (pElement.row !== row) largest = magnitude;
    }
  }
  return largest;
}

/** ExchangeRowsAndCols: перестановка выбранного пивота на позицию Step. */
function exchangeRowsAndCols(m, pPivot, step) {
  const row = pPivot.row;
  const col = pPivot.col;
  m.pivotsOriginalRow = row;
  m.pivotsOriginalCol = col;
  if (row === step && col === step) return;

  if (row === col) {
    spcRowExchange(m, step, row);
    spcColExchange(m, step, col);
    {
      const t = m.markowitzProd[step];
      m.markowitzProd[step] = m.markowitzProd[row];
      m.markowitzProd[row] = t;
    }
    {
      const t = m.diag[row];
      m.diag[row] = m.diag[step];
      m.diag[step] = t;
    }
  } else {
    const oldMarkowitzProdStep = m.markowitzProd[step];
    const oldMarkowitzProdRow = m.markowitzProd[row];
    const oldMarkowitzProdCol = m.markowitzProd[col];
    if (row !== step) {
      spcRowExchange(m, step, row);
      m.numberOfInterchangesIsOdd = !m.numberOfInterchangesIsOdd;
      m.markowitzProd[row] = m.markowitzRow[row] * m.markowitzCol[row];
      if ((m.markowitzProd[row] === 0) !== (oldMarkowitzProdRow === 0)) {
        if (oldMarkowitzProdRow === 0) m.singletons--;
        else m.singletons++;
      }
    }
    if (col !== step) {
      spcColExchange(m, step, col);
      m.numberOfInterchangesIsOdd = !m.numberOfInterchangesIsOdd;
      m.markowitzProd[col] = m.markowitzCol[col] * m.markowitzRow[col];
      if ((m.markowitzProd[col] === 0) !== (oldMarkowitzProdCol === 0)) {
        if (oldMarkowitzProdCol === 0) m.singletons--;
        else m.singletons++;
      }
      m.diag[col] = findElementInCol(m, col, col, false);
    }
    if (row !== step) {
      m.diag[row] = findElementInCol(m, row, row, false);
    }
    m.diag[step] = findElementInCol(m, step, step, false);
    m.markowitzProd[step] = m.markowitzCol[step] * m.markowitzRow[step];
    if ((m.markowitzProd[step] === 0) !== (oldMarkowitzProdStep === 0)) {
      if (oldMarkowitzProdStep === 0) m.singletons--;
      else m.singletons++;
    }
  }
}

/** spcRowExchange: обмен двух строк. */
export function spcRowExchange(m, row1, row2) {
  if (row1 > row2) {
    const t = row1;
    row1 = row2;
    row2 = t;
  }
  let p1 = m.firstInRow[row1];
  let p2 = m.firstInRow[row2];
  while (p1 !== null || p2 !== null) {
    let column;
    let e1;
    let e2;
    if (p1 === null) {
      column = p2.col;
      e1 = null;
      e2 = p2;
      p2 = p2.nextInRow;
    } else if (p2 === null) {
      column = p1.col;
      e1 = p1;
      e2 = null;
      p1 = p1.nextInRow;
    } else if (p1.col < p2.col) {
      column = p1.col;
      e1 = p1;
      e2 = null;
      p1 = p1.nextInRow;
    } else if (p1.col > p2.col) {
      column = p2.col;
      e1 = null;
      e2 = p2;
      p2 = p2.nextInRow;
    } else {
      column = p1.col;
      e1 = p1;
      e2 = p2;
      p1 = p1.nextInRow;
      p2 = p2.nextInRow;
    }
    exchangeColElements(m, row1, e1, row2, e2, column);
  }
  if (m.internalVectorsAllocated) {
    const t = m.markowitzRow[row1];
    m.markowitzRow[row1] = m.markowitzRow[row2];
    m.markowitzRow[row2] = t;
  }
  {
    const t = m.firstInRow[row1];
    m.firstInRow[row1] = m.firstInRow[row2];
    m.firstInRow[row2] = t;
  }
  {
    const t = m.intToExtRowMap[row1];
    m.intToExtRowMap[row1] = m.intToExtRowMap[row2];
    m.intToExtRowMap[row2] = t;
  }
  m.extToIntRowMap[m.intToExtRowMap[row1]] = row1;
  m.extToIntRowMap[m.intToExtRowMap[row2]] = row2;
}

/** spcColExchange: обмен двух столбцов. */
export function spcColExchange(m, col1, col2) {
  if (col1 > col2) {
    const t = col1;
    col1 = col2;
    col2 = t;
  }
  let p1 = m.firstInCol[col1];
  let p2 = m.firstInCol[col2];
  while (p1 !== null || p2 !== null) {
    let row;
    let e1;
    let e2;
    if (p1 === null) {
      row = p2.row;
      e1 = null;
      e2 = p2;
      p2 = p2.nextInCol;
    } else if (p2 === null) {
      row = p1.row;
      e1 = p1;
      e2 = null;
      p1 = p1.nextInCol;
    } else if (p1.row < p2.row) {
      row = p1.row;
      e1 = p1;
      e2 = null;
      p1 = p1.nextInCol;
    } else if (p1.row > p2.row) {
      row = p2.row;
      e1 = null;
      e2 = p2;
      p2 = p2.nextInCol;
    } else {
      row = p1.row;
      e1 = p1;
      e2 = p2;
      p1 = p1.nextInCol;
      p2 = p2.nextInCol;
    }
    exchangeRowElements(m, col1, e1, col2, e2, row);
  }
  if (m.internalVectorsAllocated) {
    const t = m.markowitzCol[col1];
    m.markowitzCol[col1] = m.markowitzCol[col2];
    m.markowitzCol[col2] = t;
  }
  {
    const t = m.firstInCol[col1];
    m.firstInCol[col1] = m.firstInCol[col2];
    m.firstInCol[col2] = t;
  }
  {
    const t = m.intToExtColMap[col1];
    m.intToExtColMap[col1] = m.intToExtColMap[col2];
    m.intToExtColMap[col2] = t;
  }
  m.extToIntColMap[m.intToExtColMap[col1]] = col1;
  m.extToIntColMap[m.intToExtColMap[col2]] = col2;
}

/** ExchangeColElements: обмен элементов (Row1, Column) и (Row2, Column) в столбце. */
function exchangeColElements(m, row1, e1, row2, e2, column) {
  let above1 = headSlot(m.firstInCol, column);
  let p = above1.get();
  while (p.row < row1) {
    above1 = fieldSlot(p, 'nextInCol');
    p = above1.get();
  }

  if (e1 !== null) {
    const below1 = e1.nextInCol;
    if (e2 === null) {
      if (below1 !== null && below1.row < row2) {
        above1.set(below1);
        p = below1;
        let above2;
        do {
          above2 = fieldSlot(p, 'nextInCol');
          p = above2.get();
        } while (p !== null && p.row < row2);
        above2.set(e1);
        e1.nextInCol = p;
        above1.set(below1);
      }
      e1.row = row2;
    } else {
      if (below1.row === row2) {
        e1.nextInCol = e2.nextInCol;
        e2.nextInCol = e1;
        above1.set(e2);
      } else {
        p = below1;
        let above2;
        do {
          above2 = fieldSlot(p, 'nextInCol');
          p = above2.get();
        } while (p.row < row2);
        const below2 = e2.nextInCol;
        above1.set(e2);
        e2.nextInCol = below1;
        above2.set(e1);
        e1.nextInCol = below2;
      }
      e1.row = row2;
      e2.row = row1;
    }
  } else {
    const below1 = p;
    if (below1.row !== row2) {
      let above2;
      do {
        above2 = fieldSlot(p, 'nextInCol');
        p = above2.get();
      } while (p.row < row2);
      above2.set(e2.nextInCol);
      above1.set(e2);
      e2.nextInCol = below1;
    }
    e2.row = row1;
  }
}

/** ExchangeRowElements: обмен элементов (Row, Col1) и (Row, Col2) в строке. */
function exchangeRowElements(m, col1, e1, col2, e2, row) {
  let left1 = headSlot(m.firstInRow, row);
  let p = left1.get();
  while (p.col < col1) {
    left1 = fieldSlot(p, 'nextInRow');
    p = left1.get();
  }

  if (e1 !== null) {
    const right1 = e1.nextInRow;
    if (e2 === null) {
      if (right1 !== null && right1.col < col2) {
        left1.set(right1);
        p = right1;
        let left2;
        do {
          left2 = fieldSlot(p, 'nextInRow');
          p = left2.get();
        } while (p !== null && p.col < col2);
        left2.set(e1);
        e1.nextInRow = p;
        left1.set(right1);
      }
      e1.col = col2;
    } else {
      if (right1.col === col2) {
        e1.nextInRow = e2.nextInRow;
        e2.nextInRow = e1;
        left1.set(e2);
      } else {
        p = right1;
        let left2;
        do {
          left2 = fieldSlot(p, 'nextInRow');
          p = left2.get();
        } while (p.col < col2);
        const right2 = e2.nextInRow;
        left1.set(e2);
        e2.nextInRow = right1;
        left2.set(e1);
        e1.nextInRow = right2;
      }
      e1.col = col2;
      e2.col = col1;
    }
  } else {
    const right1 = p;
    if (right1.col !== col2) {
      let left2;
      do {
        left2 = fieldSlot(p, 'nextInRow');
        p = left2.get();
      } while (p.col < col2);
      left2.set(e2.nextInRow);
      left1.set(e2);
      e2.nextInRow = right1;
    }
    e2.col = col1;
  }
}

/** RealRowColElimination: исключение шага (реальный случай). */
function realRowColElimination(m, pPivot) {
  if (Math.abs(pPivot.real) === 0.0) {
    matrixIsSingular(m, pPivot.row);
    return;
  }
  pPivot.real = 1.0 / pPivot.real;
  let pUpper = pPivot.nextInRow;
  while (pUpper !== null) {
    pUpper.real *= pPivot.real;
    let pSub = pUpper.nextInCol;
    let pLower = pPivot.nextInCol;
    while (pLower !== null) {
      const row = pLower.row;
      while (pSub !== null && pSub.row < row) pSub = pSub.nextInCol;
      if (pSub === null || pSub.row > row) {
        pSub = createFillin(m, row, pUpper.col);
        if (pSub === null) {
          m.error = spNO_MEMORY;
          return;
        }
      }
      pSub.real -= pUpper.real * pLower.real;
      pSub = pSub.nextInCol;
      pLower = pLower.nextInCol;
    }
    pUpper = pUpper.nextInRow;
  }
}

/** ComplexRowColElimination: исключение шага (комплексный случай). */
function complexRowColElimination(m, pPivot) {
  if (elementMag(pPivot) === 0.0) {
    matrixIsSingular(m, pPivot.row);
    return;
  }
  reciprocalAssign(pPivot, pPivot);
  let pUpper = pPivot.nextInRow;
  while (pUpper !== null) {
    {
      const tr = pUpper.real;
      pUpper.real = tr * pPivot.real - pUpper.imag * pPivot.imag;
      pUpper.imag = tr * pPivot.imag + pUpper.imag * pPivot.real;
    }
    let pSub = pUpper.nextInCol;
    let pLower = pPivot.nextInCol;
    while (pLower !== null) {
      const row = pLower.row;
      while (pSub !== null && pSub.row < row) pSub = pSub.nextInCol;
      if (pSub === null || pSub.row > row) {
        pSub = createFillin(m, row, pUpper.col);
        if (pSub === null) {
          m.error = spNO_MEMORY;
          return;
        }
      }
      pSub.real -= pUpper.real * pLower.real - pUpper.imag * pLower.imag;
      pSub.imag -= pUpper.real * pLower.imag + pUpper.imag * pLower.real;
      pSub = pSub.nextInCol;
      pLower = pLower.nextInCol;
    }
    pUpper = pUpper.nextInRow;
  }
}

/** UpdateMarkowitzNumbers: пересчёт счётчиков после выбора пивота. */
function updateMarkowitzNumbers(m, pPivot) {
  const markoRow = m.markowitzRow;
  const markoCol = m.markowitzCol;
  for (let colPtr = pPivot.nextInCol; colPtr !== null; colPtr = colPtr.nextInCol) {
    const row = colPtr.row;
    --markoRow[row];
    if (
      (markoRow[row] > LARGEST_SHORT_INTEGER && markoCol[row] !== 0) ||
      (markoCol[row] > LARGEST_SHORT_INTEGER && markoRow[row] !== 0)
    ) {
      const product = markoCol[row] * markoRow[row];
      m.markowitzProd[row] = product >= LARGEST_LONG_INTEGER ? LARGEST_LONG_INTEGER : product;
    } else {
      m.markowitzProd[row] = markoRow[row] * markoCol[row];
    }
    if (markoRow[row] === 0) m.singletons++;
  }
  for (let rowPtr = pPivot.nextInRow; rowPtr !== null; rowPtr = rowPtr.nextInRow) {
    const col = rowPtr.col;
    --markoCol[col];
    if (
      (markoRow[col] > LARGEST_SHORT_INTEGER && markoCol[col] !== 0) ||
      (markoCol[col] > LARGEST_SHORT_INTEGER && markoRow[col] !== 0)
    ) {
      const product = markoCol[col] * markoRow[col];
      m.markowitzProd[col] = product >= LARGEST_LONG_INTEGER ? LARGEST_LONG_INTEGER : product;
    } else {
      m.markowitzProd[col] = markoRow[col] * markoCol[col];
    }
    if (markoCol[col] === 0 && markoRow[col] !== 0) m.singletons++;
  }
}

/** CreateFillin: создание fill-in элемента (Row, Col) с обновлением Markowitz. */
function createFillin(m, row, col) {
  let ppElementAbove = headSlot(m.firstInCol, col);
  let pElement = ppElementAbove.get();
  while (pElement !== null) {
    if (pElement.row < row) {
      ppElementAbove = fieldSlot(pElement, 'nextInCol');
      pElement = ppElementAbove.get();
    } else {
      break;
    }
  }
  pElement = createElementBeforeSlot(m, row, col, ppElementAbove, true);
  m.markowitzProd[row] = ++m.markowitzRow[row] * m.markowitzCol[row];
  if (m.markowitzRow[row] === 1 && m.markowitzCol[row] !== 0) m.singletons--;
  m.markowitzProd[col] = ++m.markowitzCol[col] * m.markowitzRow[col];
  if (m.markowitzRow[col] !== 0 && m.markowitzCol[col] === 1) m.singletons--;
  return pElement;
}

/**
 * createElementBeforeSlot: вариант spcCreateElement для вставки «по слоту»
 * (как `*LastAddr = pElement` в C).
 */
function createElementBeforeSlot(m, row, col, slot, fillin) {
  const next = slot.get();
  const e = newElement();
  if (m.rowsLinked) {
    if (fillin) {
      m.fillins++;
    } else {
      m.needsOrdering = true;
    }
    if (row === col) m.diag[row] = e;
    e.row = row;
    e.col = col;
    e.nextInCol = next;
    slot.set(e);
    // вставка в строку по возрастанию Col
    let p = m.firstInRow[row];
    let pLast = null;
    while (p !== null) {
      if (p.col < col) {
        pLast = p;
        p = p.nextInRow;
      } else {
        p = null;
      }
    }
    if (pLast === null) {
      e.nextInRow = m.firstInRow[row];
      m.firstInRow[row] = e;
    } else {
      e.nextInRow = pLast.nextInRow;
      pLast.nextInRow = e;
    }
  } else {
    if (row === col) m.diag[row] = e;
    e.row = row;
    // NB: Col НЕ присваивается до spcLinkRows — в C release-сборке он
    // инициализируется только под `#if DEBUG` (spcCreateElement), то есть
    // алгоритмы до линковки строк его не читают, а дампы нормализуют к 0.
    e.nextInCol = next;
    slot.set(e);
  }
  m.elements++;
  return e;
}

/** MatrixIsSingular. */
function matrixIsSingular(m, step) {
  m.singularRow = m.intToExtRowMap[step];
  m.singularCol = m.intToExtColMap[step];
  return (m.error = spSINGULAR);
}

/** ZeroPivot. */
function zeroPivot(m, step) {
  m.singularRow = m.intToExtRowMap[step];
  m.singularCol = m.intToExtColMap[step];
  return (m.error = spZERO_DIAG);
}

// ─────────────────────────────────── РЕШЕНИЕ СИСТЕМЫ (spsolve.c) ───────────────────────────────────

/**
 * spSolve: решение факторизованной системы (прямой+обратный ход).
 * IMAG_VECTORS из spdefs.h в этой сборке = `, iRHS, iSolution` (векторы раздельные).
 * Реальный случай iRHS/iSolution игнорирует.
 */
export function spSolve(m, rhs, solution, iRhs = null, iSolution = null) {
  if (m.complex) {
    solveComplexMatrix(m, rhs, solution, iRhs, iSolution);
    return;
  }

  const intermediate = m.intermediate;
  const size = m.size;

  // Intermediate[I] = RHS[IntToExtRowMap[Size-I+1]] (порядок обхода Size..1)
  let pExtOrder = size;
  for (let i = size; i > 0; i--) intermediate[i] = rhs[m.intToExtRowMap[pExtOrder--]];

  // Прямой ход: L (по столбцам, начиная с диагонали).
  for (let i = 1; i <= size; i++) {
    let temp = intermediate[i];
    if (temp !== 0.0) {
      const pPivot = m.diag[i];
      temp *= pPivot.real;
      intermediate[i] = temp;
      for (let e = pPivot.nextInCol; e !== null; e = e.nextInCol) {
        intermediate[e.row] -= temp * e.real;
      }
    }
  }

  // Обратный ход: U (по строкам, с конца).
  for (let i = size; i > 0; i--) {
    let temp = intermediate[i];
    for (let e = m.diag[i].nextInRow; e !== null; e = e.nextInRow) {
      temp -= e.real * intermediate[e.col];
    }
    intermediate[i] = temp;
  }

  pExtOrder = size;
  for (let i = size; i > 0; i--) solution[m.intToExtColMap[pExtOrder--]] = intermediate[i];
}

/**
 * SolveComplexMatrix: раздельные RHS/iRHS, промежуточный вектор — пары
 * [2i]=Real, [2i+1]=Imag (как ComplexVector поверх Matrix->Intermediate).
 */
function solveComplexMatrix(m, rhs, solution, iRhs, iSolution) {
  const intermediate = m.intermediate;
  const size = m.size;
  let pExtOrder = size;
  for (let i = size; i > 0; i--) {
    const ext = m.intToExtRowMap[pExtOrder--];
    intermediate[2 * i] = rhs[ext];
    intermediate[2 * i + 1] = iRhs[ext];
  }

  // Прямой ход.
  for (let i = 1; i <= size; i++) {
    let tr = intermediate[2 * i];
    let ti = intermediate[2 * i + 1];
    if (tr !== 0.0 || ti !== 0.0) {
      const pPivot = m.diag[i];
      // CMPLX_MULT_ASSIGN(Temp, *pPivot)
      const nr = tr * pPivot.real - ti * pPivot.imag;
      const ni = tr * pPivot.imag + ti * pPivot.real;
      tr = nr;
      ti = ni;
      intermediate[2 * i] = tr;
      intermediate[2 * i + 1] = ti;
      for (let e = pPivot.nextInCol; e !== null; e = e.nextInCol) {
        const k = 2 * e.row;
        // CMPLX_MULT_SUBT_ASSIGN(Intermediate[Row], Temp, *pElement)
        intermediate[k] -= tr * e.real - ti * e.imag;
        intermediate[k + 1] -= tr * e.imag + ti * e.real;
      }
    }
  }

  // Обратный ход.
  for (let i = size; i > 0; i--) {
    let tr = intermediate[2 * i];
    let ti = intermediate[2 * i + 1];
    for (let e = m.diag[i].nextInRow; e !== null; e = e.nextInRow) {
      const k = 2 * e.col;
      // CMPLX_MULT_SUBT_ASSIGN(Temp, *pElement, Intermediate[Col])
      tr -= e.real * intermediate[k] - e.imag * intermediate[k + 1];
      ti -= e.real * intermediate[k + 1] + e.imag * intermediate[k];
    }
    intermediate[2 * i] = tr;
    intermediate[2 * i + 1] = ti;
  }

  pExtOrder = size;
  for (let i = size; i > 0; i--) {
    const ext = m.intToExtColMap[pExtOrder--];
    solution[ext] = intermediate[2 * i];
    iSolution[ext] = intermediate[2 * i + 1];
  }
}

/** spSolveTransposed: решение системы с транспонированной факторизованной матрицей. */
export function spSolveTransposed(m, rhs, solution, iRhs = null, iSolution = null) {
  if (m.complex) {
    solveComplexTransposedMatrix(m, rhs, solution, iRhs, iSolution);
    return;
  }

  const size = m.size;
  const intermediate = m.intermediate;

  // Intermediate[I] = RHS[IntToExtColMap[Size-I+1]]
  let pExtOrder = size;
  for (let i = size; i > 0; i--) intermediate[i] = rhs[m.intToExtColMap[pExtOrder--]];

  // Прямой ход по U^T.
  for (let i = 1; i <= size; i++) {
    const temp = intermediate[i];
    if (temp !== 0.0) {
      for (let e = m.diag[i].nextInRow; e !== null; e = e.nextInRow) {
        intermediate[e.col] -= temp * e.real;
      }
    }
  }

  // Обратный ход по L^T.
  for (let i = size; i > 0; i--) {
    const pPivot = m.diag[i];
    let temp = intermediate[i];
    for (let e = pPivot.nextInCol; e !== null; e = e.nextInCol) {
      temp -= e.real * intermediate[e.row];
    }
    intermediate[i] = temp * pPivot.real;
  }

  pExtOrder = size;
  for (let i = size; i > 0; i--) solution[m.intToExtRowMap[pExtOrder--]] = intermediate[i];
}

/** SolveComplexTransposedMatrix. */
function solveComplexTransposedMatrix(m, rhs, solution, iRhs, iSolution) {
  const size = m.size;
  const intermediate = m.intermediate;

  let pExtOrder = size;
  for (let i = size; i > 0; i--) {
    const ext = m.intToExtColMap[pExtOrder--];
    intermediate[2 * i] = rhs[ext];
    intermediate[2 * i + 1] = iRhs[ext];
  }

  for (let i = 1; i <= size; i++) {
    const tr = intermediate[2 * i];
    const ti = intermediate[2 * i + 1];
    if (tr !== 0.0 || ti !== 0.0) {
      for (let e = m.diag[i].nextInRow; e !== null; e = e.nextInRow) {
        const k = 2 * e.col;
        // CMPLX_MULT_SUBT_ASSIGN(Intermediate[Col], Temp, *pElement)
        intermediate[k] -= tr * e.real - ti * e.imag;
        intermediate[k + 1] -= tr * e.imag + ti * e.real;
      }
    }
  }

  for (let i = size; i > 0; i--) {
    const pPivot = m.diag[i];
    let tr = intermediate[2 * i];
    let ti = intermediate[2 * i + 1];
    for (let e = pPivot.nextInCol; e !== null; e = e.nextInCol) {
      const k = 2 * e.row;
      // CMPLX_MULT_SUBT_ASSIGN(Temp, Intermediate[Row], *pElement)
      tr -= intermediate[k] * e.real - intermediate[k + 1] * e.imag;
      ti -= intermediate[k] * e.imag + intermediate[k + 1] * e.real;
    }
    // CMPLX_MULT(Intermediate[I], Temp, *pPivot)
    intermediate[2 * i] = tr * pPivot.real - ti * pPivot.imag;
    intermediate[2 * i + 1] = tr * pPivot.imag + ti * pPivot.real;
  }

  pExtOrder = size;
  for (let i = size; i > 0; i--) {
    const ext = m.intToExtRowMap[pExtOrder--];
    solution[ext] = intermediate[2 * i];
    iSolution[ext] = intermediate[2 * i + 1];
  }
}

// ──────────────────────────────── УТИЛИТЫ МАТРИЦЫ (sputils.c) ────────────────────────────────

/**
 * spMNA_Preorder (MODIFIED_NODAL): для столбцов без диагонального элемента
 * ищем пару «близнецов» (±1 в (Row,Col) и (Col,Row)) и меняем столбцы местами.
 *
 * Квирк портирован 1:1: при двух и более парах близнецов (Twins > 1) ставится
 * флаг AnotherPassNeeded, и второй проход делает SwapCols БЕЗ проверки
 * Twins == 1 — свапается «последняя найденная» (или оставшаяся от прошлого
 * вызова) пара; результат в C не определён строго, но всегда существуют
 * валидные ссылки (возврат Twins >= 2 возможен только после присваивания
 * первой пары).
 */
export function spMNA_Preorder(m) {
  if (m.rowsLinked) return;
  const size = m.size;
  m.reordered = true;
  let startAt = 1;
  let swapped;
  let anotherPassNeeded;
  const twin1 = { v: null };
  const twin2 = { v: null };
  do {
    anotherPassNeeded = false;
    swapped = false;
    for (let j = startAt; j <= size; j++) {
      if (m.diag[j] === null) {
        const twins = countTwins(m, j, twin1, twin2);
        if (twins === 1) {
          swapCols(m, twin1.v, twin2.v);
          swapped = true;
        } else if (twins > 1 && !anotherPassNeeded) {
          anotherPassNeeded = true;
          startAt = j;
        }
      }
    }
    if (anotherPassNeeded) {
      for (let j = startAt; !swapped && j <= size; j++) {
        if (m.diag[j] === null) {
          countTwins(m, j, twin1, twin2); // квирк: результат Twins не проверяется
          swapCols(m, twin1.v, twin2.v);
          swapped = true;
        }
      }
    }
  } while (anotherPassNeeded);
}

/**
 * CountTwins: ищет пары ±1-«близнецов» в столбце Col. Возвращает их число,
 * а в twin1/twin2 кладёт последнюю найденную пару (до раннего выхода при 2+).
 * Побочно «чинит» поле Col у найденных элементов (как в C).
 */
function countTwins(m, col, twin1, twin2) {
  let twins = 0;
  let pTwin1 = m.firstInCol[col];
  while (pTwin1 !== null) {
    if (Math.abs(pTwin1.real) === 1.0) {
      const row = pTwin1.row;
      let pTwin2 = m.firstInCol[row];
      while (pTwin2 !== null && pTwin2.row !== col) pTwin2 = pTwin2.nextInCol;
      if (pTwin2 !== null && Math.abs(pTwin2.real) === 1.0) {
        if (++twins >= 2) return twins;
        pTwin1.col = col; // (*ppTwin1 = pTwin1)->Col = Col
        twin1.v = pTwin1;
        pTwin2.col = row; // (*ppTwin2 = pTwin2)->Col = Row
        twin2.v = pTwin2;
      }
    }
    pTwin1 = pTwin1.nextInCol;
  }
  return twins;
}

/** SwapCols: перестановка столбцов Col1/Col2 (головы, карты, Diag, чётность). */
function swapCols(m, pTwin1, pTwin2) {
  const col1 = pTwin1.col;
  const col2 = pTwin2.col;
  const t = m.firstInCol[col1];
  m.firstInCol[col1] = m.firstInCol[col2];
  m.firstInCol[col2] = t;
  const tMap = m.intToExtColMap[col1];
  m.intToExtColMap[col1] = m.intToExtColMap[col2];
  m.intToExtColMap[col2] = tMap;
  m.extToIntColMap[m.intToExtColMap[col2]] = col2;
  m.extToIntColMap[m.intToExtColMap[col1]] = col1;
  m.diag[col1] = pTwin2;
  m.diag[col2] = pTwin1;
  m.numberOfInterchangesIsOdd = !m.numberOfInterchangesIsOdd;
}

/**
 * spDeterminant (DETERMINANT): детерминант факторизованной матрицы.
 * В C параметры — выходные (pExponent, pDeterminant, piDeterminant);
 * здесь возвращается объект { exponent, real, imag } (imag = 0 для real).
 * Норма для масштабирования комплексного случая — L∞ (NORM из sputils.c).
 */
export function spDeterminant(m) {
  let exponent = 0;
  if (m.error === spSINGULAR) return { exponent, real: 0.0, imag: 0.0 };
  const size = m.size;
  if (m.complex) {
    let detReal = 1.0;
    let detImag = 0.0;
    const pivot = { real: 0.0, imag: 0.0 };
    for (let i = 1; i <= size; i++) {
      reciprocalAssign(pivot, m.diag[i]); // CMPLX_RECIPROCAL(Pivot, *Diag[I])
      // CMPLX_MULT_ASSIGN(cDeterminant, Pivot)
      const nr = detReal * pivot.real - detImag * pivot.imag;
      const ni = detReal * pivot.imag + detImag * pivot.real;
      detReal = nr;
      detImag = ni;
      let norm = Math.max(Math.abs(detReal), Math.abs(detImag));
      if (norm !== 0.0) {
        while (norm >= 1.0e12) {
          detReal *= 1.0e-12;
          detImag *= 1.0e-12;
          exponent += 12;
          norm = Math.max(Math.abs(detReal), Math.abs(detImag));
        }
        while (norm < 1.0e-12) {
          detReal *= 1.0e12;
          detImag *= 1.0e12;
          exponent -= 12;
          norm = Math.max(Math.abs(detReal), Math.abs(detImag));
        }
      }
    }
    let norm = Math.max(Math.abs(detReal), Math.abs(detImag));
    if (norm !== 0.0) {
      while (norm >= 10.0) {
        detReal *= 0.1;
        detImag *= 0.1;
        exponent++;
        norm = Math.max(Math.abs(detReal), Math.abs(detImag));
      }
      while (norm < 1.0) {
        detReal *= 10.0;
        detImag *= 10.0;
        exponent--;
        norm = Math.max(Math.abs(detReal), Math.abs(detImag));
      }
    }
    if (m.numberOfInterchangesIsOdd) {
      detReal = -detReal;
      detImag = -detImag;
    }
    return { exponent, real: detReal, imag: detImag };
  }

  let det = 1.0;
  for (let i = 1; i <= size; i++) {
    det /= m.diag[i].real;
    if (det !== 0.0) {
      while (Math.abs(det) >= 1.0e12) {
        det *= 1.0e-12;
        exponent += 12;
      }
      while (Math.abs(det) < 1.0e-12) {
        det *= 1.0e12;
        exponent -= 12;
      }
    }
  }
  if (det !== 0.0) {
    while (Math.abs(det) >= 10.0) {
      det *= 0.1;
      exponent++;
    }
    while (Math.abs(det) < 1.0) {
      det *= 10.0;
      exponent--;
    }
  }
  if (m.numberOfInterchangesIsOdd) det = -det;
  return { exponent, real: det, imag: 0.0 };
}

/**
 * spMultiply (MULTIPLICATION): RHS = A * Solution (A не факторизована).
 * IMAG_VECTORS (раздельные) — iRhs/iSolution.
 */
export function spMultiply(m, rhs, solution, iRhs = null, iSolution = null) {
  if (!m.rowsLinked) spcLinkRows(m);
  if (!m.internalVectorsAllocated) spcCreateInternalVectors(m);
  if (m.complex) {
    complexMatrixMultiply(m, rhs, solution, iRhs, iSolution);
    return;
  }

  const vector = m.intermediate;
  const size = m.size;
  let pExtOrder = size;
  for (let i = size; i > 0; i--) vector[i] = solution[m.intToExtColMap[pExtOrder--]];
  pExtOrder = size;
  for (let i = size; i > 0; i--) {
    let sum = 0.0;
    for (let e = m.firstInRow[i]; e !== null; e = e.nextInRow) {
      sum += e.real * vector[e.col];
    }
    rhs[m.intToExtRowMap[pExtOrder--]] = sum;
  }
}

/** ComplexMatrixMultiply. */
function complexMatrixMultiply(m, rhs, solution, iRhs, iSolution) {
  const vector = m.intermediate; // пары [2i], [2i+1]
  const size = m.size;
  let pExtOrder = size;
  for (let i = size; i > 0; i--) {
    const ext = m.intToExtColMap[pExtOrder--];
    vector[2 * i] = solution[ext];
    vector[2 * i + 1] = iSolution[ext];
  }
  pExtOrder = size;
  for (let i = size; i > 0; i--) {
    let sumReal = 0.0;
    let sumImag = 0.0;
    for (let e = m.firstInRow[i]; e !== null; e = e.nextInRow) {
      const k = 2 * e.col;
      // CMPLX_MULT_ADD_ASSIGN(Sum, *pElement, Vector[Col])
      sumReal += e.real * vector[k] - e.imag * vector[k + 1];
      sumImag += e.real * vector[k + 1] + e.imag * vector[k];
    }
    const ext = m.intToExtRowMap[pExtOrder--];
    rhs[ext] = sumReal;
    iRhs[ext] = sumImag;
  }
}

/** spMultTransposed (MULTIPLICATION AND TRANSPOSE): RHS = A^T * Solution. */
export function spMultTransposed(m, rhs, solution, iRhs = null, iSolution = null) {
  if (!m.internalVectorsAllocated) spcCreateInternalVectors(m);
  if (m.complex) {
    complexTransposedMatrixMultiply(m, rhs, solution, iRhs, iSolution);
    return;
  }

  const vector = m.intermediate;
  const size = m.size;
  let pExtOrder = size;
  for (let i = size; i > 0; i--) vector[i] = solution[m.intToExtRowMap[pExtOrder--]];
  pExtOrder = size;
  for (let i = size; i > 0; i--) {
    let sum = 0.0;
    for (let e = m.firstInCol[i]; e !== null; e = e.nextInCol) {
      sum += e.real * vector[e.row];
    }
    rhs[m.intToExtColMap[pExtOrder--]] = sum;
  }
}

/** ComplexTransposedMatrixMultiply. */
function complexTransposedMatrixMultiply(m, rhs, solution, iRhs, iSolution) {
  const vector = m.intermediate;
  const size = m.size;
  let pExtOrder = size;
  for (let i = size; i > 0; i--) {
    const ext = m.intToExtRowMap[pExtOrder--];
    vector[2 * i] = solution[ext];
    vector[2 * i + 1] = iSolution[ext];
  }
  pExtOrder = size;
  for (let i = size; i > 0; i--) {
    let sumReal = 0.0;
    let sumImag = 0.0;
    for (let e = m.firstInCol[i]; e !== null; e = e.nextInCol) {
      const k = 2 * e.row;
      // CMPLX_MULT_ADD_ASSIGN(Sum, *pElement, Vector[Row])
      sumReal += e.real * vector[k] - e.imag * vector[k + 1];
      sumImag += e.real * vector[k + 1] + e.imag * vector[k];
    }
    const ext = m.intToExtColMap[pExtOrder--];
    rhs[ext] = sumReal;
    iRhs[ext] = sumImag;
  }
}

// ───────────────────── СОВМЕСТИМОСТЬ С SMP (spsmp.c, модуль SPICE3) ─────────────────────

/** SMPaddElt: *spGetElement(Row, Col) = Value. */
export function SMPaddElt(m, row, col, value) {
  spGetElement(m, row, col).real = value;
  return spError(m);
}

/** SMPmakeElt: указатель на элемент (с созданием). */
export function SMPmakeElt(m, row, col) {
  return spGetElement(m, row, col);
}

/** SMPcClear. */
export function SMPcClear(m) {
  spClear(m);
}

/** SMPclear. */
export function SMPclear(m) {
  spClear(m);
}

/** SMPcLUfac: комплексная факторизация без переупорядочивания. */
export function SMPcLUfac(m, pivTol) {
  spSetComplex(m);
  return spFactor(m);
}

/** SMPluFac: реальная факторизация + gmin на диагональ. */
export function SMPluFac(m, pivTol, gmin) {
  spSetReal(m);
  loadGmin(m, gmin);
  return spFactor(m);
}

/**
 * SMPcReorder: комплексное упорядочивание+факторизация.
 * В C пишет *NumSwaps = 1; здесь NumSwaps не возвращается (в SPICE не читается).
 */
export function SMPcReorder(m, pivTol, pivRel) {
  spSetComplex(m);
  return spOrderAndFactor(m, null, pivRel, pivTol, true);
}

/** SMPreorder: реальное упорядочивание+факторизация + gmin. */
export function SMPreorder(m, pivTol, pivRel, gmin) {
  spSetReal(m);
  loadGmin(m, gmin);
  return spOrderAndFactor(m, null, pivRel, pivTol, true);
}

/** SMPcaSolve: решение транспонированной системой (in-place RHS/iRHS). */
export function SMPcaSolve(m, rhs, iRhs, spare, iSpare) {
  spSolveTransposed(m, rhs, rhs, iRhs, iRhs);
}

/** SMPcSolve: комплексное решение (in-place RHS/iRHS). */
export function SMPcSolve(m, rhs, iRhs, spare, iSpare) {
  spSolve(m, rhs, rhs, iRhs, iRhs);
}

/** SMPsolve: реальное решение (in-place RHS). */
export function SMPsolve(m, rhs, spare) {
  spSolve(m, rhs, rhs, null, null);
}

/** SMPmatSize: размер во внешней нумерации. */
export function SMPmatSize(m) {
  return spGetSize(m, 1);
}

/**
 * SMPnewMatrix: создать матрицу (в C — spCreate(0, 1, &Error) с output-параметром;
 * здесь возвращается сама матрица, ошибка доступна через spError).
 */
export function SMPnewMatrix() {
  return spCreate(0, 1);
}

/** SMPdestroy. */
export function SMPdestroy(m) {
  spDestroy(m);
}

/** SMPpreOrder: MNA-предупорядочивание; возвращает код ошибки. */
export function SMPpreOrder(m) {
  spMNA_Preorder(m);
  return spError(m);
}

/** SMPgetError: внешние номер строки/столбца вырожденного пивота. */
export function SMPgetError(m) {
  return spWhereSingular(m);
}

/** SMPcProdDiag: детерминант комплексной факторизованной матрицы (мантисса+экспонента). */
export function SMPcProdDiag(m) {
  const d = spDeterminant(m);
  return { error: spError(m), real: d.real, imag: d.imag, exponent: d.exponent };
}

/** logb из libm: целая экспонента по основанию 2 (для SMPcDProd). */
function logb(x) {
  const a = Math.abs(x);
  if (a === 0) return -Infinity;
  if (!Number.isFinite(a)) return a;
  let e = Math.floor(Math.log2(a));
  if (2 ** e > a) e -= 1;
  else if (2 ** (e + 1) <= a) e += 1;
  return e;
}

/** scalb из libm: x * 2^n (для SMPcDProd). */
function scalb(x, n) {
  return x * 2 ** n;
}

/**
 * SMPcDProd: детерминант в базе 2 (экспонента + нормализованная мантисса).
 * В C использовались logb/scalb/libm-функции; математика та же.
 */
export function SMPcDProd(m) {
  const M_LN2 = 0.69314718055994530942;
  const M_LN10 = 2.30258509299404568402;
  const d = spDeterminant(m);
  let re = d.real;
  let im = d.imag;
  const p = d.exponent;

  let y = (p * M_LN10) / M_LN2;
  const x = Math.trunc(y);
  y -= x;

  const z = 2 ** y;
  re *= z;
  im *= z;

  let yy;
  let zz;
  if (re !== 0.0) {
    yy = logb(re);
    if (im !== 0.0) zz = logb(im);
    else zz = 0;
  } else if (im !== 0.0) {
    zz = logb(im);
    yy = 0;
  } else {
    yy = 0;
    zz = 0;
  }
  if (yy < zz) yy = zz;

  const exponent = x + yy;
  return {
    error: spError(m),
    real: scalb(re, Math.trunc(-yy)),
    imag: scalb(im, Math.trunc(-yy)),
    exponent,
  };
}

/** LoadGmin (spsmp.c): добавить Gmin к каждому диагональному элементу. */
function loadGmin(m, gmin) {
  if (gmin !== 0.0) {
    for (let i = m.size; i > 0; i--) {
      const diag = m.diag[i];
      if (diag) diag.real += gmin;
    }
  }
}

/**
 * SMPfindElt: элемент (Row, Col) или null; CreateIfMissing — создать.
 *
 * Квирк 1:1 (есть и в F4, и в 3f5 — патч spsmp.patch его не меняет): функция
 * передаёт в spcFindElementInCol адрес ЛОКАЛЬНОЙ переменной
 * (`ElementPtr Element = Matrix->FirstInCol[Col]; ... &Element`), а не
 * `&FirstInCol[Col]`. Если вставка идёт «в голову» (столбец пуст, либо
 * создаваемый элемент первый по Row), сплайс уходит в локальный указатель:
 * элемент увеличивает Matrix->Elements (и попадает в Diag, если он
 * диагональный — тогда на него можно наткнуться через spGetElement), но в
 * цепочках столбца недостижим. Комментарий к spcFindElementInCol прямо
 * требует передавать адрес FirstInCol/NextInCol — это баг оригинала;
 * наблюдаемое поведение сохраняется (проверено golden-харнессом).
 *
 * NB: открытый вопрос линии предка — F4 без трансляции внешних индексов,
 * в 3f5-патче добавлены ExtToIntRowMap/ExtToIntColMap. Сверить с DLL позже.
 */
export function SMPfindElt(m, row, col, createIfMissing) {
  let local = m.firstInCol[col];
  const localSlot = { get: () => local, set: (e) => { local = e; } };
  return findElementInColSlot(m, localSlot, row, col, createIfMissing);
}

/** SMPcZeroCol: обнулить столбец (по внешнему номеру, с трансляцией). */
export function SMPcZeroCol(m, col) {
  col = m.extToIntColMap[col];
  for (let e = m.firstInCol[col]; e !== null; e = e.nextInCol) {
    e.real = 0.0;
    e.imag = 0.0;
  }
  return spError(m);
}

/** SMPcAddCol: Accum_Col += Addend_Col (по внешним номерам, с трансляцией). */
export function SMPcAddCol(m, accumCol, addendCol) {
  accumCol = m.extToIntColMap[accumCol];
  addendCol = m.extToIntColMap[addendCol];

  // В C здесь ведётся «указатель на указатель» Prev => слот nextInCol.
  let prev = headSlot(m.firstInCol, accumCol);
  let accum = prev.get();
  for (let addend = m.firstInCol[addendCol]; addend !== null; addend = addend.nextInCol) {
    while (accum !== null && accum.row < addend.row) {
      prev = fieldSlot(accum, 'nextInCol');
      accum = prev.get();
    }
    if (accum === null || accum.row > addend.row) {
      accum = createElementBeforeSlot(m, addend.row, accumCol, prev, false);
    }
    accum.real += addend.real;
    accum.imag += addend.imag;
  }
  return spError(m);
}

/**
 * SMPzeroRow: обнулить строку.
 * NB (квирк 1:1): внешний номер транслируется через ExtToIntColMap (не RowMap) —
 * так в spsmp.c F4; портировано как есть.
 */
export function SMPzeroRow(m, row) {
  row = m.extToIntColMap[row];
  if (!m.rowsLinked) spcLinkRows(m);
  if (m.previousMatrixWasComplex || m.complex) {
    for (let e = m.firstInRow[row]; e !== null; e = e.nextInRow) {
      e.real = 0.0;
      e.imag = 0.0;
    }
  } else {
    for (let e = m.firstInRow[row]; e !== null; e = e.nextInRow) {
      e.real = 0.0;
    }
  }
  return spError(m);
}

// @@CONTINUE@@
