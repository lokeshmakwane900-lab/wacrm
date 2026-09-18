-- ============================================================
-- 049_message_quota.sql
-- Race-safe monthly outbound message quota foundation
--
-- IMPORTANT:
-- This migration creates the quota engine only.
-- Existing send paths are NOT blocked until application code
-- explicitly calls reserve/commit/release RPCs.
--
-- Rules:
--   account active       -> may send
--   suspended / expired  -> blocked
--   no plan assigned     -> allowed for now
--   plan limit NULL      -> unlimited
--   numeric limit        -> enforced atomically
-- ============================================================


-- ============================================================
-- MONTHLY MESSAGE USAGE COUNTER
-- ============================================================

CREATE TABLE IF NOT EXISTS public.account_message_usage_monthly (
  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,

  messages_used BIGINT NOT NULL DEFAULT 0
    CHECK (messages_used >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  PRIMARY KEY (account_id, period_start),

  CONSTRAINT account_message_usage_period_first_day
    CHECK (EXTRACT(DAY FROM period_start) = 1)
);


CREATE INDEX IF NOT EXISTS idx_account_message_usage_period
  ON public.account_message_usage_monthly(period_start);


DROP TRIGGER IF EXISTS set_updated_at
ON public.account_message_usage_monthly;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.account_message_usage_monthly
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


ALTER TABLE public.account_message_usage_monthly
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS account_message_usage_select
ON public.account_message_usage_monthly;

CREATE POLICY account_message_usage_select
ON public.account_message_usage_monthly
FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_account_member(account_id, 'viewer')
);


-- ============================================================
-- QUOTA RESERVATIONS
--
-- Each outbound send first reserves exactly 1 message.
--
-- reserved  = quota taken, Meta send not finalized yet
-- consumed  = Meta accepted the send
-- released  = Meta send failed; quota returned
-- ============================================================

CREATE TABLE IF NOT EXISTS public.message_quota_reservations (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),

  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  period_start DATE NOT NULL,

  state TEXT NOT NULL DEFAULT 'reserved'
    CHECK (state IN ('reserved', 'consumed', 'released')),

  source TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at TIMESTAMPTZ
);


CREATE INDEX IF NOT EXISTS idx_message_quota_reservations_account_period
  ON public.message_quota_reservations(account_id, period_start);

CREATE INDEX IF NOT EXISTS idx_message_quota_reservations_state
  ON public.message_quota_reservations(state);


ALTER TABLE public.message_quota_reservations
ENABLE ROW LEVEL SECURITY;


DROP POLICY IF EXISTS message_quota_reservations_admin_select
ON public.message_quota_reservations;

CREATE POLICY message_quota_reservations_admin_select
ON public.message_quota_reservations
FOR SELECT
USING (
  public.is_platform_admin(auth.uid())
);


-- ============================================================
-- BACKFILL CURRENT UTC MONTH
--
-- Starts counter from already-persisted successful outbound
-- messages so existing usage is not forgotten.
-- ============================================================

INSERT INTO public.account_message_usage_monthly (
  account_id,
  period_start,
  messages_used
)
SELECT
  c.account_id,
  date_trunc('month', timezone('UTC', NOW()))::DATE,
  COUNT(*)::BIGINT
FROM public.messages m
INNER JOIN public.conversations c
  ON c.id = m.conversation_id
WHERE m.sender_type IN ('agent', 'bot')
  AND m.status IN ('sent', 'delivered', 'read')
  AND m.created_at >= date_trunc('month', NOW())
  AND m.created_at < date_trunc('month', NOW()) + INTERVAL '1 month'
GROUP BY c.account_id
ON CONFLICT (account_id, period_start)
DO UPDATE
SET messages_used = GREATEST(
  public.account_message_usage_monthly.messages_used,
  EXCLUDED.messages_used
);


-- ============================================================
-- RESERVE ONE MESSAGE
--
-- Only trusted server/service-role code or Platform Admin may
-- call this function.
--
-- Row locking on account_message_usage_monthly makes concurrent
-- bulk sends serialize safely for each account/month.
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

  -- Trusted server code or Platform Admin only.
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


  -- Suspended / expired accounts cannot send.
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


  -- Current valid plan.
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


-- A plan was assigned before, but there is no currently valid plan.
-- Do not treat expired/cancelled/future plans as "no plan".
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


  -- Ensure this account/month has a counter row.
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
  ON CONFLICT (account_id, period_start)
  DO NOTHING;


  -- Critical race-condition protection.
  SELECT u.messages_used
  INTO v_used
  FROM public.account_message_usage_monthly u
  WHERE u.account_id = p_account_id
    AND u.period_start = v_period_start
  FOR UPDATE;


  -- Numeric plan limit reached.
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


  -- Reserve exactly one outbound message.
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


-- ============================================================
-- COMMIT RESERVATION
--
-- Call after Meta successfully accepts the outbound message.
-- Counter remains incremented.
-- ============================================================

CREATE OR REPLACE FUNCTION public.commit_message_quota(
  p_reservation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_state TEXT;
BEGIN

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_platform_admin(auth.uid())
  THEN
    RAISE EXCEPTION 'Not authorized to commit message quota';
  END IF;


  SELECT r.state
  INTO v_state
  FROM public.message_quota_reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;


  IF NOT FOUND OR v_state <> 'reserved' THEN
    RETURN FALSE;
  END IF;


  UPDATE public.message_quota_reservations
  SET
    state = 'consumed',
    finalized_at = NOW()
  WHERE id = p_reservation_id;


  RETURN TRUE;
END;
$$;


-- ============================================================
-- RELEASE RESERVATION
--
-- Call when Meta send fails before successful acceptance.
-- Returns the reserved message back to the monthly quota.
-- ============================================================

CREATE OR REPLACE FUNCTION public.release_message_quota(
  p_reservation_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_period_start DATE;
  v_state TEXT;
BEGIN

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT public.is_platform_admin(auth.uid())
  THEN
    RAISE EXCEPTION 'Not authorized to release message quota';
  END IF;


  SELECT
    r.account_id,
    r.period_start,
    r.state
  INTO
    v_account_id,
    v_period_start,
    v_state
  FROM public.message_quota_reservations r
  WHERE r.id = p_reservation_id
  FOR UPDATE;


  IF NOT FOUND OR v_state <> 'reserved' THEN
    RETURN FALSE;
  END IF;


  UPDATE public.message_quota_reservations
  SET
    state = 'released',
    finalized_at = NOW()
  WHERE id = p_reservation_id;


  UPDATE public.account_message_usage_monthly AS u
  SET messages_used = GREATEST(u.messages_used - 1, 0)
  WHERE u.account_id = v_account_id
    AND u.period_start = v_period_start;


  RETURN TRUE;
END;
$$;


-- ============================================================
-- TABLE PRIVILEGES
-- ============================================================

REVOKE ALL
ON public.account_message_usage_monthly
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON public.account_message_usage_monthly
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.account_message_usage_monthly
TO service_role;


REVOKE ALL
ON public.message_quota_reservations
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON public.message_quota_reservations
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON public.message_quota_reservations
TO service_role;


-- ============================================================
-- FUNCTION PRIVILEGES
-- ============================================================

REVOKE ALL
ON FUNCTION public.reserve_message_quota(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.reserve_message_quota(UUID, TEXT)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.commit_message_quota(UUID)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.commit_message_quota(UUID)
TO authenticated, service_role;


REVOKE ALL
ON FUNCTION public.release_message_quota(UUID)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.release_message_quota(UUID)
TO authenticated, service_role;