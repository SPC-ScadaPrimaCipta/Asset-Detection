"""
Start service on alternate port (8766) if 8765 is occupied
"""
from api_service import app
import uvicorn

if __name__ == "__main__":
    print("=" * 60)
    print("  TagFlow Python Service - Port 8766 (Alternate)")
    print("=" * 60)
    print("\nStarting on http://127.0.0.1:8766")
    print("Update TypeScript to use port 8766 if needed:")
    print("  lib/detection/multi-source/yolo-tiled-detector.ts")
    print("  Line ~140: http://127.0.0.1:8766/yolo-detect")
    print("\n")
    
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8766,  # Alternate port
        log_level="info"
    )
