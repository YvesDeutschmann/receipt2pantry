@echo off
REM Safeway Receipt Automation - Windows Batch Script

echo Starting Safeway Receipt Automation...
echo.

REM Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo Error: Python is not installed or not in PATH
    echo Please install Python 3.11+ and try again
    pause
    exit /b 1
)

REM Check if .env file exists
if not exist .env (
    echo Warning: .env file not found
    echo Creating sample configuration...
    python config_validator.py --create-sample
    echo.
    echo Please edit the .env file with your credentials and run again
    pause
    exit /b 1
)

REM Validate configuration
echo Validating configuration...
python config_validator.py
if errorlevel 1 (
    echo Configuration validation failed
    echo Please fix the errors and try again
    pause
    exit /b 1
)

echo.
echo Configuration is valid. Starting automation...
echo.

REM Run the automation
python run_automation.py

echo.
echo Automation completed. Press any key to exit...
pause >nul
