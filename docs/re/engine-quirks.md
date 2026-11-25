# engine-quirks — реестр воспроизводимых «неточностей» предка

> Клон движка (`Site/engine/spice/`) обязан совпадать с оригиналом не только по
> математике, но и по артефактам: странностям алгоритмов, побочным эффектам,
> «неидеальностям». Каждый такой случай фиксируется здесь — с ID, описанием,
> ссылкой на исходник предка, код JS и тест.
>
> Правила ведения (PLAN-CLONE §4, фаза T):
>
> - **Статус `подтверждён`** — поведение зафиксировано C-эталоном
>   (`tools/sparse-golden`) или оракулом (`tools/oracle`) и покрыто тестом.
> - **Статус `открыто`** — описано из исходников предка, но против DLL ещё не
>   сверялось (нужен RE/оракул).
> - «Улучшать» оригинал запрещено: исправление квирка = расхождение с DLL.
>
> Последнее обновление: 2026-11-19 (P2.1 — полный диод: NEWCONV, NOBYPASS,
> внутренний узел rs, Q-D05/Q-D06/Q-O03; P2.7 — AC-драйвер, Q-A02).

## Сводка

| ID | Подсистема | Статус | Кратко |
|---|---|---|---|
| Q-S01 | sparse | подтверждён | `SMPfindElt`: «отцепленный» элемент при вставке в голову столбца |
| Q-S02 | sparse | подтверждён | `Col` не инициализируется до `spcLinkRows` (release-сборка) |
| Q-S03 | sparse | подтверждён | `spMNA_Preorder`: второй проход свапает без проверки числа близнецов |
| Q-S04 | sparse | подтверждён | `SMPzeroRow` транслирует Row через `ExtToIntColMap` (не RowMap) |
| Q-S05 | sparse | подтверждён¹ | `SearchForSingleton`: `break` перед NULL-разыменованием |
| Q-S06 | sparse | открыто | `SMPfindElt`: F4 без трансляции внешних индексов vs патч 3f5 |
| Q-C01 | CKT | открыто | `CKTsetup`: F4 (`NIinit`/`CKTisSetup`/`E_NOCHANGE`) vs XSPICE-редакция |
| Q-C02 | CKT | открыто | `CKTconvTest`: F4 возвращает `OK` при `CKTnoncon`, XSPICE — `1` |
| Q-C03 | CKT | открыто | `CKTload` nodeset/ic: F4 обнуляет строку, XSPICE складывает `rhs`/диагональ |
| Q-C04 | CKT/NI | открыто | `NIiter` при `MODEUIC`: F4 вызывает `CKTload`, XSPICE — нет |
| Q-N01 | NI | открыто | `NIconvTest` XSPICE не выставляет `CKTtroubleNode`/`CKTtroubleElt` |
| Q-D01 | devices | открыто | `MUTsetup`: warning + NULL-разыменование при отсутствии индуктора |
| Q-D02 | devices | подтверждён | `ISRC`: обратный порядок узлов (`neg`, затем `pos`) |
| Q-D03 | devices | подтверждён | PWL: разная граница цикла у `VSRC` и `ISRC` |
| Q-D04 | devices | подтверждён | `VSRC_D_F1` проваливается в `VSRC_D_F2` (нет `break`) |
| Q-D05 | devices | подтверждён | DLL собрана с `NOBYPASS`: опция `bypass` не действует |
| Q-D06 | devices | подтверждён | DLL собрана с `NEWCONV`: у диода нет проверки сходимости по току |
| Q-A01 | analyses | подтверждён | `DCtran` XSPICE: `CKTminBreak = 10*delmin` (F4 — `maxStep*5e-5`) |
| Q-A02 | analyses | подтверждён | `ACan` LINEAR в DLL: шаг `(stop-start)/(numsteps-1)` (XSPICE-исходник: `/numsteps+1`) |
| Q-O01 | oracle | подтверждён | заглушки `<ewb-NNNN>` вместо строк `WEWBMSG.RES` |
| Q-O02 | oracle | подтверждён | `IFnewUid` шима не добавляет `#branch` к имени ветви |
| Q-O03 | oracle | подтверждён | `STATnumIter` DLL вдвое больше числа итераций `NIiter` |
| Q-F01 | FPU | подтверждён | x87 vs SSE: сетка TRAN не бит-в-бит, допуск `timeRel=1e-9` |

¹ Ветка не наблюдалась ни в golden-тестах, ни в C-прогонах (её достижение означает
NULL-разыменование в C); зафиксирован сам факт наличия кода и портирования 1:1.

---

## Q-S01 — SMPfindElt: «отцепленный» элемент при вставке в голову столбца

**Что наблюдаем.** `SMPfindElt(eMatrix, Row, Col, CreateIfMissing=1)` для
отсутствующего элемента, который должен стать **первым** в столбце (или столбец
пуст), создаёт элемент, но **не связывает его с `FirstInCol[Col]`**:
элемент увеличивает `Matrix->Elements`, попадает в `Diag[Row]` (если он
диагональный) — но недостижим обходом столбца до конца жизни матрицы. Следствия:

