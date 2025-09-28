# Receipt2Pantry

A comprehensive Python tool for automated Safeway receipt fetching and pantry management. This tool can automatically log into your Safeway account, fetch new purchase receipts, and organize ingredients into a virtual pantry.

## Features

### 🚀 Automated Receipt Fetching
- **Playwright Automation**: Automatically logs into Safeway's loyalty portal
- **Smart Navigation**: Navigates to purchase history and extracts receipts
- **Date Filtering**: Only fetches receipts since your last scrape date
- **Email Integration**: Automatically sends receipts via SMTP

### 📧 Receipt Processing
- **Receipt Parsing**: Extracts line items from Safeway receipt emails (.eml files)
- **Virtual Pantry**: Organizes ingredients by category (Dairy, Meat, Beverages, etc.)
- **Price Tracking**: Shows original prices, sale prices, and savings
- **Ingredient Extraction**: Cleans up product names to extract main ingredients

### 🛠️ Easy Setup & Configuration
- **Environment-based Configuration**: Secure credential management
- **Validation Tools**: Built-in configuration validation
- **CLI Interface**: Easy-to-use command-line interface
- **Rich Logging**: Beautiful console output with progress tracking

## Quick Start

### 1. Setup

```bash
# Clone or download the project
cd receipt2pantry

# Run the setup script
python setup.py
```

### 2. Configure Credentials

Edit the `.env` file with your credentials:

```bash
# Safeway Account
SAFEWAY_USERNAME=your_email@example.com
SAFEWAY_PASSWORD=your_password

# SMTP Email (for sending receipts)
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587
SMTP_USERNAME=your_smtp_email@gmail.com
SMTP_PASSWORD=your_app_password
RECIPIENT_EMAIL=recipient@example.com
```

### 3. Validate Configuration

```bash
python config_validator.py
```

### 4. Run Automation

```bash
# Run with default settings
python safeway_automation.py

# Run with custom options
python safeway_automation.py --no-headless --max-receipts 10
```

## Usage

### Automated Receipt Fetching

```bash
# Basic usage
python safeway_automation.py

# With custom configuration
python safeway_automation.py --config custom.env

# With command-line overrides
python safeway_automation.py \
  --username your_email@example.com \
  --password your_password \
  --recipient-email receipts@example.com \
  --max-receipts 20
```

### Manual Receipt Parsing

```python
from parsers.safeway_parser import SafewayReceiptParser, VirtualPantry

# Parse a receipt
parser = SafewayReceiptParser('data/safeway_receipt.eml')
items = parser.parse()

# Display receipt items
parser.print_receipt_items()

# Create virtual pantry
pantry = VirtualPantry()
pantry.add_items_from_receipt(items, "Safeway Receipt")
pantry.print_pantry()
```

## Configuration

### Environment Variables

| Variable | Required | Description | Default |
|----------|----------|-------------|---------|
| `SAFEWAY_USERNAME` | Yes | Your Safeway account email | - |
| `SAFEWAY_PASSWORD` | Yes | Your Safeway account password | - |
| `SMTP_SERVER` | No | SMTP server for sending emails | smtp.gmail.com |
| `SMTP_PORT` | No | SMTP port | 587 |
| `SMTP_USERNAME` | Yes | SMTP email username | - |
| `SMTP_PASSWORD` | Yes | SMTP email password | - |
| `RECIPIENT_EMAIL` | Yes | Email to send receipts to | - |
| `HEADLESS` | No | Run browser in headless mode | true |
| `DOWNLOAD_DIR` | No | Directory for downloads | ./downloads |
| `MAX_RECEIPTS` | No | Maximum receipts to process | 50 |
| `LAST_SCRAPE_DATE` | No | Only fetch receipts after this date (YYYY-MM-DD) | - |

### Gmail Setup

For Gmail SMTP, you need to use an App Password:

1. Enable 2-Factor Authentication on your Google account
2. Go to Google Account settings → Security → 2-Step Verification → App passwords
3. Generate a password for "Mail"
4. Use this password as `SMTP_PASSWORD`

## Command Line Options

### safeway_automation.py

```bash
python safeway_automation.py [OPTIONS]

Options:
  -c, --config PATH              Path to .env file
  --username TEXT                Safeway username/email
  --password TEXT                Safeway password
  --smtp-server TEXT             SMTP server
  --smtp-port INTEGER            SMTP port
  --smtp-username TEXT           SMTP username
  --smtp-password TEXT           SMTP password
  --recipient-email TEXT         Email to send receipts to
  --last-scrape-date TEXT        Last scrape date (YYYY-MM-DD)
  --headless / --no-headless     Run browser in headless mode
  --max-receipts INTEGER         Maximum number of receipts to process
  --help                         Show this message and exit
```

### config_validator.py

```bash
python config_validator.py [OPTIONS]

Options:
  -c, --config PATH    Path to .env file to validate
  --create-sample      Create a sample .env file
  --help-config        Show configuration help
  --help               Show this message and exit
```

## Example Output

### Automation Log

