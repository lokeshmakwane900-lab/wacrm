import { requirePlatformAdmin } from "@/lib/auth/platform"
import { upsertPlanAction } from "./actions"
import { PlanManager } from "./plan-manager"

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
            Create plans and edit existing plan limits from one place.
          </p>
        </div>

        <PlanManager plans={plans ?? []} action={upsertPlanAction} />
      </div>
    </main>
  )
}