"""
Spatial Matcher Worker: Tag-to-symbol matching dengan KDTree
"""
import numpy as np
from typing import List, Dict, Optional, Tuple
from scipy.spatial import KDTree
from dataclasses import dataclass

@dataclass
class Symbol:
    """Symbol detection entity"""
    id: str
    bbox: Dict[str, float]  # {x, y, width, height}
    centroid: Tuple[float, float]  # (x, y)
    label: str

@dataclass
class Text:
    """Text/Tag entity"""
    text: str
    bbox: Dict[str, float]
    centroid: Tuple[float, float]

@dataclass
class Match:
    """Matched symbol-text pair"""
    symbol: Symbol
    text: Text
    distance: float
    confidence: float
    match_type: str  # 'inside_circle' | 'nearest_neighbor' | 'line_connected'

class SpatialMatcherWorker:
    """
    Spatial matching strategies:
    1. Inside circle: untuk instrument bubbles (text di dalam circle)
    2. Nearest neighbor: closest text ke symbol centroid
    3. Line connected: check LINE entities connecting symbol-text
    """
    
    def __init__(
        self,
        max_distance_threshold: float = 200.0,  # Max distance untuk match (pixels)
        circle_radius_tolerance: float = 1.2  # Tolerance untuk inside-circle check
    ):
        self.max_distance = max_distance_threshold
        self.circle_tolerance = circle_radius_tolerance
    
    def match_tags_to_symbols(
        self,
        symbols: List[Dict],
        texts: List[Dict],
        circles: Optional[List[Dict]] = None
    ) -> List[Dict]:
        """
        Match texts (asset tags) ke symbols
        
        Args:
            symbols: List of symbol detections
                [{id, bbox: {x,y,w,h}, label}, ...]
            texts: List of text entities
                [{text, bbox: {x,y,w,h}}, ...]
            circles: Optional list of CIRCLE entities dari DXF
                [{center_x, center_y, radius}, ...]
                
        Returns:
            List of matches:
            [{
                'symbol_id': str,
                'symbol_bbox': dict,
                'symbol_label': str,
                'text': str,
                'text_bbox': dict,
                'distance': float,
                'confidence': float,
                'match_type': str
            }]
        """
        if not symbols or not texts:
            return []
        
        # Convert to internal format
        symbol_objs = [
            Symbol(
                id=s.get('id', str(i)),
                bbox=s['bbox'],
                centroid=self._bbox_centroid(s['bbox']),
                label=s['label']
            )
            for i, s in enumerate(symbols)
        ]
        
        text_objs = [
            Text(
                text=t['text'],
                bbox=t['bbox'],
                centroid=self._bbox_centroid(t['bbox'])
            )
            for t in texts
        ]
        
        matches = []
        used_texts = set()
        
        # Strategy 1: Inside circle (for instrument bubbles)
        if circles:
            circle_matches = self._match_inside_circles(
                symbol_objs, text_objs, circles, used_texts
            )
            matches.extend(circle_matches)
        
        # Strategy 2: Nearest neighbor (for equipment)
        nn_matches = self._match_nearest_neighbor(
            symbol_objs, text_objs, used_texts
        )
        matches.extend(nn_matches)
        
        # Convert to dict format
        return [
            {
                'symbol_id': m.symbol.id,
                'symbol_bbox': m.symbol.bbox,
                'symbol_label': m.symbol.label,
                'text': m.text.text,
                'text_bbox': m.text.bbox,
                'distance': m.distance,
                'confidence': m.confidence,
                'match_type': m.match_type
            }
            for m in matches
        ]
    
    def _bbox_centroid(self, bbox: Dict[str, float]) -> Tuple[float, float]:
        """Calculate bbox centroid"""
        return (
            bbox['x'] + bbox['width'] / 2,
            bbox['y'] + bbox['height'] / 2
        )
    
    def _match_inside_circles(
        self,
        symbols: List[Symbol],
        texts: List[Text],
        circles: List[Dict],
        used_texts: set
    ) -> List[Match]:
        """
        Match texts yang berada INSIDE circle radius
        Cocok untuk instrument bubbles (LI-0401 di dalam circle)
        """
        matches = []
        
        for circle in circles:
            cx, cy, radius = circle['center_x'], circle['center_y'], circle['radius']
            
            # Find symbol closest to circle center
            closest_symbol = None
            min_dist = float('inf')
            
            for sym in symbols:
                dist = np.sqrt((sym.centroid[0] - cx)**2 + (sym.centroid[1] - cy)**2)
                if dist < min_dist and dist < radius * 2:  # Within 2× radius
                    min_dist = dist
                    closest_symbol = sym
            
            if not closest_symbol:
                continue
            
            # Find text inside circle
            for i, txt in enumerate(texts):
                if i in used_texts:
                    continue
                
                txt_cx, txt_cy = txt.centroid
                dist = np.sqrt((txt_cx - cx)**2 + (txt_cy - cy)**2)
                
                if dist <= radius * self.circle_tolerance:
                    # Match found
                    matches.append(Match(
                        symbol=closest_symbol,
                        text=txt,
                        distance=dist,
                        confidence=0.95,  # High confidence untuk inside-circle match
                        match_type='inside_circle'
                    ))
                    used_texts.add(i)
                    break  # One text per circle
        
        return matches
    
    def _match_nearest_neighbor(
        self,
        symbols: List[Symbol],
        texts: List[Text],
        used_texts: set
    ) -> List[Match]:
        """
        KDTree-based nearest neighbor matching
        For equipment symbols (Tank, Vessel, Pump, etc.)
        """
        if not texts:
            return []
        
        # Build KDTree dari text centroids (unused only)
        available_texts = [txt for i, txt in enumerate(texts) if i not in used_texts]
        if not available_texts:
            return []
        
        text_centroids = np.array([txt.centroid for txt in available_texts])
        tree = KDTree(text_centroids)
        
        matches = []
        
        for sym in symbols:
            # Query nearest text
            dist, idx = tree.query(sym.centroid, k=1)
            
            if dist > self.max_distance:
                continue
            
            matched_text = available_texts[idx]
            
            # Confidence based on distance (closer = higher)
            # Normalize: distance 0 → conf 0.9, distance max_distance → conf 0.5
            confidence = 0.9 - (dist / self.max_distance) * 0.4
            confidence = max(0.5, min(0.9, confidence))
            
            matches.append(Match(
                symbol=sym,
                text=matched_text,
                distance=float(dist),
                confidence=confidence,
                match_type='nearest_neighbor'
            ))
            
            # Mark text sebagai used
            original_idx = texts.index(matched_text)
            used_texts.add(original_idx)
        
        return matches
    
    def _check_line_connected(
        self,
        symbol: Symbol,
        text: Text,
        lines: List[Dict]
    ) -> bool:
        """
        Check apakah ada LINE entity connecting symbol ke text
        (Optional advanced feature)
        
        Args:
            lines: [{start: (x,y), end: (x,y)}, ...]
            
        Returns:
            True jika ada LINE connecting
        """
        # Simplified: check if any line endpoint dekat dengan symbol/text centroid
        sym_x, sym_y = symbol.centroid
        txt_x, txt_y = text.centroid
        threshold = 50  # pixels
        
        for line in lines:
            sx, sy = line['start']
            ex, ey = line['end']
            
            # Check: line connects symbol centroid to text centroid
            dist_start_sym = np.sqrt((sx - sym_x)**2 + (sy - sym_y)**2)
            dist_end_txt = np.sqrt((ex - txt_x)**2 + (ey - txt_y)**2)
            
            dist_start_txt = np.sqrt((sx - txt_x)**2 + (sy - txt_y)**2)
            dist_end_sym = np.sqrt((ex - sym_x)**2 + (ey - sym_y)**2)
            
            if (dist_start_sym < threshold and dist_end_txt < threshold) or \
               (dist_start_txt < threshold and dist_end_sym < threshold):
                return True
        
        return False
