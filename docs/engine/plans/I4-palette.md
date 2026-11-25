# I4 — палитра EWB↔EWR: точная привязка «плитка → PartNum/класс»

> Родительский план: `docs/engine/PLAN.md` (§ GUI, после I3), `docs/engine/PLAN-CLONE.md`
> (фаза I, шов «редактор ↔ кодек»)
> Статус: `in-progress`
> Начат: 2026-11-22 · Обновлён: 2026-11-25
> Артефакты: `tools/palette-extract.mjs`, `tools/palette-tiles.data.mjs`,
> `tools/palette-manifests.mjs`, `Site/engine/palette.generated.json`,
> `Site/engine/ewb-devices.js` (генерируется `--runtime`),
> `Site/components/*/manifest.json` (155), `test/palette.test.mjs`, `docs/re/palette.md`

## Цель

Заменить приблизительное сопоставление EWR↔EWB (эвристики по RefID/строке типа) на
точное: элемент палитры редактора = элемент палитры EWB (`PartNum` или `ExtComp`-имя),
плюс таблица категорий и порядок плиток по оригинальным лентам 30xx.

## Границы (что не входит)

- Не рисуем SVG; иконки — из готовых лент BITMAP (read-only).
- Рантайм трогается только в шаге 5b и только в части «тип элемента берётся из
  данных»: `parser.js` (PartNum → тип), `sim.js`/`ewb-facade.js` (id плитки → тип),
  `file-io.js` (тип → символ). Геометрия, модель решения и прочие свойства
  (`analysis.js`, `spice/`) не меняются.
- Не трогаем билд/деплой и reference-ассеты (`EWB512/`, `extracted_assets/`,
  `Site/img/`).
- Оракул под Wine в текущем окружении недоступен (X-сервер отбрасывает окна:
  `X Error ... BadWindow`), поэтому GUI-верификация плиток — отдельный шаг.

## Источники и референсы

- `EWB512/WEWB32.EXE` — таблица из 17 PartsBin-записей (40 байт на запись):
  иконка-лента `31xx`, ANSI `30xx`, toolbar `33xx`, DIN `32xx`, число плиток,
  индекс, флаги. Найдена по сигнатуре (сканирование, без хардкод-офсета).
- `EWB512/EXT/ANALOG.EWX`, `DIGITAL.EWX`, `CHIP.EWX` — **состав PartsBin**
  (`EwbSetPartsBin("<id>")` + `EwbDefineComp (id, "имя", "модель.par", …)`);
  вкладка складывается из нескольких групп, счётчики сходятся со всеми 13 лентами.
- `EWB512/EXT/ANALOG.DLL` — имена экспортов отрисовки (`MagneticCoreOpen`,
  `CoupledInductorOpen`, `CrystalOpen`, `DCMotorOpen`) — расшифровка `mcore`/`lcouple`.
- `EWB512/COMPDAT.DLL` (~0x15BA0) — упакованный реестр стилей библиотечных деталей
  в порядке категорий (`fwb…triac`, `nmesfet/pmesfet`, `opamp…555`, `clock…arbsrc`,
  `beeper/bar/dbar`, `pot…motr`, `vacum`, `boost/buck/bckbst`, `diff…slew`, …).
- `EWB512/WEWBMSG.RES` — авторитетные имена `PartNum 0..41` (парсер
  `parsePartNames` из `tools/models-parse.mjs`).
- `EWB512/WEWB.RES` — контейнер; `ewba.la` (ANSI-ресурс) содержит C-записи
  `C <PN> <flags> <x> <y> V=… U=… M="класс" S=… L=…` — порядок «библиотеки» и
  классы моделей (`diode`, `npn`, `jfet-n`, `transf`, …).
- `extracted_assets/BITMAP30xx_1.bmp` — ленты 24-px плиток (эталон раскладки);
  `расположение/*.png` — скриншоты попапов EWB (порядок подтверждён 1:1).
- `docs/re/engine-parts.md` — карта PartNum/классов; `docs/re/EWB-file-format.md`
  (§4.2.1: у `Comp` **нет** индекса палитры — только `PartNum`/`ModelName`).

## Шаги / чекпойнты

- [x] Шаг 1 — найти статическую таблицу PartsBin и реестр стилей (сигнатуры,
      без хардкода офсетов).
- [x] Шаг 2 — `tools/palette-extract.mjs`: категории + ленты (геометрия, число
      плиток, md5 плитки) + реестр стилей + имена `PartNum` + C-записи `ewba.la` +
      имена вкладок из `WEWBMSG.RES` → `Site/engine/palette.generated.json`;
      тест `test/palette.test.mjs` (11 тестов).
