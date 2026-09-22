-- ============================================================
-- 054_resource_limits.sql
-- Plan enforcement for users, contacts and active automations.
--
-- Product rules:
--   - no plan has ever been assigned -> allowed for now
--   - cancelled / expired assigned plan -> creation blocked
--   - NULL plan limit -> unlimited
--   - numeric limit -> enforced
--   - automation limit counts ACTIVE automations (same as usage RPC)
--   - inbound/service-role contact inserts are NOT DB-blocked so
--     incoming WhatsApp messages are never lost
-- ============================================================

CREATE OR REPLACE FUNCTION public.resource_limit_status_internal(
  p_account_id UUID,
  p_resource TEXT
)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  used BIGINT,
  resource_limit BIGINT,
  plan_id UUID,
  plan_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_used BIGINT := 0;
  v_limit BIGINT;
  v_plan_id UUID;
  v_plan_name TEXT;
  v_has_plan BOOLEAN := FALSE;
  v_has_any_plan BOOLEAN := FALSE;
BEGIN
  IF p_resource NOT IN ('users', 'contacts', 'automations') THEN
    RAISE EXCEPTION 'Unsupported resource limit: %', p_resource;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  SELECT COALESCE(s.status, 'active')
  INTO v_status
  FROM public.accounts a
  LEFT JOIN public.account_statuses s
    ON s.account_id = a.id
  WHERE a.id = p_account_id;

  IF p_resource = 'users' THEN
    SELECT COUNT(*)::BIGINT
    INTO v_used
    FROM public.profiles p
    WHERE p.account_id = p_account_id;

  ELSIF p_resource = 'contacts' THEN
    SELECT COUNT(*)::BIGINT
    INTO v_used
    FROM public.contacts c
    WHERE c.account_id = p_account_id;

  ELSE
    SELECT COUNT(*)::BIGINT
    INTO v_used
    FROM public.automations a
    WHERE a.account_id = p_account_id
      AND a.is_active = TRUE;
  END IF;

  IF v_status <> 'active' THEN
    RETURN QUERY
    SELECT
      FALSE,
      ('account_' || v_status)::TEXT,
      v_used,
      NULL::BIGINT,
      NULL::UUID,
      NULL::TEXT;
    RETURN;
  END IF;

  SELECT
    ap.plan_id,
    p.name,
    CASE p_resource
      WHEN 'users' THEN p.max_users::BIGINT
      WHEN 'contacts' THEN p.max_contacts::BIGINT
      WHEN 'automations' THEN p.max_automations::BIGINT
    END
  INTO
    v_plan_id,
    v_plan_name,
    v_limit
  FROM public.account_plans ap
  INNER JOIN public.plans p
    ON p.id = ap.plan_id
  WHERE ap.account_id = p_account_id
    AND ap.cancelled_at IS NULL
    AND ap.starts_at <= NOW()
    AND (
      ap.expires_at IS NULL
      OR ap.expires_at > NOW()
    )
  LIMIT 1;

  v_has_plan := FOUND;

  SELECT EXISTS (
    SELECT 1
    FROM public.account_plans ap
    WHERE ap.account_id = p_account_id
  )
  INTO v_has_any_plan;

  IF NOT v_has_plan AND v_has_any_plan THEN
    RETURN QUERY
    SELECT
      FALSE,
      'plan_inactive_or_expired'::TEXT,
      v_used,
      NULL::BIGINT,
      NULL::UUID,
      NULL::TEXT;
    RETURN;
  END IF;

  IF NOT v_has_plan THEN
    RETURN QUERY
    SELECT
      TRUE,
      'allowed_no_plan'::TEXT,
      v_used,
      NULL::BIGINT,
      NULL::UUID,
      NULL::TEXT;
    RETURN;
  END IF;

  IF v_limit IS NULL THEN
    RETURN QUERY
    SELECT
      TRUE,
      'allowed_unlimited'::TEXT,
      v_used,
      NULL::BIGINT,
      v_plan_id,
      v_plan_name;
    RETURN;
  END IF;

  IF v_used >= v_limit THEN
    RETURN QUERY
    SELECT
      FALSE,
      (p_resource || '_limit_reached')::TEXT,
      v_used,
      v_limit,
      v_plan_id,
      v_plan_name;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    TRUE,
    'allowed'::TEXT,
    v_used,
    v_limit,
    v_plan_id,
    v_plan_name;
