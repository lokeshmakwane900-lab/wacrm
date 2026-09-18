-- ============================================================
-- 048_usage_summary.sql
-- SaaS usage summary for Super Admin + account members
--
-- Reads current usage from existing tenant tables.
-- Does NOT enforce/block limits yet.
-- Limit enforcement will be handled separately.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_account_usage(
  p_account_id UUID
)
RETURNS TABLE (
  account_id UUID,
  plan_id UUID,
  plan_code TEXT,
  plan_name TEXT,

  users_used BIGINT,
  users_limit BIGINT,

  contacts_used BIGINT,
  contacts_limit BIGINT,

  messages_used_monthly BIGINT,
  messages_limit_monthly BIGINT,

  automations_used BIGINT,
  automations_limit BIGINT,

  month_start TIMESTAMPTZ,
  month_end TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month_start TIMESTAMPTZ;
  v_month_end TIMESTAMPTZ;
BEGIN
  -- Only platform admins or members of this account may read usage.
  IF NOT public.is_platform_admin(auth.uid())
     AND NOT public.is_account_member(p_account_id, 'viewer')
  THEN
    RAISE EXCEPTION 'Not authorized to view usage for this account';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts a
    WHERE a.id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Account not found';
  END IF;

  -- Supabase/Postgres runs in UTC by default.
  -- Usage resets at the beginning of each calendar month.
  v_month_start := date_trunc('month', NOW());
  v_month_end := v_month_start + INTERVAL '1 month';

  RETURN QUERY
  SELECT
    p_account_id,

    current_plan.plan_id,
    current_plan.plan_code,
    current_plan.plan_name,

    (
      SELECT COUNT(*)::BIGINT
      FROM public.profiles pr
      WHERE pr.account_id = p_account_id
    ) AS users_used,

    current_plan.max_users,

    (
      SELECT COUNT(*)::BIGINT
      FROM public.contacts c
      WHERE c.account_id = p_account_id
    ) AS contacts_used,

    current_plan.max_contacts,

    (
      SELECT COUNT(*)::BIGINT
      FROM public.messages m
      INNER JOIN public.conversations c
        ON c.id = m.conversation_id
      WHERE c.account_id = p_account_id
        AND m.sender_type IN ('agent', 'bot')
        AND m.status IN ('sent', 'delivered', 'read')
        AND m.created_at >= v_month_start
        AND m.created_at < v_month_end
    ) AS messages_used_monthly,

    current_plan.max_messages_monthly,

    (
      SELECT COUNT(*)::BIGINT
      FROM public.automations au
      WHERE au.account_id = p_account_id
        AND au.is_active = TRUE
    ) AS automations_used,

    current_plan.max_automations,

    v_month_start,
    v_month_end

  FROM (
    SELECT
      ap.plan_id,
      p.code AS plan_code,
      p.name AS plan_name,
      p.max_users::BIGINT AS max_users,
      p.max_contacts::BIGINT AS max_contacts,
      p.max_messages_monthly::BIGINT AS max_messages_monthly,
      p.max_automations::BIGINT AS max_automations
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
    LIMIT 1
  ) AS current_plan

  RIGHT JOIN (
    SELECT 1 AS placeholder
  ) AS always_one
    ON TRUE;
END;
$$;


-- ------------------------------------------------------------
-- Security
-- ------------------------------------------------------------

REVOKE ALL
ON FUNCTION public.get_account_usage(UUID)
FROM PUBLIC;

REVOKE ALL
ON FUNCTION public.get_account_usage(UUID)
FROM anon;

REVOKE ALL
ON FUNCTION public.get_account_usage(UUID)
FROM service_role;

GRANT EXECUTE
ON FUNCTION public.get_account_usage(UUID)
TO authenticated;