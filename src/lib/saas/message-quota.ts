import 'server-only'

import { supabaseAdmin } from '@/lib/flows/admin-client'

type QuotaRow = {
  allowed: boolean
  reservation_id: string | null
  reason: string | null
  messages_used: number
  messages_limit: number | null
  period_start: string
}

export type MessageQuotaReservation = {
  reservationId: string
  reason: string | null
  messagesUsed: number
  messagesLimit: number | null
  periodStart: string
}

export class MessageQuotaError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'MessageQuotaError'
    this.code = code
    this.status = status
  }
}

function blockedMessage(reason: string | null) {
  switch (reason) {
    case 'message_limit_reached':
      return {
        message: 'Monthly message limit reached for this account.',
        status: 429,
      }

    case 'account_suspended':
      return {
        message: 'This account is suspended.',
        status: 403,
      }

    case 'account_expired':
      return {
        message: 'This account is expired.',
        status: 403,
      }

    case 'plan_inactive_or_expired':
      return {
        message: 'The assigned plan is inactive or expired.',
        status: 403,
      }

    default:
      return {
        message: 'Message sending is not allowed for this account.',
        status: 403,
      }
  }
}

export async function reserveMessageQuota(
  accountId: string,
  source: string
): Promise<MessageQuotaReservation> {
  const db = supabaseAdmin()

  const { data, error } = await db.rpc('reserve_message_quota', {
    p_account_id: accountId,
    p_source: source,
  })

  if (error) {
    console.error('[message-quota] reserve failed:', error.message)

    throw new MessageQuotaError(
      'quota_check_failed',
      'Unable to verify message quota.',
      503
    )
  }

  const row = (Array.isArray(data) ? data[0] : data) as QuotaRow | null

  if (!row) {
    throw new MessageQuotaError(
      'quota_check_failed',
      'Message quota returned no result.',
      503
    )
  }

  if (!row.allowed) {
    const blocked = blockedMessage(row.reason)

    throw new MessageQuotaError(
      row.reason || 'quota_blocked',
      blocked.message,
      blocked.status
    )
  }

  if (!row.reservation_id) {
    throw new MessageQuotaError(
      'quota_reservation_failed',
      'Message quota reservation was not created.',
      503
    )
  }

  return {
    reservationId: row.reservation_id,
    reason: row.reason,
    messagesUsed: row.messages_used,
    messagesLimit: row.messages_limit,
    periodStart: row.period_start,
  }
}

export async function commitMessageQuota(
  reservationId: string
): Promise<boolean> {
  const db = supabaseAdmin()

  const { data, error } = await db.rpc('commit_message_quota', {
    p_reservation_id: reservationId,
  })

  if (error) {
    console.error('[message-quota] commit failed:', error.message)
    return false
  }

  return data === true
}

export async function releaseMessageQuota(
  reservationId: string
): Promise<boolean> {
  const db = supabaseAdmin()

  const { data, error } = await db.rpc('release_message_quota', {
    p_reservation_id: reservationId,
  })

  if (error) {
    console.error('[message-quota] release failed:', error.message)
    return false
  }

  return data === true
}