- повторный `SMPfindElt(..., 0)` и любой обход столбца его не находят;
- `SMPcZeroCol`/`SMPzeroRow` его не обнуляют;
- `spGetElement(Row==Col)` по diag-ярлыку его **возвращает**;
- `SMPcAddCol` при сложении с таким столбцом создаёт «дубликат» позиции
  (в счётчике элементов — два элемента с одинаковыми Row/Col).

**Причина в предке.** `SMPfindElt` (spsmp.c) передаёт в `spcFindElementInCol` адрес
**локальной** переменной (`ElementPtr Element = Matrix->FirstInCol[Col]; ... &Element`),
а не `&FirstInCol[Col]`. Комментарий к `spcFindElementInCol` прямо требует передавать
адрес `FirstInCol`/`NextInCol` — условие нарушено. Дефект есть и в F4, и в 3f5
(патч `vendor/3f4patches/3f4patches/spsmp.patch` его не меняет).

**Где в JS.** `Site/engine/spice/sparse.js` — `SMPfindElt` (создаёт `localSlot`);
слотовая механика — `findElementInColSlot` (аналог `ElementPtr *LastAddr`).

**Тесты.** `Site/engine/test/sparse-golden.test.mjs` — «findElt / zeroCol / addCol /
zeroRow» (C показывает `Elements=6` против 5 «естественных»); юнит
`Site/engine/test/sparse.test.mjs` — «SMPfindElt — „отцепленная“ вставка в голову
столбца».

---

## Q-S02 — Col не инициализируется до spcLinkRows (release-сборка)

**Что наблюдаем.** До первого `spcLinkRows` (линковки строк) поле `Col` элементов
содержит **неинициализированную память**: в `spcCreateElement` присваивание
`pElement->Col = Col` стоит только в ветке `RowsLinked == YES` и под `#if DEBUG`
(в конфиге DLL и нашего C-эталона `HAS_MINDATA` ⇒ `DEBUG=NO`). В свежей
malloc-памяти это обычно 0, но это **не гарантия** — состояние зависит от аллокатора.

**Почему это безопасно для алгоритмов.** До линковки строк `Col` не читается:
поиск элементов идёт по `Row` (`spcFindElementInCol`), дампы — отладочные.
`spcLinkRows` проставляет `Col` всем элементам цепочек; исключение — «отцепленные»
элементы Q-S01 (их `Col` так и остаётся мусором — читать его нельзя).
`CountTwins` (см. Q-S03) точечно пишет `Col` найденным близнецам до линковки —
на этом держится `SwapCols`.

**Где в JS.** `createElementBeforeSlot`: в нелинеаризованной ветке `col` **не**
присваивается (остаётся 0 из `newElement`); в линкованной — присваивается.
Дампы `tools/sparse-golden/{driver.c,jsdriver.mjs}` нормализуют вывод:
`RowsLinked ? Col : 0` — чтобы сверка C↔JS была детерминированной.

**Тесты.** Все структурные дампы `sparse-golden.test.mjs`; юнит «SMPfindElt…».

---

## Q-S03 — spMNA_Preorder: второй проход свапает без проверки числа близнецов

**Что наблюдаем.** Если в первом проходе `spMNA_Preorder` найден «множественный
близнец» (`CountTwins` вернул 2+), планируется второй проход; во втором проходе
для первого найденного столбца без диагонали вызываются `CountTwins` +
`SwapCols` **без проверки результата** `CountTwins` (в первом проходе свап
делается только при `Twins == 1`). Свапается пара, найденная этим вызовом
(а если он ничего не нашёл — пара, оставшаяся от предыдущего вызова).
Побочно: `CountTwins` **пишет** `Col` найденным близнецам (это и есть механизм
«починки» колонок для `SwapCols`), а при раннем выходе `Twins >= 2` — не пишет
для второго и последующих пар.

**Где.** C: `sputils.c` `spMNA_Preorder`/`CountTwins`/`SwapCols`;
JS: `Site/engine/spice/sparse.js` — `spMNA_Preorder` (комментарий «квирк: результат
Twins не проверяется»), `countTwins`, `swapCols`.

**Тесты.** `sparse-golden.test.mjs` — «MNA-Preorder (пары близнецов)» (i2e-col
`[3,4,1,2]` после двух свапов); юнит `sparse.test.mjs` — «MNA-Preorder — пары
близнецов, карты и Diag».

---

## Q-S04 — SMPzeroRow транслирует Row через ExtToIntColMap

**Что наблюдаем.** `SMPzeroRow(eMatrix, Row)` (spsmp.c F4) первым делом делает
`Row = Matrix->ExtToIntColMap[Row]` — трансляция через **столбцовую** карту, хотя
речь о строке. В MNA-использовании карты строк и столбцов симметричны (узел n —
это и строка n, и столбец n), поэтому эффекта нет; но при расхождении карт
(ручные `SMP*`-сценарии, несимметричные матрицы) будет обнулена не та строка.
Заодно `SMPzeroRow` линкует строки (`spcLinkRows`), если они ещё не линкованы —
это тоже наблюдаемо (после вызова дампы показывают `RowsLinked=1`).

