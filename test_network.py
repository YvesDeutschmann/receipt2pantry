#!/usr/bin/env python3
"""
Simple Network Test

Test basic network connectivity and browser functionality
"""

import time
from playwright.sync_api import sync_playwright
from rich.console import Console

console = Console()

def test_network():
    """Test network connectivity"""
    console.print("[bold blue]Testing Network Connectivity[/bold blue]")
    
    playwright = sync_playwright().start()
    
    try:
        browser = playwright.chromium.launch(headless=False)
        context = browser.new_context()
        page = context.new_page()
        
        # Test 1: Simple site
        console.print("Test 1: Loading httpbin.org...")
        try:
            page.goto("https://httpbin.org/get", timeout=10000)
            title = page.title()
            console.print(f"✅ httpbin.org loaded: {title}")
        except Exception as e:
            console.print(f"❌ httpbin.org failed: {e}")
        
        # Test 2: Google
        console.print("Test 2: Loading google.com...")
        try:
            page.goto("https://google.com", timeout=10000)
            title = page.title()
            console.print(f"✅ Google loaded: {title}")
        except Exception as e:
            console.print(f"❌ Google failed: {e}")
        
        # Test 3: Safeway
        console.print("Test 3: Loading safeway.com...")
        try:
            page.goto("https://safeway.com", timeout=15000)
            title = page.title()
            console.print(f"✅ Safeway loaded: {title}")
            
            # Take screenshot
            page.screenshot(path="safeway_test.png")
            console.print("Screenshot saved: safeway_test.png")
            
        except Exception as e:
            console.print(f"❌ Safeway failed: {e}")
        
        browser.close()
        
    except Exception as e:
        console.print(f"❌ Browser test failed: {e}")
    
    finally:
        playwright.stop()

if __name__ == "__main__":
    test_network()
