import type { SupabaseClient, User } from '@supabase/supabase-js'

import { createClient } from '@/lib/supabase/server'
import { UnauthorizedError, ForbiddenError } from './account'

export interface PlatformAdminContext {
  supabase: SupabaseClient
  userId: string
  user: User
}

export async function isPlatformAdmin(): Promise<boolean> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    return false
  }

  const { data, error } = await supabase.rpc('is_platform_admin')

  if (error) {
    console.error('[isPlatformAdmin] platform admin check failed:', error)
    return false
  }

  return data === true
}
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const supabase = await createClient()

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new UnauthorizedError()
  }

  const { data: isPlatformAdmin, error: adminError } = await supabase.rpc(
    'is_platform_admin'
  )

  if (adminError) {
    console.error('[requirePlatformAdmin] platform admin check failed:', adminError)
    throw new ForbiddenError('Could not verify platform access')
  }

  if (isPlatformAdmin !== true) {
    throw new ForbiddenError('Platform administrator access required')
  }

  return {
    supabase,
    userId: user.id,
    user,
  }
}
