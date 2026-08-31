-- Supabase Vault RPC wrappers for backend grocery credential storage.
-- Callable only via service_role (admin_client). Matches SupabaseVaultService in secrets_service.py.

create extension if not exists supabase_vault with schema vault;

-- Replace any prior versions (signatures/return types may differ).
drop function if exists public.vault_create_secret(text, text, text);
drop function if exists public.vault_get_secret_by_name(text);
drop function if exists public.vault_update_secret_by_name(text, text);
drop function if exists public.vault_delete_secret_by_name(text);

-- Create secret; returns vault secret UUID.
create or replace function public.vault_create_secret(
    secret text,
    unique_name text,
    description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
    new_id uuid;
begin
    new_id := vault.create_secret(secret, unique_name, description);
    return new_id;
end;
$$;

-- Read decrypted secret by unique name; returns NULL if not found.
create or replace function public.vault_get_secret_by_name(secret_name text)
returns text
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
    decrypted text;
begin
    select ds.decrypted_secret
    into decrypted
    from vault.decrypted_secrets ds
    where ds.name = secret_name
    limit 1;

    return decrypted;
end;
$$;

-- Update secret value by unique name; no-op if name not found.
create or replace function public.vault_update_secret_by_name(
    secret_name text,
    new_secret text
)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
declare
    secret_id uuid;
begin
    select ds.id
    into secret_id
    from vault.decrypted_secrets ds
    where ds.name = secret_name
    limit 1;

    if secret_id is null then
        raise exception 'Vault secret not found: %', secret_name;
    end if;

    perform vault.update_secret(secret_id, new_secret);
end;
$$;

-- Delete secret by unique name.
create or replace function public.vault_delete_secret_by_name(secret_name text)
returns void
language plpgsql
security definer
set search_path = public, vault, extensions
as $$
begin
    delete from vault.secrets s
    where s.name = secret_name;
end;
$$;

revoke all on function public.vault_create_secret(text, text, text) from public;
revoke all on function public.vault_get_secret_by_name(text) from public;
revoke all on function public.vault_update_secret_by_name(text, text) from public;
revoke all on function public.vault_delete_secret_by_name(text) from public;

revoke all on function public.vault_create_secret(text, text, text) from anon, authenticated;
revoke all on function public.vault_get_secret_by_name(text) from anon, authenticated;
revoke all on function public.vault_update_secret_by_name(text, text) from anon, authenticated;
revoke all on function public.vault_delete_secret_by_name(text) from anon, authenticated;

grant execute on function public.vault_create_secret(text, text, text) to service_role;
grant execute on function public.vault_get_secret_by_name(text) to service_role;
grant execute on function public.vault_update_secret_by_name(text, text) to service_role;
grant execute on function public.vault_delete_secret_by_name(text) to service_role;

comment on column public.grocery_accounts.vault_key_id is
    'Supabase Vault secret name containing encrypted provider credentials';
