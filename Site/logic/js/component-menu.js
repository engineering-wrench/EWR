// Контекстное меню компонента. Плавает над рабочей областью при клике на компонент.
// Контейнер #component-menu объявлен в EWR.html.
// Параметры (data-slot) компонента редактируются здесь в реальном времени:
// каждое изменение значения тут же обновляет текст внутри SVG компонента
// (setComponentValue -> fillSlots).

import { setComponentValue } from './registry.js';

const ComponentMenu = (() => {
    let menu;
    let menuBody;
    let activeNode = null;

    function init() {
        menu = document.getElementById('component-menu');
        if (!menu) return;
        menuBody = menu.querySelector('.component-menu__body');
        document.addEventListener('click', (event) => {
            if (!menu || menu.style.display === 'none') return;
            const insideMenu = menu.contains(event.target);
            const insideActive = activeNode && activeNode.contains(event.target);
            if (!insideMenu && !insideActive) close();
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') close();
        });
    }

    function open(node, component, position) {
        if (!menu) return;
        activeNode = node;
        const title = menu.querySelector('.component-menu__title');
        if (title) title.textContent = (component && component.name) || 'Компонент';
        if (component && component.id) menu.dataset.component = component.id;
        renderParams(node, component);

        menu.style.display = 'flex';
        menu.style.visibility = 'hidden';

        requestAnimationFrame(() => {
            const rect = menu.getBoundingClientRect();
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const offset = 12;
            let left = position.x + offset;
            let top = position.y + offset;
            if (left + rect.width > vw) left = Math.max(0, position.x - rect.width - offset);
            if (top + rect.height > vh) top = Math.max(0, position.y - rect.height - offset);
            menu.style.left = left + 'px';
            menu.style.top = top + 'px';
            menu.style.visibility = 'visible';
        });
    }

    // Поля редактирования параметров (data-slot). Значения сразу применяются к SVG.
    function renderParams(node, component) {
        if (!menuBody) return;
        const params = (component && component.parameters) || {};
        const keys = Object.keys(params);
        if (!keys.length) {
            menuBody.innerHTML = '<p class="component-menu__empty">Нет доступных действий</p>';
            return;
        }

        menuBody.innerHTML = '';
        const list = document.createElement('div');
        list.className = 'component-menu__params';

        keys.forEach(slot => {
            const param = params[slot];
            const current = currentValue(node, slot);
            const value = current != null ? current : (param.default != null ? param.default : '');

            const row = document.createElement('label');
            row.className = 'component-menu__param';

            const name = document.createElement('span');
            name.className = 'component-menu__param-name';
            name.textContent = (param.label || slot) + (param.unit ? ', ' + param.unit : '');

            const input = document.createElement('input');
            input.className = 'component-menu__param-input';
            input.type = 'text';
            input.value = value;
            input.addEventListener('input', () => {
                setComponentValue(node, { [slot]: input.value });
            });

            row.appendChild(name);
            row.appendChild(input);
            list.appendChild(row);
        });

        menuBody.appendChild(list);
    }

    function currentValue(node, slot) {
        if (!node) return null;
        const items = node.querySelectorAll('svg [data-slot]');
        for (const el of items) {
            if (el.getAttribute('data-slot') === slot) return el.textContent;
        }
        return null;
    }

    function close() {
        if (!menu) return;
        menu.style.display = 'none';
        activeNode = null;
    }

    function destroy() {
        if (menu) menu.remove();
    }

    return { init, open, close, destroy, isOpen: () => !!menu && menu.style.display !== 'none' };
})();

export default ComponentMenu;