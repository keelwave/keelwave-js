import {
  KeelwaveAuthError,
  KeelwaveBufferFull,
  KeelwaveError,
  KeelwaveRateLimited,
  KeelwaveServerError,
  KeelwaveTransportError,
  KeelwaveValidationError,
} from './errors.js'

interface ErrorEnvelope {
  error: string
}

export async function request<T>(
  endpoint: string,
  apiKey: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${endpoint}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    throw new KeelwaveTransportError(
      `network error: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  if (response.ok) {
    if (response.status === 204) return undefined as T
    return (await response.json()) as T
  }

  let message = response.statusText
  try {
    const env = (await response.json()) as ErrorEnvelope
    message = env.error || message
  } catch {}

  const retryAfter = response.headers.get('Retry-After')

  switch (response.status) {
    case 400:
      throw new KeelwaveValidationError(message)
    case 401:
      throw new KeelwaveAuthError(message)
    case 429:
      throw new KeelwaveRateLimited(
        message,
        retryAfter ? Number(retryAfter) : null,
      )
    case 503:
      throw new KeelwaveBufferFull(message)
    default:
      throw new KeelwaveServerError(message, response.status)
  }
}

export function raiseOrWarn(err: unknown, raiseOnError: boolean): void {
  if (raiseOnError)
    throw err instanceof KeelwaveError ? err : new KeelwaveError(String(err))
  const msg = err instanceof Error ? err.message : String(err)
  console.warn(`[keelwave] emit failed: ${msg}`)
}
