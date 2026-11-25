# Планы подпунктов

> Индекс детальных планов. Глобальные планы: `docs/engine/PLAN.md` (проект) и
> `docs/engine/PLAN-CLONE.md` (клон движка). Правила ведения — `AGENTS.md` §«Планы».
>
> Один подпункт = один файл. Имя: `<ID>-<slug>.md` (ID как в глобальном плане,
> slug латиницей в kebab-case).

## Статусы

`planned` → `in-progress` → (`blocked`) → `done` / `dropped`.

## Индекс

| ID | План | Статус | Артефакты |
|---|---|---|---|
| P1.1 | [P1.1-sparse.md](./P1.1-sparse.md) | `done` | `Site/engine/spice/sparse.js`, `tools/sparse-golden/` |
| P1.2 | [P1.2-ckt.md](./P1.2-ckt.md) | `done` | `Site/engine/spice/{ckt,ni,catalog}.js`, `Site/engine/test/ckt.test.mjs` |
| P1.3 | [P1.3-ni.md](./P1.3-ni.md) | `done` | `Site/engine/spice/{ni,ckt}.js` (NI + `cktLoad`/`cktTrunc`), `Site/engine/test/ni.test.mjs` (19) |
| P1.4 | [P1.4-devices.md](./P1.4-devices.md) | `done` | `Site/engine/spice/devices/*.js`, `Site/engine/test/devices.test.mjs` |
| P1.5 | [P1.5-sources.md](./P1.5-sources.md) | `done` | формы источников, `CKTbreaks`, `DEVaccept` |
| P1.6 | [P1.6-op-tran.md](./P1.6-op-tran.md) | `done` | `Site/engine/spice/analyses/*`, `Site/engine/test/analyses.test.mjs` |
| P2.1 | [P2.1-diode.md](./P2.1-diode.md) | `done` | `Site/engine/spice/devices/diode.js`, `tools/oracle/{corpus,golden}/diode_*.json`, тесты в `analyses.test.mjs`/`devices.test.mjs` |
| P2.2 | [P2.2-bjt.md](./P2.2-bjt.md) | `planned` | `Site/engine/spice/devices/bjt.js`, `tools/oracle/{corpus,golden}/bjt_*.json` |
| P2.7 | [P2.7-ac.md](./P2.7-ac.md) | `in-progress` | `Site/engine/spice/analyses/ac.js`, `niAcIter`, `tools/oracle/*/ac_rc.json` |
| I1 | [I1-gui.md](./I1-gui.md) | `done` | `Site/engine/ewb-facade.js`, `Site/logic/js/sim.js`, `Site/engine/test/facade.test.mjs` |
| I2 | [I2-component-symbols.md](./I2-component-symbols.md) | `done` | `Site/components/{point,resistor,capacitor,generator}/`, `test/components.test.mjs`, `.opencode/skills/component-symbols/` |
| I3 | [I3-canvas-viewport.md](./I3-canvas-viewport.md) | `done` | `Site/logic/js/viewport.js`, мировые координаты в `wires.js`/`drag-and-drop.js`/`file-io.js`, кнопки масштаба |
| I4 | [I4-palette.md](./I4-palette.md) | `in-progress` | `tools/palette-extract.mjs`, `tools/palette-tiles.data.mjs`, `tools/palette-manifests.mjs`, `Site/engine/palette.generated.json`, `Site/engine/ewb-devices.js`, 155 манифестов в `Site/components/`, `test/palette.test.mjs`, `docs/re/palette.md` |
| T1 | [T1-component-studio.md](./T1-component-studio.md) | `done` | `Component-editor/{tools/slice-elements.mjs,tools/serve.mjs,elements/,js/gallery.js}`, `test/{elements,studio-save}.test.mjs` |
| P2.* | — | `planned` | модели устройств |
| P3.* | — | `planned` | анализы |
| X.* | — | `planned` | XSPICE код-модели и цифра |
| I.* | — | `planned` | `Site/engine/ewb-facade.js`, приборы, Run |
| I4.* | — | `done` | шаг 5b: рантайм по `ewb` (`Site/engine/ewb-devices.js`) — `parser.deviceType`, `sim.mapComponentType`, `ewb-facade.mapEditorType`, `file-io.buildScene` |

## Как добавить

1. Скопировать `_TEMPLATE.md` в `<ID>-<slug>.md`.
2. Заполнить разделы (цель, границы, источники, шаги, приёмка, тесты, риски).
3. Добавить строку в таблицу выше.
4. Начать работу; обновлять журнал и статус по ходу.
