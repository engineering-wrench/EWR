# EWB 5.12 — карта PartNum и библиотека MODELS (фаза M)

> Источник истины: `EWB512/WEWB.RES` (записи классов), `EWB512/WEWBMSG.RES`
> (имена деталей), `EWB512/MODELS/*.M**` (семейства и карточки параметров) плюс
> схемы `EWB512/CIRCUITS/**` (эмпирическая сверка). Генерируемый артефакт —
> `Site/engine/models/ewb-models.json` (`tools/models-parse.mjs`).
> Связанные: `docs/re/EWB-file-format.md` (формат `.ewb`), `docs/re/engine-behavior.md`
> (поведение ядра), `docs/engine/PLAN-CLONE.md` (фаза M).
>
> Статус: M1–M4 — **готово** (сессия 2026-10). Всё, что не подтверждено файлом/прогоном,
> помечено **[?]**.

---

## 1. Как строится карта (M1–M3)

Три независимых источника, объединяемые в `partMap`:

| Источник | Ключ | Что даёт |
|---|---|---|
| `WEWB.RES` → `parseWewbRes` | `wewbres` | `C`-записи: номер детали, класс (`M="…"`: `diode`, `npn`, `opamp`, …), дефолтное значение, units |
| `WEWBMSG.RES` → `parsePartNames` | `wewbmsg` | **авторитетный** непрерывный блок имён: индекс строки = PartNum (0..41) |
| `MODELS/*.M<num>` → `parsePartFile`, `parsePCard` | `mfile`/`pcards` | семейства моделей (`P "…" <num> …`-карточки и подцепи) для номера `<num>` |

Правила объединения (`buildPartMap`):

* имя — из `WEWBMSG.RES`; класс — из `WEWB.RES`; файлы моделей/карточки — из `MODELS`;
* номер подтверждён, если он есть хотя бы в одном источнике; поле `sources` перечисляет все;
* `bin: true` — часть объёма файлов `.M**` закодирована (шапка + блок строк `A..P`);
  такие файлы пока учитываются только именем/sha256 (см. `notes` артефакта);
* `defaultValue`/`units` — из `C`-записи WEWB.RES, если есть (иначе `defaultValue` из
  первой `P`-карточки).

Артефакт (`format: ewr-ewb-models`, `version: 2`) содержит секции: `files`, `parts`,
`models`, `subckts`, `byPartNum`, `byModel`, `bySubckt`, **`wewbRes`**, **`wewbMsg`**,
**`partMap`**. Счётчики на момент генерации (см. `counts` в JSON):

```
files=351  parts=2925  models=4312  subckts=2434  subcktBodies=656
encodedFiles=135  quirkFiles=1  resParts=88  partNames=42  partMapNums=65
```

`quirkFiles=1` — `ANALOGT.LIB`: тело `ADG406` начинается без ключевого слова `.SUBCKT`
(строка 862), `.ENDS ADG406` — на 1158; парсер помечает файл `missing-subckt-keyword`
и достраивает заголовок сам.

---

## 2. Авторитетная таблица имён (WEWBMSG.RES, индекс = PartNum)

Имена ниже — из непрерывного блока `WEWBMSG.RES` (индексы 0..41). Колонки «наблюдено»
и «класс» — эмпирика `CIRCUITS/**` (M4) и `WEWB.RES` соответственно.

