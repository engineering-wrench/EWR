import { splitImage } from './utilit.js';
import { preload } from './registry.js';

const simulation_swicth = document.getElementById('switch')
const status_text = document.getElementById('status')
const el_container = document.getElementById('el_container')
const menu_option = document.getElementById('menu-option')
const category_menu = document.getElementById('category-menu')

// Слоты палитры EWR = плитки лент EWB (img/title/<вкладка>.bmp), порядок 1:1.
// id совпадают с папками Site/components/<id>/ (manifest.json + поле ewb);
// таблица-источник — tools/palette-tiles.data.mjs, проверка — test/palette.test.mjs.
const idListComponent = {
    'sources': ['ground', 'battery', 'dc-current-source', 'ac-voltage-source', 'ac-current-source', 'vcvs', 'vccs', 'ccvs', 'cccs', 'vcc', 'vdd', 'clock', 'am-source', 'fm-source', 'sine-source', 'triangle-source', 'square-source', 'one-shot', 'ac-sweep-source', 'pwl-source', 'fsk-source', 'poly-source', 'arbitrary-source'],
    'component': ['point', 'resistor', 'capacitor', 'inductor', 'transformer', 'relay', 'switch', 'td-switch', 'vc-switch', 'cc-switch', 'pull-up', 'potentiometer', 'resistor-pack', 'coupled-inductor', 'polarized-capacitor', 'variable-capacitor', 'variable-inductor', 'magnetic-core', 'analog-switch', 'nonlinear-transformer'],
    'diod': ['diode', 'zener', 'led', 'diode-bridge', 'shockley-diode', 'scr', 'diac', 'triac'],
    'transistor': ['npn', 'pnp', 'jfet-n', 'jfet-p', 'nmos-dm', 'pmos-dm', 'nmos-dmb', 'pmos-dmb', 'nmos-em', 'pmos-em', 'nmos-emb', 'pmos-emb', 'nmesfet', 'pmesfet'],
    'analog': ['opamp-3t', 'opamp', 'opamp-7t', 'opamp-9t', 'comparator', 'pll'],
    'mixed': ['adc', 'dac-i', 'dac-v', 'mono', 'ic-555'],
    'digit': ['ic-74xx', 'ic-741xx', 'ic-742xx', 'ic-743xx', 'ic-744xx', 'ic-4xxx'],
    'logic': ['and2', 'or2', 'not', 'nor2', 'nand2', 'xor2', 'xnor2', 'tri-state', 'buffer', 'schmitt', 'template-and', 'template-or', 'template-nand', 'template-nor', 'template-not', 'template-xor', 'template-xnor', 'template-buf'],
    'digital': ['half-adder', 'full-adder', 'rs-ff', 'jk-ff-3', 'jk-ff', 'd-ff', 'd-ff-neg', 'mux', 'decoder', 'encoder', 'arithmetic', 'counter', 'shift', 'flip-flop-template'],
    'indicators': ['voltmeter', 'ammeter', 'bulb', 'beeper', 'seg7', 'seg7d', 'fuse', 'bar', 'dbar'],
    'controls': ['differentiator', 'integrator', 'gain', 'transconductance', 'multiplier', 'divider', 'summer', 'limiter', 'voltage-limiter', 'current-limiter', 'hysteresis', 'slew'],
    'text': ['lossy-line', 'table', 'net8', 'nonlinear-transformer-2', 'transformer-library', 'crystal', 'vacuum-tube', 'motor', 'boost', 'buck', 'buck-boost', 'text-box', 'title-block'],
    'instrument': ['multimeter', 'oscilloscope', 'function-generator', 'curve-tracer', 'logic-analyzer', 'bode-plotter', 'logic-probe']
}

const idListCategoryEl = [
    'save_component', 'sources', 'component', 'diod', 
    'transistor', 'analog', 'mixed', 'digit',
    'logic', 'digital', 'indicators', 'controls', 'text', 'instrument', '???', '???'
];

const idListMenuOption = [
    'new', 'open', 'save', 'print', 'analiz', 'curcius', 'theme', 'to_main', 'setting'
];

const state_list = [
    'none',
    'runing simulation',
    'stop simulation',
    'error'
]


let simulation_state = false
let state = state_list[0]

async function display() {
    await splitImage('img/title/main_el.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: el_container,
        idList: idListCategoryEl,
        skipLastTiles: 4
    });

    await splitImage('img/title/menu_option.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: menu_option,
        idList: idListMenuOption,
        skipLastTiles: 0
    });
}

// Статус обновляется по событию (Run), а не раз в секунду: иначе результат
// симуляции из sim.js затирался бы таймером.
state = state_list[0]

function switch_click() {
    if (simulation_state == true) {
        simulation_swicth.style.backgroundImage = 'url(img/OFF.bmp)';
        simulation_state = false
        status_text.textContent = state_list[2]
    } else {
        simulation_swicth.style.backgroundImage = 'url(img/ON.bmp)';
        simulation_state = true
        status_text.textContent = state_list[1]
    }
}

async function main () {
    await display ()
}

main ()

simulation_swicth.addEventListener('click', switch_click)

async function open_catalog (target) {
    category_menu.style.display = 'flex'

    const rect = target.getBoundingClientRect();
    
    // Рассчитываем предполагаемую позицию
    let left = rect.left - 100;
    let top = rect.bottom + 25;
    
    // Получаем размеры меню после его отображения
    // (ждём следующий кадр, чтобы размеры стали доступны)
    await new Promise(resolve => requestAnimationFrame(resolve));
    
    const menuRect = category_menu.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    
    // Корректируем по горизонтали
    // Не выходим за левый край
    if (left < 0) {
        left = 0;
    }
    // Не выходим за правый край
    if (left + menuRect.width > viewportWidth) {
        left = viewportWidth - menuRect.width;
    }
    
    // Корректируем по вертикали
    // Не выходим за нижний край
    if (top + menuRect.height > viewportHeight) {
        // Пытаемся открыть выше кнопки
        top = rect.top - menuRect.height - 25;
        
        // Если и сверху не помещается - прижимаем к нижнему краю
        if (top < 0) {
            top = viewportHeight - menuRect.height;
        }
    }
    
    // Применяем скорректированные координаты
    category_menu.style.left = left + 'px';
    category_menu.style.top = top + 'px';
    
    await splitImage('img/title/'+ target.id +'.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: category_menu,
        idList: idListComponent[target.id],
        skipLastTiles: 0
    });

    const ids = [];
    for (const el of category_menu.children) {
        if (el.id && el.id !== '???') {
            el.dataset.component = el.id;
            ids.push(el.id);
        }
    }
    if (ids.length) {
        preload([...new Set(ids)]);
    }
}

document.addEventListener('click', function(event) {
    if (event.target.parentElement.id !== 'el_container' && event.target.parentElement.id !== 'category-menu') {
        category_menu.style.display = 'none';
    }  
    if (event.target.id === 'to_main') {
        window.location.href = 'index.html'
    }
    if (event.target.id === 'setting') {
        window.location.href = "setting.html"; 
    }
    if (event.target.id === 'print') {
        alert ('в прогрессе')
    }
});

el_container.addEventListener('click', function(event) {
    const target = event.target;
    open_catalog(target);
});