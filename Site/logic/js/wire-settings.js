// Настройки маршрутизации проводов EWR.
// Хранятся в localStorage (ключ ewr.wireSettings) и используются движком
// проводов (wires.js). На странице /setting.html модуль автоматически строит
// форму настроек в контейнере #settings-form, если тот присутствует в DOM.

export const WIRE_SETTINGS_KEY = 'ewr.wireSettings';

export const WIRE_SETTINGS_DEFAULTS = {
    gridSize: 10,       // размер ячейки трассировки, px
    pad: 12            // отступ выхода из порта, px
};

export function loadWireSettings() {
    let stored = {};
    try {
        const raw = localStorage.getItem(WIRE_SETTINGS_KEY);
        if (raw) stored = JSON.parse(raw) || {};
    } catch (e) { stored = {}; }
    return Object.assign({}, WIRE_SETTINGS_DEFAULTS, stored);
}

export function saveWireSettings(partial) {
    const next = Object.assign({}, loadWireSettings(), partial);
    localStorage.setItem(WIRE_SETTINGS_KEY, JSON.stringify(next));
    return next;
}

function settingsUI() {
    const host = document.getElementById('settings-form');
    if (!host) return;

    const fields = [
        { key: 'gridSize', label: 'Размер ячейки трассировки, px', type: 'num', min: 4, max: 40 },
        { key: 'pad', label: 'Отступ от компонентов, px', type: 'num', min: 0, max: 60 }
    ];

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'Параметры применяются при построении и перетрассировке связей в редакторе (EWR.html).';
    host.appendChild(note);

    const list = document.createElement('div');
    list.className = 'settings-list';
    host.appendChild(list);

    const controls = {};
    fields.forEach(f => {
        const row = document.createElement('label');
        row.className = 'settings-row';

        const name = document.createElement('span');
        name.textContent = f.label;

        let input;
        if (f.type === 'bool') {
            input = document.createElement('input');
            input.type = 'checkbox';
            row.classList.add('settings-row--check');
        } else {
            input = document.createElement('input');
            input.type = 'number';
            input.min = f.min;
            input.max = f.max;
        }
        controls[f.key] = input;
        row.appendChild(name);
        row.appendChild(input);
        list.appendChild(row);
    });

    const btnRow = document.createElement('div');
    btnRow.className = 'settings-actions';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = 'Сохранить';
    btnRow.appendChild(saveBtn);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'По умолчанию';
    btnRow.appendChild(resetBtn);

    host.appendChild(btnRow);

    const status = document.createElement('p');
    status.className = 'settings-status';
    host.appendChild(status);

    function apply(current) {
        fields.forEach(f => {
            const el = controls[f.key];
            if (f.type === 'bool') el.checked = !!current[f.key];
            else el.value = current[f.key];
        });
    }
    apply(loadWireSettings());

    saveBtn.addEventListener('click', () => {
        const next = {};
        fields.forEach(f => {
            const el = controls[f.key];
            next[f.key] = f.type === 'bool' ? el.checked : Math.max(f.min, Math.min(f.max, Number(el.value) || 0));
        });
        saveWireSettings(next);
        apply(loadWireSettings());
        status.textContent = 'Настройки сохранены. Применятся при следующей трассировке связей.';
        status.style.color = '#4CAF50';
    });

    resetBtn.addEventListener('click', () => {
        saveWireSettings(WIRE_SETTINGS_DEFAULTS);
        apply(loadWireSettings());
        status.textContent = 'Восстановлены значения по умолчанию.';
        status.style.color = '#4CAF50';
    });
}

settingsUI();