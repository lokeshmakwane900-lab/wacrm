import Link from "next/link"
import { notFound } from "next/navigation"
import { requirePlatformAdmin } from "@/lib/auth/platform"
import { ConfirmSubmitButton } from "../confirm-submit-button"
import {
  assignAccountPlanAction,
  cancelAccountPlanAction,
  setAccountStatusAction,
} from "../actions"

type AuditDetails = Record<string, unknown>

function formatDateTime(value: string | null) {
  if (!value) return "No expiry"

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value))
}

function formatUsage(value: unknown, limit: unknown) {
  const used = Number(value ?? 0).toLocaleString("en-IN")
  const max =
    limit === null || limit === undefined
      ? "Unlimited"
      : Number(limit).toLocaleString("en-IN")

  return `${used} / ${max}`
}

function asDetails(value: unknown): AuditDetails {
  return value && typeof value === "object"
    ? (value as AuditDetails)
    : {}
}

function activityText(
  action: string,
  detailsValue: unknown,
  planMap: Map<string, string>,
) {
  const details = asDetails(detailsValue)

  if (action === "status_changed") {
    return `Status changed: ${String(details.old_status ?? "unknown")} to ${String(
      details.new_status ?? "unknown",
    )}`
  }

  if (action === "status_created") {
    return `Status created: ${String(details.status ?? "unknown")}`
  }

  if (action === "plan_assigned") {
    const planId = String(details.plan_id ?? "")
    return `Plan assigned: ${planMap.get(planId) ?? "Unknown plan"}`
  }

  if (action === "plan_cancelled") {
    const planId = String(details.plan_id ?? "")
    return `Plan cancelled: ${planMap.get(planId) ?? "Unknown plan"}`
  }

  if (action === "plan_changed") {
    const oldPlanId = String(details.old_plan_id ?? "")
    const newPlanId = String(details.new_plan_id ?? "")
    const oldName = planMap.get(oldPlanId) ?? "Unknown plan"
    const newName = planMap.get(newPlanId) ?? "Unknown plan"

    if (oldPlanId === newPlanId) {
      return `Plan dates updated: ${newName}`
    }

    return `Plan changed: ${oldName} to ${newName}`
  }

  return action.replaceAll("_", " ")
}

