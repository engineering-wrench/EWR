# EWR — план «пересоса движка» (для ИИ-агентов)

> Этот файл — машиночитаемый план и карта проекта EWR (clean-room среда
> моделирования электронных схем, совместимость с Electronics Workbench 5.12).
> Жёсткие правила работы — в корневом `AGENTS.md` (читается OpenCode автоматически).
> Здесь — архитектура, статус, план по фазам, RE-находки и критерии готовности.
>
> Последнее обновление: по результатам сессии разбора (2026).
> Источник истины о формате `.ewb` — `docs/re/EWB-file-format.md`.
>
> 🎯 **Целевая веха — 1:1 клон движка оригинала (XSPICE32).** Полный план порта,
> оракула и паритетных тестов — `docs/engine/PLAN-CLONE.md` (читать перед работами
> по движку; в нём зафиксированы решение владельца и стратегия A+C+B).
>
> 📋 **Детальные планы подпунктов** — `docs/engine/plans/` (индекс:
> `docs/engine/plans/README.md`, шаблон: `_TEMPLATE.md`). Один подпункт = один файл;
> правила создания/ведения — `AGENTS.md` §«Планы».

---

## ⚡ СТАТУС (после первой итерации движка)

- **Движок реализован в `Site/engine/`** (НЕ корневой `engine/` — корень фронта это
  `Site/`, иначе браузер не импортирует модули). Пустой корневой `engine/` удалён.
  Все ссылки ниже на `engine/backends/` читать как `Site/engine/`.
- **Готово (Фаза 1 + 2, частично 3):** MNA + LU (реальный/комплексный), Ньютон–Рафсон
  (gmin/source stepping, pnjlim), TRAN (трапеция/Эйлер, UIC, PWL/pulse), AC (комплексный).
  Устройства: R, C, L, V(DC/PWL/pulse/AC), I, диод, земля. **Парсер `.ewb → нетлист`,
  браузерный кодек** (декод Type1/2, байт-в-байт с CLI; энкодер Type-1), **сериализатор**.
- **Файлы в редакторе** (`Site/logic/js/file-io.js`): **Open** `.ewb` → декод+парсер+сцена
  (плейсхолдеры для нераспознанных), **Save** → сцена → `.ewb` (Type-1) → скачивание;
  **New** — очистить. Плюс `demo.html` и мост `sim.js` (`window.EWR_SIM`, Run → `selfTest`).
- **Тесты:** `npm test` → 192 зелёных (кодек/парсер/сериализация/солверы/мост/оракул/модели +
  sparse: golden C↔JS и юниты + CKT: `ckt.test.mjs` + NI: `ni.test.mjs` + устройства:
  `devices.test.mjs` + анализы: `analyses.test.mjs`). Полный цикл
  открыть→сохранить→переоткрыть проверен на `kirch_cu.ewb`.
- **Клон движка, P1.1 (`docs/engine/PLAN-CLONE.md`):** порт `sparse` 1.3 —
  `Site/engine/spice/sparse.js`; C↔JS golden-харнесс `tools/sparse-golden/`
  (bit-exact сверка через gcc-сборку F4); квирки — `docs/re/engine-quirks.md`.
- **Клон движка, P1.2:** CKT-скелет — `Site/engine/spice/ckt.js` (узлы/элементы/модели/
  задачи/диспетчер анализов 1:1 по F4), каркас NI — `ni.js` (`niInit/niReinit/niDestroy`),
  каталог 84 устройств и 10 анализов — `catalog.js` (генератор `tools/gen-spice-catalog.mjs`,
  источник `tools/oracle/golden/enum.json`); тесты `Site/engine/test/ckt.test.mjs` (30);
  план — [`plans/P1.2-ckt.md`](./plans/P1.2-ckt.md), квирк Q-C01.
- **Карта PartNum/библиотеки (`docs/re/engine-parts.md`, фаза M плана клона):**
  `tools/models-parse.mjs` → `Site/engine/models/ewb-models.json`; имена —
  `WEWBMSG.RES` (индекс = PartNum), классы — `WEWB.RES`, семейства — `MODELS/*.M**`;
  покрытие по `CIRCUITS/**` — 100 % номеров и экземпляров.
