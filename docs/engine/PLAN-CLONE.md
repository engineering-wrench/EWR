# PLAN-CLONE — 1:1 клон движка EWB 5.12 (XSPICE32) для EWR

> Документ для передачи следующему агенту. Прочитать целиком до начала работ.
> Связанные документы: `AGENTS.md` (жёсткие правила), `docs/engine/PLAN.md` (общий план
> проекта), `docs/re/EWB-file-format.md` (формат `.ewb`).
> Детальные планы подпунктов — `docs/engine/plans/` (индекс `README.md`, шаблон
> `_TEMPLATE.md`); правила ведения — `AGENTS.md` §«Планы».
> Последнее обновление: 2026-10 (P1.1: порт sparse + golden-харнесс C↔JS;
> заведён протокол планов подпунктов).

---

## 0. Задача

Сделать движок симуляции EWR **поведенчески идентичным (1:1)** движку Electronics Workbench 5.12:

- те же числа, что показывает оригинал (в первую очередь на приборах);
- те же дефолты/допуски/методы (интегрирование, сходимость, порядок обхода, выбор шага);
- те же **артефакты и «неточности»** (упрощённые макромодели, ringing трапеции, quirks сходимости) —
  воспроизводим сознательно и фиксируем тестами;
- **весь движок целиком** (все устройства и анализы, которые есть в оригинале, включая цифровую
  часть XSPICE);
- минимальная привязка к интерфейсу: источник ЭДС/генератор, вольтметр, амперметр, кнопка Run
  на реальной сцене редактора.

**Решение владельца (зафиксировано):** приоритет — совпадение выводов; лицензионные риски владельцем
приняты. Можно портировать исходники предка движка (SPICE3F4/XSPICE) и использовать/ре-энкодить
параметрические таблицы `EWB512/MODELS/*`. Правило `AGENTS.md` п.1 (clean-room) продолжает
действовать для остального: чужой код/ассеты в продукт не тащим; движок строится из открытого
предка + RE-поведения оригинала.

---

## 1. Что такое движок оригинала (ключевой вывод разведки)

**Оригинальный движок — это XSPICE (линия SPICE3F4, судя по строкам) с патчами EWB, реализованный
в `EWB512/XSPICE32.DLL`.** Наш текущий `Site/engine/` — собственная SPICE-подобная реализация
(MNA + плотный LU, фиксированный шаг, R/C/L/V/I/диод, OP/TRAN/AC) — с оригиналом **не совпадает**
ни по алгоритмам, ни по дефолтам. Дописывать текущий движок «до SPICE» бессмысленно — нужен порт
предка.

### 1.1 Доказательства (снято в этой сессии; как повторить — команды ниже)

- **Экспорты `XSPICE32.DLL`** (63 имени) — классический SPICE3 CKT/OUT API:
  `CKTinit, CKTcrtElt, CKTnewTask, CKTnewAnal, CKTfndAnal, CKTfndDev, CKTdoJob, CKTmodCrt,
  CKTmodParam, CKTsetAnalPm, CKTsetNodPm, CKTnewNode, CKTground, CKTinst2Node, CKTdnames,
  CKTtrouble, CKTaskAnalQ, CKTaskNodQst, OUTpData, OUTattributes, OUTpBeginPlot, OUTwData,
  spice_malloc, ...` — полный список см. Приложение A.
- **Разреженный решатель SPICE3** — строки исходных путей:
  `h:\v9\xspice\src\lib\sparse\{spalloc,spbuild,spfactor,spsmp,spsolve,sputils}.c`
  (`spfactor` = LU по Марковицу, как в SPICE3).
- **Строки-маркеры SPICE3:** `3f4` (версия в таблице `IFsimulator`), `spice3`, `xspice32.dll`.
  (Строка `3F4T4` из первой редакции плана — **не маркер**: это случайные байты в
  `.reloc`; см. `docs/re/engine-lineage.md` §1.5.)
- **Опции SPICE3 на месте** (строки DLL): `reltol, abstol, vntol, chgtol, trtol, gmin, itl1,
  itl2, itl4, pivtol, method (gear|trap), tnom, temp, …` + сообщения
  `Unknown integration method`, `Warning: .TEMP card obsolete — use .options TEMP and TNOM`.
