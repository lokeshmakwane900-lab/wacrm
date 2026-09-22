import type { Metadata } from "next";
import { getCurrentAccount } from "@/lib/auth/account";
import { DashboardShell } from "./dashboard-shell";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: {
      index: false,
      follow: false,
      noimageindex: true,
    },
  },
};

function AccountBlocked({
  status,
  accountName,
}: {
  status: "suspended" | "expired";
  accountName: string;
}) {
  const suspended = status === "suspended";

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-5 w-fit rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {suspended ? "Account suspended" : "Plan expired"}
        </div>

        <h1 className="text-2xl font-semibold tracking-tight">
          {suspended ? "This workspace is suspended" : "This workspace plan has expired"}
        </h1>

        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {suspended
            ? "CRM access is temporarily unavailable. Contact your administrator or Super Admin to reactivate this account."
            : "CRM access is unavailable until an active plan is assigned or renewed."}
        </p>

        <div className="mt-6 rounded-xl border border-border bg-muted/30 p-4 text-left">
          <p className="text-xs text-muted-foreground">Workspace</p>
          <p className="mt-1 font-medium">{accountName}</p>
        </div>
      </div>
    </main>
  );
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentAccount();

  if (ctx.accountStatus !== "active") {
    return (
      <AccountBlocked
        status={ctx.accountStatus}
        accountName={ctx.account.name}
      />
    );
  }

  return <DashboardShell>{children}</DashboardShell>;
}