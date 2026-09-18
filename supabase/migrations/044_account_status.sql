-- =========================================================
-- ACCOUNT STATUS
-- Platform-controlled lifecycle for customer accounts.
-- Existing accounts table / account roles remain untouched.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.account_statuses (
  account_id UUID PRIMARY KEY
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'expired')),

  reason TEXT,

  status_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.account_statuses ENABLE ROW LEVEL SECURITY;

-- Keep updated_at automatic.
DROP TRIGGER IF EXISTS set_updated_at ON public.account_statuses;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.account_statuses
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================
-- BACKFILL EXISTING ACCOUNTS
-- Every existing client starts as ACTIVE.
-- =========================================================

INSERT INTO public.account_statuses (account_id)
SELECT id
FROM public.accounts
ON CONFLICT (account_id) DO NOTHING;


-- =========================================================
-- FUTURE ACCOUNTS
-- Automatically create ACTIVE status for every new account.
-- =========================================================

CREATE OR REPLACE FUNCTION public.ensure_account_status_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.account_statuses (account_id)
  VALUES (NEW.id)
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.ensure_account_status_row()
FROM PUBLIC;

DROP TRIGGER IF EXISTS create_account_status_after_account_insert
ON public.accounts;

CREATE TRIGGER create_account_status_after_account_insert
AFTER INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.ensure_account_status_row();


-- =========================================================
-- READ ACCESS
-- Client members can read only their own account status.
-- Platform admins can read every account status.
-- =========================================================

DROP POLICY IF EXISTS account_statuses_select
ON public.account_statuses;

CREATE POLICY account_statuses_select
ON public.account_statuses
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_account_member(account_id, 'viewer')
);


-- =========================================================
-- WRITE SECURITY
-- Normal authenticated users get NO direct write access.
-- Status changes happen only through the secure RPC below.
-- =========================================================

REVOKE INSERT, UPDATE, DELETE
ON TABLE public.account_statuses
FROM anon, authenticated;

GRANT SELECT
ON TABLE public.account_statuses
TO authenticated;

GRANT ALL
ON TABLE public.account_statuses
TO service_role;


-- =========================================================
-- PLATFORM ADMIN RPC
-- Only an active platform admin can change account status.
-- =========================================================

CREATE OR REPLACE FUNCTION public.set_account_status(
  p_account_id UUID,
  p_status TEXT,
  p_reason TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Platform admin access required'
      USING ERRCODE = '42501';
  END IF;

  IF p_status NOT IN ('active', 'suspended', 'expired') THEN
    RAISE EXCEPTION 'Invalid account status';
  END IF;

  UPDATE public.account_statuses
  SET
    status_changed_at =
      CASE
        WHEN status IS DISTINCT FROM p_status THEN NOW()
        ELSE status_changed_at
      END,
    status = p_status,
    reason = NULLIF(BTRIM(p_reason), '')
  WHERE account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account status not found';
  END IF;
END;
$$;

REVOKE ALL
ON FUNCTION public.set_account_status(UUID, TEXT, TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.set_account_status(UUID, TEXT, TEXT)
TO authenticated, service_role;