**Где.** C: `spsmp.c`; JS: `SMPzeroRow` (комментарий «NB (квирк 1:1)»).

**Тесты.** `sparse-golden.test.mjs` — «findElt / zeroCol / addCol / zeroRow»;
юнит «SMPfindElt…» (проверяет, что после `SMPzeroRow` `rowsLinked === true`).

---

## Q-S05 — SearchForSingleton: break перед NULL-разыменованием

**Что наблюдаем.** В `SearchForSingleton` (spfactor.c) в ветке «singleton без
диагонали, `MarkowitzCol[I] == 0`» стоит:

```c
ChosenPivot = Matrix->FirstInCol[I];
while ((ChosenPivot != NULL) AND (ChosenPivot->Row < Step))
    ChosenPivot = ChosenPivot->NextInCol;
if (ChosenPivot != NULL)
{   /* Reduced column has no elements, matrix is singular. */
    break;
}
PivotMag = ELEMENT_MAG(ChosenPivot);
```

Комментарий говорит «в столбце нет элементов», но условие противоположно:
`MarkowitzCol[I] == 0` означает, что после пропуска строк `< Step` указатель
всегда NULL — то есть ветка `break` не исполняется, а следующая строка
разыменовывает NULL. Либо мёртвый код с инвертированным условием, либо путь,
который в C падает. Портировано 1:1: JS-ветка `break` — та же, «недостижимая»
строка оставлена с комментарием (в JS она бросила бы TypeError).

**Где.** C: `spfactor.c` `SearchForSingleton`; JS: `sparse.js` `searchForSingleton`
(комментарий «недостижимо»). В наборе патчей 3f5 (`vendor/3f4patches/`) исправлений
`spfactor.c` нет.

**Тесты.** Golden «случайные разреженные матрицы» (путь не наблюдался — ни один
прогон не уронил C-драйвер и не разошёлся с JS).

---

## Q-S06 — SMPfindElt: трансляция внешних индексов (F4 vs 3f5) · ОТКРЫТО

**Суть.** В F4 `SMPfindElt` **не** транслирует внешние номера Row/Col в внутренние
(использует индексы как есть). Патч 3f5 (`vendor/3f4patches/3f4patches/spsmp.patch`)
добавляет `Row = ExtToIntRowMap[Row]; Col = ExtToIntColMap[Col];` до поиска.
Наблюдаемо только когда внутренние номера отличаются от внешних (после
`ExpandTranslationArrays` / неидентичных карт). Наш порт — F4-вариант.

**Статус.** Открыто: нужно определить, применён ли 3f5-патч в `XSPICE32.DLL`
(RE или оракул через `getMatrixElement` на матрице с внутренними ≠ внешними).
До выяснения считаем F4 (так в дереве `vendor/spice3f4`).

---

## Q-C01 — CKTsetup: редакция F4 vs XSPICE · ОТКРЫТО

**Суть.** `CKTsetup` в дереве предка и в XSPICE-редакции ведёт себя по-разному:

- **F4** (`vendor/spice3f4/src/lib/ckt/cktsetup.c`): вызывает `NIinit` (пересоздание
  матрицы/RHS), ставит `CKTisSetup = 1`; повторный вызов при `CKTisSetup == 1`
  возвращает `E_NOCHANGE` (без переинициализации).
- **XSPICE** (`vendor/xspice-1-0/src/sim/CKT/`): порядок/условия отличаются
  (в частности, работа с `NIinit`/`CKTisSetup` и точкой входа `CKTdoJob`).

Наш порт (`Site/engine/spice/ckt.js`) реализует **F4-вариант** — по линии
`docs/re/engine-lineage.md` (числовое ядро DLL — F4).

**Почему важно.** От этого зависит, пересоздаётся ли матрица между прогонами
(`doAnalyses(reset=1)` дважды) и какие коды возвращает повторный `CKTsetup`;
расхождение проявится на повторных Run и на `CKTisSetup` в швах.

**Где в JS.** `Site/engine/spice/ckt.js` — `cktSetup` (комментарий «F4-редакция»),
`CKTisSetup`; `Site/engine/spice/ni.js` — `niInit`/`niReinit`/`niDestroy`.

**Статус.** Открыто: сверить с `XSPICE32.DLL` оракулом в P1.6 (двойной
`doAnalyses(reset=1)`, поведение `CKTisSetup`, коды возврата). До выяснения — F4.

**Тесты.** `Site/engine/test/ckt.test.mjs` — «CKTsetup — E_NOCHANGE при повторе,
CKTstates по numStates», «CKTdoJob — без reset не вызывает setup повторно»,
«CKTdoJob — setup/temp/ic, опции task→ckt, вызов анализа» (фиксируют текущий
F4-контракт; при подтверждении XSPICE-варианта тесты обновляются вместе с портом).

