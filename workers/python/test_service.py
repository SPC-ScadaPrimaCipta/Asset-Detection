"""
Minimal Test Service - Health check only (no YOLO model required)
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="TagFlow Python Detection Service (Test Mode)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    """Health check"""
    return {
        "status": "ok",
        "service": "TagFlow Python Workers",
        "mode": "test",
        "message": "YOLO model not loaded - health check only"
    }

if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("  TagFlow Python Service - TEST MODE")
    print("  Health endpoint only (YOLO model not required)")
    print("=" * 60)
    uvicorn.run(
        app,
        host="127.0.0.1",
        port=8765,
        log_level="info"
    )
