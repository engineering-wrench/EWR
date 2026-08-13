const category_menu = document.getElementById('category-menu')
const main_windows = document.getElementById('main-windows')

let draggedElement = null;
let cloneElement = null;
let offsetX = 0, offsetY = 0;

category_menu.addEventListener('click', function(event) {
    const target = event.target;
    if (target === category_menu) return;

    if (category_menu.contains(target)) {
        // Создаем клон target
        cloneElement = target.cloneNode(true);
        cloneElement.style.position = 'fixed';
        cloneElement.style.left = '0px';
        cloneElement.style.top = '0px';
        cloneElement.style.opacity = '0.8';
        cloneElement.style.zIndex = '1000';
        cloneElement.style.cursor = 'grabbing';
        cloneElement.style.pointerEvents = 'none';
        
        document.body.appendChild(cloneElement);
        draggedElement = target;
        
        // Запоминаем смещение курсора относительно элемента
        const rect = target.getBoundingClientRect();
        offsetX = event.clientX - rect.left;
        offsetY = event.clientY - rect.top;
        
        // Устанавливаем позицию клона
        cloneElement.style.left = (event.clientX - offsetX) + 'px';
        cloneElement.style.top = (event.clientY - offsetY) + 'px';
        
        // Обработчики движения и отпускания
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
});

function onMouseMove(e) {
    if (!cloneElement) return;
    
    cloneElement.style.left = (e.clientX - offsetX) + 'px';
    cloneElement.style.top = (e.clientY - offsetY) + 'px';
}

function onMouseUp(e) {
    if (!cloneElement) return;
    
    // Проверяем, находится ли курсор над main_windows
    const rect = main_windows.getBoundingClientRect();
    const isOverMainWindows = e.clientX >= rect.left && 
                              e.clientX <= rect.right && 
                              e.clientY >= rect.top && 
                              e.clientY <= rect.bottom;
    
    if (main_windows && isOverMainWindows) {
        // Размещаем элемент относительно main_windows
        const newElement = draggedElement.cloneNode(true);
        
        // Вычисляем позицию относительно main_windows
        const relativeX = e.clientX - rect.left - offsetX;
        const relativeY = e.clientY - rect.top - offsetY;
        
        newElement.style.position = 'absolute';
        newElement.style.left = relativeX + 'px';
        newElement.style.top = relativeY + 'px';
        newElement.style.cursor = 'move';
        
        // Добавляем возможность перетаскивания внутри main_windows
        makeDraggable(newElement);
        
        main_windows.appendChild(newElement);
        
        // Визуальный эффект
        newElement.style.opacity = '0';
        setTimeout(() => {
            newElement.style.transition = 'opacity 0.2s';
            newElement.style.opacity = '1';
        }, 10);
    }
    
    // Удаляем клон
    cloneElement.remove();
    cloneElement = null;
    draggedElement = null;
    
    // Удаляем обработчики
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
}

// Функция для создания перетаскиваемых элементов внутри main_windows
function makeDraggable(element) {
    let isDragging = false;
    let startX, startY, elementStartX, elementStartY;
    
    element.addEventListener('mousedown', function(e) {
        if (e.target === element) {
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
            
            const rect = element.getBoundingClientRect();
            const parentRect = main_windows.getBoundingClientRect();
            elementStartX = rect.left - parentRect.left;
            elementStartY = rect.top - parentRect.top;
            
            element.style.cursor = 'grabbing';
            element.style.zIndex = '1000';
            
            e.preventDefault();
        }
    });
    
    document.addEventListener('mousemove', function(e) {
        if (!isDragging) return;
        
        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;
        
        let newX = elementStartX + deltaX;
        let newY = elementStartY + deltaY;
        
        // Ограничения внутри main_windows
        const parentRect = main_windows.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        
        newX = Math.max(0, Math.min(newX, parentRect.width - elementRect.width));
        newY = Math.max(0, Math.min(newY, parentRect.height - elementRect.height));
        
        element.style.left = newX + 'px';
        element.style.top = newY + 'px';
    });
    
    document.addEventListener('mouseup', function() {
        if (isDragging) {
            isDragging = false;
            element.style.cursor = 'move';
            element.style.zIndex = '';
        }
    });
}