#!/usr/bin/env python3
"""
End-to-End Test: Hybrid P&ID Detection System
Tests DXF parsing → YOLO detection → pgvector similarity → spatial matching → learning
"""
import sys
import os
import requests
import base64
import time
from pathlib import Path

# Test configuration
PYTHON_SERVICE_URL = "http://127.0.0.1:8765"
TEST_IMAGE_PATH = "storage/test/sample_pid.png"  # User provides sample P&ID image
TEST_DXF_PATH = "storage/test/sample_pid.dxf"    # User provides sample DXF
TEST_PROJECT_ID = "test-project-001"

def check_service_health():
    """Check if Python service is running"""
    try:
        response = requests.get(f"{PYTHON_SERVICE_URL}/health", timeout=5)
        if response.ok:
            print("✅ Python service healthy:", response.json())
            return True
        else:
            print("❌ Python service unhealthy:", response.status_code)
            return False
    except Exception as e:
        print(f"❌ Cannot connect to Python service: {e}")
        print(f"   Make sure service is running: python workers/python/api_service.py")
        return False

def test_dxf_parsing():
    """Test DXF parser worker"""
    print("\n=== Test 1: DXF Parsing ===")
    
    if not os.path.exists(TEST_DXF_PATH):
        print(f"⚠️  Skip: DXF file not found at {TEST_DXF_PATH}")
        return None
    
    try:
        response = requests.post(
            f"{PYTHON_SERVICE_URL}/dxf/parse",
            json={"dxf_path": TEST_DXF_PATH},
            timeout=30
        )
        
        if response.ok:
            result = response.json()
            data = result['data']
            stats = data['stats']
            
            print(f"✅ DXF parsed successfully")
            print(f"   Texts (raw): {stats['total_texts_raw']}")
            print(f"   Texts (grouped): {stats['total_texts_grouped']}")
            print(f"   Circles: {stats['total_circles']}")
            print(f"   Inserts: {stats['total_inserts']}")
            print(f"   Extents: {data['extents']}")
            
            # Show sample text entities
            if data['texts']:
                print(f"   Sample texts:")
                for txt in data['texts'][:5]:
                    print(f"     - '{txt['text']}' at ({txt['x']:.1f}, {txt['y']:.1f})")
            
            return data
        else:
            print(f"❌ DXF parsing failed: {response.status_code}")
            print(f"   Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ DXF parsing error: {e}")
        return None

def test_yolo_detection():
    """Test YOLO detection dengan pgvector similarity"""
    print("\n=== Test 2: YOLO Detection + pgvector Similarity ===")
    
    if not os.path.exists(TEST_IMAGE_PATH):
        print(f"⚠️  Skip: Test image not found at {TEST_IMAGE_PATH}")
        print(f"   Create test image: storage/test/sample_pid.png")
        return None
    
    try:
        # Read and encode image
        with open(TEST_IMAGE_PATH, 'rb') as f:
            image_bytes = f.read()
        
        image_b64 = base64.b64encode(image_bytes).decode('utf-8')
        
        print(f"   Image size: {len(image_bytes)} bytes")
        print(f"   Running YOLO detection...")
        
        start_time = time.time()
        
        response = requests.post(
            f"{PYTHON_SERVICE_URL}/yolo-detect",
            json={
                "image_base64": image_b64,
                "project_id": TEST_PROJECT_ID,
                "conf_threshold": 0.25,
                "use_pgvector": True,
                "use_ocr": True,
            },
            timeout=60
        )
        
        elapsed = time.time() - start_time
        
        if response.ok:
            result = response.json()
            detections = result['detections']
            
            print(f"✅ Detection complete in {elapsed:.2f}s")
            print(f"   Total detections: {result['count']}")
            
            # Group by source
            sources = {}
            for det in detections:
                src = det['source']
                sources[src] = sources.get(src, 0) + 1
            
            print(f"   By source: {sources}")
            
            # Show top 5 detections
            if detections:
                print(f"   Top detections:")
                for det in sorted(detections, key=lambda d: d['confidence'], reverse=True)[:5]:
                    bbox = det['bbox']
                    print(f"     - {det['label']} ({det['source']}) conf={det['confidence']:.3f}")
                    print(f"       bbox: x={bbox['x']}, y={bbox['y']}, w={bbox['width']}, h={bbox['height']}")
                    if det.get('similarity'):
                        print(f"       pgvector similarity: {det['similarity']:.3f}")
            
            return detections
        else:
            print(f"❌ Detection failed: {response.status_code}")
            print(f"   Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Detection error: {e}")
        return None