- **Клон движка, P1.3:** полный NI по XSPICE-редакции — `niIter` (Ньютон,
  `SMPpreOrder`/`SMPreorder`/`SMPluFac`/`SMPsolve`, `E_SINGULAR`/`E_ITERLIM`, машина
  `MODEINIT*`), `niConvTest`, `niComCof` (трапеция 1–2, Gear 1–6), `niIntegrate`;
  в `ckt.js` — `cktLoad`/`cktConvTest`/`cktTrunc`; тесты `Site/engine/test/ni.test.mjs` (19);
  план — [`plans/P1.3-ni.md`](./plans/P1.3-ni.md), квирки Q-C02…Q-C04, Q-N01.
- **Клон движка, P1.4:** порт базовых устройств — `Site/engine/spice/devices/`
  (`resistor`, `capacitor`, `inductor`+`mutual`, `vsource`, `isource`, `switch` SW/CSW,
  `common`, `index`); параметры каталога (`instanceParms`/`modelParms`) + автоустановка
  хуков в `DEVICES`; `ckt.js` — `cktParam`/`cktModParam`/`cktFndBranch`/`cktDltNNum`/
  `cktTerr`/`cktAcLoad`; тесты `Site/engine/test/devices.test.mjs` (12);
  план — [`plans/P1.4-devices.md`](./plans/P1.4-devices.md), квирки Q-D01…Q-D04.
- **Клон движка, P1.5:** точки останова независимых источников — `CKTbreaks`/
  `cktSetBreak`/`cktClrBreak`, `DEVaccept` у `Vsource`/`Isource` (PULSE/PWL),
  `cktAccept` в диспетчере устройств; тесты в `devices.test.mjs` (`TR`, затем
  `TD+TR+PW`); план — [`plans/P1.5-sources.md`](./plans/P1.5-sources.md), квирк Q-A01.
- **Клон движка, P1.6:** анализы OP/TRAN — `Site/engine/spice/analyses/`
  (`cktop` — gmin/source stepping, `op` — `DCop`, `tran` — `TRANinit`/`DCtran` по
  XSPICE-редакции, `index` — установка в `ANALYSES`); выход `cktOut*`; параметры
  анализов (`cktAnalParamIndex`); паритет с оракулом: `op_divider`/`op_rc` —
  бит-в-бит, `tran_rc` — 180/180 точек (сетка `timeRel=1e-9`, Q-F01); тесты
  `Site/engine/test/analyses.test.mjs` (4); план — [`plans/P1.6-op-tran.md`](./plans/P1.6-op-tran.md),
  квирки Q-A01, Q-O01/Q-O02, Q-F01.
- **Клон движка, P2.7 (частично):** AC-драйвер — `Site/engine/spice/analyses/ac.js`
  (`ACan`/`CKTacDump`/параметры), `ni.js` — `niAcIter`; корпус `ac_rc` + golden,
  комплексные значения и сетка совпадают с оракулом (Q-A02: LINEAR в DLL — по F4);
  тесты `analyses.test.mjs` (6); план — [`plans/P2.7-ac.md`](./plans/P2.7-ac.md).
- **Клон движка, I1 (GUI):** `Site/engine/ewb-facade.js` — сцена редактора
  (`WireSystem.scene()`) → дека CKT → OP/TRAN/AC, узлы/токи/приборы/ряды;
  Run в `Site/logic/js/sim.js` гоняет реальную схему, швы
  `getVoltage`/`getCurrent`/`setMaxStep` в `ckt.js`; тесты `facade.test.mjs`;
  план — [`plans/I1-gui.md`](./plans/I1-gui.md).
- **GUI, I2 (символы палитры):** готовые SVG из `Site/components/ewb-*`
  подключены к существующим плиткам без новых компонентов: `ewb-3002-02` →
  `resistor`, `ewb-3002-03` → `capacitor`, `ewb-3001-01` → `point` (земля),
  `ewb-3213-02` → `generator`; пустые поля SVG обрезаны;
  `file-io.js` использует их при открытии `.ewb`, тест — `test/components.test.mjs`;
  скил для будущих агентов — `.opencode/skills/component-symbols/`; план —
  [`plans/I2-component-symbols.md`](./plans/I2-component-symbols.md).
- **GUI, I3 (бесконечное поле):** `Site/logic/js/viewport.js` — мировые координаты,
  масштаб колесом/кнопками (`#zoom-controls`, 10–800 %), панорама ПКМ/СКМ+drag и
  стрелками; компоненты/провода/выделение/сохранение сцены переведены на мировые px,
  размер символа фиксирован (`worldSymbolSize`, пропорции viewBox сохранены);
  план — [`plans/I3-canvas-viewport.md`](./plans/I3-canvas-viewport.md).
