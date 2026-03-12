export async function splitImage(imageUrl, tileSize = 16) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = imageUrl;
        
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
            
            const tilesX = Math.floor(img.width / tileSize);
            const tilesY = Math.floor(img.height / tileSize);
            const tiles = [];
            
            for (let y = 0; y < tilesY; y++) {
                for (let x = 0; x < tilesX; x++) {
                    const tileCanvas = document.createElement('canvas');
                    tileCanvas.width = tileSize;
                    tileCanvas.height = tileSize;
                    const tileCtx = tileCanvas.getContext('2d');
                    
                    tileCtx.drawImage(
                        canvas,
                        x * tileSize, y * tileSize,
                        tileSize, tileSize,
                        0, 0,
                        tileSize, tileSize
                    );
                    
                    tiles.push({
                        x, y,
                        dataUrl: tileCanvas.toDataURL('image/png'),
                        canvas: tileCanvas
                    });
                }
            }
            
            resolve({
                originalWidth: img.width,
                originalHeight: img.height,
                tileSize: tileSize,
                tilesX: tilesX,
                tilesY: tilesY,
                tiles: tiles
            });
        };
        
        img.onerror = reject;
    });
}