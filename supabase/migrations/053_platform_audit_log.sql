-- ============================================================
-- 053_platform_audit_log.sql
-- Simple immutable audit trail for Super Admin account changes.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_audit_logs (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),

  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  actor_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL,

  actor_email TEXT,

  action TEXT NOT NULL,

  details JSONB NOT NULL DEFAULT '{}'::JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_account_created
ON public.platform_audit_logs(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_audit_logs_created
ON public.platform_audit_logs(created_at DESC);

ALTER TABLE public.platform_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS platform_audit_logs_select
ON public.platform_audit_logs;

CREATE POLICY platform_audit_logs_select
ON public.platform_audit_logs
FOR SELECT
TO authenticated
USING (public.is_platform_admin(auth.uid()));

REVOKE ALL PRIVILEGES
ON TABLE public.platform_audit_logs
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.platform_audit_logs
TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.platform_audit_logs
TO service_role;


CREATE OR REPLACE FUNCTION public.capture_platform_account_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_action TEXT;
  v_details JSONB;
  v_actor_email TEXT;
BEGIN
  v_actor_email := auth.jwt() ->> 'email';

  IF TG_TABLE_NAME = 'account_statuses' THEN
    v_account_id := NEW.account_id;

    IF TG_OP = 'INSERT' THEN
      v_action := 'status_created';
      v_details := jsonb_build_object(
        'status', NEW.status
      );

    ELSIF TG_OP = 'UPDATE'
      AND NEW.status IS DISTINCT FROM OLD.status
    THEN
      v_action := 'status_changed';
      v_details := jsonb_build_object(
        'old_status', OLD.status,
        'new_status', NEW.status
      );

    ELSE
      RETURN NEW;
    END IF;

  ELSIF TG_TABLE_NAME = 'account_plans' THEN
    v_account_id := NEW.account_id;

    IF TG_OP = 'INSERT' THEN
      v_action := 'plan_assigned';
      v_details := jsonb_build_object(
        'plan_id', NEW.plan_id,
        'starts_at', NEW.starts_at,
        'expires_at', NEW.expires_at
      );

    ELSIF TG_OP = 'UPDATE'
      AND OLD.cancelled_at IS NULL
      AND NEW.cancelled_at IS NOT NULL
    THEN
      v_action := 'plan_cancelled';
      v_details := jsonb_build_object(
        'plan_id', NEW.plan_id,
        'cancelled_at', NEW.cancelled_at
      );

    ELSIF TG_OP = 'UPDATE'
      AND (
        NEW.plan_id IS DISTINCT FROM OLD.plan_id
        OR NEW.starts_at IS DISTINCT FROM OLD.starts_at
        OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
        OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
      )
    THEN
      v_action := 'plan_changed';
      v_details := jsonb_build_object(
        'old_plan_id', OLD.plan_id,
        'new_plan_id', NEW.plan_id,
        'starts_at', NEW.starts_at,
        'expires_at', NEW.expires_at
      );

    ELSE
      RETURN NEW;
    END IF;

  ELSE
    RETURN NEW;
  END IF;

  INSERT INTO public.platform_audit_logs (
    account_id,
    actor_user_id,
    actor_email,
    action,
    details
  )
  VALUES (
    v_account_id,
    auth.uid(),
    v_actor_email,
    v_action,
    COALESCE(v_details, '{}'::JSONB)
  );

  RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.capture_platform_account_audit()
FROM PUBLIC, anon, authenticated, service_role;


DROP TRIGGER IF EXISTS audit_account_statuses
ON public.account_statuses;

CREATE TRIGGER audit_account_statuses
AFTER INSERT OR UPDATE
ON public.account_statuses
FOR EACH ROW
EXECUTE FUNCTION public.capture_platform_account_audit();


DROP TRIGGER IF EXISTS audit_account_plans
ON public.account_plans;

CREATE TRIGGER audit_account_plans
AFTER INSERT OR UPDATE
ON public.account_plans
FOR EACH ROW
EXECUTE FUNCTION public.capture_platform_account_audit();