// The benchmark history contract, shared by the deployed API (`runs.js`, Vercel Blob) and the dev
// server's store (`vite.config.ts`, `.bench/runs.jsonl`). Underscored so Vercel doesn't route it.
//   GET  /api/runs?cursor=…  → { runs, cursor }   newest first, RUNS_PAGE_SIZE per page
//   POST /api/runs           ← one benchmark result (`BenchResult` in playground/bench/run.ts)

export const RUNS_PAGE_SIZE = 20
export const RUN_MAX_BYTES = 64 * 1024

const isObject = (value) => typeof value === 'object' && value !== null
const isNumber = (value) => typeof value === 'number' && Number.isFinite(value)
// Runs from 2026 onwards, and not from the future; also keeps Blob keys a fixed width.
const EARLIEST = Date.UTC(2026, 0, 1)

/** A body is stored only if it has everything the benchmark panel reads. */
export function isRunRecord(run) {
  if (!isObject(run) || typeof run.id !== 'string' || !/^\w{1,40}$/.test(run.id)) return false
  const at = typeof run.at === 'string' ? Date.parse(run.at) : NaN
  if (!(at >= EARLIEST && at <= Date.now() + 60_000)) return false
  return (
    isObject(run.config) &&
    ['engine', 'net', 'browser'].every((key) => typeof run.config[key] === 'string') &&
    isObject(run.score) &&
    isNumber(run.score.total) &&
    Array.isArray(run.score.parts) &&
    isObject(run.zoom) &&
    isObject(run.scroll) &&
    isObject(run.frames) &&
    isObject(run.loader)
  )
}

/** Parse a POST body into a run, or the error response status and message. */
export function parseRun(text) {
  if (text.length > RUN_MAX_BYTES) return { status: 413, error: 'Too large' }
  let run
  try {
    run = JSON.parse(text)
  } catch {
    return { status: 400, error: 'Invalid JSON' }
  }
  return isRunRecord(run) ? { run } : { status: 400, error: 'Not a benchmark result' }
}
