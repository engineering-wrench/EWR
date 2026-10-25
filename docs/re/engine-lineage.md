# engine-lineage — паспорт предка движка EWB 5.12 (R1–R3)

> Фаза R плана `docs/engine/PLAN-CLONE.md`. Доказательства сняты в сессиях 2026-10
> (дизассемблеры, оракул, строки) — команды повторяемы, результаты зафиксированы.
> Живое подтверждение — оракул `tools/oracle/` (шим поднимает DLL и печатает
> `simulator="XSPICE"`, `version="3f4"`).

---

## 0. Вердикт

**Движок EWB 5.12 (`EWB512/XSPICE32.DLL`) = SPICE3F4 + XSPICE (GTRI) + патчи EWB.**

| Слой | Источник | Доказательства |
|---|---|---|
| Числовое ядро (CKT/NI/sparse/devices) | **SPICE3F4** (Berkeley, кit от 30.07.1993) | раскладка `IFsimulator` с `nonconvErr` (= F4, см. §1.1), `version="3f4"`, состав устройств/анализов F4 (§1.4) |
| XSPICE-надстройка (код-модели, event-driven, MIF) | **XSPICE 1.0 (GTRI)** — линия дерева `h:\v9\xspice` | строки `"XSPICE"`, `"XSPICE circuit level simulation program"` совпадают с `src/sim/CKT/SPIinit.c` из `xspice-1-0`; пути `h:\v9\xspice\src\lib\{sparse,xspice\ipc}\...` |
| Патчи EWB (швы для приборов) | правка DLL | доп. экспорты `getVoltage/getCurrent/setMaxStep/setBreakPoint/XSPIinit/...`; 7 EWB-полей в структуре фронтенда (см. §2.3) |
| Перевод схемы `.ewb → CKT` и EWB-hooks | **`WEWB32.EXE`** | 169 экспортов `Ewb*` (AddResistor/AddCapacitor/…); WEWB32 импортирует из DLL только `XSPIinit` и `IFeval` (§2.2) |

Практический вывод для порта: **числовое ядро портируем из SPICE3F4**
(`vendor/spice3f4/`), **XSPICE-часть — из `xspice-1-0`**
(`vendor/xspice-1-0/`, там же свежие версии `DEV/VSRC` и др. — см. §1.3),
расхождения с DLL ловим оракулом (`tools/oracle/`) и RE.

---

## 1. R1 — идентификация версии предка

### 1.1 `IFsimulator` в DLL — раскладка SPICE3F4

Живой оракул: `node tools/oracle/run.mjs --enumerate` →
`{"simulator":"XSPICE","description":"XSPICE circuit level simulation program","version":"3f4"}`.

| Что | F4 (`vendor/spice3f4/src/include/ifsim.h:336+`) | XSPICE 1.0 (`vendor/xspice-1-0/src/sim/CKT/SPIinit.c:122+`) | DLL (разведка + оракул) |
|---|---|---|---|
| после `doAnalyses` | `char *nonconvErr(...)` | сразу `numDevices` | **есть `nonconvErr`** (RVA 0x…, вызовы из DLL) ⇒ база F4 |
| блок EWB-швов | нет | нет | 11 функций (`getMatrixElement`…`setMaxStep`) перед `numDevices` |
| `version` | `"3f4"` (`src/bin/bconf.c:35 Spice_Version[]="3f4"`, `patchlev.h: PATCHLEVEL 0`) | `"1.0"` | `"3f4"` |

Фронтенд (`IFfrontEnd`) в DLL: 15 полей по F4-раскладке
(`IFnewUid…OUTattributes`; `vendor/spice3f4/src/include/ifsim.h:486+`) + 7
EWB-полей (см. §2.3). Доказательство «F4, а не 3c1/3f5»:

* поле `IFseconds` возвращает `double` (`fsub` в реализации) — в F4 это
  `double (*IFseconds)()`;
* XSPICE-1.0 (`SPIinit.c`) собран на базе 3c1 (`include/sim/version.h:
  SPICE_VERSION "SPICE 3c1"`) и **не имеет** `nonconvErr` — DLL его имеет.

### 1.2 XSPICE-часть в DLL

