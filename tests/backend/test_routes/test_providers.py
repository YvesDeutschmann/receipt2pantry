"""Tests for provider endpoints"""

import json

import pytest


def test_list_providers(client):
    """Test listing all providers"""
    response = client.get('/api/providers')
    
    assert response.status_code == 200
    
    data = json.loads(response.data)
    assert "providers" in data
    assert "count" in data
    assert isinstance(data["providers"], list)
    
    # Safeway and Costco should be registered
    assert "safeway" in data["providers"]
    assert "costco" in data["providers"]


def test_get_provider_status_missing_user_id(client):
    """Test getting provider status without user_id"""
    response = client.get('/api/providers/safeway/status')
    
    assert response.status_code == 400
    
    data = json.loads(response.data)
    assert "error" in data
    assert "user_id" in data["error"].lower()


def test_test_provider_connection_missing_body(client):
    """Playwright test route removed; callers get 404."""
    response = client.post('/api/providers/safeway/test')
    assert response.status_code == 404


def test_test_provider_connection_invalid_provider(client):
    """Test route removed; non-existent provider also returns 404."""
    response = client.post(
        '/api/providers/invalid-provider/test',
        data=json.dumps({
            "username": "test@example.com",
            "password": "test-password"
        }),
        content_type='application/json'
    )
    
    assert response.status_code == 404


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/providers/costco/login/abc/mfa"),
        ("GET", "/api/providers/costco/login/abc/status"),
        ("GET", "/api/providers/costco/login/abc/device-verification"),
        ("POST", "/api/providers/costco/login/abc/device-verification"),
        ("DELETE", "/api/providers/costco/login/abc"),
        ("POST", "/api/providers/costco/login/abc/fetch-receipts"),
    ],
    ids=[
        "mfa",
        "status",
        "device-verification-get",
        "device-verification-post",
        "cancel",
        "fetch-receipts-after-mfa",
    ],
)
def test_deleted_login_routes_return_404(client, method, path):
    response = client.open(path, method=method)
    assert response.status_code == 404


@pytest.mark.parametrize(
    "method,path",
    [
        ("POST", "/api/providers/costco/fetch-receipts"),
        ("POST", "/api/providers/costco/fetch-receipts-with-token"),
        ("GET", "/api/providers/costco/connection-code"),
        ("POST", "/api/providers/costco/connect"),
        ("GET", "/api/providers/costco/connection/abc123/status"),
    ],
    ids=[
        "fetch-receipts",
        "fetch-receipts-with-token",
        "connection-code",
        "connect",
        "connection-status",
    ],
)
def test_deleted_legacy_costco_routes_return_404(client, method, path):
    response = client.open(path, method=method)
    assert response.status_code == 404


# --- store_costco_receipts (One-Tap Sync) ---

TEST_USER_ID = '11111111-1111-1111-1111-111111111111'


