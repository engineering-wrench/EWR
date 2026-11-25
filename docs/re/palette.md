# palette — палитра EWB 5.12 (категории, ленты, плитки)

> Подпункт: `docs/engine/plans/I4-palette.md`. Источник — оригинал (read-only).
> Статус: **шаги 1–5 закрыты**: все 155 плиток всех 13 вкладок привязаны
> (уровни ✓/~/?, см. §5), счётчики сходятся с лентами; манифесты с блоком `ewb`
> и порядок `idListComponent` сгенерированы из `tools/palette-tiles.data.mjs`.
> Открыты только пары «иконка ↔ имя» внутри семейств (§7).
> Артефакт: `Site/engine/palette.generated.json` (`node tools/palette-extract.mjs`).
> Смежное: `docs/re/engine-parts.md` (PartNum/классы), `docs/re/EWB-file-format.md`
> (§4.2.1 — у `Comp` нет индекса палитры).

## 1. Что фиксируется

Соответствие «кнопка палитры EWB ↔ сущность формата». Уровни привязки:

| Уровень | Чем задаётся | Где в `.ewb` |
|---|---|---|
| примитив схемы | `PartNum` 0..41 | `Comp` (поле `PartNum`, `ModelName`) |
| библиотечная деталь | стиль (ключ реестра `COMPDAT.DLL`) + модель | `Comp` (`ModelName` = класс модели) |
| цифровой чип | `ExtComp`-имя (`74xx`-серия и т.п.) | `Comp` (`ModelName`/`ExtComp`) |
| инструмент | `Instrument:`-класс | `Comp` |

Палитра нужна, чтобы **выбор пользователя в EWR однозначно** превращался в эти
сущности: без эвристик по RefID и без угадывания по типу из нетлиста.

## 2. Источники и воспроизведение

| Источник | Что даёт |
|---|---|
| `EWB512/WEWB32.EXE` | таблица PartsBin: 17 записей × 40 байт (ленты `31xx`/`30xx`/`33xx`/`32xx`, число плиток, индекс, флаги) |
| `EWB512/WEWBMSG.RES` | имена вкладок, блоком подряд: `Favorites`, `Sources`, … `Instruments`; имена `PartNum` 0..41 |
| `EWB512/COMPDAT.DLL` | реестр внутренних имён EWB (стили, цифровые примитивы, подкатегории, серии, PN-типы, инструменты, префиксы) |
| `EWB512/EXT/ANALOG.EWX`, `DIGITAL.EWX`, `CHIP.EWX` | **состав PartsBin**: группы `EwbSetPartsBin("<id>")` + `EwbDefineComp` в порядке добавления — внутреннее имя, `.par`-файл модели, тип отрисовки |
| `EWB512/EXT/ANALOG.DLL` | имена экспортов отрисовки (`CoupledInductorOpen`, `MagneticCoreOpen`, `CrystalOpen`, `DCMotorOpen`) — расшифровка `lcouple`/`mcore` |
| `EWB512/WEWB.RES` | `ewba.la`/`ewbd.ld` — C-записи библиотеки (`PartNum`, `M`, класс модели) |
| `EWB512/WEWBANSI.RES`, `WEWBDIN.RES` | 39 Comp-блоков примитивов (`PartNum` + `Position`) |
| `extracted_assets/BITMAP30xx_1.bmp` | ленты 24-px плиток (ANSI, эталон раскладки) |
| `расположение/*.png` | скриншоты попапов EWB 5.12 — порядок кнопок 1:1 |

```bash
node tools/palette-extract.mjs           # артефакт
node tools/palette-extract.mjs --md      # таблица категорий в stdout
node tools/palette-extract.mjs --stdout  # JSON в stdout
node --test test/palette.test.mjs
```

Состав палитры читается из EWX-групп (см. §5.0), а не угадывается по иконкам:

```bash
tr -d '\r' < EWB512/EXT/ANALOG.EWX | grep -aE 'EwbSetPartsBin|EwbDefineComp'
```

Офсеты в артефакте (`locations.*`) — справочные: сами таблицы находятся по
сигнатурам, а не по жёстким смещениям.

## 3. Категории (вкладки)

Имена — из `WEWBMSG.RES` в порядке файла; ленты `3001..3013` соответствуют
вкладкам `Sources..Instruments`. `Favorites` — динамическая вкладка без ленты.

| # | вкладка | ANSI `30xx` | иконка `31xx` | toolbar `33xx` | DIN `32xx` | плиток |
|---:|:--|---:|---:|---:|---:|---:|
| 1 | Sources | 3001 | 3101 | 3301 | 3201 | 23 |
| 2 | Basic | 3002 | 3102 | 3302 | 3202 | 20 |
| 3 | Diodes | 3003 | 3103 | 3303 | 3203 | 8 |
| 4 | Transistors | 3004 | 3104 | 3304 | 3204 | 14 |
| 5 | Analog ICs | 3005 | 3105 | 3305 | 3205 | 6 |
| 6 | Mixed ICs | 3006 | 3106 | 3306 | 3206 | 5 |
| 7 | Digital ICs | 3007 | 3107 | 3307 | 3207 | 6 |
| 8 | Logic Gates | 3008 | 3108 | 3308 | 3208 | 18 |
| 9 | Digital | 3009 | 3109 | 3309 | 3209 | 14 |
| 10 | Indicators | 3010 | 3110 | 3310 | 3210 | 9 |
| 11 | Controls | 3011 | 3111 | 3311 | 3211 | 12 |
| 12 | Miscellaneous | 3012 | 3112 | 3312 | 3212 | 13 |
| 13 | Instruments | 3013 | 3113 | 3313 | 3213 | 7 |
| 14 | — (иконки диалогов) | 3014 | 3114 | 3314 | 3214 | 20 |
| 15 | — (иконки диалогов) | 3015 | 3115 | 3315 | 3215 | 20 |
| 16 | — (иконки диалогов) | 3016 | 3116 | 3316 | 3216 | 50 |
| 17 | — (иконки диалогов) | 3017 | 3117 | 3317 | 3217 | 50 |

