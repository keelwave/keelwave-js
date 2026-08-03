import { AsyncLocalStorage } from 'node:async_hooks'
import type { Run } from './run.js'

// Node.js AsyncLocalStorage for ambient run tracking (Node ≥ 18).
// Falls back to a plain variable in environments without AsyncLocalStorage.
let storage: AsyncLocalStorage<Run> | null = null

try {
  storage = new AsyncLocalStorage<Run>()
} catch {}

let _fallback: Run | undefined

export function getCurrentRun(): Run | undefined {
  if (storage) return storage.getStore()
  return _fallback
}

export function runWithRun<T>(run: Run, fn: () => T): T {
  if (storage) return storage.run(run, fn)
  const prev = _fallback
  _fallback = run
  try {
    return fn()
  } finally {
    _fallback = prev
  }
}
