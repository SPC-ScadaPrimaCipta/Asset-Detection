"""
Coordinate Mapper: Affine transformation antara DXF coordinates dan pixel coordinates
"""
import numpy as np
from typing import Tuple, Dict, List
from dataclasses import dataclass

@dataclass
class DxfExtents:
    """DXF drawing extents dari $EXTMIN dan $EXTMAX"""
    x_min: float
    y_min: float
    x_max: float
    y_max: float
    
    @property
    def width(self) -> float:
        return self.x_max - self.x_min
    
    @property
    def height(self) -> float:
        return self.y_max - self.y_min

@dataclass
class ImageSize:
    """Pixel image dimensions"""
    width: int
    height: int

class CoordinateMapper:
    """
    Affine coordinate transformation DXF ↔ Pixel
    
    DXF origin (0,0) biasanya di kiri bawah
    Pixel origin (0,0) di kiri atas
    """
    
    def __init__(self, dxf_extents: DxfExtents, image_size: ImageSize):
        self.dxf_extents = dxf_extents
        self.image_size = image_size
        
        # Scale factors
        self.scale_x = image_size.width / dxf_extents.width
        self.scale_y = image_size.height / dxf_extents.height
    
    def dxf_to_pixel(self, x_dxf: float, y_dxf: float) -> Tuple[int, int]:
        """
        Convert DXF coordinates ke pixel coordinates
        
        Formula:
          x_px = ((x_dxf - EXTMIN_X) / (EXTMAX_X - EXTMIN_X)) * IMG_WIDTH
          y_px = IMG_HEIGHT - (((y_dxf - EXTMIN_Y) / (EXTMAX_Y - EXTMIN_Y)) * IMG_HEIGHT)
               ^ Flip Y-axis karena DXF Y+ ke atas, pixel Y+ ke bawah
        """
        x_norm = (x_dxf - self.dxf_extents.x_min) / self.dxf_extents.width
        y_norm = (y_dxf - self.dxf_extents.y_min) / self.dxf_extents.height
        
        x_px = int(x_norm * self.image_size.width)
        y_px = self.image_size.height - int(y_norm * self.image_size.height)
        
        # Clamp to image bounds
        x_px = max(0, min(x_px, self.image_size.width - 1))
        y_px = max(0, min(y_px, self.image_size.height - 1))
        
        return x_px, y_px
    
    def pixel_to_dxf(self, x_px: int, y_px: int) -> Tuple[float, float]:
        """
        Convert pixel coordinates ke DXF coordinates (inverse transform)
        """
        x_norm = x_px / self.image_size.width
        y_norm = (self.image_size.height - y_px) / self.image_size.height
        
        x_dxf = self.dxf_extents.x_min + (x_norm * self.dxf_extents.width)
        y_dxf = self.dxf_extents.y_min + (y_norm * self.dxf_extents.height)
        
        return x_dxf, y_dxf
    
    def dxf_bbox_to_pixel(self, bbox_dxf: Dict[str, float]) -> Dict[str, int]:
        """
        Convert DXF bounding box {x_min, y_min, x_max, y_max} ke pixel bbox {x, y, width, height}
        """
        x1_px, y1_px = self.dxf_to_pixel(bbox_dxf["x_min"], bbox_dxf["y_max"])  # Top-left
        x2_px, y2_px = self.dxf_to_pixel(bbox_dxf["x_max"], bbox_dxf["y_min"])  # Bottom-right
        
        return {
            "x": x1_px,
            "y": y1_px,
            "width": x2_px - x1_px,
            "height": y2_px - y1_px
        }
    
    def pixel_bbox_to_dxf(self, bbox_px: Dict[str, int]) -> Dict[str, float]:
        """
        Convert pixel bbox {x, y, width, height} ke DXF bbox {x_min, y_min, x_max, y_max}
        """
        x1_dxf, y1_dxf = self.pixel_to_dxf(bbox_px["x"], bbox_px["y"])
        x2_dxf, y2_dxf = self.pixel_to_dxf(
            bbox_px["x"] + bbox_px["width"], 
            bbox_px["y"] + bbox_px["height"]
        )
        
        return {
            "x_min": min(x1_dxf, x2_dxf),
            "y_min": min(y1_dxf, y2_dxf),
            "x_max": max(x1_dxf, x2_dxf),
            "y_max": max(y1_dxf, y2_dxf)
        }
    
    def transform_points(self, points_dxf: List[Tuple[float, float]]) -> List[Tuple[int, int]]:
        """Batch transform multiple DXF points ke pixel"""
        return [self.dxf_to_pixel(x, y) for x, y in points_dxf]
