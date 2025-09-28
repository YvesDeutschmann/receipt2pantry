#!/bin/bash
# Safeway Receipt Automation - Linux/Mac Shell Script

echo "Starting Safeway Receipt Automation..."
echo

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "Error: Python 3 is not installed or not in PATH"
    echo "Please install Python 3.11+ and try again"
    exit 1
fi

# Check if .env file exists
if [ ! -f .env ]; then
    echo "Warning: .env file not found"
    echo "Creating sample configuration..."
    python3 config_validator.py --create-sample
    echo
    echo "Please edit the .env file with your credentials and run again"
    exit 1
fi

# Validate configuration
echo "Validating configuration..."
python3 config_validator.py
if [ $? -ne 0 ]; then
    echo "Configuration validation failed"
    echo "Please fix the errors and try again"
    exit 1
fi

echo
echo "Configuration is valid. Starting automation..."
echo

# Run the automation
python3 run_automation.py

echo
echo "Automation completed."