- **Анализы в строках DLL:** `tran, ac, noise, disto, fourier, sens, temp` (+ `op/dc`,
  стандартные для CKTfndAnal). `fourier`, `noise`, `disto`, `sens` — подстроки-идентификаторы типов анализа.
- **Патчи EWB** (доп. экспорты сверх SPICE3/XSPICE):
  `getMatrixElement, getVoltage, getCurrent, addVoltage, addCurrent, findNode, setMaxStep,
  setBreakPoint, setRelativeBreakPoint, isFirstIteration, changeCapacitorValue,
  changeInductorValue, XSPIinit` — швы, через которые GUI/приборы лезут в решатель.
- **`WEWB32.EXE` вызывает:** `EwbGetVoltage`, `EwbGetCurrent`, `EwbSetMaxStep`,
  `EwbAddXSpiceComp`, `addXSpiceInstance`, `CXSpiceOptions`; в строках видны ошибки MIF
  (`MIF_init_inst`, `MIF_IE_*`) — трансляция схемы в CKT и XSPICE код-модели идут через WEWB32.
- **`EWB512/MODELS/*.M**` — карточки параметров с номером детали (PartNum):**
  `P "LS" 99 4 3.8 1e-14 …` (цифровое семейство LS, PartNum 99), `P "ideal" 15 1e+06 1e+10 …`
  (PartNum 15 = «3-Terminal Opamp»; авторитетный источник имён — `WEWBMSG.RES`,
  индекс строки = PartNum, вольтметр — это PN 13: `docs/re/engine-parts.md`),
  и т.д. `ttl.m99 / cmos.m99 / misc.m99` — цифровые семейства. Расширение файла = `.M<PartNum>`.
- **Соседние модули:** `EXT/ANALOG.DLL|DIGITAL.DLL|CHIP.DLL` (аналог/цифра/субсхемы),
  `GRAPHER.DLL` (графики), `EXT/SPICEEWB.DLL` (оболочка: `DLLInit/DLLExit/EWBExtEntry`),
  `BACKAN.EXE`, `GETRES32.DLL`, `COMPDAT.DLL`, `STAT.DLL`, `UTGEN.DLL`.
- **`SPICE-I-.VER`:** `SPICE-I- 0 1996/03/03-16:26 SPICE`.
- **README EWB:** «The SPICE 3 engine».
- **Формат вывода:** строки вида `%.3e` — приборы/графер печатают ~3 значащие цифры
  (уточнить в Фазе R — это правило сверки «1:1» на UI-уровне).

Команды разведки:

```bash
node tools/pe-exports.mjs EWB512/XSPICE32.DLL
node tools/pe-exports.mjs EWB512/EXT/SPICEEWB.DLL
strings -n 5 EWB512/XSPICE32.DLL | grep -iE "spice|3f4|reltol|trtol|gear|itl"
strings -n 6 EWB512/WEWB32.EXE   | grep -aiE "EwbGet|EwbSet|XSpice"
head -c 300 EWB512/MODELS/ttl.m99 | cat -v
cat EWB512/SPICE-I-.VER
```

### 1.2 Чем наш движок отличается (критичные расхождения)

| Параметр | Наш `Site/engine/` сейчас | Оригинал (XSPICE32) | Последствие |
|---|---|---|---|
| Решатель | плотный LU, частичный выбор | разреженный `spfactor` (Марковиц) | другие округления, другое поведение на вырожденных |
| Порядок узлов | сортировка имён | порядок из трансляции WEWB32 | влияет на пивоты и последние цифры |
| TRAN | фиксированный шаг `tstop/200` | адаптивный шаг по LTE (`trtol`) | **несовпадение формы графиков** |
| Опции/допуски | свои: `reltol=1e-4, vabstol=1e-7, maxIter=200`, gmin `1e-3→1e-12` | SPICE3: `reltol=1e-3`, `abstol=1e-12`, `vntol=1e-6`, `trtol=7`, `gmin=1e-12`, `itl1=100`, `itl2=50`, `itl4=10` (уточнить оракулом) | другая точность и сходимость |
| Термопотенциал | `VT=0.025852` | `tnom=27 °C` → ~0.025864 | мелкие сдвиги в диодах/БТ |
| Устройства | R/C/L/V/I/диод | весь SPICE3 + XSPICE + карточки MODELS | нет 90% библиотеки |
| Анализы | OP/TRAN/AC | + DC sweep, Noise, Disto, Sens, TF, PZ, Fourier, Temp, … | нет |
| Цифра | нет | XSPICE event-driven + `ttl.m99/cmos.m99` | нет |
| Приборы | нет (только demo) | встроенные швы `getVoltage/getCurrent/setMaxStep` | нет привязки |