| PN | Имя (WEWBMSG.RES) | Класс (`WEWB.RES`) | Наблюдено в `CIRCUITS/**` |
|---:|---|---|---|
| 0 | AC Voltage Source | — | 55 экз., refs `V` |
| 1 | Resistor | — | 664 экз., refs `R` |
| 2 | Battery | — | 129 экз., refs `V` |
| 3 | Capacitor | — | 165 экз., refs `C` |
| 4 | Diode | `diode` | 59 экз., refs `D`; модели `ideal`, `1n:1N4002/1N4148` |
| 5 | NPN Transistor | `npn` | 165 экз., refs `Q`; модели `ideal`, `misc:QNL/QND` |
| 6 | Inductor | — | 18 экз., refs `L` |
| 7 | AC Current Source | — | 8 экз., refs `I` |
| 8 | Ground | — | 452 экз., refs `0`/без RefID |
| 9 | Connector | — | 1679 экз., refs `CONN`, `Z`, `N` (узел-точка, 4 стороны) |
| 10 | DC Current Source | — | 11 экз., refs `I` |
| 11 | PNP Transistor | `pnp` | 32 экз., refs `Q`; модели `ideal`, `misc:QPL/2N3906` |
| 12 | Ammeter | — | 20 экз., refs `M` |
| 13 | Voltmeter | — | 39 экз., refs `M` |
| 14 | Transformer | `transf` | 14 экз., refs `T`; модели `ideal`, `power:10_to_1`, `misc:rf` |
| 15 | 3-Terminal Opamp | `opamp` | 90 экз., refs `AR`, `O`; модели `ideal`, `lm:LM741`, `misc:TL074AC` |
| 16 | Zener Diode | `zener` | 16 экз., refs `D` |
| 17 | LED | `led` | 38 экз., refs `D` |
| 18 | Bulb | `bulb` | 9 экз., refs `R` |
| 19 | Fuse | `fuse` | 6 экз., refs `R` |
| 20 | Relay | `relay` | 9 экз., refs `R` |
| 21 | Time-Delay Switch | — | 19 экз., refs `S` |
| 22 | N-Channel JFET | `jfet-n` | 16 экз., refs `Q`; `ideal`, `misc:2N3686`, `njfet:2N5458` |
| 23 | P-Channel JFET | `jfet-p` | 6 экз., refs `Q` |
| 24 | 3-Terminal Depletion N-MOSFET | `nmos-dm` | 6 экз., refs `Q` |
| 25 | 3-Terminal Depletion P-MOSFET | `pmos-dm` | 6 экз., refs `Q` |
| 26 | 4-Terminal Depletion N-MOSFET | `nmos-dmb` | 6 экз., refs `Q` |
| 27 | 4-Terminal Depletion P-MOSFET | `pmos-dmb` | 6 экз., refs `Q` |
| 28 | 3-Terminal Enhancement N-MOSFET | `nmos-em` | 12 экз., refs `Q` |
| 29 | 3-Terminal Enhancement P-MOSFET | `pmos-em` | 10 экз., refs `Q` |
| 30 | 4-Terminal Enhancement N-MOSFET | `nmos-emb` | 6 экз., refs `Q` |
| 31 | 4-Terminal Enhancement P-MOSFET | `pmos-emb` | 6 экз., refs `Q` |
| 32 | Voltage-Controlled Voltage Source | — | 22 экз., refs `V` |
| 33 | Current-Controlled Current Source | — | 6 экз., refs `I` |
| 34 | Voltage-Controlled Current Source | — | 6 экз., refs `I` |
| 35 | Current-Controlled Voltage Source | — | 8 экз., refs `V` |
| 36 | Voltage-Controlled Switch | — | 11 экз., refs `S` |
| 37 | Current-Controlled Switch | — | 6 экз., refs `S` |
| 38 | Switch | — | 38 экз., refs `S` |
| 39 | Node | — | **служебный**: маркер узла (см. §4), исключён из покрытия |
| 40 | IC Template | — | не наблюдался в схемах (шаблоны микросхем — `ExtComp`) |
| 41 | Subcircuit Template | — | не наблюдался (макроподцепи — `MacroFace`/`MacroIcon`) |

### Номера семейств из `MODELS/*.M<num>` (за пределами 0..41)

| PN | Что это (по файлам `MODELS/`) |
|---:|---|
| 50 | ОУ-семейства (`*.M50`: OPXXX, LM1XX… — операционные усилители) |
| 52–55, 57, 58, 60–73, 76 | прочие аналоговые семейства (OP-карточки, tl, ua…); точная атрибуция — по `cardNames` в `partMap` |
| 99 | **цифровые** семейства: `ttl.m99`, `cmos.m99`, `misc.m99`, `DEFAULT.M99` |

В схемах `CIRCUITS/**` номера >41 не встречались (цифровые схемы представлены
`ExtComp`/`MacroIcon`, а не `Comp`-деталями). В `partMap` все они есть
(`partMapNums=65`), источники — только `mfile`/`pcards`.

---

## 3. Покрытие M4 (схемы `CIRCUITS/**`)

Прогон `node tools/models-parse.mjs --coverage`:

```
схем: 99, PartNum всего: 48
покрытие по номерам:     47/47 = 100.0%
покрытие по экземплярам: 3874/3874 = 100.0%
служебные (не детали): 39
нет в карте: —
```

* 48 номеров = 47 деталей (0..38, кроме служебного 39) + 8 номеров семейств
  (`50,53,54,55,57,60,61,99`) из `MODELS`;
* по номерам и по экземплярам — **100 %**; «служебные» (PN 39) исключаются из
  числителя/знаменателя (`SERVICE_PARTNUMS`);
