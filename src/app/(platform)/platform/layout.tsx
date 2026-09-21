import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'

import { PlatformShell } from './platform-shell'
import { requirePlatformAdmin } from '@/lib/auth/platform'
import { UnauthorizedError, ForbiddenError } from '@/lib/auth/account'

export const metadata: Metadata = {
  title: 'Platform Admin',
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
}

export default async function PlatformLayout({
  children,
}: {
  children: React.ReactNode
}) {
  try {
    await requirePlatformAdmin()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      redirect('/login')
    }
    if (error instanceof ForbiddenError) {
      notFound()
    }
    throw error
  }

  return <PlatformShell>{children}</PlatformShell>
}
