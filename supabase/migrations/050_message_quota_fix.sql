-- ============================================================
-- 050_message_quota_fix.sql
-- Fix ambiguous period_start reference in reserve_message_quota
-- ============================================================

CREATE OR REPLACE FUNCTION public.reserve_message_quota(
  p_account_id UUID,
  p_source TEXT DEFAULT NULL
)
RETURNS TABLE (
  allowed BOOLEAN,
  reservation_id UUID,
  reason TEXT,
  messages_used BIGINT,
  messages_limit BIGINT,
  period_start DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start DATE :=
    date_trunc('month', timezone('UTC', NOW()))::DATE;

  v_status TEXT;
  v_limit BIGINT;
  v_has_plan BOOLEAN := FALSE;
  v_has_any_plan BOOLEAN := FALSE;

  v_used BIGINT := 0;
  v_reservation_id UUID;
BEGIN

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_platform_admin(auth.uid())
  THEN
    RAISE EXCEPTION 'Not authorized to reserve message quota';
  END IF;


  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;


  SELECT s.status
  INTO v_status
  FROM public.account_statuses s
  WHERE s.account_id = p_account_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account status not found';
  END IF;


  IF v_status <> 'active' THEN

    SELECT COALESCE(u.messages_used, 0)
    INTO v_used
    FROM public.account_message_usage_monthly u
    WHERE u.account_id = p_account_id
      AND u.period_start = v_period_start;

    v_used := COALESCE(v_used, 0);

    RETURN QUERY
    SELECT
      FALSE,
      NULL::UUID,
      ('account_' || v_status)::TEXT,
      v_used,
      NULL::BIGINT,
      v_period_start;

    RETURN;
  END IF;


  SELECT p.max_messages_monthly::BIGINT
  INTO v_limit
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

    SELECT COALESCE(u.messages_used, 0)
    INTO v_used
    FROM public.account_message_usage_monthly u
    WHERE u.account_id = p_account_id
      AND u.period_start = v_period_start;

    v_used := COALESCE(v_used, 0);

    RETURN QUERY
    SELECT
      FALSE,
      NULL::UUID,
      'plan_inactive_or_expired'::TEXT,
      v_used,
      NULL::BIGINT,
      v_period_start;

    RETURN;
  END IF;


  INSERT INTO public.account_message_usage_monthly (
    account_id,
    period_start,
    messages_used
  )
  VALUES (
    p_account_id,
    v_period_start,
    0
  )
  ON CONFLICT ON CONSTRAINT account_message_usage_monthly_pkey
  DO NOTHING;


  SELECT u.messages_used
  INTO v_used
  FROM public.account_message_usage_monthly u
  WHERE u.account_id = p_account_id
    AND u.period_start = v_period_start
  FOR UPDATE;


  IF v_has_plan
     AND v_limit IS NOT NULL
     AND v_used >= v_limit
  THEN

    RETURN QUERY
    SELECT
      FALSE,
      NULL::UUID,
      'message_limit_reached'::TEXT,
      v_used,
      v_limit,
      v_period_start;

    RETURN;
  END IF;


  UPDATE public.account_message_usage_monthly AS u
  SET messages_used = u.messages_used + 1
  WHERE u.account_id = p_account_id
    AND u.period_start = v_period_start
  RETURNING u.messages_used
  INTO v_used;


  INSERT INTO public.message_quota_reservations (
    account_id,
    period_start,
    state,
    source
  )
  VALUES (
    p_account_id,
    v_period_start,
    'reserved',
    NULLIF(BTRIM(p_source), '')
  )
  RETURNING id
  INTO v_reservation_id;


  RETURN QUERY
  SELECT
    TRUE,
    v_reservation_id,
    CASE
      WHEN NOT v_has_plan THEN 'allowed_no_plan'
      WHEN v_limit IS NULL THEN 'allowed_unlimited'
      ELSE 'allowed'
    END::TEXT,
    v_used,
    v_limit,
    v_period_start;

END;
$$;


REVOKE ALL
ON FUNCTION public.reserve_message_quota(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.reserve_message_quota(UUID, TEXT)
TO authenticated, service_role;