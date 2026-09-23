import { requirePlatformAdmin } from "@/lib/auth/platform";
import { formatCredits } from "@/lib/credits";
import { CreditsTable, type AccountCreditRow } from "./credits-table";
import { Coins, ArrowDownLeft, ArrowUpRight, Users } from "lucide-react";

export default async function PlatformCreditsPage() {
  const { supabase } = await requirePlatformAdmin();

  // Query accounts and credit_accounts in parallel
  const [
    { data: accounts, error: accountsError },
    { data: creditAccounts, error: caError },
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id, name, created_at")
      .order("name", { ascending: true }),
    supabase
      .from("credit_accounts")
      .select("account_id, currency, balance_paise, lifetime_credited_paise, lifetime_debited_paise, updated_at"),
  ]);

  if (accountsError) {
    throw new Error(`Failed to load accounts: ${accountsError.message}`);
  }

  if (caError) {
    throw new Error(`Failed to load credit accounts: ${caError.message}`);
  }

  const accountRows = accounts ?? [];
  const creditMap = new Map((creditAccounts ?? []).map((ca) => [ca.account_id, ca]));

  // Calculate aggregates
  let totalBalancePaise = 0;
  let totalLifetimeCreditedPaise = 0;
  let totalLifetimeDebitedPaise = 0;

  const tableRows: AccountCreditRow[] = accountRows.map((account) => {
    const ca = creditMap.get(account.id);
    const balance = Number(ca?.balance_paise ?? 0);
    const credited = Number(ca?.lifetime_credited_paise ?? 0);
    const debited = Number(ca?.lifetime_debited_paise ?? 0);

    totalBalancePaise += balance;
    totalLifetimeCreditedPaise += credited;
    totalLifetimeDebitedPaise += debited;

    return {
      accountId: account.id,
      name: account.name,
      createdAt: account.created_at,
      balancePaise: balance,
      lifetimeCreditedPaise: credited,
      lifetimeDebitedPaise: debited,
      updatedAt: ca?.updated_at || account.created_at,
    };
  });

  const summaryStats = [
    {
      label: "Total Client Credit Balance",
      value: formatCredits(totalBalancePaise),
      sub: "Current settled liability across all clients",
      icon: Coins,
      highlight: true,
    },
    {
      label: "Total Lifetime Credited",
      value: formatCredits(totalLifetimeCreditedPaise),
      sub: "Cumulative credits issued since genesis",
      icon: ArrowDownLeft,
    },
    {
      label: "Total Lifetime Debited",
      value: formatCredits(totalLifetimeDebitedPaise),
      sub: "Cumulative credits consumed / debited",
      icon: ArrowUpRight,
    },
    {
      label: "Active Credit Accounts",
      value: (creditAccounts ?? []).length.toLocaleString("en-IN"),
      sub: `Across ${accountRows.length} total client accounts`,
      icon: Users,
    },
  ];

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">MK Creative Platform</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight text-foreground">
            Credits & Billing
          </h1>
          <p className="mt-1.5 text-muted-foreground">
            Monitor client credit balances, lifetime issuance, usage debits, and perform manual adjustments.
          </p>
        </div>

        {/* Top Summary Cards */}
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {summaryStats.map((stat) => {
            const Icon = stat.icon;
            return (
              <div
                key={stat.label}
                className="rounded-2xl border border-border bg-card p-5 space-y-2 relative overflow-hidden"
              >
                <div className="flex items-center justify-between text-muted-foreground">
                  <p className="text-sm font-medium">{stat.label}</p>
                  <Icon className="h-4 w-4 opacity-80" />
                </div>
                <p
                  className={`text-3xl font-semibold tracking-tight ${
                    stat.highlight
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-foreground"
                  }`}
                >
                  {stat.value}
                </p>
                <p className="text-xs text-muted-foreground">{stat.sub}</p>
              </div>
            );
          })}
        </section>

        {/* Client Credits Searchable Table */}
        <CreditsTable rows={tableRows} />
      </div>
    </main>
  );
}
