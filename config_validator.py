#!/usr/bin/env python3
"""
Configuration Validator for Safeway Automation

This script validates the configuration and provides helpful setup instructions.
"""

import os
import sys
from typing import List, Dict, Any
from dataclasses import dataclass
from email_validator import validate_email, EmailNotValidError
import click
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

console = Console()


@dataclass
class ValidationResult:
    """Result of configuration validation"""
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    suggestions: List[str]


class ConfigValidator:
    """Validates configuration for Safeway automation"""
    
    def __init__(self):
        self.required_fields = {
            'SAFEWAY_USERNAME': 'Safeway account email/username',
            'SAFEWAY_PASSWORD': 'Safeway account password',
            'SMTP_USERNAME': 'SMTP email username',
            'SMTP_PASSWORD': 'SMTP email password',
            'RECIPIENT_EMAIL': 'Email address to send receipts to'
        }
        
        self.optional_fields = {
            'SMTP_SERVER': 'SMTP server (default: smtp.gmail.com)',
            'SMTP_PORT': 'SMTP port (default: 587)',
            'HEADLESS': 'Run browser in headless mode (default: true)',
            'DOWNLOAD_DIR': 'Directory for downloads (default: ./downloads)',
            'MAX_RECEIPTS': 'Maximum receipts to process (default: 50)',
            'LAST_SCRAPE_DATE': 'Last scrape date in YYYY-MM-DD format'
        }
    
    def validate_config(self, config_dict: Dict[str, Any]) -> ValidationResult:
        """Validate the configuration dictionary"""
        errors = []
        warnings = []
        suggestions = []
        
        # Check required fields
        for field, description in self.required_fields.items():
            if not config_dict.get(field):
                errors.append(f"Missing required field: {field} ({description})")
        
        # Validate email addresses
        email_fields = ['SAFEWAY_USERNAME', 'SMTP_USERNAME', 'RECIPIENT_EMAIL']
        for field in email_fields:
            value = config_dict.get(field)
            if value:
                try:
                    validate_email(value)
                except EmailNotValidError:
                    errors.append(f"Invalid email address in {field}: {value}")
        
        # Validate SMTP configuration
        smtp_server = config_dict.get('SMTP_SERVER', 'smtp.gmail.com')
        smtp_port = config_dict.get('SMTP_PORT', '587')
        
        if smtp_port:
            try:
                smtp_port_int = int(smtp_port)
                if smtp_port_int < 1 or smtp_port_int > 65535:
                    errors.append(f"Invalid SMTP port: {smtp_port}")
            except ValueError:
                errors.append(f"SMTP port must be a number: {smtp_port}")
        
        # Validate numeric fields
        max_receipts_val = config_dict.get('MAX_RECEIPTS', '50')
        if max_receipts_val:
            try:
                max_receipts = int(max_receipts_val)
                if max_receipts < 1:
                    warnings.append("MAX_RECEIPTS should be at least 1")
            except ValueError:
                errors.append(f"MAX_RECEIPTS must be a number: {max_receipts_val}")
        
        # Validate date format
        last_scrape_date = config_dict.get('LAST_SCRAPE_DATE')
        if last_scrape_date:
            try:
                from datetime import datetime
                datetime.strptime(last_scrape_date, '%Y-%m-%d')
            except ValueError:
                errors.append(f"LAST_SCRAPE_DATE must be in YYYY-MM-DD format: {last_scrape_date}")
        
        # Check directory permissions
        download_dir = config_dict.get('DOWNLOAD_DIR', './downloads')
        if download_dir:
            try:
                os.makedirs(download_dir, exist_ok=True)
            except PermissionError:
                errors.append(f"Cannot create download directory: {download_dir}")
            except Exception as e:
                warnings.append(f"Warning creating download directory: {e}")
        
        # Gmail-specific suggestions
        if smtp_server and 'gmail.com' in smtp_server.lower():
            suggestions.append("For Gmail, you may need to use an App Password instead of your regular password")
            suggestions.append("Enable 2-factor authentication and generate an App Password in your Google Account settings")
        
        # Security suggestions
        if config_dict.get('SAFEWAY_PASSWORD'):
            if len(config_dict['SAFEWAY_PASSWORD']) < 8:
                warnings.append("Safeway password seems short - ensure it's correct")
        
        if config_dict.get('SMTP_PASSWORD'):
            if len(config_dict['SMTP_PASSWORD']) < 8:
                warnings.append("SMTP password seems short - ensure it's correct")
        
        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            suggestions=suggestions
        )
    
    def display_validation_result(self, result: ValidationResult):
        """Display validation results in a formatted way"""
        if result.is_valid:
            console.print("[green]✓ Configuration is valid![/green]")
        else:
            console.print("[red]✗ Configuration has errors[/red]")
        
        if result.errors:
            console.print("\n[red]Errors:[/red]")
            for error in result.errors:
                console.print(f"  • {error}")
        
        if result.warnings:
            console.print("\n[yellow]Warnings:[/yellow]")
            for warning in result.warnings:
                console.print(f"  • {warning}")
        
        if result.suggestions:
            console.print("\n[blue]Suggestions:[/blue]")
            for suggestion in result.suggestions:
                console.print(f"  • {suggestion}")
    
    def display_config_help(self):
        """Display help for setting up configuration"""
        help_text = """
# Safeway Receipt Automation - Configuration Help

## Required Configuration

1. **Safeway Account**: You need a Safeway account with online access
   - SAFEWAY_USERNAME: Your Safeway account email
   - SAFEWAY_PASSWORD: Your Safeway account password

2. **SMTP Email**: For sending receipts via email
   - SMTP_USERNAME: Your email address
   - SMTP_PASSWORD: Your email password (or App Password for Gmail)
   - RECIPIENT_EMAIL: Where to send the receipts

## Gmail Setup (if using Gmail for SMTP)

1. Enable 2-Factor Authentication on your Google account
2. Generate an App Password:
   - Go to Google Account settings
   - Security → 2-Step Verification → App passwords
   - Generate a password for "Mail"
   - Use this password as SMTP_PASSWORD

## Optional Configuration

- SMTP_SERVER: Default is smtp.gmail.com
- SMTP_PORT: Default is 587
- HEADLESS: Set to false to see the browser (useful for debugging)
- MAX_RECEIPTS: Limit number of receipts to process
- LAST_SCRAPE_DATE: Only fetch receipts after this date (YYYY-MM-DD)

## Example .env file

```
SAFEWAY_USERNAME=your_email@example.com
SAFEWAY_PASSWORD=your_password
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_smtp_email@gmail.com
SMTP_PASSWORD=your_app_password
RECIPIENT_EMAIL=recipient@example.com
HEADLESS=true
MAX_RECEIPTS=50
```
        """
        
        console.print(Panel(help_text, title="Configuration Help", border_style="blue"))
    
    def create_sample_env_file(self, filename: str = ".env"):
        """Create a sample .env file"""
        sample_content = """# Safeway Account Credentials
SAFEWAY_USERNAME=your_email@example.com
SAFEWAY_PASSWORD=your_password

# SMTP Configuration (for sending receipts via email)
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_smtp_email@gmail.com
SMTP_PASSWORD=your_app_password

# Email Configuration
RECIPIENT_EMAIL=recipient@example.com

# Automation Settings
HEADLESS=true
DOWNLOAD_DIR=./downloads
MAX_RECEIPTS=50

# Optional: Last scrape date (YYYY-MM-DD format)
# If set, only receipts after this date will be fetched
# LAST_SCRAPE_DATE=2024-01-01
"""
        
        try:
            with open(filename, 'w') as f:
                f.write(sample_content)
            console.print(f"[green]Created sample configuration file: {filename}[/green]")
            console.print(f"[yellow]Please edit {filename} with your actual credentials[/yellow]")
        except Exception as e:
            console.print(f"[red]Error creating {filename}: {e}[/red]")


@click.command()
@click.option('--config', '-c', help='Path to .env file to validate')
@click.option('--create-sample', is_flag=True, help='Create a sample .env file')
@click.option('--help-config', is_flag=True, help='Show configuration help')
def main(config, create_sample, help_config):
    """Validate Safeway automation configuration"""
    
    validator = ConfigValidator()
    
    if help_config:
        validator.display_config_help()
        return
    
    if create_sample:
        validator.create_sample_env_file()
        return
    
    # Load and validate configuration
    if config:
        from dotenv import load_dotenv
        load_dotenv(config)
    
    # Get configuration from environment
    config_dict = {}
    for field in list(validator.required_fields.keys()) + list(validator.optional_fields.keys()):
        config_dict[field] = os.getenv(field)
    
    # Validate configuration
    result = validator.validate_config(config_dict)
    
    # Display results
    validator.display_validation_result(result)
    
    # Exit with error code if validation failed
    if not result.is_valid:
        sys.exit(1)


if __name__ == "__main__":
    main()
