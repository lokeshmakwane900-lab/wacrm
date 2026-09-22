import { requirePlatformAdmin } from "@/lib/auth/platform"
import { upsertPlanAction } from "./actions"

function money(paise: number | string) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(paise) / 100)
}

function limit(value: number | null) {
  return value === null ? "Unlimited" : Number(value).toLocaleString("en-IN")
}

export default async function PlatformPlansPage() {
  const { supabase } = await requirePlatformAdmin()

  const { data: plans, error } = await supabase
    .from("plans")
    .select("id,code,name,description,monthly_price_paise,max_users,max_contacts,max_messages_monthly,max_automations,is_active,sort_order,created_at")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true })

  if (error) {
    throw new Error(`Plans failed: ${error.message}`)
  }

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Plans</h1>
          <p className="mt-2 text-muted-foreground">
            Create a plan or reuse an existing plan code to update it.
          </p>
        </div>

        <form action={upsertPlanAction} className="rounded-2xl border border-border bg-card p-5">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Plan code</span>
              <input name="code" required placeholder="basic" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Plan name</span>
              <input name="name" required placeholder="Basic" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Monthly price (INR)</span>
              <input name="monthly_price" type="number" min="0" step="1" defaultValue="0" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Sort order</span>
              <input name="sort_order" type="number" min="0" defaultValue="0" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Users limit</span>
              <input name="max_users" type="number" min="0" placeholder="Blank = unlimited" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Contacts limit</span>
              <input name="max_contacts" type="number" min="0" placeholder="Blank = unlimited" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Messages / month</span>
              <input name="max_messages_monthly" type="number" min="0" placeholder="Blank = unlimited" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>

            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Automations limit</span>
              <input name="max_automations" type="number" min="0" placeholder="Blank = unlimited" className="w-full rounded-lg border border-border bg-background px-3 py-2" />
            </label>
          </div>

          <label className="mt-4 block space-y-1 text-sm">
            <span className="text-muted-foreground">Description</span>
            <textarea name="description" rows={2} className="w-full rounded-lg border border-border bg-background px-3 py-2" />
          </label>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="is_active" defaultChecked />
              Active plan
            </label>

            <button type="submit" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
              Save plan
            </button>
          </div>
        </form>

        <section className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-5">
            <h2 className="text-lg font-semibold">Plan catalogue</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Plan</th>
                  <th className="px-5 py-3 font-medium">Price</th>
                  <th className="px-5 py-3 font-medium">Users</th>
                  <th className="px-5 py-3 font-medium">Contacts</th>
                  <th className="px-5 py-3 font-medium">Messages</th>
                  <th className="px-5 py-3 font-medium">Automations</th>
                  <th className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {(plans ?? []).map((plan) => (
                  <tr key={plan.id}>
                    <td className="px-5 py-4">
                      <div className="font-medium">{plan.name}</div>
                      <div className="text-xs text-muted-foreground">{plan.code}</div>
                    </td>
                    <td className="px-5 py-4">{money(plan.monthly_price_paise)}</td>
                    <td className="px-5 py-4">{limit(plan.max_users)}</td>
                    <td className="px-5 py-4">{limit(plan.max_contacts)}</td>
                    <td className="px-5 py-4">{limit(plan.max_messages_monthly)}</td>
                    <td className="px-5 py-4">{limit(plan.max_automations)}</td>
                    <td className="px-5 py-4">{plan.is_active ? "Active" : "Inactive"}</td>
                  </tr>
                ))}

                {(plans ?? []).length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-10 text-center text-muted-foreground">
                      No plans created yet.
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