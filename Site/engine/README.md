# EWR — движок симуляции (`Site/engine/`)

Клиентский SPICE-класс движок для EWR. Чистые ES-модули без DOM — работают
и в браузере, и в Node (поэтому покрываются тестами). Корень фронта — `Site/`,
поэтому движок лежит здесь (иначе браузер не смог бы его импортировать).

## Запуск тестов

```bash
npm test   # golden-тесты кодекa + движка: linalg, netlist, DC, TRAN, AC, мост
```

## Публичный API (`index.js`)

```js
import { simulate, buildNetlist, ENGINE_VERSION } from '/engine/index.js';

const r = simulate(spec, { analysis: 'op' | 'dc' | 'tran' | 'ac', ...opts });
```

### spec — нетлист

```js
{
  components: [
    { id:'R1', type:'resistor', value:1000, nodes:['n1','n2'] },
    { id:'V1', type:'vsource', dc:5, nodes:['n1','gnd'] },      // '+' на n1
    { id:'V2', type:'vsource', pwl:[[0,0],[1e-3,5],[2e-3,0]], nodes:['a','gnd'] },
    { id:'V3', type:'vsource', pulse:{v1:0,v2:5,delay:0,width:1e-3,period:2e-3}, nodes:['a','gnd'] },
    { id:'C1', type:'capacitor', value:1e-6, ic:0, nodes:['n2','gnd'] },
    { id:'L1', type:'inductor', value:1e-3, ic:0, nodes:['b','gnd'] },
    { id:'D1', type:'diode', is:1e-14, n:1, nodes:['a','c'] },
    { id:'I1', type:'isource', dc:1e-3, nodes:['gnd','n'] },
    { id:'GND', type:'ground', nodes:['gnd'] }                   // или любое имя из GROUND_NAMES
  ]
}
```

Земля — любое имя из `GROUND_NAMES` (`gnd`,`0`,`ground`,`com`,`vss`). Если ни один
узел не помечен землёй, `analyze` бросит ошибку о «висящем» решении нет(
получится вырожденная матрица).

### Типы устройств

`resistor`, `capacitor`, `inductor`, `vsource` (DC/PWL/pulse + `ac`),
`isource`, `diode` (Шокли), `ground`.

### Анализы

| kind | Опции | Результат |
|---|---|---|
| `op` / `dc` | — | `{ nodeVoltages, branchCurrents, elements[] }` |
| `tran` | `{ tstop, tstep, method:'trap'\|'be', uic }` | `{ t[], v{node:…}, i{id:…} }` |
| `ac` | `{ freqs:[…] }` или `{ fstart, fstop, points, sweep:'lin'\|'dec'\|'oct' }` | `{ f[], v{node:комплекс[]}, i{id:...} }` |

- DC: Ньютон–Рафсон с gmin- и source-stepping, ограничение p-n перехода (pnjlim).
- TRAN: трапеция / неявный Эйлер, фиксированный шаг, начальные условия (UIC/`ic`).
- AC: комплексный LU; диоды линеаризуются около рабочей точки.

## Архитектура

| Файл | Роль |
|---|---|
| `linalg.js` | LU реальный + комплексный (`luSolve`, `luSolveComplex`) |
| `system.js` | контейнер MNA (реальный/комплексный), `addA/addB/solve` |
| `netlist.js` | модель, `buildNetlist`, земли, источники PWL/pulse |
| `parser.js` | декодированный текст EWB → нетлист (`toSpec`) |
| `ewb-codec.js` | декодер `.ewb` (Type 1/2) в браузере + энкодер Type-1 (сохранение) |
| `ewb-text.js` | сериализатор spec → текст EWB + `groupTerminals` (сборка сцены) |
| `analysis.js` | штамповка, Ньютон, `solveDC/dcOp/transient/ac/analyze/simulate` |
| `index.js` | публичный API |
| `smoke.mjs` | ручной прогон: `node Site/engine/smoke.mjs` |

## Подключение к фронтенду

- **`demo.html`** — живое демо (DC/TRAN/AC + график на канвасе). Открыть через
  Live Server (root=`Site/`, порт :5502): `http://localhost:5502/engine/demo.html`.
- **`logic/js/sim.js`** — мост с редактором: `window.EWR_SIM = { simulate,
  buildNetlist, assignNets, mapComponentType, selfTest }`. Кнопка «Run» (#switch)
  при включении прогоняет `selfTest()` и пишет результат в `#status`.
  `assignNets()` — чистая сборка нетлиста из графа соединений (готова к
  полной привязке сцены, когда у размещаемых компонентов будут уникальные id).

## Парсер `.ewb` → нетлист (`parser.js`)

Принимает **декодированный текст** EWB (выход `tools/ewb2txt.mjs`) и отдаёт
`{ spec, warnings, stats }` — тот же `spec`, что ест движок:

```js
import { toSpec } from '/engine/parser.js';
const { spec, warnings } = toSpec(decodedText);   // decodedText — см. tools/ewb2txt.mjs
const res = simulate(spec, { analysis: 'op' });
```

Конвейер: `.ewb` → `node tools/ewb2txt.mjs f.ewb` (декод) → `toSpec(text)` (парсер) → `simulate`.
Разбирает `Circuit.Elements.Comp` и `Circuit.Wires.wire` (`pos`+`node_p`); тип — по
префиксу RefID/PartNum; земля (RefID `0`/P8) помечает все свои узлы; мультиметры `M`
с 2 выводами — связь 0 Ом (иначе цепь «висит»); `CONN` (маркер узла) и трансформаторы
`T` не эмитятся; «призраки»-элементы (без проводов) игнорируются.

## «Файлы» в редакторе (открыть / сохранить)

Кнопки **New/Open/Save** в `Site/EWR.html` подключены (`Site/logic/js/file-io.js`):

- **Open** `.ewb`/`.txt` — `decode()` (браузерный кодек) → `toSpec()` → сборка сцены
  по сетке с проводами; компоненты без «настоящего» символа (vsource/ёмкость/диод/…)
  рисуются **плейсхолдерами** (`buildPlaceholderNode`), резистор — реальным символом.
- **Save** — сцена (`WireSystem.scene()`) → `assignNets()` → `serializeNetlist()` →
  `encodeType1()` → скачивание `circuit.ewb` (Type-1). Полный цикл открыть→сохранить→
  переоткрыть проверяется в тестах на реальной схеме (`kirch_cu.ewb`).

## Статус

- ✅ DC (линейные + диод), TRAN (R/L/C, PWL/pulse, UIC), AC (линейные), **парсер `.ewb` → нетлист**,
  **браузерный кодек** (декод Type1/2 + энкодер Type-1), **сериализация**, **открыть/сохранить
  в редакторе с плейсхолдерами**, мост к UI (`sim.js`), демо-страница.
- ⛔ Следующие шаги — `docs/engine/PLAN-CLONE.md` и планы подпунктов
  (`docs/engine/plans/`): расширение устройств (BJT/MOSFET/оп-ампы/логика/555),
  сохранение в Type-2 (сжатие) для бинарной совместимости с оригиналом, уникальные id
  компонентов редактора + полная привязка сцены (кнопка Run).