---

## 2. Стратегия (выбрана и согласована)

**A + C + B**, в этом порядке:

- **A. Порт предка.** Взять исходники **SPICE3F4 + XSPICE** той же линии, что и DLL
  (строки `h:\v9\xspice\…`, маркер `3F4`), и портировать ядро на ESM/JS в `Site/engine/spice/`.
  Только так наследуются алгоритмы: `spfactor`, трапеция/Gear + LTE-шаг, `pnjlim/fetlim`,
  критерии Ньютона, порядок сходимости.
- **C. Оракул.** Дифференциальное тестирование против настоящего `XSPICE32.DLL` под Wine:
  харнесс строит цепь через CKT API, гоняет анализы, снимает эталоны (JSON). Наш движок обязан
  воспроизводить их. Это и критерий «1:1», и защита от регрессий.
- **B. RE точечно.** Ghidra по `XSPICE32.DLL` и `WEWB32.EXE` для того, что не видно снаружи:
  порядок элементов/узлов при трансляции, дефолты опций, влияние приборов (`setMaxStep`,
  `setBreakPoint`), формат вывода, где живут MonteCarlo/WorstCase (вероятно, оркестрация в WEWB32,
  а не в ядре). Находки — в `docs/re/engine-behavior.md`.

Отклонено: поэтапное «доведение» нашего движка до SPICE-дефолтов (даст похожесть, но не
numerical identity); GUI-скрейпинг как основной источник эталонов (медленно и недетерминированно,
оставляем как fallback).

---

## 3. Целевая архитектура

```
Site/engine/
  index.js              # публичный API EWR (сохранить совместимость; добавить engine:'clone'|'legacy')
  ewb-facade.js         # мост: наш spec/.ewb-модель -> deck CKT (порядок как у WEWB32) и обратно
  spice/                # ← ПОРТ ПРЕДКА (чистый ESM, без Node API, Float64Array)
    sparse.js           #   spalloc/spbuild/spfactor/spsmp/spsolve
    ckt.js              #   CKT-скелет: узлы, элементы, модели, задачи, диспетчер анализов
    ni.js               #   NIiter/NIintegrate: Ньютон, trap/gear, LTE-шаг, критерии
    out.js              #   OUT*: структуры plot/данных (совместимые по форме)
    devices/            #   res, cap, ind, vsrc, isrc, diode, bjt, jfet, mos(1..6), mes,
                        #   sw, csw, csrc, ltra, txl, urc, зенер ...
    analyses/           #   op, dc, tran, ac, noise, disto, sens, tf, pz, four, temp
    xspice/             #   MIF код-модели, event-driven цифра (evtsim), IFeval
    models/             #   загрузчик таблиц MODELS (JSON) + карта PartNum
  models/
    ewb-models.json     #   ГЕНЕРИРУЕТСЯ из EWB512/MODELS/* (tools/models-parse.mjs) и коммитится
  test/                 #   юнит + паритетные тесты (oracle self-skip без Wine/EWB512)
tools/
  oracle/               #   харнесс оракула: shim.c, build.sh, run.mjs, corpus/, golden/
  sparse-golden/        #   C-эталон sparse 1.3: driver.c, сборка (gcc), JS-интерпретатор скриптов
  models-parse.mjs      #   EWB512/MODELS/*.M** -> JSON (детерминированно, с хэшами)
  pe-exports.mjs        #   уже есть
docs/re/
  engine-lineage.md     #   версия предка, источники, швы (доказательства §1)
  engine-behavior.md    #   дефолты опций, методы, порядок, формат вывода — спека клона
  engine-quirks.md      #   воспроизводимые «неточности» (реестр + тесты)
```

