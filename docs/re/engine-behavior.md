# EWB 5.12 — поведение движка (RE-паспорт, R4–R6)

> Источник: RE `EWB512/XSPICE32.DLL` + `EWB512/WEWB32.EXE` (дизассемблер
> `/tmp/opencode/oracle/{xspice32,wewb32}.dis`), сверка со исходниками предка
> (`vendor/spice3f4/`, `vendor/xspice-1-0/`) и живые прогоны оракула
> (`tools/oracle/`, `tools/oracle/golden/`). Связанные документы:
> `docs/re/engine-lineage.md` (паспорт предка R1–R3), `docs/engine/PLAN-CLONE.md`.
>
> Статус: R4/R5/R6 — первая версия (сессия 2026-10). Всё, что не подтверждено
> кодом или прогоном, помечено **[?]**.

Проверки воспроизводимы:

| Что | Как |
|---|---|
| Каталог устройств/анализов/опций | `node tools/oracle/run.mjs --enumerate` (golden: `tools/oracle/golden/enum.json`) |
| Дефолты task-опций | дизассемблер `CKTnewTask` (VA `0x4950cc`) + `vendor/xspice-1-0/src/sim/CKT/CKTnewTask.c` |
| Константы и таблица фронтенда | `cd vendor/py32 && WINEDEBUG=-all wine python.exe -u 'Z:\...\tools\oracle\probe_globals.py'` |
| Прогоны анализов | `node tools/oracle/run.mjs --deck tools/oracle/corpus/op_divider.json` |

---

## R4. Ядро (`XSPICE32.DLL`): состав, интерфейс, дефолты

### 4.1 Паспорт

| Параметр | Значение | Подтверждение |
|---|---|---|
| Имя симулятора | `XSPICE` | `IFsimulator.simulator` (golden `enum.json`) |
| Версия | `1.0` (строка виджет-таблицы), живой `version="3f4"` | `probe`/`--enumerate`; см. `engine-lineage.md` R3 |
| Анализов | **10**: `options`(OPT), AC, DC(DCT), OP(DCO), TRAN, PZ, TF, **DISTO**, **NOISE**, SENS | `enum.json` |
| Устройств | **84** (F4-набор + код-модели XSPICE) | `enum.json` |
| Узловые параметры | `nodeset`, `ic`, `type` | `enum.json` → `nodeParms` |
| Спец-сигналы | `time` | `enum.json` → `specSigs` |
| Экспорты ядра | 63 имени (`CKT*`, `CKTask*`, `IFeval`, `XSPIinit`, `OUT*`, `split_OUT*`, `get/set*`, `spice_malloc`) | `docs/re/lineage/xspice32.exports.txt` |
| Импорты | только `KERNEL32` (61) + `USER32` (3: `MessageBeep`, `EnumThreadWindows`, `MessageBoxA`) | `xspice32.imports.txt` |

Ключевое следствие для порта: **DLL — это F4/XSPICE-библиотека без CLI**; весь
фронтенд (парсер `.ewb`, приборы, диалоги) живёт в `WEWB32.EXE`. Интерфейс —
таблица `IFsimulator` (F4 `ifsim.h`), плюс расширение из 7 EWB-колбэков во
фронтенде (см. §5.4).

### 4.2 Дефолты task-опций

Декодировано из `CKTnewTask` (VA `0x4950cc`, размер блока `MALLOC(0xb9)`) и сверено
с `spice3f4/src/lib/ckt/cktntask.c` (F4) и `xspice-1-0/src/sim/CKT/CKTnewTask.c`.