* `--coverage --files` печатает дополнительно, в каких схемах встречается номер;
* эмпирика refs (колонка §2) показывает, что префикс RefID — неотличим у разных
  номеров (`D` — диод/зенер/LED; `M` — амперметр/вольтметр; `Q` — BJT/JFET/MOSFET;
  `V` — батарея/источники; `R` — резистор/лампа/предохранитель/реле), поэтому
  **тип устройства в нетлист нужно брать по PartNum**, а RefID — только для id.

---

## 4. Наблюдения формата, связанные с картой

Полное описание — `docs/re/EWB-file-format.md` §4. Здесь — минимум:

* **Маркер узла PN 39**: отдельный `Comp` с числовым `RefID` (= номер узла) и
  `m_tptrElem A "<Ref>^<pin>"` (к какому выводу прикреплён). Ровно один маркер на
  узел ≥1; узла 0 (земля) — не бывает. Верхний уровень провода маркеры **не**
  использует как концы; в мини-схемах `MacroFace` — использует.
* **Индексное пространство проводов**: `wire.pos i:4 <elemA> <pinA> <elemB> <pinB>` —
  `<elem>` это 0-based позиция в **полном** списке `Circuit.Elements`
  (`Comp` + `Instrument` + `ExtComp` + `MacroIcon` в порядке файла), не индекс
  «только среди Comp». Проверено: 2-выводные `Comp` дают ровно терминалы 0/1,
  земля — только 0, `Connector` — 0..3, БТ — 0..2, ОУ (PN 15) — 0..2.
* `Connector` (PN 9) — узел-точка на пересечении: 4 «стороны» (терминалы 0..3),
  электрически одна точка (сеть определяется `node_p`).
* `ExtComp` — внешняя деталь (`Name R "ANALOG:555"`, `Common.RefID`, `Data`), без
  PartNum: библиотека подключается как «IC template»; `MacroIcon` — экземпляр
  макроса (`Name R "7805"`, `Bounds`, список `Terminal`, `RefID`).
* `Instrument { PartNum i <2..7>; Pos i:3 0 x y }` — прибор на схеме; наблюдались
  номера 2..7 (46×PN4, 23×PN2, 8×PN5, 7×PN7, 4×PN6, 1×PN3). Соответствие
  «номер прибора → тип прибора» **[?]** (см. §5).

---

## 5. Открытые вопросы

| # | Вопрос | Как закрыть |
|---:|---|---|
| 1 | Порядок параметров `Params r:K …` в `Library.Models.Model`/`Circuit.Models.Model` относительно полей SPICE-моделей | RE `WEWB32`/`MODELS`-карточек + сверка с оракулом (фазы P2) |
| 2 | Соответствие `Instrument.PartNum` (2..7) приборам (мультиметр/осциллограф/…) | сопоставить с блоками `MultiMeter`/`Oscilloscope`/… в тех же файлах |
| 3 | Карта «пин устройства → терминал SPICE» (E, B, C для BJT; ±/out для ОУ; G/D/S/B для MOSFET) | RE `EwbMapTerminals`/`EwbAdd*` в `wewb32.dis` (фазы P1.4/P2) |
| 4 | Семантика `ModelUnits`, `Value r:k` для многопараметрических деталей (напр. трансформатор, реле) | RE `EwbSetup*` + сверка на схемах |
| 5 | Назначение номеров 52, 58, 62..76 (не встречаются в схемах) | по `cardNames` в артефакте и строкам `WEWB32` |
| 6 | `P`-карточки с `bin`-файлами (135 файлов) — формат кодирования параметров | RE `COMPDAT.DLL`/`GETRES32.DLL` (когда понадобится) |

---

## 6. Воспроизведение

```bash
# пересобрать артефакт (детерминированно, sha256 входов в JSON)
node tools/models-parse.mjs

# отчёт покрытия M4 (таблица номеров, при необходимости — по файлам)
node tools/models-parse.mjs --coverage
node tools/models-parse.mjs --coverage --files

# только из stdout без записи файла
node tools/models-parse.mjs --stdout | head

# юниты/золотые тесты фазы M
node --test test/models.test.mjs
```

Тесты фазы M (`test/models.test.mjs`) проверяют: разбор карточек (`parsePCard`,
`parseModelCard`, `parseSpiceText` с CRLF/`+`/0x1A/глитчами), `parseWewbRes`,
`parsePartNames`, `buildPartMap`, `circuitEvidence`, воспроизводимость и
детерминизм `ewb-models.json`, имена (`Resistor`=PN1, `Voltmeter`=PN13, `Node`=PN39),
классы (`PN4=diode`, `PN31=pmos-emb`) и покрытие M4 ≥ 95 %. При отсутствии
`EWB512/` — self-skip.
