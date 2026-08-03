import { raiseOrWarn, request } from './http.js'
import { getCurrentRun, withRun } from './run.js'
import { Span, makeAgent, makeObserve } from './decorators.js'
import type { AgentOptions, ObserveOptions } from './decorators.js'
import type { Run } from './run.js'

export interface KeelwaveOptions {
  apiKey: string
  endpoint?: string
  raiseOnError?: boolean
}

export interface IngestAiOptions {
  model: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  costUsd?: number
  latencyMs?: number
  status: 'success' | 'error' | 'timeout'
  errorMessage?: string
  requestId?: string
  agentRunId?: string
  metadata?: Record<string, unknown>
}

export class Keelwave {
  readonly apiKey: string
  readonly endpoint: string
  readonly raiseOnError: boolean

  constructor(opts: KeelwaveOptions) {
    this.apiKey = opts.apiKey
    this.endpoint = (opts.endpoint ?? 'http://localhost:8080').replace(
      /\/$/,
      '',
    )
    this.raiseOnError = opts.raiseOnError ?? false
  }

  async health(): Promise<{ status: string; env: string; version: string }> {
    const res = await request<{
      data: { status: string; env: string; version: string }
    }>(this.endpoint, this.apiKey, 'GET', '/v1/health')
    return res.data
  }

  async ingestAi(opts: IngestAiOptions): Promise<void> {
    try {
      await request(this.endpoint, this.apiKey, 'POST', '/v1/ingest/ai', {
        model: opts.model,
        provider: opts.provider ?? null,
        input_tokens: opts.inputTokens ?? null,
        output_tokens: opts.outputTokens ?? null,
        total_tokens: opts.totalTokens ?? null,
        cost_usd: opts.costUsd ?? null,
        latency_ms: opts.latencyMs ?? null,
        status: opts.status,
        error_message: opts.errorMessage ?? null,
        request_id: opts.requestId ?? null,
        agent_run_id: opts.agentRunId ?? null,
        metadata: opts.metadata ?? null,
      })
    } catch (e) {
      raiseOrWarn(e, this.raiseOnError)
    }
  }

  // ── agent run RAII ──────────────────────────────────────────────────────────

  run(
    agentName: string,
    fn: (run: Run) => Promise<unknown>,
    opts: { input?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<unknown> {
    return withRun(
      this.endpoint,
      this.apiKey,
      agentName,
      fn,
      opts,
      this.raiseOnError,
    )
  }

  // ── decorators ──────────────────────────────────────────────────────────────

  observe(opts?: ObserveOptions): ReturnType<typeof makeObserve>
  observe<T extends (...args: Array<any>) => unknown>(fn: T): T
  observe<T extends (...args: Array<any>) => unknown>(
    fnOrOpts?: T | ObserveOptions,
  ): T | ReturnType<typeof makeObserve> {
    if (typeof fnOrOpts === 'function') {
      return makeObserve(this)(fnOrOpts)
    }
    return makeObserve(this, fnOrOpts)
  }

  agent(opts?: AgentOptions): ReturnType<typeof makeAgent>
  agent<T extends (...args: Array<any>) => Promise<unknown>>(fn: T): T
  agent<T extends (...args: Array<any>) => Promise<unknown>>(
    fnOrOpts?: T | AgentOptions,
  ): T | ReturnType<typeof makeAgent> {
    if (typeof fnOrOpts === 'function') {
      return makeAgent(this)(fnOrOpts as T)
    }
    return makeAgent(this, fnOrOpts)
  }

  span(stepType = 'span', name?: string): Span {
    return new Span(this, stepType, name)
  }

  getCurrentRun(): Run | undefined {
    return getCurrentRun()
  }
}