---

## Q-C02 — CKTconvTest: F4 «глотает» несходимость устройств · ОТКРЫТО

**Что наблюдаем.** Драйвер `CKTconvTest` обходит `DEVconvTest` всех устройств и
после каждого вызова проверяет `ckt->CKTnoncon`. В F4
(`vendor/spice3f4/src/lib/ckt/cktop.c`) при `CKTnoncon != 0` возвращается `OK` (0) —
комментарий внутри кода: *«This bug rendered all DEVconvTest() functions
ineffective!»*. Вызывающий `NIiter` смотрит на возвращённое значение, поэтому
несходимость, выставленная устройством, **не доходит** до критерия (кроме пути
через `CKTnoncon` в `NIconvTest`).

В XSPICE (`vendor/xspice-1-0/src/sim/CKT/CKTconvTest.c`) баг исправлен: возвращается
`1`. Наш порт (`Site/engine/spice/ckt.js`, `cktConvTest`) — **XSPICE-вариант**.

**Почему важно.** От этого зависит, когда `NIiter` объявляет сходимость на
нелинейных устройствах (диоды/БТ/МОП в P2): F4-вариант может «проскочить» итерацию
с несошедшимся устройством и дать другие числа/число итераций.

**Где в JS.** `Site/engine/spice/ckt.js` — `cktConvTest` (комментарий «Q-C02»);
`ni.js` — `niConvTest` (возврат `cktConvTest`).

**Статус.** Открыто: сверить с `XSPICE32.DLL` оракулом в P1.6 (число итераций и
режим на нелинейной схеме). До выяснения — XSPICE (линия DLL).

**Тесты.** `Site/engine/test/ni.test.mjs` — «NIconvTest — CKTconvTest возвращает 1
при CKTnoncon (XSPICE)».

---

## Q-C03 — CKTload: nodeset/ic — обнуление строки (F4) vs сложение (XSPICE) · ОТКРЫТО

**Что наблюдаем.** При `MODEDC` и `MODEINITJCT|MODEINITFIX` для узлов с `nsGiven`:

- **F4** (`vendor/spice3f4/src/lib/ckt/cktload.c`): `ZeroNoncurRow(...)`, затем
  `CKTrhs[node] = 1e10 * nodeset` и `*node->ptr = 1e10`; если строка не обнулилась —
  `CKTrhs[node] = nodeset`, `*node->ptr = 1`. То есть строка **заменяется**
  (жёсткая привязка узла).
- **XSPICE** (`vendor/xspice-1-0/src/sim/CKT/CKTload.c`): `CKTrhs[node] += nodeset`,
  `*node->ptr += 1` — nodeset **добавляется** к уже загруженной матрице (мягкая
  «пружина»).

Аналогично для `icGiven` при `MODETRANOP && !MODEUIC`: F4 обнуляет строку и ставит
1/1e10, XSPICE складывает `rhs += ic`, `diag += 1`.

Наш порт (`Site/engine/spice/ckt.js`, `cktLoad`) — **XSPICE-вариант**.

**Почему важно.** Nodeset/IC — штатный способ снять стартовую точку в EWB
(начальные условия на узлах). Разные редакции дают разную силу привязки, а значит
разные итерации и иногда разные рабочие точки при нескольких nodeset.

**Где в JS.** `Site/engine/spice/ckt.js` — `cktLoad` (комментарий «Q-C03»).

**Статус.** Открыто: оракул на схеме с `nodeset`/`IC` в P1.6; до выяснения — XSPICE.

**Тесты.** `Site/engine/test/ni.test.mjs` — «CKTload — XSPICE-семантика nodeset
(rhs +=, diag += 1)», «CKTload — XSPICE-семантика ic (только MODETRANOP, без UIC)».

---

## Q-C04 — NIiter/MODEUIC: F4 перезагружает матрицу, XSPICE — нет · ОТКРЫТО

**Что наблюдаем.** Вход в `NIiter` при `(CKTmode & MODETRANOP) && (CKTmode & MODEUIC)`:

- **F4** (`vendor/spice3f4/src/lib/ni/niiter.c`): меняет местами `CKTrhsOld`/`CKTrhs`,
  затем вызывает `CKTload(ckt)` и возвращает `OK`.
- **XSPICE** (`vendor/xspice-1-0/src/sim/NI/NIiter.c`): меняет местами и сразу
  возвращает `OK`, **без** `CKTload`.

Наш порт (`Site/engine/spice/ni.js`, `niIter`) — **XSPICE-вариант**.

**Почему важно.** UIC (use initial conditions) — режим TRAN, где рабочая точка не
считается. Лишний `CKTload` в F4 перезаписывает RHS/матрицу после обмена, что влияет
на первый шаг и на nodeset/IC-семантику (ср. Q-C03).

**Где в JS.** `Site/engine/spice/ni.js` — `niIter` (ветка `MODEUIC`).

**Статус.** Открыто: проверить TRAN с UIC оракулом в P1.6 (первый шаг, сетка).