Правила:
- движок остаётся **чистым ESM без зависимостей**, работает в браузере (как сейчас);
- старый движок не удаляем до паритета: `index.js` получает флаг `engine` (default пока `legacy`),
  набор тестов паритета решает момент переключения default на `clone`;
- комментарии — русские, идентификаторы — английские (`AGENTS.md`);
- `npm test` всегда зелёный; оракульные тесты делают self-skip без Wine/`EWB512/`.

---

## 4. Фазы, задачи, критерии приёмки

### Фаза R — Рекогносцировка и паспорт оригинала

| ID | Задача | Артефакт |
|---|---|---|
| R1 | Определить точную версию предка (SPICE3F4 / XSPICE v9?) по строкам и поведению | `docs/re/engine-lineage.md` |
| R2 | Полные списки экспортов/импортов `XSPICE32.DLL`, `WEWB32.EXE`, `EXT/*.DLL` | там же (Приложение) |
| R3 | Найти и зафиксировать исходники предка (архивы SPICE3F4 и XSPICE; в путь `vendor/`, см. §7) | `vendor/README.md` + хэши |
| R4 | Снять дефолты опций и сопоставить наши (таблица §1.2) | `docs/re/engine-behavior.md` §options |
| R5 | Выяснить, как WEWB32 транслирует `.ewb`: порядок элементов/узлов, какие анализы/приборы порождают элементы | `engine-behavior.md` §translation |
| R6 | Снять формат вывода приборов (`%.3e`? точность, единицы) | `engine-behavior.md` §format |

**Статус (2026-10):** R1–R4 — **готово** (`docs/re/engine-lineage.md`,
`docs/re/engine-behavior.md` §4; оракул уже работает — фаза O фактически сдана).
R5 — частично: снята карта экспортов `WEWB32` (169 `Ewb*`), путь вывода через
`split_*` (§5.3), 7 EWB-колбэков (§5.4); **порядок** трансляции `Comp → CKT`
(и нумерация узлов) ещё не снят — это делается по ходу P1.4–P1.6 сверкой с
оракулом. R6 — частично: `%.3e` оказался рудиментом F4-графики (`agraf.c`), а не
форматом приборов; формат приборов живёт во фронтенде (фаза I). Дополнительно
R5/R6 закрыли: FOUR/MonteCarlo/WorstCase/Sweeps — оркестрация фронтенда, не ядро.

**Приёмка:** четыре документа заполнены фактами (с командами/скриншотами вывода), база предка
определена, план порта уточнён.

### Фаза O — Оракул (дифференциальный харнесс)

| ID | Задача | Артефакт |
|---|---|---|
| O1 | Загрузить `XSPICE32.DLL` под Wine (32-бит) и вызвать `XSPIinit` + `CKTinit` из C-шима | `tools/oracle/shim.c`, `build.sh` |
| O2 | Научить шим строить цепь (`CKTnewNode/CKTcrtElt/CKTnewTask/CKTnewAnal`) и запускать (`CKTdoJob`) | там же |
| O3 | Снимать результаты через `OUTpData` и швы `getVoltage/getCurrent/getMatrixElement` → JSON | `tools/oracle/run.mjs` |
| O4 | Корпус: схемы из `EWB512/CIRCUITS/*` + сгенерированные (R/C/V/I/D/простые сети) | `tools/oracle/corpus/*.json` |
| O5 | Эталоны: прогон корпуса → `golden/*.json`; проверить детерминизм (3 прогона) | `golden/` + отчёт |
| O6 | Fallback-путь, если DLL не грузится: AutoIt-скрипт по GUI EWB + эталоны вручную (пометить менее точными) | `tools/oracle/gui/README.md` |

**Приёмка:** одна RC-схема считается оригиналом из шима, JSON воспроизводим; корпус ≥ 10 схем.

### Фаза P1 — Порт ядра (аналог, база)