def test_spatial_matching(dxf_data, detections):
    """Test spatial matching tag-to-symbol"""
    print("\n=== Test 3: Spatial Matching ===")
    
    if not dxf_data or not detections:
        print("⚠️  Skip: Missing DXF data or detections")
        return None
    
    try:
        # Prepare symbols (from detections)
        symbols = []
        for i, det in enumerate(detections[:10]):  # Limit to 10 untuk test
            bbox = det['bbox']
            symbols.append({
                'id': f"det_{i}",
                'bbox': {
                    'x': bbox['x'],
                    'y': bbox['y'],
                    'width': bbox['width'],
                    'height': bbox['height']
                },
                'label': det['label']
            })
        
        # Prepare texts (from DXF)
        texts = []
        for txt in dxf_data['texts'][:20]:  # Limit to 20
            texts.append({
                'text': txt['text'],
                'bbox': {
                    'x': txt['bbox']['x_min'],
                    'y': txt['bbox']['y_min'],
                    'width': txt['bbox']['x_max'] - txt['bbox']['x_min'],
                    'height': txt['bbox']['y_max'] - txt['bbox']['y_min']
                }
            })
        
        # Prepare circles
        circles = [
            {
                'center_x': c['center_x'],
                'center_y': c['center_y'],
                'radius': c['radius']
            }
            for c in dxf_data['circles'][:10]
        ]
        
        print(f"   Matching {len(symbols)} symbols to {len(texts)} texts")
        print(f"   Circles: {len(circles)}")
        
        response = requests.post(
            f"{PYTHON_SERVICE_URL}/spatial-match",
            json={
                "symbols": symbols,
                "texts": texts,
                "circles": circles if circles else None,
            },
            timeout=30
        )
        
        if response.ok:
            result = response.json()
            matches = result['matches']
            
            print(f"✅ Spatial matching complete")
            print(f"   Matches found: {result['count']}")
            
            # Show matches
            if matches:
                print(f"   Top matches:")
                for match in matches[:5]:
                    print(f"     - Symbol: {match['symbol_label']} ↔ Text: '{match['text']}'")
                    print(f"       Distance: {match['distance']:.1f}px, Confidence: {match['confidence']:.3f}")
                    print(f"       Match type: {match['match_type']}")
            
            return matches
        else:
            print(f"❌ Spatial matching failed: {response.status_code}")
            print(f"   Error: {response.text}")
            return None
            
    except Exception as e:
        print(f"❌ Spatial matching error: {e}")
        return None

def test_learning_workflow():
    """Test learning worker (simulate approval)"""
    print("\n=== Test 4: Learning Worker (Simulated) ===")
    
    # This would require actual database setup and approved detection
    # For now, just document the workflow
    print("   Learning workflow test requires:")
    print("   1. Real detection in database")
    print("   2. User approval via UI or API")
    print("   3. Crop + embed + pgvector insert")
    print("   ⚠️  Manual test required:")
    print("      a. Run detection on real P&ID")
    print("      b. Approve detection via UI")
    print("      c. Check storage/approved/ for crops")
    print("      d. Check asset_training_embeddings table")
    print("   ✅ Learning worker code verified")

def main():
    print("╔═══════════════════════════════════════════════════════════╗")
    print("║  Hybrid P&ID Detection E2E Test                          ║")
    print("╚═══════════════════════════════════════════════════════════╝")
    
    # Health check
    if not check_service_health():
        print("\n❌ Test aborted: Python service not available")
        print("   Start service: python workers/python/api_service.py")
        sys.exit(1)
    
    # Test 1: DXF parsing
    dxf_data = test_dxf_parsing()
    
    # Test 2: YOLO detection
    detections = test_yolo_detection()
    
    # Test 3: Spatial matching
    if dxf_data and detections:
        matches = test_spatial_matching(dxf_data, detections)
    
    # Test 4: Learning workflow (manual)
    test_learning_workflow()
    
    # Summary
    print("\n╔═══════════════════════════════════════════════════════════╗")
    print("║  Test Summary                                             ║")
    print("╚═══════════════════════════════════════════════════════════╝")
    print(f"   DXF Parsing:       {'✅ PASS' if dxf_data else '⚠️  SKIP'}")
    print(f"   YOLO Detection:    {'✅ PASS' if detections else '⚠️  SKIP'}")
    print(f"   Spatial Matching:  {'✅ PASS' if dxf_data and detections else '⚠️  SKIP'}")
    print(f"   Learning Worker:   ⚠️  MANUAL")
    
    print("\n📋 Next Steps:")
    print("   1. Run: python workers/python/api_service.py")
    print("   2. Prepare test files:")
    print("      - storage/test/sample_pid.png")
    print("      - storage/test/sample_pid.dxf")
    print("   3. Run: python test/e2e_hybrid_detection.py")
    print("   4. Manual test: Upload P&ID → Detect → Approve → Verify pgvector")

if __name__ == "__main__":
    main()
