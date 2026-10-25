# vendor/ — исходники предка движка (не коммитится)

Здесь лежат скачанные исходники, из которых портируется движок EWR
(`docs/engine/PLAN-CLONE.md`, стратегия «A. Порт предка»). В git эта папка
**не попадает** (см. корневой `.gitignore`); файлы воспроизводятся скриптом.

```bash
node tools/fetch-vendor.mjs            # скачать/распаковать всё
node tools/fetch-vendor.mjs --check    # проверить хэши уже скачанного
node tools/fetch-vendor.mjs --python   # + Python 3.11.9 (32-бит) для оракула
```

## Что внутри

| Путь | Что это | Роль в порте |
|---|---|---|
| `spice3f4/` | SPICE3F4 (Berkeley, kit 30.07.1993) — полный C-исходник | **База числового ядра**: `src/lib/{sparse,ckt,fte}`, `src/sim/DEV/*`, `src/include/ifsim.h` |
| `3f4patches/` | официальные патчи F4 (`spsmp.patch`, `grid.patch`, `newcoms.patch`) + readme | референс для quirk-листа (не применены к `spice3f4/`) |
| `xspice-1-0/` | XSPICE 1.0 (GTRI) — надстройка над SPICE3 (база 3c1), зеркало `erusyd/xspice-1-0` @ `37b9b81` | **XSPICE-слой**: `src/sim/{CM,EVT,MIF,SMP,IPC,...}`, код-модели `src/cml/*`; свежие `DEV/VSRC` и др. совпадают с таблицами DLL |
| `py32/` | Python 3.11.9 embed (32-бит, python.org) | окружение оракула: `tools/oracle/shim.py` под Wine |

Архивы (`sp3f4.kit.tar.gz`, `sp3f4.patch.tar.gz`, `xspice-1-0-37b9b81.tar.gz`,
`python-3.11.9-embed-win32.zip`) и `SHA256SUMS` — для проверки целостности.

## Хэши и ссылки

Фиксированные URL + sha256 архивов + tree-hash распакованных деревьев —
`docs/re/engine-lineage.md` §3. Проверяются автоматически скриптом
(и в `--check`-режиме без сети).

## Как пользоваться при порте

* JS-порт пишется в `Site/engine/spice/` (коммитится); `vendor/` — только
  референс для чтения. Копирование кода — по решению владельца
  (`PLAN-CLONE.md` §0), но структура/имена в JS сохраняются «1:1 по духу C»,
  чтобы сверять алгоритмы построчно.
* `MODELS/` оригинального EWB **не копируется** — парсится в производный
  `Site/engine/models/ewb-models.json` (`tools/models-parse.mjs`).
* Оракул (`tools/oracle/`) сравнивает наш порт с настоящим `XSPICE32.DLL`;
  эталоны — `tools/oracle/golden/*.json`.
