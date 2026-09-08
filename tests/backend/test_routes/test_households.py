"""Tests for household routes"""

import json
import pytest
from unittest.mock import Mock, patch
from backend.utils.exceptions import ValidationException, AuthorizationException


class TestHouseholdRoutes:
    """Test cases for household API routes"""
    
    @pytest.fixture
    def mock_household_service(self):
        """Create mock household service"""
        return Mock()
    
    @pytest.fixture
    def app_with_service(self, app, mock_household_service):
        """App with mocked household service"""
        app.config['HOUSEHOLD_SERVICE'] = mock_household_service
        return app
    
    @pytest.fixture
    def client_with_service(self, app_with_service):
        """Test client with mocked household service"""
        return app_with_service.test_client()
    
    # =========================================================================
    # GET /api/households tests
    # =========================================================================
    
    def test_get_household_success(self, client_with_service, mock_household_service):
        """Test getting user's household"""
        # Setup
        mock_household_service.get_household.return_value = {
            'id': 'household-123',
            'name': 'Test Family',
            'role': 'owner'
        }
        
        # Execute
        response = client_with_service.get(
            '/api/households',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['household']['id'] == 'household-123'
        assert data['household']['name'] == 'Test Family'
    
    def test_get_household_none(self, client_with_service, mock_household_service):
        """Test getting household when user has none"""
        # Setup
        mock_household_service.get_household.return_value = None
        
        # Execute
        response = client_with_service.get(
            '/api/households',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['household'] is None
    
    def test_get_household_no_user_id(self, client_with_service):
        """Test getting household without user ID"""
        response = client_with_service.get('/api/households')
        
        assert response.status_code == 401
        data = json.loads(response.data)
        assert 'error' in data
    
    # =========================================================================
    # POST /api/households tests
    # =========================================================================
    
    def test_create_household_success(self, client_with_service, mock_household_service):
        """Test creating a new household"""
        # Setup
        mock_household_service.create_household.return_value = {
            'id': 'new-household',
            'name': 'My Family',
            'join_code': 'ABC123',
            'role': 'owner'
        }
        
        # Execute
        response = client_with_service.post(
            '/api/households',
            data=json.dumps({'name': 'My Family'}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 201
        data = json.loads(response.data)
        assert data['household']['id'] == 'new-household'
        assert data['household']['join_code'] == 'ABC123'
    
    def test_create_household_no_name(self, client_with_service, mock_household_service):
        """Test creating household without name"""
        response = client_with_service.post(
            '/api/households',
            data=json.dumps({}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'error' in data
    
    def test_create_household_already_member(self, client_with_service, mock_household_service):
        """Test creating household when already in one"""
        # Setup
        mock_household_service.create_household.side_effect = ValidationException(
            'You are already a member of a household'
        )
        
        # Execute
        response = client_with_service.post(
            '/api/households',
            data=json.dumps({'name': 'My Family'}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'already a member' in data['error']
    
    # =========================================================================
    # POST /api/households/join tests
    # =========================================================================
    
    def test_join_household_success(self, client_with_service, mock_household_service):
        """Test joining a household with valid code"""
        # Setup
        mock_household_service.join_household.return_value = {
            'id': 'household-123',
            'name': 'Other Family',
            'role': 'member'
        }
        
        # Execute
        response = client_with_service.post(
            '/api/households/join',
            data=json.dumps({'join_code': 'ABC123'}),
            content_type='application/json',
            headers={'X-User-Id': 'user-789'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['household']['name'] == 'Other Family'
        assert data['household']['role'] == 'member'
    
    def test_join_household_invalid_code(self, client_with_service, mock_household_service):
        """Test joining with invalid code"""
        # Setup
        mock_household_service.join_household.side_effect = ValidationException(
            'Invalid join code'
        )
        
        # Execute
        response = client_with_service.post(
            '/api/households/join',
            data=json.dumps({'join_code': 'BADCODE'}),
            content_type='application/json',
            headers={'X-User-Id': 'user-789'}
        )
        
        # Verify
        assert response.status_code == 400
        data = json.loads(response.data)
        assert 'Invalid' in data['error']
    
    def test_join_household_no_code(self, client_with_service):
        """Test joining without code"""
        response = client_with_service.post(
            '/api/households/join',
            data=json.dumps({}),
            content_type='application/json',
            headers={'X-User-Id': 'user-789'}
        )
        
        assert response.status_code == 400
    
    # =========================================================================
    # POST /api/households/leave tests
    # =========================================================================
    
    def test_leave_household_success(self, client_with_service, mock_household_service):
        """Test leaving household"""
        # Setup
        mock_household_service.leave_household.return_value = None
        
        # Execute
        response = client_with_service.post(
            '/api/households/leave',
            headers={'X-User-Id': 'user-789'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'Successfully left' in data['message']
    
    def test_leave_household_owner_with_members(self, client_with_service, mock_household_service):
        """Test owner cannot leave with members"""
        # Setup
        mock_household_service.leave_household.side_effect = AuthorizationException(
            'Cannot leave as owner while other members exist'
        )
        
        # Execute
        response = client_with_service.post(
            '/api/households/leave',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 403
        data = json.loads(response.data)
        assert 'Cannot leave' in data['error']
    
    # =========================================================================
    # GET /api/households/members tests
    # =========================================================================
    
    def test_get_members_success(self, client_with_service, mock_household_service):
        """Test getting household members"""
        # Setup
        mock_household_service.get_members.return_value = [
            {'user_id': 'user-456', 'role': 'owner'},
            {'user_id': 'user-789', 'role': 'member'}
        ]
        
        # Execute
        response = client_with_service.get(
            '/api/households/members',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert len(data['members']) == 2
    
    def test_get_members_not_in_household(self, client_with_service, mock_household_service):
        """Test getting members when not in household"""
        # Setup
        mock_household_service.get_members.side_effect = ValidationException(
            'You are not a member of any household'
        )
        
        # Execute
        response = client_with_service.get(
            '/api/households/members',
            headers={'X-User-Id': 'user-123'}
        )
        
        # Verify
        assert response.status_code == 400
    
    # =========================================================================
    # DELETE /api/households/members/<id> tests
    # =========================================================================
    
    def test_remove_member_success(self, client_with_service, mock_household_service):
        """Test removing a member"""
        # Setup
        mock_household_service.remove_member.return_value = None
        
        # Execute
        response = client_with_service.delete(
            '/api/households/members/user-789',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert 'removed' in data['message']
    
    def test_remove_member_not_owner(self, client_with_service, mock_household_service):
        """Test non-owner cannot remove members"""
        # Setup
        mock_household_service.remove_member.side_effect = AuthorizationException(
            'Only the household owner can remove members'
        )
        
        # Execute
        response = client_with_service.delete(
            '/api/households/members/user-456',
            headers={'X-User-Id': 'user-789'}
        )
        
        # Verify
        assert response.status_code == 403
    
    # =========================================================================
    # POST /api/households/code tests
    # =========================================================================
    
    def test_regenerate_code_success(self, client_with_service, mock_household_service):
        """Test regenerating join code"""
        # Setup
        mock_household_service.regenerate_join_code.return_value = 'XYZ789'
        
        # Execute
        response = client_with_service.post(
            '/api/households/code',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['join_code'] == 'XYZ789'
    
    def test_regenerate_code_not_owner(self, client_with_service, mock_household_service):
        """Test non-owner cannot regenerate code"""
        # Setup
        mock_household_service.regenerate_join_code.side_effect = AuthorizationException(
            'Only the household owner can regenerate the join code'
        )
        
        # Execute
        response = client_with_service.post(
            '/api/households/code',
            headers={'X-User-Id': 'user-789'}
        )
        
        # Verify
        assert response.status_code == 403
    
    # =========================================================================
    # PUT /api/households/name tests
    # =========================================================================
    
    def test_update_name_success(self, client_with_service, mock_household_service):
        """Test updating household name"""
        # Setup
        mock_household_service.update_household_name.return_value = {
            'id': 'household-123',
            'name': 'New Family Name',
            'role': 'owner'
        }
        
        # Execute
        response = client_with_service.put(
            '/api/households/name',
            data=json.dumps({'name': 'New Family Name'}),
            content_type='application/json',
            headers={'X-User-Id': 'user-456'}
        )
        
        # Verify
        assert response.status_code == 200
        data = json.loads(response.data)
        assert data['household']['name'] == 'New Family Name'
    
    def test_update_name_not_owner(self, client_with_service, mock_household_service):
        """Test non-owner cannot update name"""
        # Setup
        mock_household_service.update_household_name.side_effect = AuthorizationException(
            'Only the household owner can update the name'
        )
        
        # Execute
        response = client_with_service.put(
            '/api/households/name',
            data=json.dumps({'name': 'New Name'}),
            content_type='application/json',
            headers={'X-User-Id': 'user-789'}
        )
        
        # Verify
        assert response.status_code == 403

    # =========================================================================
    # POST /api/households/dietary/merge tests
    # =========================================================================

    def test_merge_dietary_success(self, client_with_service, mock_household_service):
        mock_household_service.merge_dietary_restrictions.return_value = {
            "id": "household-123",
            "name": "Test Family",
            "dietary_restrictions": ["peanuts", "shellfish"],
            "role": "member",
        }

        response = client_with_service.post(
            "/api/households/dietary/merge",
            data=json.dumps({"dietary_restrictions": ["shellfish"]}),
            content_type="application/json",
            headers={"X-User-Id": "user-789"},
        )

        assert response.status_code == 200
        data = json.loads(response.data)
        assert "shellfish" in data["household"]["dietary_restrictions"]
        mock_household_service.merge_dietary_restrictions.assert_called_once_with(
            "user-789", dietary_restrictions=["shellfish"]
        )

    def test_merge_dietary_no_household(self, client_with_service, mock_household_service):
        mock_household_service.merge_dietary_restrictions.side_effect = ValidationException(
            "You are not a member of any household"
        )

        response = client_with_service.post(
            "/api/households/dietary/merge",
            data=json.dumps({"dietary_restrictions": ["shellfish"]}),
            content_type="application/json",
            headers={"X-User-Id": "user-789"},
        )

        assert response.status_code == 400

    def test_merge_dietary_no_user_id(self, client_with_service):
        response = client_with_service.post(
            "/api/households/dietary/merge",
            data=json.dumps({"dietary_restrictions": ["shellfish"]}),
            content_type="application/json",
        )

        assert response.status_code == 401