* строки идентификации — дословно из `xspice-1-0/src/sim/CKT/SPIinit.c:125–126`:
  `"XSPICE"`, `"XSPICE circuit level simulation program"`;
* пути исходников внутри DLL: `h:\v9\xspice\src\lib\sparse\{spalloc,spbuild,
  spfactor,spoutput,spsmp,spsolve,sputils}.c` и `h:\v9\xspice\src\lib\xspice\ipc\
  {ipc,ipcstdio}.c` — т.е. дерево вида F4 (`src/lib/sparse`) + XSPICE-добавка
  в `src/lib/xspice`;
* анализ `options` (`OPTinfo`) — есть и в F4, и в XSPICE (в `xspice-1-0`
  `analInfo` — OPT, AC, DCT, DCO, TRAN, PZ, SEN, TF; без DISTO/NOISE —
  см. §1.4).

### 1.3 Патчи EWB поверх линии (наблюдаемое)

* `DEV/VSRC` в `xspice-1-0` уже переписан (PHASE у PULSE, `pulse` —
  `IF_REALVEC`) — таблица параметров `Vsource` в DLL **совпадает с
  `xspice-1-0/src/sim/DEV/VSRC/VSRC.c`** (мaкросы `IOP/IP/OP`, см.
  `include/sim/DEVdefs.h:136–143`); это подтверждает, что «v9-дерево» —
  наследник именно этой линии кода, а не 3f4-овский `srctemp.c`;
* доп. экспорты поверх SPICE3/XSPICE: `getMatrixElement, getVoltage, addVoltage,
  getCurrent, addCurrent, setBreakPoint, setRelativeBreakPoint,
  changeCapacitorValue, changeInductorValue, isFirstIteration, setMaxStep,
  XSPIinit, IFeval` + `split_OUT*`-обёртки (перехват OUT-колбэков);
* в DLL есть 7 EWB-полей фронтенда (§2.3) — их `XSPIinit` тоже копирует.

### 1.4 Состав устройств и анализов (оракул)

Живой каталог интерфейса — `tools/oracle/golden/enum.json` (сгенерирован из
DLL, регенерация: `node tools/oracle/run.mjs --capture`):

* **84 устройства** = устройства F4 (`ASRC, BJT, BSIM1, BSIM2, Capacitor, CCCS,
  CCVS, CSwitch, Diode, Inductor, mutual, Isource, JFET, LTRA, MES, Mos1, Mos2,
  Mos3, Mos6, Resistor, Switch, Tranline, VCCS, VCVS, Vsource, poly`) + код-модели
  XSPICE (`adc_bridge, aswitch, capacitor, … zener`) — ср. список F4
  (`vendor/spice3f4/src/bin/config.c`) и `xspice-1-0` (`SPIinit.c: 24 SPICEdev`).
* **10 анализов**: `options, AC, DC, OP, TRAN, PZ, TF, DISTO, NOISE, SENS`
  = в точности `analInfo` SPICE3F4 (`vendor/spice3f4/src/bin/config.c:126+`:
  OPT, AC, DCT, DCO, TRAN, PZ, TF, DISTO, NOISE, SENS; `SEN2` в F4 лежит в
  `src/unsuppo/` и не собран). В `xspice-1-0` их только 8 (нет DISTO/NOISE).
  **`FOUR` (Fourier) в ядре НЕТ** — это фронтенд-постобработка (в F4 `fourier`
  живёт в nutmeg); MonteCarlo/WorstCase/ParameterSweep/TempSweep в таблице тоже
  нет ⇒ оркестрация во фронтенде (ответ на R5/Фазу P3, см. `engine-behavior.md`).

### 1.5 Что **НЕ** является маркером версии: «3F4T4»

В плане (§1.1) строка `3F4T4` числилась маркером SPICE3. **Это ошибка**: байты
по смещению `0x13206d` — середина таблицы 16-битных слов в `.data`
(`…0x33c5 0x3446 0x3454 0x348a…`), а не ASCII-строка; абсолютный адрес
`0x548a6d` нигде в коде не адресуется (проверено `objdump -d`). Версию
подтверждают живые данные оракула (`version="3f4"`), а не этот артефакт.

---

## 2. R2 — интерфейсы (карта швов)

