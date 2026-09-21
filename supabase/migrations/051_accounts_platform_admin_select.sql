-- Platform admins may read all customer accounts.
-- Existing tenant accounts_select policy remains unchanged.

DROP POLICY IF EXISTS accounts_platform_admin_select
ON public.accounts;

CREATE POLICY accounts_platform_admin_select
ON public.accounts
FOR SELECT
TO authenticated
USING (public.is_platform_admin(auth.uid()));
