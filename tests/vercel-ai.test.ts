import { describe, expect, it, vi } from 'vitest'
import { Keelwave } from '../src/index.js'
import { wrapModel } from '../src/adapters/vercel-ai.js'
import type { LanguageModelV1 } from 'ai'

const ENDPOINT = process.env.KEELWAVE_ENDPOINT ?? 'http://localhost:8080'
const API_KEY = process.env.KEELWAVE_API_KEY ?? 'kw_test'

// ingestAi is spied on, so these adapter tests never touch a real server.

function makeStubModel(
  overrides: Partial<LanguageModelV1> = {},
): LanguageModelV1 {
  return {
    specificationVersion: 'v1',
    provider: 'stub-provider',
    modelId: 'stub-model',
    defaultObjectGenerationMode: 'json',
    doGenerate: async () => ({
      text: 'hello world',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 20 },
      rawCall: { rawPrompt: null, rawSettings: {} },
      toolCalls: [],
      warnings: [],
    }),
    doStream: async () => {
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-delta', textDelta: 'hi' })
          controller.enqueue({
            type: 'finish',
            finishReason: 'stop',
            usage: { promptTokens: 5, completionTokens: 10 },
          })
          controller.close()
        },
      })
      return { stream, rawCall: { rawPrompt: null, rawSettings: {} } }
    },
    ...overrides,
  }
}

describe('wrapModel — generateText tracing', () => {
  it('passes the call through and returns text', async () => {
    const client = new Keelwave({ apiKey: API_KEY, endpoint: ENDPOINT })
    const model = wrapModel(client, makeStubModel())

    const result = await model.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })

    expect(result.text).toBe('hello world')
    expect(result.usage.promptTokens).toBe(10)
  })

  it('emits ai_trace with correct token counts', async () => {
    const client = new Keelwave({
      apiKey: API_KEY,
      endpoint: ENDPOINT,
      raiseOnError: true,
    })
    const ingestSpy = vi.spyOn(client, 'ingestAi')

    const model = wrapModel(client, makeStubModel(), {
      model: 'gpt-4o',
      provider: 'openai',
    })

    await model.doGenerate({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [],
    })

    await new Promise((r) => setTimeout(r, 50)) // let the async ingestAi fire

    expect(ingestSpy).toHaveBeenCalledOnce()
    const call = ingestSpy.mock.calls[0][0]
    expect(call.model).toBe('gpt-4o')
    expect(call.provider).toBe('openai')
    expect(call.status).toBe('success')
    expect(call.inputTokens).toBe(10)
    expect(call.outputTokens).toBe(20)
    expect(typeof call.latencyMs).toBe('number')
  })

  it('records error status on model failure', async () => {
    const client = new Keelwave({ apiKey: API_KEY, endpoint: ENDPOINT })
    const ingestSpy = vi.spyOn(client, 'ingestAi')

    const failing = makeStubModel({
      doGenerate: async () => {
        throw new Error('model exploded')
      },
    })
    const model = wrapModel(client, failing)

    await expect(
      model.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      }),
    ).rejects.toThrow('model exploded')

    await new Promise((r) => setTimeout(r, 50))

    const call = ingestSpy.mock.calls[0][0]
    expect(call.status).toBe('error')
    expect(call.errorMessage).toContain('model exploded')
  })

  it('links trace to active run via agent_run_id', async () => {
    const client = new Keelwave({ apiKey: API_KEY, endpoint: ENDPOINT })
    const ingestSpy = vi.spyOn(client, 'ingestAi')
    const model = wrapModel(client, makeStubModel())

    await client.run('ai-sdk-agent', async (run) => {
      await model.doGenerate({
        inputFormat: 'messages',
        mode: { type: 'regular' },
        prompt: [],
      })
      await new Promise((r) => setTimeout(r, 50))

      const call = ingestSpy.mock.calls[0][0]
      expect(call.agentRunId).toBe(run.id)
    })
  })
})

describe('wrapModel — stream tracing', () => {
  it('passes stream through and emits trace on finish', async () => {
    const client = new Keelwave({ apiKey: API_KEY, endpoint: ENDPOINT })
    const ingestSpy = vi.spyOn(client, 'ingestAi')
    const model = wrapModel(client, makeStubModel())

    const { stream } = await model.doStream({
      inputFormat: 'messages',
      mode: { type: 'regular' },
      prompt: [],
    })

    const chunks: Array<unknown> = []
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }

    await new Promise((r) => setTimeout(r, 50))

    expect(chunks.some((c) => (c as { type: string }).type === 'finish')).toBe(
      true,
    )
    const call = ingestSpy.mock.calls[0][0]
    expect(call.status).toBe('success')
    expect(call.inputTokens).toBe(5)
    expect(call.outputTokens).toBe(10)
  })
})
