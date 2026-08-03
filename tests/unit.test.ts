import { afterEach, describe, expect, it, vi } from 'vitest'
import { Keelwave } from '../src/index.js'
import { raiseOrWarn, request } from '../src/http.js'
import {
  KeelwaveAuthError,
  KeelwaveBufferFull,
  KeelwaveRateLimited,
  KeelwaveServerError,
  KeelwaveTransportError,
  KeelwaveValidationError,
} from '../src/errors.js'

// A port nothing listens on — every ingest call fails, exercising fail-soft.
const DEAD = 'http://127.0.0.1:9'

describe('fail-soft: tracing never breaks the caller', () => {
  it('runs the agent callback and returns its value when the server is down', async () => {
    const c = new Keelwave({ apiKey: 'kw_test', endpoint: DEAD })
    let ran = false

    const out = await c.run('offline-agent', async (run) => {
      ran = true
      expect(run.id).toBeTruthy() // a local run id is synthesised
      await run.step('think', 'no server here')
      await run.toolCall('search', { q: 'x' }, { results: [] })
      return 'ok'
    })

    expect(ran).toBe(true)
    expect(out).toBe('ok')
  })

  it('@observe passes the return value through with the server down', () => {
    const c = new Keelwave({ apiKey: 'kw_test', endpoint: DEAD })
    const fn = c.observe((x: number) => x * 2)
    expect(fn(21)).toBe(42)
  })
})

describe('loop detection', () => {
  it('does not flag a single tool call as a loop', async () => {
    const c = new Keelwave({ apiKey: 'kw_test', endpoint: DEAD })
    await c.run('single', async (run) => {
      await run.toolCall('search', { q: 'once' }, { results: [] })
      expect(run.loopDetected).toBe(false)
    })
  })

  it('flags a repeated identical tool call as a loop', async () => {
    const c = new Keelwave({ apiKey: 'kw_test', endpoint: DEAD })
    await c.run('repeat', async (run) => {
      await run.toolCall('search', { q: 'same' }, { results: [] })
      await run.toolCall('search', { q: 'same' }, { results: [] })
      expect(run.loopDetected).toBe(true)
    })
  })

  it('does not flag distinct inputs as a loop', async () => {
    const c = new Keelwave({ apiKey: 'kw_test', endpoint: DEAD })
    await c.run('distinct', async (run) => {
      await run.toolCall('search', { q: 'a' }, {})
      await run.toolCall('search', { q: 'b' }, {})
      expect(run.loopDetected).toBe(false)
    })
  })

  it('fingerprints an observed tool call exactly once (no false loop)', async () => {
    const c = new Keelwave({ apiKey: 'kw_test', endpoint: DEAD })
    const search = c.observe({ name: 'search', stepType: 'tool_call' })(
      async (q: string) => ({ results: [q] }),
    )
    await c.run('observed', async (run) => {
      await search('same')
      await new Promise((r) => setTimeout(r, 50)) // let the fire-and-forget emit settle
      expect(run.loopDetected).toBe(false)
    })
  })
})

describe('client config', () => {
  it('trims a trailing slash from the endpoint', () => {
    const c = new Keelwave({
      apiKey: 'k',
      endpoint: 'http://example.com:8080/',
    })
    expect(c.endpoint).toBe('http://example.com:8080')
  })

  it('defaults the endpoint to localhost:8080', () => {
    expect(new Keelwave({ apiKey: 'k' }).endpoint).toBe('http://localhost:8080')
  })
})

describe('request error mapping', () => {
  afterEach(() => vi.restoreAllMocks())

  const cases: Array<[number, new (...a: Array<any>) => Error]> = [
    [400, KeelwaveValidationError],
    [401, KeelwaveAuthError],
    [429, KeelwaveRateLimited],
    [503, KeelwaveBufferFull],
    [500, KeelwaveServerError],
  ]

  for (const [status, Err] of cases) {
    it(`maps HTTP ${status} to ${Err.name}`, async () => {
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'boom' }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      await expect(
        request('http://x', 'k', 'GET', '/p'),
      ).rejects.toBeInstanceOf(Err)
    })
  }

  it('maps a network failure to KeelwaveTransportError', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'))
    await expect(request('http://x', 'k', 'GET', '/p')).rejects.toBeInstanceOf(
      KeelwaveTransportError,
    )
  })
})

describe('raiseOrWarn', () => {
  afterEach(() => vi.restoreAllMocks())

  it('throws when raiseOnError is true', () => {
    expect(() => raiseOrWarn(new Error('x'), true)).toThrow()
  })

  it('warns without throwing when raiseOnError is false', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => raiseOrWarn(new Error('x'), false)).not.toThrow()
    expect(warn).toHaveBeenCalled()
  })
})
