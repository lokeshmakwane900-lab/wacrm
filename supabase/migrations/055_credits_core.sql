-- ============================================================
-- 055_credits_core.sql
-- Credits Core Backend Foundation V1
--
-- Scope:
--   - credit_accounts: cached balance & lifetime totals table
--   - credit_transactions: immutable append-only accounting ledger
--   - Concurrency: row-level locking (SELECT ... FOR UPDATE)
--   - Idempotency: database-level unique index & verified replay
--   - Audit log integration: recorded to platform_audit_logs
--   - Platform Admin RPC: public.platform_adjust_credits
--
-- Accounting Invariants:
--   - balance_paise = lifetime_credited_paise - lifetime_debited_paise
--   - lifetime_credited_paise >= lifetime_debited_paise
--   - balance_paise >= 0
--   - All amounts in integer paise (BIGINT)
--   - Ledger is strictly append-only; updates and deletes forbidden
--   - Zero direct ledger INSERT/UPDATE/DELETE grants to application roles
-- ============================================================

-- ============================================================
-- 1. CREDIT_ACCOUNTS TABLE
-- Cached settled balance and aggregates.
-- Cascade delete on account_id allows zero-transaction accounts
-- to be deleted cleanly, while credit_transactions ON DELETE RESTRICT
-- prevents deleting any account with financial history.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_accounts (
  account_id UUID PRIMARY KEY
    REFERENCES public.accounts(id) ON DELETE CASCADE,

  currency TEXT NOT NULL DEFAULT 'INR'
    CONSTRAINT credit_accounts_currency_check CHECK (currency = 'INR'),

  balance_paise BIGINT NOT NULL DEFAULT 0
    CONSTRAINT credit_accounts_balance_non_negative CHECK (balance_paise >= 0),

  lifetime_credited_paise BIGINT NOT NULL DEFAULT 0
    CONSTRAINT credit_accounts_credited_non_negative CHECK (lifetime_credited_paise >= 0),

  lifetime_debited_paise BIGINT NOT NULL DEFAULT 0
    CONSTRAINT credit_accounts_debited_non_negative CHECK (lifetime_debited_paise >= 0),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT credit_accounts_lifetime_order_check
    CHECK (lifetime_credited_paise >= lifetime_debited_paise),

  CONSTRAINT credit_accounts_balance_invariant_check
    CHECK (balance_paise = (lifetime_credited_paise - lifetime_debited_paise))
);

-- Keep updated_at automatic
DROP TRIGGER IF EXISTS set_updated_at ON public.credit_accounts;

CREATE TRIGGER set_updated_at
BEFORE UPDATE ON public.credit_accounts
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();


-- ============================================================
-- 2. FUTURE ACCOUNT AUTOMATIC PROVISIONING
-- Trigger function ensuring every new account gets a credit account.
-- Installed BEFORE existing-account backfill to eliminate migration races.
-- Privileged trigger execution allows safe insertion without
-- granting direct INSERT on credit_accounts to tenant roles.
-- ============================================================

CREATE OR REPLACE FUNCTION public.ensure_credit_account_row()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.credit_accounts (
    account_id,
    currency,
    balance_paise,
    lifetime_credited_paise,
    lifetime_debited_paise
  )
  VALUES (
    NEW.id,
    'INR',
    0,
    0,
    0
  )
  ON CONFLICT (account_id) DO NOTHING;

  RETURN NEW;
END;
$$;

ALTER FUNCTION public.ensure_credit_account_row() OWNER TO postgres;

-- Trigger function only; revoke direct invocation from all application roles.
REVOKE ALL PRIVILEGES
ON FUNCTION public.ensure_credit_account_row()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS create_credit_account_after_account_insert
ON public.accounts;

CREATE TRIGGER create_credit_account_after_account_insert
AFTER INSERT ON public.accounts
FOR EACH ROW
EXECUTE FUNCTION public.ensure_credit_account_row();


-- ============================================================
-- 3. BACKFILL EXISTING ACCOUNTS
-- Runs after trigger installation so no newly-created account
-- is missed during migration execution.
-- ============================================================

INSERT INTO public.credit_accounts (
  account_id,
  currency,
  balance_paise,
  lifetime_credited_paise,
  lifetime_debited_paise
)
SELECT
  a.id,
  'INR',
  0,
  0,
  0
FROM public.accounts a
ON CONFLICT (account_id) DO NOTHING;


