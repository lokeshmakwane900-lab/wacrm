import Link from "next/link"
import { requirePlatformAdmin } from "@/lib/auth/platform"

function asNumber(value: unknown) {
  return Number(value ?? 0)
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

export default async function PlatformPage() {
  const { supabase } = await requirePlatformAdmin()

  const [{ data: overviewRows, error: overviewError }, { data: recentAccounts, error: recentError }] =
    await Promise.all([
      supabase.rpc("get_platform_overview"),
      supabase
        .from("accounts")
        .select("id,name,created_at")
        .order("created_at", { ascending: false })
        .limit(5),
    ])

  if (overviewError) {
    throw new Error(`Platform overview failed: ${overviewError.message}`)
  }

  if (recentError) {
    throw new Error(`Recent clients failed: ${recentError.message}`)
  }

  const overview = overviewRows?.[0]

  const stats = [
    ["Total clients", asNumber(overview?.total_accounts)],
    ["Active", asNumber(overview?.active_accounts)],
    ["Suspended", asNumber(overview?.suspended_accounts)],
    ["Expired", asNumber(overview?.expired_accounts)],
    ["Plans assigned", asNumber(overview?.current_plans_assigned)],
    ["No current plan", asNumber(overview?.accounts_without_current_plan)],
    ["Messages this month", asNumber(overview?.messages_used_monthly).toLocaleString("en-IN")],
  ]

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">MK Creative</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Platform Overview</h1>
          <p className="mt-2 text-muted-foreground">
            Live SaaS account, plan and monthly usage overview.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {stats.map(([label, value]) => (
            <div key={String(label)} className="rounded-2xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-semibold">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-card">
          <div className="flex items-center justify-between gap-4 border-b border-border p-5">
            <div>
              <h2 className="text-lg font-semibold">Recent clients</h2>
              <p className="mt-1 text-sm text-muted-foreground">Latest customer accounts.</p>
            </div>
            <Link href="/platform/accounts" className="text-sm font-medium text-primary hover:underline">
              View all
            </Link>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Account ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(recentAccounts ?? []).map((account) => (
                  <tr key={account.id}>
                    <td className="px-5 py-4 font-medium">{account.name}</td>
                    <td className="px-5 py-4 text-muted-foreground">{formatDate(account.created_at)}</td>
                    <td className="px-5 py-4 font-mono text-xs text-muted-foreground">{account.id}</td>
                  </tr>
                ))}
                {(recentAccounts ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-5 py-10 text-center text-muted-foreground">
                      No client accounts found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  )
}