- **GUI, I4 (палитра 1:1):** статическая таблица PartsBin из `WEWB32.EXE`
  (17 записей, ленты 31xx/30xx/33xx/32xx, счётчики), реестр `COMPDAT.DLL` и имена
  13 вкладок из `WEWBMSG.RES` (Sources…Instruments; `3014–3017` — иконки диалогов,
  не вкладки); `tools/palette-extract.mjs` → `Site/engine/palette.generated.json`,
  контракт — `docs/re/palette.md`; цель — привязка «плитка → `PartNum`/`ExtComp`-имя»
  вместо эвристик. Сделано: все 155 плиток 13 вкладок привязаны
  (`tools/palette-tiles.data.mjs`), 155 манифестов с блоком `ewb`, порядок
  `idListComponent` заполнен; шаг 5b закрыт — тип элемента берётся из данных
  (`Site/engine/ewb-devices.js`, генератор `--runtime`) в `parser.deviceType`,
  `sim.mapComponentType`, `ewb-facade.mapEditorType`, `file-io.buildScene`;
  план — [`plans/I4-palette.md`](./plans/I4-palette.md).
- **Клон движка, P2.1:** полный диод по редакции XSPICE —
  `Site/engine/spice/devices/diode.js` (`DEVsetup` с внутренним узлом `rs`,
  `DEVload` DC/TRAN с `pnjlim`/пробоем/зарядом, `DEVtemperature`, `DEVacLoad`,
  `DEVtrunc`, `DEVconvTest`, `DEVask`/`DEVmAsk`, `DEVunsetup`);
  корпус оракула `diode_{fwd,rs,rev,rect,ac}` — OP/AC бит-в-бит, TRAN 351/351;
  квирки Q-D05 (`NOBYPASS`), Q-D06 (`NEWCONV`), Q-O03; план —
  [`plans/P2.1-diode.md`](./plans/P2.1-diode.md).
- **Дальше:** P2.2 (BJT Gummel-Poon), затем JFET/MOSFET/оп-ампы и полный AC
  с нелинейными устройствами; осциллограф/графер как отдельное окно (после I);
  сохранение в Type-2 (сжатие), уникальные id компонентов редактора.

---

## 0. TL;DR

EWB 5.12 = редактор схем + **SPICE-3 движок** + экранные приборы. В репозитории
готовы реверс формата `.ewb`, фронт-редактор, legacy-движок (`Site/engine/`) и порт
предка XSPICE32 (`Site/engine/spice/`). Целевая веха — 1:1 клон движка; путь и статус —
`docs/engine/PLAN-CLONE.md` + планы подпунктов в `docs/engine/plans/`.

Конвейер:

```
EWB512/*.ewb ──codec(tools/ewb2txt.mjs)──▶ текстовая сериализация (EWB text model)
                                            │
                              ┌─────────────┴─────────────────────┐
                              ▼                                   ▼
               [Фаза 1] ПАРСЕР модели/нетлиста          docs/re/ (контракт формата)
                              │  (Comp → ветвь; wire{node_p} → узел)
                              ▼
               [Фаза 2] МАТ.ЯДРО  MNA · LU · Newton-Raphson · trap/Эйлер · DC OP   [ГОТОВО: Site/engine/]
                              │
                              ▼
               [Фаза 3] МОДЕЛИ устройств  R/L/C/V/I → диоды/БТ/МОП/оп-ампы/логика/555
                              │
                              ▼
               [Фаза 4] АНАЛИЗЫ  OP/DC/TRAN/AC/Noise/Fourier/TF/Sens/PZ/Dist/MC/WC/Sweep
                              │
                              ▼
               [Фаза 5] МОСТ ↔ UI  приборы: мультиметр/генератор/осциллограф/ЛА/Bode/Grapher
                              │
               [Фаза 6] (параллельно) ОБРАТНЫЙ кодек txt→ewb для сохранения

   Фаза 7 — production-build и CI/CD. ВНЕ текущего задания (см. AGENTS.md, правило «build только под тесты»).
```

Зависимости строго фазовые: `0→1→2→3→4→5`. Фаза 6 — параллельно 5. Фаза 7 — отдельно.

---

## 1. Статус: что сделано / что нет

### ✅ Сделано

