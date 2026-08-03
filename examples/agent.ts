/**
 * Decorator-based agent example.
 *
 * Run:
 *   KEELWAVE_API_KEY=kw_... KEELWAVE_ENDPOINT=http://localhost:8080 \
 *   node --import tsx examples/agent.ts
 */
import { Keelwave } from '../src/index.js'

const client = new Keelwave({
  apiKey: process.env.KEELWAVE_API_KEY ?? '',
  endpoint: process.env.KEELWAVE_ENDPOINT ?? 'http://localhost:8080',
})

const webSearch = client.observe({ name: 'web_search', stepType: 'tool_call' })(
  async (q: string): Promise<{ results: Array<string> }> => {
    // stub — replace with real search
    return { results: [`result for: ${q}`] }
  },
)

const runAgent = client.agent({ name: 'demo-agent' })(async (
  task: string,
): Promise<string> => {
  const { results } = await webSearch(task)
  return `Found: ${results[0]}`
})

const answer = await runAgent('TypeScript observability')
console.log(answer)
