/**
 * Credits Core UI & Calculation Helpers
 *
 * All monetary amounts in PostgreSQL are stored as integer paise (BIGINT),
 * where 100 paise = ₹1.00 INR.
 *
 * This module ensures safe rupees <-> paise conversions without floating-point
 * rounding errors (e.g. 19.99 * 100 = 1998.9999999999998).
 */

export const MAX_MANUAL_ADJUSTMENT_PAISE = 100000000; // ₹10,00,000 (from 055/056 migration)
export const MAX_MANUAL_ADJUSTMENT_RUPEES = 1000000;

export const TRANSACTION_TYPE_LABELS: Record<string, string> = {
  admin_credit: "Admin Credit",
  admin_debit: "Admin Debit",
  promotional_credit: "Promotional Credit",
  refund: "Refund",
  usage: "Usage",
};

export const TRANSACTION_TYPE_DIRECTIONS: Record<string, "credit" | "debit"> = {
  admin_credit: "credit",
  promotional_credit: "credit",
  refund: "credit",
  admin_debit: "debit",
  usage: "debit",
};

/**
 * Convert paise (integer) to formatted INR string.
 * Example: 10000 -> "₹100", 10050 -> "₹100.50"
 */
export function formatCredits(
  paise: number | bigint | string,
  options?: { showPaise?: boolean }
): string {
  const p = Number(paise ?? 0);
  const rupees = p / 100;
  const hasMinorUnits = p % 100 !== 0;

  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: options?.showPaise ? 2 : hasMinorUnits ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(rupees);
}

/**
 * Format a number as simple Indian grouping without symbol.
 * Example: 1000000 -> "10,00,000"
 */
export function formatNumberIN(value: number | bigint | string): string {
  return new Intl.NumberFormat("en-IN").format(Number(value ?? 0));
}

/**
 * Safe conversion from rupees input (string or number) to integer paise.
 * Avoids IEEE-754 floating-point inaccuracies.
 *
 * Returns integer paise, or NaN if the input is malformed / invalid.
 */
export function rupeesToPaise(val: number | string): number {
  const str = String(val ?? "").trim();
  // Validates: optional sign, digits, optional decimal with up to 2 decimal places
  if (!str || !/^\d+(\.\d{1,2})?$/.test(str)) {
    return NaN;
  }

  const [wholeStr, fracStr = ""] = str.split(".");
  const whole = parseInt(wholeStr, 10);
  if (isNaN(whole) || whole < 0) return NaN;

  // Pad fraction to 2 places (e.g. "5" -> "50", "" -> "00", "05" -> "05")
  const paddedFrac = (fracStr + "00").slice(0, 2);
  const frac = parseInt(paddedFrac, 10);
  if (isNaN(frac) || frac < 0) return NaN;

  const totalPaise = whole * 100 + frac;
  if (!Number.isSafeInteger(totalPaise)) return NaN;

  return totalPaise;
}

/**
 * Convert integer paise to decimal rupees number.
 */
export function paiseToRupees(paise: number | bigint | string): number {
  return Number(paise ?? 0) / 100;
}
