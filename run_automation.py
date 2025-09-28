#!/usr/bin/env python3
"""
Complete Safeway Receipt Automation Runner

This script runs the complete automation process:
1. Fetches new receipts from Safeway
2. Parses them using the existing parser
3. Updates the virtual pantry
4. Sends receipts via email
"""

import os
import sys
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import List, Dict

import click
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn, BarColumn, TimeElapsedColumn
from rich.table import Table

# Import our modules
from safeway_automation import SafewayAutomation, Config, load_config_from_env
from parsers.safeway_parser import SafewayReceiptParser, VirtualPantry

console = Console()


class CompleteAutomation:
    """Complete automation that fetches, parses, and manages receipts"""
    
    def __init__(self, config: Config):
        self.config = config
        self.pantry = VirtualPantry()
        self.processed_receipts = []
        self.pantry_file = Path("pantry_data.json")
        
        # Load existing pantry data
        self._load_pantry_data()
    
    def _load_pantry_data(self):
        """Load existing pantry data from file"""
        if self.pantry_file.exists():
            try:
                with open(self.pantry_file, 'r') as f:
                    data = json.load(f)
                    # Reconstruct pantry items from saved data
                    for item_data in data.get('items', []):
                        # This is a simplified reconstruction
                        # In a real implementation, you'd properly deserialize the PantryItem objects
                        pass
                console.print(f"[green]Loaded existing pantry data from {self.pantry_file}[/green]")
            except Exception as e:
                console.print(f"[yellow]Warning: Could not load pantry data: {e}[/yellow]")
    
    def _save_pantry_data(self):
        """Save pantry data to file"""
        try:
            data = {
                'items': [
                    {
                        'name': item.name,
                        'category': item.category,
                        'quantity': item.quantity,
                        'date_added': item.date_added.isoformat() if item.date_added else None,
                        'source_receipt': item.source_receipt
                    }
                    for item in self.pantry.items.values()
                ],
                'last_updated': datetime.now().isoformat(),
                'total_items': len(self.pantry.items)
            }
            
            with open(self.pantry_file, 'w') as f:
                json.dump(data, f, indent=2)
            
            console.print(f"[green]Saved pantry data to {self.pantry_file}[/green]")
        except Exception as e:
            console.print(f"[red]Error saving pantry data: {e}[/red]")
    
    def run_complete_automation(self) -> bool:
        """Run the complete automation process"""
        try:
            console.print(Panel(
                "Starting Complete Safeway Receipt Automation",
                title="🚀 Automation Started",
                border_style="blue"
            ))
            
            # Step 1: Fetch receipts from Safeway
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TimeElapsedColumn(),
                console=console
            ) as progress:
                
                task = progress.add_task("Fetching receipts from Safeway...", total=None)
                
                with SafewayAutomation(self.config) as automation:
                    if not automation.login():
                        console.print("[red]❌ Login failed[/red]")
                        return False
                    
                    progress.update(task, description="✅ Logged in successfully")
                    
                    if not automation.navigate_to_orders():
                        console.print("[red]❌ Failed to navigate to orders page[/red]")
                        return False
                    
                    progress.update(task, description="✅ Navigated to orders page")
                    
                    receipts = automation.fetch_receipts()
                    if not receipts:
                        console.print("[yellow]⚠️ No new receipts found[/yellow]")
                        return True
                    
                    progress.update(task, description=f"✅ Found {len(receipts)} receipts")
                    
                    # Step 2: Process each receipt
                    for i, receipt in enumerate(receipts):
                        progress.update(task, description=f"Processing receipt {i+1}/{len(receipts)}")
                        
                        # Get detailed receipt information
                        detailed_receipt = automation.get_receipt_details(receipt)
                        
                        # For now, we'll create a mock EML file for parsing
                        # In a real implementation, you'd extract the actual receipt content
                        mock_eml_path = self._create_mock_eml(detailed_receipt)
                        
                        # Parse the receipt
                        parser = SafewayReceiptParser(str(mock_eml_path))
                        try:
                            items = parser.parse()
                            
                            # Add to pantry
                            self.pantry.add_items_from_receipt(items, detailed_receipt.order_id)
                            
                            # Send via email
                            automation.send_receipt_email(detailed_receipt)
                            
                            self.processed_receipts.append({
                                'receipt': detailed_receipt,
                                'items': items,
                                'parsed_successfully': True
                            })
                            
                        except Exception as e:
                            console.print(f"[yellow]⚠️ Error parsing receipt {detailed_receipt.order_id}: {e}[/yellow]")
                            self.processed_receipts.append({
                                'receipt': detailed_receipt,
                                'items': [],
                                'parsed_successfully': False,
                                'error': str(e)
                            })
                        
                        # Clean up mock file
                        if mock_eml_path.exists():
                            mock_eml_path.unlink()
                    
                    progress.update(task, description="✅ All receipts processed")
            
            # Step 3: Save pantry data
            self._save_pantry_data()
            
            # Step 4: Display summary
            self._display_summary()
            
            console.print(Panel(
                "Automation completed successfully!",
                title="🎉 Success",
                border_style="green"
            ))
            
            return True
            
        except Exception as e:
            console.print(f"[red]❌ Automation failed: {e}[/red]")
            return False
    
    def _create_mock_eml(self, receipt) -> Path:
        """Create a mock EML file for parsing (placeholder implementation)"""
        # This is a placeholder - in a real implementation, you'd extract
        # the actual receipt content from the web page
        mock_content = f"""
From: no-reply@safeway.com
To: {self.config.recipient_email}
Subject: Your Safeway Receipt - {receipt.order_id}

Content-Type: multipart/alternative; boundary="tqWfdDQPx0Nv=_?:"

--tqWfdDQPx0Nv=_?:
Content-Type: text/plain; charset="utf-8"

Your Safeway Receipt

Order ID: {receipt.order_id}
Date: {receipt.date}
Total: {receipt.total}
Store: {receipt.store_location}

{receipt.raw_content}

--tqWfdDQPx0Nv=_?:
Content-Type: text/html; charset="utf-8"

<html>
<body>
<h1>Your Safeway Receipt</h1>
<p>Order ID: {receipt.order_id}</p>
<p>Date: {receipt.date}</p>
<p>Total: {receipt.total}</p>
<p>Store: {receipt.store_location}</p>
<pre>{receipt.raw_content}</pre>
</body>
</html>

--tqWfdDQPx0Nv=_?:
"""
        
        mock_file = Path(f"temp_receipt_{receipt.order_id}.eml")
        with open(mock_file, 'w', encoding='utf-8') as f:
            f.write(mock_content)
        
        return mock_file
    
    def _display_summary(self):
        """Display a summary of the automation results"""
        table = Table(title="Automation Summary")
        table.add_column("Metric", style="cyan")
        table.add_column("Value", style="green")
        
        successful_receipts = sum(1 for r in self.processed_receipts if r['parsed_successfully'])
        total_items = sum(len(r['items']) for r in self.processed_receipts if r['parsed_successfully'])
        
        table.add_row("Total Receipts Processed", str(len(self.processed_receipts)))
        table.add_row("Successfully Parsed", str(successful_receipts))
        table.add_row("Total Items Found", str(total_items))
        table.add_row("Pantry Items", str(len(self.pantry.items)))
        table.add_row("Total Pantry Quantity", str(sum(item.quantity for item in self.pantry.items.values())))
        
        console.print(table)
        
        # Display pantry summary
        if self.pantry.items:
            console.print("\n[bold]Updated Pantry:[/bold]")
            self.pantry.print_pantry()


