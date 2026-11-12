"""
DXF Parser Worker: Enhanced DXF parsing dengan vertical text grouping
"""
import ezdxf
from ezdxf import bbox
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass
import re

@dataclass
class DxfTextEntity:
    """Single TEXT/MTEXT entity"""
    text: str
    x: float
    y: float
    height: float
    width: float  # Estimated width
    layer: str
    bbox: Dict[str, float]  # {x_min, y_min, x_max, y_max}

@dataclass
class DxfCircleEntity:
    """CIRCLE entity (potential instrument bubble)"""
    center_x: float
    center_y: float
    radius: float
    layer: str

@dataclass
class DxfInsertEntity:
    """INSERT (block reference)"""
    block_name: str
    insert_x: float
    insert_y: float
    layer: str
    bbox: Optional[Dict[str, float]]

class DxfParserWorker:
    """
    Parse DXF dengan fitur:
    - Vertical text grouping (LI + 0401 → LI-0401)
    - CIRCLE detection untuk instrument bubbles
    - Boundary filtering (skip title block)
    - Layer classification
    """
    
    def __init__(self, dxf_path: str):
        self.doc = ezdxf.readfile(dxf_path)
        self.modelspace = self.doc.modelspace()
        
        # Extents dari $EXTMIN/$EXTMAX header
        self.extents = self._read_extents()
        
    def _read_extents(self) -> Dict[str, float]:
        """Read drawing extents dari DXF header"""
        try:
            ext_min = self.doc.header.get('$EXTMIN', (0, 0, 0))
            ext_max = self.doc.header.get('$EXTMAX', (10000, 10000, 0))
            
            return {
                'x_min': ext_min[0],
                'y_min': ext_min[1],
                'x_max': ext_max[0],
                'y_max': ext_max[1],
                'width': ext_max[0] - ext_min[0],
                'height': ext_max[1] - ext_min[1]
            }
        except Exception:
            # Fallback: calculate dari entities
            return self._calculate_extents_from_entities()
    
    def _calculate_extents_from_entities(self) -> Dict[str, float]:
        """Fallback: hitung extents dari bounding box semua entities"""
        try:
            extents = bbox.extents(self.modelspace)
            return {
                'x_min': extents.extmin.x,
                'y_min': extents.extmin.y,
                'x_max': extents.extmax.x,
                'y_max': extents.extmax.y,
                'width': extents.size.x,
                'height': extents.size.y
            }
        except Exception:
            return {'x_min': 0, 'y_min': 0, 'x_max': 10000, 'y_max': 10000, 'width': 10000, 'height': 10000}
    
    def is_in_title_block(self, x: float, boundary_threshold: float = 0.85) -> bool:
        """
        Check apakah koordinat X berada di area title block
        Default: skip entities dengan X > 85% dari width
        """
        threshold_x = self.extents['x_min'] + (self.extents['width'] * boundary_threshold)
        return x > threshold_x
    
    def extract_text_entities(self, skip_title_block: bool = True) -> List[DxfTextEntity]:
        """Extract semua TEXT dan MTEXT entities"""
        texts = []
        
        for entity in self.modelspace.query('TEXT MTEXT'):
            try:
                if entity.dxftype() == 'TEXT':
                    text = entity.dxf.text.strip()
                    x, y = entity.dxf.insert[:2]
                    height = entity.dxf.height
                else:  # MTEXT
                    text = entity.text.strip()
                    x, y = entity.dxf.insert[:2]
                    height = entity.dxf.char_height
                
                if not text:
                    continue
                
                # Skip title block
                if skip_title_block and self.is_in_title_block(x):
                    continue
                
                # Estimate width (rough: char_count * height * 0.6)
                width = len(text) * height * 0.6
                
                texts.append(DxfTextEntity(
                    text=text,
                    x=x,
                    y=y,
                    height=height,
                    width=width,
                    layer=entity.dxf.layer,
                    bbox={
                        'x_min': x,
                        'y_min': y,
                        'x_max': x + width,
                        'y_max': y + height
                    }
                ))
            except Exception:
                continue
        
        return texts
    
    def group_vertical_texts(
        self, 
        texts: List[DxfTextEntity],
        max_x_distance: float = None,
        max_y_distance_factor: float = 1.5
    ) -> List[DxfTextEntity]:
        """
        Group vertical stacked texts (common di instrument bubbles)
        Contoh: 
          LI     → LI-0401
          0401
        """
        if max_x_distance is None:
            # Adaptive: 5% dari drawing width
            max_x_distance = self.extents['width'] * 0.05
        
        grouped = []
        used = set()
        
        # Sort by Y descending (top to bottom)
        sorted_texts = sorted(texts, key=lambda t: -t.y)
        
        for i, text1 in enumerate(sorted_texts):
            if i in used:
                continue
            
            # Cari text di bawahnya yang berdekatan
            candidates = []
            for j, text2 in enumerate(sorted_texts[i+1:], start=i+1):
                if j in used:
                    continue
                
                # Check: X alignment (same column)
                x_dist = abs(text1.x - text2.x)
                if x_dist > max_x_distance:
                    continue
                
                # Check: Y proximity (max 1.5x height)
                y_dist = text1.y - text2.y  # text1 lebih atas
                max_y_dist = text1.height * max_y_distance_factor
                
                if 0 < y_dist <= max_y_dist:
                    candidates.append((j, text2))
            
            if candidates:
                # Merge: ambil kandidat pertama (terdekat)
                j, text2 = candidates[0]
                
                # Gabungkan dengan hyphen jika belum ada
                combined_text = text1.text
                if not combined_text.endswith('-') and not text2.text.startswith('-'):
                    combined_text += '-'
                combined_text += text2.text
                
                # Merged bbox
                merged_bbox = {
                    'x_min': min(text1.bbox['x_min'], text2.bbox['x_min']),
                    'y_min': min(text1.bbox['y_min'], text2.bbox['y_min']),
                    'x_max': max(text1.bbox['x_max'], text2.bbox['x_max']),
                    'y_max': max(text1.bbox['y_max'], text2.bbox['y_max'])
                }
                
                grouped.append(DxfTextEntity(
                    text=combined_text,
                    x=text1.x,
                    y=text1.y,
                    height=text1.height,
                    width=max(text1.width, text2.width),
                    layer=text1.layer,
                    bbox=merged_bbox
                ))
                
                used.add(i)
                used.add(j)
            else:
                # No group: add as-is
                grouped.append(text1)
                used.add(i)
        
        return grouped
    
    def extract_circles(
        self, 
        min_radius: float = 15.0,
        max_radius: float = 115.0,
        skip_title_block: bool = True
    ) -> List[DxfCircleEntity]:
        """
        Extract CIRCLE entities (kandidat instrument bubbles)
        Typical instrument bubble radius: 15-115 DXF units
        """
        circles = []
        
        for entity in self.modelspace.query('CIRCLE'):
            try:
                center = entity.dxf.center
                radius = entity.dxf.radius
                
                # Filter by radius
                if not (min_radius <= radius <= max_radius):
                    continue
                
                # Skip title block
                if skip_title_block and self.is_in_title_block(center.x):
                    continue
                
                circles.append(DxfCircleEntity(
                    center_x=center.x,
                    center_y=center.y,
                    radius=radius,
                    layer=entity.dxf.layer
                ))
            except Exception:
                continue
        
        return circles
    
    def extract_inserts(self, skip_title_block: bool = True) -> List[DxfInsertEntity]:
        """Extract INSERT (block reference) entities"""
        inserts = []
        
        for entity in self.modelspace.query('INSERT'):
            try:
                insert_point = entity.dxf.insert
                
                if skip_title_block and self.is_in_title_block(insert_point.x):
                    continue
                
                # Try compute bbox (bisa gagal jika block reference broken)
                try:
                    block_bbox = entity.bbox()
                    entity_bbox = {
                        'x_min': block_bbox.extmin.x,
                        'y_min': block_bbox.extmin.y,
                        'x_max': block_bbox.extmax.x,
                        'y_max': block_bbox.extmax.y
                    }
                except Exception:
                    entity_bbox = None
                
                inserts.append(DxfInsertEntity(
                    block_name=entity.dxf.name,
                    insert_x=insert_point.x,
                    insert_y=insert_point.y,
                    layer=entity.dxf.layer,
                    bbox=entity_bbox
                ))
            except Exception:
                continue
        
        return inserts
    
    def parse(self) -> Dict:
        """
        Main parsing function
        
        Returns:
            Dict dengan keys:
            - extents
            - texts (after vertical grouping)
            - circles
            - inserts
            - stats
        """
        texts_raw = self.extract_text_entities(skip_title_block=True)
        texts_grouped = self.group_vertical_texts(texts_raw)
        circles = self.extract_circles()
        inserts = self.extract_inserts()
        
        return {
            'extents': self.extents,
            'texts': [
                {
                    'text': t.text,
                    'x': t.x,
                    'y': t.y,
                    'height': t.height,
                    'width': t.width,
                    'layer': t.layer,
                    'bbox': t.bbox
                }
                for t in texts_grouped
            ],
            'circles': [
                {
                    'center_x': c.center_x,
                    'center_y': c.center_y,
                    'radius': c.radius,
                    'layer': c.layer
                }
                for c in circles
            ],
            'inserts': [
                {
                    'block_name': i.block_name,
                    'insert_x': i.insert_x,
                    'insert_y': i.insert_y,
                    'layer': i.layer,
                    'bbox': i.bbox
                }
                for i in inserts
            ],
            'stats': {
                'total_texts_raw': len(texts_raw),
                'total_texts_grouped': len(texts_grouped),
                'total_circles': len(circles),
                'total_inserts': len(inserts)
            }
        }