| Область | Где | Примечание |
|---|---|---|
| RE формата `.ewb` Type-1/Type-2 | `tools/ewb2txt.mjs`, `docs/re/EWB-file-format.md` | Чек-суммы секций сходятся (`OK`) для `DEFAULT.EWB`, `kirch_cu.ewb`, всего `CIRCUITS/*` |
| PE-дампер экспортов | `tools/pe-exports.mjs` | Для RE карты `PartNum`/DLL-бэкендов |
| Реестр компонентов | `Site/logic/js/registry.js` | fetch `manifest.json`+`symbol.svg`, кэш, `data-slot` |
| Drag-and-drop, коллизии, marquee/copy/paste/delete | `Site/logic/js/drag-and-drop.js` | |
| Маршрутизация проводов (A\*, коридоры, ручной сдвиг, localStorage) | `Site/logic/js/wires.js` | Значительный объём |
| Контекст-меню параметров | `Site/logic/js/component-menu.js` | |
| Настройки трассировки + debug-оверлей | `wire-settings.js`, `debug.js` | `?debug=1` |
| Меню категорий (нарезка BMP оригинала) | `interface.js`, `utilit.js` | |
| Редактор символов SVG→manifest | `Component-editor/` | экспорт `symbol.svg`+`manifest.json` |
| Правовая обвязка | `DISCLAIMER.md`, `LICENSE` | clean-room, MIT |
| **Тестовый харнесс кодекa** | `package.json`, `test/codec.test.mjs` | `npm test`, 0 зависимостей, golden-тесты |

### ❌ НЕ сделано (суть задачи)

| # | Не хватает | Блокирует |
|---|---|---|
| 1 | Парсер текстовой сериализации → модель/нетлист | весь движок |
| 2 | Мат.ядро (MNA, LU, Newton-Raphson, интегрирование) | вся симуляция |
| 3 | Библиотека моделей устройств | нелинейные/активные схемы |
| 4 | Типы анализов (9+ видов) | полнота EWB |
| 5 | Мост движок↔UI + приборы | пользовательский результат |
| 6 | Обратный кодек txt→ewb | сохранение файлов |
| 7 | Карта `PartNum→тип` + парсер `MODELS/*` | корректный разбор схем |
| 8 | Производственный build + CI/CD | релиз (ВНЕ задания сейчас) |

Кнопки `new/open/save/print` UI = `alert('в прогрессе')`. Тумблер «Run»
(`interface.js: switch_click`) лишь меняет картинку ON/OFF — реальной симуляции нет.
У 3 компонентов (resistor/generator/multimeter) **нет `symbol.svg`** → рисуются плейсхолдеры.

---

## 2. RE-карта формата (grounded по `EWB512/CIRCUITS/kirch_cu.ewb`)

Заголовок файла → тело после `/`. Тип шифрования: `EncryptionType: 1|2`
(Type-1 простой поток, Type-2 LZSS+Хаффман в 5 секциях — детали в `docs/re`).

Тело после декодирования — «Python-подобная» сериализация. Ключевые сущности:

```
Project[_5_1]
{ CircuitHeader { InternalCircuitVersion i 511 ... Ewb_Restrictions{...} Library PrintSettings }
  Circuit {
    Preferences{...}
    Elements { Comp* }              // компоненты (ветви)
    Wires   { wire* }              // соединения (рёбра)
    <Analysis*>                      // настройки анализов (например Oscilloscope/MultiMeter/FuncGen)
  }
}
```

**`Comp` (компонент/ветвь):**
```
Comp {
  PartNum i <N>                  // код типа из библиотеки EWB  → нужна карта PartNum→тип
  Position i:3 <x> <y> <?>       // позиция на схеме
  Value   r:<k> <v0> <v1> ...    // параметр(ы): напр. r:5 4 0 0 0 0 = R=4 Ом у R5
  ModelUnits i:1 <...>
  Common { RefID A "R5" }        // позиционное обозначение
  ModelName R ""                 // имя SPICE-модели
  Status i 0
  m_tptrElem A "R5^0"           // тип+реф+индекс (R/L/C/V/I/M=?, CONN=разъём)
  ...
}
```

**`wire` (соединение/ребро):**
```
wire {
  pos i:4 <a> <b> <c> <d>        // терминалы: из (комп. a, вывод b) в (комп. c, вывод d)
  segs i:<k> ...                 // точки сегментов маршрута
  colour i 0   wire_id i 0
  node_p A "<N>"                 // ★ номер ЭЛЕКТРИЧЕСКОГО УЗЛА; провода с равным node_p = один узел
  x_factor r ..  y_factor r ..
}
```

