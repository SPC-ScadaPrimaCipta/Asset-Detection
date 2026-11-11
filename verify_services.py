#!/usr/bin/env python3
"""
Auto-verify semua services dan test basic functionality
"""
import requests
import time
import sys
from pathlib import Path

def test_python_service():
    """Test Python FastAPI service"""
    print("\n" + "="*60)
    print("TEST 1: Python FastAPI Service")
    print("="*60)
    
    max_retries = 10
    for i in range(max_retries):
        try:
            response = requests.get("http://127.0.0.1:8765/health", timeout=2)
            if response.ok:
                data = response.json()
                print(f"✅ Python service healthy")
                print(f"   Status: {data.get('status')}")
                print(f"   Service: {data.get('service')}")
                return True
            else:
                print(f"❌ Service returned {response.status_code}")
                return False
        except requests.exceptions.ConnectionError:
            if i < max_retries - 1:
                print(f"   Waiting for service... ({i+1}/{max_retries})")
                time.sleep(2)
            else:
                print(f"❌ Cannot connect to Python service after {max_retries} retries")
                print(f"   Make sure: python workers/python/api_service.py is running")
                return False
        except Exception as e:
            print(f"❌ Error: {e}")
            return False

def test_nextjs_service():
    """Test Next.js dev server"""
    print("\n" + "="*60)
    print("TEST 2: Next.js Dev Server")
    print("="*60)
    
    max_retries = 5
    for i in range(max_retries):
        try:
            response = requests.get("http://localhost:3000", timeout=5)
            if response.ok or response.status_code == 404:  # 404 ok for root
                print(f"✅ Next.js server responding")
                print(f"   Status: {response.status_code}")
                return True
            else:
                print(f"⚠️  Server returned {response.status_code}")
                return True  # Still running
        except requests.exceptions.ConnectionError:
            if i < max_retries - 1:
                print(f"   Waiting for Next.js... ({i+1}/{max_retries})")
                time.sleep(3)
            else:
                print(f"❌ Cannot connect to Next.js after {max_retries} retries")
                print(f"   Make sure: npm run dev is running")
                return False
        except Exception as e:
            print(f"❌ Error: {e}")
            return False

def test_model_file():
    """Test YOLO model file exists"""
    print("\n" + "="*60)
    print("TEST 3: YOLO Model File")
    print("="*60)
    
    model_path = Path("model/yolo-pid.onnx")
    if model_path.exists():
        size_mb = model_path.stat().st_size / 1024 / 1024
        print(f"✅ Model file found")
        print(f"   Path: {model_path}")
        print(f"   Size: {size_mb:.1f} MB")
        return True
    else:
        print(f"❌ Model file NOT found")
        print(f"   Expected: {model_path.absolute()}")
        return False

def test_database():
    """Test database connection"""
    print("\n" + "="*60)
    print("TEST 4: PostgreSQL Database")
    print("="*60)
    
    try:
        import psycopg2
        import os
        
        db_url = os.getenv("DATABASE_URL", "postgresql://postgres:password@localhost:5432/asset_detection")
        
        # Parse connection string (simple parse)
        if db_url.startswith("postgresql://"):
            db_url = db_url.replace("postgresql://", "")
            if "@" in db_url:
                auth, host_db = db_url.split("@")
                user, password = auth.split(":")
                host_port, dbname = host_db.split("/")
                if ":" in host_port:
                    host, port = host_port.split(":")
                else:
                    host, port = host_port, "5432"
                
                conn = psycopg2.connect(
                    host=host,
                    port=port,
                    database=dbname,
                    user=user,
                    password=password
                )
                
                cur = conn.cursor()
                cur.execute("SELECT version();")
                version = cur.fetchone()[0]
                cur.close()
                conn.close()
                
                print(f"✅ Database connected")
                print(f"   Version: {version.split(',')[0]}")
                return True
    except ImportError:
        print(f"⚠️  psycopg2 not installed (optional for test)")
        return True  # Not critical for startup
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print(f"   This won't block Python service, but detection won't work")
        return False

def test_redis():
    """Test Redis connection"""
    print("\n" + "="*60)
    print("TEST 5: Redis (BullMQ)")
    print("="*60)
    
    try:
        import redis
        r = redis.Redis(host='localhost', port=6379, socket_connect_timeout=2)
        r.ping()
        print(f"✅ Redis connected")
        return True
    except ImportError:
        print(f"⚠️  redis-py not installed (optional for test)")
        return True
    except Exception as e:
        print(f"❌ Redis connection failed: {e}")
        print(f"   Make sure Redis is running for BullMQ worker")
        return False

def main():
    print("╔" + "="*58 + "╗")
    print("║" + " "*15 + "TagFlow System Verification" + " "*15 + "║")
    print("╚" + "="*58 + "╝")
    
    results = {
        "Python Service": test_python_service(),
        "Next.js Server": test_nextjs_service(),
        "YOLO Model": test_model_file(),
        "Database": test_database(),
        "Redis": test_redis(),
    }
    
    # Summary
    print("\n" + "="*60)
    print("SUMMARY")
    print("="*60)
    
    passed = sum(1 for v in results.values() if v)
    total = len(results)
    
    for name, status in results.items():
        icon = "✅" if status else "❌"
        print(f"{icon} {name}")
    
    print("\n" + "="*60)
    print(f"Results: {passed}/{total} tests passed")
    print("="*60)
    
    if passed == total:
        print("\n✅ ALL SYSTEMS READY")
        print("\nNext steps:")
        print("  1. Open browser: http://localhost:3000")
        print("  2. Upload P&ID document")
        print("  3. Run detection")
        return 0
    else:
        print("\n⚠️  SOME TESTS FAILED")
        print("\nCheck terminal windows for error messages")
        print("Services may still work partially")
        return 1

if __name__ == "__main__":
    sys.exit(main())
