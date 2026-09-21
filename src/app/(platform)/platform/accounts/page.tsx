import { requirePlatformAdmin } from '@/lib/auth/platform'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type AccountRow = {
  id: string
  name: string
  created_at: string
}

type StatusRow = {
  account_id: string
  status: 'active' | 'suspended' | 'expired'
}

type AccountPlanRow = {
  account_id: string
  plan_id: string
  starts_at: string
  expires_at: string | null
  cancelled_at: string | null
}

type PlanRow = {
  id: string
  name: string
}

function statusClass(status: string) {
  if (status === 'active') {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
  }
  if (status === 'suspended') {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-400'
  }
  if (status === 'expired') {
    return 'border-red-500/20 bg-red-500/10 text-red-400'
  }
  return 'border-border bg-muted text-muted-foreground'
}

export default async function PlatformAccountsPage() {
  const { supabase } = await requirePlatformAdmin()

  const { data: accountData, error: accountError } = await supabase
    .from('accounts')
    .select('id, name, created_at')
    .order('created_at', { ascending: false })

  if (accountError) {
    console.error('[platform/accounts] accounts query failed:', accountError)
    throw new Error('Could not load platform accounts')
  }

  const accounts = (accountData ?? []) as AccountRow[]
  const accountIds = accounts.map((account) => account.id)

  let statuses: StatusRow[] = []
  let accountPlans: AccountPlanRow[] = []

  if (accountIds.length > 0) {
    const [statusResult, planResult] = await Promise.all([
      supabase
        .from('account_statuses')
        .select('account_id, status')
        .in('account_id', accountIds),
      supabase
        .from('account_plans')
        .select('account_id, plan_id, starts_at, expires_at, cancelled_at')
        .in('account_id', accountIds),
    ])

    if (statusResult.error) {
      console.error('[platform/accounts] statuses query failed:', statusResult.error)
      throw new Error('Could not load account statuses')
    }

    if (planResult.error) {
      console.error('[platform/accounts] account plans query failed:', planResult.error)
      throw new Error('Could not load account plans')
    }

    statuses = (statusResult.data ?? []) as StatusRow[]
    accountPlans = (planResult.data ?? []) as AccountPlanRow[]
  }

  const planIds = [...new Set(accountPlans.map((row) => row.plan_id))]
  let plans: PlanRow[] = []

  if (planIds.length > 0) {
    const { data: planData, error: planError } = await supabase
      .from('plans')
      .select('id, name')
      .in('id', planIds)

    if (planError) {
      console.error('[platform/accounts] plans query failed:', planError)
      throw new Error('Could not load plans')
    }

    plans = (planData ?? []) as PlanRow[]
  }

  const statusByAccount = new Map(
    statuses.map((row) => [row.account_id, row.status])
  )
  const planById = new Map(plans.map((plan) => [plan.id, plan.name]))
  const assignmentByAccount = new Map(
    accountPlans.map((assignment) => [assignment.account_id, assignment])
  )

  const now = Date.now()

  const rows = accounts.map((account) => {
    const status = statusByAccount.get(account.id) ?? 'unknown'
    const assignment = assignmentByAccount.get(account.id)

    const hasCurrentPlan =
      assignment !== undefined &&
      assignment.cancelled_at === null &&
      new Date(assignment.starts_at).getTime() <= now &&
      (assignment.expires_at === null ||
        new Date(assignment.expires_at).getTime() > now)

    return {
      ...account,
      status,
      planName:
        hasCurrentPlan && assignment
          ? planById.get(assignment.plan_id) ?? 'Unknown plan'
          : 'No current plan',
    }
  })

  const activeCount = rows.filter((row) => row.status === 'active').length
  const suspendedCount = rows.filter(
    (row) => row.status === 'suspended'
  ).length
  const expiredCount = rows.filter((row) => row.status === 'expired').length

  const dateFormatter = new Intl.DateTimeFormat('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })

  return (
    <main className="min-h-screen bg-background p-4 sm:p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            MK Creative · Platform Admin
          </p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Clients & Accounts
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Read-only overview of every WACRM customer account.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Total accounts</CardDescription>
              <CardTitle className="text-3xl">{rows.length}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Active</CardDescription>
              <CardTitle className="text-3xl">{activeCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Suspended</CardDescription>
              <CardTitle className="text-3xl">{suspendedCount}</CardTitle>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Expired</CardDescription>
              <CardTitle className="text-3xl">{expiredCount}</CardTitle>
            </CardHeader>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Customer accounts</CardTitle>
            <CardDescription>
              Account status and current plan assignment.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                No customer accounts found.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Client</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Current plan</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead>Account ID</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((account) => (
                    <TableRow key={account.id}>
                      <TableCell className="font-medium">
                        {account.name}
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium capitalize ${statusClass(
                            account.status
                          )}`}
                        >
                          {account.status}
                        </span>
                      </TableCell>
                      <TableCell>{account.planName}</TableCell>
                      <TableCell>
                        {dateFormatter.format(new Date(account.created_at))}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {account.id}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