Для 13 вкладок число плиток ленты равно `count` (проверено тестом). Для
`3014..3017` лента короче (10/12/10/10) — это не категории палитры, см. §6.

## 4. Реестр внутренних имён (`COMPDAT.DLL`)

456 ключей подряд; границы секций — по якорям, не по индексам.

| Секция | Диапазон | Кол-во | Содержимое |
|:--|---:|---:|:--|
| styles | 0..59 | 60 | библиотечные стили: `fwb`, `shock`, `scr`, `diac`, `triac`, `nmesfet`, `pmesfet`, `opamp`, `7oamp`, `9oamp`, `comp`, `pll`, `555`, `clock`, `am`, `fm`, `sinewave`, `triwave`, `sqrwave`, `con1shot`, `ascts`, `pwl`, `fsk`, `poly`, `arbsrc`, `beeper`, `bar`, `dbar`, `pot`, `respk`, `analogsw`, `polcap`, `varc`, `varl`, `lcouple`, `mcore`, `nltrnfr`, `net8`, `lotra`, `trans`, `cryst`, `motr`, `vacum`, `boost`, `buck`, `bckbst`, `diff`, `int`, `gain`, `tran`, `mult`, `div`, `sum`, `lim`, `conlimit`, `curlimit`, `hyst`, `slew`, `textbox`, `titleblk` |
| digital | 60..129 | 70 | цифровые примитивы (вентили, триггеры, счётчики, `Volt`/`Vdd`, …) |
| subcategories | 130..159 | 30 | пары «иконка + подпись» диалогов: `TemplateAnd`/`AND Gates`, … `TemplateFli`/`Flip-Flops` |
| template-impl | 160..167 | 8 | реализации шаблонов |
| series-74 | 168..315 | 148 | `74xx`-серии |
| series-4 | 316..374 | 59 | `4xxx`-серии |
| series-templates | 375..386 | 12 | шаблоны серий (`74xx`, `741xx`, …) |
| subcircuit | 387 | 1 | `Subcircuit` |
| primitives | 388..429 | 42 | внутренние типы `PN0..PN41`: `AC_VOLTAGE_SOURCE` … `NODE` |
| instruments | 430..437 | 8 | `Oscilloscope`, `Ammeter`, `LogicAnalyzer`, `TruthTable`, `BodePlotter`, `FunctionGenerator`, `WordGenerator`, `MultiMeter` |
| prefixes | 438..455 | 18 | `ANALOG:`, `DIGITAL:`, `CHIP:`, `SPECIAL:`, `INTERNAL:`, `INSTRUMENT:` (по 3 записи) |

## 5. Привязка плиток

Источник истины — `tools/palette-tiles.data.mjs` (машинно проверяемая таблица), из
которой генерируются манифесты `Site/components/<id>/manifest.json` и списки
`idListComponent` в `Site/logic/js/interface.js`. Таблицы ниже напечатаны из неё:
`node tools/palette-manifests.mjs --md`.

Обозначения уверенности: **✓** — имя и место подтверждены (подпись на иконке,
порядок реестра, `PartNum`); **~** — иконка опознана, имя выбрано внутри семейства
(см. §7); **?** — привязки нет.

### 5.0 Состав вкладок: примитивы по `symbolLayouts` + книжные по EWX

Порядок примитивов внутри вкладок задан C-записями `WEWBANSI.RES`
(`symbolLayouts.ansi` в `Site/engine/palette.generated.json`) — 39 записей ровно:

```
8 2 10 0 7 32 34 35 33 | 9 1 3 6 14 20 38 21 36 37 | 4 16 17 |
5 11 22 23 24 25 26 27 28 29 30 31 | 15 | 13 12 18 19
```

9 (Sources) + 10 (Basic) + 3 (Diodes) + 12 (Transistors) + 1 (Analog ICs) +
4 (Indicators) = 39. Отсюда — точные счётчики всех вкладок:

