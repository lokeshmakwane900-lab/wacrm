import { requirePlatformAdmin } from "@/lib/auth/platform"

function formatUsage(value: unknown, limit: unknown) {
  const used = Number(value ?? 0).toLocaleString("en-IN")
  const max =
    limit === null || limit === undefined
      ? "Unlimited"
      : Number(limit).toLocaleString("en-IN")

  return `${used} / ${max}`
}

export default async function PlatformUsagePage() {
  const { supabase } = await requirePlatformAdmin()

  const { data: accounts, error: accountsError } = await supabase
    .from("accounts")
    .select("id,name,created_at")
    .order("created_at", { ascending: false })

  if (accountsError) {
    throw new Error(`Accounts failed: ${accountsError.message}`)
  }

  const rows = await Promise.all(
    (accounts ?? []).map(async (account) => {
      const { data, error } = await supabase.rpc("get_account_usage", {
        p_account_id: account.id,
      })

      return {
        account,
        usage: data?.[0] ?? null,
        error: error?.message ?? null,
      }
    }),
  )

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Usage</h1>
          <p className="mt-2 text-muted-foreground">
            Live usage and current plan limits for every client account.
          </p>
        </div>

        <section className="rounded-2xl border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Client</th>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Users</th>
                  <th className="px-5 py-3 font-medium">Contacts</th>
                  <th className="px-5 py-3 font-medium">Messages</th>
                  <th className="px-5 py-3 font-medium">Automations</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {rows.map(({ account, usage, error }) => (
                  <tr key={account.id}>
                    <td className="px-5 py-4 font-medium">{account.name}</td>

                    {error ? (
                      <td colSpan={5} className="px-5 py-4 text-destructive">
                        {error}
                      </td>
                    ) : (
                      <>
                        <td className="px-5 py-4">{usage?.plan_name ?? "No current plan"}</td>
                        <td className="px-5 py-4">{formatUsage(usage?.users_used, usage?.users_limit)}</td>
                        <td className="px-5 py-4">{formatUsage(usage?.contacts_used, usage?.contacts_limit)}</td>
                        <td className="px-5 py-4">{formatUsage(usage?.messages_used_monthly, usage?.messages_limit_monthly)}</td>
                        <td className="px-5 py-4">{formatUsage(usage?.automations_used, usage?.automations_limit)}</td>
                      </>
                    )}
                  </tr>
                ))}

                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-10 text-center text-muted-foreground">
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