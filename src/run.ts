import { createHash, randomUUID } from 'node:crypto'
import { raiseOrWarn, request } from './http.js'
import { getCurrentRun, runWithRun } from './context.js'

export interface StepOptions {
  tokens?: number
  costUsd?: number
  metadata?: Record<string, unknown>
}

export interface ToolCallOptions {
  ok?: boolean
  tokens?: number
  costUsd?: number
  latencyMs?: number
  metadata?: Record<string, unknown>
}

export class Run {
  readonly id: string
  readonly timestamp: string

  private _stepIndex = 0
  private _totalTokens = 0
  private _totalCostUsd = 0
  private _output: string | undefined
  private _loopDetected = false
  private _loopStepIndex: number | undefined
  private _seenFingerprints = new Map<string, number>()
  private _tStart: number

  constructor(
    private readonly _endpoint: string,
    private readonly _apiKey: string,
    id: string,
    timestamp: string,
    private readonly _raiseOnError = false,
  ) {
    this.id = id
    this.timestamp = timestamp
    this._tStart = Date.now()
  }

  async step(
    stepType: string,
    content?: string,
    opts: StepOptions = {},
  ): Promise<void> {
    this._stepIndex++
    if (opts.tokens) this._totalTokens += opts.tokens
    if (opts.costUsd) this._totalCostUsd += opts.costUsd

    try {
      await request(
        this._endpoint,
        this._apiKey,
        'POST',
        '/v1/ingest/agent/steps',
        {
          agent_run_id: this.id,
          step_index: this._stepIndex,
          step_type: stepType,
          content: content ?? null,
          tokens: opts.tokens ?? null,
          cost_usd: opts.costUsd ?? null,
          metadata: opts.metadata ?? null,
        },
      )
    } catch (e) {
      raiseOrWarn(e, this._raiseOnError)
    }
  }

  async toolCall(
    toolName: string,
    input: Record<string, unknown>,
    output: unknown,
    opts: ToolCallOptions = {},
  ): Promise<void> {
    this._stepIndex++
    if (opts.tokens) this._totalTokens += opts.tokens
    if (opts.costUsd) this._totalCostUsd += opts.costUsd

    const toolOutput =
      output !== null && typeof output === 'object' && !Array.isArray(output)
        ? (output as Record<string, unknown>)
        : { value: String(output) }

    try {
      await request(
        this._endpoint,
        this._apiKey,
        'POST',
        '/v1/ingest/agent/steps',
        {
          agent_run_id: this.id,
          step_index: this._stepIndex,
          step_type: 'tool_call',
          tool_name: toolName,
          tool_input: input,
          tool_output: toolOutput,
          tool_success: opts.ok ?? true,
          tool_latency_ms: opts.latencyMs ?? null,
          tokens: opts.tokens ?? null,
          cost_usd: opts.costUsd ?? null,
          metadata: opts.metadata ?? null,
        },
      )
    } catch (e) {
      raiseOrWarn(e, this._raiseOnError)
    }

    // Loop detection is local and must run regardless of ingest success.
    this.checkFingerprint(toolName, input)
  }

  checkFingerprint(toolName: string, input: Record<string, unknown>): void {
    const raw = toolName + JSON.stringify(input, Object.keys(input).sort())
    const fp = createHash('sha256').update(raw).digest('hex')

    const prev = this._seenFingerprints.get(fp)
    if (prev !== undefined) {
      if (!this._loopDetected) this.markLoop(prev)
    } else {
      this._seenFingerprints.set(fp, this._stepIndex)
    }
  }

  get loopDetected(): boolean {
    return this._loopDetected
  }

  setOutput(output: string): void {
    this._output = output
  }

  markLoop(stepIndex?: number): void {
    this._loopDetected = true
    if (stepIndex !== undefined) this._loopStepIndex = stepIndex
  }

  async finish(
    status: 'completed' | 'failed' = 'completed',
    reason = 'clean',
  ): Promise<void> {
    const durationMs = Date.now() - this._tStart
    try {
      await request(
        this._endpoint,
        this._apiKey,
        'POST',
        `/v1/ingest/agent/runs/${this.id}/finish`,
        {
          timestamp: this.timestamp,
          status,
          termination_reason: reason,
          total_steps: this._stepIndex,
          total_tokens: this._totalTokens,
          total_cost_usd: this._totalCostUsd || null,
          duration_ms: durationMs,
          loop_detected: this._loopDetected,
          loop_step_index: this._loopStepIndex ?? null,
          output: this._output ?? null,
        },
      )
    } catch (e) {
      raiseOrWarn(e, this._raiseOnError)
    }
  }
}

// ── RunContext: RAII wrapper ──────────────────────────────────────────────────

export class RunContext {
  private _run: Run | undefined

  constructor(
    private readonly _endpoint: string,
    private readonly _apiKey: string,
    private readonly _agentName: string,
    private readonly _input?: string,
    private readonly _metadata?: Record<string, unknown>,
    private readonly _raiseOnError = false,
  ) {}

  async enter(): Promise<Run> {
    try {
      const data = (
        await request<{ data: { id: string; timestamp: string } }>(
          this._endpoint,
          this._apiKey,
          'POST',
          '/v1/ingest/agent/runs',
          {
            agent_name: this._agentName,
            input: this._input ?? null,
            metadata: this._metadata ?? null,
          },
        )
      ).data
      this._run = new Run(
        this._endpoint,
        this._apiKey,
        data.id,
        data.timestamp,
        this._raiseOnError,
      )
    } catch (e) {
      // Fail-soft: if the run can't be created, warn (or raise when opted in)
      // and fall back to a local run so the user's function still executes.
      raiseOrWarn(e, this._raiseOnError)
      this._run = new Run(
        this._endpoint,
        this._apiKey,
        randomUUID(),
        new Date().toISOString(),
        this._raiseOnError,
      )
    }
    return this._run
  }

  async exit(error?: unknown): Promise<void> {
    if (!this._run) return
    const status = error ? 'failed' : 'completed'
    const reason = error ? 'error' : 'clean'
    await this._run.finish(status, reason)
  }
}

// ── AsyncLocalStorage-aware run() helper ─────────────────────────────────────

export async function withRun<T>(
  endpoint: string,
  apiKey: string,
  agentName: string,
  fn: (run: Run) => Promise<T>,
  opts: { input?: string; metadata?: Record<string, unknown> } = {},
  raiseOnError = false,
): Promise<T> {
  const ctx = new RunContext(
    endpoint,
    apiKey,
    agentName,
    opts.input,
    opts.metadata,
    raiseOnError,
  )
  const run = await ctx.enter()

  let result!: T
  let error: unknown

  try {
    result = await new Promise<T>((resolve, reject) => {
      runWithRun(run, () => {
        fn(run).then(resolve).catch(reject)
      })
    })
  } catch (err) {
    error = err
    throw err
  } finally {
    await ctx
      .exit(error)
      .catch((e) =>
        console.warn(
          `[keelwave] run finish failed: ${e instanceof Error ? e.message : e}`,
        ),
      )
  }

  return result
}

export { getCurrentRun }
