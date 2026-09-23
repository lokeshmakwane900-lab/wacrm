"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PlusCircle, MinusCircle, Gift, RotateCcw, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { adjustCreditsAction } from "../actions";
import { formatCredits } from "@/lib/credits";
import type { ManualCreditTransactionType } from "@/types";

interface CreditAdjustmentFormProps {
  accountId: string;
  accountName: string;
  currentBalancePaise: number;
}

const ADJUSTMENT_TYPES: {
  type: ManualCreditTransactionType;
  label: string;
  verb: string;
  description: string;
  direction: "credit" | "debit";
  icon: typeof PlusCircle;
}[] = [
  {
    type: "admin_credit",
    label: "Add Credit",
    verb: "Add",
    description: "Standard manual balance top-up by platform administrator.",
    direction: "credit",
    icon: PlusCircle,
  },
  {
    type: "admin_debit",
    label: "Deduct Credit",
    verb: "Deduct",
    description: "Manual deduction or penalty. Cannot reduce balance below zero.",
    direction: "debit",
    icon: MinusCircle,
  },
  {
    type: "promotional_credit",
    label: "Promotional",
    verb: "Grant promotional",
    description: "Promotional bonus, campaign grant, or trial credit.",
    direction: "credit",
    icon: Gift,
  },
  {
    type: "refund",
    label: "Refund",
    verb: "Refund",
    description: "Correction or reimbursement for failed service or billed item.",
    direction: "credit",
    icon: RotateCcw,
  },
];

