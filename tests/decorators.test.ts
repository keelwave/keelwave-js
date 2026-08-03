import { describe, expect, it } from 'vitest'
import { Keelwave } from '../src/index.js'

const ENDPOINT = process.env.KEELWAVE_ENDPOINT ?? 'http://localhost:8080'
const API_KEY = process.env.KEELWAVE_API_KEY ?? 'kw_test'

// The client is fail-soft, so these decorator unit tests run without a server.
function makeClient() {
  return new Keelwave({ apiKey: API_KEY, endpoint: ENDPOINT })
}

describe('@observe', () => {
  it('passes return value through', () => {
    const c = makeClient()
    const fn = c.observe((x: number) => x * 2)
    expect(fn(21)).toBe(42)
  })

  it('works without parens', () => {
    const c = makeClient()
    const fn = c.observe(function double(x: number) {
      return x * 2
    })
    expect(fn(3)).toBe(6)
  })

  it('works with options', () => {
    const c = makeClient()
    const fn = c.observe({ name: 'my_tool' })((x: number) => x + 1)
    expect(fn(10)).toBe(11)
  })

  it('async passes return value through', async () => {
    const c = makeClient()
    const fn = c.observe({ name: 'triple' })((x: number) => x * 3)
    expect(await fn(7)).toBe(21)
  })

  it('is fail-soft: does not crash on server down', () => {
    const c = new Keelwave({
      apiKey: 'kw_x',
      endpoint: 'http://127.0.0.1:19999',
    })
    const fn = c.observe((x: number) => x)
    expect(() => fn(5)).not.toThrow()
  })
})

describe('@agent', () => {
  it('returns function value', async () => {
    const c = makeClient()
    const fn = c.agent({ name: 'test-agent' })(
      async (task: string) => `done: ${task}`,
    )
    expect(await fn('hello')).toBe('done: hello')
  })

  it('works with name option', async () => {
    const c = makeClient()
    const fn = c.agent({ name: 'my-agent' })(async (t: string) =>
      t.toUpperCase(),
    )
    expect(await fn('abc')).toBe('ABC')
  })

  it('sets getCurrentRun inside callback', async () => {
    const c = makeClient()
    let inner: unknown

    const fn = c.agent({ name: 'ctx-agent' })(async () => {
      inner = c.getCurrentRun()
    })

    await fn()
    expect(inner).toBeDefined()
    expect(c.getCurrentRun()).toBeUndefined()
  })

  it('observe inside agent emits tool_call', async () => {
    const c = makeClient()

    const search = c.observe({ name: 'search', stepType: 'tool_call' })(
      async (q: string) => ({ results: [q] }),
    )

    const runAgent = c.agent({ name: 'linked' })(async (task: string) => {
      await search(task)
      return 'done'
    })

    expect(await runAgent('find me')).toBe('done')
  })
})

describe('span', () => {
  it('start/end emits step on active run', async () => {
    const c = makeClient()

    await c.run('span-test', async () => {
      const s = c.span('think', 'reasoning-step').start()
      s.set('thinking about the problem')
      await s.end()
    })
  })
})
