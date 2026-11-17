import { useEffect, useState } from 'react'
import { config, reloadWithParam, SIMULATED_NETWORKS, simulatedNetwork } from '../config'
import { FpsChart, ScoreHistory } from './charts'
import { currentConfig, type BenchResult } from './run'
import {
  clearRecentRuns,
  formatRunDate,
  isValidRun,
  loadRecentRuns,
  previousRun,
  saveRun,
  startRun,
  takePendingRun,
  useHistory,
  type History,
} from './storage'

/** Benchmark panel for the demos. Shift+B shows and hides it; `?autorun=1` runs on load. */

type Live = { visible: boolean; state: string; sharp: number; tiles: number; loading: string }

/** What the panel measures: the library, or one of the canvases. */
export type BenchSubject = {
  /** Whether the component has mounted. */
  ready(): boolean
  run(): Promise<BenchResult>
  /** Live engine readout, or null before it has mounted. */
  live(): Omit<Live, 'visible'> | null
}

const PANEL_KEY = 'gally-bench-panel'
type PanelState = 'open' | 'compact' | 'hidden'

const ms = (value: number | null | undefined) => (value == null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`)
const netLabel = (net: string) => (net === 'real' ? 'picsum' : net)

export function BenchPanel({ subject }: { subject: BenchSubject }) {
  const [results, setResults] = useState(loadRecentRuns)
  const [status, setStatus] = useState('')
  const [panel, setPanelState] = useState<PanelState>(() => (localStorage.getItem(PANEL_KEY) as PanelState) || 'open')
  const [live, setLive] = useState<Live | null>(null)
  const [view, setView] = useState<'latest' | 'history'>('latest')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const history = useHistory(view === 'history')

  const setPanel = (next: PanelState | ((current: PanelState) => PanelState)) =>
    setPanelState((current) => {
      const value = typeof next === 'function' ? next(current) : next
      localStorage.setItem(PANEL_KEY, value)
      return value
    })

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.shiftKey && event.key.toLowerCase() === 'b' && !(event.target instanceof HTMLInputElement)) {
        setPanel((current) => (current === 'hidden' ? 'open' : 'hidden'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const busy = status.startsWith('Running') || status.startsWith('Waiting')

  // Live engine readout, paused during a run so it doesn't add renders to what's measured.
  useEffect(() => {
    if (busy) return
    const timer = setInterval(() => {
      const live = subject.live()
      if (live) setLive({ visible: document.visibilityState === 'visible', ...live })
    }, 400)
    return () => clearInterval(timer)
  }, [subject, busy])

  useEffect(() => {
    if (config.autorun) {
      void startRun(setStatus)
      return
    }
    if (!takePendingRun()) return
    let canceled = false
    ;(async () => {
      setStatus('Waiting for the demo…')
      const giveUpAt = performance.now() + 20000
      while (!canceled && !subject.ready() && performance.now() < giveUpAt) await new Promise((resolve) => setTimeout(resolve, 16))
      if (canceled) return
      if (!subject.ready()) {
        setStatus('The demo didn’t load')
        return
      }
      setStatus('Running — hands off')
      const result = await subject.run()
      if (canceled) return
      setResults(saveRun(result))
      setStatus(isValidRun(result) ? '' : 'Invalid: page was hidden or throttled')
    })()
    return () => {
      canceled = true
    }
  }, [subject])

  const cfg = currentConfig()
  const latest = (selectedId && [...results, ...history.runs].find((r) => r.id === selectedId)) || results[0]
  const latestValid = latest ? isValidRun(latest) : false
  const previous = latest && previousRun(latest, results, history.runs)
  const delta = latest && latestValid && previous ? latest.score.total - previous.score.total : null
  const lost = latest
    ? latest.score.parts
        .map((part) => ({ label: part.label, lost: Math.round((part.weight - part.points) * 10) / 10 }))
        .filter((part) => part.lost >= 0.5)
        .sort((a, b) => b.lost - a.lost)
        .slice(0, 3)
    : []
  const dot = busy ? 'busy' : live?.visible === false ? 'warn' : 'ok'
  const slowest = latest?.longFrameDetails?.[0]

  if (panel === 'hidden') {
    return (
      <button type="button" className="bench-pill" onClick={() => setPanel('open')} title="Show benchmark (Shift+B)">
        <span className="bench-dot" data-state={dot} />
        {latest ? latest.score.total : 'Bench'}
      </button>
    )
  }

  return (
    <aside className="bench" data-compact={panel === 'compact' || undefined} aria-label="Benchmark">
      <header className="bench-head">
        <span className="bench-dot" data-state={dot} />
        <span className="bench-title">Benchmark</span>
        <span className="bench-config">
          {cfg.engine} · {netLabel(cfg.net)}
        </span>
        <button
          type="button"
          className="bench-icon"
          aria-label={panel === 'compact' ? 'Expand' : 'Collapse'}
          onClick={() => setPanel(panel === 'compact' ? 'open' : 'compact')}
        >
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d={panel === 'compact' ? 'M3 4.5 6 7.5 9 4.5' : 'M3 7.5 6 4.5 9 7.5'} />
          </svg>
        </button>
        <button type="button" className="bench-icon" aria-label="Hide (Shift+B)" onClick={() => setPanel('hidden')}>
          <svg viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3.5 3.5 8.5 8.5M8.5 3.5 3.5 8.5" />
          </svg>
        </button>
      </header>

      <section className="bench-hero">
        <div className="bench-score-block">
          <span className="bench-score" data-invalid={latest && !latestValid ? '' : undefined}>
            {latest ? latest.score.total : '—'}
          </span>
          {delta != null && delta !== 0 && (
            <span className="bench-delta" data-up={delta > 0 || undefined}>
              {delta > 0 ? '+' : ''}
              {delta}
            </span>
          )}
          <span className="bench-caption">
            {status || (latest ? `${latestValid ? '' : 'Invalid · '}${selectedId ? formatRunDate(latest) : 'Latest run'}` : 'No runs yet')}
          </span>
        </div>
        <ScoreHistory results={results} />
      </section>

      {panel === 'open' && (
        <div className="bench-segment bench-tabs" role="tablist" aria-label="Benchmark view">
          {(['latest', 'history'] as const).map((value) => (
            <button key={value} type="button" role="tab" aria-selected={view === value} onClick={() => setView(value)}>
              {value === 'latest' ? 'Details' : 'History'}
            </button>
          ))}
        </div>
      )}

      {panel === 'open' && view === 'history' && (
        <HistoryList
          history={history}
          selectedId={latest?.id ?? null}
          onSelect={(id) => {
            setSelectedId(id === results[0]?.id ? null : id)
            setView('latest')
          }}
        />
      )}

      {panel === 'open' && view === 'latest' && (
        <>
          <FpsChart />

          {latest && <Metrics run={latest} />}

          {lost.length > 0 && (
            <p className="bench-lost">
              {lost.map((part) => (
                <span key={part.label}>
                  {part.label} −{part.lost}
                </span>
              ))}
            </p>
          )}

          {slowest && (
            <p className="bench-slowest" title={latest!.longFrameDetails.map((f) => `${f.duration}ms in ${f.phase} @${f.at}ms: ${f.scripts.join(', ') || 'no script'}`).join('\n')}>
              Slowest frame {slowest.duration}ms in {slowest.phase} @{slowest.at}ms
              {slowest.render ? ` · render ${slowest.render}ms` : ''}
              {slowest.scripts[0] ? ` · ${slowest.scripts[0]}` : ''}
            </p>
          )}

          {live && (
            <p className="bench-live">
              <span data-warn={!live.visible || undefined}>{live.visible ? 'visible' : 'hidden: timings invalid'}</span>
              <span>{live.state}</span>
              <span>
                {live.sharp}/{live.tiles} sharp
              </span>
              {live.loading && <span>{live.loading}</span>}
            </p>
          )}

          <div className="bench-controls">
            {config.renderer === 'photos' ? (
              <div className="bench-segment" role="group" aria-label="Renderer">
                {(['hybrid', 'dom'] as const).map((engine) => (
                  <button key={engine} type="button" aria-pressed={cfg.engine === engine} onClick={() => reloadWithParam('engine', engine)}>
                    {engine === 'hybrid' ? 'Hybrid' : 'DOM'}
                  </button>
                ))}
              </div>
            ) : (
              <div className="bench-segment" role="group" aria-label="Input">
                {(['touch', 'wheel'] as const).map((input) => (
                  <button key={input} type="button" aria-pressed={cfg.input === input} onClick={() => reloadWithParam('input', input)}>
                    {input === 'touch' ? 'Touch' : 'Trackpad'}
                  </button>
                ))}
              </div>
            )}
            {simulatedNetwork && (
              <div className="bench-segment" role="group" aria-label="Network">
                {SIMULATED_NETWORKS.map((net) => (
                  <button key={net} type="button" aria-pressed={cfg.net === net} onClick={() => reloadWithParam('net', net)}>
                    {net === 'fast' ? 'Fast' : net.toUpperCase()}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <footer className="bench-actions">
        <button type="button" className="bench-run" onClick={() => void startRun(setStatus)} disabled={busy}>
          {busy ? 'Running…' : 'Run'}
        </button>
        <button type="button" onClick={() => navigator.clipboard?.writeText(JSON.stringify(results, null, 2))} disabled={!results.length}>
          Copy
        </button>
        <button
          type="button"
          onClick={() => {
            clearRecentRuns()
            setResults([])
          }}
          disabled={!results.length || busy}
        >
          Clear
        </button>
      </footer>
    </aside>
  )
}

function Metrics({ run }: { run: BenchResult }) {
  return (
    <dl className="bench-metrics">
      <dt>First screen</dt>
      <dd>
        {ms(run.firstScreenFilledMs)} <span>/ {ms(run.firstScreenSharpMs)} sharp</span>
        {run.networkFloorMs != null && <span> · net {ms(run.networkFloorMs)}</span>}
      </dd>
      {/* The screen shows at most its refresh rate (120 Hz); capacity is the frame rate the main
          thread could keep up with while moving, which is how 240 fps is measured. */}
      <dt>Capacity</dt>
      <dd>
        {run.capacity ? `${run.capacity.motion.p95} fps` : '—'} <span>p95 while moving · {run.fps?.motion.avg ?? '—'} fps on screen (refresh-capped)</span>
      </dd>
      {(!run.config.renderer || run.config.renderer === 'photos') && (
        <>
          <dt>Level change</dt>
          <dd>
            {ms(run.zoom.commitAvgMs)} <span>/ {ms(run.zoom.commitMaxMs)} max</span>
          </dd>
        </>
      )}
      <dt>Pinch</dt>
      <dd>
        {run.zoom.blankAvgPct}% blank <span>· {ms(run.zoom.settleSharpMs)} sharp</span>
      </dd>
      <dt>Flick</dt>
      <dd>
        {run.scroll.blankAvgPct}% blank <span>· {ms(run.scroll.sharpAfterStopMs)} sharp</span>
      </dd>
      <dt>Blocking</dt>
      <dd>
        {ms(run.frames.blockingMs)} <span>· {run.frames.longTasks} long tasks</span>
      </dd>
      <dt>Network</dt>
      <dd>
        {run.loader.started} loads <span>· {run.loader.aborted} cancelled free · {run.loader.megabytes} MB</span>
      </dd>
    </dl>
  )
}

function HistoryList({ history, selectedId, onSelect }: { history: History; selectedId: string | null; onSelect: (id: string) => void }) {
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    if (history.more && !history.loading && el.scrollTop + el.clientHeight > el.scrollHeight - 40) history.loadMore()
  }
  return (
    <div className="bench-history-list" onScroll={onScroll}>
      {history.runs.map((run) => {
        const invalid = !isValidRun(run)
        return (
          <button key={run.id} type="button" className="bench-run-row" aria-current={run.id === selectedId || undefined} onClick={() => onSelect(run.id)}>
            <span className="bench-run-score" data-invalid={invalid ? '' : undefined}>
              {run.score.total}
            </span>
            <span className="bench-run-meta">
              <span>
                {run.config.engine} · {netLabel(run.config.net)} · {run.config.browser}
              </span>
              <span>
                {formatRunDate(run)}
                {invalid ? ' · invalid' : ''}
              </span>
            </span>
            <span className="bench-run-key">
              {ms(run.zoom.commitAvgMs)}
              <span>{ms(run.firstScreenSharpMs)}</span>
            </span>
          </button>
        )
      })}
      {history.loading && <p className="bench-history-note">Loading…</p>}
      {history.error && <p className="bench-history-note">Couldn’t load history.</p>}
      {!history.loading && !history.error && !history.runs.length && <p className="bench-history-note">No saved runs yet.</p>}
    </div>
  )
}
