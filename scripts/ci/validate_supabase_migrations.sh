#!/usr/bin/env bash
# Apply supabase_stub.sql + every migration in supabase/migrations/ in order.
# Exits non-zero on the first migration failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../" && pwd)"
MIG_DIR="$ROOT/supabase/migrations"
STUB="$ROOT/scripts/ci/supabase_stub.sql"
DB="${1:-r2p_migrations_ci}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found; install PostgreSQL client/server to run migration validation"
  exit 1
fi

run_sql() {
  psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$1"
}

# When invoked as root (CI), use the postgres superuser account.
PSQL_USER="${PGUSER:-postgres}"
if [[ "$(id -u)" -eq 0 ]] && id postgres &>/dev/null; then
  PSQL_USER=postgres
fi
export PGUSER="$PSQL_USER"

psql -q -c "DROP DATABASE IF EXISTS $DB;" >/dev/null 2>&1 || true
psql -q -c "CREATE DATABASE $DB;"

echo "=== applying supabase stub ==="
run_sql "$STUB"

fail=0
for f in "$MIG_DIR"/*.sql; do
  name=$(basename "$f")
  if out=$(run_sql "$f" 2>&1); then
    printf 'OK    %s\n' "$name"
    if [[ -n "$out" ]]; then
      echo "$out" | sed 's/^/        /'
    fi
  else
    printf 'FAIL  %s\n' "$name"
    echo "$out" | sed 's/^/        /'
    fail=1
    break
  fi
done

if [[ "$fail" -eq 0 ]]; then
  echo "=== re-running 024 + 025 for idempotency ==="
  for f in 024_postgres_best_practices_hardening.sql 025_postgres_review_followups.sql; do
    if out=$(run_sql "$MIG_DIR/$f" 2>&1); then
      printf 'RE-RUN OK %s\n' "$f"
    else
      printf 'RE-RUN FAIL %s\n' "$f"
      echo "$out" | sed 's/^/        /'
      fail=1
      break
    fi
  done
fi

if [[ "$fail" -eq 0 ]]; then
  echo "All migrations applied successfully."
fi

exit "$fail"