| Опция | id | dataType | DLL | F4 (`cktntask.c`) | Примечание |
|---|---|---|---|---|---|
| `gmin` | 1 | `IF_SET\|IF_REAL` | `1e-12` | `1e-12` | совпадает |
| `reltol` | 2 | `IF_SET\|IF_REAL` | `1e-3` | `1e-3` | |
| `abstol` | 3 | `IF_SET\|IF_REAL` | `1e-12` | `1e-12` | |
| `vntol` | 4 | `IF_SET\|IF_REAL` | `1e-6` | `1e-6` | |
| `trtol` | 5 | `IF_SET\|IF_REAL` | **`1.0`** | `7` | XSPICE-правка `gtri 4/17/91` («lower default to give more accuracy», `CKTnewTask.c:42-46`) — **публичный дефолт ядра EWB отличается от F4** |
| `chgtol` | 6 | `IF_SET\|IF_REAL` | `1e-14` | `1e-14` | |
| `pivtol` | 7 | `IF_SET\|IF_REAL` | `1e-13` | `1e-13` | `TSKpivotAbsTol` |
| `pivrel` | 8 | `IF_SET\|IF_REAL` | `1e-3` | `1e-3` | `TSKpivotRelTol` |
| `tnom` | 9 | `IF_SET\|IF_ASK\|IF_REAL` | `300.15` | `300.15` | |
| `temp` | 33 | `IF_SET\|IF_ASK\|IF_REAL` | `300.15` | `300.15` | |
| `itl1` | 10 | `IF_SET\|IF_INTEGER` | `100` | `100` | DC-итерации |
| `itl2` | 11 | `IF_SET\|IF_INTEGER` | `50` | `50` | DC-transfer |
| `itl4` | 13 | `IF_SET\|IF_INTEGER` | `10` | `10` | TRAN-итерации на точку |
| `itl6`/`srcsteps` | 36 | `IF_SET\|IF_INTEGER` | `10` | `10` | один и тот же id, два ключа |
| `gminsteps` | 37 | `IF_SET\|IF_INTEGER` | `10` | `10` | |
| `method` | 42 | `IF_SET\|IF_STRING` | трапеция (`TRAPEZOIDAL=1`) | `TRAPEZOIDAL` | |
| `maxord` | 20 | `IF_SET\|IF_INTEGER` | `2` | `2` | |
| `bypass` | 19 | `IF_SET\|IF_INTEGER` | `1` | `1` | |
| `noopiter` | 39 | `IF_SET\|IF_FLAG` | `0` | `0` | |
| `defl`/`defw` | 15/16 | `IF_SET\|IF_REAL` | `1e-4` | `1e-4` | дефолтные L/W МОП |
| `defad`/`defas` | 17/18 | `IF_SET\|IF_REAL` | `0` | `0` | |
| `trytocompact` | 43 | `IF_SET\|IF_FLAG` | `0` | `0` | LTRA |
| `badmos3` | 44 | `IF_SET\|IF_FLAG` | `0` | `0` | |
| `keepopinfo` | 45 | `IF_SET\|IF_FLAG` | `0` | `0` | |

Поля `TSKminBreak` (`delmin`) и `TSKdelmin` в `CKTnewTask` **не инициализируются** —
как и в F4 (заполняются позже из task-опций, если заданы).

Раскладка `TSKtask` в DLL (сверено по записям в `CKTnewTask`; годна для сверки
будущих версий DLL): `+0x10 TSKname`, `+0x14 temp`, `+0x1c nomTemp`, `+0x24 maxOrder`,
`+0x28 integrateMethod`, `+0x2c currentAnalysis`, `+0x30 bypass`, `+0x34 itl1`,
`+0x38 itl2`, `+0x3c itl4`, `+0x40 srcsteps`, `+0x44 gminsteps`, `+0x48 minBreak`,
`+0x50 abstol`, `+0x58 pivtol(abs)`, `+0x60 pivrel`, `+0x68 reltol`, `+0x70 chgtol`,
`+0x78 vntol`, `+0x80 gmin`, `+0x88 delmin`, `+0x90 trtol`, `+0x98 defL`, `+0xa0 defW`,
`+0xa8 defAD`, `+0xb0 defAS`, `+0xb8` — битовые флаги (`fixLimit/noOpIter/tryToCompact/
badMos3/keepOpInfo`), флаги **не** сбрасываются явно (полагаются на `calloc`, как и в
`xspice-1-0/src/sim/include/util.h: #define MALLOC(x) calloc(1,(unsigned)(x))`).
Размер блока в DLL — `0xb9` = 185 байт: компилятор упаковал битовые поля в 1 байт
(структура собрана «плотно»; для нашего порта это несущественно **[?]**).

