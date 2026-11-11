"""
OCR Utils: Tesseract wrapper untuk fallback text detection
Ketika DXF TEXT entities tidak reliable atau hilang
"""
import pytesseract
import cv2
import numpy as np
from PIL import Image
from typing import List, Dict, Tuple, Optional
from dataclasses import dataclass

@dataclass
class OCRResult:
    """Single OCR detection result"""
    text: str
    confidence: float
    bbox: Dict[str, int]  # {x, y, width, height}

class OCREngine:
    """
    Wrapper untuk Tesseract OCR dengan preprocessing optimized untuk P&ID drawings
    """
    
    def __init__(self, tesseract_cmd: Optional[str] = None, lang: str = "eng"):
        """
        Args:
            tesseract_cmd: Path ke tesseract binary (None = use system PATH)
            lang: Language code ('eng', 'eng+ara' untuk multilingual)
        """
        if tesseract_cmd:
            pytesseract.pytesseract.tesseract_cmd = tesseract_cmd
        self.lang = lang
    
    def preprocess_for_ocr(self, image: np.ndarray) -> np.ndarray:
        """
        Preprocess image untuk improve OCR accuracy pada technical drawings
        
        P&ID characteristics:
        - Black text pada white/light background
        - Thin lines dan small fonts
        - High contrast needed
        """
        # Convert to grayscale jika color
        if len(image.shape) == 3:
            gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        else:
            gray = image.copy()
        
        # Adaptive thresholding (better untuk varying brightness)
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 11, 2
        )
        
        # Denoise dengan morphological operations
        kernel = np.ones((1, 1), np.uint8)
        denoised = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel)
        denoised = cv2.morphologyEx(denoised, cv2.MORPH_OPEN, kernel)
        
        return denoised
    
    def extract_text_regions(
        self, 
        image: np.ndarray,
        min_confidence: float = 60.0,
        preprocess: bool = True
    ) -> List[OCRResult]:
        """
        Extract text regions dengan bounding boxes dari image
        
        Args:
            image: Input image (numpy array)
            min_confidence: Minimum OCR confidence threshold (0-100)
            preprocess: Apply preprocessing untuk improve accuracy
            
        Returns:
            List of OCRResult dengan text, confidence, dan bbox
        """
        # Preprocess jika enabled
        processed = self.preprocess_for_ocr(image) if preprocess else image
        
        # Run Tesseract dengan detailed output
        ocr_data = pytesseract.image_to_data(
            processed, 
            lang=self.lang, 
            output_type=pytesseract.Output.DICT
        )
        
        results = []
        n_boxes = len(ocr_data['text'])
        
        for i in range(n_boxes):
            text = ocr_data['text'][i].strip()
            conf = float(ocr_data['conf'][i])
            
            # Filter: non-empty text, confidence >= threshold
            if text and conf >= min_confidence:
                x = ocr_data['left'][i]
                y = ocr_data['top'][i]
                w = ocr_data['width'][i]
                h = ocr_data['height'][i]
                
                results.append(OCRResult(
                    text=text,
                    confidence=conf / 100.0,  # Normalize ke 0-1
                    bbox={'x': x, 'y': y, 'width': w, 'height': h}
                ))
        
        return results
    
    def extract_tags_only(
        self,
        image: np.ndarray,
        tag_pattern: Optional[str] = r"^[A-Z]{1,6}-\d{2,6}[A-Z]{0,2}$"
    ) -> List[OCRResult]:
        """
        Extract hanya asset tags (filter hasil OCR dengan regex pattern)
        
        Args:
            image: Input image
            tag_pattern: Regex pattern untuk asset tags (None = return semua text)
            
        Returns:
            List of OCRResult yang match tag pattern
        """
        all_results = self.extract_text_regions(image)
        
        if not tag_pattern:
            return all_results
        
        import re
        pattern = re.compile(tag_pattern)
        
        return [r for r in all_results if pattern.match(r.text)]
    
    def ocr_bbox_region(
        self,
        image: np.ndarray,
        bbox: Dict[str, int],
        expand_px: int = 5
    ) -> str:
        """
        OCR specific bbox region (untuk verify/fallback text detection)
        
        Args:
            image: Full image
            bbox: Region to OCR {x, y, width, height}
            expand_px: Expand bbox by N pixels (context padding)
            
        Returns:
            Recognized text string
        """
        h, w = image.shape[:2]
        x1 = max(0, bbox['x'] - expand_px)
        y1 = max(0, bbox['y'] - expand_px)
        x2 = min(w, bbox['x'] + bbox['width'] + expand_px)
        y2 = min(h, bbox['y'] + bbox['height'] + expand_px)
        
        roi = image[y1:y2, x1:x2]
        
        if roi.size == 0:
            return ""
        
        processed = self.preprocess_for_ocr(roi)
        text = pytesseract.image_to_string(processed, lang=self.lang).strip()
        
        return text