- [x] Шаг 3 — идентификация всех 155 плиток 13 вкладок: порядок примитивов из
      `symbolLayouts` (`WEWBANSI.RES`), книжные — из `EXT/*.EWX`; спорные — «~»
      с причиной. Таблица — `tools/palette-tiles.data.mjs`, разбор —
      `docs/re/palette.md` §5, открытые пары — §7.
- [x] Шаг 4 — `docs/re/palette.md`: имена вкладок, состав вкладок из EWX (§5.0),
      таблица «категория → лента → плитка → класс/`PartNum`/стиль → имя»,
      квирки Q-P01..Q-P08.
- [x] Шаг 5a — данные для рантайма: 155 манифестов с блоком `ewb`
      (`{partNum, ext, model, device, confidence}`) + плейсхолдерные символы,
      `idListComponent` заполнен по порядку лент, ленты скопированы в
      `Site/img/title/<вкладка>.bmp`, генератор — `tools/palette-manifests.mjs`.
- [x] Шаг 5b — тип элемента берётся из данных палитры, а не из эвристик:
      `tools/palette-manifests.mjs --runtime` генерирует `Site/engine/ewb-devices.js`
      (`EWB_BY_ID`, `EWB_BY_PART`, `EWB_BY_EXT`, `EWB_BY_MODEL`,
      `EDITOR_ID_BY_DEVICE`, `deviceByPart()`); `parser.deviceType` решает по
      PartNum (RefID — только fallback), `sim.mapComponentType` и
      `ewb-facade.mapEditorType` — по id плитки, `file-io.buildScene` — по
      `EDITOR_ID_BY_DEVICE`. Неподдержанные типы (`connector`, `transformer`,
      книжные) больше не теряются молча: фасад пишет их в `skipped` с причиной.

## Критерии приёмки

- [ ] 17 записей PartsBin извлечены детерминированно; у каждой — ленты 31xx/30xx/
      33xx/32xx, число плиток, индекс.
- [x] Число плиток ленты совпадает с `count` для 3001–3013 (13 категорий).
- [x] Реестр стилей извлечён в порядке файла (456 ключей, 11 секций).
- [x] Каждая плитка имеет либо точную привязку (`PartNum`/`ExtComp`-имя/стиль),
      либо статус `unresolved` с причиной; эвристик нет. Уровни ✓/~/? в
      `tools/palette-tiles.data.mjs`, «~»-плитки перечислены в §7
      `docs/re/palette.md` с причиной.
- [ ] `npm test` зелёный. *Блокирует предсуществующий провал
      `test/components.test.mjs` (`Site/components/point` отсутствует в рабочем
      дереве); тесты палитры — 11/11.*

## Тесты

| Тест | Что фиксирует |
|---|---|
| `test/palette.test.mjs` | 17 категорий и их ленты/счётчики; имена вкладок из `WEWBMSG.RES` (Sources…Instruments, 14..17 без имени); префикс реестра стилей; имена `PartNum` (1=Resistor, 39=Node); совпадение плиток лент 3001–3013 с `count`; детерминизм и актуальность артефакта; 155 плиток: индексы/уникальность id, `source`=`ewb-лента-индекс`, блок `ewb` в манифестах, `viewBox`=`size`, порядок `idListComponent`, согласие `device` с `parser.deviceType` |

## Риски и квирки

- GUI-оракул под Wine недоступен в этом окружении (BadWindow) → статусы плиток
  ставятся по статике + визуальной идентификации, с явной пометкой источника.
- `3012` шире 24 px-сетки (313 px / 13 плиток) → число плиток из `count`, не из
  `round(w/24)`.
- Подтверждено (2026-11-23): `3014–3017` — **не вкладки**, а ленты иконок
  диалогов библиотек (Q-P02): `count` 20/20/50/50 — слоты диалога, на ленте
  10/12/10/10 иконок подкатегорий. Поэтому «несовпадение» ожидаемо.
- Имена 13 вкладок берутся из `WEWBMSG.RES` (`Favorites` — без ленты);
  сопоставление «лента → вкладка» числовое: 3001→Sources … 3013→Instruments.
- Квирк Q-P01: плитки 6–9 ленты 3001 — одна кнопка с двумя глифами
  (box + diamond), подтверждено скриншотом попапа Sources.
- `32xx` — DIN-ленты, `33xx` — toolbar-варианты; не путать с ANSI `30xx`.
- Порядок C-записей в `ewba.la`/`WEWBANSI.RES` **не** совпадает с порядком плиток —
  не использовать как источник порядка.
- Квирк Q-P07: состав вкладки задаётся расширениями (`EXT/*.EWX`), а не EXE;
  один номер группы (652/653/657/661/663…) определяют разные расширения.
- Квирк Q-P08: иконки кристалла/мотора в Basic и Miscellaneous не совпадают по
  md5 — записи библиотеки разные, не копия значка.
