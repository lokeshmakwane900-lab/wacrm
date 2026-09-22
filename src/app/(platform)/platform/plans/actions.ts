"use server"

import { revalidatePath } from "next/cache"
import { requirePlatformAdmin } from "@/lib/auth/platform"

function optionalInt(formData: FormData, key: string) {
  const raw = String(formData.get(key) ?? "").trim()
  if (!raw) return null

  const value = Number.parseInt(raw, 10)
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${key} must be zero or greater`)
  }

  return value
}

export async function upsertPlanAction(formData: FormData) {
  const { supabase } = await requirePlatformAdmin()

  const code = String(formData.get("code") ?? "").trim().toLowerCase()
  const name = String(formData.get("name") ?? "").trim()
  const description = String(formData.get("description") ?? "").trim()
  const monthlyPrice = Number(String(formData.get("monthly_price") ?? "0"))

  if (!code || !name) {
    throw new Error("Plan code and name are required")
  }

  if (!Number.isFinite(monthlyPrice) || monthlyPrice < 0) {
    throw new Error("Monthly price must be zero or greater")
  }

  const { error } = await supabase.rpc("upsert_plan", {
    p_code: code,
    p_name: name,
    p_description: description || null,
    p_monthly_price_paise: Math.round(monthlyPrice * 100),
    p_currency: "INR",
    p_max_users: optionalInt(formData, "max_users"),
    p_max_contacts: optionalInt(formData, "max_contacts"),
    p_max_messages_monthly: optionalInt(formData, "max_messages_monthly"),
    p_max_automations: optionalInt(formData, "max_automations"),
    p_is_active: formData.get("is_active") === "on",
    p_sort_order: optionalInt(formData, "sort_order") ?? 0,
  })

  if (error) {
    throw new Error(`Plan save failed: ${error.message}`)
  }

  revalidatePath("/platform/plans")
  revalidatePath("/platform")
}