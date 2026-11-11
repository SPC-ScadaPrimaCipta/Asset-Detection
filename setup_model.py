#!/usr/bin/env python3
"""
Auto-setup script untuk download YOLO model
"""
import os
import sys
from pathlib import Path

def setup_yolo_model():
    """Download dan setup YOLO model"""
    
    print("=" * 60)
    print("  TagFlow Python Service - Model Setup")
    print("=" * 60)
    print()
    
    # Check models directory
    models_dir = Path("models")
    model_path = models_dir / "best.pt"
    
    if model_path.exists():
        print(f"✅ Model already exists: {model_path}")
        print(f"   Size: {model_path.stat().st_size / 1024 / 1024:.1f} MB")
        
        response = input("\n   Download new model? (y/N): ").strip().lower()
        if response != 'y':
            print("\n✅ Using existing model")
            return True
    
    # Create models directory
    models_dir.mkdir(exist_ok=True)
    print(f"📁 Created directory: {models_dir}")
    
    # Download YOLO model
    print("\n📥 Downloading YOLOv8 nano model...")
    print("   (This may take a few minutes on first run)")
    
    try:
        from ultralytics import YOLO
        
        # Download YOLOv8n (smallest, fastest for testing)
        print("\n   Loading YOLOv8n.pt...")
        model = YOLO('yolov8n.pt')  # Auto-downloads from Ultralytics
        
        # Copy to expected location
        import shutil
        yolov8n_path = Path('yolov8n.pt')
        if yolov8n_path.exists():
            shutil.copy(yolov8n_path, model_path)
            print(f"\n✅ Model installed: {model_path}")
            print(f"   Size: {model_path.stat().st_size / 1024 / 1024:.1f} MB")
        else:
            print("\n❌ Download failed: yolov8n.pt not found")
            return False
            
    except ImportError:
        print("\n❌ ultralytics not installed")
        print("   Run: pip install ultralytics")
        return False
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return False
    
    print("\n" + "=" * 60)
    print("  Setup Complete!")
    print("=" * 60)
    print("\nNext steps:")
    print("  1. Start service: python workers/python/api_service.py")
    print("  2. Test health: curl http://127.0.0.1:8765/health")
    print("  3. Run E2E test: python test/e2e_hybrid_detection.py")
    print()
    
    return True

if __name__ == "__main__":
    # Change to project root
    script_dir = Path(__file__).parent
    os.chdir(script_dir)
    
    success = setup_yolo_model()
    sys.exit(0 if success else 1)
