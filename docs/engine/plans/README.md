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
| P1.2 | [P1.2-ckt.md](./P1.2-ckt.md) | `planned` | `Site/engine/spice/ckt.js` |
| P1.3 | — | `planned` | `Site/engine/spice/ni.js` |
| P1.4–P1.6 | — | `planned` | `Site/engine/spice/devices/`, diff-тесты |
| P2.* | — | `planned` | модели устройств |
| P3.* | — | `planned` | анализы |
| X.* | — | `planned` | XSPICE код-модели и цифра |
| I.* | — | `planned` | `Site/engine/ewb-facade.js`, приборы, Run |

## Как добавить

1. Скопировать `_TEMPLATE.md` в `<ID>-<slug>.md`.
2. Заполнить разделы (цель, границы, источники, шаги, приёмка, тесты, риски).
3. Добавить строку в таблицу выше.
4. Начать работу; обновлять журнал и статус по ходу.