| вкладка | плиток | примитивов | книжных | книжные из EWX |
|:--|---:|---:|---:|:--|
| Sources | 23 | 9 | 14 | ANALOG 652 (12) + DIGITAL 652 (`Volt`, `Vdd`) |
| Basic | 20 | 10 | 10 | 653 (9) + DIGITAL 653 (`Pull`) |
| Diodes | 8 | 3 | 5 | 654 (`fwb`, `shock`, `scr`, `diac`, `triac`); `zener` — это PN 16 |
| Transistors | 14 | 12 | 2 | 655 (`nmesfet`, `pmesfet`) |
| Analog ICs | 6 | 1 | 5 | 656 (`opamp`, `7oamp`, `9oamp`, `comp`, `pll`) |
| Mixed ICs | 5 | 0 | 5 | DIGITAL 657 (`AD`, `DA`, `VDA`, `Mono`) + ANALOG 657 (`555`) |
| Digital ICs | 6 | 0 | 6 | CHIP 658 (`Template740`…`Template4`) |
| Logic Gates | 18 | 0 | 18 | DIGITAL 659 (10) + CHIP 659 (8 шаблонов) |
| Digital | 14 | 0 | 14 | DIGITAL 660 (7) + CHIP 660 (7 шаблонов) |
| Indicators | 9 | 4 | 5 | 661 (`beeper`, `bar`, `dbar`) + DIGITAL 661 (`Seg7`, `Seg7D`) |
| Controls | 12 | 0 | 12 | 662 |
| Miscellaneous | 13 | 0 | 13 | 663 (11) + DIGITAL 663 (`Table`) + `nltrnfr` (из 653) |
| Instruments | 7 | 0 | 7 | встроенные инструменты, без PartNum/ExtComp |

Итог: счётчики сходятся для всех 13 вкладок, необъяснённых плиток не осталось.
Порядок кнопок в попапе EWB (`расположение/*.png`) совпадает с порядком ленты 1:1
для всех вкладок, где попап снят (Sources, Basic, Diodes, Transistors, Analog ICs,
Mixed ICs, Digital ICs, Logic Gates, Digital, Indicators, Controls, Miscellaneous,
Instruments).

### Источники — 3001 (23)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3001-01` | Земля | Ground | 8 | — | — | `ground` | ✓ |
| 2 | `ewb-3001-02` | Батарея | Battery | 2 | — | — | `vsource` | ✓ |
| 3 | `ewb-3001-03` | Источник постоянного тока | DC Current Source | 10 | — | — | `isource` | ✓ |
| 4 | `ewb-3001-04` | Источник переменного напряжения | AC Voltage Source | 0 | — | — | `vsource` | ✓ |
| 5 | `ewb-3001-05` | Источник переменного тока | AC Current Source | 7 | — | — | `isource` | ✓ |
| 6 | `ewb-3001-06` | ИНУН: источник напряжения, управляемый напряжением | Voltage-Controlled Voltage Source | 32 | — | — | `unknown` | ~ |
| 7 | `ewb-3001-07` | ИНУТ: источник тока, управляемый напряжением | Voltage-Controlled Current Source | 34 | — | — | `unknown` | ~ |
| 8 | `ewb-3001-08` | ИТУН: источник напряжения, управляемый током | Current-Controlled Voltage Source | 35 | — | — | `unknown` | ~ |
| 9 | `ewb-3001-09` | ИТУТ: источник тока, управляемый током | Current-Controlled Current Source | 33 | — | — | `unknown` | ~ |
| 10 | `ewb-3001-10` | Напряжение питания Vcc | Vcc | — | Volt | volt.par | `unknown` | ✓ |
| 11 | `ewb-3001-11` | Напряжение питания Vdd | Vdd | — | Vdd | vdd.par | `unknown` | ✓ |
| 12 | `ewb-3001-12` | Тактовый генератор | Clock | — | clock | clock.par | `unknown` | ✓ |
| 13 | `ewb-3001-13` | Источник с амплитудной модуляцией | AM Source | — | am | am.par | `unknown` | ✓ |
| 14 | `ewb-3001-14` | Источник с частотной модуляцией | FM Source | — | fm | fm.par | `unknown` | ✓ |
| 15 | `ewb-3001-15` | Синусоидальный источник | Sine Wave Source | — | sinewave | vcsw.par | `unknown` | ✓ |
| 16 | `ewb-3001-16` | Источник треугольного сигнала | Triangle Wave Source | — | triwave | vctw.par | `unknown` | ✓ |
| 17 | `ewb-3001-17` | Источник прямоугольного сигнала | Square Wave Source | — | sqrwave | vcsqw.par | `unknown` | ✓ |
| 18 | `ewb-3001-18` | Одновибратор | One Shot | — | con1shot | vcosh.par | `unknown` | ✓ |
| 19 | `ewb-3001-19` | Источник с качанием частоты | AC Sweep Source | — | ascts | ascts.par | `unknown` | ~ |
| 20 | `ewb-3001-20` | Кусочно-линейный источник | Piecewise Linear Source | — | pwl | pwl.par | `unknown` | ✓ |
| 21 | `ewb-3001-21` | Источник с частотной манипуляцией | FSK Source | — | fsk | fsk.par | `unknown` | ✓ |
| 22 | `ewb-3001-22` | Полиномиальный источник | Polynomial Source | — | poly | poly.par | `unknown` | ~ |
| 23 | `ewb-3001-23` | Произвольный источник | Arbitrary Source | — | arbsrc | arbs.par | `unknown` | ~ |