| ID | Задача | Примечание |
|---|---|---|
| P1.1 | Порт `sparse` (spalloc/spbuild/spfactor/spsmp/spsolve) | тесты против эталонных матриц и oracle `getMatrixElement` |
| P1.2 | Порт CKT-скелета: узлы/элементы/модели/задачи/диспетчер | структура 1:1 по C |
| P1.3 | Порт NI: Ньютон, trap/gear, LTE-шаг (`trtol`), критерии сходимости | ключ к совпадению TRAN |
| P1.4 | Устройства: R, C, L, V, I, индуктивные связи, ключи (простые) | SPICE-уравнения 1:1 |
| P1.5 | Источники: DC/PULSE/PWL/SIN/EXP | сигнатуры SPICE3 |
| P1.6 | OP и TRAN на корпусе против оракула | первые diff-тесты |

**Статус (2026-10): P1.1 — ✅ готово.** План подпункта —
[`plans/P1.1-sparse.md`](./plans/P1.1-sparse.md). `Site/engine/spice/sparse.js` (~2200 строк) —
полный порт `vendor/spice3f4/src/lib/sparse/{spalloc,spbuild,spfactor,spsolve,sputils,spsmp}.c`
с конфигом из `spconfig.h` (REAL/spCOMPLEX, TRANSLATE/EXPANDABLE, MODIFIED_NODAL,
DETERMINANT(2)/MULTIPLICATION, DIAGONAL_PIVOTING; SCALING/STRIP/DELETE/CONDITION/
PSEUDOCONDITION/STABILITY/FORTRAN/MODIFIED_MARKOWITZ — NO; `DEBUG=NO` как в release,
`HAS_MINDATA`). Тесты:

- `Site/engine/test/sparse-golden.test.mjs` (10) — bit-exact сверка C↔JS через
  `tools/sparse-golden/` (C-драйвер из F4-исходников, gcc; один и тот же скрипт
  команд в C и JS, сравнение токенов и `Object.is` для double);
- `Site/engine/test/sparse.test.mjs` (14) — математика (делитель, AC, det,
  multiply/transposed, singular/gmin) и квирки.

Квирки, найденные портом, заведены в `docs/re/engine-quirks.md` (Q-S01…Q-S06;
Q-S06 — открытый вопрос про трансляцию индексов в `SMPfindElt`, сверить с DLL).
Следующий шаг — **P1.2** (CKT-скелет), порядок вызовов сверять с
`vendor/spice3f4/src/lib/ckt/` и `vendor/xspice-1-0/src/sim/NI/`.

**Приёмка:** OP/TRAN на корпусе совпадают (см. §5); сетка времени TRAN совпадает с оракулом.

### Фаза P2 — Устройства и модели

| ID | Задача |
|---|---|
| P2.1 | Диод (полный SPICE3: area, temp, breakdown/зенер) |
| P2.2 | BJT (Gummel-Poon: NPN/PNP, area, temp) |
| P2.3 | JFET, MESFET |
| P2.4 | MOSFET уровни 1–3/6 (как в оригинале — уточнить по строкам DLL) |
| P2.5 | Оп-ампы: идеальный + макромодели (OPAMP_5T/7T/9T по `MODELS`) |
| P2.6 | Трансформаторы, переключатели, T-line, URC — по составу DLL |
| P2.7 | AC-анализ с этими устройствами против оракула |

**Приёмка:** для каждого устройства — diff-тест на характерной схеме (ВАХ/режим/АЧХ).

### Фаза P3 — Анализы

- `op`, `dc` (sweep), `tran`, `ac` — базовые;
- `noise`, `disto`, `sens`, `tf`, `pz`, `four`, `temp` — по строкам DLL;
- MonteCarlo / WorstCase / ParameterSweep — **проверить (R5), где живут**: если это оркестрация
  WEWB32 (повторные прогоны с вариацией параметров), реализуем в `ewb-facade.js`, а не в ядре.

**Приёмка:** каждый анализ — diff-тест на корпусе; числа и число точек совпадают.

### Фаза X — XSPICE код-модели и цифра

- MIF-интерфейс (`MIF_init_xspice_instance`, `IFeval`), код-модели (`A`/`D` устройства);
- event-driven симулятор для цифры, карточки `ttl.m99/cmos.m99/misc.m99` (семейства LS/HC/…);
- смешанные аналого-цифровые схемы.

Это самая тяжёлая часть; делать после аналогового паритета, но в объёме «весь движок».

**Приёмка:** логический вентиль/триггер из чисел оригинала; смешанная схема сходится 1:1.