**Наблюденные `PartNum`** в схеме: `{1,2,8,9,12,39}`. Рефы: `R1..R3`(резисторы),
`V1`(источник), `M1..M5`, `CONN1/CONN2`(разъёмы/заземление). Точная карта `PartNum→тип`
выводится RE по `WEWB32.EXE` (Ghidra) и экспортам `EXT/*.DLL` — **это вход Фазы 1**.

**Блоки анализов/приборов**, встречающиеся в файлах (имя → перевод):

| Блок | Тип | | Блок | Тип |
|---|---|---|---|---|
| `ACanalysis` | анализ | | `Noise` | анализ |
| `DCsweep` | анализ | | `Fourier` | анализ |
| `Transient` | анализ | | `TransferFunction` | анализ |
| `ParameterSweep` | анализ | | `Sensitivity` | анализ |
| `TemperatureSweep` | анализ | | `PoleZero` | анализ |
| `Distortion` | анализ | | `WorstCase`/`MonteCarlo` | анализ |
| `Oscilloscope`/`LogicAnalyzer`/`Bode`/`Grapher` | прибор | | `MultiMeter`/`FuncGen`/`WordGen` | прибор |

**Модели устройств:** `EWB512/MODELS/` — библиотеки `.m*` (напр. `DEFAULT.M14/M15`,
`ttl.m99`, `cmos.m99`) и папки моделей `BJT_NPN/`, `MOS_3TDN/`, `OPAMP_7T/`, `DIODE/` и т.д.
Параметры для SPICE-моделей берутся отсюда (Фаза 3).

---

## 3. План по фазам (deliverables + тесты + критерий приёмки)

### Фаза 0 — Фундамент и тесты · *(почти готова)*
- Харнесс `npm test` без зависимостей; golden-тесты кодекa — **готово**.
- Сделать `tools/ewb2txt.mjs` **импортируемым модулем** (вынести CLI-`main` под guard
  `import.meta.url === ...`), не меняя поведение CLI.
- **Починить дефект Type-1**: ведущие байты короткого блока «мусорные» (см. §4).
- Приёмка: golden-тесты зелёные; `node tools/ewb2txt.mjs EWB512/UNTITLED.EWB` стартует с `Project…`.

### Фаза 1 — Модель и нетлист · `Site/engine/parser.js` — **✅ ГОТОВО**
- **Парсер сделан:** декодированный текст EWB → `spec` (`toSpec`). Разбирает
  `Elements/Comp` + `Wires/wire` (`pos`+`node_p`), типы по RefID/PartNum, земля,
  мультиметры-связи 0 Ом. Проверен на `kirch_cu`/`thevenin` (кирхгоф → решаемая сеть).
- Токенизатор/парсер сериализации (блоки `Project/Circuit/Elements/Comp/Wires/*Options`).
- Таблица **`PartNum→тип`** (RE-вывод) + резолвер `m_tptrElem` (`R/L/C/V/I/M/CONN/...`).
- Нетлист: `Comp`→ветвь (тип/значения/RefID); группировка `wire` по `node_p`→узел; терминалы из `pos`.
- Нормализация `Value r:k`, `ModelName` → параметры устройства.
- Тесты: golden-распарс `kirch_cu`/`thevenin`/`rectfier` → ожидаемый набор узлов/ветвей/типов.
- Приёмка: из файла `.ewb` получается валидный нетлист с именами узлов и ветвями.

### Фаза 2 — Математическое ядро · `Site/engine/` — **✅ ГОТОВО**
- Modified Nodal Analysis: сбор матриц `G`, `RHS` для источников.
- **Dense LU** с частичным выбором (схемы EWB малы — плотный решатель ок).
- **Newton-Raphson** для нелинейных элементов; стыковка с DC OP.
- Интегрирование: **trapezoid / backward-Euler** + LTE-контроль шага (подход SPICE3).
- Тесты: делитель напряжения; Thevenin; заряд/разряд RC; диодная I-V против контрольной точки.
- Приёмка: `DC OP` и `TRAN` сходятся на линейных эталонных схемах.

### Фаза 3 — Модели устройств · `Site/engine/` — частично (R/C/L/V/I/диод готовы)
- Пассивные `R/L/C`; источники `V/I` (DC/sin/pulse/…); ground; ключи; трансформаторы.
- Диод/Зенер/LED; `BJT` (Ebers-Moll / упрощ. Gummel-Poon); `JFET`; `MOSFET` (3T/4T); `MESFET`;
  **оп-ампы** (идеал + макромодели `OPAMP_5T/7T/9T`); `555`; логика `CMOS/TTL`.
