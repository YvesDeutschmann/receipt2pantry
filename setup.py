#!/usr/bin/env python3
"""
Setup script for Safeway Receipt Automation

This script helps set up the environment and install dependencies.
"""

import os
import sys
import subprocess
import platform
from pathlib import Path
import click
from rich.console import Console
from rich.panel import Panel
from rich.progress import Progress, SpinnerColumn, TextColumn

console = Console()


def run_command(command: str, description: str) -> bool:
    """Run a command and return success status"""
    try:
        console.print(f"[blue]{description}...[/blue]")
        result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
        console.print(f"[green]✓ {description} completed[/green]")
        return True
    except subprocess.CalledProcessError as e:
        console.print(f"[red]✗ {description} failed: {e}[/red]")
        if e.stdout:
            console.print(f"[yellow]stdout: {e.stdout}[/yellow]")
        if e.stderr:
            console.print(f"[yellow]stderr: {e.stderr}[/yellow]")
        return False


def check_python_version():
    """Check if Python version is compatible"""
    version = sys.version_info
    if version.major < 3 or (version.major == 3 and version.minor < 11):
        console.print("[red]Error: Python 3.11 or higher is required[/red]")
        console.print(f"Current version: {version.major}.{version.minor}.{version.micro}")
        return False
    
    console.print(f"[green]✓ Python version {version.major}.{version.minor}.{version.micro} is compatible[/green]")
    return True


def install_dependencies():
    """Install Python dependencies"""
    console.print("\n[bold]Installing Python dependencies...[/bold]")
    
    # Install pip dependencies
    if not run_command("pip install -e .", "Installing project dependencies"):
        return False
    
    # Install Playwright browsers
    if not run_command("playwright install", "Installing Playwright browsers"):
        return False
    
    return True


def create_directories():
    """Create necessary directories"""
    console.print("\n[bold]Creating directories...[/bold]")
    
    directories = [
        "downloads",
        "logs",
        "data"
    ]
    
    for directory in directories:
        Path(directory).mkdir(exist_ok=True)
        console.print(f"[green]✓ Created directory: {directory}[/green]")
    
    return True


def setup_environment():
    """Set up environment files"""
    console.print("\n[bold]Setting up environment...[/bold]")
    
    # Check if .env already exists
    if Path(".env").exists():
        console.print("[yellow]Warning: .env file already exists[/yellow]")
        if not click.confirm("Do you want to overwrite it?"):
            console.print("[blue]Keeping existing .env file[/blue]")
            return True
    
    # Create sample .env file
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
        with open(".env", "w") as f:
            f.write(sample_content)
        console.print("[green]✓ Created .env file[/green]")
        console.print("[yellow]Please edit .env with your actual credentials[/yellow]")
        return True
    except Exception as e:
        console.print(f"[red]Error creating .env file: {e}[/red]")
        return False


def validate_setup():
    """Validate the setup"""
    console.print("\n[bold]Validating setup...[/bold]")
    
    # Check if main script can be imported
    try:
        import safeway_automation
        console.print("[green]✓ Main automation script can be imported[/green]")
    except ImportError as e:
        console.print(f"[red]✗ Cannot import main script: {e}[/red]")
        return False
    
    # Check if config validator can be imported
    try:
        import config_validator
        console.print("[green]✓ Config validator can be imported[/green]")
    except ImportError as e:
        console.print(f"[red]✗ Cannot import config validator: {e}[/red]")
        return False
    
    # Check if Playwright is available
    try:
        from playwright.sync_api import sync_playwright
        console.print("[green]✓ Playwright is available[/green]")
    except ImportError as e:
        console.print(f"[red]✗ Playwright not available: {e}[/red]")
        return False
    
    return True


def display_next_steps():
    """Display next steps for the user"""
    next_steps = """
# Next Steps

1. **Configure your credentials**:
   - Edit the `.env` file with your Safeway and email credentials
   - For Gmail, you may need to use an App Password

2. **Validate your configuration**:
   ```bash
   python config_validator.py
   ```

3. **Test the automation**:
   ```bash
   python safeway_automation.py --help
   ```

4. **Run the automation**:
   ```bash
   python safeway_automation.py
   ```

## Important Notes

- Make sure you have a Safeway account with online access
- For Gmail SMTP, enable 2-factor authentication and use an App Password
- The automation runs in headless mode by default (no browser window)
- Use `--no-headless` flag to see the browser for debugging

## Getting Help

- Run `python config_validator.py --help-config` for configuration help
- Run `python safeway_automation.py --help` for automation options
- Check the README.md for detailed documentation
    """
    
    console.print(Panel(next_steps, title="Setup Complete!", border_style="green"))


@click.command()
@click.option('--skip-deps', is_flag=True, help='Skip dependency installation')
@click.option('--skip-env', is_flag=True, help='Skip environment file creation')
def main(skip_deps, skip_env):
    """Set up Safeway Receipt Automation"""
    
    console.print(Panel(
        "Safeway Receipt Automation Setup",
        title="Welcome",
        border_style="blue"
    ))
    
    # Check Python version
    if not check_python_version():
        sys.exit(1)
    
    # Create directories
    if not create_directories():
        console.print("[red]Failed to create directories[/red]")
        sys.exit(1)
    
    # Install dependencies
    if not skip_deps:
        if not install_dependencies():
            console.print("[red]Failed to install dependencies[/red]")
            sys.exit(1)
    else:
        console.print("[yellow]Skipping dependency installation[/yellow]")
    
    # Set up environment
    if not skip_env:
        if not setup_environment():
            console.print("[red]Failed to set up environment[/red]")
            sys.exit(1)
    else:
        console.print("[yellow]Skipping environment setup[/yellow]")
    
    # Validate setup
    if not validate_setup():
        console.print("[red]Setup validation failed[/red]")
        sys.exit(1)
    
    # Display next steps
    display_next_steps()


if __name__ == "__main__":
    main()
