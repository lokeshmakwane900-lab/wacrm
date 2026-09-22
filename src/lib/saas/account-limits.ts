import type { SupabaseClient } from "@supabase/supabase-js"

export type AccountResource = "users" | "contacts" | "automations"

export interface AccountResourceLimit {
  allowed: boolean
  reason: string
  used: number
  limit: number | null
  planId: string | null
  planName: string | null
}

export async function getAccountResourceLimit(
  db: SupabaseClient,
  accountId: string,
  resource: AccountResource,
): Promise<AccountResourceLimit> {
  const { data, error } = await db.rpc("get_account_resource_limit", {
    p_account_id: accountId,
    p_resource: resource,
  })

  if (error) {
    throw new Error(`Account limit check failed: ${error.message}`)
  }

  const row = data?.[0]

  if (!row) {
    throw new Error("Account limit check returned no result")
  }

  return {
    allowed: Boolean(row.allowed),
    reason: String(row.reason ?? "unknown"),
    used: Number(row.used ?? 0),
    limit:
      row.resource_limit === null || row.resource_limit === undefined
        ? null
        : Number(row.resource_limit),
    planId: row.plan_id ?? null,
    planName: row.plan_name ?? null,
  }
}

export function accountLimitMessage(
  status: AccountResourceLimit,
  resource: AccountResource,
) {
  if (status.reason === "account_suspended") {
    return "This account is suspended."
  }

  if (status.reason === "account_expired") {
    return "This account is expired."
  }

  if (status.reason === "plan_inactive_or_expired") {
    return "This account does not have a current active plan."
  }

  const label =
    resource === "users"
      ? "User"
      : resource === "contacts"
        ? "Contact"
        : "Active automation"

  if (status.limit !== null) {
    return `${label} limit reached (${status.used}/${status.limit}). Change or upgrade the plan to continue.`
  }

  return `${label} creation is not allowed for the current plan.`
}
export type AccountAccessStatus = "active" | "suspended" | "expired"

export interface AccountAccessState {
  status: AccountAccessStatus
  reason: string
}

export async function getAccountAccessState(
  db: SupabaseClient,
  accountId: string,
): Promise<AccountAccessState> {
  const resource = await getAccountResourceLimit(db, accountId, "users")

  if (resource.reason === "account_suspended") {
    return { status: "suspended", reason: resource.reason }
  }

  if (
    resource.reason === "account_expired" ||
    resource.reason === "plan_inactive_or_expired"
  ) {
    return { status: "expired", reason: resource.reason }
  }

  return { status: "active", reason: resource.reason }
}