def test_store_costco_receipts_valid_payload(client):
    """store-receipts accepts valid payload and returns success."""
    payload = {
        'receipts': [
            {
                'store_name': 'Costco',
                'order_id': 'test-123',
                'order_date': '2025-01-15',
                'total_amount': 50.0,
                'receipt_type': 'warehouse',
                'items': [],
            }
        ],
        'user_id': TEST_USER_ID,
    }
    response = client.post(
        '/api/providers/costco/store-receipts',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert 'receipts_stored' in data
    assert 'receipt_ids' in data
    assert 'items_added_to_pantry' in data


def test_store_costco_receipts_missing_user_id(client):
    """store-receipts returns 400 when user_id is missing."""
    payload = {'receipts': []}
    response = client.post(
        '/api/providers/costco/store-receipts',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 400
    data = json.loads(response.data)
    assert 'error' in data
    assert 'user_id' in data['error'].lower()


def test_store_costco_receipts_invalid_user_id(client):
    """store-receipts returns 400 when user_id is not a valid UUID."""
    payload = {'receipts': [], 'user_id': 'not-a-uuid'}
    response = client.post(
        '/api/providers/costco/store-receipts',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 400
    data = json.loads(response.data)
    assert 'error' in data


def test_store_costco_receipts_non_array_receipts(client):
    """store-receipts returns 400 when receipts is not an array."""
    payload = {'receipts': 'not-an-array', 'user_id': TEST_USER_ID}
    response = client.post(
        '/api/providers/costco/store-receipts',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 400
    data = json.loads(response.data)
    assert 'error' in data
    assert 'array' in data['error'].lower()


def test_store_costco_receipts_warehouse_filter(client):
    """store-receipts filters out gas station and car wash (Costco API uses spaced types)."""
    payload = {
        'receipts': [
            {'order_id': 'gas-1', 'receipt_type': 'Gas Station', 'total_amount': 30},
            {'order_id': 'warehouse-1', 'receipt_type': 'In-Warehouse', 'total_amount': 100},
            {'order_id': 'carwash-1', 'receiptType': 'Car Wash', 'total_amount': 10},
        ],
        'user_id': TEST_USER_ID,
    }
    response = client.post(
        '/api/providers/costco/store-receipts',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 200
    data = json.loads(response.data)
    assert 'receipts_stored' in data
    # Only warehouse receipt should be processed
    assert data['receipt_ids'] is not None


# --- connect_costco_from_app ---

def test_connect_costco_from_app_missing_user_id(client):
    """connect-from-app returns 400 when user_id is missing."""
    payload = {'idToken': 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0In0.x'}
    response = client.post(
        '/api/providers/costco/connect-from-app',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 400
    data = json.loads(response.data)
    assert 'error' in data
    assert 'user_id' in data['error'].lower()


def test_connect_costco_from_app_missing_id_token(client):
    """connect-from-app returns 400 when idToken is missing."""
    payload = {'user_id': TEST_USER_ID}
    response = client.post(
        '/api/providers/costco/connect-from-app',
        data=json.dumps(payload),
        content_type='application/json',
    )
    assert response.status_code == 400
    data = json.loads(response.data)
    assert 'error' in data
    assert 'idToken' in data['error'] or 'id_token' in data['error'].lower()


# --- 01c.2: connection-health signal ---

EXPIRED_JWT = (
    'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.'
    'eyJzdWIiOiJ0ZXN0IiwiZXhwIjoxfQ.'
    'x'
)


def test_CONNECT_FROM_APP_EXPIRED_TOKEN_RETURNS_NEEDS_RECONNECT(client, mocker):
    """Expired JWT returns 401 with standardized reconnect shape."""
    mock_provider = mocker.MagicMock()
    mock_provider._decode_jwt_payload.return_value = {'sub': 'test', 'exp': 1}
    mock_provider._is_token_expired.return_value = True
    mocker.patch('backend.providers.costco_provider.CostcoProvider', return_value=mock_provider)

    response = client.post(
        '/api/providers/costco/connect-from-app',
        data=json.dumps({'user_id': TEST_USER_ID, 'idToken': EXPIRED_JWT}),
        content_type='application/json',
    )

    assert response.status_code == 401
    data = json.loads(response.data)
    assert data['needs_reconnect'] is True
    assert data['reason'] == 'expired_credentials'
    assert data['provider'] == 'costco'
    assert 'error' in data


def test_CONNECT_FROM_APP_AUTH_EXCEPTION_RETURNS_NEEDS_RECONNECT(client, mocker):
    """AuthenticationException returns 401 with standardized reconnect shape."""
    from backend.utils.exceptions import AuthenticationException

    mock_provider = mocker.MagicMock()
    mock_provider._decode_jwt_payload.side_effect = AuthenticationException(
        'Invalid token format'
    )
    mocker.patch('backend.providers.costco_provider.CostcoProvider', return_value=mock_provider)

    response = client.post(
        '/api/providers/costco/connect-from-app',
        data=json.dumps({'user_id': TEST_USER_ID, 'idToken': EXPIRED_JWT}),
        content_type='application/json',
    )

    assert response.status_code == 401
    data = json.loads(response.data)
    assert data['needs_reconnect'] is True
    assert data['reason'] == 'expired_credentials'
    assert data['provider'] == 'costco'


def test_RECONNECT_RESPONSE_HELPER_UNKNOWN_REASON_RAISES():
    """_reconnect_response raises ValueError for unknown reason."""
    from backend.routes.providers import _reconnect_response

    with pytest.raises(ValueError):
        _reconnect_response('safeway', 'unknown_reason')


def test_RECONNECT_RESPONSE_HELPER_VALID_SHAPE(app):
    """_reconnect_response returns correct JSON shape without legacy key."""
    from backend.routes.providers import _reconnect_response

    with app.app_context():
        response, status = _reconnect_response('safeway', 'expired_credentials')
        data = json.loads(response.data)

    assert status == 401
    assert data['needs_reconnect'] is True
    assert data['provider'] == 'safeway'
    assert data['reason'] == 'expired_credentials'
    assert 'error' in data
    assert 'expired_credentials' not in data


@pytest.mark.parametrize(
    'setup_mock',
    [
        'expired_token',
        'auth_exception',
    ],
    ids=['expired_token', 'auth_exception'],
)
def test_EXPIRED_CREDENTIALS_KEY_ABSENT_FROM_ALL_401_PATHS(client, mocker, setup_mock):
    """Legacy expired_credentials key must not appear in any 401 reconnect response."""
    from backend.utils.exceptions import AuthenticationException

    mock_provider = mocker.MagicMock()
    if setup_mock == 'expired_token':
        mock_provider._decode_jwt_payload.return_value = {'sub': 'test', 'exp': 1}
        mock_provider._is_token_expired.return_value = True
    else:
        mock_provider._decode_jwt_payload.side_effect = AuthenticationException(
            'Invalid token format'
        )
    mocker.patch('backend.providers.costco_provider.CostcoProvider', return_value=mock_provider)

    response = client.post(
        '/api/providers/costco/connect-from-app',
        data=json.dumps({'user_id': TEST_USER_ID, 'idToken': EXPIRED_JWT}),
        content_type='application/json',
    )

    assert response.status_code == 401
    data = json.loads(response.data)
    assert 'expired_credentials' not in data

