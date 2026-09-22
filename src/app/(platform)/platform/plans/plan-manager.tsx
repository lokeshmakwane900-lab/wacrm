"use client"

import { useMemo, useState } from "react"

type Plan = {
  id: string
  code: string
  name: string
  description: string | null
  monthly_price_paise: number | string
  max_users: number | null
  max_contacts: number | null
  max_messages_monthly: number | null
  max_automations: number | null
  is_active: boolean
  sort_order: number
  created_at: string
}

type Props = {
  plans: Plan[]
  action: (formData: FormData) => void | Promise<void>
}

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

function inputValue(value: number | null) {
  return value === null ? "" : String(value)
}

export function PlanManager({ plans, action }: Props) {
  const [editingCode, setEditingCode] = useState<string | null>(null)

  const editingPlan = useMemo(
    () => plans.find((plan) => plan.code === editingCode) ?? null,
    [editingCode, plans],
  )

  function startEdit(code: string) {
    setEditingCode(code)
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  function cancelEdit() {
    setEditingCode(null)
  }

  const formKey = editingPlan?.id ?? "new"

  return (
    <>
      <form
        key={formKey}
        action={action}
        className="rounded-2xl border border-border bg-card p-5"
      >
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">
              {editingPlan ? `Edit plan: ${editingPlan.name}` : "Create new plan"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {editingPlan
                ? "Update price, limits or status, then save."
                : "Set plan price and usage limits."}
            </p>
          </div>

          {editingPlan ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted"
            >
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Plan code</span>
            <input
              name="code"
              required
              placeholder="basic"
              defaultValue={editingPlan?.code ?? ""}
              readOnly={!!editingPlan}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 read-only:cursor-not-allowed read-only:opacity-70"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Plan name</span>
            <input
              name="name"
              required
              placeholder="Basic"
              defaultValue={editingPlan?.name ?? ""}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Monthly price (INR)</span>
            <input
              name="monthly_price"
              type="number"
              min="0"
              step="1"
              defaultValue={editingPlan ? Number(editingPlan.monthly_price_paise) / 100 : 0}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Sort order</span>
            <input
              name="sort_order"
              type="number"
              min="0"
              defaultValue={editingPlan?.sort_order ?? 0}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Users limit</span>
            <input
              name="max_users"
              type="number"
              min="0"
              placeholder="Blank = unlimited"
              defaultValue={inputValue(editingPlan?.max_users ?? null)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Contacts limit</span>
            <input
              name="max_contacts"
              type="number"
              min="0"
              placeholder="Blank = unlimited"
              defaultValue={inputValue(editingPlan?.max_contacts ?? null)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Messages / month</span>
            <input
              name="max_messages_monthly"
              type="number"
              min="0"
              placeholder="Blank = unlimited"
              defaultValue={inputValue(editingPlan?.max_messages_monthly ?? null)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="text-muted-foreground">Automations limit</span>
            <input
              name="max_automations"
              type="number"
              min="0"
              placeholder="Blank = unlimited"
              defaultValue={inputValue(editingPlan?.max_automations ?? null)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2"
            />
          </label>
        </div>

        <label className="mt-4 block space-y-1 text-sm">
          <span className="text-muted-foreground">Description</span>
          <textarea
            name="description"
            rows={2}
            defaultValue={editingPlan?.description ?? ""}
            className="w-full rounded-lg border border-border bg-background px-3 py-2"
          />
        </label>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              name="is_active"
              defaultChecked={editingPlan?.is_active ?? true}
            />
            Active plan
          </label>

          <button
            type="submit"
            className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            {editingPlan ? "Update plan" : "Create plan"}
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
                <th className="px-5 py-3 font-medium">Action</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-border">
              {plans.map((plan) => (
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
                  <td className="px-5 py-4">
                    <button
                      type="button"
                      onClick={() => startEdit(plan.code)}
                      className="rounded-lg border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
                    >
                      Edit
                    </button>
                  </td>
                </tr>
              ))}

              {plans.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-muted-foreground">
                    No plans created yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}