// Stable error codes shared by every Host module and surfaced to the page as
// `result.error.code`. Keep these literal: the Client localizes by code.
import type { Failure } from '../shared/contract.js'

export const ERROR_CODES = {
  usage: 'E_USAGE',
  profile: 'E_PROFILE',
  dump: 'E_DUMP',
  conflict: 'E_CONFLICT',
  write: 'E_WRITE',
  internal: 'E_INTERNAL',
} as const

export type AcpErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES]

/** Business failure that carries a stable code instead of a stack trace. */
export class AcpConfigError extends Error {
  readonly code: AcpErrorCode

  constructor(code: AcpErrorCode, message: string) {
    super(message)
    this.name = 'AcpConfigError'
    this.code = code
  }
}

/** Build the wire failure payload (HTTP 200; only malformed envelopes get 400). */
export function failure(code: AcpErrorCode, message: string): Failure {
  return { ok: false, error: { code, message } }
}

/** Map any thrown value onto a stable failure; unknown errors become E_INTERNAL. */
export function failureOf(error: unknown): Failure {
  if (error instanceof AcpConfigError) return failure(error.code, error.message)
  const message = error instanceof Error ? error.message : String(error)
  return failure(ERROR_CODES.internal, message || 'unexpected failure')
}
