"""Tests for `SecretsService` — AWS Secrets Manager client mocked via Stubber / unittest.mock."""

import json
import logging
from unittest.mock import MagicMock, patch

import boto3
import pytest
from botocore.exceptions import ClientError
from botocore.stub import Stubber

from backend.services import secrets_service as secrets_service_module
from backend.services.secrets_service import SecretsService
from backend.utils.exceptions import ConfigurationException, SecretsNotFoundException


def _sm_client():
    """Real boto3 client shape (no network) for exception factories and Stubber."""
    return boto3.client("secretsmanager", region_name="us-west-2")


def test_uses_iam_role_when_keys_absent():
    with patch("backend.services.secrets_service.boto3.client") as mock_client:
        mock_client.return_value = MagicMock()
        SecretsService("us-west-1")

    mock_client.assert_called_once_with("secretsmanager", region_name="us-west-1")
    kwargs = mock_client.call_args.kwargs
    assert "aws_access_key_id" not in kwargs
    assert "aws_secret_access_key" not in kwargs


def test_uses_explicit_keys_when_provided():
    with patch("backend.services.secrets_service.boto3.client") as mock_client:
        mock_client.return_value = MagicMock()
        SecretsService(
            "eu-central-1",
            access_key_id="AKIATESTKEY",
            secret_access_key="secret-key-value",
        )

    mock_client.assert_called_once_with(
        "secretsmanager",
        region_name="eu-central-1",
        aws_access_key_id="AKIATESTKEY",
        aws_secret_access_key="secret-key-value",
    )


def test_region_propagated_to_boto3_client():
    with patch("backend.services.secrets_service.boto3.client") as mock_client:
        mock_client.return_value = MagicMock()
        SecretsService("ap-southeast-2")

    assert mock_client.call_args.kwargs["region_name"] == "ap-southeast-2"


def test_get_secret_parses_SecretString_as_json():
    client = boto3.client("secretsmanager", region_name="us-east-1")
    secret_id = "grocerysync/user-1/safeway/credentials"
    payload = {"refresh_token": "rt", "access_token": "at"}

    with Stubber(client) as stubber:
        stubber.add_response(
            "get_secret_value",
            {
                "ARN": "arn:aws:secretsmanager:us-east-1:1:secret:x",
                "Name": secret_id,
                "SecretString": json.dumps(payload),
                "VersionId": "a" * 32,
                "CreatedDate": "2020-01-01T00:00:00Z",
            },
            expected_params={"SecretId": secret_id},
        )

        with patch("backend.services.secrets_service.boto3.client", return_value=client):
            svc = SecretsService("us-east-1")
            out = svc.retrieve_user_credentials("user-1", "safeway")

    assert out == payload


def test_get_secret_raises_SecretsNotFoundException_on_ResourceNotFoundException():
    sm = _sm_client()
    rnf = sm.exceptions.ResourceNotFoundException(
        {"Error": {"Code": "ResourceNotFoundException", "Message": "not found"}},
        "GetSecretValue",
    )
    mock_client = MagicMock()
    mock_client.get_secret_value.side_effect = rnf
    mock_client.exceptions.ResourceNotFoundException = sm.exceptions.ResourceNotFoundException

    with patch("backend.services.secrets_service.boto3.client", return_value=mock_client):
        svc = SecretsService("us-west-2")

    with pytest.raises(SecretsNotFoundException):
        svc.retrieve_user_credentials("missing", "safeway")


def test_get_secret_reraises_other_ClientError():
    sm = _sm_client()
    mock_client = MagicMock()
    mock_client.get_secret_value.side_effect = ClientError(
        {"Error": {"Code": "AccessDeniedException", "Message": "denied"}},
        "GetSecretValue",
    )
    mock_client.exceptions.ResourceNotFoundException = sm.exceptions.ResourceNotFoundException

    with patch("backend.services.secrets_service.boto3.client", return_value=mock_client):
        svc = SecretsService("us-west-2")

    with pytest.raises(ConfigurationException, match="Failed to retrieve credentials"):
        svc.retrieve_user_credentials("u", "qfc")


