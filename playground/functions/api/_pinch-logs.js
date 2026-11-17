// Pinch recordings from the playground's `?debug=1` indicator, shared by the deployed API
// (`pinch-logs.js`, Vercel Blob) and the dev server (`vite.config.ts`, `.bench/pinch-logs/`).
// Underscored so Vercel doesn't route it.
//   POST /api/pinch-logs          ← a session so far (it's posted again as it grows; same id overwrites)
//   GET  /api/pinch-logs          → { sessions: [{ id, at, device, pinches, events }] } newest first
//   GET  /api/pinch-logs?id=…     → one session in full
//
// A session: { id, at, build, tester, device: { userAgent, viewport, dpr }, events: [...] }, each
// event [ms since the session began, phase, level on screen, columns, scale, fingers down,
// scrollTop, the fingers' zoom since the pinch began], plus on `end` events
// { min, max, moves, gestures, cancels, fps, loops } as the last element. Older sessions lack the
// later fields; `tester` is "person", "automation" or what `?tester=` named.
const isObject = (value) => typeof value === 'object' && value !== null

export const PINCH_LOG_MAX_BYTES = 2 * 1024 * 1024
export const PINCH_LOGS_PAGE_SIZE = 30

const PHASES = new Set(['start', 'move', 'commit', 'end'])
const EARLIEST = Date.UTC(2026, 0, 1)

export function parsePinchLog(text) {
  if (text.length > PINCH_LOG_MAX_BYTES) return { status: 413, error: 'Too large' }
  let log
  try {
    log = JSON.parse(text)
  } catch {
    return { status: 400, error: 'Invalid JSON' }
  }
  const at = typeof log?.at === 'string' ? Date.parse(log.at) : NaN
  const ok =
    typeof log?.id === 'string' &&
    /^[\w-]{1,40}$/.test(log.id) &&
    at >= EARLIEST &&
    at <= Date.now() + 60_000 &&
    typeof log.device === 'object' &&
    Array.isArray(log.events) &&
    log.events.every((event) => Array.isArray(event) && typeof event[0] === 'number' && PHASES.has(event[1]))
  return ok ? { log } : { status: 400, error: 'Not a pinch log' }
}

/** A listing entry: the session without its events. */
export function summarize(log) {
  const events = log.events ?? []
  return {
    id: log.id,
    at: log.at,
    build: log.build,
    tester: log.tester,
    device: log.device,
    pinches: events.filter((event) => event[1] === 'start').length,
    commits: events.filter((event) => event[1] === 'commit').length,
    loops: events.reduce((sum, event) => sum + (event[1] === 'end' ? (event.find(isObject)?.loops ?? 0) : 0), 0),
    events: events.length,
  }
}

// Pathnames sort newest first: the session's start time is inverted.
export const pinchLogKey = (log) => `pinch-logs/${String(1e13 - Date.parse(log.at)).padStart(13, '0')}-${log.id}.json`
