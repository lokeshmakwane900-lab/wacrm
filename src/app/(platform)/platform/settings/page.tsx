import Link from "next/link"
import { requirePlatformAdmin } from "@/lib/auth/platform"

export default async function PlatformSettingsPage() {
  await requirePlatformAdmin()

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Platform Settings</h1>
          <p className="mt-2 text-muted-foreground">Super Admin control centre.</p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">Platform security</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Platform routes are protected by the Platform Admin server guard.
            </p>
          </div>

          <div className="rounded-2xl border border-border bg-card p-5">
            <h2 className="font-semibold">SaaS configuration</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Plans and account controls are managed from dedicated platform pages.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-3">
          <Link href="/platform/accounts" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Manage clients
          </Link>
          <Link href="/platform/plans" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            Manage plans
          </Link>
          <Link href="/platform/usage" className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
            View usage
          </Link>
        </div>
      </div>
    </main>
  )
}