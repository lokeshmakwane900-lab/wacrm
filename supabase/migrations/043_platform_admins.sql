-- =========================================================
-- PLATFORM ADMINS
-- MK Creative platform-level administrators.
-- Separate from account roles: owner/admin/agent/viewer.
-- =========================================================

CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY
    REFERENCES auth.users(id) ON DELETE CASCADE,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------
-- Helper: check whether the current/specified user is an
-- active platform administrator.
--
-- SECURITY DEFINER avoids recursive RLS evaluation when this
-- helper is later used inside platform_admins policies.
-- ---------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_platform_admin(
  target_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.platform_admins
    WHERE user_id = target_user_id
      AND is_active = TRUE
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin(UUID) FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION public.is_platform_admin(UUID)
TO authenticated, service_role;

-- Platform admins may read the platform admin list.
-- No INSERT/UPDATE/DELETE policy is intentionally provided:
-- normal authenticated users cannot promote themselves.
CREATE POLICY "Platform admins can view platform admins"
ON public.platform_admins
FOR SELECT
TO authenticated
USING (public.is_platform_admin(auth.uid()));