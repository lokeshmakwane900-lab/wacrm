"use server";

import { revalidatePath } from "next/cache";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import {
  MAX_MANUAL_ADJUSTMENT_PAISE,
  MAX_MANUAL_ADJUSTMENT_RUPEES,
  rupeesToPaise,
} from "@/lib/credits";
import type { ManualCreditTransactionType } from "@/types";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MANUAL_TYPES: ManualCreditTransactionType[] = [
  "admin_credit",
  "admin_debit",
  "promotional_credit",
  "refund",
];

export interface AdjustCreditsActionResult {
  success?: boolean;
  error?: string;
  transactionId?: string;
  balanceAfterPaise?: number;
}

export async function adjustCreditsAction(
  prevState: AdjustCreditsActionResult | null,
  formData: FormData
): Promise<AdjustCreditsActionResult> {
  try {
    // 1. Authenticate Platform Admin (fails with UnauthorizedError or ForbiddenError if not admin)
    const { supabase, userId } = await requirePlatformAdmin();

    // 2. Validate account ID
    const accountId = String(formData.get("account_id") ?? "").trim();
    if (!UUID_RE.test(accountId)) {
      return { error: "Invalid account ID" };
    }

    // 3. Validate transaction type
    const transactionType = String(
      formData.get("transaction_type") ?? ""
    ).trim() as ManualCreditTransactionType;

    if (!ALLOWED_MANUAL_TYPES.includes(transactionType)) {
      return {
        error: `Invalid adjustment type. Allowed types: ${ALLOWED_MANUAL_TYPES.join(", ")}`,
      };
    }

    // 4. Validate amount (rupees -> integer paise)
    const amountRupeesRaw = String(formData.get("amount") ?? "").trim();
    const amountPaise = rupeesToPaise(amountRupeesRaw);

    if (isNaN(amountPaise) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      return { error: "Amount must be a positive number with at most 2 decimal places" };
    }

    if (amountPaise > MAX_MANUAL_ADJUSTMENT_PAISE) {
      return {
        error: `Amount exceeds the maximum manual adjustment limit of ₹${MAX_MANUAL_ADJUSTMENT_RUPEES.toLocaleString("en-IN")}`,
      };
    }

    // 5. Validate reason
    const reasonRaw = String(formData.get("reason") ?? "").trim();
    if (!reasonRaw) {
      return { error: "Reason is required" };
    }
    if (reasonRaw.length > 500) {
      return { error: "Reason cannot exceed 500 characters" };
    }

    // 6. Validate optional reference fields
    const refTypeRaw = String(formData.get("reference_type") ?? "").trim() || null;
    if (refTypeRaw && refTypeRaw.length > 64) {
      return { error: "Reference type cannot exceed 64 characters" };
    }

    const refIdRaw = String(formData.get("reference_id") ?? "").trim() || null;
    if (refIdRaw && refIdRaw.length > 255) {
      return { error: "Reference ID cannot exceed 255 characters" };
    }

    // 7. Generate unique idempotency key on trusted server action layer
    const idempotencyKey = `manual_adj_${Date.now()}_${crypto.randomUUID()}`;

    // 8. Execute financial adjustment via public.platform_adjust_credits RPC
    const { data: rpcRows, error: rpcError } = await supabase.rpc(
      "platform_adjust_credits",
      {
        p_account_id: accountId,
        p_transaction_type: transactionType,
        p_amount_paise: amountPaise,
        p_reason: reasonRaw,
        p_reference_type: refTypeRaw,
        p_reference_id: refIdRaw,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (rpcError) {
      return {
        error: rpcError.message || "Failed to adjust credits",
      };
    }

    const resultRow = rpcRows?.[0];

    // 9. Revalidate platform paths
    revalidatePath("/platform");
    revalidatePath("/platform/credits");
    revalidatePath(`/platform/credits/${accountId}`);

    return {
      success: true,
      transactionId: resultRow?.transaction_id,
      balanceAfterPaise: Number(resultRow?.balance_after_paise ?? 0),
    };
  } catch (err: any) {
    return {
      error: err.message || "An unexpected error occurred while adjusting credits",
    };
  }
}