### Базовые — 3002 (20)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3002-01` | Соединитель | Connector | 9 | — | — | `connector` | ✓ |
| 2 | `ewb-3002-02` | Резистор | Resistor | 1 | — | — | `resistor` | ✓ |
| 3 | `ewb-3002-03` | Конденсатор | Capacitor | 3 | — | — | `capacitor` | ✓ |
| 4 | `ewb-3002-04` | Катушка индуктивности | Inductor | 6 | — | — | `inductor` | ✓ |
| 5 | `ewb-3002-05` | Трансформатор | Transformer | 14 | — | — | `transformer` | ✓ |
| 6 | `ewb-3002-06` | Реле | Relay | 20 | — | — | `unknown` | ~ |
| 7 | `ewb-3002-07` | Ключ | Switch | 38 | — | — | `unknown` | ✓ |
| 8 | `ewb-3002-08` | Ключ с задержкой | Time-Delay Switch | 21 | — | — | `unknown` | ✓ |
| 9 | `ewb-3002-09` | Ключ, управляемый напряжением | Voltage-Controlled Switch | 36 | — | — | `unknown` | ✓ |
| 10 | `ewb-3002-10` | Ключ, управляемый током | Current-Controlled Switch | 37 | — | — | `unknown` | ✓ |
| 11 | `ewb-3002-11` | Подтягивающий резистор | Pull-Up Resistor | — | Pull | pull.par | `unknown` | ~ |
| 12 | `ewb-3002-12` | Потенциометр | Potentiometer | — | pot | pot.par | `unknown` | ✓ |
| 13 | `ewb-3002-13` | Сборка резисторов | Resistor Pack | — | respk | respk.par | `unknown` | ✓ |
| 14 | `ewb-3002-14` | Связанные индуктивности | Coupled Inductor | — | lcouple | lcoup.par | `unknown` | ~ |
| 15 | `ewb-3002-15` | Полярный конденсатор | Polarized Capacitor | — | polcap | elcap.par | `unknown` | ✓ |
| 16 | `ewb-3002-16` | Переменный конденсатор | Variable Capacitor | — | varc | varc.par | `unknown` | ✓ |
| 17 | `ewb-3002-17` | Переменная индуктивность | Variable Inductor | — | varl | varl.par | `unknown` | ✓ |
| 18 | `ewb-3002-18` | Магнитный сердечник | Magnetic Core | — | mcore | mcore.par | `unknown` | ~ |
| 19 | `ewb-3002-19` | Аналоговый ключ | Analog Switch | — | analogsw | asw.par | `unknown` | ~ |
| 20 | `ewb-3002-20` | Нелинейный трансформатор | Nonlinear Transformer | — | nltrnfr | ntsf.par | `unknown` | ~ |

### Диоды — 3003 (8)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3003-01` | Диод | Diode | 4 | — | — | `diode` | ✓ |
| 2 | `ewb-3003-02` | Стабилитрон | Zener Diode | 16 | — | — | `diode` | ✓ |
| 3 | `ewb-3003-03` | Светодиод | LED | 17 | — | — | `diode` | ✓ |
| 4 | `ewb-3003-04` | Мостовой выпрямитель | Full Wave Bridge | — | fwb | fwb.par | `unknown` | ✓ |
| 5 | `ewb-3003-05` | Диод Шокли | Shockley Diode | — | shock | shock.par | `unknown` | ~ |
| 6 | `ewb-3003-06` | Тиристор | SCR | — | scr | scr.par | `unknown` | ✓ |
| 7 | `ewb-3003-07` | Динистор | Diac | — | diac | diac.par | `unknown` | ✓ |
| 8 | `ewb-3003-08` | Симистор | Triac | — | triac | triac.par | `unknown` | ✓ |

### Транзисторы — 3004 (14)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3004-01` | Биполярный транзистор n-p-n | NPN Transistor | 5 | — | — | `unknown` | ✓ |
| 2 | `ewb-3004-02` | Биполярный транзистор p-n-p | PNP Transistor | 11 | — | — | `unknown` | ✓ |
| 3 | `ewb-3004-03` | Полевой транзистор с n-каналом | N-Channel JFET | 22 | — | — | `unknown` | ✓ |
| 4 | `ewb-3004-04` | Полевой транзистор с p-каналом | P-Channel JFET | 23 | — | — | `unknown` | ✓ |
| 5 | `ewb-3004-05` | N-МОП, обеднение, 3 вывода | Depletion N-MOSFET | 24 | — | — | `unknown` | ✓ |
| 6 | `ewb-3004-06` | P-МОП, обеднение, 3 вывода | Depletion P-MOSFET | 25 | — | — | `unknown` | ✓ |
| 7 | `ewb-3004-07` | N-МОП, обеднение, 4 вывода | Depletion N-MOSFET (4 terminal) | 26 | — | — | `unknown` | ✓ |
| 8 | `ewb-3004-08` | P-МОП, обеднение, 4 вывода | Depletion P-MOSFET (4 terminal) | 27 | — | — | `unknown` | ✓ |
| 9 | `ewb-3004-09` | N-МОП, обогащение, 3 вывода | Enhancement N-MOSFET | 28 | — | — | `unknown` | ✓ |
| 10 | `ewb-3004-10` | P-МОП, обогащение, 3 вывода | Enhancement P-MOSFET | 29 | — | — | `unknown` | ✓ |
| 11 | `ewb-3004-11` | N-МОП, обогащение, 4 вывода | Enhancement N-MOSFET (4 terminal) | 30 | — | — | `unknown` | ✓ |
| 12 | `ewb-3004-12` | P-МОП, обогащение, 4 вывода | Enhancement P-MOSFET (4 terminal) | 31 | — | — | `unknown` | ✓ |
| 13 | `ewb-3004-13` | Полевой транзистор Шоттки n-канал | N-Channel MESFET | — | nmesfet | nmes.par | `unknown` | ✓ |
| 14 | `ewb-3004-14` | Полевой транзистор Шоттки p-канал | P-Channel MESFET | — | pmesfet | pmes.par | `unknown` | ✓ |

