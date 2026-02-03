"""Apply test user migration to Supabase"""

import os
from dotenv import load_dotenv
from supabase import create_client

# Load environment variables
load_dotenv()

# Get Supabase credentials
supabase_url = os.getenv('SUPABASE_URL')
supabase_service_role_key = os.getenv('SUPABASE_SERVICE_ROLE_KEY')

if not supabase_url or not supabase_service_role_key:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")
    exit(1)

# Create Supabase client with service role key (bypasses RLS)
supabase = create_client(supabase_url, supabase_service_role_key)

# Read the migration SQL
with open('supabase/migrations/010_create_test_user.sql', 'r') as f:
    sql = f.read()

print("Applying test user migration...")
print("=" * 60)

try:
    # Execute the SQL
    result = supabase.rpc('exec_sql', {'sql': sql}).execute()
    print("✓ Migration applied successfully!")
    print("\nTest user created:")
    print("  Email: test@example.com")
    print("  User ID: 00000000-0000-0000-0000-000000000001")
    print("  Household ID: 00000000-0000-0000-0000-000000000002")
    print("  Household Name: Test Household")
    print("  Join Code: TEST123")
    
except Exception as e:
    # If RPC method doesn't exist, we need to execute statements individually
    print(f"Note: exec_sql RPC not available, using direct SQL execution")
    print("You'll need to run this SQL manually in the Supabase SQL Editor:")
    print("=" * 60)
    print(sql)
    print("=" * 60)
    print("\nOR, let me try to execute via psycopg2 if you have it installed...")
    
    try:
        import psycopg2
        print("\nAttempting direct database connection...")
        print("You'll need your database connection string from Supabase dashboard.")
        print("Go to: Project Settings > Database > Connection String")
    except ImportError:
        print("\npsycopg2 not installed. Please run the SQL manually in Supabase SQL Editor.")
        print("\nTo access the SQL Editor:")
        print("1. Go to https://supabase.com/dashboard")
        print("2. Select your project")
        print("3. Click 'SQL Editor' in the left sidebar")
        print("4. Paste the SQL above and run it")
