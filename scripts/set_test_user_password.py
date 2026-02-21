#!/usr/bin/env python3
"""
Set password for the test user (test@example.com).

Run this if the test user cannot sign in with test123.
Uses Supabase auth admin API - requires SUPABASE_SERVICE_ROLE_KEY.
"""

import os
import sys

project_root = os.path.join(os.path.dirname(__file__), '..')
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(os.path.join(project_root, '.env'))

from supabase import create_client

TEST_USER_ID = "00000000-0000-0000-0000-000000000001"
TEST_PASSWORD = "test123"

def main():
    url = os.getenv("SUPABASE_URL")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not service_key:
        print("❌ Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env")
        sys.exit(1)

    client = create_client(url, service_key)
    try:
        resp = client.auth.admin.update_user_by_id(TEST_USER_ID, {"password": TEST_PASSWORD})
        print("✅ Test user password set successfully")
        print(f"   Email: test@example.com")
        print(f"   Password: {TEST_PASSWORD}")
    except Exception as e:
        print(f"❌ Failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