### 2.1 `XSPICE32.DLL` — экспорты (63) и импорты

* Полный список: `docs/re/lineage/xspice32.exports.txt` (снято
  `node tools/pe-exports.mjs EWB512/XSPICE32.DLL`);
* импорты — только `KERNEL32.dll` (61) и `USER32.dll` (3:
  `MessageBeep, EnumThreadWindows, MessageBoxA`): полный список
  `docs/re/lineage/xspice32.imports.txt`. **Числовое ядро в DLL не тянет
  GUI-библиотек** — переносится в ESM без наследования WinAPI.
* Три группы экспортов:
  1. CKT/OUT API SPICE3 (`CKTinit, CKTcrtElt, CKTnewTask, CKTdoJob, OUTpData, …`);
  2. XSPICE (`IFeval, MIF_init_xspice_instance, spice_malloc`);
  3. EWB-швы (`getVoltage/getCurrent/addVoltage/addCurrent/getMatrixElement/
     setMaxStep/setBreakPoint/setRelativeBreakPoint/isFirstIteration/
     changeCapacitorValue/changeInductorValue/XSPIinit/findNode/OUTstopnow/
     split_OUT*`).

### 2.2 `WEWB32.EXE` — «студия» вокруг движка

* импорт из `xspice32.dll` — **ровно два символа**: `XSPIinit` и `IFeval`
  (`docs/re/lineage/wewb32.imports.txt`). Всё остальное — через таблицы
  указателей (`IFsimulator` + `IFfrontEnd`), как в C-шиме проекта;
* **169 экспортов `Ewb*`** — API трансляции/приборов, которым пользуются
  `EXT/ANALOG.DLL`, `EXT/DIGITAL.DLL`, `EXT/CHIP.DLL` (их экспорты —
  `docs/re/lineage/ewb-modules.exports.txt`). Характерные:
  `EwbAddResistor/EwbAddCapacitor/EwbAddInductor/EwbAddDiode/EwbAddBjt/
   EwbAddOpAmp741/EwbAddVcSw/EwbAddVcVs/EwbAddVcIs/EwbAddToMatrix/
   EwbAddVoltage/EwbAddCurrent/EwbSetupVoltage/EwbGetVoltage/EwbGetCurrent/
   EwbNumVoltageSources/EwbNumInternalNodes/EwbSetMaxStep/EwbSetBP/EwbDelaySS/
   EwbAddSFFM/EwbAddACSource/EwbAddModelSubcktMacro/EwbAllocStateMemory/…`
  ⇒ **перевод `.ewb → CKT` живёт в WEWB32.EXE** (R5: RE по этим точкам —
  отдельная задача; оракул пока строит деки напрямую через CKT API).
* Полный список экспортов WEWB32: `docs/re/lineage/wewb32.exports.txt`.

### 2.3 7 EWB-полей фронтенда — теперь с именами

Разведка: структура фронтенда, которую WEWB32 передаёт в `XSPIinit`, — по адресу
VA `0x58d289`; поля 15–21 содержат адреса, а сопоставление с таблицей экспортов
WEWB32 даёт имена:

| Поле | Адрес (VA) | Экспорт WEWB32 | Поведение в оракуле (DLL зовёт) |
|---|---|---|---|
| 15 | `0x4fff9d` | **`EWBsetup`** | 1× за `CKTdoJob` (setup-фаза) |
| 16 | `0x500003` | **`EWBload`** | на каждой итерации Ньютона/шаге (372 на TRAN-декe `tran_rc`) |
| 17 | `0x5000e3` | **`EWBacload`** | AC-load (в OP/TRAN не зовётся) |
| 18 | `0x5001a0` | **`EWBaccept`** | на каждом принятом шаге TRAN (180) |
| 19 | `0x50015b` | **`EWBconvTest`** | на итерациях сходимости (187) |
| 20 | `0x5014e5` | **`EWBconvNode`** | не зовётся в OP/TRAN |
| 21 | `0x50cc6c` | **`EWBMsg`** | 1× (id=1514) в `tran_rc` — таблица строк `ds:0x5badfc[id]` |