### Аналоговые ИС — 3005 (6)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3005-01` | Операционный усилитель, 3 вывода | 3-Terminal Opamp | 15 | — | — | `unknown` | ✓ |
| 2 | `ewb-3005-02` | Операционный усилитель | Opamp | — | opamp | opamp.par | `unknown` | ✓ |
| 3 | `ewb-3005-03` | Операционный усилитель, 7 выводов | 7-Terminal Opamp | — | 7oamp | 7oamp.par | `unknown` | ✓ |
| 4 | `ewb-3005-04` | Операционный усилитель, 9 выводов | 9-Terminal Opamp | — | 9oamp | 9oamp.par | `unknown` | ✓ |
| 5 | `ewb-3005-05` | Компаратор | Comparator | — | comp | comp.par | `unknown` | ✓ |
| 6 | `ewb-3005-06` | ФАПЧ | Phase-Locked Loop | — | pll | pll.par | `unknown` | ~ |

### Смешанные ИС — 3006 (5)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3006-01` | АЦП | A/D Converter | — | AD | ad.par | `unknown` | ~ |
| 2 | `ewb-3006-02` | ЦАП по току | D/A Converter (current) | — | DA | da.par | `unknown` | ✓ |
| 3 | `ewb-3006-03` | ЦАП по напряжению | D/A Converter (voltage) | — | VDA | vda.par | `unknown` | ✓ |
| 4 | `ewb-3006-04` | Одновибратор (моностабильный) | Mono | — | Mono | mono.par | `unknown` | ✓ |
| 5 | `ewb-3006-05` | Таймер 555 | 555 Timer | — | 555 | 555.par | `unknown` | ✓ |

### Цифровые ИС — 3007 (6)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3007-01` | ИС серии 74xx | 74xx Series | — | Template740 | tpl70.par | `unknown` | ✓ |
| 2 | `ewb-3007-02` | ИС серии 741xx | 741xx Series | — | Template741 | tpl71.par | `unknown` | ✓ |
| 3 | `ewb-3007-03` | ИС серии 742xx | 742xx Series | — | Template742 | tpl72.par | `unknown` | ✓ |
| 4 | `ewb-3007-04` | ИС серии 743xx | 743xx Series | — | Template743 | tpl73.par | `unknown` | ✓ |
| 5 | `ewb-3007-05` | ИС серии 744xx | 744xx Series | — | Template744 | tpl74.par | `unknown` | ✓ |
| 6 | `ewb-3007-06` | ИС серии 4xxx | 4xxx Series | — | Template4 | tpl4x.par | `unknown` | ✓ |

### Логические элементы — 3008 (18)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3008-01` | И | AND | — | And2 | and2.par | `unknown` | ✓ |
| 2 | `ewb-3008-02` | ИЛИ | OR | — | Or2 | or2.par | `unknown` | ✓ |
| 3 | `ewb-3008-03` | НЕ | NOT | — | Not | not.par | `unknown` | ✓ |
| 4 | `ewb-3008-04` | ИЛИ-НЕ | NOR | — | Nor2 | nor2.par | `unknown` | ✓ |
| 5 | `ewb-3008-05` | И-НЕ | NAND | — | Nand2 | nand2.par | `unknown` | ✓ |
| 6 | `ewb-3008-06` | Исключающее ИЛИ | XOR | — | Xor2 | xor2.par | `unknown` | ✓ |
| 7 | `ewb-3008-07` | Исключающее ИЛИ-НЕ | XNOR | — | Xnor2 | xnor2.par | `unknown` | ✓ |
| 8 | `ewb-3008-08` | Трёхстабильный буфер | Tri-state Buffer | — | Tri | tri.par | `unknown` | ✓ |
| 9 | `ewb-3008-09` | Буфер | Buffer | — | Buf | buf.par | `unknown` | ✓ |
| 10 | `ewb-3008-10` | Триггер Шмитта | Schmitt Trigger | — | Schmitt | schmt.par | `unknown` | ✓ |
| 11 | `ewb-3008-11` | Шаблон: И | AND Template | — | TemplateAnd | tpl7.par | `unknown` | ✓ |
| 12 | `ewb-3008-12` | Шаблон: ИЛИ | OR Template | — | TemplateOr | tpl9.par | `unknown` | ✓ |
| 13 | `ewb-3008-13` | Шаблон: И-НЕ | NAND Template | — | TemplateNand | tpl8.par | `unknown` | ✓ |
| 14 | `ewb-3008-14` | Шаблон: ИЛИ-НЕ | NOR Template | — | TemplateNor | tpl10.par | `unknown` | ✓ |
| 15 | `ewb-3008-15` | Шаблон: НЕ | NOT Template | — | TemplateNot | tpl13.par | `unknown` | ✓ |
| 16 | `ewb-3008-16` | Шаблон: Исключающее ИЛИ | XOR Template | — | TemplateXor | tpl11.par | `unknown` | ✓ |
| 17 | `ewb-3008-17` | Шаблон: Исключающее ИЛИ-НЕ | XNOR Template | — | TemplateXnor | tpl12.par | `unknown` | ✓ |
| 18 | `ewb-3008-18` | Шаблон: буфер | Buffer Template | — | TemplateBuf | tpl14.par | `unknown` | ✓ |

