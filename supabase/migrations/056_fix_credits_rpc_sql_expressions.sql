-- ============================================================
-- 056_fix_credits_rpc_sql_expressions.sql
-- Hotfix: Replace invalid pg_catalog.nullif / pg_catalog.coalesce
--
-- Root cause:
--   NULLIF and COALESCE are SQL conditional expressions, not
--   ordinary functions. PostgreSQL does not resolve them via
--   pg_catalog schema qualification. Calling pg_catalog.nullif()
--   raises: "function pg_catalog.nullif(text, unknown) does not exist"
--
-- Fix:
--   CREATE OR REPLACE the same platform_adjust_credits function
--   with NULLIF(...) and COALESCE(...) used as bare expressions.
--
-- Scope:
--   - Function body only (CREATE OR REPLACE)
--   - No table, RLS, trigger, or schema changes
--   - GRANT/REVOKE reapplied identically for idempotent replay
-- ============================================================

CREATE OR REPLACE FUNCTION public.platform_adjust_credits(
  p_account_id UUID,
  p_transaction_type TEXT,
  p_amount_paise BIGINT,
  p_reason TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id TEXT DEFAULT NULL,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS TABLE (
  transaction_id UUID,
  account_id UUID,
  transaction_type TEXT,
  amount_paise BIGINT,
  balance_before_paise BIGINT,
  balance_after_paise BIGINT,
  created_at TIMESTAMPTZ,
  is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  -- Business Rule: Single manual adjustment limit of ₹10,00,000 (100,000,000 paise).
  -- Candidate for future configurable Platform Settings / Pricing configuration.
  c_max_manual_adjustment_paise CONSTANT BIGINT := 100000000;

  v_caller_uid UUID;
  v_caller_email TEXT;
  v_clean_reason TEXT;
  v_clean_ref_type TEXT;
  v_clean_ref_id TEXT;
  v_clean_idempotency TEXT;

  v_balance_before BIGINT;
  v_lifetime_credited BIGINT;
  v_lifetime_debited BIGINT;
  v_balance_after BIGINT;
  v_is_credit BOOLEAN;

  v_existing_tx RECORD;
  v_tx_id UUID;
  v_created_at TIMESTAMPTZ;
BEGIN
  -- 1. Verify caller identity
  v_caller_uid := auth.uid();
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Verify platform admin privilege
  IF NOT public.is_platform_admin(v_caller_uid) THEN
    RAISE EXCEPTION 'Platform admin access required'
      USING ERRCODE = '42501';
  END IF;

  -- 3. Validate target account exists
  IF NOT EXISTS (
    SELECT 1 FROM public.accounts a WHERE a.id = p_account_id
  ) THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate manual transaction_type
  -- Note: 'usage' is strictly reserved for automated message billing functions.
  IF p_transaction_type NOT IN ('admin_credit', 'admin_debit', 'promotional_credit', 'refund') THEN
    IF p_transaction_type = 'usage' THEN
      RAISE EXCEPTION 'Manual adjustment cannot use transaction type ''usage''; automated billing must use dedicated deduction functions'
        USING ERRCODE = '22023';
    ELSE
      RAISE EXCEPTION 'Invalid manual adjustment transaction type: %', p_transaction_type
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 5. Validate amount bounds
  IF p_amount_paise IS NULL OR p_amount_paise <= 0 THEN
    RAISE EXCEPTION 'Amount must be a positive integer in paise'
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_paise > c_max_manual_adjustment_paise THEN
    RAISE EXCEPTION 'Amount % paise exceeds the maximum manual adjustment limit of % paise (Rs 10,00,000)',
      p_amount_paise, c_max_manual_adjustment_paise
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate and clean reason
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'Reason is required'
      USING ERRCODE = '22023';
  END IF;
  v_clean_reason := pg_catalog.btrim(p_reason);
  IF pg_catalog.length(v_clean_reason) = 0 THEN
    RAISE EXCEPTION 'Reason cannot be blank'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.length(v_clean_reason) > 500 THEN
    RAISE EXCEPTION 'Reason cannot exceed 500 characters'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Validate and clean reference fields
  -- FIX 056: NULLIF is a SQL conditional expression, not a pg_catalog function.
  IF p_reference_type IS NOT NULL THEN
    v_clean_ref_type := NULLIF(pg_catalog.btrim(p_reference_type), '');
    IF v_clean_ref_type IS NOT NULL AND pg_catalog.length(v_clean_ref_type) > 64 THEN
      RAISE EXCEPTION 'Reference type cannot exceed 64 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_reference_id IS NOT NULL THEN
    v_clean_ref_id := NULLIF(pg_catalog.btrim(p_reference_id), '');
    IF v_clean_ref_id IS NOT NULL AND pg_catalog.length(v_clean_ref_id) > 255 THEN
      RAISE EXCEPTION 'Reference ID cannot exceed 255 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 8. Validate and clean idempotency key
  IF p_idempotency_key IS NOT NULL THEN
    v_clean_idempotency := pg_catalog.btrim(p_idempotency_key);
    IF pg_catalog.length(v_clean_idempotency) = 0 THEN
      RAISE EXCEPTION 'Idempotency key cannot be blank when provided'
        USING ERRCODE = '22023';
    END IF;
    IF pg_catalog.length(v_clean_idempotency) > 255 THEN
      RAISE EXCEPTION 'Idempotency key cannot exceed 255 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 9. Row lock on credit_accounts for safe serialized execution
  SELECT
    ca.balance_paise,
    ca.lifetime_credited_paise,
    ca.lifetime_debited_paise
  INTO
    v_balance_before,
    v_lifetime_credited,
    v_lifetime_debited
  FROM public.credit_accounts ca
  WHERE ca.account_id = p_account_id
  FOR UPDATE;

  -- Ensure credit_account exists even if backfill was somehow missed
  IF NOT FOUND THEN
    INSERT INTO public.credit_accounts (
      account_id,
      currency,
      balance_paise,
      lifetime_credited_paise,
      lifetime_debited_paise
    )
    VALUES (
      p_account_id,
      'INR',
      0,
      0,
      0
    )
    ON CONFLICT (account_id) DO NOTHING;

    SELECT
      ca.balance_paise,
      ca.lifetime_credited_paise,
      ca.lifetime_debited_paise
    INTO
      v_balance_before,
      v_lifetime_credited,
      v_lifetime_debited
    FROM public.credit_accounts ca
    WHERE ca.account_id = p_account_id
    FOR UPDATE;
  END IF;

  -- 10. Check for idempotent replay under row lock
  IF v_clean_idempotency IS NOT NULL THEN
    SELECT
      t.id,
      t.account_id,
      t.transaction_type,
      t.amount_paise,
      t.balance_before_paise,
      t.balance_after_paise,
      t.reference_type,
      t.reference_id,
      t.created_at
    INTO v_existing_tx
    FROM public.credit_transactions t
    WHERE t.account_id = p_account_id
      AND t.idempotency_key = v_clean_idempotency;

    IF FOUND THEN
      -- Validate payload matches original call
      IF v_existing_tx.transaction_type IS DISTINCT FROM p_transaction_type
         OR v_existing_tx.amount_paise IS DISTINCT FROM p_amount_paise
         OR v_existing_tx.reference_type IS DISTINCT FROM v_clean_ref_type
         OR v_existing_tx.reference_id IS DISTINCT FROM v_clean_ref_id
      THEN
        RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: idempotency key ''%'' already used with conflicting parameters',
          v_clean_idempotency
          USING ERRCODE = '20000';
      END IF;

      -- Exact match: return existing transaction record without mutating state
      RETURN QUERY
      SELECT
        v_existing_tx.id,
        v_existing_tx.account_id,
        v_existing_tx.transaction_type,
        v_existing_tx.amount_paise,
        v_existing_tx.balance_before_paise,
        v_existing_tx.balance_after_paise,
        v_existing_tx.created_at,
        TRUE AS is_idempotent_replay;
      RETURN;
    END IF;
  END IF;

  -- 11. Calculate new balance & totals
  v_is_credit := p_transaction_type IN ('admin_credit', 'promotional_credit', 'refund');

  IF v_is_credit THEN
    v_balance_after := v_balance_before + p_amount_paise;
    v_lifetime_credited := v_lifetime_credited + p_amount_paise;
  ELSE
    v_balance_after := v_balance_before - p_amount_paise;
    v_lifetime_debited := v_lifetime_debited + p_amount_paise;

    IF v_balance_after < 0 THEN
      RAISE EXCEPTION 'Insufficient credit balance: current balance is % paise, requested debit is % paise',
        v_balance_before, p_amount_paise
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 12. Update credit_accounts cached state
  UPDATE public.credit_accounts
  SET
    balance_paise = v_balance_after,
    lifetime_credited_paise = v_lifetime_credited,
    lifetime_debited_paise = v_lifetime_debited,
    updated_at = pg_catalog.now()
  WHERE public.credit_accounts.account_id = p_account_id;

  -- 13. Insert immutable credit_transactions ledger row
  INSERT INTO public.credit_transactions (
    account_id,
    transaction_type,
    amount_paise,
    balance_before_paise,
    balance_after_paise,
    reason,
    reference_type,
    reference_id,
    idempotency_key,
    actor_user_id
  )
  VALUES (
    p_account_id,
    p_transaction_type,
    p_amount_paise,
    v_balance_before,
    v_balance_after,
    v_clean_reason,
    v_clean_ref_type,
    v_clean_ref_id,
    v_clean_idempotency,
    v_caller_uid
  )
  RETURNING public.credit_transactions.id, public.credit_transactions.created_at
  INTO v_tx_id, v_created_at;

  -- 14. Resolve caller email for audit log
  -- FIX 056: COALESCE is a SQL conditional expression, not a pg_catalog function.
  v_caller_email := COALESCE(
    (auth.jwt() ->> 'email'),
    (SELECT u.email FROM auth.users u WHERE u.id = v_caller_uid)
  );

  -- 15. Record audit entry in platform_audit_logs (same transaction)
  INSERT INTO public.platform_audit_logs (
    account_id,
    actor_user_id,
    actor_email,
    action,
    details
  )
  VALUES (
    p_account_id,
    v_caller_uid,
    v_caller_email,
    'credit_adjustment',
    pg_catalog.jsonb_build_object(
      'transaction_id', v_tx_id,
      'transaction_type', p_transaction_type,
      'direction', CASE WHEN v_is_credit THEN 'credit' ELSE 'debit' END,
      'amount_paise', p_amount_paise,
      'balance_before_paise', v_balance_before,
      'balance_after_paise', v_balance_after,
      'reason', v_clean_reason,
      'reference_type', v_clean_ref_type,
      'reference_id', v_clean_ref_id,
      'idempotency_key', v_clean_idempotency
    )
  );

  -- 16. Return newly applied transaction result
  RETURN QUERY
  SELECT
    v_tx_id,
    p_account_id,
    p_transaction_type,
    p_amount_paise,
    v_balance_before,
    v_balance_after,
    v_created_at,
    FALSE AS is_idempotent_replay;
END;
$$;

ALTER FUNCTION public.platform_adjust_credits(UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT)
  OWNER TO postgres;

REVOKE ALL PRIVILEGES
ON FUNCTION public.platform_adjust_credits(UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.platform_adjust_credits(UUID, TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT)
TO authenticated;
