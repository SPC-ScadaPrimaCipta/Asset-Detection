"""
Tiling Worker: High-res tiling dengan SAHI concept (Slicing Aided Hyper Inference)
Potong gambar besar jadi tiles overlap untuk detect komponen kecil
"""
import cv2
import numpy as np
from typing import List, Dict, Tuple
from dataclasses import dataclass
from utils.coord_mapper import CoordinateMapper, DxfExtents, ImageSize

@dataclass
class Tile:
    """Single tile metadata"""
    tile_id: int
    x_offset: int  # Pixel offset di image asli
    y_offset: int
    width: int
    height: int
    image: np.ndarray  # Cropped tile image
    
class TilingWorker:
    """
    SAHI-style tiling: overlap tiles untuk avoid boundary detection loss
    """
    
    def __init__(self, tile_size: int = 1024, overlap: float = 0.2):
        """
        Args:
            tile_size: Tile dimension (1024×1024 px)
            overlap: Overlap ratio (0.2 = 20% overlap antar tiles)
        """
        self.tile_size = tile_size
        self.overlap = overlap
        self.stride = int(tile_size * (1 - overlap))
    
    def tile_image(self, image: np.ndarray) -> List[Tile]:
        """
        Split image jadi tiles dengan overlap
        
        Args:
            image: Input image (H × W × C atau H × W)
            
        Returns:
            List of Tile objects
        """
        h, w = image.shape[:2]
        tiles = []
        tile_id = 0
        
        # Calculate grid
        y_positions = list(range(0, max(h - self.tile_size, 1), self.stride))
        if (y_positions[-1] + self.tile_size) < h:
            y_positions.append(h - self.tile_size)  # Ensure cover sampai bawah
        
        x_positions = list(range(0, max(w - self.tile_size, 1), self.stride))
        if (x_positions[-1] + self.tile_size) < w:
            x_positions.append(w - self.tile_size)
        
        for y in y_positions:
            for x in x_positions:
                # Extract tile (clamp to image bounds)
                y_end = min(y + self.tile_size, h)
                x_end = min(x + self.tile_size, w)
                
                tile_img = image[y:y_end, x:x_end]
                
                # Pad jika tile kecil dari tile_size (edge case)
                if tile_img.shape[0] < self.tile_size or tile_img.shape[1] < self.tile_size:
                    if len(tile_img.shape) == 3:
                        padded = np.zeros((self.tile_size, self.tile_size, tile_img.shape[2]), dtype=tile_img.dtype)
                    else:
                        padded = np.zeros((self.tile_size, self.tile_size), dtype=tile_img.dtype)
                    padded[:tile_img.shape[0], :tile_img.shape[1]] = tile_img
                    tile_img = padded
                
                tiles.append(Tile(
                    tile_id=tile_id,
                    x_offset=x,
                    y_offset=y,
                    width=x_end - x,
                    height=y_end - y,
                    image=tile_img
                ))
                tile_id += 1
        
        return tiles
    
    def map_tile_bbox_to_global(
        self, 
        tile: Tile, 
        bbox_in_tile: Dict[str, int]
    ) -> Dict[str, int]:
        """
        Transform bbox coordinates dari tile space ke global image space
        
        Args:
            tile: Tile object
            bbox_in_tile: {x, y, width, height} dalam tile coordinates
            
        Returns:
            {x, y, width, height} dalam global image coordinates
        """
        return {
            'x': tile.x_offset + bbox_in_tile['x'],
            'y': tile.y_offset + bbox_in_tile['y'],
            'width': bbox_in_tile['width'],
            'height': bbox_in_tile['height']
        }
    
    def multi_scale_tiling(
        self, 
        image: np.ndarray, 
        scales: List[float] = [1.0, 1.5, 2.0]
    ) -> Dict[float, List[Tile]]:
        """
        Generate tiles at multiple scales untuk detect komponen berbagai ukuran
        
        Args:
            image: Input image
            scales: List of scale factors (1.0 = original, 2.0 = 2× zoom)
            
        Returns:
            Dict mapping scale → list of tiles
        """
        tiles_by_scale = {}
        
        for scale in scales:
            if scale == 1.0:
                scaled_img = image
            else:
                # Zoom in (resize)
                new_w = int(image.shape[1] * scale)
                new_h = int(image.shape[0] * scale)
                scaled_img = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            
            tiles = self.tile_image(scaled_img)
            tiles_by_scale[scale] = tiles
        
        return tiles_by_scale