### Цифровые — 3009 (14)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3009-01` | Полусумматор | Half Adder | — | HA | ha.par | `unknown` | ✓ |
| 2 | `ewb-3009-02` | Полный сумматор | Full Adder | — | FA | fa.par | `unknown` | ✓ |
| 3 | `ewb-3009-03` | RS-триггер | RS Flip-Flop | — | RS | rs_ff.par | `unknown` | ✓ |
| 4 | `ewb-3009-04` | JK-триггер с тремя входами | JK Flip-Flop (3 inputs) | — | JK3 | jk_ff.par | `unknown` | ✓ |
| 5 | `ewb-3009-05` | JK-триггер | JK Flip-Flop | — | JK | jkn.par | `unknown` | ✓ |
| 6 | `ewb-3009-06` | D-триггер | D Flip-Flop | — | D | d_ff.par | `unknown` | ✓ |
| 7 | `ewb-3009-07` | D-триггер с инверсным выходом | D Flip-Flop (inverted) | — | DN | dn.par | `unknown` | ✓ |
| 8 | `ewb-3009-08` | Мультиплексор | Multiplexer | — | TemplateMux | tpl4.par | `unknown` | ✓ |
| 9 | `ewb-3009-09` | Дешифратор / демультиплексор | Decoder / Demux | — | TemplateDecDemux | tpl5.par | `unknown` | ✓ |
| 10 | `ewb-3009-10` | Шифратор | Encoder | — | TemplateEnc | tpl15.par | `unknown` | ✓ |
| 11 | `ewb-3009-11` | Арифметические устройства | Arithmetic | — | TemplateAri | tpl1.par | `unknown` | ✓ |
| 12 | `ewb-3009-12` | Счётчик | Counter | — | TemplateCou | tpl2.par | `unknown` | ✓ |
| 13 | `ewb-3009-13` | Сдвиговый регистр | Shift Register | — | TemplateShf | tpl3.par | `unknown` | ✓ |
| 14 | `ewb-3009-14` | Триггеры (шаблон) | Flip-Flops | — | TemplateFli | tpl6.par | `unknown` | ✓ |

### Индикаторы — 3010 (9)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3010-01` | Вольтметр | Voltmeter | 13 | — | — | `meter` | ✓ |
| 2 | `ewb-3010-02` | Амперметр | Ammeter | 12 | — | — | `meter` | ✓ |
| 3 | `ewb-3010-03` | Лампа накаливания | Bulb | 18 | — | — | `unknown` | ✓ |
| 4 | `ewb-3010-04` | Звукоизлучатель | Beeper | — | beeper | beep.par | `unknown` | ✓ |
| 5 | `ewb-3010-05` | Семисегментный индикатор | 7-Segment Display | — | Seg7 | 7seg.par | `unknown` | ✓ |
| 6 | `ewb-3010-06` | Семисегментный индикатор с точкой | 7-Segment Display (decimal) | — | Seg7D | 7segd.par | `unknown` | ✓ |
| 7 | `ewb-3010-07` | Предохранитель | Fuse | 19 | — | — | `unknown` | ✓ |
| 8 | `ewb-3010-08` | Линейный индикатор (столбик) | Bar Display | — | bar | bar.par | `unknown` | ✓ |
| 9 | `ewb-3010-09` | Линейный индикатор (точка) | Dot Bar Display | — | dbar | dbar.par | `unknown` | ✓ |

### Управление — 3011 (12)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3011-01` | Дифференциатор | Differentiator | — | diff | diff.par | `unknown` | ✓ |
| 2 | `ewb-3011-02` | Интегратор | Integrator | — | int | int.par | `unknown` | ✓ |
| 3 | `ewb-3011-03` | Масштабирующее звено | Gain Block | — | gain | gain.par | `unknown` | ✓ |
| 4 | `ewb-3011-04` | Преобразователь проводимости | Transconductance Block | — | tran | tran.par | `unknown` | ✓ |
| 5 | `ewb-3011-05` | Умножитель | Multiplier | — | mult | mult.par | `unknown` | ✓ |
| 6 | `ewb-3011-06` | Делитель | Divider | — | div | div.par | `unknown` | ✓ |
| 7 | `ewb-3011-07` | Сумматор | Summer | — | sum | sum.par | `unknown` | ✓ |
| 8 | `ewb-3011-08` | Ограничитель | Limiter | — | lim | lim.par | `unknown` | ✓ |
| 9 | `ewb-3011-09` | Ограничитель напряжения | Voltage Limiter | — | conlimit | vclim.par | `unknown` | ✓ |
| 10 | `ewb-3011-10` | Ограничитель тока | Current Limiter | — | curlimit | cclim.par | `unknown` | ✓ |
| 11 | `ewb-3011-11` | Звено с гистерезисом | Hysteresis Block | — | hyst | hyter.par | `unknown` | ✓ |
| 12 | `ewb-3011-12` | Ограничитель скорости нарастания | Slew Rate Block | — | slew | slewr.par | `unknown` | ✓ |

