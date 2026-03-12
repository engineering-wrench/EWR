import { splitImage } from '/backend/js/utilit.js';

const simulation_swicth = document.getElementById('switch')
const status_text = document.getElementById('status')
const el_container = document.getElementById('el_container')

const idList = [
    '???', 'sources', 'component', 'diod', 
    'transistor', 'analog', 'mixed', 'digit',
    'logic', '???', '???', 'function?', 'text', 'instrument', '???', '???'
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
            if (idList[index]) {
                div.id = idList[index];
            }
            
            el_container.appendChild(div);
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

function main () {
    display ()
}

main ()


simulation_swicth.addEventListener('click', switch_click)