**Тесты.** `Site/engine/test/ni.test.mjs` — «NIiter — MODEUIC меняет rhs/rhsOld и не
вызывает CKTload».

---

## Q-N01 — NIconvTest: диагностика CKTtroubleNode ушла в ENH · ОТКРЫТО

**Что наблюдаем.** F4 `NIconvTest` (`vendor/spice3f4/src/lib/ni/niconv.c`) при
несходимости выставляет `ckt->CKTtroubleNode = i` (номер уравнения) и
`CKTtroubleElt = NULL`, а при сходимости — `CKTtroubleNode = 0`. В XSPICE
(`vendor/xspice-1-0/src/sim/NI/NIconvTest.c`) этих присваиваний нет: диагностика
перенесена в `ENHreport_conv_prob` (enhanced-слой). На **числа** это не влияет —
только на текст сообщений о проблемной схеме.

Наш порт (`Site/engine/spice/ni.js`, `niConvTest`) — **XSPICE-вариант**: поля
`CKTtroubleNode`/`CKTtroubleElt` не трогаются.

**Почему важно.** Если UI/лог будет печатать «trouble node», без `ENH` он останется
пустым. Возвращать поля имеет смысл только вместе с портом `ENHreport_conv_prob`
(фаза X/I), иначе получим расхождение с DLL.

**Где в JS.** `Site/engine/spice/ni.js` — `niConvTest` (комментарий «Q-N01»).

**Статус.** Открыто: решить в фазе X (нужен ли `CKTtrouble` для сообщений), тогда же
сверить с DLL.

**Тесты.** `Site/engine/test/ni.test.mjs` — «NIconvTest — пороги узла (vntol) и
ветви (abstol)» (фиксирует только возврат 0/1).

---

## Q-D01 — MUTsetup: warning и NULL-разыменование при отсутствии индуктора · ОТКРЫТО

**Что наблюдаем.** В `MUTsetup` (`vendor/spice3f4/src/lib/dev/ind/mutsetup.c`)
отсутствие связанного индуктора — не фатальная ошибка: `CKTfndDev` возвращает
`E_NODEV`/`E_NOMOD`, печатается `ERR_WARNING` «coupling to non-existant inductor»,
после чего выполнение продолжается и строка

```c
here->MUTfactor = here->MUTcoupling * sqrt(here->MUTind1->INDinduct * ...);
```

разыменовывает `NULL`. В release-сборке это падение (или мусор), а не код ошибки.

**Где в JS.** `Site/engine/spice/devices/inductor.js` — `MUTsetup`: вместо
продолжения возвращается `E_NODEV` с `ckt.errMsg`. Это осознанное отклонение от
C (безопасность процесса); на корректных схемах поведение совпадает.

**Почему важно.** Оракул на битой схеме может показать падение DLL — наш порт
обязан вернуть ошибку, а не повторять падение. Числа на валидных схемах не
затронуты.

**Статус.** Открыто: сверить с DLL в P1.6 (ожидаемо — DLL аварийно завершится или
выдаст warning); решение «не падать» зафиксировано здесь.

**Тесты.** `Site/engine/test/devices.test.mjs` — «mutual — `MUTfactor`…» (валидный
случай); негативный сценарий будет добавлен вместе с diff-тестом P1.6.

---

## Q-D02 — ISRC: обратный порядок узлов · ПОДТВЕРЖДЁН

**Что наблюдаем.** В `isrcdefs.h` поля объявлены в порядке `ISRCnegNode`,
`ISRCposNode`. `CKTbindNode` пишет term=1 в первое поле, term=2 — во второе,
то есть **term1 = отрицательный**, term2 = положительный. `ISRCload` добавляет
ток в `ISRCposNode` (term2) и вычитает из `ISRCnegNode` (term1):

```c
*(ckt->CKTrhs + (here->ISRCposNode)) += value;
*(ckt->CKTrhs + (here->ISRCnegNode)) -= value;
```

У `Vsource` порядок прямой (`VSRCposNode`, затем `VSRCnegNode`), поэтому
«одинаковая» привязка выводов даёт у I и V разное направление.

**Где в JS.** `Site/engine/spice/devices/isource.js` — `DEVload`/`DEVacLoad`
используют `GENnode2` как положительный, `GENnode1` как отрицательный.

**Почему важно.** Если «исправить» порядок, ток в схемах EWB развернётся
относительно DLL. Направление видно на мультиметре и в OP.

**Тесты.** `Site/engine/test/devices.test.mjs` — «ISRC — порядок узлов как в C
(Q-D02)» (term1=земля, term2=выход → `V(out)=+1 В`).

---

## Q-D03 — PWL: разная граница цикла у VSRC и ISRC · ПОДТВЕРЖДЁН

**Что наблюдаем.** Обход точек PWL в `vsrcload.c` и `isrcload.c` отличается на
единицу:

```c
/* VSRCload */ for (i = 0; i <  (VSRCfunctionOrder/2) - 1; i++)
/* ISRCload */ for (i = 0; i <= (ISRCfunctionOrder/2) - 1; i++)
```

