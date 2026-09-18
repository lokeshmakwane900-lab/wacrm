-- =========================================================
-- PLANS
-- SaaS plan catalogue for MK Creative WACRM.
-- Account assignment comes in the NEXT migration.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.plans (
  id UUID PRIMARY KEY
    DEFAULT extensions.uuid_generate_v4(),

  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,

  -- Store money as integer paise, never floating point.
  -- Example: Rs 999 = 99900 paise.
  monthly_price_paise BIGINT NOT NULL DEFAULT 0
    CHECK (monthly_price_paise >= 0),

  currency TEXT NOT NULL DEFAULT 'INR'
    CHECK (currency ~ '^[A-Z]{3}$'),

  -- NULL means unlimited.
  max_users INTEGER
    CHECK (max_users IS NULL OR max_users >= 0),

  max_contacts INTEGER
    CHECK (max_contacts IS NULL OR max_contacts >= 0),

  max_messages_monthly INTEGER
    CHECK (max_messages_monthly IS NULL OR max_messages_monthly >= 0),

  max_automations INTEGER
    CHECK (max_automations IS NULL OR max_automations >= 0),

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  sort_order INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT plans_code_format
    CHECK (code ~ '^[a-z0-9][a-z0-9_-]*$')
);


-- =========================================================
-- UPDATED AT
-- =========================================================

DROP TRIGGER IF EXISTS set_updated_at
ON public.plans;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.plans
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- =========================================================
-- ROW LEVEL SECURITY
-- Plan catalogue is readable by signed-in users.
-- Direct writes are blocked for normal users.
-- =========================================================

ALTER TABLE public.plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS plans_select_authenticated
ON public.plans;

CREATE POLICY plans_select_authenticated
ON public.plans
FOR SELECT
TO authenticated
USING (TRUE);


-- =========================================================
-- TABLE PRIVILEGES
-- =========================================================

REVOKE ALL PRIVILEGES
ON TABLE public.plans
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.plans
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.plans
TO service_role;


-- =========================================================
-- PLATFORM ADMIN PLAN MANAGEMENT RPC
-- Only platform admins may create/update plans through app UI.
-- =========================================================

CREATE OR REPLACE FUNCTION public.upsert_plan(
  p_code TEXT,
  p_name TEXT,
  p_description TEXT DEFAULT NULL,
  p_monthly_price_paise BIGINT DEFAULT 0,
  p_currency TEXT DEFAULT 'INR',
  p_max_users INTEGER DEFAULT NULL,
  p_max_contacts INTEGER DEFAULT NULL,
  p_max_messages_monthly INTEGER DEFAULT NULL,
  p_max_automations INTEGER DEFAULT NULL,
  p_is_active BOOLEAN DEFAULT TRUE,
  p_sort_order INTEGER DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan_id UUID;
BEGIN
  IF NOT public.is_platform_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Platform admin access required'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.plans (
    code,
    name,
    description,
    monthly_price_paise,
    currency,
    max_users,
    max_contacts,
    max_messages_monthly,
    max_automations,
    is_active,
    sort_order
  )
  VALUES (
    LOWER(BTRIM(p_code)),
    BTRIM(p_name),
    NULLIF(BTRIM(p_description), ''),
    p_monthly_price_paise,
    UPPER(BTRIM(p_currency)),
    p_max_users,
    p_max_contacts,
    p_max_messages_monthly,
    p_max_automations,
    p_is_active,
    p_sort_order
  )
  ON CONFLICT (code)
  DO UPDATE SET
    name = EXCLUDED.name,
    description = EXCLUDED.description,
    monthly_price_paise = EXCLUDED.monthly_price_paise,
    currency = EXCLUDED.currency,
    max_users = EXCLUDED.max_users,
    max_contacts = EXCLUDED.max_contacts,
    max_messages_monthly = EXCLUDED.max_messages_monthly,
    max_automations = EXCLUDED.max_automations,
    is_active = EXCLUDED.is_active,
    sort_order = EXCLUDED.sort_order
  RETURNING id INTO v_plan_id;

  RETURN v_plan_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.upsert_plan(
  TEXT, TEXT, TEXT, BIGINT, TEXT,
  INTEGER, INTEGER, INTEGER, INTEGER,
  BOOLEAN, INTEGER
)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.upsert_plan(
  TEXT, TEXT, TEXT, BIGINT, TEXT,
  INTEGER, INTEGER, INTEGER, INTEGER,
  BOOLEAN, INTEGER
)
TO authenticated, service_role;