export function CreditAdjustmentForm({
  accountId,
  accountName,
  currentBalancePaise,
}: CreditAdjustmentFormProps) {
  const router = useRouter();
  const [selectedType, setSelectedType] = useState<ManualCreditTransactionType>("admin_credit");
  const [amountRupees, setAmountRupees] = useState("");
  const [reason, setReason] = useState("");
  const [referenceType, setReferenceType] = useState("");
  const [referenceId, setReferenceId] = useState("");

  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activeConfig = ADJUSTMENT_TYPES.find((t) => t.type === selectedType)!;
  const isDebit = activeConfig.direction === "debit";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    const trimmedAmount = amountRupees.trim();
    const numAmount = parseFloat(trimmedAmount);
    if (!trimmedAmount || isNaN(numAmount) || numAmount <= 0) {
      setErrorMessage("Please enter a valid amount greater than ₹0.");
      return;
    }

    if (numAmount > 1000000) {
      setErrorMessage("Maximum manual adjustment limit is ₹10,00,000.");
      return;
    }

    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      setErrorMessage("Reason is required.");
      return;
    }

    // Confirmation prompt before execution
    const confirmMessage = isDebit
      ? `Deduct ₹${numAmount.toLocaleString("en-IN")} Credits from ${accountName}?\n\nCurrent balance: ${formatCredits(currentBalancePaise)}`
      : `${activeConfig.verb} ₹${numAmount.toLocaleString("en-IN")} Credits to ${accountName}?`;

    if (!window.confirm(confirmMessage)) {
      return;
    }

    const formData = new FormData();
    formData.append("account_id", accountId);
    formData.append("transaction_type", selectedType);
    formData.append("amount", trimmedAmount);
    formData.append("reason", trimmedReason);
    if (referenceType.trim()) formData.append("reference_type", referenceType.trim());
    if (referenceId.trim()) formData.append("reference_id", referenceId.trim());

    startTransition(async () => {
      const res = await adjustCreditsAction(null, formData);
      if (res.error) {
        setErrorMessage(res.error);
      } else if (res.success) {
        setSuccessMessage(
          `Successfully ${isDebit ? "deducted" : "credited"} ₹${numAmount.toLocaleString("en-IN")} Credits! New balance: ${formatCredits(res.balanceAfterPaise ?? 0)}`
        );
        // Reset form
        setAmountRupees("");
        setReason("");
        setReferenceType("");
        setReferenceId("");
        router.refresh();
      }
    });
  };

  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-foreground">Manual Credit Adjustment</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Apply a secure platform credit or debit to internal customer balance. Records an immutable ledger row and audit log.
        </p>
      </div>

      {/* Adjustment Type Selector Tabs */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6">
        {ADJUSTMENT_TYPES.map((item) => {
          const Icon = item.icon;
          const isSelected = selectedType === item.type;
          const isItemDebit = item.direction === "debit";

          return (
            <button
              key={item.type}
              type="button"
              disabled={isPending}
              onClick={() => {
                setSelectedType(item.type);
                setErrorMessage(null);
              }}
              className={`flex flex-col items-start gap-1 p-3.5 rounded-xl border text-left transition-all ${
                isSelected
                  ? isItemDebit
                    ? "border-red-500/50 bg-red-500/10 text-red-500 dark:text-red-400"
                    : "border-primary bg-primary/10 text-primary"
                  : "border-border bg-background hover:bg-muted/40 text-muted-foreground"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span className="text-sm font-semibold text-foreground">{item.label}</span>
              </div>
              <span className="text-xs text-muted-foreground leading-snug line-clamp-1">
                {item.direction === "credit" ? "+ Balance" : "- Balance"}
              </span>
            </button>
          );
        })}
      </div>

      <div className="p-3 rounded-lg bg-muted/40 border border-border mb-6 text-xs text-muted-foreground">
        <strong className="text-foreground">{activeConfig.label}:</strong> {activeConfig.description}
      </div>

      {/* Error Banner */}
      {errorMessage && (
        <div className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400 text-sm flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <strong className="font-semibold block">Adjustment Failed</strong>
            <p className="mt-0.5">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Success Banner */}
      {successMessage && (
        <div className="mb-6 p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-sm flex items-start gap-3">
          <CheckCircle2 className="h-5 w-5 shrink-0 mt-0.5" />
          <div className="min-w-0">
            <strong className="font-semibold block">Adjustment Successful</strong>
            <p className="mt-0.5">{successMessage}</p>
          </div>
        </div>
      )}

      {/* Adjustment Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Amount Input */}
          <div>
            <label htmlFor="amount" className="block text-xs font-medium text-foreground mb-1.5">
              Amount (₹ INR) <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground font-semibold text-sm">
                ₹
              </span>
              <input
                id="amount"
                type="number"
                step="any"
                min="0.01"
                max="1000000"
                required
                value={amountRupees}
                onChange={(e) => setAmountRupees(e.target.value)}
                placeholder="e.g. 500 or 1000.50"
                disabled={isPending}
                className="w-full rounded-lg border border-border bg-background pl-8 pr-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Converted server-side to integer paise. Max ₹10,00,000 per adjustment.
            </p>
          </div>

          {/* Reference Type */}
          <div>
            <label htmlFor="reference_type" className="block text-xs font-medium text-foreground mb-1.5">
              Reference Type <span className="text-muted-foreground font-normal">(Optional)</span>
            </label>
            <input
              id="reference_type"
              type="text"
              maxLength={64}
              value={referenceType}
              onChange={(e) => setReferenceType(e.target.value)}
              placeholder="e.g. ticket, promo, invoice, manual_order"
              disabled={isPending}
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* Reason Input */}
          <div className="sm:col-span-2">
            <label htmlFor="reason" className="block text-xs font-medium text-foreground mb-1.5">
              Reason / Justification <span className="text-red-500">*</span>
            </label>
            <input
              id="reason"
              type="text"
              required
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Required justification for financial ledger audit trail..."
              disabled={isPending}
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Stored permanently in immutable transaction ledger and platform audit logs.
            </p>
          </div>

          {/* Reference ID */}
          <div className="sm:col-span-2">
            <label htmlFor="reference_id" className="block text-xs font-medium text-foreground mb-1.5">
              Reference ID <span className="text-muted-foreground font-normal">(Optional)</span>
            </label>
            <input
              id="reference_id"
              type="text"
              maxLength={255}
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              placeholder="e.g. TICKET-98234, PROMO-WELCOME2026, PAY-7891"
              disabled={isPending}
              className="w-full rounded-lg border border-border bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>
        </div>

        {/* Submit Button */}
        <div className="pt-2 flex items-center justify-end gap-3">
          <button
            type="submit"
            disabled={isPending}
            className={`inline-flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold transition-all shadow-sm ${
              isPending
                ? "bg-muted text-muted-foreground cursor-not-allowed"
                : isDebit
                ? "bg-red-600 hover:bg-red-500 text-white active:scale-95"
                : "bg-primary hover:bg-primary/90 text-primary-foreground active:scale-95"
            }`}
          >
            {isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Processing Adjustment...
              </>
            ) : (
              <>
                {isDebit ? <MinusCircle className="h-4 w-4" /> : <PlusCircle className="h-4 w-4" />}
                {isDebit ? "Confirm Deduction" : "Confirm Credit"}
              </>
            )}
          </button>
        </div>
      </form>
    </section>
  );
}
