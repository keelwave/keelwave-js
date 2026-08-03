export { Keelwave } from './client.js'
export type { KeelwaveOptions, IngestAiOptions } from './client.js'
export { Run, getCurrentRun } from './run.js'
export type { StepOptions, ToolCallOptions } from './run.js'
export { Span } from './decorators.js'
export type { ObserveOptions, AgentOptions } from './decorators.js'
// The Vercel AI SDK adapter lives at the `keelwave/vercel-ai` subpath so that
// `ai` stays an optional peer dependency — core tracing never imports it.
export {
  KeelwaveError,
  KeelwaveAuthError,
  KeelwaveValidationError,
  KeelwaveRateLimited,
  KeelwaveBufferFull,
  KeelwaveServerError,
  KeelwaveTransportError,
} from './errors.js'
