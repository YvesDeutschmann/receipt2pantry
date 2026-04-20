"""Tests for HouseholdService"""

import pytest
from unittest.mock import Mock, MagicMock

from backend.services.household_service import (
    JOIN_CODE_CHARS,
    JOIN_CODE_LENGTH,
    HouseholdService,
)
from backend.utils.exceptions import ValidationException, AuthorizationException, DatabaseException


class TestHouseholdService:
    """Test cases for HouseholdService"""
    
    @pytest.fixture
    def mock_supabase(self):
        """Create mock supabase service"""
        mock = Mock()
        mock.client = MagicMock()
        mock.admin_client = MagicMock()
        return mock
    
    @pytest.fixture
    def household_service(self, mock_supabase):
        """Create HouseholdService with mocked dependencies"""
        return HouseholdService(mock_supabase)
    
    @pytest.fixture
    def sample_household(self):
        """Sample household data"""
        return {
            'id': 'household-123',
            'name': 'Test Family',
            'join_code': 'ABC123',
            'created_by': 'user-456',
            'created_at': '2025-01-01T00:00:00Z',
            'role': 'owner'
        }
    
    @pytest.fixture
    def sample_members(self):
        """Sample household members"""
        return [
            {'id': 'member-1', 'household_id': 'household-123', 'user_id': 'user-456', 'role': 'owner'},
            {'id': 'member-2', 'household_id': 'household-123', 'user_id': 'user-789', 'role': 'member'}
        ]
    
    # =========================================================================
    # create_household tests
    # =========================================================================
    
    def test_create_household_success(self, household_service, mock_supabase):
        """Test creating a new household successfully"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        mock_supabase.is_join_code_unique.return_value = True
        mock_supabase.create_household.return_value = {
            'id': 'new-household',
            'name': 'My Family',
            'join_code': 'XYZ789',
            'created_at': '2025-01-01T00:00:00Z'
        }
        
        # Execute
        result = household_service.create_household('user-123', 'My Family')
        
        # Verify
        assert result['id'] == 'new-household'
        assert result['name'] == 'My Family'
        assert result['role'] == 'owner'
        mock_supabase.create_household.assert_called_once()
    
    def test_create_household_already_in_household(self, household_service, mock_supabase, sample_household):
        """Test creating household when user already in one"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.create_household('user-456', 'New Family')
        
        assert 'already a member' in str(exc_info.value)
    
    def test_create_household_empty_name(self, household_service, mock_supabase):
        """Test creating household with empty name"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.create_household('user-123', '   ')
        
        assert 'name is required' in str(exc_info.value)
    
    def test_create_household_name_too_long(self, household_service, mock_supabase):
        """Test creating household with name exceeding max length"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.create_household('user-123', 'x' * 101)
        
        assert '100 characters' in str(exc_info.value)
    
    def test_create_household_membership_failure_rolls_back(self, mock_supabase):
        """Test that household is deleted if membership creation fails"""
        from backend.services.household_service import HouseholdService
        from backend.utils.exceptions import DatabaseException
        
        # Setup - household creation succeeds but membership fails
        mock_supabase.get_user_household.return_value = None
        mock_supabase.is_join_code_unique.return_value = True
        mock_supabase.create_household.side_effect = DatabaseException(
            "Failed to create household membership: membership insert error"
        )
        
        service = HouseholdService(mock_supabase)
        
        # Execute & Verify
        with pytest.raises(DatabaseException) as exc_info:
            service.create_household('user-123', 'My Family')
        
        assert 'membership' in str(exc_info.value).lower()
    
    # =========================================================================
    # join_household tests
    # =========================================================================
    
    def test_join_household_success(self, household_service, mock_supabase):
        """Test joining household with valid code"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        mock_supabase.get_household_by_code.return_value = {
            'id': 'household-123',
            'name': 'Other Family',
            'join_code': 'ABC123',
            'created_at': '2025-01-01T00:00:00Z'
        }
        mock_supabase.add_household_member.return_value = 'member-id'
        
        # Execute
        result = household_service.join_household('user-789', 'ABC123')
        
        # Verify
        assert result['id'] == 'household-123'
        assert result['name'] == 'Other Family'
        assert result['role'] == 'member'
        mock_supabase.add_household_member.assert_called_once_with('household-123', 'user-789', 'member')
    
    def test_join_household_already_in_household(self, household_service, mock_supabase, sample_household):
        """Test joining when user already in a household"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_by_code.return_value = None

        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.join_household('user-456', 'XYZ789')
        
        assert 'already a member' in str(exc_info.value)
    
    def test_join_household_invalid_code(self, household_service, mock_supabase):
        """Test joining with invalid code"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        mock_supabase.get_household_by_code.return_value = None
        
        # Execute & Verify - use 6 char code that doesn't exist
        with pytest.raises(ValidationException) as exc_info:
            household_service.join_household('user-123', 'XXXXXX')
        
        assert 'Invalid join code' in str(exc_info.value)
    
    def test_join_household_wrong_code_length(self, household_service, mock_supabase):
        """Test joining with wrong code length"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.join_household('user-123', 'ABC')
        
        assert '6 characters' in str(exc_info.value)
    
    # =========================================================================
    # leave_household tests
    # =========================================================================
    
    def test_leave_household_member_success(self, household_service, mock_supabase, sample_members):
        """Test member leaving household"""
        # Setup
        mock_supabase.get_user_household.return_value = {
            'id': 'household-123',
            'name': 'Test Family',
            'role': 'member'
        }
        
        # Execute
        household_service.leave_household('user-789')
        
        # Verify
        mock_supabase.remove_household_member.assert_called_once_with('user-789')
    
    def test_leave_household_owner_sole_member(self, household_service, mock_supabase):
        """Test owner leaving when they're the only member (deletes household)"""
        # Setup
        mock_supabase.get_user_household.return_value = {
            'id': 'household-123',
            'name': 'Test Family',
            'role': 'owner'
        }
        mock_supabase.get_household_members.return_value = [
            {'user_id': 'user-456', 'role': 'owner'}
        ]
        
        # Execute
        household_service.leave_household('user-456')
        
        # Verify
        mock_supabase.delete_household.assert_called_once_with('household-123')
    
    def test_leave_household_owner_with_members(self, household_service, mock_supabase, sample_members):
        """Test owner cannot leave with other members"""
        # Setup
        mock_supabase.get_user_household.return_value = {
            'id': 'household-123',
            'name': 'Test Family',
            'role': 'owner'
        }
        mock_supabase.get_household_members.return_value = sample_members
        
        # Execute & Verify
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.leave_household('user-456')
        
        assert 'Cannot leave as owner' in str(exc_info.value)
    
    def test_leave_household_not_member(self, household_service, mock_supabase):
        """Test leaving when not in any household"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.leave_household('user-123')
        
        assert 'not a member' in str(exc_info.value)
    
    # =========================================================================
    # get_household tests
    # =========================================================================
    
    def test_get_household_exists(self, household_service, mock_supabase, sample_household):
        """Test getting household when user has one"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        
        # Execute
        result = household_service.get_household('user-456')
        
        # Verify
        assert result == sample_household
    
    def test_get_household_none(self, household_service, mock_supabase):
        """Test getting household when user has none"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        
        # Execute
        result = household_service.get_household('user-123')
        
        # Verify
        assert result is None
    
    # =========================================================================
    # get_members tests
    # =========================================================================
    
    def test_get_members_success(self, household_service, mock_supabase, sample_household, sample_members):
        """Test getting household members"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.get_household_members.return_value = sample_members
        
        # Execute
        result = household_service.get_members('user-456')
        
        # Verify
        assert len(result) == 2
        mock_supabase.get_household_members.assert_called_once_with('household-123')
    
    def test_get_members_not_in_household(self, household_service, mock_supabase):
        """Test getting members when not in a household"""
        # Setup
        mock_supabase.get_user_household.return_value = None
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.get_members('user-123')
        
        assert 'not a member' in str(exc_info.value)
    
    # =========================================================================
    # regenerate_join_code tests
    # =========================================================================
    
    def test_regenerate_code_owner_success(self, household_service, mock_supabase, sample_household):
        """Test owner regenerating join code"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        mock_supabase.is_join_code_unique.return_value = True
        
        # Execute
        result = household_service.regenerate_join_code('user-456')
        
        # Verify
        assert len(result) == 6
        mock_supabase.update_household.assert_called_once()
    
    def test_regenerate_code_member_fails(self, household_service, mock_supabase):
        """Test member cannot regenerate code"""
        # Setup
        mock_supabase.get_user_household.return_value = {
            'id': 'household-123',
            'name': 'Test Family',
            'role': 'member'
        }
        
        # Execute & Verify
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.regenerate_join_code('user-789')
        
        assert 'owner' in str(exc_info.value)
    
    # =========================================================================
    # remove_member tests
    # =========================================================================
    
    def test_remove_member_owner_success(self, household_service, mock_supabase, sample_household):
        """Test owner removing a member"""
        # Setup
        mock_supabase.get_user_household.side_effect = [
            sample_household,  # First call: owner's household
            {'id': 'household-123', 'role': 'member'}  # Second call: target's household
        ]
        
        # Execute
        household_service.remove_member('user-456', 'user-789')
        
        # Verify
        mock_supabase.remove_household_member.assert_called_once_with('user-789')
    
    def test_remove_member_not_owner(self, household_service, mock_supabase):
        """Test member cannot remove others"""
        # Setup
        mock_supabase.get_user_household.return_value = {
            'id': 'household-123',
            'role': 'member'
        }
        
        # Execute & Verify
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.remove_member('user-789', 'user-123')
        
        assert 'owner' in str(exc_info.value)
    
    def test_remove_member_cannot_remove_self(self, household_service, mock_supabase, sample_household):
        """Test owner cannot remove self (use leave instead)"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        
        # Execute & Verify
        with pytest.raises(ValidationException) as exc_info:
            household_service.remove_member('user-456', 'user-456')
        
        assert 'Cannot remove yourself' in str(exc_info.value)
    
    # =========================================================================
    # update_household_name tests
    # =========================================================================
    
    def test_update_name_owner_success(self, household_service, mock_supabase, sample_household):
        """Test owner updating household name"""
        # Setup
        mock_supabase.get_user_household.return_value = sample_household
        
        # Execute
        result = household_service.update_household_name('user-456', 'New Name')
        
        # Verify
        assert result['name'] == 'New Name'
        mock_supabase.update_household.assert_called_once_with('household-123', {'name': 'New Name'})
    
    def test_update_name_member_fails(self, household_service, mock_supabase):
        """Test member cannot update name"""
        # Setup
        mock_supabase.get_user_household.return_value = {
            'id': 'household-123',
            'role': 'member'
        }
        
        # Execute & Verify
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.update_household_name('user-789', 'New Name')
        
        assert 'owner' in str(exc_info.value)

    # =========================================================================
    # T4-05 — join code generation, admin guards, lifecycle, validation
    # =========================================================================

    def test_join_code_never_contains_0_O_1_or_I(self, household_service, mock_supabase):
        forbidden = set("0O1I")
        mock_supabase.is_join_code_unique.return_value = True
        for _ in range(1000):
            code = household_service._generate_join_code()
            assert len(code) == JOIN_CODE_LENGTH
            assert not (set(code) & forbidden)
            assert all(c in JOIN_CODE_CHARS for c in code)

    def test_join_code_is_six_characters(self, household_service, mock_supabase):
        mock_supabase.is_join_code_unique.return_value = True
        code = household_service._generate_join_code()
        assert len(code) == JOIN_CODE_LENGTH

    def test_generate_retries_on_collision_up_to_ten_times(self, household_service, mock_supabase):
        mock_supabase.is_join_code_unique.side_effect = [False] * 9 + [True]
        code = household_service._generate_join_code()
        assert len(code) == JOIN_CODE_LENGTH
        assert mock_supabase.is_join_code_unique.call_count == 10

    def test_generate_raises_database_exception_after_ten_collisions(
        self, household_service, mock_supabase
    ):
        mock_supabase.is_join_code_unique.side_effect = [False] * 10
        with pytest.raises(DatabaseException, match="Failed to generate unique join code"):
            household_service._generate_join_code()
        assert mock_supabase.is_join_code_unique.call_count == 10

    def test_remove_member_requires_admin_raises_authorization_exception_otherwise(
        self, household_service, mock_supabase
    ):
        mock_supabase.get_user_household.return_value = {
            "id": "household-123",
            "name": "Test Family",
            "role": "member",
        }
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.remove_member("user-789", "user-999")
        assert "owner" in str(exc_info.value).lower()

    def test_update_household_name_admin_only(self, household_service, mock_supabase):
        mock_supabase.get_user_household.return_value = {
            "id": "household-123",
            "name": "Test Family",
            "role": "member",
        }
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.update_household_name("user-789", "New Name")
        assert "owner" in str(exc_info.value).lower()

    def test_regenerate_join_code_admin_only(self, household_service, mock_supabase):
        mock_supabase.get_user_household.return_value = {
            "id": "household-123",
            "name": "Test Family",
            "role": "member",
        }
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.regenerate_join_code("user-789")
        assert "owner" in str(exc_info.value).lower()

    def test_join_household_is_idempotent_for_same_user_and_code(
        self, household_service, mock_supabase
    ):
        hh = {
            "id": "household-123",
            "name": "Other Family",
            "join_code": "ABC123",
            "created_at": "2025-01-01T00:00:00Z",
        }

        mock_supabase.get_user_household.side_effect = [
            None,
            {"id": "household-123", "name": "Other Family", "role": "member"},
        ]
        mock_supabase.get_household_by_code.return_value = hh

        first = household_service.join_household("user-789", "ABC123")
        assert first["id"] == "household-123"
        assert first["role"] == "member"
        mock_supabase.add_household_member.assert_called_once_with(
            "household-123", "user-789", "member"
        )

        second = household_service.join_household("user-789", "ABC123")
        assert second["id"] == first["id"]
        assert second["role"] == "member"
        mock_supabase.add_household_member.assert_called_once_with(
            "household-123", "user-789", "member"
        )

    def test_leave_household_last_admin_policy_pinned(self, household_service, mock_supabase):
        """Owner cannot leave while other members exist (no auto-promotion); sole owner deletes household."""
        mock_supabase.get_user_household.return_value = {
            "id": "household-123",
            "name": "Test Family",
            "role": "owner",
        }
        mock_supabase.get_household_members.return_value = [
            {"user_id": "user-456", "role": "owner"},
            {"user_id": "user-789", "role": "member"},
        ]
        with pytest.raises(AuthorizationException) as exc_info:
            household_service.leave_household("user-456")
        assert "Cannot leave as owner" in str(exc_info.value)
        mock_supabase.delete_household.assert_not_called()
        mock_supabase.remove_household_member.assert_not_called()

    def test_remove_member_cannot_remove_self_via_that_endpoint(
        self, household_service, mock_supabase, sample_household
    ):
        mock_supabase.get_user_household.return_value = sample_household
        with pytest.raises(ValidationException) as exc_info:
            household_service.remove_member("user-456", "user-456")
        assert "Cannot remove yourself" in str(exc_info.value)

    def test_create_household_rejects_empty_name(self, household_service, mock_supabase):
        mock_supabase.get_user_household.return_value = None
        with pytest.raises(ValidationException) as exc_info:
            household_service.create_household("user-123", "")
        assert "name is required" in str(exc_info.value).lower()

    def test_update_profile_rejects_negative_size(self, household_service, mock_supabase):
        mock_supabase.get_user_household.return_value = {
            "id": "household-123",
            "name": "Test Family",
            "role": "member",
        }
        with pytest.raises(ValidationException) as exc_info:
            household_service.update_household_profile("user-789", size=-1)
        assert "between 1 and 99" in str(exc_info.value)
