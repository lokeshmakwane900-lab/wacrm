-- Platform Admin aggregate overview.
-- Keeps dashboard calculations inside PostgreSQL so it scales with account count.

CREATE OR REPLACE FUNCTION public.get_platform_overview()
RETURNS TABLE (
  total_accounts BIGINT,
  active_accounts BIGINT,
  suspended_accounts BIGINT,
  expired_accounts BIGINT,
  current_plans_assigned BIGINT,
  accounts_without_current_plan BIGINT,
  messages_used_monthly BIGINT,
  month_start DATE
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_period_start DATE :=
    date_trunc('month', timezone('UTC', NOW()))::DATE;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Platform admin access required'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH account_totals AS (
    SELECT
      COUNT(*)::BIGINT AS total,
      COUNT(*) FILTER (WHERE s.status = 'active')::BIGINT AS active,
      COUNT(*) FILTER (WHERE s.status = 'suspended')::BIGINT AS suspended,
      COUNT(*) FILTER (WHERE s.status = 'expired')::BIGINT AS expired
    FROM public.accounts a
    LEFT JOIN public.account_statuses s
      ON s.account_id = a.id
  ),
  current_plans AS (
    SELECT COUNT(*)::BIGINT AS assigned
    FROM public.account_plans ap
    WHERE ap.cancelled_at IS NULL
      AND ap.starts_at <= NOW()
      AND (
        ap.expires_at IS NULL
        OR ap.expires_at > NOW()
      )
  ),
  message_usage AS (
    SELECT COALESCE(SUM(u.messages_used), 0)::BIGINT AS used
    FROM public.account_message_usage_monthly u
    WHERE u.period_start = v_period_start
  )
  SELECT
    t.total,
    t.active,
    t.suspended,
    t.expired,
    p.assigned,
    GREATEST(t.total - p.assigned, 0)::BIGINT,
    m.used,
    v_period_start
  FROM account_totals t
  CROSS JOIN current_plans p
  CROSS JOIN message_usage m;
END;
$$;

REVOKE ALL
ON FUNCTION public.get_platform_overview()
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.get_platform_overview()
TO authenticated;