### 4.3 Какие опции ядро реально принимает

Все 75 параметров таблицы `options` (`enum.json`) имеют `dataType` из F4 `ifsim.h`:
`IF_SET`(0x2000)/`IF_ASK`(0x1000) + базовый тип. Отсюда классы:

1. **Реализованные** (`IF_SET`/`IF_ASK` содержат нужные методы): `gmin`, `reltol`,
   `abstol`, `vntol`, `trtol`, `chgtol`, `pivtol`, `pivrel`, `tnom`, `temp`, `itl1`,
   `itl2`, `itl4`, `itl6`/`srcsteps`, `gminsteps`, `method`, `maxord`, `bypass`,
   `noopiter`, `defl`, `defw`, `defad`, `defas`, `trytocompact`, `badmos3`,
   `keepopinfo`, XSPICE-группа: `maxopalter`(103), `maxevtiter`(102), `noopalter`(100),
   `ramptime`(101), `convlimit`(104), `convstep`(106), `convabsstep`(105),
   `autopartial`(107), `rshunt`(108) и их `*-enable`/`*-off` варианты (109–114),
   `DumpCircuit`(115)/`DumpRawFile`(116) — строковые (8224 = `IF_SET|IF_STRING`).
2. **Статистика/время** (`IF_ASK`-только): `totiter`, `traniter`, `equations`,
   `tranpoints`, `accept`, `rejected`, `time`, `trantime`, `reordertime`, `lutime`,
   `solvetime`, `tranlutime`, `transolvetime`, `trancuriters` (и производные
   `accept`/`rejected` считает `CKTaccept`…).
3. **F4-рудименты, не реализованные** (базовый тип без `SET/ASK`): `acct`, `list`,
   `nomod`, `nopage`, `node`, `opts` (флаги), `numdgt`, `limtim`, `limpts`, `lvlcod`,
   `lvltim` (целые), `cptime` (real), `itl3`, `itl5` — присутствуют для
   совместимости таблицы, ядро их игнорирует. В порте их достаточно
   регистрировать в каталоге, не обрабатывать.

### 4.4 Константы (`XSPIinit`)

`XSPIinit(frontEnd, &sim)` (VA `0x41012c`) ≈ `xspice-1-0/src/sim/CKT/SPIinit.c`:

* `SPfrontEnd = frontEnd` (глобал `0x5100cc`; дубль — `0x51a1b4`);
* делает **копию** 22 указателей таблицы фронтенда (`0x545bf0`, см. §5.3);
* `*description = &SIMinfo` (глобал `0x5100f0`);
* константы (проверено пробой глобалов):

| Адрес | Имя | Значение |
|---|---|---|
| `0x544e2c` | `CONSTroot2` | `1.4142135623730951` |
| `0x544e34` | `CONSTvt0` | `0.025864186384551461` (= `CONSTboltz·300.15/CHARGE`) |
| `0x544e3c` | `CONSTKoverQ` | `8.6170869180581252e-05` |
| `0x544e44` | `CONSTe` | `2.7182818284590451` |

Т.е. `tnom` по умолчанию 300.15 K включён в саму константу `vt0` (совпадает и с
`CONSTvt0 = CONSTboltz*(27+CONSTCtoK)/CHARGE` из xspice-1.0).

### 4.5 Что ещё статически связано в DLL

По строкам `__FILE__`/assert (в `.data`) видно, какие модули предка вошли в DLL:

* `h:\v9\xspice\src\lib\sparse\{spalloc,spbuild,spfactor,spoutput,spsmp,spsolve,sputils}.c`
  — **та же папка sparse, что и в F4** (в `vendor/spice3f4/src/lib/sparse/`). Это
  прямой аргумент за приоритет порта `spsmp/spfactor` (фаза P1.1).
* `h:\v9\xspice\src\lib\xspice\ipc\{ipc.c,ipcstdio.c}` — в DLL есть XSPICE-IPC
  (в релизе `xspice-1-0` эти файлы лежат в `src/sim/IPC/`): строки
  `>ENDANAL %.4f`/`>ABORTED %.4f`, «Use "quit" to quit.», сообщения об ошибках IPC.
  Для EWB этот канал не виден (WEWB32 его не импортирует), но код в DLL есть.
* Часть `lib/fte` (`OUTpData`/ASCII-графика `agraf.c`, `misccoms.c`) — см. §6.

Пути `h:\v9\xspice\...` — это дерево сборки EWB (внутренний «v9»); структура
отличается от релизных деревьев (`spice3f4/src/lib/...`, `xspice-1-0/src/sim/...`),
поэтому «1:1 исходники» собираются сопоставлением файлов, а не путями.

---

## R5. Слой трансляции `.ewb → CKT` (`WEWB32.EXE`)

### 5.1 Импорты/экспорты

* Импортирует из `xspice32.dll` **только 2 функции**: `XSPIinit`, `IFeval`
  (`docs/re/lineage/wewb32.imports.txt`). `IFeval` — F4-вычислитель выражений
  (`lib/inp/ifeval.c`, парс-деревья; ядро использует их для `asrc`/поведенческих
  источников), им EWB считает пользовательские выражения в приборах.
* Экспортирует 205 имён, из них **169 `Ewb*`/`EWB*`** — это и есть вся «прослойка»
  EWB: построение цепи через `IFsimulator` и доступ к редактору (`wewb32.exports.txt`).
  Категории (по именам):

| Группа | Примеры | Смысл |
|---|---|---|
| Add-устройства | `EwbAddResistor`, `EwbAddCapacitor`, `EwbAddInductor`, `EwbAddVoltage`, `EwbAddCurrent`, `EwbAddACSource`, `EwbAddAsrc`, `EwbAddVcVs/VcIs/VcSw`, `EwbAddDiode/Bjt/OpAmp741`, `EwbAddPoly`, `EwbAddDivider`, `EwbAddMultiplier`, `EwbAddSFFM`, `EwbSetupResistor`, `EwbSetupVoltage` | `Comp`-описания редактора → модель+инстанс ядра |
| Add-мета | `EwbAddInstance`, `EwbAddNetListComp`, `EwbAddXSpiceComp`, `EwbAddModelSubcktMacro`, `EwbAddToMatrix`, `EwbAllocStateMemory` | подцепь/нетлист/код-модели XSPICE |
| Change | `EwbChangeDeviceValue`, `EwbChangeCapacitorValue`, `EwbChangeInductorValue` | пересборка параметров |
| Файлы/рабочая область | `EwbCircuitOpen`, `EwbCircuitFile`, `EwbFileLoad/Save`, `EwbAttach/Detach`, `EwbCreateComp`, `EwbCompFind/CompInLib`, `EwbFirstComp/NextComp`, `EwbFirstSelected`, `EwbSelect/UnSelect`, `EwbMoveComp`, `EwbDeleteComp` | «мир редактора» |
| Доступ к модели/параметрам | `EwbGet/SetComp*`, `EwbGet/SetInstanceParam(s)`, `EwbGet/SetModelParam`, `EwbGet/SetNodeNum`, `EwbGetNodeName`, `EwbNumInternalNodes`, `EwbNumVoltageSources`, `EwbMapTerminals`, `EwbUpdateNodes` | мост редактор↔ядро |
| Токи/напряжения | `EwbGetVoltage`, `EwbGetCurrent`, `EwbAddVoltage`, `EwbAddCurrent`, `EwbGetMatrixElement` | запросы приборов |
| Цифровая часть | `EwbDigOpen/Setup`, `EwbDigGet/SetFamily`, `EwbDigGet/SetInput/Output`, `EwbDigGet/SetOpt`, `EwbDigGet/SetPropDelay`, `EwbDigBP`, `EwbDefineChip/Comp/Inst/Macro` | цифровые приборы/модели |
| Прогон | `EwbGo`, `EwbStopSimulation`, `EwbRestartSimulation`, `EwbSetBP`, `EwbSetDelay`, `EwbDelaySS`, `EwbSetMaxStep`, `EwbUsingSpiceEngine`, `EwbIsFirstIteration` | управление анализом |
| Колбэки ядра | `EWBsetup`, `EWBload`, `EWBacload`, `EWBaccept`, `EWBconvTest`, `EWBconvNode`, `EWBMsg`, `EWBSetTMax`, `EWBStdInform` | см. §5.4 |
| OUT-обёртки фронтенда | `OUTpBeginPlot`, `OUTpData`, `OUTwBeginPlot`, `OUTwReference`, `OUTwData`, `OUTwEnd`, `OUTendPlot`, `OUTbeginDomain`, `OUTendDomain`, `OUTattributes`, `createUid`, `deleteUid`, `seconds`, `OUTstopnow`, `OUTerror` | зарегистрированы членами `IFfrontEnd`; см. §5.3 |

