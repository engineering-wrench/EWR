import { splitImage } from '/logic/js/utilit.js';

const simulation_swicth = document.getElementById('switch')
const status_text = document.getElementById('status')
const el_container = document.getElementById('el_container')
const menu_option = document.getElementById('menu-option')
const category_menu = document.getElementById('category-menu')

const idListComponent = {
    'instrument':['multimetr','generator','oscilograph','stenograhp','digital','???','???'],
    'text':['???','???','net','paper','???paper','???','rotor','???','up','down','vertical','text','draft']

}

const idListCategoryEl = [
    'save_component', 'sources', 'component', 'diod', 
    'transistor', 'analog', 'mixed', 'digit',
    'logic', '???', '???', 'function?', 'text', 'instrument', '???', '???'
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
    await splitImage('/img/title/main_el.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: el_container,
        idList: idListCategoryEl,
        skipLastTiles: 4
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
    
    await splitImage('/img/title/'+ target.id +'.bmp', {
        cutsize: 24,
        tileSize: 40,
        targetContainer: category_menu,
        idList: idListComponent[target.id],
        skipLastTiles: 0
    });
}

document.addEventListener('click', function(event) {
    if (event.target.parentElement.id !== 'el_container' && event.target.parentElement.id !== 'category-menu') {
        category_menu.style.display = 'none';
    }  
    if (event.target.id === 'to_main') {
        window.location.href = '/index.html'
    }
    if (event.target.id === 'setting') {
        window.location.href = "/setting.html"; 
    }
    if (event.target.id === 'new') {
        alert ('в прогрессе')
    }
    if (event.target.id === 'open') {
        alert ('в прогрессе')
    }
    if (event.target.id === 'save') {
        alert ('в прогрессе')
    }
    if (event.target.id === 'print') {
        alert ('в прогрессе')
    }
});

el_container.addEventListener('click', function(event) {
    const target = event.target;
    open_catalog(target);
});