export default async function PlatformClientPage({
  params,
}: {
  params: Promise<{ accountId: string }>
}) {
  const { accountId } = await params
  const { supabase } = await requirePlatformAdmin()

  const [
    accountResult,
    statusResult,
    assignmentResult,
    plansResult,
    usageResult,
    auditResult,
  ] = await Promise.all([
    supabase
      .from("accounts")
      .select("id,name,created_at")
      .eq("id", accountId)
      .maybeSingle(),

    supabase
      .from("account_statuses")
      .select("account_id,status,updated_at")
      .eq("account_id", accountId)
      .maybeSingle(),

    supabase
      .from("account_plans")
      .select("account_id,plan_id,starts_at,expires_at,cancelled_at,updated_at")
      .eq("account_id", accountId)
      .maybeSingle(),

    supabase
      .from("plans")
      .select("id,code,name,is_active,monthly_price_paise,sort_order")
      .order("sort_order", { ascending: true }),

    supabase.rpc("get_account_usage", {
      p_account_id: accountId,
    }),

    supabase
      .from("platform_audit_logs")
      .select("id,actor_email,action,details,created_at")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(20),
  ])

  if (accountResult.error) throw accountResult.error
  if (!accountResult.data) notFound()

  if (statusResult.error) throw statusResult.error
  if (assignmentResult.error) throw assignmentResult.error
  if (plansResult.error) throw plansResult.error
  if (usageResult.error) throw usageResult.error
  if (auditResult.error) throw auditResult.error

  const account = accountResult.data
  const status = statusResult.data?.status ?? "unknown"
  const assignment = assignmentResult.data
  const plans = plansResult.data ?? []
  const activePlans = plans.filter((plan) => plan.is_active)
  const currentPlan = assignment
    ? plans.find((plan) => plan.id === assignment.plan_id) ?? null
    : null
  const usage = usageResult.data?.[0] ?? null
  const auditLogs = auditResult.data ?? []

  const planMap = new Map(
    plans.map((plan) => [plan.id, plan.name]),
  )

  const now = Date.now()
  const hasCurrentPlan =
    !!assignment &&
    !assignment.cancelled_at &&
    new Date(assignment.starts_at).getTime() <= now &&
    (!assignment.expires_at ||
      new Date(assignment.expires_at).getTime() > now)

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Link
              href="/platform/accounts"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Back to clients
            </Link>

            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {account.name}
            </h1>

            <p className="mt-2 font-mono text-xs text-muted-foreground">
              {account.id}
            </p>
          </div>

          <div className="rounded-full border border-border px-3 py-1 text-sm capitalize">
            {status}
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Current status</p>
            <p className="mt-2 text-2xl font-semibold capitalize">{status}</p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Current plan</p>
            <p className="mt-2 text-2xl font-semibold">
              {hasCurrentPlan ? currentPlan?.name ?? "Unknown plan" : "No current plan"}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Plan expiry</p>
            <p className="mt-2 text-lg font-semibold">
              {hasCurrentPlan ? formatDateTime(assignment?.expires_at ?? null) : "Not set"}
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <p className="text-sm text-muted-foreground">Messages this month</p>
            <p className="mt-2 text-2xl font-semibold">
              {formatUsage(
                usage?.messages_used_monthly,
                usage?.messages_limit_monthly,
              )}
            </p>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Account status</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Suspended or expired accounts are blocked by the message quota engine.
            </p>

            <div className="mt-5 flex flex-wrap gap-3">
              {status !== "active" ? (
                <form action={setAccountStatusAction}>
                  <input type="hidden" name="account_id" value={account.id} />
                  <input type="hidden" name="status" value="active" />
                  <button
                    type="submit"
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
                  >
                    Reactivate
                  </button>
                </form>
              ) : null}

              {status !== "suspended" ? (
                <form action={setAccountStatusAction}>
                  <input type="hidden" name="account_id" value={account.id} />
                  <input type="hidden" name="status" value="suspended" />
                  <ConfirmSubmitButton
                    message="Suspend this client? Outbound WhatsApp sending will be blocked until reactivated."
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Suspend
                  </ConfirmSubmitButton>
                </form>
              ) : null}

              {status !== "expired" ? (
                <form action={setAccountStatusAction}>
                  <input type="hidden" name="account_id" value={account.id} />
                  <input type="hidden" name="status" value="expired" />
                  <ConfirmSubmitButton
                    message="Mark this client as expired? Outbound WhatsApp sending will be blocked."
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Mark expired
                  </ConfirmSubmitButton>
                </form>
              ) : null}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">Assign / change plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only active plans can be newly assigned.
            </p>

            <form action={assignAccountPlanAction} className="mt-5 space-y-4">
              <input type="hidden" name="account_id" value={account.id} />

              <label className="block space-y-1 text-sm">
                <span className="text-muted-foreground">Plan</span>
                <select
                  name="plan_id"
                  required
                  defaultValue={hasCurrentPlan ? assignment?.plan_id ?? "" : ""}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2"
                >
                  <option value="" disabled>
                    Select plan
                  </option>

                  {activePlans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} ({plan.code})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Start date (optional)</span>
                  <input
                    type="date"
                    name="starts_on"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                </label>

                <label className="block space-y-1 text-sm">
                  <span className="text-muted-foreground">Expiry date (optional)</span>
                  <input
                    type="date"
                    name="expires_on"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2"
                  />
                </label>
              </div>

              <button
                type="submit"
                disabled={activePlans.length === 0}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                Assign / change plan
              </button>

              {activePlans.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Create an active plan on the Plans page first.
                </p>
              ) : null}
            </form>

            {assignment && !assignment.cancelled_at ? (
              <div className="mt-5 border-t border-border pt-5">
                <p className="text-sm text-muted-foreground">
                  Assigned plan: {currentPlan?.name ?? "Unknown plan"} | starts{" "}
                  {formatDateTime(assignment.starts_at)} | expiry{" "}
                  {formatDateTime(assignment.expires_at)}
                </p>

                <form action={cancelAccountPlanAction} className="mt-3">
                  <input type="hidden" name="account_id" value={account.id} />
                  <ConfirmSubmitButton
                    message="Cancel this client's current plan? The account will no longer have an active plan."
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Cancel plan
                  </ConfirmSubmitButton>
                </form>
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="text-lg font-semibold">Live usage</h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[
              ["Users", formatUsage(usage?.users_used, usage?.users_limit)],
              ["Contacts", formatUsage(usage?.contacts_used, usage?.contacts_limit)],
              [
                "Messages",
                formatUsage(
                  usage?.messages_used_monthly,
                  usage?.messages_limit_monthly,
                ),
              ],
              [
                "Automations",
                formatUsage(
                  usage?.automations_used,
                  usage?.automations_limit,
                ),
              ],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border p-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-2 text-xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card">
          <div className="border-b border-border p-5">
            <h2 className="text-lg font-semibold">Recent activity</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Latest Super Admin changes for this client.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Action</th>
                  <th className="px-5 py-3 font-medium">Admin</th>
                  <th className="px-5 py-3 font-medium">When</th>
                </tr>
              </thead>

              <tbody className="divide-y divide-border">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="px-5 py-4">
                      {activityText(log.action, log.details, planMap)}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {log.actor_email ?? "Platform admin"}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {formatDateTime(log.created_at)}
                    </td>
                  </tr>
                ))}

                {auditLogs.length === 0 ? (
                  <tr>
                    <td
                      colSpan={3}
                      className="px-5 py-10 text-center text-muted-foreground"
                    >
                      No audited changes yet.
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