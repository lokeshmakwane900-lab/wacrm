-- =========================================================
-- ACCOUNT STATUS PERMISSION HARDENING
-- Clients may READ their own account status through RLS.
-- Only trusted backend / platform-admin RPC may change it.
-- =========================================================

-- Remove inherited/default table privileges first.
REVOKE ALL PRIVILEGES
ON TABLE public.account_statuses
FROM PUBLIC;

REVOKE ALL PRIVILEGES
ON TABLE public.account_statuses
FROM anon;

REVOKE ALL PRIVILEGES
ON TABLE public.account_statuses
FROM authenticated;

REVOKE ALL PRIVILEGES
ON TABLE public.account_statuses
FROM service_role;


-- Normal signed-in users only need SELECT.
-- RLS still decides which account row they can actually see.
GRANT SELECT
ON TABLE public.account_statuses
TO authenticated;


-- Trusted server-side service role gets only required CRUD.
-- No TRUNCATE / TRIGGER / REFERENCES privileges.
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.account_statuses
TO service_role;


-- Anonymous users receive no access.
-- Explicitly keep them locked out.
REVOKE ALL PRIVILEGES
ON TABLE public.account_statuses
FROM anon;


-- Harden internal trigger function.
REVOKE ALL PRIVILEGES
ON FUNCTION public.ensure_account_status_row()
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.ensure_account_status_row()
TO service_role;


-- Harden platform-admin status-changing RPC.
REVOKE ALL PRIVILEGES
ON FUNCTION public.set_account_status(UUID, TEXT, TEXT)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.set_account_status(UUID, TEXT, TEXT)
TO authenticated, service_role;