- Парсер параметров `EWB512/MODELS/*`.
- Тесты: каждая модель против справочной рабочей точки/наклона.
- Приёмка: диод/БТ/МОП воспроизводят ожидаемые ВАХ и режимы.

### Фаза 4 — Анализы · `Site/engine/` — частично (OP/TRAN/AC готовы)
- `OP, DC, TRAN, AC(Bode), Noise, Fourier, TransferFunction, Sensitivity, PoleZero,
   Distortion, MonteCarlo, WorstCase, Parameter/Temperature sweep`.
- PQРанее всех — `OP→TRAN→AC→DC sweep` (покрывают большинство учебных схем).
- Тесты: АЧХ резонанса (RLC/Уин); спектр гармоник; сходимость sweep.
- Приёмка: результаты стабильны и физичны на референсных схемах из `CIRCUITS/`.

### Фаза 5 — Мост к UI и приборы · `Site/engine/` + `Site/logic/js/sim.js` — частично (мост + демо готовы)
- Планировщик `run/stop` (привязать к `switch`), цикл симуляции.
- Преобразование нетлиста UI (`wires.js` узлы/провода) в нетлист движка (сшить «мир редактора» и «мир .ewb»).
- Приборы: **мультиметр** (V/I/Ω/dB), **функген** (вход), **осциллограф** (буферы рядов),
  **логический анализатор**, **Bode/Grapher**, **WordGen**.
- Приёмка: прогон схемы меняет показания приборов; осциллограф рисует ряды.

### Фаза 6 — Сохранение · `Site/engine/` (кодек encode)
- Обратный кодек txt→ewb (Type-1/2) + checksum.
- **Round-trip**: закодировать → декодировать → сверить с оригиналом.
- Приёмка: схемы открываются/сохраняются с сохранением содержимого.

### Фаза 7 — Инфраструктура (ВНЕ текущего задания)
- Production-bundle (Vite/esbuild), минификация, восстановление `.github/workflows` (деплой на duckdns).
- **Не делать без явного разрешения.** Сейчас допускается только билд/харнесс под тесты.

---

## 4. RE-находки и грабли (зафиксировано прогонами)

- **Дефект Type-1 (UNTITLED.EWB):** тело декодируется корректно
  (`CircuitHeader`, `InternalCircuitVersion i 502`), но **первые байты короткого
  ведущего блока — «мусор»**. НЕ закреплять как эталон; чинить в Фазе 0.
- **Тег версии проекта разнится:** `DEFAULT.EWB` → `Project`; часть схем (`kirch_cu`) → `Project_5_1`.
  Парсер обязан принимать оба.
- **UNTITLED.EWB — пустой документ** (нет блока `Elements` с компонентами): это норма.
- **Сумма секций как оракул корректности:** `tools/ewb2txt.mjs --info <file>` печатает
  `checksum=… computed=… OK|MISMATCH`. Использовать в тестах как сильный сигнал.
- Эталоны `EWB512/` и `extracted_assets/` в git **не отслеживаются** (образцы оригинала) — тесты
  при их отсутствии self-skip, а не падают.

---

## 5. Как тестируем

- Запуск: `npm test` (`node --test`, авто-обход `test/**`). Ноль внешних зависимостей.
- Кодек — чёрным ящиком: CLI `node tools/ewb2txt.mjs [--info] <file>` / `--dir <папка>`.
  Читаем вывод как `latin1` (ANSI), `maxBuffer` с запасом.
- Золотые тесты фиксируют **контракт**, а не текущие баги (см. §4).
- Каждая фаза двигается только при зелёных тестах предыдущей (см. критерии приёмки).

---

## 6. OpenCode: как этим пользоваться

- Авто-загружаемые инструкции: корневой **`AGENTS.md`** (правила + how-to + протокол
  планов) + этот `PLAN.md` + `docs/engine/plans/README.md` (через `instructions`
  в `opencode.jsonc`).
- Конфиг — `opencode.jsonc`; расширения (если появятся) — в `.opencode/`.
- Полезные подагенты: `explore` (быстрый поиск по коду), `general` (многошаговые задачи).
- Локальные серверы фронта: Site → Live Server :5502, Component-editor → :5501
  (`Site/.vscode/settings.json`). Движок/тесты — через Node (>=18, проверено на 22).
- Перед началом подпункта — создать файл плана в `docs/engine/plans/` (см. `AGENTS.md`).