Следствие: у `ISRC` последняя пара точек тоже участвует в поиске интервала, у
`VSRC` — нет (там последний интервал обрабатывается веткой «после последней
точки»). На типичных PWL с временем внутри диапазона числа совпадают; на
границе/за ней — могут отличаться.

**Где в JS.** `Site/engine/spice/devices/common.js` — `sourceFunctionValue`,
флаг `inst.pwlInclusive` (у ISRC выставляется в `newInstance`).

**Тесты.** `Site/engine/test/devices.test.mjs` — «waveform PULSE/PWL…».

---

## Q-D04 — VSRC_D_F1 проваливается в VSRC_D_F2 · ПОДТВЕРЖДЁН

**Что наблюдаем.** В `vsrcpar.c` `case VSRC_D_F1` не заканчивается `break`:
после разбора `distof1` управление попадает в `case VSRC_D_F2` и заполняет
`VSRCdF2*` теми же значениями (флаги `VSRCdF1given`/`VSRCdF2given` и
`VSRCdGiven` выставляются оба). У `ISRC` (`isrcpar.c`) `break` есть, поведение
обычное.

**Где в JS.** `Site/engine/spice/devices/vsource.js` — `DEVparam`, `case VSRC_D_F1`
явно воспроизводит провал; `isource.js` — без провала.

**Почему важно.** Distortion-анализ — фаза P3; на P1.4 (OP/TRAN) параметры не
используются, но структура полей должна совпасть заранее.

**Тесты.** Прямого теста нет (P3); поведение зафиксировано комментарием в коде.

---

## Q-D05 — DLL собрана с `NOBYPASS`: опция `bypass` не действует · ПОДТВЕРЖДЁН

**Что наблюдаем.** В `DIOload` (как и в `BJTload`/`MOS*load`) блок
`#ifndef NOBYPASS` пропускает загрузку, если решение не изменилось
(`goto load`). При этом `CKTstate0` не обновляется, поэтому после сошедшегося
OP состояние устройства остаётся на итерацию позади `CKTrhsOld`. В оракуле это
не так: после OP `askInstanceQuest(D1, vd/id/gd)` совпадает с выгруженной
точкой `CKTrhsOld` (`vd = 0.5845725717727923` на `diode_ac`), а не с
предыдущей итерацией (`0.5845745451974477`).

**Проверка.** Деки `diode_ac` с `options bypass=0` и `bypass=1` дают в оракуле
**одинаковые** AC-значения; наш движок с `bypass=1` даёт `0.2832984417…`
вместо `0.2833139338…` (расхождение `gd` из-за «застрявшего» состояния), а с
`bypass=0` — точное совпадение. Причина: EWB показывает пользователю
внутренние величины приборов (мультиметр/осциллограф читают состояние
устройства), поэтому в редакции DLL оптимизация bypass отключена на этапе
сборки. Опция `bypass` при этом остаётся в таблице (`TSKbypass = 1`), но кода,
который её читает, в `DIOload` нет.

**Где в JS.** `Site/engine/spice/devices/diode.js` — константа `NOBYPASS = true`
и закомментированная ветка (порт остаётся структурно близким к C). При порте
BJT/MOS (P2.x) ветку `#ifndef NOBYPASS` также не включать.

**Тесты.** `Site/engine/test/analyses.test.mjs` — `diode_ac` (значения AC и
состояние `s0[DIO_VD]`/`s0[DIO_GD]`); `Site/engine/test/devices.test.mjs` —
«диод — load: аналитика ВАХ и NOBYPASS-состояние».

---

## Q-D06 — DLL собрана с `NEWCONV`: у диода нет проверки сходимости по току · ПОДТВЕРЖДЁН

**Что наблюдаем.** `DIOload` завершает итерацию так:

```c
if( (!(ckt->CKTmode & MODEINITFIX)) || (!(here->DIOoff)) ) {
    if (Check == 1) {
        ckt->CKTnoncon++;
#ifndef NEWCONV
    } else {
        tol = reltol*MAX(FABS(cdhat),FABS(cd));
        if (FABS(cdhat-cd) > tol) ckt->CKTnoncon++;
#endif /* NEWCONV */
    }
}
```

`prefix.h` редакции XSPICE определяет `NEWCONV`
(`vendor/xspice-1-0/src/sim/include/prefix.h:50`), поэтому в DLL проверка по
току **не компилируется**: сходимость диод объявляет только через `Check`
(ограничитель `pnjlim`), а общий критерий даёт `NIconvTest` по узловым
напряжениям. В F4 (`vendor/spice3f4`) ветка `#ifndef NEWCONV` активна, и
итерации прекращаются раньше — значения OP расходятся (на `diode_fwd`:
`0.6928715186715266` в DLL против `0.6928681429973097` у «чистого» F4-критерия,
совпадающего с `reltol=1e-6`).

