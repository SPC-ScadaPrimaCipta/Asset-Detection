#!/usr/bin/env python3
"""
Comprehensive System Check - All Components
"""
import subprocess
import socket
from pathlib import Path
import sys

class Color:
    GREEN = '\033[92m'
    RED = '\033[91m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    END = '\033[0m'
    BOLD = '\033[1m'

def check(name, condition, details=""):
    icon = f"{Color.GREEN}[OK]{Color.END}" if condition else f"{Color.RED}[FAIL]{Color.END}"
    print(f"{icon} {name}")
    if details:
        print(f"     {details}")
    return condition

def check_port(port, name):
    """Check if port is listening"""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.settimeout(1)
    result = sock.connect_ex(('127.0.0.1', port))
    sock.close()
    return check(f"Port {port} ({name})", result == 0, f"localhost:{port}")

def check_file(path, name):
    """Check if file exists"""
    p = Path(path)
    exists = p.exists()
    size = ""
    if exists and p.is_file():
        size_mb = p.stat().st_size / 1024 / 1024
        size = f"{size_mb:.1f} MB" if size_mb > 1 else f"{p.stat().st_size / 1024:.1f} KB"
    return check(name, exists, f"{path} ({size})" if size else path)

def check_python_package(package):
    """Check if Python package is installed"""
    try:
        __import__(package.replace('-', '_'))
        return check(f"Python: {package}", True)
    except ImportError:
        return check(f"Python: {package}", False, "Not installed")

def check_node_module(module):
    """Check if node_modules exists"""
    p = Path('node_modules') / module
    return check(f"Node: {module}", p.exists())

def main():
    print(f"\n{Color.BOLD}{'='*70}{Color.END}")
    print(f"{Color.BOLD}  TagFlow - Comprehensive System Check{Color.END}")
    print(f"{Color.BOLD}{'='*70}{Color.END}\n")
    
    results = []
    
    # Section 1: Critical Files
    print(f"{Color.BLUE}[1/8] Critical Files{Color.END}")
    results.append(check_file("model/yolo-pid.onnx", "YOLO Model (ONNX)"))
    results.append(check_file("workers/python/api_service.py", "Python API Service"))
    results.append(check_file("workers/python/config.py", "Python Config"))
    results.append(check_file("workers/python/detection_worker.py", "Detection Worker"))
    results.append(check_file("workers/python/requirements.txt", "Python Requirements"))
    results.append(check_file("package.json", "Package.json"))
    results.append(check_file(".env.local", "Environment Config"))
    print()
    
    # Section 2: Python Dependencies
    print(f"{Color.BLUE}[2/8] Python Packages{Color.END}")
    packages = ['fastapi', 'uvicorn', 'ultralytics', 'open_clip', 'cv2', 
                'psycopg2', 'scipy', 'ezdxf', 'pydantic_settings']
    for pkg in packages:
        results.append(check_python_package(pkg))
    print()
    
    # Section 3: Node Modules
    print(f"{Color.BLUE}[3/8] Node Modules{Color.END}")
    results.append(check_node_module('next'))
    results.append(check_node_module('react'))
    results.append(check_node_module('bullmq'))
    results.append(check_node_module('ioredis'))
    print()
    
    # Section 4: Ports & Services
    print(f"{Color.BLUE}[4/8] Running Services{Color.END}")
    results.append(check_port(5432, "PostgreSQL"))
    results.append(check_port(6379, "Redis"))
    
    # Check if Next.js is running
    port_3000 = check_port(3000, "Next.js Dev")
    if port_3000:
        print(f"     {Color.YELLOW}Next.js already running - skip 'npm run dev'{Color.END}")
    results.append(port_3000)
    
    # Check if Python service is running
    port_8765 = check_port(8765, "Python Service")
    if not port_8765:
        print(f"     {Color.YELLOW}Python service not running - start it first{Color.END}")
    results.append(port_8765)
    print()
    
    # Section 5: Python Service Test
    print(f"{Color.BLUE}[5/8] Python Service Test{Color.END}")
    try:
        sys.path.insert(0, 'workers/python')
        from api_service import app
        from config import config
        results.append(check("Python Service Import", True, 
                           f"Model path: {config.YOLO_MODEL_PATH.name}"))
    except Exception as e:
        results.append(check("Python Service Import", False, str(e)))
    print()
    
    # Section 6: Database Tables
    print(f"{Color.BLUE}[6/8] Database Schema{Color.END}")
    try:
        import psycopg2
        import os
        from urllib.parse import urlparse
        
        db_url = os.getenv('DATABASE_URL', 'postgresql://postgres:password@localhost:5432/asset_detection')
        parsed = urlparse(db_url)
        
        conn = psycopg2.connect(
            host=parsed.hostname,
            port=parsed.port or 5432,
            database=parsed.path.lstrip('/'),
            user=parsed.username,
            password=parsed.password
        )
        cur = conn.cursor()
        
        # Check critical tables
        tables = ['detections', 'assets', 'legend_symbols', 'asset_training_embeddings']
        for table in tables:
            cur.execute(f"SELECT EXISTS (SELECT FROM pg_tables WHERE tablename = '{table}')")
            exists = cur.fetchone()[0]
            results.append(check(f"Table: {table}", exists))
        
        # Check pgvector extension
        cur.execute("SELECT EXISTS (SELECT FROM pg_extension WHERE extname = 'vector')")
        has_pgvector = cur.fetchone()[0]
        results.append(check("pgvector Extension", has_pgvector))
        
        cur.close()
        conn.close()
    except Exception as e:
        results.append(check("Database Connection", False, str(e)))
    print()
    
    # Section 7: Startup Scripts
    print(f"{Color.BLUE}[7/8] Helper Scripts{Color.END}")
    results.append(check_file("START_ALL_SERVICES.bat", "Auto-Start Script"))
    results.append(check_file("verify_services.py", "Verification Script"))
    results.append(check_file("test/e2e_hybrid_detection.py", "E2E Test"))
    print()
    
    # Section 8: Documentation
    print(f"{Color.BLUE}[8/8] Documentation{Color.END}")
    results.append(check_file("SYSTEM_READY_REPORT.md", "System Report"))
    results.append(check_file("START_INSTRUCTIONS.md", "Start Instructions"))
    results.append(check_file("workers/python/README.md", "Python Workers README"))
    print()
    
    # Summary
    print(f"{Color.BOLD}{'='*70}{Color.END}")
    passed = sum(1 for r in results if r)
    total = len(results)
    percentage = (passed / total * 100) if total > 0 else 0
    
    if percentage >= 90:
        color = Color.GREEN
        status = "EXCELLENT"
    elif percentage >= 75:
        color = Color.YELLOW
        status = "GOOD"
    else:
        color = Color.RED
        status = "NEEDS ATTENTION"
    
    print(f"{color}{Color.BOLD}Status: {status} ({passed}/{total} checks passed - {percentage:.0f}%){Color.END}")
    print(f"{Color.BOLD}{'='*70}{Color.END}\n")
    
    # Instructions
    if not port_8765:
        print(f"{Color.YELLOW}Next Steps:{Color.END}")
        print("  1. Start Python service:")
        print("     cd workers/python && python api_service.py")
        print()
    
    if not port_3000:
        print("  2. Start Next.js:")
        print("     npm run dev")
        print()
        print("  3. Start BullMQ Worker:")
        print("     npm run worker")
        print()
    
    if port_8765 and port_3000:
        print(f"{Color.GREEN}All services running!{Color.END}")
        print(f"Access: {Color.BOLD}http://localhost:3000{Color.END}")
        print()
    
    return 0 if percentage >= 90 else 1

if __name__ == "__main__":
    sys.exit(main())
