# keelwave — TypeScript SDK

Zero-friction tracing for AI agents in TypeScript / Node.

The keelwave TypeScript SDK instruments your agent code and streams agent
runs, decision steps, tool calls, loop-detection fingerprints, token/cost
data, and model traces to a [keelwave](https://github.com/keelwave/keelwave)
server. An API key is the only required configuration — point it at your
server and wrap your agent.

> **Status: early / pre-1.0 (MVP).** The client, run tracing, decorators,
> loop detection, and a Vercel AI SDK adapter all work and are covered by
> integration tests, but the API surface is small and may change before a
> stable release. Node only (uses `node:crypto` and `AsyncLocalStorage`);
> not built for the browser.

---

## Install

The SDK targets Node 18+ and ships as ESM.

```bash
npm install keelwave
# or
pnpm add keelwave
# or
yarn add keelwave
```

The `ai` package (Vercel AI SDK) is a runtime dependency, used by the
optional model adapter.

You also need a running keelwave server to receive the data — see
[github.com/keelwave/keelwave](https://github.com/keelwave/keelwave). The
SDK defaults to `http://localhost:8080`.

---

## Quickstart

Construct a client with your API key, then trace an agent run. Inside a run,
tool calls are fingerprinted automatically so repeated identical calls are
flagged as a loop.

```ts
import { Keelwave } from 'keelwave'

const client = new Keelwave({
  apiKey: process.env.KEELWAVE_API_KEY ?? 'kw_...',
  endpoint: 'http://localhost:8080', // defaults to this if omitted
})

// A traced tool. Calls inside an active run are recorded and fingerprinted.
const webSearch = client.observe({ name: 'web_search', stepType: 'tool_call' })(
  async (q: string): Promise<{ results: Array<string> }> => {
    return { results: [`result for: ${q}`] }
  },
)

// Wrap an agent function. Opens a run, records the return value as output,
// and closes the run when the function settles.
const runAgent = client.agent({ name: 'demo-agent' })(async (
  task: string,
): Promise<string> => {
  const { results } = await webSearch(task)
  return `Found: ${results[0]}`
})

const answer = await runAgent('TypeScript observability')
console.log(answer)
```

### Manual runs

If you'd rather not use decorators, open a run directly:

```ts
await client.run(
  'demo-agent',
  async (run) => {
    await run.step('plan', 'break the task into steps')
    await run.toolCall('web_search', { q: 'keelwave' }, { results: ['...'] })
    run.setOutput('done')
  },
  { input: 'TypeScript observability' },
)
```

`getCurrentRun()` returns the active `Run` anywhere inside a run (it's
tracked via `AsyncLocalStorage`), so nested helpers can add steps without
threading the run through your call stack.

---

## What's captured

Per agent run and its steps, the SDK sends:

- **Agent runs** — agent name, input, metadata, start/finish, status
  (`completed` / `failed`), termination reason, duration, and output.
- **Decision steps** — an ordered step index, step type, content, and
  per-step token / cost / metadata.
- **Tool calls** — tool name, input, output, success flag, and latency.
- **Loop detection** — each tool call is hashed (tool name + sorted input)
  into a SHA-256 fingerprint; a repeated fingerprint marks the run as
  looping and records where the loop began.
- **Token & cost** — per-step tokens/cost accumulate into run totals.
- **Model traces (`ingestAi`)** — model, provider, input/output/total
  tokens, cost, latency, status, error message, and an optional
  `agentRunId` linking the trace to a run.

---

## Provider adapters

### Vercel AI SDK

`wrapModel` wraps any Vercel AI SDK `LanguageModelV1` so every
`generateText` / `streamText` call emits a model trace (tokens + latency),
linked to the active run when there is one. It lives at the `keelwave/vercel-ai`
subpath, so `ai` stays an optional peer dependency — only install it if you use
this adapter (you already have it if you use the Vercel AI SDK).

```ts
import { openai } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { Keelwave } from 'keelwave'
import { wrapModel } from 'keelwave/vercel-ai'

const client = new Keelwave({
  apiKey: process.env.KEELWAVE_API_KEY ?? 'kw_...',
})

const model = wrapModel(client, openai('gpt-4o'))

const { text } = await generateText({ model, prompt: 'hello' })
// → keelwave receives a model trace with tokens + latency
```

Both non-streaming (`wrapGenerate`) and streaming (`wrapStream`) calls are
instrumented; usage is read from the model's finish data.

---

## Configuration

`new Keelwave({ ... })` options:

| Option         | Type      | Default                 | Notes                                            |
| -------------- | --------- | ----------------------- | ------------------------------------------------ |
| `apiKey`       | `string`  | — (required)            | keelwave API key (`kw_...`).                     |
| `endpoint`     | `string`  | `http://localhost:8080` | keelwave server base URL. Trailing `/` trimmed.  |
| `raiseOnError` | `boolean` | `false`                 | If `false`, emit failures warn instead of throw. |

Transport failures surface as typed errors: `KeelwaveError`, `KeelwaveAuthError`,
`KeelwaveValidationError`, `KeelwaveRateLimited`, `KeelwaveBufferFull`,
`KeelwaveServerError`, `KeelwaveTransportError`.

---

## Related

- **keelwave server (core):** [github.com/keelwave/keelwave](https://github.com/keelwave/keelwave)
  — the Go API + dashboard that ingests and displays this data. SDK features
  depend on the server supporting the wire protocol first.

---

## License

MIT. See [LICENSE](LICENSE).