def test_put_secret_calls_create_when_not_exists():
    sm = _sm_client()
    mock_client = MagicMock()
    mock_client.create_secret.return_value = {"ARN": "arn:create"}
    mock_client.exceptions.ResourceExistsException = sm.exceptions.ResourceExistsException

    with patch("backend.services.secrets_service.boto3.client", return_value=mock_client):
        svc = SecretsService("us-west-2")

    arn = svc.store_user_credentials("u1", "safeway", {"k": "v"})

    assert arn == "arn:create"
    mock_client.create_secret.assert_called_once()
    mock_client.update_secret.assert_not_called()
    call_kw = mock_client.create_secret.call_args.kwargs
    assert call_kw["Name"] == "grocerysync/u1/safeway/credentials"
    assert json.loads(call_kw["SecretString"]) == {"k": "v"}


def test_put_secret_calls_update_when_exists():
    sm = _sm_client()
    rex = sm.exceptions.ResourceExistsException(
        {"Error": {"Code": "ResourceExistsException", "Message": "exists"}},
        "CreateSecret",
    )
    mock_client = MagicMock()
    mock_client.create_secret.side_effect = rex
    mock_client.update_secret.return_value = {"ARN": "arn:update"}
    mock_client.exceptions.ResourceExistsException = sm.exceptions.ResourceExistsException

    with patch("backend.services.secrets_service.boto3.client", return_value=mock_client):
        svc = SecretsService("us-west-2")

    arn = svc.store_user_credentials("u2", "costco", {"a": "b"})

    assert arn == "arn:update"
    mock_client.update_secret.assert_called_once()
    upd_kw = mock_client.update_secret.call_args.kwargs
    assert upd_kw["SecretId"] == "grocerysync/u2/costco/credentials"
    assert json.loads(upd_kw["SecretString"]) == {"a": "b"}


def test_put_secret_is_idempotent_for_same_value():
    sm = _sm_client()
    rex = sm.exceptions.ResourceExistsException(
        {"Error": {"Code": "ResourceExistsException", "Message": "exists"}},
        "CreateSecret",
    )
    mock_client = MagicMock()
    # First store: create succeeds. Second store: create reports exists → update succeeds.
    mock_client.create_secret.side_effect = [
        {"ARN": "arn:first"},
        rex,
    ]
    mock_client.update_secret.return_value = {"ARN": "arn:next"}
    mock_client.exceptions.ResourceExistsException = sm.exceptions.ResourceExistsException

    with patch("backend.services.secrets_service.boto3.client", return_value=mock_client):
        svc = SecretsService("us-west-2")

    creds = {"token": "same"}
    a1 = svc.store_user_credentials("u3", "safeway", creds)
    a2 = svc.store_user_credentials("u3", "safeway", creds)

    assert mock_client.create_secret.call_count == 2
    assert mock_client.update_secret.call_count == 1
    assert a1 == "arn:first"
    assert a2 == "arn:next"


def test_decrypted_secret_value_never_logged(caplog):
    client = boto3.client("secretsmanager", region_name="us-east-1")
    secret_id = "grocerysync/u9/safeway/credentials"
    sensitive = "DO_NOT_LOG_THIS_PLAINTEXT_SECRET"

    with Stubber(client) as stubber:
        stubber.add_response(
            "get_secret_value",
            {
                "ARN": "arn:aws:secretsmanager:us-east-1:1:secret:y",
                "Name": secret_id,
                "SecretString": json.dumps({"password": sensitive}),
                "VersionId": "b" * 32,
                "CreatedDate": "2020-01-01T00:00:00Z",
            },
            expected_params={"SecretId": secret_id},
        )

        with patch("backend.services.secrets_service.boto3.client", return_value=client):
            svc = SecretsService("us-east-1")

        caplog.set_level(logging.INFO)
        # Module logger does not propagate; attach caplog handler so records are visible.
        svc_logger = secrets_service_module.logger
        svc_logger.addHandler(caplog.handler)
        try:
            svc.retrieve_user_credentials("u9", "safeway")
        finally:
            svc_logger.removeHandler(caplog.handler)

    combined = " ".join(r.getMessage() for r in caplog.records) + caplog.text
    assert sensitive not in combined