```
[INFO] Starting Safeway automation...
[INFO] Browser started successfully
[INFO] Navigating to Safeway login page...
[INFO] Entering credentials...
[INFO] Login successful!
[INFO] Navigating to orders page...
[INFO] Successfully navigated to orders page
[INFO] Fetching receipts...
[INFO] Found 3 receipts
[INFO] Getting details for receipt: ORDER_0_1703123456
[INFO] Sending receipt ORDER_0_1703123456 via email...
[INFO] Receipt ORDER_0_1703123456 sent successfully
[INFO] Automation completed. 3/3 receipts sent successfully
```

### Receipt Parsing Output

```
============================================================
SAFEWAY RECEIPT ITEMS
============================================================

GROCERY
-------
  Olipop Soda Prebiotic Ginger Ale 4-12fz
    Price: $7.99
    Regular Price: $8.99
    Savings: $1.00

REFRIG/FROZEN
-------------
  Lucerne Cream Cheese Spread Whipped 8 Oz
    Price: $5.00
    Regular Price: $2.79
    Savings: $-2.21

============================================================
TOTAL ITEMS: 2
TOTAL VALUE: $12.99
============================================================

============================================================
VIRTUAL PANTRY
============================================================

BEVERAGES
---------
  • Soda
    From: Safeway Receipt

DAIRY
-----
  • Cream Cheese
    From: Safeway Receipt

============================================================
TOTAL ITEMS: 2
TOTAL QUANTITY: 2
============================================================
```

## Troubleshooting

### Common Issues

1. **Login Failed**
   - Verify your Safeway credentials
   - Check if your account has online access
   - Try running with `--no-headless` to see what's happening

2. **SMTP Authentication Error**
   - For Gmail, use an App Password instead of your regular password
   - Ensure 2-factor authentication is enabled
   - Check SMTP server and port settings

3. **No Receipts Found**
   - Verify you have purchase history in your Safeway account
   - Check if the orders page is accessible
   - Try running with `--no-headless` to debug navigation

4. **Browser Issues**
   - Run `playwright install` to ensure browsers are installed
   - Try running with `--no-headless` to see browser behavior
   - Check if you have sufficient permissions

### Debug Mode

Run with `--no-headless` to see the browser in action:

```bash
python safeway_automation.py --no-headless
```

This will open a browser window so you can see what's happening during automation.

## API Reference

### SafewayAutomation

Main automation class for fetching receipts from Safeway.

**Methods:**
- `login()`: Login to Safeway website
- `navigate_to_orders()`: Navigate to orders/receipts page
- `fetch_receipts()`: Fetch receipts from the orders page
- `send_receipt_email(receipt)`: Send receipt via email
- `run_automation()`: Run the complete automation process

### SafewayReceiptParser

Parses Safeway receipt emails and extracts product information.

**Methods:**
- `parse()`: Parse the EML file and return receipt items
- `print_receipt_items()`: Display formatted receipt items
- `get_pantry_ingredients()`: Extract ingredient names for pantry

### VirtualPantry

Manages a virtual pantry with categorized ingredients.

**Methods:**
- `add_items_from_receipt(items, source)`: Add items from a receipt
- `print_pantry()`: Display pantry contents by category
- `get_items_by_category(category)`: Get items in a specific category
- `search_items(term)`: Search for items by name

### Data Classes

#### ReceiptData
Represents a receipt fetched from Safeway.
- `order_id`: Order identifier
- `date`: Purchase date
- `total`: Total amount
- `store_location`: Store location
- `items`: List of items
- `raw_content`: Raw receipt content
- `receipt_url`: URL to receipt

#### ReceiptItem
Represents a single item from a receipt.
- `name`: Product name
- `price`: Sale price
- `quantity`: Number of items
- `category`: Product category
- `regular_price`: Original price (optional)
- `savings`: Amount saved (optional)

#### PantryItem
Represents an item in the virtual pantry.
- `name`: Ingredient name
- `category`: Ingredient category
- `quantity`: Total quantity
- `date_added`: When added to pantry
- `source_receipt`: Source receipt name

## Requirements

- Python 3.11+
- Playwright (for browser automation)
- SMTP access (for sending emails)

## Installation

```bash
# Install dependencies
pip install -e .

# Install Playwright browsers
playwright install
```

## File Structure

```
receipt2pantry/
├── data/                       # Sample receipt files
│   ├── safeway_receipt_1.eml
│   ├── safeway_receipt_2.eml
│   └── ...
├── parsers/
│   └── safeway_parser.py       # Receipt parsing logic
├── downloads/                  # Downloaded receipts (created automatically)
├── logs/                       # Log files (created automatically)
├── safeway_automation.py       # Main automation script
├── config_validator.py         # Configuration validation
├── setup.py                    # Setup script
├── env.example                 # Example environment file
├── pyproject.toml              # Project configuration
└── README.md                   # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is open source. Please check the license file for details.

## Disclaimer

This tool is for personal use only. Please respect Safeway's terms of service and use responsibly. The authors are not responsible for any misuse of this tool.