### Фаза M — MODELS и PartNum

| ID | Задача |
|---|---|
| M1 | Парсер `EWB512/MODELS/*.M**`: текстовые `P`-карточки; бинарные — RE |
| M2 | Карта `PartNum → {device, params}` по всем деталям библиотеки EWB |
| M3 | Генерация `Site/engine/models/ewb-models.json` (коммитится; воспроизводимо) |
| M4 | Сверка карты с реальными `.ewb` (`PartNum` из `CIRCUITS/*`) |

**Статус (2026-10): M1–M4 — готово.** Артефакт `Site/engine/models/ewb-models.json`
(`format=ewr-ewb-models`, `version=2`) генерируется `tools/models-parse.mjs`
(0 зависимостей, детерминированно, sha256 входов). Три источника карты:
`WEWB.RES` (классы `C`-записей), `WEWBMSG.RES` (авторитетные имена, индекс = PartNum),
`MODELS/*.M<num>` (семейства/карточки). Покрытие M4 по `CIRCUITS/**`:
99 схем, 47/47 номеров деталей и 3874/3874 экземпляров = **100 %**
(служебный PN 39 «Node» исключён). Тесты — `test/models.test.mjs` (12 шт., self-skip
без `EWB512/`). Подробности и открытые вопросы — `docs/re/engine-parts.md`;
факты формата (индексное пространство проводов, PN39-маркеры, `Library/Circuit.Models`,
`MacroFace`) — `docs/re/EWB-file-format.md` §4.

Побочно найдено и исправлено: `Site/engine/parser.js` считал индекс провода
позицией «среди `Comp`», тогда как `wire.pos` адресует полный список
`Elements` (`Comp`+`Instrument`+`ExtComp`+`MacroIcon`) — на схемах с приборами
это смещало элементы (тест: `Site/engine/test/parser.test.mjs`).

**Приёмка:** покрытие ≥ 95% PartNum из схем `CIRCUITS/`; таблица подтверждена diff-тестами.

### Фаза I — Интерфейс (минимально)

| ID | Задача |
|---|---|
| I1 | `ewb-facade.js`: сцена редактора (`WireSystem.scene()`) → deck CKT; обратно — результаты |
| I2 | Источник ЭДС/генератор: компонент редактора → `vsource` (DC/AC/импульс) |
| I3 | Вольтметр: прибор-компонент, читает напряжение узла (через шов `getVoltage`) |
| I4 | Амперметр: 0-Ω ветвь + чтение тока (`getCurrent`) |
| I5 | Кнопка **Run**: реальная сцена → движок → значения на приборах/в `#status` |
| I6 | Проверка: собрал мышью ЭДС+R+вольтметр+амперметр → числа совпадают с оракулом |

**Приёмка:** I6 проходит в браузере; DOM-часть покрыть тонким smoke-тестом (по возможности).

### Фаза T — Паритетные тесты и quirk-лист

- Слои тестов:
  1. **Юнит** порта (sparse против эталонов; устройство против справочных точек SPICE).
  2. **Паритетные (diff)**: корпус × анализы → сравнение с `golden/*.json` по правилам §5.
  3. **UI-регрессия**: сборка сцены/открытие файла/Run (что можно автоматизировать).
- **Quirk-лист** (`docs/re/engine-quirks.md`): каждое воспроизводимое отклонение оригинала
  (упрощения, ringing, ошибки сходимости) — с ID, описанием, ссылкой на тест.
- Допуски сравнения настраиваются таблицей по классам (напряжение/ток/время), см. §5.

**Приёмка:** корпус зелёный; каждый quirk имеет тест; для каждого устройства — свой diff-тест.

### Фаза G — Выкат

- Переключить default `index.js` на `engine:'clone'`; legacy — под флагом ещё один релиз;
- обновить `docs/engine/PLAN.md`, `Site/engine/README.md`, `AGENTS.md`;
- отчёт о покрытии: таблица «устройство/анализ/шов — реализовано — diff-тест».
- Производственный конвейер (Фаза 7) по-прежнему **вне задания**.

---

## 5. Правила сравнения («что считаем 1:1»)

