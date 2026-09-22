import Link from "next/link"
import { requirePlatformAdmin } from "@/lib/auth/platform"

type AccountStatus = "active" | "suspended" | "expired"

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value))
}

export default async function PlatformAccountsPage() {
  const { supabase } = await requirePlatformAdmin()

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id,name,created_at")
    .order("created_at", { ascending: false })

  if (accountsError) {
    throw new Error(`Accounts failed: ${accountsError.message}`)
  }

  const accountRows = accounts ?? []
  const accountIds = accountRows.map((account) => account.id)

  const [statusResult, assignmentResult, planResult] = await Promise.all([
    accountIds.length
      ? supabase
          .from("account_statuses")
          .select("account_id,status")
          .in("account_id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    accountIds.length
      ? supabase
          .from("account_plans")
          .select("account_id,plan_id,starts_at,expires_at,cancelled_at")
          .in("account_id", accountIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("plans")
      .select("id,name")
      .order("sort_order", { ascending: true }),
  ])

  if (statusResult.error) throw statusResult.error
  if (assignmentResult.error) throw assignmentResult.error
  if (planResult.error) throw planResult.error

  const statusMap = new Map(
    (statusResult.data ?? []).map((row) => [
      row.account_id,
      row.status as AccountStatus,
    ]),
  )

  const planMap = new Map(
    (planResult.data ?? []).map((plan) => [plan.id, plan.name]),
  )

  const now = Date.now()
  const currentPlanMap = new Map<string, string>()

  for (const assignment of assignmentResult.data ?? []) {
    const starts = new Date(assignment.starts_at).getTime()
    const expires = assignment.expires_at
      ? new Date(assignment.expires_at).getTime()
      : null

    if (
      !assignment.cancelled_at &&
      starts <= now &&
      (expires === null || expires > now)
    ) {
      currentPlanMap.set(
        assignment.account_id,
        planMap.get(assignment.plan_id) ?? "Unknown plan",
      )
    }
  }

  const total = accountRows.length
  const active = accountRows.filter(
    (account) => statusMap.get(account.id) === "active",
  ).length
  const suspended = accountRows.filter(
    (account) => statusMap.get(account.id) === "suspended",
  ).length
  const expired = accountRows.filter(
    (account) => statusMap.get(account.id) === "expired",
  ).length

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">MK Creative</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">
            Clients & Accounts
          </h1>
          <p className="mt-2 text-muted-foreground">
            Open a client to manage plan, status, expiry and usage.
          </p>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[
            ["Total accounts", total],
            ["Active", active],
            ["Suspended", suspended],
            ["Expired", expired],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="rounded-2xl border border-border bg-card p-5"
            >
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-3xl font-semibold">{value}</p>
            </div>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-5">
            <h2 className="text-lg font-semibold">Client accounts</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 font-medium">Current plan</th>
                  <th className="px-5 py-3 font-medium">Created</th>
                  <th className="px-5 py-3 font-medium">Account ID</th>
                  <th className="px-5 py-3 font-medium">Control</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {accountRows.map((account) => (
                  <tr key={account.id}>
                    <td className="px-5 py-4 font-medium">{account.name}</td>
                    <td className="px-5 py-4 capitalize">
                      {statusMap.get(account.id) ?? "unknown"}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {currentPlanMap.get(account.id) ?? "No current plan"}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {formatDate(account.created_at)}
                    </td>
                    <td className="px-5 py-4 font-mono text-xs text-muted-foreground">
                      {account.id}
                    </td>
                    <td className="px-5 py-4">
                      <Link
                        href={`/platform/accounts/${account.id}`}
                        className="inline-flex rounded-lg border border-border px-3 py-2 text-sm font-medium hover:bg-muted"
                      >
                        Open client
                      </Link>
                    </td>
                  </tr>
                ))}

                {accountRows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-10 text-center text-muted-foreground"
                    >
                      No accounts found.
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