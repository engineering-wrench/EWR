# EWR

Clean-room среда моделирования электронных схем, совместимая с
**Electronics Workbench 5.12**.

- **Веб-версия:** https://engineering-wrench.github.io/EWR/
- **Редактор схем:** [EWR.html](https://engineering-wrench.github.io/EWR/EWR.html)
- **Документация:** [`docs/engine/PLAN.md`](docs/engine/PLAN.md),
  [`docs/re/`](docs/re/), [`docs/engine/plans/`](docs/engine/plans/)
- **Правила для разработки/агентов:** [`AGENTS.md`](AGENTS.md)

## Что внутри

- реверс и кодек формата `.ewb` (`tools/`, `Site/engine/ewb-codec.js`);
- фронт-редактор схем (`Site/`) с открытием/сохранением `.ewb`;
- legacy-движок симуляции (`Site/engine/`) — R/L/C/V/I, диод, OP/TRAN/AC;
- порт предка XSPICE32 (`Site/engine/spice/`) — пока разреженный решатель `sparse`.

Текущий статус и следующие шаги — в планах, а не в README.

## Локальный запуск

Корень статического сайта — `Site/` (все пути относительные):

```bash
python3 -m http.server 5502 -d Site
# или VS Code Live Server с root = Site/
```

Затем открыть http://localhost:5502/.

## Тесты

```bash
npm test   # node --test, без зависимостей
```

Часть тестов (оракул, модели, кодеки) делает self-skip, если нет `EWB512/`.

## Лицензия и правовая часть

Код — MIT (см. [`LICENSE`](LICENSE)). Оригинальные бинарники и ассеты EWB
(`EWB512/`, `extracted_assets/`, `Site/img/`) в репозиторий не входят и в `.gitignore`;
подробности — [`DISCLAIMER.md`](DISCLAIMER.md).