1. **OP / DC**: напряжения узлов — относительная 1e-6, абсолютная 1e-9 (начинаем строго,
   ослабляем только с записью в quirk-лист); токи — 1e-9 абс; флаг сходимости (`converged`)
   обязан совпадать.
2. **TRAN**: **обязательное совпадение сетки времени** (оригинал сам выбрал шаги) и значений в
   этих точках; несовпадение сетки — дефект порта, не «допуск».
3. **AC**: частоты — те же; амплитуда/фаза — 1e-6 отн., фаза — 1e-4 рад.
4. **UI-уровень**: формат/округление вывода приборов — символ-в-символ (формат снять в R6;
   строка `%.3e` — кандидат).
5. **Матрица**: для отладки — сверка `getMatrixElement` на первой итерации (штамповка 1:1).
6. **Ошибки/невязки**: деление на ноль, «singular matrix», «no convergence» — сравнивать как статус.
7. Недетерминизм проверяем: один и тот же прогон оракула 3× — идентичен.

---

## 6. Риски и меры

| Риск | Мера |
|---|---|
| Не найдётся точная версия предка (v9 vs 3F4) | RE-сверка строк/поведения; параллельно сборка спеки из RE |
| `XSPICE32.DLL` не грузится под Wine | Fallback O6 (GUI-автоматизация) + приоритет RE-спеки |
| XSPICE event-driven цифра — большой объём | Отдельная веха X; аналоговый паритет раньше |
| Объём порта (ядро SPICE3 ~ десятки тыс. строк C) | Инкрементально, «ступень = зелёный diff-тест»; не портировать всё сразу |
| Производительность JS | Начать с прямого порта; при нужде — WASM для sparse/NI |
| Соблазн «улучшить» оригинал | Quirk-лист обязателен; тесты фиксируют поведение, включая баги |
| Разъезд с `AGENTS.md`/тестами | `npm test` зелёный на каждой ступени; self-skip без `EWB512/`/Wine |

---

## 7. Исходники предка: где держать

- **JS-порт** (продукт) — в `Site/engine/spice/` (коммитится, как обычный код).
- **C-исходники** (референс для порта) — в `vendor/` (не коммитить; `vendor/README.md` +
  `tools/fetch-vendor.mjs` со ссылками и хэшами). «Sources of truth»: архив SPICE3F4 (Berkeley)
  и XSPICE (Georgia Tech, версия линии v9); `ngspice` — только справочная реализация поведения,
  не источник копирования.
- **MODELS** — не копировать файлы как есть; парсить (`tools/models-parse.mjs`) и коммитить
  производный `ewb-models.json` (решение владельца).

---

## 8. Чеклист первых задач следующему агенту

1. [x] Прочитать этот файл + `AGENTS.md` + `docs/engine/PLAN.md` §1–4.
2. [x] `npm test` — база зелёная (**84** теста на 2026-10, включая оракул, модели и sparse).
3. [x] **R1–R3**: версия предка, источники (`docs/re/engine-lineage.md`), `vendor/`.
4. [x] **O1–O5**: оракул (32-бит Python + ctypes под Wine) считает OP/TRAN, golden сняты,
   детерминизм проверен (`tools/oracle/`, `test/oracle.test.mjs`).
5. [x] **R4–R6**: дефолты опций и формат вывода — `docs/re/engine-behavior.md`.
6. [x] **M1–M4**: карта PartNum + `ewb-models.json` (100 % покрытие CIRCUITS) —
   `docs/re/engine-parts.md`, `test/models.test.mjs`.
7. [x] **P1.1**: порт sparse готов (`Site/engine/spice/sparse.js`) + golden-харнесс C↔JS
   (`tools/sparse-golden/`), тесты `sparse-golden.test.mjs` (10) и `sparse.test.mjs` (14);
   квирки — `docs/re/engine-quirks.md`.
8. [ ] **P1.2–P1.3**: CKT + NI (Ньютон/интеграция/LTE).
9. [ ] **P1.4–P1.6**: R/C/L/V/I + OP/TRAN diff-тесты.
10. [x] Quirk-лист заведён (`docs/re/engine-quirks.md`, Q-S01…Q-S06) — вести дальше
    с каждого расхождения.

