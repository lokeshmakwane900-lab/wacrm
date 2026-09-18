-- =========================================================
-- ACCOUNT PLANS
-- Assign one current SaaS plan to each customer account.
-- Pricing/limits remain editable in public.plans.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.account_plans (
  account_id UUID PRIMARY KEY
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  plan_id UUID NOT NULL
    REFERENCES public.plans(id) ON DELETE RESTRICT,

  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,

  cancelled_at TIMESTAMPTZ,

  assigned_by_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT account_plans_valid_dates
    CHECK (expires_at IS NULL OR expires_at > starts_at)
);


-- =========================================================
-- UPDATED AT
-- =========================================================

DROP TRIGGER IF EXISTS set_updated_at
ON public.account_plans;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.account_plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_account_plans_plan_id
ON public.account_plans(plan_id);

CREATE INDEX IF NOT EXISTS idx_account_plans_expires_at
ON public.account_plans(expires_at);


-- =========================================================
-- ROW LEVEL SECURITY
-- Account members may read their own plan.
-- Platform admins may read every account plan.
-- =========================================================

ALTER TABLE public.account_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_plans_select
ON public.account_plans;

CREATE POLICY account_plans_select
ON public.account_plans
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_account_member(account_id, 'viewer')
);


-- =========================================================
-- TABLE PRIVILEGES
-- Normal users = SELECT only.
-- Direct writes are blocked.
-- =========================================================

REVOKE ALL PRIVILEGES
ON TABLE public.account_plans
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.account_plans
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.account_plans
TO service_role;


-- =========================================================
-- PLATFORM ADMIN: ASSIGN / CHANGE PLAN
-- =========================================================

CREATE OR REPLACE FUNCTION public.assign_account_plan(
  p_account_id UUID,
  p_plan_id UUID,
  p_starts_at TIMESTAMPTZ DEFAULT NOW(),
  p_expires_at TIMESTAMPTZ DEFAULT NULL
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

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts
    WHERE id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.plans
    WHERE id = p_plan_id
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'Active plan not found';
  END IF;

  IF p_expires_at IS NOT NULL
     AND p_expires_at <= p_starts_at THEN
    RAISE EXCEPTION 'Expiry must be after start date';
  END IF;

  INSERT INTO public.account_plans (
    account_id,
    plan_id,
    starts_at,
    expires_at,
    cancelled_at,
    assigned_by_user_id
  )
  VALUES (
    p_account_id,
    p_plan_id,
    p_starts_at,
    p_expires_at,
    NULL,
    auth.uid()
  )
  ON CONFLICT (account_id)
  DO UPDATE SET
    plan_id = EXCLUDED.plan_id,
    starts_at = EXCLUDED.starts_at,
    expires_at = EXCLUDED.expires_at,
    cancelled_at = NULL,
    assigned_by_user_id = auth.uid();
END;
$$;

REVOKE ALL
ON FUNCTION public.assign_account_plan(
  UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.assign_account_plan(
  UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ
)
TO authenticated, service_role;


-- =========================================================
-- PLATFORM ADMIN: CANCEL PLAN
-- Keeps the assignment/history row instead of deleting it.
-- =========================================================

CREATE OR REPLACE FUNCTION public.cancel_account_plan(
  p_account_id UUID
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

  UPDATE public.account_plans
  SET cancelled_at = NOW()
  WHERE account_id = p_account_id
    AND cancelled_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active account plan not found';
  END IF;
END;
$$;

REVOKE ALL
ON FUNCTION public.cancel_account_plan(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.cancel_account_plan(UUID)
TO authenticated, service_role;