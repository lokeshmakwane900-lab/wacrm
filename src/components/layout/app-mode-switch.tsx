"use client";

import Link from "next/link";
import { LayoutDashboard, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";

type AppMode = "wacrm" | "platform";

export function AppModeSwitch({
  current,
  className,
}: {
  current: AppMode;
  className?: string;
}) {
  const itemClass = (active: boolean) =>
    cn(
      "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-xs font-medium transition-colors sm:text-sm",
      active
        ? "bg-background text-foreground shadow-sm"
        : "text-muted-foreground hover:text-foreground"
    );

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border bg-muted/50 p-1",
        className
      )}
      aria-label="Application mode"
    >
      <Link href="/dashboard" className={itemClass(current === "wacrm")}>
        <LayoutDashboard className="h-4 w-4" />
        <span>WACRM</span>
      </Link>

      <Link href="/platform" className={itemClass(current === "platform")}>
        <ShieldCheck className="h-4 w-4" />
        <span className="hidden sm:inline">Platform Admin</span>
        <span className="sm:hidden">Admin</span>
      </Link>
    </div>
  );
}