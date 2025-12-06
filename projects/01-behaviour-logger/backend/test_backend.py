#!/usr/bin/env python3
"""Quick test script to verify backend is working."""

import requests
import json

API_BASE = "http://127.0.0.1:5000"

def test_backend():
    print("Testing Truman Behaviour Lab Backend...")
    print(f"API Base: {API_BASE}\n")
    
    # Test health endpoint
    print("1. Testing /health endpoint...")
    try:
        res = requests.get(f"{API_BASE}/health", timeout=2)
        print(f"   Status: {res.status_code}")
        print(f"   Response: {res.json()}")
    except requests.exceptions.ConnectionError:
        print("   ❌ ERROR: Cannot connect to backend!")
        print("   → Make sure Flask backend is running: python app.py")
        return False
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False
    
    # Test admin summary endpoint
    print("\n2. Testing /admin/summary endpoint...")
    try:
        res = requests.get(f"{API_BASE}/admin/summary", timeout=5)
        print(f"   Status: {res.status_code}")
        data = res.json()
        print(f"   Users found: {len(data.get('users', []))}")
        if data.get('users'):
            print("   Users:", [u['user_id'] for u in data['users']])
        else:
            print("   ⚠️  No users found - database might be empty")
            print("   → Try logging in as user1-user5 in the feed to generate events")
    except Exception as e:
        print(f"   ❌ ERROR: {e}")
        return False
    
    print("\n✅ Backend is running!")
    return True

if __name__ == "__main__":
    test_backend()

