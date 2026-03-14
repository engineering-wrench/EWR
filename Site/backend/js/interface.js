import { splitImage } from '/backend/js/utilit.js';

const simulation_swicth = document.getElementById('switch')
const status_text = document.getElementById('status')
const el_container = document.getElementById('el_container')
const menu_option = document.getElementById('menu-option')
const category_menu = document.getElementById('category-menu')

const idListCategoryEl = [
    '???', 'sources', 'component', 'diod', 
    'transistor', 'analog', 'mixed', 'digit',
    'logic', '???', '???', 'function?', 'text', 'instrument', '???', '???'
];

const idListMenuOption = [
    'new', 'open', 'save', 'print', 'analiz', 'curcius', 'theme', 'to_main', 'setting'
];

const idListInstrument = [
    'multimetr','generator','oscilograph','stenograhp','digital','???','???'
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
    await splitImage('/img/title/main_el.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: el_container,
        idList: idListCategoryEl,
        skipLastTiles: 2
    });

    await splitImage('/img/title/menu_option.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: menu_option,
        idList: idListMenuOption,
        skipLastTiles: 0
    });
}

setInterval(function(){
    state = state_list[0]
    if (simulation_state == true) {
        state = state_list[1]
    } else {
        state = state_list[2]
    }
    status_text.textContent = state
} ,1000);

function switch_click() {
    if (simulation_state == true) {
        simulation_swicth.style.backgroundImage = 'url(/img/OFF.bmp)';
        simulation_state = false
    } else {
        simulation_swicth.style.backgroundImage = 'url(/img/ON.bmp)';
        simulation_state = true
    }
}

function back_to_main() {
    window.location.href = '/index.html'
}

async function main () {
    await display ()
}

main ()

simulation_swicth.addEventListener('click', switch_click)

async function open_catalog (target) {
    if (target.id === 'instrument') {
        category_menu.style.display = 'flex'


        const rect = target.getBoundingClientRect();
        
        category_menu.style.left = rect.left - 100 + 'px';
        category_menu.style.top = (rect.bottom + 25) + 'px';

        await splitImage('/img/title/instrument.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: category_menu,
        idList: idListInstrument,
        skipLastTiles: 0
    });
    }
}

document.addEventListener('click', function(event) {
    if (event.target.parentElement.id !== 'el_container') {
        category_menu.style.display = 'none';
    }  
    if (event.target.id === 'to_main') {
        back_to_main ()
    }
});

el_container.addEventListener('click', function(event) {
    const target = event.target;
    open_catalog(target);
});