### Прочее — 3012 (13)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3012-01` | Линия передачи с потерями | Lossy Transmission Line | — | lotra | lotra.par | `unknown` | ✓ |
| 2 | `ewb-3012-02` | Таблица состояний | Table | — | Table | table.par | `unknown` | ~ |
| 3 | `ewb-3012-03` | Восьмиразрядная шина | Net8 | — | net8 | nt16.par | `unknown` | ✓ |
| 4 | `ewb-3012-04` | Нелинейный трансформатор (библиотечный) | Nonlinear Transformer | — | nltrnfr | ntsf.par | `unknown` | ~ |
| 5 | `ewb-3012-05` | Трансформатор (библиотечный) | Transformer | — | trans | trans.par | `unknown` | ~ |
| 6 | `ewb-3012-06` | Кварцевый резонатор | Crystal | — | cryst | cryst.par | `unknown` | ✓ |
| 7 | `ewb-3012-07` | Электронная лампа | Vacuum Tube | — | vacum | vactb.par | `unknown` | ✓ |
| 8 | `ewb-3012-08` | Двигатель постоянного тока | DC Motor | — | motr | dcmot.par | `unknown` | ✓ |
| 9 | `ewb-3012-09` | Повышающий преобразователь | Boost Converter | — | boost | boost.par | `unknown` | ✓ |
| 10 | `ewb-3012-10` | Понижающий преобразователь | Buck Converter | — | buck | buck.par | `unknown` | ✓ |
| 11 | `ewb-3012-11` | Инвертирующий преобразователь | Buck-Boost Converter | — | bckbst | bckbt.par | `unknown` | ✓ |
| 12 | `ewb-3012-12` | Текст | Text Box | — | textbox | textb.par | `unknown` | ✓ |
| 13 | `ewb-3012-13` | Основная надпись | Title Block | — | titleblk | title.par | `unknown` | ✓ |

### Приборы — 3013 (7)

| # | плитка (`source`) | имя | EWB | PartNum | ExtComp | модель | движок | ув. |
|---:|:--|:--|:--|---:|:--|:--|:--|:--:|
| 1 | `ewb-3013-01` | Мультиметр | Multimeter | — | — | — | `unknown` | ✓ |
| 2 | `ewb-3013-02` | Осциллограф | Oscilloscope | — | — | — | `unknown` | ✓ |
| 3 | `ewb-3013-03` | Генератор сигналов | Signal Generator | — | — | — | `unknown` | ✓ |
| 4 | `ewb-3013-04` | Характериограф | IV Analyzer | — | — | — | `unknown` | ✓ |
| 5 | `ewb-3013-05` | Логический анализатор | Logic Analyzer | — | — | — | `unknown` | ✓ |
| 6 | `ewb-3013-06` | Измеритель АЧХ | Bode Plotter | — | — | — | `unknown` | ✓ |
| 7 | `ewb-3013-07` | Логический пробник | Logic Probe | — | — | — | `unknown` | ✓ |

### 5.14 Где это лежит в коде

| артефакт | что содержит | кто пишет |
|:--|:--|:--|
| `tools/palette-tiles.data.mjs` | таблица 155 плиток: `strip`, `index`, `id`, имена RU/EN, `partNum`/`ext`/`model`, `device`, `pins`, уверенность | вручную (единственный источник истины) |
| `Site/components/<id>/manifest.json` | `source` = `ewb-<лента>-<индекс>`, блок `ewb {partNum, ext, model, device, confidence}`, `size`/`ports`/`parameters` | человек + `tools/palette-manifests.mjs` (дополняет только `ewb`/`source`) |
| `Site/components/<id>/symbol.svg` | у 151 новой плитки — плейсхолдер (пунктирная рамка + номер плитки), у существующих — настоящий символ | `tools/palette-manifests.mjs` (только если файла нет) |
| `Site/logic/js/interface.js` → `idListComponent` | порядок id по вкладкам = порядок плиток ленты | `node tools/palette-manifests.mjs --ids` |
| `Site/img/title/<вкладка>.bmp` | лента плиток попапа (копия `BITMAP30xx_1.bmp`) | копируется байт в байт |

Проверки (`test/palette.test.mjs`): индексы без дыр и уникальность id; `source` =
`tileId(tile)`; блок `ewb` в каждом манифесте совпадает с таблицей; `viewBox`
символа = `size` манифеста; `idListComponent` совпадает с таблицей по составу и
порядку; `device` примитивов не противоречит `parser.deviceType`;
`node tools/palette-manifests.mjs --check` не находит расхождений.

Привязка «плитка → движок» идёт по `PartNum` (примитивы) и `ExtComp`-имени
(книжные детали). Рантайм читает её из сгенерированного
`Site/engine/ewb-devices.js` (`node tools/palette-manifests.mjs --runtime`):

| потребитель | что берёт |
|:--|:--|
| `Site/engine/parser.js` → `deviceType(ref, partnum)` | `EWB_BY_PART[partNum]` — тип детали из `.ewb`; префикс RefID — только fallback для файлов без `PartNum` |
| `Site/logic/js/sim.js` → `mapComponentType(id)` | `EWB_BY_ID[id].device` → тип моста (`meter` → `instrument`); имена вне палитры — из старых списков |
| `Site/engine/ewb-facade.js` → `mapEditorType(id)` | то же, но тип отдаётся как есть — неизвестное движку уходит в `skipped` с причиной, а не теряется молча |
| `Site/logic/js/file-io.js` | `EDITOR_ID_BY_DEVICE[type]` — каким символом открывать элемент из `.ewb` (земля → `ground`, источник → `battery`, прибор → `multimeter`) |

