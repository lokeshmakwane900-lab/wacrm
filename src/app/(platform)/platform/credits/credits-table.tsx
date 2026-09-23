"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, ArrowRight, Wallet, CheckCircle2 } from "lucide-react";
import { formatCredits } from "@/lib/credits";

export interface AccountCreditRow {
  accountId: string;
  name: string;
  createdAt: string;
  balancePaise: number;
  lifetimeCreditedPaise: number;
  lifetimeDebitedPaise: number;
  updatedAt: string;
}

interface CreditsTableProps {
  rows: AccountCreditRow[];
}

function formatDate(iso: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function CreditsTable({ rows }: CreditsTableProps) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredRows = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(term));
  }, [rows, searchTerm]);

  return (
    <section className="rounded-2xl border border-border bg-card overflow-hidden">
      <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Client Credits Accounts</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Search and manage service credit balances for all accounts.
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by client name..."
            className="w-full rounded-lg border border-border bg-background pl-9 pr-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border text-muted-foreground bg-muted/40">
            <tr>
              <th className="px-5 py-3.5 font-medium">Client</th>
              <th className="px-5 py-3.5 font-medium">Current Credits</th>
              <th className="px-5 py-3.5 font-medium">Lifetime Credited</th>
              <th className="px-5 py-3.5 font-medium">Lifetime Debited</th>
              <th className="px-5 py-3.5 font-medium">Last Activity</th>
              <th className="px-5 py-3.5 font-medium text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRows.map((row) => (
              <tr key={row.accountId} className="hover:bg-muted/30 transition-colors">
                <td className="px-5 py-4">
                  <div className="font-medium text-foreground">{row.name}</div>
                  <div className="font-mono text-xs text-muted-foreground">{row.accountId}</div>
                </td>
                <td className="px-5 py-4">
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatCredits(row.balancePaise)}
                  </span>
                </td>
                <td className="px-5 py-4 text-muted-foreground font-mono text-xs">
                  {formatCredits(row.lifetimeCreditedPaise)}
                </td>
                <td className="px-5 py-4 text-muted-foreground font-mono text-xs">
                  {formatCredits(row.lifetimeDebitedPaise)}
                </td>
                <td className="px-5 py-4 text-muted-foreground text-xs">
                  {formatDate(row.updatedAt)}
                </td>
                <td className="px-5 py-4 text-right">
                  <Link
                    href={`/platform/credits/${row.accountId}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted hover:text-primary transition-colors"
                  >
                    Manage
                    <ArrowRight className="h-3 w-3" />
                  </Link>
                </td>
              </tr>
            ))}

            {filteredRows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
                  {searchTerm.trim() ? (
                    <div>
                      <p className="font-medium">No client accounts match "{searchTerm.trim()}"</p>
                      <p className="text-xs mt-1">Try searching with a different client name.</p>
                    </div>
                  ) : (
                    <div>
                      <p className="font-medium">No client credit accounts found.</p>
                      <p className="text-xs mt-1">Accounts will appear here once provisioned.</p>
                    </div>
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