* `Ewb_Get_Global_Vars`/`Ewb_Set_Global_Vars`, `Ewb_Set_Mode_Importing`,
  `Ewb_Abort_Import` — служебное для обмена с другими DLL EWB (модули устройств) **[?]**.

### 5.2 Полный список `Ewb*`-экспортов

Смотри `docs/re/lineage/wewb32.exports.txt` (sort — по ordinal). Если понадобится
точная атрибуция «кто вызывает кого»: у 169 экспортов есть RVA, дизассемблер —
`/tmp/opencode/oracle/wewb32.dis` (регенерируется `objdump -d`).

### 5.3 Как ядро получает вывод: `split_*`-обёртки

`XSPIinit` запоминает переданный `IFfrontEnd` (наш/EWB-шный) и делает **копию**
22 указателей (адрес копии — `0x545bf0`), в которой поля OUT-интерфейса заменены
на «split»-функции самой DLL:

| Смещение поля | Поле `IFfrontEnd` | Значение в копии |
|---|---|---|
| `+0x14` | `OUTpBeginPlot` | `split_OUTpBeginPlot` (RVA `0x934d8`) |
| `+0x18` | `OUTpData` | `split_OUTpData` (RVA `0x93576`) |
| `+0x1c` | `OUTwBeginPlot` | `split_OUTwBeginPlot` (RVA `0x93527`) |
| `+0x2c` | `OUTendPlot` | `split_OUTendPlot` (RVA `0x935a1`) |
| `+0x38` | `OUTattributes` | `split_OUTattributes` (RVA `0x935be`) |

Каждая `split_*`-обёртка делает два шага:
1. вызывает **свою** реализацию `OUT*` (F4 `lib/fte/outitf.c` — заполняет
   внутренние `plot`-структуры DLL, rawfile-буферы и т.п.);
2. вызывает **исходный** колбэк фронтенда, подставляя вместо указателя на plot
   внутренний глобал DLL (в `split_OUTpData` это `0x51a1b8`), т.е. «plot» наружу —
   непрозрачный дескриптор DLL-плота, а не C-структура.

Точка входа анализа (функция `0x49366d`, обёртка EWB над `doAnalyses`):
если установлен флаг `0x51a1bc`, `SPfrontEnd` временно переключается на копию
`0x545bf0` (значит, весь вывод пойдёт через `split_*`!), иначе остаётся исходный
фронтенд; по завершении — `SPfrontEnd` возвращается на `0x51a1b4`. Дальше
выставляется `0x51a1f0 = 1` и зовётся `SPfrontEnd->[0xc]` (`seconds` **[?]**).

