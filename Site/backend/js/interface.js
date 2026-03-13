import { splitImage } from '/backend/js/utilit.js';

const simulation_swicth = document.getElementById('switch')
const status_text = document.getElementById('status')
const el_container = document.getElementById('el_container')
const menu_option = document.getElementById('menu-option')
const back_button = document.getElementById('back_button')
const category_menu = document.getElementById('category-menu')

const idListCategoryEl = [
    '???', 'sources', 'component', 'diod', 
    'transistor', 'analog', 'mixed', 'digit',
    'logic', '???', '???', 'function?', 'text', 'instrument', '???', '???'
];

const idListMenuOption = [
    'new', 'open', 'save', 'print'
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
    el_container.innerHTML = ''; // очищаем перед добавлением
    
    try {
        const result = await splitImage('/img/title/main_el.bmp', 24);
        
        result.tiles.forEach((tile, index) => {
            // Пропускаем 2 последних элемента - потому что там какашки
            if (index >= result.tiles.length - 2) {
                return; // не добавляем этот тайл
            }
            
            const div = document.createElement('div');
            div.style.backgroundImage = `url(${tile.dataUrl})`;
            
            // Добавляем ID из списка (если есть)
            if (idListCategoryEl[index]) {
                div.id = idListCategoryEl[index];
            }
            
            el_container.appendChild(div);
        });
    } catch (error) {
        console.error('Ошибка при разрезании картинки:', error);
        state = state_list[3]; // error
    }
        try {
        const result = await splitImage('/img/title/menu_option.bmp', 24);
        
        result.tiles.forEach((tile, index) => {
            
            const div = document.createElement('div');
            div.style.backgroundImage = `url(${tile.dataUrl})`;
            
            // Добавляем ID из списка (если есть)
            if (idListMenuOption[index]) {
                div.id = idListMenuOption[index];
            }
            
            menu_option.appendChild(div);
        });
    } catch (error) {
        console.error('Ошибка при разрезании картинки:', error);
        state = state_list[3]; // error
    }
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
back_button.addEventListener('click', back_to_main)

function open_catalog (target) {
    if (target.id === 'instrument') {
        category_menu.style.display = 'block'

        const rect = target.getBoundingClientRect();
        
        category_menu.style.left = rect.left - 100 + 'px';
        category_menu.style.top = (rect.bottom + 25) + 'px';
    }
}

document.addEventListener('click', function () {
    if (!(event.target.parentElement.id === 'el_container'))
    category_menu.style.display = 'none'
})

el_container.addEventListener('click', function(event) {
    const target = event.target;
    open_catalog(target);
});

