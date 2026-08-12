/**
 * Vercel AI SDK adapter for keelwave.
 *
 * Usage — wrap any LanguageModelV1 so every generate/stream call is traced::
 *
 *   import { openai } from "@ai-sdk/openai";
 *   import { Keelwave } from "keelwave";
 *   import { wrapModel } from "keelwave/vercel-ai";
 *
 *   const model = wrapModel(new Keelwave({ apiKey: "kw_..." }), openai("gpt-4o"));
 *
 *   const { text } = await generateText({ model, prompt: "hello" });
 *   // → keelwave receives an ai_trace row with tokens + latency
 */

import { wrapLanguageModel } from 'ai'
import { getCurrentRun } from '../run.js'
import type { Keelwave } from '../client.js'

// Derived from the installed SDK rather than imported by name: v4 calls the
// model type LanguageModelV1, v5 calls it LanguageModelV2, and neither name
// resolves against the other major.
type WrapArgs = Parameters<typeof wrapLanguageModel>[0]
type WrappedModel = WrapArgs['model']
type Middleware = Exclude<WrapArgs['middleware'], ReadonlyArray<unknown>>

// v4 reports promptTokens/completionTokens, v5 inputTokens/outputTokens.
type AnyUsage = {
  inputTokens?: number
  outputTokens?: number
  promptTokens?: number
  completionTokens?: number
}

function readUsage(usage: unknown): {
  inputTokens?: number
  outputTokens?: number
} {
  const u = usage as AnyUsage | undefined
  return {
    inputTokens: u?.inputTokens ?? u?.promptTokens,
    outputTokens: u?.outputTokens ?? u?.completionTokens,
  }
}

export interface WrapModelOptions {
  /** Override the model label stored in ai_traces (default: model.modelId). */
  model?: string
  /** Override the provider label (default: model.provider). */
  provider?: string
}

/**
 * Wrap a Vercel AI SDK LanguageModelV1 so every call emits a keelwave ai_trace.
 *
 * If there's an active keelwave Run (opened via @agent or client.run()),
 * the trace is linked to it via agent_run_id.
 */
export function wrapModel(
  keelwave: Keelwave,
  model: WrappedModel,
  opts: WrapModelOptions = {},
): WrappedModel {
  const modelLabel = opts.model ?? model.modelId
  const providerLabel = opts.provider ?? model.provider

  const middleware: Middleware = {
    wrapGenerate: async ({ doGenerate }) => {
      const t0 = Date.now()
      let result: Awaited<ReturnType<WrappedModel['doGenerate']>> | undefined
      let status: 'success' | 'error' = 'success'
      let errorMessage: string | undefined

      try {
        result = await doGenerate()
        return result
      } catch (err) {
        status = 'error'
        errorMessage = err instanceof Error ? err.message : String(err)
        throw err
      } finally {
        const latencyMs = Date.now() - t0
        const run = getCurrentRun()
        const usage = readUsage(result?.usage)

        keelwave
          .ingestAi({
            model: modelLabel,
            provider: providerLabel,
            status,
            latencyMs,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            errorMessage,
            agentRunId: run?.id,
          })
          .catch(() => {})
      }
    },

    wrapStream: async ({ doStream }) => {
      const t0 = Date.now()
      const streamResult = await doStream()
      const run = getCurrentRun()

      let promptTokens = 0
      let completionTokens = 0
      let status: 'success' | 'error' = 'success'
      let finishEmitted = false

      const originalStream = streamResult.stream
      const transformedStream = new TransformStream<
        Awaited<
          ReturnType<WrappedModel['doStream']>
        >['stream'] extends ReadableStream<infer T>
          ? T
          : never,
        Awaited<
          ReturnType<WrappedModel['doStream']>
        >['stream'] extends ReadableStream<infer T>
          ? T
          : never
      >({
        transform(chunk, controller) {
          controller.enqueue(chunk)

          // pick up usage from finish chunk
          const c = chunk as Record<string, unknown>
          if (c.type === 'finish') {
            const u = readUsage(c.usage)
            promptTokens = u.inputTokens ?? 0
            completionTokens = u.outputTokens ?? 0
            finishEmitted = true
          } else if (c.type === 'error') {
            status = 'error'
          }
        },
        flush() {
          if (!finishEmitted) return
          const latencyMs = Date.now() - t0
          keelwave
            .ingestAi({
              model: modelLabel,
              provider: providerLabel,
              status,
              latencyMs,
              inputTokens: promptTokens || undefined,
              outputTokens: completionTokens || undefined,
              agentRunId: run?.id,
            })
            .catch(() => {})
        },
      })

      return {
        ...streamResult,
        stream: originalStream.pipeThrough(transformedStream),
      }
    },
  }

  return wrapLanguageModel({ model, middleware })
}
