import { useEffect, useRef, useState } from 'react'
import { benchRunPending, config, setBenchRunPending } from '../config'
import { fixtureWarmUrls } from '../library/library'
import type { BenchResult } from './run'

/**
 * Where runs live. This browser keeps its recent runs in localStorage for the score chart; every run
 * is also saved to `/api/runs` (Vercel Blob when deployed, `.bench/runs.jsonl` on the dev server)
 * for the History tab. `playground/functions/api/_runs.js` defines that store's contract.
 */

const RECENT_KEY = 'gally-bench-results-v5'
const RECENT_LIMIT = 40

/** A run whose timings count: the page stayed visible and the browser never stalled it. */
export const isValidRun = (run: BenchResult) => !run.pauses && !run.hidden

/** Scores compare only between runs scored and measured the same way, on the same kind of screen. */
export function comparable(a: BenchResult, b: BenchResult) {
  const [x, y] = [a.config, b.config]
  return (
    (a.scoreVersion ?? 1) === (b.scoreVersion ?? 1) &&
    x.engine === y.engine && x.input === y.input && x.images === y.images && x.net === y.net && x.viewport === y.viewport && x.dpr === y.dpr && x.browser === y.browser
  )
}

/** The run before `run` that it can be compared with, from any of the lists. */
export function previousRun(run: BenchResult, ...lists: BenchResult[][]) {
  return lists
    .flat()
    .filter((other) => other.at < run.at && isValidRun(other) && comparable(other, run))
    .sort((a, b) => b.at.localeCompare(a.at))[0]
}

const runDate = new Intl.DateTimeFormat([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
export const formatRunDate = (run: BenchResult) => runDate.format(new Date(run.at))

export function loadRecentRuns(): BenchResult[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as BenchResult[]
  } catch {
    return []
  }
}

export function clearRecentRuns() {
  localStorage.removeItem(RECENT_KEY)
}

/** Keep a finished run: locally, and in the shared history. Returns the recent runs. */
export function saveRun(run: BenchResult): BenchResult[] {
  const recent = [run, ...loadRecentRuns()].slice(0, RECENT_LIMIT)
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent))
  fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(run) }).catch(() => {
    // Offline: the run is still in this browser's recent list.
  })
  return recent
}

export type History = { runs: BenchResult[]; loading: boolean; error: boolean; more: boolean; loadMore: () => void }

/** Saved runs, newest first, a page at a time; reloads whenever it becomes active. */
export function useHistory(active: boolean): History {
  const [runs, setRuns] = useState<BenchResult[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  /** The latest request; responses to older ones are ignored. */
  const request = useRef(0)

  const load = async (from: string | null) => {
    const id = ++request.current
    setLoading(true)
    setError(false)
    try {
      const response = await fetch(`/api/runs${from ? `?cursor=${encodeURIComponent(from)}` : ''}`)
      if (!response.ok) throw new Error(String(response.status))
      const page = (await response.json()) as { runs: BenchResult[]; cursor: string | null }
      if (id !== request.current) return
      setRuns((current) => (from ? [...current, ...page.runs] : page.runs))
      setCursor(page.cursor)
    } catch {
      if (id === request.current) setError(true)
    } finally {
      if (id === request.current) setLoading(false)
    }
  }

  useEffect(() => {
    if (active) void load(null)
  }, [active])

  return { runs, loading, error, more: Boolean(cursor), loadMore: () => void load(cursor) }
}

/**
 * Start a run. A run measures a visitor with a cold browser cache and a warm CDN, the usual
 * production case. Each deploy empties the CDN, so on the deployed site every fixture is fetched
 * once first with `cache: 'no-store'` (which warms the CDN without filling the browser's cache),
 * then the page reloads for the measured run.
 */
export async function startRun(setStatus: (status: string) => void) {
  if (config.net === 'cdn') {
    setStatus('Waiting for the CDN…')
    const urls = fixtureWarmUrls()
    let next = 0
    await Promise.all(
      Array.from({ length: 24 }, async () => {
        while (next < urls.length) {
          const url = urls[next++]!
          await fetch(url, { cache: 'no-store' })
            .then((response) => response.arrayBuffer())
            .catch(() => null)
        }
      }),
    )
  }
  setBenchRunPending(true)
  const url = new URL(location.href)
  url.searchParams.delete('autorun')
  location.replace(url.toString())
}

/** Whether this page load should run the benchmark, clearing the request so a reload doesn't repeat it. */
export function takePendingRun() {
  if (!benchRunPending || pendingRunTaken) return false
  pendingRunTaken = true
  setBenchRunPending(false)
  return true
}
let pendingRunTaken = false
