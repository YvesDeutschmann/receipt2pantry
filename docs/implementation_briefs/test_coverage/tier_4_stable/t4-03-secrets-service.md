# T4-03 — `backend/services/secrets_service.py`

> **Tier:** 4 — Stable
> **Why worth testing:** Wraps AWS Secrets Manager. Small but security-critical: a regression could log secrets, swallow `ClientError`, or use the wrong region. No dedicated test file.

---

## 1. Technical Contract

- **File:** `backend/services/secrets_service.py`
- **Class:** `SecretsService(region, access_key_id=None, secret_access_key=None)`
- **Methods (entry points — confirm from file):**
  - `get_secret(name) -> dict`
  - `put_secret(name, value: dict)`
  - `delete_secret(name)`
- **Exceptions:** `SecretsNotFoundException`, `ConfigurationException`.

---

## 2. Logic Guardrails

- **IAM role fallback:** when `access_key_id` / `secret_access_key` are both absent, use default credential chain (no explicit keys to boto3).
- **JSON shape:** stored secrets are JSON objects; `get_secret` must return a dict (json.loads the `SecretString`).
- **`ResourceNotFoundException` mapping:** raise `SecretsNotFoundException`, not a generic `DatabaseException` or the raw boto3 error.
- **No secret logging:** no `logger.info(value)` for the decrypted payload. Tests can assert with `caplog`.
- **Region propagation:** every boto3 call uses the injected region.
- **Idempotency of put:** calling `put_secret` twice with the same value is safe (underlying `update_secret` or `create_secret` branching must not raise on duplicate).

---

## 3. Test-First Suite

Create `tests/backend/test_services/test_secrets_service.py`.

### Test group A — construction

1. `test_uses_iam_role_when_keys_absent`
2. `test_uses_explicit_keys_when_provided`
3. `test_region_propagated_to_boto3_client`

### Test group B — get_secret

4. `test_get_secret_parses_SecretString_as_json`
5. `test_get_secret_raises_SecretsNotFoundException_on_ResourceNotFoundException`
6. `test_get_secret_reraises_other_ClientError`

### Test group C — put_secret

7. `test_put_secret_calls_create_when_not_exists`
8. `test_put_secret_calls_update_when_exists`
9. `test_put_secret_is_idempotent_for_same_value`

### Test group D — security

10. `test_decrypted_secret_value_never_logged` (caplog assertion)

---

## 4. Definition of Done

- ≥ 8 test cases.
- Secret value never appears in log records (test 10).
- All boto3 calls mocked with `botocore.stub.Stubber` or `unittest.mock`.
- `ResourceNotFoundException` → `SecretsNotFoundException` mapping locked in.
