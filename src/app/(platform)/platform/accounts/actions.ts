"use server"

import { revalidatePath } from "next/cache"
import { requirePlatformAdmin } from "@/lib/auth/platform"

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function accountIdFrom(formData: FormData) {
  const accountId = String(formData.get("account_id") ?? "").trim()

  if (!UUID_RE.test(accountId)) {
    throw new Error("Invalid account ID")
  }

  return accountId
}

function refresh(accountId: string) {
  revalidatePath("/platform")
  revalidatePath("/platform/accounts")
  revalidatePath(`/platform/accounts/${accountId}`)
  revalidatePath("/platform/usage")
}

export async function setAccountStatusAction(formData: FormData) {
  const { supabase } = await requirePlatformAdmin()
  const accountId = accountIdFrom(formData)
  const status = String(formData.get("status") ?? "").trim()

  if (!["active", "suspended", "expired"].includes(status)) {
    throw new Error("Invalid account status")
  }

  const { error } = await supabase.rpc("set_account_status", {
    p_account_id: accountId,
    p_status: status,
  })

  if (error) {
    throw new Error(`Status update failed: ${error.message}`)
  }

  refresh(accountId)
}

export async function assignAccountPlanAction(formData: FormData) {
  const { supabase } = await requirePlatformAdmin()
  const accountId = accountIdFrom(formData)
  const planId = String(formData.get("plan_id") ?? "").trim()
  const startsOn = String(formData.get("starts_on") ?? "").trim()
  const expiresOn = String(formData.get("expires_on") ?? "").trim()

  if (!UUID_RE.test(planId)) {
    throw new Error("Choose a valid plan")
  }

  const startsAt = startsOn
    ? new Date(`${startsOn}T00:00:00.000Z`).toISOString()
    : new Date().toISOString()

  const expiresAt = expiresOn
    ? new Date(`${expiresOn}T23:59:59.999Z`).toISOString()
    : null

  if (expiresAt && new Date(expiresAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error("Plan expiry must be after the start date")
  }

  const { error } = await supabase.rpc("assign_account_plan", {
    p_account_id: accountId,
    p_plan_id: planId,
    p_starts_at: startsAt,
    p_expires_at: expiresAt,
  })

  if (error) {
    throw new Error(`Plan assignment failed: ${error.message}`)
  }

  refresh(accountId)
}

export async function cancelAccountPlanAction(formData: FormData) {
  const { supabase } = await requirePlatformAdmin()
  const accountId = accountIdFrom(formData)

  const { error } = await supabase.rpc("cancel_account_plan", {
    p_account_id: accountId,
  })

  if (error) {
    throw new Error(`Plan cancellation failed: ${error.message}`)
  }

  refresh(accountId)
}