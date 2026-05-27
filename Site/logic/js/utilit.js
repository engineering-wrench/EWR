export async function splitImage(imageUrl, options = {}) {
    // Cache system
    const cache = new Map();
    
    // Cleanup function to remove old cache entries (can be called periodically)
    const cleanupCache = (maxAge = 5 * 60 * 1000) => { // Default 5 minutes
        const now = Date.now();
        for (const [key, value] of cache.entries()) {
            if (now - value.timestamp > maxAge) {
                cache.delete(key);
            }
        }
    };

    // Check if image is already in cache
    if (cache.has(imageUrl)) {
        const cached = cache.get(imageUrl);
        // Update timestamp to keep it fresh
        cached.timestamp = Date.now();
        return cached.data;
    }

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
            if (targetContainer) {
                // Clear container before adding new elements
                targetContainer.innerHTML = '';
                
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
                    div.style.backgroundSize = 'cover';
                    
                    // Добавляем ID из списка если есть
                    if (idList && idList[index]) {
                        div.id = idList[index];
                    }
                    
                    targetContainer.appendChild(div);
                    elements.push(div);
                });
            }
            
            const result = {
                originalWidth: img.width,
                originalHeight: img.height,
                cutSize: cutSize,
                tilesX: tilesX,
                tilesY: tilesY,
                totalTiles: totalTiles,
                tiles: tiles,
                elements: elements,
                container: targetContainer
            };
            
            // Store in cache with timestamp
            cache.set(imageUrl, {
                data: result,
                timestamp: Date.now()
            });
            
            // Optional: run cleanup after adding new item
            cleanupCache();
            
            resolve(result);
        };
        
        img.onerror = (error) => {
            // Clean up container on error
            if (targetContainer) {
                targetContainer.innerHTML = '';
            }
            
            // Remove from cache if it was added
            cache.delete(imageUrl);
            
            reject({
                error: error,
                message: 'Failed to load image',
                imageUrl: imageUrl
            });
        };
    });
}

// Advanced cache manager
const ImageCacheManager = {
    cache: new Map(),
    maxAge: 5 * 60 * 1000, // 5 minutes default
    
    set(key, value) {
        this.cache.set(key, {
            data: value,
            timestamp: Date.now()
        });
        this.cleanup();
    },
    
    get(key) {
        const entry = this.cache.get(key);
        if (entry && Date.now() - entry.timestamp <= this.maxAge) {
            entry.timestamp = Date.now(); // Refresh timestamp on access
            return entry.data;
        }
        this.cache.delete(key);
        return null;
    },
    
    cleanup() {
        const now = Date.now();
        for (const [key, value] of this.cache.entries()) {
            if (now - value.timestamp > this.maxAge) {
                this.cache.delete(key);
            }
        }
    },
    
    clear() {
        this.cache.clear();
    }
};