Правило ступеней: **каждая ступень заканчивается зелёными тестами** (`npm test`, включая
diff-тесты, если оракул поднят).

---

## 9. Definition of Done вехи «клон»

- [ ] Корпус (≥ 30 схем × применимые анализы) проходит diff-тесты по правилам §5.
- [ ] Состав устройств/анализов = оригиналу (по экспортам/строкам DLL), с картой покрытия.
- [ ] Цифровая и смешанная части воспроизводятся (Фаза X), либо явно внесены в исключения
      с записью «не реализовано» в отчёте.
- [ ] Quirk-лист полон для охваченных устройств; каждый пункт покрыт тестом.
- [ ] UI: собранная мышью схема (ЭДС + R + вольтметр + амперметр) даёт те же числа, что оригинал.
- [ ] `index.js` default = `clone`; legacy под флагом; документация обновлена.

---

## 10. Открытые вопросы

1. Точная версия предка и где брать его архив (R1/R3) — решается в первой задаче.
2. Волюм цифры: включать ли сразу Full mixed-mode (Фаза X) или отдельной вехой после аналога
   (по умолчанию — второе).
3. Графер/осциллограф: вне «немного присоединить»; отдельная веха после I.
4. Судьба legacy-движка после паритета: удалить или оставить под флагом.

---

## Приложение A. Экспорты `XSPICE32.DLL` (снято `tools/pe-exports.mjs`)

```
CKTask, CKTaskAnalQ, CKTaskNodQst, CKTbindNode, CKTcrtElt, CKTdelTask, CKTdestroy,
CKTdltInst, CKTdltMod, CKTdltNod, CKTdnames, CKTdoJob, CKTfndAnal, CKTfndDev,
CKTfndMod, CKTfndNode, CKTfndTask, CKTground, CKTinit, CKTinst2Node, CKTmodAsk,
CKTmodCrt, CKTmodParam, CKTnewAnal, CKTnewNode, CKTnewTask, CKTparam, CKTsetAnalPm,
CKTsetNodPm, CKTtrouble, IFeval, MIF_init_xspice_instance, OUTattributes,
OUTbeginDomain, OUTendDomain, OUTendPlot, OUTerror, OUTpBeginPlot, OUTpData,
OUTstopnow, OUTwBeginPlot, OUTwData, OUTwEnd, OUTwReference, XSPIinit,
addCurrent, changeCapacitorValue, changeInductorValue, findNode, getCurrent,
getMatrixElement, getVoltage, isFirstIteration, setBreakPoint,
setRelativeBreakPoint, setMaxStep, spice_malloc, split_OUTattributes,
addVoltage
```

## Приложение B. Текущее состояние репозитория (на момент написания)

- `Site/engine/` — рабочий «старый» движок: `analysis.js` (MNA, Ньютон, TRAP/BE, DC/TRAN/AC),
  `system.js`, `linalg.js`, `netlist.js`, `index.js`, `parser.js` (`.ewb`→нетлист),
  `ewb-codec.js` (декод Type1/2, энкодер Type1), `ewb-text.js` (сериализатор).
- `Site/engine/spice/` — порт предка: `sparse.js` (P1.1); далее `ckt.js`, `ni.js`, …
- `Site/engine/models/ewb-models.json` — карта PartNum (генерируется `tools/models-parse.mjs`).
- Открытие/сохранение в редакторе: `Site/logic/js/file-io.js` (Open/Save/New, плейсхолдеры),
  мост `Site/logic/js/sim.js`.
- Тесты: `npm test` → **84** зелёных (кодек, парсер, сериализация, солверы, мост, оракул,
  модели, sparse: golden C↔JS и юниты).
- Инструменты: `tools/ewb2txt.mjs` (`--info`, `--dir`), `tools/pe-exports.mjs`,
  `tools/models-parse.mjs`, `tools/oracle/`, `tools/sparse-golden/`.
- Референс-данные: `EWB512/`, `extracted_assets/`, `Site/img/` (read-only, не в git).
- Планы: `docs/engine/PLAN.md`, `docs/engine/PLAN-CLONE.md`, `docs/engine/plans/*`.
- Правила: комментарии русские, идентификаторы английские, ESM, 0 зависимостей,
  `node --test`, self-skip без `EWB512/`.