-- ============================================================
-- 4. IMMUTABLE CREDIT TRANSACTIONS LEDGER
-- Accounting source of truth. Append-only.
-- ON DELETE RESTRICT on account_id ensures financial history
-- can NEVER be silently wiped or cascade-deleted.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id UUID PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),

  account_id UUID NOT NULL
    REFERENCES public.accounts(id) ON DELETE RESTRICT,

  transaction_type TEXT NOT NULL
    CONSTRAINT credit_transactions_type_check
      CHECK (transaction_type IN ('admin_credit', 'admin_debit', 'promotional_credit', 'refund', 'usage')),

  amount_paise BIGINT NOT NULL
    CONSTRAINT credit_transactions_amount_positive
      CHECK (amount_paise > 0),

  balance_before_paise BIGINT NOT NULL
    CONSTRAINT credit_transactions_before_non_negative
      CHECK (balance_before_paise >= 0),

  balance_after_paise BIGINT NOT NULL
    CONSTRAINT credit_transactions_after_non_negative
      CHECK (balance_after_paise >= 0),

  reason TEXT NOT NULL
    CONSTRAINT credit_transactions_reason_check
      CHECK (pg_catalog.length(pg_catalog.btrim(reason)) > 0 AND pg_catalog.length(reason) <= 500),

  reference_type TEXT
    CONSTRAINT credit_transactions_reference_type_check
      CHECK (reference_type IS NULL OR (pg_catalog.length(pg_catalog.btrim(reference_type)) > 0 AND pg_catalog.length(reference_type) <= 64)),

  reference_id TEXT
    CONSTRAINT credit_transactions_reference_id_check
      CHECK (reference_id IS NULL OR (pg_catalog.length(pg_catalog.btrim(reference_id)) > 0 AND pg_catalog.length(reference_id) <= 255)),

  idempotency_key TEXT
    CONSTRAINT credit_transactions_idempotency_key_check
      CHECK (idempotency_key IS NULL OR (pg_catalog.length(pg_catalog.btrim(idempotency_key)) > 0 AND pg_catalog.length(idempotency_key) <= 255)),

  -- Preserved as an immutable historical snapshot UUID.
  -- An FK to auth.users with ON DELETE SET NULL or CASCADE is intentionally
  -- omitted: deleting an auth user would attempt to mutate historical ledger
  -- rows, conflicting with the unconditional ledger immutability trigger.
  actor_user_id UUID,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT credit_transactions_balance_math_check CHECK (
    (transaction_type IN ('admin_credit', 'promotional_credit', 'refund') AND balance_after_paise = (balance_before_paise + amount_paise))
    OR
    (transaction_type IN ('admin_debit', 'usage') AND balance_after_paise = (balance_before_paise - amount_paise))
  )
);

-- Hot lookup indexes
CREATE INDEX IF NOT EXISTS idx_credit_transactions_account_created
  ON public.credit_transactions(account_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_created
  ON public.credit_transactions(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credit_transactions_reference
  ON public.credit_transactions(reference_type, reference_id)
  WHERE reference_type IS NOT NULL AND reference_id IS NOT NULL;

-- Idempotency unique protection
CREATE UNIQUE INDEX IF NOT EXISTS idx_credit_transactions_account_idempotency
  ON public.credit_transactions(account_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;


-- ============================================================
-- 5. LEDGER IMMUTABILITY PROTECTION TRIGGER
-- Ordinary SECURITY INVOKER trigger function that rejects
-- any UPDATE or DELETE attempt on the ledger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.prevent_credit_transaction_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'credit_transactions ledger is append-only; updates and deletes are forbidden'
    USING ERRCODE = '2BP01';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_credit_transaction_mutation
ON public.credit_transactions;

CREATE TRIGGER trg_prevent_credit_transaction_mutation
BEFORE UPDATE OR DELETE ON public.credit_transactions
FOR EACH ROW
EXECUTE FUNCTION public.prevent_credit_transaction_mutation();


-- ============================================================
-- 6. ROW LEVEL SECURITY (RLS) & PRIVILEGES
-- ============================================================

-- A. credit_accounts
ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_accounts_select ON public.credit_accounts;
CREATE POLICY credit_accounts_select
ON public.credit_accounts
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_account_member(account_id, 'viewer')
);

REVOKE ALL PRIVILEGES
ON TABLE public.credit_accounts
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.credit_accounts
TO authenticated, service_role;


-- B. credit_transactions
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_transactions_select ON public.credit_transactions;
CREATE POLICY credit_transactions_select
ON public.credit_transactions
FOR SELECT
TO authenticated
USING (
  public.is_platform_admin(auth.uid())
  OR public.is_account_member(account_id, 'viewer')
);

-- Zero direct DML access to the ledger for application roles.
REVOKE ALL PRIVILEGES
ON TABLE public.credit_transactions
FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT
ON TABLE public.credit_transactions
TO authenticated, service_role;


-- ============================================================
-- 7. PLATFORM ADMIN ATOMIC ADJUSTMENT RPC
--
-- Security:
--   - SECURITY DEFINER with SET search_path = ''
--   - Verifies auth.uid() is active platform admin
--   - Excludes automated 'usage' type (manual admin only)
--   - Input bounds: ₹10,00,000 (100,000,000 paise) ceiling
--   - Row-level locking on credit_accounts
--   - Verified idempotency replay (raises IDEMPOTENCY_CONFLICT on mismatch)
--   - Updates credit_accounts atomically
--   - Inserts immutable credit_transactions row
--   - Inserts platform_audit_logs row in the same transaction
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
  IF p_reference_type IS NOT NULL THEN
    v_clean_ref_type := pg_catalog.nullif(pg_catalog.btrim(p_reference_type), '');
    IF v_clean_ref_type IS NOT NULL AND pg_catalog.length(v_clean_ref_type) > 64 THEN
      RAISE EXCEPTION 'Reference type cannot exceed 64 characters'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  IF p_reference_id IS NOT NULL THEN
    v_clean_ref_id := pg_catalog.nullif(pg_catalog.btrim(p_reference_id), '');
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
  v_caller_email := pg_catalog.coalesce(
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
