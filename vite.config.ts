import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { parsePinchLog, PINCH_LOGS_PAGE_SIZE, summarize } from './playground/functions/api/_pinch-logs.js'
import { parseRun, RUNS_PAGE_SIZE } from './playground/functions/api/_runs.js'
import networks from './playground/networks.json'

/**
 * Serves benchmark fixtures at /fixtures/<network>/<file> through a simulated network, so the
 * benchmark can compare fast, 4G and 3G connections. Each response waits one round trip, then
 * transfers over one link per profile whose bandwidth is shared equally by the transfers in
 * progress at each moment. Responses aren't cached, so every run starts cold.
 */
const FIXTURES = join(process.cwd(), 'public/fixtures')

type Transfer = { remainingBits: number; readyAt: number; send: () => void; closed: boolean }

/** One shared link per profile: each transfer waits a round trip, then all active transfers split the bandwidth equally. */
function createLink(profile: { rttMs: number; bitsPerSecond: number }) {
  const transfers = new Set<Transfer>()
  let timer: ReturnType<typeof setInterval> | null = null
  let last = Date.now()
  const TICK_MS = 5
  const tick = () => {
    const now = Date.now()
    const elapsed = now - last
    last = now
    const flowing = [...transfers].filter((t) => !t.closed && t.readyAt <= now)
    if (flowing.length) {
      const share = (profile.bitsPerSecond * elapsed) / 1000 / flowing.length
      for (const transfer of flowing) {
        transfer.remainingBits -= share
        if (transfer.remainingBits <= 0) {
          transfers.delete(transfer)
          transfer.send()
        }
      }
    }
    for (const transfer of transfers) if (transfer.closed) transfers.delete(transfer)
    if (!transfers.size && timer) {
      clearInterval(timer)
      timer = null
    }
  }
  return (bytes: number, send: () => void) => {
    const transfer: Transfer = { remainingBits: bytes * 8, readyAt: Date.now() + profile.rttMs, send, closed: false }
    transfers.add(transfer)
    if (!timer) {
      last = Date.now()
      timer = setInterval(tick, TICK_MS)
    }
    return () => {
      transfer.closed = true
    }
  }
}

function benchmarkNetwork(): Plugin {
  const links: Record<string, ReturnType<typeof createLink>> = Object.fromEntries(Object.entries(networks).map(([name, profile]) => [name, createLink(profile)]))
  // Files are served from memory so disk speed (the repo may sit on a network volume) never
  // adds noise; only the simulated network shapes timing.
  const files = new Map<string, Buffer>()
  const read = (file: string) => {
    if (!files.has(file)) {
      try {
        files.set(file, readFileSync(join(FIXTURES, file)))
      } catch {
        // Not downloaded yet: try again next time, so `npm run fixtures` works without a restart.
        return undefined
      }
    }
    return files.get(file)
  }
  return {
    name: 'gally-benchmark-network',
    configureServer(server) {
      try {
        for (const file of readdirSync(FIXTURES)) read(file)
      } catch {
        // No fixtures yet: `npm run fixtures`.
      }
      server.middlewares.use('/fixtures', (req, res, next) => {
        const match = /^\/([\w-]+)\/([\w.-]+\.(?:webp|json))/.exec(req.url ?? '')
        const link = match && links[match[1]!]
        if (!link) return next()
        const file = match[2]!
        const body = read(file)
        if (!body) {
          res.statusCode = 404
          res.end('Run `npm run fixtures` first.')
          return
        }
        const cancel = link(body.length, () => {
          res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'image/webp')
          res.setHeader('Content-Length', body.length)
          res.setHeader('Cache-Control', 'no-store')
          res.setHeader('Timing-Allow-Origin', '*')
          res.end(body)
        })
        // A request the browser cancels stops using bandwidth, as on a real connection.
        res.on('close', cancel)
      })
    },
  }
}

/**
 * Benchmark history for the dev server: the same /api/runs as the deployed site, stored in
 * `.bench/runs.jsonl` (one run per line, gitignored) instead of Vercel Blob. The preview server too.
 */
