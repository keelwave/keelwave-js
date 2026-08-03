import { describe, expect, it } from 'vitest'
import {
  Keelwave,
  KeelwaveAuthError,
  KeelwaveTransportError,
  KeelwaveValidationError,
} from '../src/index.js'

const ENDPOINT = process.env.KEELWAVE_ENDPOINT ?? 'http://localhost:8080'
const API_KEY = process.env.KEELWAVE_API_KEY ?? 'kw_test'

// These exercise real server responses (health, auth, validation), so they
// only run when a live keelwave server + API key is configured. The offline
// error-mapping paths are covered in unit.test.ts.
const HAS_SERVER = Boolean(process.env.KEELWAVE_API_KEY)
const describeIntegration = HAS_SERVER ? describe : describe.skip

function makeClient(key = API_KEY) {
  return new Keelwave({ apiKey: key, endpoint: ENDPOINT, raiseOnError: true })
}

describeIntegration('Keelwave.health', () => {
  it('returns ok', async () => {
    const c = makeClient()
    const h = await c.health()
    expect(h.status).toBe('ok')
  })
})

describeIntegration('Keelwave.ingestAi', () => {
  it('accepts minimum payload', async () => {
    const c = makeClient()
    await expect(
      c.ingestAi({ model: 'gpt-4o', status: 'success', provider: 'openai' }),
    ).resolves.toBeUndefined()
  })

  it('accepts all optional fields', async () => {
    const c = makeClient()
    await expect(
      c.ingestAi({
        model: 'gpt-4o',
        status: 'success',
        provider: 'openai',
        inputTokens: 100,
        outputTokens: 50,
        latencyMs: 300,
        costUsd: 0.002,
      }),
    ).resolves.toBeUndefined()
  })

  it('throws KeelwaveAuthError on bad key', async () => {
    const c = makeClient('kw_badkey')
    await expect(
      c.ingestAi({ model: 'gpt-4o', status: 'success' }),
    ).rejects.toBeInstanceOf(KeelwaveAuthError)
  })

  it('throws KeelwaveValidationError on invalid status', async () => {
    const c = makeClient()
    await expect(
      c.ingestAi({ model: 'gpt-4o', status: 'invalid' as 'success' }),
    ).rejects.toBeInstanceOf(KeelwaveValidationError)
  })

  it('throws KeelwaveTransportError on unreachable host', async () => {
    const c = new Keelwave({
      apiKey: 'kw_x',
      endpoint: 'http://127.0.0.1:19999',
      raiseOnError: true,
    })
    await expect(c.health()).rejects.toBeInstanceOf(KeelwaveTransportError)
  })
})