Т.е. DLL — не ванильный XSPICE: в циклах setup/load/accept/convTest она зовёт
EWB-хуки (это «EWB-устройство»/UI-швы). Оракульные стабы
(`tools/oracle/shim.py`, функции `cb_ewb1..cb_ewb7`) возвращают
нейтральные значения (0 / `*out=0`) — движок считает как при «пустом»
EWB-слое; вызовы логируются в `ewbCalls`/`ewbCounts` результата.

---

## 3. R3 — исходники предка (`vendor/`, не коммитится)

| Артефакт | Источник | sha256 (архив) | tree-hash* |
|---|---|---|---|
| `sp3f4.kit.tar.gz` | `https://embedded.eecs.berkeley.edu/pubs/downloads/spice/sp3f4.kit.tar.gz` | `6f93854b8e51040f90966cf04b4de68aec258d21abffc2515c0448c166d41e53` | `spice3f4/`: `570354c8…a9b2ef` |
| `sp3f4.patch.tar.gz` | `https://embedded.eecs.berkeley.edu/pubs/downloads/spice/sp3f4.patch.tar.gz` | `8f20d77c3769d383f6cccfe8247e76dd71d5fac617f6009942428ea7ea918e0c` | (патчи, не применены) |
| `xspice-1-0/` | GitHub-зеркало `erusyd/xspice-1-0` @ `37b9b81fcc642235f4e06218df8c60792578b76c` (`codeload` tar.gz коммита) | `247e04d4762e39287e76245865d67bb694da419bc3765343f721fd6d8c5aa1f7` | `1f67cab…ef49b9` |
| `vendor/py32/` (для оракула) | `https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-win32.zip` | `daf24de7fb3b173e94e56a201d3f38dfedebbdc7ed1925f7aeb8ed588e2b4189` | — |

\* tree-hash = sha256 по строкам `<путь>\0<sha256 файла>\n` (пути с `/`, лексикографически),
без `.git/`; воспроизводится `node tools/fetch-vendor.mjs --check`.

Установка/проверка: `node tools/fetch-vendor.mjs` (скачает и разложит),
`--check` — сверить хэши уже скачанного, `--python` — добавить Python для оракула.
`vendor/` в git не коммитится (см. `.gitignore`).

Версии файлов оригинала (справочно, PE-заголовки оригиналов искажены):

| Файл | sha256 | Комментарий |
|---|---|---|
| `EWB512/XSPICE32.DLL` | `b7664030ecfb07bd4a50f1a58fef31225a9e78340323754aac0d1ba9481991b9` | Time/Date PE «2027-07-25» (patched), линкер Borland 2.25 |
| `EWB512/WEWB32.EXE` | `ded94c4527499e19e80822d6919c5307bc68ecb8044bb88038e1ba1f3800475f` | экспорт-имя `wewb32s.exe`, Time/Date PE «2028-07-24» |
| `EWB512/SPICE-I-.VER` | — | `SPICE-I- 0 1996/03/03-16:26 SPICE` |

---

## Приложения

* `docs/re/lineage/xspice32.exports.txt` — экспорты DLL (63).
* `docs/re/lineage/xspice32.imports.txt` — импорты DLL (KERNEL32/USER32).
* `docs/re/lineage/wewb32.exports.txt` — экспорты WEWB32.EXE (205).
* `docs/re/lineage/wewb32.imports.txt` — импорты WEWB32.EXE (в т.ч. `xspice32.dll: 2`).
* `docs/re/lineage/ewb-modules.exports.txt` — экспорты `EXT/*.DLL|DDL` и прочих модулей EWB.
* `tools/oracle/golden/enum.json` — живой каталог интерфейса DLL (84 устройства, 10 анализов, nodeParms, specSigs).

## Как воспроизвести разведку

```bash
node tools/pe-exports.mjs EWB512/XSPICE32.DLL          # экспорты
objdump -p EWB512/XSPICE32.DLL                         # секции/импорты/экспорт-таблица
strings -n 4 EWB512/XSPICE32.DLL | grep -iE "h:\\v9|xspice|3f4"
cat EWB512/SPICE-I-.VER
node tools/oracle/run.mjs --status && node tools/oracle/run.mjs --enumerate
node tools/fetch-vendor.mjs --check
```