**Где в JS.** `Site/engine/spice/devices/diode.js` — `DEVload`, блок
«сходимость (NEWCONV…)»; `Site/engine/spice/ni.js` — `niConvTest` (узловой
критерий, Q-N01).

**Тесты.** `Site/engine/test/analyses.test.mjs` — `diode_fwd`, `diode_rs`,
`diode_rev` (OP бит-в-бит с golden).

---

## Q-A01 — DCtran: XSPICE `CKTminBreak = 10*delmin` · ПОДТВЕРЖДЁН

**Что наблюдаем.** Драйвер TRAN в DLL — редакция XSPICE
(`vendor/xspice-1-0/src/sim/CKT/DCtran.c`), а не F4 `dctran.c`:

```c
/* F4 dctran.c */
if(ckt->CKTminBreak==0) ckt->CKTminBreak=ckt->CKTmaxStep*5e-5;
/* XSPICE DCtran.c */
if(ckt->CKTminBreak==0) ckt->CKTminBreak = 10.0 * ckt->CKTdelmin;
```

При `tmax=1e-4` получается `delmin=1e-13`, то есть XSPICE-порог `1e-12`, а F4 —
`5e-9`. Первая точка останова PULSE (`TD+TR = 1e-9`) при F4-пороге считается
«слишком близкой» к `t=0` и `CKTsetBreak` её выбрасывает: первый шаг становится
`1e-6`, а вся сетка — 62 точки вместо 180. С XSPICE-порогом точка сохраняется,
`delta = 0.1*min(saveDelta, TR)/10 = 1e-11`, сетка совпадает.

Там же XSPICE иначе чистит таблицу: цикл
`while (breaks[0] <= time + minBreak) CKTclrBreak()` выполняется **после**
`resume`, а принудительный разрыв шага — по `time + delta > breaks[0]`
(в F4 — ветка `else if` с `delmin` и подтяжкой `MAX(delta, delmin*2)`).

**Где в JS.** `Site/engine/spice/analyses/tran.js` — `dcTran` (комментарий
«Q-A01»), `Site/engine/spice/ckt.js` — `cktSetBreak`/`cktClrBreak`/`cktAccept`.

**Тесты.** `Site/engine/test/analyses.test.mjs` — `tran_rc` (180 точек, первый
шаг `1e-11`); `Site/engine/test/devices.test.mjs` — `CKTaccept — PULSE…`.

---

## Q-A02 — AC LINEAR: DLL считает по F4 (`numsteps-1`) · ПОДТВЕРЖДЁН

**Что наблюдаем.** В исходниках XSPICE (`vendor/xspice-1-0/src/sim/CKT/ACan.c`)
линейный шаг — `(stop-start)/(numberSteps+1)`, а при `numberSteps<1` он
поднимается до 1. В DLL фактически работает редакция F4 `acan.c`:

```c
if (numberSteps-1 > 1) ACfreqDelta = (stop-start)/(numberSteps-1);
else                    ACfreqDelta = HUGE;
```

Проверено оракулом на `tools/oracle/corpus/ac_rc.json` (`start=10`,
`stop=10000`, `numsteps=10`, `lin=1`): частоты `10, 1120, …, 10000` (шаг
`9990/9 = 1110`, ровно 10 точек). С XSPICE-формулой было бы 12 точек с шагом
`9990/11`. Это ещё один случай «смешанной» сборки: TRAN в DLL — XSPICE
(Q-A01), AC — F4.

**Где в JS.** `Site/engine/spice/analyses/ac.js` — `acan` (`LINEAR`, `HUGE`);
остальные ветки (DECADE/OCTAVE, `freqTol`, `NIacIter`, dump) общие.

**Тесты.** `Site/engine/test/analyses.test.mjs` — `ac_rc` (10 точек, шаг 1110);
`Site/engine/test/oracle.test.mjs` — сам оракул сверяется с golden `ac_rc`.

---

## Q-O01 — оракул: заглушки `<ewb-NNNN>` вместо строк WEWBMSG.RES · ПОДТВЕРЖДЁН

**Что наблюдаем.** DLL вызывает `IFerror(ERR_WARNING, <ресурс>, …)`, а строку по
ID разворачивает фронтенд EWB из `WEWBMSG.RES`. В шиме оракула
(`tools/oracle/shim.py`, `cb_error`) таблицы ресурсов нет, поэтому в golden
попадает литерал `<ewb-1514>` вместо реального текста
`V1: no DC value, transient time 0 value used` (`vsrctemp.c`/`isrctemp.c`).

**Где в JS.** `Site/engine/spice/devices/{vsource,isource}.js` —
`DEVtemperature` пишет литерал через `cktError`; в паритетном тесте
`Site/engine/test/analyses.test.mjs` сообщение канонизируется
(`canonicalError`: `<ewb-N>` ↔ известный литерал → `EWB#N`). Это артефакт
фронтенда оракула, а не расчёта.

**Тесты.** `Site/engine/test/analyses.test.mjs` — `tran_rc`.

---

