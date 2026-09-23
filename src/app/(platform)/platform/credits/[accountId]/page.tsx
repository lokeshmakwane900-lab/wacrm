import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/platform";
import { formatCredits, TRANSACTION_TYPE_LABELS, TRANSACTION_TYPE_DIRECTIONS } from "@/lib/credits";
import { CreditAdjustmentForm } from "./credit-adjustment-form";
import {
  Coins,
  ArrowLeft,
  ArrowDownLeft,
  ArrowUpRight,
  ShieldAlert,
  Clock,
  History,
  FileText,
} from "lucide-react";

interface PageProps {
  params: Promise<{ accountId: string }>;
}

function formatDateTime(iso: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(iso));
}

export default async function ClientCreditsDetailPage({ params }: PageProps) {
  const { accountId } = await params;
  const { supabase } = await requirePlatformAdmin();

  // Parallel fetch: account, account_status, credit_accounts, transactions, audit logs
  const [
    accountRes,
    statusRes,
    creditAccRes,
    transactionsRes,
    auditRes,
  ] = await Promise.all([
    supabase.from("accounts").select("id, name, created_at").eq("id", accountId).single(),
    supabase.from("account_statuses").select("status, reason").eq("account_id", accountId).maybeSingle(),
    supabase.from("credit_accounts").select("*").eq("account_id", accountId).maybeSingle(),
    supabase
      .from("credit_transactions")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("platform_audit_logs")
      .select("id, actor_email, action, details, created_at")
      .eq("account_id", accountId)
      .eq("action", "credit_adjustment")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (accountRes.error || !accountRes.data) {
    notFound();
  }

  const account = accountRes.data;
  const status = statusRes.data?.status ?? "active";
  const creditAccount = creditAccRes.data;
  const transactions = transactionsRes.data ?? [];
  const auditLogs = auditRes.data ?? [];

  const balancePaise = Number(creditAccount?.balance_paise ?? 0);
  const creditedPaise = Number(creditAccount?.lifetime_credited_paise ?? 0);
  const debitedPaise = Number(creditAccount?.lifetime_debited_paise ?? 0);

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Back Link & Header */}
        <div>
          <Link
            href="/platform/credits"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors mb-3"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to Credits & Billing
          </Link>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
                  {account.name}
                </h1>
                <span
                  className={`inline-block px-2.5 py-0.5 text-xs font-semibold rounded-full capitalize ${
                    status === "active"
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                      : status === "suspended"
                      ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                      : "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20"
                  }`}
                >
                  {status}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground font-mono">
                Account ID: {account.id}
              </p>
            </div>

            {/* Prominent Current Credits Display */}
            <div className="rounded-2xl border border-border bg-card p-4 sm:p-5 flex items-center gap-4 sm:min-w-[240px] justify-between shadow-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Current Credits
                </p>
                <p className="mt-1 text-2xl sm:text-3xl font-extrabold text-emerald-600 dark:text-emerald-400">
                  {formatCredits(balancePaise)}
                </p>
              </div>
              <div className="h-12 w-12 rounded-xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                <Coins className="h-6 w-6" />
              </div>
            </div>
          </div>
        </div>

        {/* Summary Balance Cards */}
        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Settled Balance</span>
              <Coins className="h-4 w-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-bold text-foreground">{formatCredits(balancePaise)}</p>
            <p className="text-xs text-muted-foreground">Available for automated billing</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Lifetime Credited</span>
              <ArrowDownLeft className="h-4 w-4 text-blue-500" />
            </div>
            <p className="text-2xl font-bold text-foreground">{formatCredits(creditedPaise)}</p>
            <p className="text-xs text-muted-foreground">Total credits granted to date</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5 space-y-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium uppercase tracking-wider">Lifetime Debited</span>
              <ArrowUpRight className="h-4 w-4 text-amber-500" />
            </div>
            <p className="text-2xl font-bold text-foreground">{formatCredits(debitedPaise)}</p>
            <p className="text-xs text-muted-foreground">Total credits consumed / adjusted</p>
          </div>
        </section>

        {/* Manual Credit Adjustment Panel */}
        <CreditAdjustmentForm
          accountId={account.id}
          accountName={account.name}
          currentBalancePaise={balancePaise}
        />

        {/* Immutable Transaction Ledger History */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-5">
            <div>
              <div className="flex items-center gap-2">
                <History className="h-5 w-5 text-primary" />
                <h2 className="text-lg font-semibold text-foreground">Transaction History</h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Immutable, append-only accounting ledger. Showing newest {transactions.length} records.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs sm:text-sm">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Adjustment</th>
                  <th className="px-5 py-3 font-medium">Balance Before</th>
                  <th className="px-5 py-3 font-medium">Balance After</th>
                  <th className="px-5 py-3 font-medium">Reason & Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {transactions.map((tx) => {
                  const direction =
                    TRANSACTION_TYPE_DIRECTIONS[tx.transaction_type] ??
                    (tx.transaction_type.includes("credit") ? "credit" : "debit");
                  const isCredit = direction === "credit";
                  const label = TRANSACTION_TYPE_LABELS[tx.transaction_type] ?? tx.transaction_type;

                  return (
                    <tr key={tx.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3.5 text-muted-foreground whitespace-nowrap text-xs">
                        {formatDateTime(tx.created_at)}
                      </td>
                      <td className="px-5 py-3.5 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded text-[11px] font-semibold ${
                            tx.transaction_type === "admin_credit"
                              ? "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20"
                              : tx.transaction_type === "promotional_credit"
                              ? "bg-purple-500/10 text-purple-600 dark:text-purple-400 border border-purple-500/20"
                              : tx.transaction_type === "refund"
                              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                              : tx.transaction_type === "admin_debit"
                              ? "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                              : "bg-slate-500/10 text-slate-600 dark:text-slate-400 border border-slate-500/20"
                          }`}
                        >
                          {label}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-bold whitespace-nowrap">
                        <span
                          className={
                            isCredit
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }
                        >
                          {isCredit ? "+" : "−"}
                          {formatCredits(tx.amount_paise)}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-muted-foreground whitespace-nowrap">
                        {formatCredits(tx.balance_before_paise)}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs font-semibold text-foreground whitespace-nowrap">
                        {formatCredits(tx.balance_after_paise)}
                      </td>
                      <td className="px-5 py-3.5 max-w-xs">
                        <p className="font-medium text-foreground text-xs truncate" title={tx.reason}>
                          {tx.reason}
                        </p>
                        {(tx.reference_type || tx.reference_id) && (
                          <p className="text-[11px] text-muted-foreground font-mono mt-0.5 truncate">
                            {tx.reference_type ? `${tx.reference_type}: ` : ""}
                            {tx.reference_id || ""}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}

                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
                      No financial transactions recorded for this account yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Platform Audit Logs Section */}
        <section className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border p-5">
            <div>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-indigo-500" />
                <h2 className="text-lg font-semibold text-foreground">Recent Credit Audit Logs</h2>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Super Admin audit trail recorded for regulatory and compliance tracking.
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Timestamp</th>
                  <th className="px-5 py-3 font-medium">Actor</th>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Amount</th>
                  <th className="px-5 py-3 font-medium">Type</th>
                  <th className="px-5 py-3 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {auditLogs.map((log) => {
                  const details = (log.details as any) || {};
                  const txType = details.transaction_type;
                  const label = TRANSACTION_TYPE_LABELS[txType] ?? txType ?? "Adjustment";
                  const amount = details.amount_paise ? formatCredits(details.amount_paise) : "—";
                  const direction = details.direction;

                  return (
                    <tr key={log.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-3 text-muted-foreground whitespace-nowrap">
                        {formatDateTime(log.created_at)}
                      </td>
                      <td className="px-5 py-3 font-mono text-foreground whitespace-nowrap">
                        {log.actor_email || "Platform Admin"}
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap">
                        <span className="inline-block px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-500/10 text-indigo-500 border border-indigo-500/20">
                          {log.action}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono font-semibold whitespace-nowrap">
                        <span
                          className={
                            direction === "credit"
                              ? "text-emerald-500"
                              : direction === "debit"
                              ? "text-red-500"
                              : "text-foreground"
                          }
                        >
                          {direction === "credit" ? "+" : direction === "debit" ? "−" : ""}
                          {amount}
                        </span>
                      </td>
                      <td className="px-5 py-3 whitespace-nowrap font-medium text-foreground">
                        {label}
                      </td>
                      <td className="px-5 py-3 max-w-sm truncate text-muted-foreground" title={details.reason}>
                        {details.reason || "—"}
                      </td>
                    </tr>
                  );
                })}

                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      No platform credit audit logs recorded for this account.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
