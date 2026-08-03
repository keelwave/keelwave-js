import { describe, expect, it } from 'vitest'
import { Keelwave } from '../src/index.js'

const ENDPOINT = process.env.KEELWAVE_ENDPOINT ?? 'http://localhost:8080'
const API_KEY = process.env.KEELWAVE_API_KEY ?? 'kw_test'

// Integration tests hit a live keelwave server; they only run when a real
// API key is provided. Everything else is fail-soft and runs offline.
const HAS_SERVER = Boolean(process.env.KEELWAVE_API_KEY)
const describeIntegration = HAS_SERVER ? describe : describe.skip

function makeClient() {
  return new Keelwave({ apiKey: API_KEY, endpoint: ENDPOINT })
}

describe('Run lifecycle', () => {
  it('opens and closes a run with steps', async () => {
    const c = makeClient()
    await c.run(
      'test-agent',
      async (run) => {
        expect(run.id).toBeTruthy()
        await run.step('think', 'I should search')
        await run.toolCall('web_search', { q: 'vitest' }, { results: [] })
        run.setOutput('done')
      },
      { input: 'test task' },
    )
  })

  it('marks run failed on exception', async () => {
    const c = makeClient()
    await expect(
      c.run('test-agent', async () => {
        throw new Error('simulated failure')
      }),
    ).rejects.toThrow('simulated failure')
  })

  it('detects loops locally via fingerprint', async () => {
    const c = makeClient()
    await c.run('looper', async (run) => {
      for (let i = 0; i < 3; i++) {
        await run.toolCall('search', { q: 'same query' }, { results: [] })
      }
      expect(run.loopDetected).toBe(true)
    })
  })
})

describe('getCurrentRun', () => {
  it('is set inside run() callback, undefined outside', async () => {
    const c = makeClient()
    let inner: unknown

    await c.run('ctx-test', async (run) => {
      inner = c.getCurrentRun()
      expect(inner).toBe(run)
    })

    expect(c.getCurrentRun()).toBeUndefined()
  })
})

describeIntegration('loop detection (server)', () => {
  it('persists the loop to the /loops endpoint', async () => {
    const c = makeClient()

    let runId!: string
    let timestamp!: string

    await c.run('looper', async (run) => {
      runId = run.id
      timestamp = run.timestamp
      for (let i = 0; i < 3; i++) {
        await run.toolCall('search', { q: 'same query' }, { results: [] })
      }
      expect(run.loopDetected).toBe(true)
    })

    // wait for batch flush
    await new Promise((r) => setTimeout(r, 2500))

    const resp = await fetch(
      `${ENDPOINT}/v1/agent/runs/${runId}/loops?at=${encodeURIComponent(timestamp)}`,
      { headers: { Authorization: `Bearer ${API_KEY}` } },
    )
    const body = (await resp.json()) as { data?: Array<{ hits: number }> }
    const hits = body.data ?? []
    expect(hits.some((h) => h.hits >= 2)).toBe(true)
  })
})