Практический вывод для оракула (**уже учтено** в `tools/oracle/shim.py`): попытка
писать по чужому plot-указателю уронила бы DLL; вместо этого шим ведёт стек
открытых плотов сам, а `0x51a1b8` трактует как константу DLL.

### 5.4 Семь EWB-колбэков во фронтенде

Таблица фронтенда — F4-й `IFfrontEnd` (первые 15 полей, порядок из `ifsim.h`) +
**7 дополнительных** полей (при `XSPIinit` они тоже копируются). Семантика
(по прогонам оракула `tran_rc`: счётчики `[1,372,0,180,187,0,1]`):

| # | Экспорт | Вызовов (tran_rc) | Смысл |
|---|---|---|---|
| 15 | `EWBsetup` | 1 | начальная настройка (frontEnd/`XSPIinit`?) |
| 16 | `EWBload` | 372 | загрузка очередной точки/итерации |
| 17 | `EWBacload` | 0 | загрузка AC-матрицы |
| 18 | `EWBaccept` | 180 | точка принята |
| 19 | `EWBconvTest` | 187 | тест сходимости (out=0 → сошлось) |
| 20 | `EWBconvNode` | 0 | **[?]** узловой колбэк цифровой части/гибридного режима |
| 21 | `EWBMsg` | 1 (`id=1514`) | сообщение ядра наружу (коды — см. ниже) |

Это «прогресс/диагностика» из ядра в EWB, а не UI-приборы: отмена (`Ewb_Abort_Import`),
`EWBconvNode`/`EWBMsg` нужны для гибридных (аналог+цифра) прогонов. В порте
достаточно хуков-пустышек + счётчиков (как в шиме), но **нужно сохранить порядок
и число вызовов** — они наблюдаемы.

---

## R6. Формат вывода

### 6.1 «Сырой» вывод: F4-plot и rawfile

* Ядро отдаёт данные **только** через структуру плота (`OUTpBeginPlot` → `OUTpData`
  → `OUTendPlot`), значения — `double` (real) или `IFcomplex`. Никаких строк
  ядро не форматирует (кроме F4-«печати» — §6.2).
* Внутренний rawfile F4 (`lib/fte/outitf.c` → `rawfile`-часть) печатает значения
  как `%.15e` (сверяется по `vendor/spice3f4`: функция `rawfile`/`dump`; в
  фазах P3 проверим байт-в-байт на реальном файле оракула **[?]**).
* Заголовок rawfile содержит `Title/Date/Plotname/Flags/No. Variables/No. Points/
  Variables` — версия из `misccoms.c:377` (`Note: rawfile is version %s (current
  version is %s)`).

### 6.2 ASCII-«печать» (`agraf.c`) — только для режима print

Найденные в DLL строки `%.3e `, `%.2e`, `|`, `.` — это F4-шный ASCII-график
`spice3f4/src/lib/fte/agraf.c` (печать таблиц/плотов символами). Через него идут
только «печатные» форматы вывода F4 (batch/`print`), но **не** приборы EWB:
приборы получают числа через `split_*` → `OUT*`-колбэки (§5.3). Так что
`%.3e` — **не** формат приборов, а рудимент F4-графики.

### 6.3 IPC-маркеры

Строки `>ENDANAL %.4f`, `>ABORTED %.4f`, `>ENDANAL`, `>ABORTED` — из
`xspice-1-0/src/sim/IPC/IPC.c` (`batch output file`, режим `IPC_PROTOCOL_V1`).
В EWB этот канал не используется (`WEWB32` его не импортирует; в ядре живёт
отдельный глобальный `g_ipc`), но факт наличия фиксируем: если при порте
понадобится вывод лога, это отдельная малоиспользуемая ветка.

