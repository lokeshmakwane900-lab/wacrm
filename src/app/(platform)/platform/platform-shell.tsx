'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  BarChart3,
  Building2,
  Coins,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
} from 'lucide-react'

import { ModeToggle } from '@/components/layout/mode-toggle'
import { AppModeSwitch } from '@/components/layout/app-mode-switch'
import { cn } from '@/lib/utils'

const navItems = [
  { href: '/platform', label: 'Overview', icon: LayoutDashboard },
  { href: '/platform/accounts', label: 'Clients', icon: Building2 },
  { href: '/platform/plans', label: 'Plans', icon: SlidersHorizontal },
  { href: '/platform/usage', label: 'Usage', icon: BarChart3 },
  { href: '/platform/credits', label: 'Credits & Billing', icon: Coins },
  { href: '/platform/settings', label: 'Settings', icon: Settings },
]

function pageTitle(pathname: string) {
  if (pathname.startsWith('/platform/accounts')) return 'Clients'
  if (pathname.startsWith('/platform/plans')) return 'Plans'
  if (pathname.startsWith('/platform/usage')) return 'Usage'
  if (pathname.startsWith('/platform/credits')) return 'Credits & Billing'
  if (pathname.startsWith('/platform/settings')) return 'Settings'
  return 'Overview'
}

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">MK Creative</p>
            <p className="text-xs text-muted-foreground">Platform Admin</p>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4">
          <ul className="space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon
              const active = item.href === '/platform' ? pathname === '/platform' : pathname.startsWith(item.href)
              return (
                <li key={item.href}>
                  <Link href={item.href} className={cn('flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
                    <Icon className="h-4 w-4" />{item.label}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>
        <div className="border-t border-border p-3">
          <AppModeSwitch current="platform" className="w-full justify-center" />
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between gap-3 border-b border-border bg-background px-4 sm:px-6">
          <div><p className="text-xs text-muted-foreground">MK Creative Platform</p><h1 className="text-base font-semibold text-foreground sm:text-lg">{pageTitle(pathname)}</h1></div>
          <div className="flex items-center gap-2"><ModeToggle /><AppModeSwitch current="platform" /></div>
        </header>
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 lg:hidden">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = item.href === '/platform' ? pathname === '/platform' : pathname.startsWith(item.href)
            return <Link key={item.href} href={item.href} className={cn('flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium', active ? 'bg-primary/10 text-primary' : 'text-muted-foreground')}><Icon className="h-4 w-4" />{item.label}</Link>
          })}
        </nav>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  )
}