## Q-O02 — оракул: `IFnewUid` не добавляет `#branch` · ПОДТВЕРЖДЁН

**Что наблюдаем.** `CKTmkCur` создаёт ветвевое уравнение через
`IFnewUid(..., basename, "branch", ...)`; настоящий фронтенд формирует
`V1#branch`. Шим (`tools/oracle/shim.py`, `cb_newuid`) игнорирует `olduid` и
`suffix` и возвращает только `basename`, поэтому в golden имена ветвей — `V1`.
Там же теряется имя ref-величины AC: `IFnewUid(..., "frequency", ...)` даёт в
golden `refName: "auto"` вместо `"frequency"` (наш порт возвращает `"frequency"`;
`compareResults` поле `refName` не сверяет — оно не влияет на числа).

**Где в JS.** `Site/engine/spice/devices/common.js` — `makeBranch` (faithful
`IFnewUid` → `V1#branch`, см. `devices.test.mjs`). В паритетном тесте суффикс
снимается нормализацией (`normalize`), golden не правится.

**Тесты.** `Site/engine/test/analyses.test.mjs` — все три деки;
`Site/engine/test/devices.test.mjs` — «Vsource DC … уникальное имя ветви».

**Дополнение (P2.1).** Внутренний узел диода `D1#internal` (`CKTmkVolt`) также
теряет суффикс в golden (`diode_rs` → имя `D1`). Нормализация расширена:
`n.replace(/#(branch|internal)$/, '')`.

---

## Q-O03 — `STATnumIter` DLL вдвое больше числа итераций `NIiter` · ПОДТВЕРЖДЁН

**Что наблюдаем.** Оракул сообщает `options.totiter` ровно вдвое больше, чем
суммарное `iterno` наших вызовов `NIiter` с теми же деками:

| Дека | наша `STATnumIter` | оракул `totiter` |
|---|---|---|
| `op_divider` (линейная, 3 уравнения) | 3 | 6 |
| `diode_fwd` | 5 | 10 |
| `diode_rs` | 8 | 16 |
| `diode_rev` | 13 | 26 |
| `diode_ac` (OP+AC) | 20 | 30 |

В исходниках `vendor/xspice-1-0` `STATnumIter` увеличивается **только** в
`NIiter.c` (`STATnumIter += iterno`), поэтому двойной счёт — либо правка
EWB-сборки, либо ещё один вызов `NIiter` на анализ (при этом plot создаётся
один раз, `steps` в golden без дублей). Для `diode_ac` 20 → 30 не сводится к
«×2» на анализ: 30 = 2·(10 OP + 10 AC)/… — точная раскладка по анализам не
восстановлена.

**Почему не правим.** Счётчик не влияет ни на одно значение (OP/AC/TRAN
совпадают бит-в-бит/в допуске) и не сверяется тестами. Специально удваивать
`STATnumIter` в JS не будем: это сломало бы соответствие исходнику `NIiter.c`
без понимания причины.

**Где в JS.** `Site/engine/spice/ni.js` — `STATnumIter += iterno` (как в C).

**Тесты.** Нет (счётчик не входит в контракт `compareResults`).

---

## Q-F01 — x87 vs SSE: сетка TRAN не бит-в-бит · ПОДТВЕРЖДЁН

**Что наблюдаем.** `XSPICE32.DLL` — 32-битный x87-код (0 инструкций SSE;
см. `REPORT-oracle-ni-fpu.md` §3). MSVC 6 держит промежуточные значения в
80-битных регистрах и округляет до `double` не после каждого оператора, поэтому
результат может отличаться от SSE-double на 1 ULP (иногда больше в длинных
цепочках). JS по спецификации считает каждую операцию в double.

На `tran_rc` измерено (порт против golden):

| Метрика | Значение | Допуск |
|---|---|---|
| точек сетки | 180 / 180 | длина обязана совпадать |
| max `|Δt|` | `3.6e-14` при `t≈1.17e-3` (`rel 3.1e-11`) | `timeRel = 1e-9` |
| max `|Δv|` | `9.3e-10` | `abs = 1e-9`, `rel = 1e-6` |

Механизм: 1–2 ULP в `delta` после точки останова (`CKTsaveDelta`/LTE), затем
адаптивный шаг удваивается, и абсолютное расхождение растёт вместе с ним, пока
не упрётся в `tmax`. Алгоритмического расхождения нет: число точек и моменты
смены шага совпадают.

**Где в JS.** `tools/oracle/compare.mjs` — `DEFAULT_TOL.timeRel`
(по умолчанию `0`, оракульные self-тесты остаются бит-в-бит);
`Site/engine/test/analyses.test.mjs` — `TIME_REL = 1e-9` для `tran_rc`.

**Решение.** Не эмулировать 80-битную арифметику без знания точек spill
(§3.3 отчёта); фиксировать допуск и следить за максимумом. Если будущий diff
даст `max rel > 1e-9` — искать расхождение в порядке операций, а не расширять
допуск.

**Тесты.** `Site/engine/test/analyses.test.mjs` — `tran_rc`.