### 6.4 Приборы и оркестрация анализов

* Приборы EWB (`MultiMeter`, `Oscilloscope`, `Bode`, `Grapher`, `LogicAnalyzer`,
  `FuncGen`, `WordGen`) — фронтенд (`WEWB32.EXE`); данные им даёт ядро через
  `OUT*`-колбэки, отображение/округление — их собственный код. Отдельная
  `GRAPHER.dll` c экспортом `GrapherCreate` — построение графиков Bode/Grapher.
  Формат чисел на дисплеях приборов — **вне ядра** (значения-`double` доходят до
  прибора без потерь; для 1:1 нужен UI-разбор, это фаза I).
* Диалоги анализа принадлежат фронтенду: `CACAnalysisDialog`, `CDCAnalysisDialog`,
  `CFourierDialog`, `CMonteCarloDialog`, `CWorstCaseDialog`, `CSensitivityDialog`,
  `CTransferFunctionDialog` и т.п. — т.е. настройки анализов пишет сам EWB.
* **Fourier**: в ядре нет анализа FOUR (нет в `analInfo`), `CFourierDialog` есть
  во фронтенде ⇒ ДПФ делает `WEWB32` по TRAN-результату. **[?]** нужен ли для
  1:1 «свой» FOUR в ядре — решать в фазе I; ядровой приёмки он не требует.
* **MonteCarlo/WorstCase/ParameterSweep/TemperatureSweep**: аналогично — во
  фронтенде (диалоги есть, анализов в ядре нет). Оркестрация = серия прогонов
  `OP/DCT/TRAN/AC` + статистика во фронтенде. Следствие: в `Site/engine` это
  делаем «вне ядра», повторяя оконные развёртки и внешний цикл.

---

## Что из этого следует для порта (короткая выжимка)

1. **Оракульный контур повторяет путь WEWB32**: `XSPIinit(IFfrontEnd+F4/EWB)` +
   `IFsimulator`-вызовы; вывод — через `OUT*`-колбэки; `OUTpData`-plot DLL
   трактуется как непрозрачный дескриптор (§5.3).
2. Дефолты task-опций — копируем таблицу §4.2; **trtol=1.0** (не F4-ные 7).
3. Sparse портируем из `vendor/spice3f4/src/lib/sparse` (та же папка в DLL).
4. `itl3/itl5/acct/...` в порте — только «регистрация» в каталоге опций.
5. `EWBconvTest` = тест сходимости (out=0 — сошлось), `EWBaccept` — принятая точка;
   при паритетных тестах TRAN сверяем **число** вызовов, а не только значения.
6. FOUR/MonteCarlo/WorstCase/Sweeps — оркестрация фронтенда (в `Site/engine`
   отдельный слой поверх ядра).

## Открытые вопросы

| # | Вопрос | Как закрыть |
|---|---|---|
| 1 | `EWBconvNode` (id стаба) — когда зовётся? | прогоны с цифровыми/гибридными устройствами (фаза T) |
| 2 | Коды `EWBMsg` (id=1514 и др.) | RE ветки `EWBMsg` в `wewb32.dis` |
| 3 | Полный список `IFeval`-использований во фронтенде | RE вызовов `IFeval` в `wewb32.dis` |
| 4 | Точный формат rawfile ядра (заголовок/числа) | дамп rawfile из оракула (`DumpRawFile` опция!) и сверка с F4 (`outitf.c`) |
| 5 | Поле `IFfrontEnd` `+0xc` (`seconds`?) в обёртке анализа `0x49366d` | RE `seconds` (RVA `0x10cd9c`) |
| 6 | Что за флаг `0x51a1bc` (условие включения `split_*`) | RE записей в `0x51a1bc` в `wewb32.dis` |
| 7 | Формат вывода приборов (числа на дисплее) | фаза I (UI), сравнение скриншотов/локалей |
