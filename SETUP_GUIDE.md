# Safeway Receipt Automation - Setup Guide

This guide will help you set up and run the Safeway receipt automation tool.

## Prerequisites

- Python 3.11 or higher
- A Safeway account with online access
- An email account with SMTP access (Gmail recommended)

## Quick Setup

### 1. Install Dependencies

```bash
# Install Python dependencies
pip install -e .

# Install Playwright browsers
playwright install
```

### 2. Configure Credentials

Create a `.env` file with your credentials:

```bash
# Copy the example file
cp env.example .env

# Edit with your credentials
# Use your favorite text editor to edit .env
```

Required credentials:
- `SAFEWAY_USERNAME`: Your Safeway account email
- `SAFEWAY_PASSWORD`: Your Safeway account password
- `SMTP_USERNAME`: Your email address
- `SMTP_PASSWORD`: Your email password (or App Password for Gmail)
- `RECIPIENT_EMAIL`: Where to send the receipts

### 3. Gmail Setup (if using Gmail)

1. Enable 2-Factor Authentication on your Google account
2. Go to Google Account settings → Security → 2-Step Verification → App passwords
3. Generate a password for "Mail"
4. Use this password as `SMTP_PASSWORD` in your `.env` file

### 4. Validate Configuration

```bash
python config_validator.py
```

### 5. Run Automation

```bash
# Basic run
python run_automation.py

# Or use the convenience scripts
# Windows:
run.bat

# Linux/Mac:
./run.sh
```

## Detailed Setup

### Using the Setup Script

The easiest way to set up everything:

```bash
python setup.py
```

This will:
- Check Python version compatibility
- Install all dependencies
- Create necessary directories
- Create a sample `.env` file
- Validate the setup

### Manual Setup

If you prefer to set up manually:

1. **Install Dependencies**:
   ```bash
   pip install playwright python-dotenv email-validator click rich
   playwright install
   ```

2. **Create Directories**:
   ```bash
   mkdir downloads logs
   ```

3. **Create Configuration**:
   ```bash
   python config_validator.py --create-sample
   ```

4. **Edit Configuration**:
   Edit the `.env` file with your actual credentials.

## Usage Examples

### Basic Automation

```bash
python run_automation.py
```

### With Custom Options

```bash
# Run with visible browser (for debugging)
python run_automation.py --no-headless

# Limit number of receipts
python run_automation.py --max-receipts 10

# Use custom configuration file
python run_automation.py --config my_config.env
```

### Command Line Overrides

```bash
python run_automation.py \
  --username your_email@example.com \
  --password your_password \
  --recipient-email receipts@example.com \
  --max-receipts 20
```

## Troubleshooting

### Common Issues

1. **"Python not found"**
   - Install Python 3.11+ from python.org
   - Make sure Python is in your PATH

2. **"Playwright browsers not installed"**
   ```bash
   playwright install
   ```

3. **"Login failed"**
   - Verify your Safeway credentials
   - Try running with `--no-headless` to see what's happening
   - Check if your account has online access

4. **"SMTP authentication error"**
   - For Gmail, use an App Password instead of your regular password
   - Ensure 2-factor authentication is enabled
   - Check SMTP server and port settings

5. **"No receipts found"**
   - Verify you have purchase history in your Safeway account
   - Check if the orders page is accessible
   - Try running with `--no-headless` to debug navigation

### Debug Mode

Run with `--no-headless` to see the browser in action:

```bash
python run_automation.py --no-headless
```

This will open a browser window so you can see what's happening during automation.

### Getting Help

```bash
# Configuration help
python config_validator.py --help-config

# Automation help
python run_automation.py --help

# Setup help
python setup.py --help
```

## File Structure

After setup, your directory should look like this:

```
receipt2pantry/
├── .env                     # Your configuration (create this)
├── downloads/               # Downloaded receipts (auto-created)
├── logs/                    # Log files (auto-created)
├── pantry_data.json         # Pantry data (auto-created)
├── safeway_automation.py    # Main automation script
├── run_automation.py        # Complete automation runner
├── config_validator.py      # Configuration validator
├── setup.py                 # Setup script
├── run.bat                  # Windows convenience script
├── run.sh                   # Linux/Mac convenience script
└── ...                      # Other project files
```

## Security Notes

- Never commit your `.env` file to version control
- Use App Passwords for Gmail instead of your regular password
- Keep your Safeway credentials secure
- The tool runs locally and doesn't store credentials anywhere else

## Support

If you encounter issues:

1. Check the troubleshooting section above
2. Run with `--no-headless` to see what's happening
3. Validate your configuration with `python config_validator.py`
4. Check the logs in the `logs/` directory

## Next Steps

Once everything is working:

1. Set up a cron job (Linux/Mac) or Task Scheduler (Windows) to run automatically
2. Consider setting up email notifications for automation results
3. Explore the pantry management features
4. Customize the receipt parsing for your specific needs
