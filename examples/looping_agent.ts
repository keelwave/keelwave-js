/**
 * Deliberately broken agent — runs the same search 5 times.
 * @observe detects the fingerprint duplicate on turn 1, marks the run looping.
 *
 * Run:
 *   KEELWAVE_API_KEY=kw_... KEELWAVE_ENDPOINT=http://localhost:8080 \
 *   node --import tsx examples/looping_agent.ts
 */
import { Keelwave, getCurrentRun } from '../src/index.js'

const TARGET_QUERY = 'keelwave observability platform'
const LOOP_TURNS = 5
const ENDPOINT = process.env.KEELWAVE_ENDPOINT ?? 'http://localhost:8080'

const client = new Keelwave({
  apiKey: process.env.KEELWAVE_API_KEY ?? '',
  endpoint: ENDPOINT,
})

const webSearch = client.observe({ name: 'web_search', stepType: 'tool_call' })(
  async (q: string): Promise<{ results: Array<string> }> => {
    return { results: [`stub result for: ${q}`] }
  },
)

const runLoop = client.agent({ name: 'looping-agent' })(async (
  question: string,
): Promise<string> => {
  const run = getCurrentRun()!
  for (let i = 0; i < LOOP_TURNS; i++) {
    await webSearch(question)
  }
  return run.id
})

const runId = await runLoop(TARGET_QUERY)

// wait for batch flush
await new Promise((r) => setTimeout(r, 1000))

const resp = await fetch(`${ENDPOINT}/v1/agent/runs/${runId}/loops`, {
  headers: { Authorization: `Bearer ${process.env.KEELWAVE_API_KEY}` },
})
const body = (await resp.json()) as {
  data?: Array<{ hits: number; tool_name: string; step_indices: Array<number> }>
}
const hits = body.data ?? []

console.log(`\nrun_id: ${runId}`)
console.log(`loops endpoint returned ${hits.length} fingerprint group(s):`)
for (const h of hits) {
  console.log(`  hits=${h.hits}  tool=${h.tool_name}  steps=${h.step_indices}`)
}

if (!hits.some((h) => h.hits >= 2)) {
  process.exit(1)
}
