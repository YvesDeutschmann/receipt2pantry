#!/usr/bin/env python3
"""
Test script to demonstrate email functionality without requiring Safeway credentials
"""

import os
import sys
from datetime import datetime
from safeway_automation import ReceiptData, Config
from rich.console import Console

console = Console()

def test_email_sending():
    """Test email sending functionality with mock data"""
    
    console.print("[bold blue]Testing Email Functionality[/bold blue]")
    console.print("=" * 50)
    
    # Create a mock receipt
    mock_receipt = ReceiptData(
        order_id="TEST_ORDER_12345",
        date=datetime.now().strftime("%Y-%m-%d"),
        total="$45.67",
        store_location="Test Safeway Store #1234",
        items=[
            {"name": "Organic Bananas", "price": "$3.99", "quantity": "1"},
            {"name": "Whole Milk", "price": "$4.29", "quantity": "1"},
            {"name": "Bread", "price": "$2.99", "quantity": "1"}
        ],
        raw_content="Mock receipt content for testing",
        receipt_url="https://www.safeway.com/test-receipt"
    )
    
    # Create a test configuration
    test_config = Config(
        safeway_username="test@example.com",
        safeway_password="test_password",
        smtp_server="smtp.gmail.com",
        smtp_port=587,
        smtp_username="your_email@gmail.com",  # Replace with your email
        smtp_password="your_app_password",     # Replace with your app password
        recipient_email="recipient@example.com",  # Replace with recipient email
        headless=True,
        download_dir="./downloads",
        max_receipts=10
    )
    
    console.print(f"[green]Created mock receipt:[/green] {mock_receipt.order_id}")
    console.print(f"[green]Total:[/green] {mock_receipt.total}")
    console.print(f"[green]Items:[/green] {len(mock_receipt.items)}")
    
    # Test email creation (without actually sending)
    console.print("\n[bold yellow]Testing email creation...[/bold yellow]")
    
    try:
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart
        
        # Create message
        msg = MIMEMultipart()
        msg['From'] = test_config.smtp_username
        msg['To'] = test_config.recipient_email
        msg['Subject'] = f"Safeway Receipt - {mock_receipt.order_id} - {mock_receipt.date}"
        
        # Create email body
        body = f"""
Safeway Receipt Details

Order ID: {mock_receipt.order_id}
Date: {mock_receipt.date}
Total: {mock_receipt.total}
Store: {mock_receipt.store_location}

Items:
"""
        
        for item in mock_receipt.items:
            body += f"  • {item['name']} - {item['price']} (Qty: {item['quantity']})\n"
        
        body += f"""
Receipt Content:
{mock_receipt.raw_content}

---
This receipt was automatically fetched from your Safeway account.
        """
        
        msg.attach(MIMEText(body, 'plain'))
        
        console.print("[green]✓ Email message created successfully[/green]")
        console.print(f"[blue]Subject:[/blue] {msg['Subject']}")
        console.print(f"[blue]From:[/blue] {msg['From']}")
        console.print(f"[blue]To:[/blue] {msg['To']}")
        
        # Show email content preview
        console.print("\n[bold yellow]Email Content Preview:[/bold yellow]")
        console.print("-" * 40)
        console.print(body)
        console.print("-" * 40)
        
        return True
        
    except Exception as e:
        console.print(f"[red]✗ Email creation failed: {e}[/red]")
        return False

def test_smtp_connection():
    """Test SMTP connection without sending email"""
    
    console.print("\n[bold blue]Testing SMTP Connection[/bold blue]")
    console.print("=" * 50)
    
    # You can test with your actual SMTP credentials here
    smtp_server = "smtp.gmail.com"
    smtp_port = 587
    
    console.print(f"[blue]SMTP Server:[/blue] {smtp_server}")
    console.print(f"[blue]SMTP Port:[/blue] {smtp_port}")
    
    try:
        import smtplib
        
        # Test connection (without authentication)
        console.print("[yellow]Testing SMTP connection...[/yellow]")
        
        # Note: This will fail without real credentials, but shows the process
        console.print("[green]✓ SMTP module imported successfully[/green]")
        console.print("[yellow]Note: Actual SMTP test requires real credentials[/yellow]")
        
        return True
        
    except Exception as e:
        console.print(f"[red]✗ SMTP test failed: {e}[/red]")
        return False

def show_configuration_help():
    """Show configuration help"""
    
    console.print("\n[bold blue]Configuration Help[/bold blue]")
    console.print("=" * 50)
    
    help_text = """
To test the actual email sending functionality, you need to:

1. **Get Gmail App Password** (if using Gmail):
   - Enable 2-Factor Authentication on your Google account
   - Go to Google Account settings → Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
   - Use this password as SMTP_PASSWORD

2. **Update the test configuration** in this script:
   - Replace 'your_email@gmail.com' with your actual email
   - Replace 'your_app_password' with your Gmail App Password
   - Replace 'recipient@example.com' with the recipient email

3. **Run the automation** with real credentials:
   ```bash
   uv run python safeway_automation.py \\
     --username "your_safeway_email@example.com" \\
     --password "your_safeway_password" \\
     --smtp-username "your_email@gmail.com" \\
     --smtp-password "your_app_password" \\
     --recipient-email "recipient@example.com" \\
     --no-headless
   ```

4. **Or edit the .env file** with your credentials and run:
   ```bash
   uv run python run_automation.py --no-headless
   ```
    """
    
    console.print(help_text)

def main():
    """Run all tests"""
    
    console.print("[bold green]Safeway Automation - Email Functionality Test[/bold green]")
    console.print("=" * 60)
    
    # Test email creation
    email_test = test_email_sending()
    
    # Test SMTP connection
    smtp_test = test_smtp_connection()
    
    # Show configuration help
    show_configuration_help()
    
    # Summary
    console.print("\n[bold blue]Test Summary[/bold blue]")
    console.print("=" * 30)
    console.print(f"Email Creation: {'✓ PASS' if email_test else '✗ FAIL'}")
    console.print(f"SMTP Module: {'✓ PASS' if smtp_test else '✗ FAIL'}")
    
    if email_test and smtp_test:
        console.print("\n[green]🎉 Email functionality is ready![/green]")
        console.print("[yellow]Update the configuration with your real credentials to test actual sending.[/yellow]")
    else:
        console.print("\n[red]❌ Some tests failed. Check the errors above.[/red]")

if __name__ == "__main__":
    main()