function benchmarkHistory(): Plugin {
  const dir = join(process.cwd(), '.bench')
  const file = join(dir, 'runs.jsonl')
  const handle = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const { run, status, error } = parseRun(body)
        if (!run) {
          res.statusCode = status
          res.end(JSON.stringify({ error }))
          return
        }
        mkdirSync(dir, { recursive: true })
        appendFileSync(file, `${JSON.stringify(run)}\n`)
        res.statusCode = 201
        res.end('{"ok":true}')
      })
      return
    }
    const all = existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .flatMap((line) => {
            try {
              return line ? [JSON.parse(line)] : []
            } catch {
              return []
            }
          })
          .reverse()
      : []
    const start = Number(new URL(req.url ?? '', 'http://x').searchParams.get('cursor') ?? 0)
    const end = start + RUNS_PAGE_SIZE
    res.end(JSON.stringify({ runs: all.slice(start, end), cursor: end < all.length ? String(end) : null }))
  }
  // Pinch recordings (`?debug=1`): one file per session in `.bench/pinch-logs/`.
  const logs = join(dir, 'pinch-logs')
  const handleLogs = (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader('Content-Type', 'application/json')
    if (req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const { log, status, error } = parsePinchLog(body)
        if (!log) {
          res.statusCode = status
          res.end(JSON.stringify({ error }))
          return
        }
        mkdirSync(logs, { recursive: true })
        writeFileSync(join(logs, `${log.id}.json`), JSON.stringify(log))
        res.statusCode = 201
        res.end('{"ok":true}')
      })
      return
    }
    const id = new URL(req.url ?? '', 'http://x').searchParams.get('id')
    const all = existsSync(logs)
      ? readdirSync(logs)
          .filter((name) => name.endsWith('.json'))
          .map((name) => JSON.parse(readFileSync(join(logs, name), 'utf8')))
          .sort((a, b) => b.at.localeCompare(a.at))
      : []
    if (id) {
      const log = all.find((entry) => entry.id === id)
      res.statusCode = log ? 200 : 404
      res.end(JSON.stringify(log ?? { error: 'Not found' }))
      return
    }
    res.end(JSON.stringify({ sessions: all.slice(0, PINCH_LOGS_PAGE_SIZE).map(summarize) }))
  }
  return {
    name: 'gally-benchmark-history',
    configureServer: (server) => {
      server.middlewares.use('/api/runs', handle)
      server.middlewares.use('/api/pinch-logs', handleLogs)
    },
    // `vite preview` too, so production builds can be benchmarked locally (`npm run bench:fps`).
    configurePreviewServer: (server) => {
      server.middlewares.use('/api/runs', handle)
      server.middlewares.use('/api/pinch-logs', handleLogs)
    },
  }
}

/**
 * What the playground is built from, so saved benchmark runs say what they measured: the commit,
 * plus a hash of uncommitted changes, new files included, to the package, playground and build
 * config (`abc1234+5f3e9a1`).
 */
function buildId() {
  try {
    const git = (args: string) => execSync(`git ${args}`, { encoding: 'utf8' })
    const commit = git('rev-parse --short HEAD').trim()
    const paths = '-- src playground styles vite.config.ts package.json'
    // Contents, not just names, of new files: editing one must change the id.
    const untracked = git(`ls-files --others --exclude-standard ${paths}`).split('\n').filter(Boolean)
    const changes = git(`diff HEAD ${paths}`) + untracked.map((file) => `${file}\n${readFileSync(file, 'utf8')}`).join('\n')
    return changes ? `${commit}+${createHash('sha1').update(changes).digest('hex').slice(0, 7)}` : commit
  } catch {
    return 'unknown'
  }
}

// Dev-only playground. The published package is built with `tsc` (see `npm run build`).
export default defineConfig({
  root: 'playground',
  // Sample photos, shared with the demo site (`npm run fixtures`).
  publicDir: '../public',
  plugins: [react(), benchmarkNetwork(), benchmarkHistory()],
  define: { __GALLY_BUILD__: JSON.stringify(buildId()) },
  // `vite build` makes a static, deployable playground (the package itself builds with `tsc`).
  build: { outDir: '../playground-dist', emptyOutDir: true, target: 'es2022' },
})
