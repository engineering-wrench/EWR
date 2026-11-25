# I1 — Интеграция нового движка в GUI

> Родительский план: `docs/engine/PLAN-CLONE.md` (§4, фаза I, задачи I1–I5)
> Статус: `done`
> Начат: 2026-11-07 · Обновлён: 2026-11-07
> Артефакты: `Site/engine/ewb-facade.js`, `Site/engine/test/facade.test.mjs`,
> `Site/logic/js/sim.js`, `Site/logic/js/interface.js`, `Site/style/redactor.css`,
> швы `getVoltage`/`getCurrent`/`setMaxStep` в `Site/engine/spice/ckt.js`.

## Цель

Заменить демонстрационную привязку Run (self-test старого движка) реальным
прогоном **текущей сцены редактора** через новый движок-клон: сцена →
CKT-дека → OP/TRAN/AC → значения на приборах и в статус-баре.

## Границы (что не входит)

- Полный набор устройств (диоды, BJT/MOSFET, оп-ампы) — фазы P2/P3/X; сейчас
  неподдерживаемые элементы попадают в `skipped` и не ломают расчёт остальной
  схемы.
- Графер/осциллограф как отдельное окно — фаза после I; facade уже отдаёт
  `series` для будущей отрисовки.
- Сохранение `.ewb` остаётся на legacy `assignNets` — обратный кодек вне задачи.
- Production-сборка/деплой — вне задания (`AGENTS.md`, правило 2).

## Источники и референсы

- `Site/engine/spice/ckt.js` — CKT API (`cktInit`/`cktModCrt`/`cktCrtElt`/
  `cktBindNode`/`cktNewTask`/`cktNewAnal`/`cktDoJob`) и выход `CKTplots`.
- `Site/engine/spice/analyses/*` — OP/TRAN/AC.
- `Site/engine/spice/devices/*` — R/C/L/V/I/SW.
- `Site/logic/js/wires.js` — контракт сцены `{components, links}`.
- `tools/oracle/corpus/*.json` — формат деки; facade принимает тот же вид.
- `docs/engine/PLAN-CLONE.md` §4 (фаза I), §5 (допуски).

## Шаги / чекпойнты

- [x] `ewb-facade.js`: сцена → дека (узлы/земля/устройства/приборы).
- [x] `sceneToDeck` — земля по символу ground или минусу первого источника;
      неподдерживаемые элементы → `skipped`.
- [x] `runDeck` — сборка CKT и `CKTdoJob` по формату корпуса оракула.
- [x] `simulateScene` — OP/TRAN/AC + `nodeVoltages`, `branchCurrents`,
      `readings`, `series`, ошибки.
- [x] Приборы: вольтметр/мультиметр (разность узлов), амперметр (0-В источник
      в разрыв, чтение тока ветви), осциллограф (ряд напряжения).
- [x] Швы `getVoltage`/`getCurrent`/`setMaxStep` в `ckt.js`.
- [x] `sim.js`: Run читает `WireSystem.scene()`, гоняет facade, обновляет
      приборы и статус; `selfTest` переведён на новый движок.
- [x] `interface.js`: убран секундный `setInterval`, затиравший результат Run.
- [x] Тесты `facade.test.mjs`; обновлён контракт швов в `ckt.test.mjs`.

## Критерии приёмки

- [x] Кнопка Run на сцене «ЭДС + R + R + ground» показывает 10/5 В.
- [x] Вольтметр/мультиметр показывает напряжение, амперметр — ток.
- [x] TRAN отдаёт временной ряд узла, AC — комплексные значения (|H|).
- [x] Схема без земли/пустая даёт понятное сообщение, а не исключение.
- [x] `npm test` зелёный.

## Тесты

| Тест | Что фиксирует |
|---|---|
| `Site/engine/test/facade.test.mjs` | сцена→дека, OP/TRAN/AC, приборы, skip, швы, форматирование |
| `Site/engine/test/bridge.test.mjs` | прежний контракт `mapComponentType`/`assignNets` (сохранение) |
| `Site/engine/test/ckt.test.mjs` | швы `getVoltage`/`getCurrent`/`setMaxStep` |

## Риски и квирки

- Сцена редактора не хранит имена узлов `.ewb` — узлы назначаются по
  union-find, порядок детерминирован (ground → n1, n2…). Для приборов это
  неважно; для сохранения по-прежнему используется legacy `assignNets`.
- Приборы EWB — это «пробники»; амперметр реализован как 0-В источник.
  Если он стоит не в разрыве, ток будет нулевым — это физически корректно.
- Неподдерживаемые устройства не роняют прогон, но и не учитываются в цепи
  (осознанно до P2/P3). В статусе показывается список пропущенных типов.
- Квирков сверх известных не добавлялось.

## Журнал

| Дата | Что сделано | Тесты | Статус |
|---|---|---|---|
| 2026-11-07 | facade + Run на реальной сцене + приборы + швы + тесты | `npm test`: 178/178 | `done` |
