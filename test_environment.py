#!/usr/bin/env python3
"""
Test script to verify the UV environment is set up correctly
"""

import sys
from pathlib import Path

def test_imports():
    """Test that all required modules can be imported"""
    print("Testing imports...")
    
    try:
        import playwright
        print("✓ Playwright")
    except ImportError as e:
        print(f"✗ Playwright import failed: {e}")
        return False
    
    try:
        import dotenv
        print("✓ python-dotenv")
    except ImportError as e:
        print(f"✗ python-dotenv import failed: {e}")
        return False
    
    try:
        import email_validator
        print("✓ email-validator")
    except ImportError as e:
        print(f"✗ email-validator import failed: {e}")
        return False
    
    try:
        import click
        print("✓ click")
    except ImportError as e:
        print(f"✗ click import failed: {e}")
        return False
    
    try:
        import rich
        print("✓ rich")
    except ImportError as e:
        print(f"✗ rich import failed: {e}")
        return False
    
    return True

def test_project_modules():
    """Test that project modules can be imported"""
    print("\nTesting project modules...")
    
    try:
        from parsers.safeway_parser import SafewayReceiptParser, VirtualPantry
        print("✓ SafewayReceiptParser")
        print("✓ VirtualPantry")
    except ImportError as e:
        print(f"✗ Project modules import failed: {e}")
        return False
    
    try:
        from safeway_automation import SafewayAutomation, Config
        print("✓ SafewayAutomation")
        print("✓ Config")
    except ImportError as e:
        print(f"✗ Automation modules import failed: {e}")
        return False
    
    try:
        from config_validator import ConfigValidator
        print("✓ ConfigValidator")
    except ImportError as e:
        print(f"✗ Config validator import failed: {e}")
        return False
    
    return True

def test_playwright_browsers():
    """Test that Playwright browsers are installed"""
    print("\nTesting Playwright browsers...")
    
    try:
        from playwright.sync_api import sync_playwright
        
        with sync_playwright() as p:
            # Try to launch Chromium
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            page.goto("https://example.com")
            title = page.title()
            browser.close()
            
            if "Example Domain" in title:
                print("✓ Chromium browser working")
                return True
            else:
                print(f"✗ Chromium browser test failed: unexpected title '{title}'")
                return False
                
    except Exception as e:
        print(f"✗ Playwright browser test failed: {e}")
        return False

def test_file_structure():
    """Test that required files exist"""
    print("\nTesting file structure...")
    
    required_files = [
        "safeway_automation.py",
        "config_validator.py", 
        "run_automation.py",
        "setup.py",
        "pyproject.toml",
        "README.md",
        "parsers/safeway_parser.py"
    ]
    
    all_exist = True
    for file_path in required_files:
        if Path(file_path).exists():
            print(f"✓ {file_path}")
        else:
            print(f"✗ {file_path} (missing)")
            all_exist = False
    
    return all_exist

def main():
    """Run all tests"""
    print("=" * 60)
    print("SAFEWAY RECEIPT AUTOMATION - ENVIRONMENT TEST")
    print("=" * 60)
    
    print(f"Python version: {sys.version}")
    print(f"Python executable: {sys.executable}")
    print()
    
    tests = [
        ("File Structure", test_file_structure),
        ("External Imports", test_imports),
        ("Project Modules", test_project_modules),
        ("Playwright Browsers", test_playwright_browsers)
    ]
    
    results = []
    for test_name, test_func in tests:
        print(f"\n{'='*20} {test_name} {'='*20}")
        try:
            result = test_func()
            results.append((test_name, result))
        except Exception as e:
            print(f"✗ {test_name} test crashed: {e}")
            results.append((test_name, False))
    
    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = 0
    total = len(results)
    
    for test_name, result in results:
        status = "PASS" if result else "FAIL"
        print(f"{test_name:20} {status}")
        if result:
            passed += 1
    
    print(f"\nPassed: {passed}/{total}")
    
    if passed == total:
        print("\n🎉 All tests passed! Your environment is ready.")
        print("\nNext steps:")
        print("1. Edit .env file with your credentials")
        print("2. Run: uv run python config_validator.py")
        print("3. Run: uv run python run_automation.py")
        return True
    else:
        print(f"\n❌ {total - passed} test(s) failed. Please fix the issues above.")
        return False

if __name__ == "__main__":
    success = main()
    sys.exit(0 if success else 1)