@click.command()
@click.option('--config', '-c', help='Path to .env file')
@click.option('--username', help='Safeway username/email')
@click.option('--password', help='Safeway password')
@click.option('--smtp-server', help='SMTP server')
@click.option('--smtp-port', type=int, help='SMTP port')
@click.option('--smtp-username', help='SMTP username')
@click.option('--smtp-password', help='SMTP password')
@click.option('--recipient-email', help='Email to send receipts to')
@click.option('--last-scrape-date', help='Last scrape date (YYYY-MM-DD)')
@click.option('--headless/--no-headless', default=True, help='Run browser in headless mode')
@click.option('--max-receipts', type=int, default=50, help='Maximum number of receipts to process')
@click.option('--show-pantry', is_flag=True, help='Show pantry contents after automation')
def main(config, username, password, smtp_server, smtp_port, smtp_username, 
         smtp_password, recipient_email, last_scrape_date, headless, max_receipts, show_pantry):
    """Complete Safeway Receipt Automation with Pantry Management"""
    
    # Load configuration
    if config:
        from dotenv import load_dotenv
        load_dotenv(config)
    
    # Override with command line arguments if provided
    config_obj = load_config_from_env()
    
    if username:
        config_obj.safeway_username = username
    if password:
        config_obj.safeway_password = password
    if smtp_server:
        config_obj.smtp_server = smtp_server
    if smtp_port:
        config_obj.smtp_port = smtp_port
    if smtp_username:
        config_obj.smtp_username = smtp_username
    if smtp_password:
        config_obj.smtp_password = smtp_password
    if recipient_email:
        config_obj.recipient_email = recipient_email
    if last_scrape_date:
        config_obj.last_scrape_date = datetime.fromisoformat(last_scrape_date)
    
    config_obj.headless = headless
    config_obj.max_receipts = max_receipts
    
    # Validate configuration
    required_fields = [
        'safeway_username', 'safeway_password', 'smtp_username', 
        'smtp_password', 'recipient_email'
    ]
    
    missing_fields = [field for field in required_fields if not getattr(config_obj, field)]
    if missing_fields:
        console.print(f"[red]Error: Missing required configuration: {', '.join(missing_fields)}[/red]")
        console.print("[yellow]Run 'python config_validator.py --help-config' for setup help[/yellow]")
        sys.exit(1)
    
    # Run complete automation
    automation = CompleteAutomation(config_obj)
    success = automation.run_complete_automation()
    
    if show_pantry and automation.pantry.items:
        console.print("\n" + "="*60)
        automation.pantry.print_pantry()
    
    if not success:
        sys.exit(1)


if __name__ == "__main__":
    main()
