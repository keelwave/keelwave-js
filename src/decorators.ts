import { getCurrentRun } from './run.js'
import { raiseOrWarn } from './http.js'
import type { Keelwave } from './client.js'

type AnyFn = (...args: Array<any>) => unknown
type AsyncFn = (...args: Array<any>) => Promise<unknown>

function buildInput(args: Array<unknown>): Record<string, unknown> {
  if (args.length === 0) return {}
  if (
    args.length === 1 &&
    args[0] !== null &&
    typeof args[0] === 'object' &&
    !Array.isArray(args[0])
  ) {
    return args[0] as Record<string, unknown>
  }
  return { args }
}

function buildOutput(result: unknown, error: unknown): Record<string, unknown> {
  if (error !== undefined) return { error: String(error).slice(0, 500) }
  if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
    return result as Record<string, unknown>
  }
  if (result === undefined || result === null) return {}
  return { value: String(result).slice(0, 500) }
}

// ── @observe ──────────────────────────────────────────────────────────────────

export interface ObserveOptions {
  name?: string
  stepType?: string
}

export function makeObserve(client: Keelwave, opts: ObserveOptions = {}) {
  return function decorator<T extends AnyFn | AsyncFn>(fn: T): T {
    const fnName = opts.name ?? (fn.name || undefined) ?? 'fn'
    const stepType = opts.stepType ?? 'tool_call'

    const isAsync = fn.constructor.name === 'AsyncFunction'

    if (isAsync) {
      const wrapped = async function (this: unknown, ...args: Array<unknown>) {
        const t0 = Date.now()
        let result: unknown
        let error: unknown
        try {
          result = await (fn as AsyncFn).apply(this, args)
          return result
        } catch (err) {
          error = err
          throw err
        } finally {
          await emitAsync(
            client,
            fnName,
            stepType,
            args,
            result,
            error,
            Date.now() - t0,
          )
        }
      }
      Object.defineProperty(wrapped, 'name', { value: fnName })
      return wrapped as unknown as T
    }

    const wrapped = function (this: unknown, ...args: Array<unknown>) {
      const t0 = Date.now()
      let result: unknown
      let error: unknown
      try {
        result = fn.apply(this, args)
        return result
      } catch (err) {
        error = err
        throw err
      } finally {
        emitSync(client, fnName, stepType, args, result, error, Date.now() - t0)
      }
    }
    Object.defineProperty(wrapped, 'name', { value: fnName })
    return wrapped as unknown as T
  }
}

function emitSync(
  client: Keelwave,
  fnName: string,
  stepType: string,
  args: Array<unknown>,
  result: unknown,
  error: unknown,
  latencyMs: number,
): void {
  try {
    const run = getCurrentRun()
    const input = buildInput(args)
    const output = buildOutput(result, error)
    const ok = error === undefined

    if (run) {
      if (stepType === 'tool_call') {
        // toolCall performs loop-detection fingerprinting internally.
        run
          .toolCall(fnName, input, output, { ok, latencyMs })
          .catch((e) => raiseOrWarn(e, client.raiseOnError))
      } else {
        run
          .step(stepType, result !== undefined ? String(result) : undefined, {
            metadata: { fn: fnName, latency_ms: latencyMs },
          })
          .catch((e) => raiseOrWarn(e, client.raiseOnError))
      }
    } else {
      client
        .ingestAi({
          model: fnName,
          provider: 'observe',
          status: ok ? 'success' : 'error',
          latencyMs,
          errorMessage:
            error !== undefined ? String(error).slice(0, 500) : undefined,
          metadata: { input, output },
        })
        .catch((e) => raiseOrWarn(e, client.raiseOnError))
    }
  } catch (e) {
    raiseOrWarn(e, client.raiseOnError)
  }
}

async function emitAsync(
  client: Keelwave,
  fnName: string,
  stepType: string,
  args: Array<unknown>,
  result: unknown,
  error: unknown,
  latencyMs: number,
): Promise<void> {
  try {
    const run = getCurrentRun()
    const input = buildInput(args)
    const output = buildOutput(result, error)
    const ok = error === undefined

    if (run) {
      if (stepType === 'tool_call') {
        // toolCall performs loop-detection fingerprinting internally.
        await run.toolCall(fnName, input, output, { ok, latencyMs })
      } else {
        await run.step(
          stepType,
          result !== undefined ? String(result) : undefined,
          {
            metadata: { fn: fnName, latency_ms: latencyMs },
          },
        )
      }
    } else {
      await client.ingestAi({
        model: fnName,
        provider: 'observe',
        status: ok ? 'success' : 'error',
        latencyMs,
        errorMessage:
          error !== undefined ? String(error).slice(0, 500) : undefined,
        metadata: { input, output },
      })
    }
  } catch (e) {
    raiseOrWarn(e, client.raiseOnError)
  }
}

// ── @agent ────────────────────────────────────────────────────────────────────

export interface AgentOptions {
  name?: string
}

export function makeAgent(client: Keelwave, opts: AgentOptions = {}) {
  return function decorator<T extends AsyncFn>(fn: T): T {
    const agentName = opts.name ?? (fn.name || undefined) ?? 'agent'

    const wrapped = async function (this: unknown, ...args: Array<unknown>) {
      const input =
        args.length > 0 ? String(args[0]).slice(0, 10000) : undefined
      const { withRun } = await import('./run.js')

      return withRun(
        client.endpoint,
        client.apiKey,
        agentName,
        async (run) => {
          const result = await (fn as AsyncFn).apply(this, args)
          if (result !== undefined && result !== null)
            run.setOutput(String(result).slice(0, 100000))
          return result
        },
        { input },
        client.raiseOnError,
      )
    }

    Object.defineProperty(wrapped, 'name', { value: agentName })
    return wrapped as unknown as T
  }
}

// ── Span ──────────────────────────────────────────────────────────────────────

export class Span {
  private _content: string | undefined
  private _tokens: number | undefined
  private _metadata: Record<string, unknown> | undefined
  private _t0 = 0

  constructor(
    private readonly _client: Keelwave,
    private readonly _stepType: string,
    private readonly _name: string | undefined,
  ) {}

  set(
    content?: string,
    opts: { tokens?: number; metadata?: Record<string, unknown> } = {},
  ): this {
    if (content !== undefined) this._content = content
    if (opts.tokens !== undefined) this._tokens = opts.tokens
    if (opts.metadata !== undefined) this._metadata = opts.metadata
    return this
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this._emit()
  }

  start(): this {
    this._t0 = Date.now()
    return this
  }

  async end(): Promise<void> {
    await this._emit()
  }

  private async _emit(): Promise<void> {
    const latencyMs = this._t0 ? Date.now() - this._t0 : undefined
    const run = getCurrentRun()
    if (!run) return
    try {
      const meta: Record<string, unknown> = { ...this._metadata }
      if (latencyMs !== undefined) meta.latency_ms = latencyMs
      if (this._name) meta.span_name = this._name
      await run.step(this._stepType, this._content, {
        tokens: this._tokens,
        metadata: meta,
      })
    } catch (e) {
      raiseOrWarn(e, this._client.raiseOnError)
    }
  }
}