`device` — это то, что уже понимает движок (`resistor`, `capacitor`, `inductor`,
`vsource`, `isource`, `diode`, `meter`, `transformer`, `connector`, `ground`);
у остальных `device: "unknown"` — элемент размещается на схеме, но в нетлист пока
не попадает (расширение моделей в `spice/` — отдельный подпункт плана).
Списки-эвристики из кода удалены: правка типа — это правка
`tools/palette-tiles.data.mjs` + `--runtime`.


## 6. Квирки

- **Q-P01. Одна кнопка — два глифа.** Плитки 6–9 ленты `3001` содержат по два
  символа (box и diamond) в одном 24-px такте. Подтверждено скриншотом попапа
  Sources: кнопка действительно показывает обе формы управляемого источника.
- **Q-P02. `3014–3017` — не вкладки.** У них есть записи PartsBin (индексы
  14–17) и ленты, но `count` (20/20/50/50) — это слоты диалогов библиотек, а не
  число плиток; на ленте 10/12/10/10 иконок подкатегорий (вентили/аналоговые).
  Поэтому `tilesMatch=false` — ожидаемо, а не дефект.
- **Q-P03. `3012` шире сетки.** Ширина ленты 313 px при 13 плитках ⇒ шаг
  24.07 px. Резать по `count` и делить ширину равномерно, а не `round(w/24)`.
- **Q-P04. Дубли лент.** `3016==3017`, `3216==3217`; `3014==3214`, `3015==3215`
  по md5; `33xx` — 16-px toolbar-варианты. Использовать `30xx` (ANSI) как
  эталон, `32xx` — DIN, `33xx` — только панель инструментов.
- **Q-P05. Порядок C-записей ≠ порядок плиток.** `ewba.la`/`WEWBANSI.RES` нельзя
  использовать как источник порядка кнопок.
- **Q-P06. Нет индекса палитры в файле.** У `Comp` в `.ewb` только `PartNum`/
  `ModelName`; привязка к кнопке восстанавливается по палитре, а не по файлу.
- **Q-P07. Состав вкладки задаётся расширениями, а не EXE.** Только примитивы
  жёстко зашиты в ресурсы (`WEWBANSI.RES`) и таблицу PartsBin; книжные детали
  приходят из `EXT/*.EWX` (`EwbSetPartsBin` + `EwbDefineComp`). Один и тот же
  номер группы (`653`, `657`…) определяют разные расширения — вкладка
  складывается из нескольких групп.
- **Q-P08. Иконки одного имени в разных вкладках не совпадают побайтово.**
  Кристалл/мотор в Basic и Miscellaneous имеют разные md5 плиток — значит это
  разные записи библиотеки (или разные символы), а не копия одного значка.
- **Q-P09. Порядок примитивов — в `WEWBANSI.RES`, а не в PartsBin.** C-записи
  `symbolLayouts.ansi` (39 штук) идут ровно в порядке плиток по вкладкам:
  `8 2 10 0 7 32 34 35 33 | 9 1 3 6 14 20 38 21 36 37 | 4 16 17 | 5 11 22…31 |
  15 | 13 12 18 19`. Это единственный статический источник порядка (Q-P05 про
  одиночные C-записи `ewba.la` остаётся в силе — там порядок другой).
- **Q-P10. Один ExtComp — две плитки.** `nltrnfr` (нелинейный трансформатор)
  виден и в Basic (20), и в Miscellaneous (4), с разной графикой; в таблице они
  разведены как `nonlinear-transformer` и `nonlinear-transformer-2`.
- **Q-P11. `Pull` опознан по подписи на иконке.** Плитка Basic 11 — резистор
  с метками `+`/`−V`; это единственное имя группы 653, не имеющее другого слота.

## 7. Открытые вопросы

Всё ниже — только «~»-плитки: место в ленте и группа известны, имя выбрано по
символу. Закрыть можно только GUI-оракулом (Wine в текущем окружении окна не
отдаёт: `X Error ... BadWindow`) или скриншотом диалога библиотеки.

1. Basic: 6 `relay` (PN 20), 11 `Pull`, 14 `lcouple`, 18 `mcore`, 19 `analogsw`,
   20 `nltrnfr` — спорные внутри 653; `relay`/`Pull` — сильнейшие кандидаты
   (иконка катушка с сердечником; резистор с `+`/`−V`).
2. Misc 2 `Table`, 4 `nltrnfr`, 5 `trans` — какой из двух «капсульных»
   трансформаторов линейный, а какой нет (Q-P10).
3. Sources 6–9: порядок `VCVS`/`VCCS`/`CCVS`/`CCCS` (сейчас по `symbolLayouts`:
   32, 34, 35, 33).
4. Sources 19/22/23 (`ascts`, `poly`, `arbsrc`) — имена по порядку 652.
5. Цифровые вкладки (Logic Gates 11–18, Digital 8–14, Controls, Indicators 4–9):
   состав точный, имена шаблонов — по `EwbDefineComp` CHIP.EWX/DIGITAL.EWX.
6. Расхождение «7 кнопок Instruments против 8 записей в реестре».
7. Пин-ауты (число и координаты выводов) для плейсхолдеров — из символов EWB
   при переносе SVG (план I2); сейчас `pins` приблизительный (3/5/7/9 у ОУ — по
   иконке, 8 выводов у 555/7-seg — оценка).
