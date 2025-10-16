"""Pytest fixtures and configuration for backend tests"""

import pytest
from backend.app import create_app
from backend.config import Config

# Import parsers and providers to register them
from backend.parsers import safeway_parser  # noqa: F401
from backend.providers import safeway_provider  # noqa: F401


class TestConfig(Config):
    """Test configuration"""
    TESTING = True
    DEBUG = True
    FLASK_ENV = "testing"
    SUPABASE_URL = None
    SUPABASE_KEY = None
    SUPABASE_SERVICE_ROLE_KEY = None
    AWS_ACCESS_KEY_ID = None
    AWS_SECRET_ACCESS_KEY = None


@pytest.fixture
def app():
    """Create application for testing"""
    app = create_app(TestConfig())
    app.config.update({
        "TESTING": True,
    })
    yield app


@pytest.fixture
def client(app):
    """Create test client"""
    return app.test_client()


@pytest.fixture
def runner(app):
    """Create test CLI runner"""
    return app.test_cli_runner()


@pytest.fixture
def mock_supabase_service(mocker):
    """Mock Supabase service"""
    mock = mocker.MagicMock()
    mock.get_user_receipts.return_value = []
    mock.store_receipt.return_value = "test-receipt-id"
    mock.store_receipt_items.return_value = 5
    mock.get_grocery_account.return_value = None
    return mock


@pytest.fixture
def mock_secrets_service(mocker):
    """Mock Secrets service"""
    mock = mocker.MagicMock()
    mock.store_user_credentials.return_value = "mock-arn"
    mock.retrieve_user_credentials.return_value = {
        "username": "test@example.com",
        "password": "test-password"
    }
    return mock

