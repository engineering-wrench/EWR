export async function splitImage(imageUrl, options = {}) {
    return new Promise((resolve, reject) => {
        const {
            cutSize = 24,
            tileSize = 30,
            targetContainer = null,
            idList = [],
            skipLastTiles = 0,
            customFilter = null
        } = options;
        
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imageUrl;
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const tilesX = Math.floor(img.width / cutSize);
            const tilesY = Math.floor(img.height / cutSize);
            const totalTiles = tilesX * tilesY;
            const tiles = [];
            const elements = [];
            
            // Сначала создаем все тайлы
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const tileCanvas = document.createElement('canvas');
                    tileCanvas.width = cutSize;
                    tileCanvas.height = cutSize;
                    const tileCtx = tileCanvas.getContext('2d');
                    
                    tileCtx.drawImage(
                        canvas,
                        x * cutSize, y * cutSize,
                        cutSize, cutSize,
                        0, 0,
                        cutSize, cutSize
                    );
                    
                    const tileData = {
                        x, y,
                        index: y * tilesX + x,
                        dataUrl: tileCanvas.toDataURL('image/png'),
                        canvas: tileCanvas
                    };
                    
                    tiles.push(tileData);
                }
            }
            
            // Если указан контейнер - создаем DOM элементы с учетом фильтрации

            targetContainer.innerHTML = '';

            if (targetContainer) {
                tiles.forEach((tile, index) => {
                    // Проверяем, нужно ли пропустить последние N тайлов
                    const tilesToSkip = Math.min(skipLastTiles, totalTiles);
                    const shouldSkipLast = index >= totalTiles - tilesToSkip;
                    
                    if (shouldSkipLast) {
                        return; // пропускаем этот тайл
                    }
                    
                    // Применяем пользовательский фильтр
                    if (customFilter && !customFilter(tile, index)) {
                        return;
                    }
                    
                    const div = document.createElement('div');
                    div.style.backgroundImage = `url(${tile.dataUrl})`;
                    div.style.width = tileSize + 'px';
                    div.style.height = tileSize + 'px';
                    
                    // Добавляем ID из списка если есть
                    if (idList && idList[index]) {
                        div.id = idList[index];
                    }
                    
                    targetContainer.appendChild(div);
                    elements.push(div);
                });
            }
            
            resolve({
                originalWidth: img.width,
                originalHeight: img.height,
                cutSize: cutSize,
                tilesX: tilesX,
                tilesY: tilesY,
                totalTiles: totalTiles,
                tiles: tiles,
                elements: elements,
                container: targetContainer
            });
        };
        
        img.onerror = (error) => {
            reject(error);
        };
    });
}