- Квирки палитры живут в `docs/re/palette.md` §6 (Q-P01..Q-P08): в
  `engine-quirks.md` только квирки движка.

## Журнал

| Дата | Что сделано | Тесты | Статус |
|---|---|---|---|
| 2026-11-22 | Найдена таблица 17 PartsBin в `WEWB32.EXE` (сигнатура `3101/3001/3301/3201`, шаг 40); реестр стилей в `COMPDAT.DLL`; `ewba.la` разобран; выяснено, что у `Comp` нет индекса палитры; оракул под Wine не стартует (BadWindow) | не запускались | `in-progress` |
| 2026-11-23 | `tools/palette-extract.mjs` дописан: секции реестра (`sliceRegistry`), имена вкладок из `WEWBMSG.RES` (`parseCategoryNames`), `name`/`role` у категорий; артефакт перегенерирован; написан `test/palette.test.mjs`. Визуальный проход: 3003 разобрана полностью, примитивы 3001/3002/3004/3005 и шаблоны 3007 привязаны, остальные — `?`. Найден квирк Q-P01 (два глифа в кнопках 6–9). `docs/re/palette.md` создан. Проверены ресурсы `.rsrc` EXE — статического списка плиток нет (только стандартные типы 1–6, 12, 14) | `test/palette.test.mjs` 11/11; общий `npm test` 205/206 (предсуществующий провал `components.test.mjs`, не связан) | `in-progress` |
| 2026-11-25 | Шаг 5b: добавлен режим `--runtime` в `tools/palette-manifests.mjs` → `Site/engine/ewb-devices.js` (155 плиток: `EWB_BY_ID`, `EWB_BY_PART` 14 примитивов, `EDITOR_ID_BY_DEVICE`, `deviceByPart()`; конфликты PartNum/ExtComp/модели — ошибка генерации). `parser.deviceType`: PartNum → тип из таблицы, префикс RefID — fallback (части с `PartNum 0` по-прежнему `vsource`). `sim.mapComponentType` / `ewb-facade.mapEditorType`: сначала `EWB_BY_ID`, старые списки — fallback для id вне палитры (`generator`, `multimeter`). `file-io`: `EDITOR_MAP` заменён на `EDITOR_ID_BY_DEVICE` (земля → `ground`, источник → `battery`, прибор → `multimeter`). Тесты не запускались (по запросу — только правка кода) | не запускались (по запросу) | `in-progress` |
| 2026-11-25 | Порядок примитивов взят из `symbolLayouts` (`WEWBANSI.RES`, 39 записей) — счётчики всех 13 вкладок сошлись точно (9/10/3/12/1/0/0/0/0/4/0/0/0). Создана таблица `tools/palette-tiles.data.mjs` (155 плиток, уровни ✓/~/?), генератор `tools/palette-manifests.mjs` (`--check`/`--ids`/`--md`): 151 новый манифест + блок `ewb` в 4 существующих, 155 плейсхолдерных символов. `idListComponent` заполнен полностью (13 вкладок), добавлены id вкладок `digital`/`indicators`/`controls` и ленты `Site/img/title/{analog,mixed,digit,digital,indicators,controls}.bmp` (копия ANSI `30xx`). Попутно исправлен `EXPECTED_SOURCE.point` в `test/components.test.mjs` (было 3001-01 = земля, стало 3002-01 = соединитель). Обновлены `docs/re/palette.md` §5 (таблицы из `--md`), §7, квирки Q-P09…Q-P11. Попутно в `sim.js:mapComponentType` добавлены новые id источников и убран `point` из списка земли (теперь это соединитель 2-выводной, а не заземление) | `npm test` 213/214 (1 skip, 0 fail); `node tools/palette-manifests.mjs --check` — чисто | `in-progress` |
| 2026-11-23 | Найден источник состава палитры: `EXT/ANALOG.EWX`/`DIGITAL.EWX`/`CHIP.EWX` — группы `EwbSetPartsBin("<id>")` и `EwbDefineComp`. Счётчики сошлись для всех 13 вкладок (плитки = примитивы + книжные из EWX), см. `docs/re/palette.md` §5.0. Разобраны: Basic (15 ✓, 5 ~/?), Analog ICs (значки 3/5/7/9-выводных усилителей + `comp`/`pll`), Miscellaneous (13/13), состав Logic Gates/Digital/Indicators/Controls/Mixed. Добавлены квирки Q-P07/Q-P08. Осталось: одно необъяснённое место в Basic (`Pull` не найден), пары значок↔имя внутри семейств трансформаторов/кристалла — нужен GUI-оракул | `test/palette.test.mjs` 11/11 | `in-progress` |