END;
$$;

REVOKE ALL
ON FUNCTION public.resource_limit_status_internal(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role;


CREATE OR REPLACE FUNCTION public.get_account_resource_limit(
  p_account_id UUID,
  p_resource TEXT
)
RETURNS TABLE (
  allowed BOOLEAN,
  reason TEXT,
  used BIGINT,
  resource_limit BIGINT,
  plan_id UUID,
  plan_name TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_platform_admin(auth.uid())
     AND NOT public.is_account_member(p_account_id, 'viewer')
  THEN
    RAISE EXCEPTION 'Not authorized to view account limits'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT *
  FROM public.resource_limit_status_internal(
    p_account_id,
    p_resource
  );
END;
$$;

REVOKE ALL
ON FUNCTION public.get_account_resource_limit(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.get_account_resource_limit(UUID, TEXT)
TO authenticated, service_role;


CREATE OR REPLACE FUNCTION public.enforce_profile_user_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
BEGIN
  IF NEW.account_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
  THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.account_id::TEXT || ':users', 0)
  );

  SELECT *
  INTO v_limit
  FROM public.resource_limit_status_internal(
    NEW.account_id,
    'users'
  );

  IF NOT v_limit.allowed THEN
    RAISE EXCEPTION 'PLAN_LIMIT:% used=% limit=%',
      v_limit.reason,
      v_limit.used,
      COALESCE(v_limit.resource_limit::TEXT, 'none');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_profiles_user_limit
ON public.profiles;

CREATE TRIGGER enforce_profiles_user_limit
BEFORE INSERT OR UPDATE OF account_id
ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.enforce_profile_user_limit();


CREATE OR REPLACE FUNCTION public.enforce_contact_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
BEGIN
  -- Incoming webhook/service-role contact creation is allowed so
  -- customer messages are never dropped because a plan is full.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.account_id::TEXT || ':contacts', 0)
  );

  SELECT *
  INTO v_limit
  FROM public.resource_limit_status_internal(
    NEW.account_id,
    'contacts'
  );

  IF NOT v_limit.allowed THEN
    RAISE EXCEPTION 'PLAN_LIMIT:% used=% limit=%',
      v_limit.reason,
      v_limit.used,
      COALESCE(v_limit.resource_limit::TEXT, 'none');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_contacts_plan_limit
ON public.contacts;

CREATE TRIGGER enforce_contacts_plan_limit
BEFORE INSERT
ON public.contacts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_contact_limit();


CREATE OR REPLACE FUNCTION public.enforce_automation_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit RECORD;
BEGIN
  -- Draft automations do not consume the plan allowance.
  IF NOT NEW.is_active THEN
    RETURN NEW;
  END IF;

  -- Editing an already-active automation in the same account
  -- does not consume another slot.
  IF TG_OP = 'UPDATE'
     AND OLD.is_active = TRUE
     AND NEW.account_id IS NOT DISTINCT FROM OLD.account_id
  THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtextextended(NEW.account_id::TEXT || ':automations', 0)
  );

  SELECT *
  INTO v_limit
  FROM public.resource_limit_status_internal(
    NEW.account_id,
    'automations'
  );

  IF NOT v_limit.allowed THEN
    RAISE EXCEPTION 'PLAN_LIMIT:% used=% limit=%',
      v_limit.reason,
      v_limit.used,
      COALESCE(v_limit.resource_limit::TEXT, 'none');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_automations_plan_limit
ON public.automations;

CREATE TRIGGER enforce_automations_plan_limit
BEFORE INSERT OR UPDATE OF is_active, account_id
ON public.automations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_automation_limit();


REVOKE ALL
ON FUNCTION public.enforce_profile_user_limit()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
ON FUNCTION public.enforce_contact_limit()
FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL
ON FUNCTION public.enforce_automation_limit()
FROM PUBLIC, anon, authenticated, service_role;