import { Fragment, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { Icon, Option, reducedMotion, Ruler, useCoarsePointer, useNearScreen, type Choice } from './ui'

/*
 * A demo box. By default it is only the demo, a ruler under it that shows and sets its zoom, and
 * the demo's own options. The Debug button in its corner opens a panel beside it: a live readout,
 * overlays that show what the engine draws, and a reset.
 *
 * With a mouse or trackpad the demo takes drags and pinches where it sits. On a touch screen it
 * is a live preview that opens full screen on tap, so the page still scrolls under a finger and
 * the demo gets every gesture once open; the ruler and the panel work on the preview either way.
 */

export type StatRow = { label: string; value: string; tone?: 'dom' | 'canvas' }

export type StageRuler = {
  label: string
  /** Position, 0 to 1. */
  value: number
  /** The value as shown. */
  text: string
  /** Stops, for a ruler that snaps. */
  steps?: number
  /** Where canvas gives way to elements, 0 to 1. */
  split?: number
  set(value: number): void
}

export type StageReading = { rows: StatRow[]; ruler?: StageRuler }

export type StageGroup = { label: string; options: Choice[] }

export type StageContext = {
  open: boolean
  /** The stage is phone-sized: demos pick smaller tiles. */
  compact: boolean
  /** The stage's width in px. */
  width: number
  /** Space the full-screen chrome and the device's safe areas cover, in px. */
  inset: { top: number; bottom: number }
}

type StageProps = {
  label: string
  caption: ReactNode
  /** The demo's own options. */
  groups?: StageGroup[]
  /** Extra overlays for the debug panel's Display group, beside Outlines. */
  display?: StageGroup[]
  /** What the demo is doing now. Read a few times a second while it's on screen. */
  read?: (context: StageContext) => StageReading | null
  /** Inline, leave wheel scrolling to the page: a surface with no end would never give it back. */
  wheelToPage?: boolean
  children: (context: StageContext) => ReactNode
}

const OUT = 'cubic-bezier(0.2, 0, 0, 1)'
const OPEN_MS = 520
const CLOSE_MS = 400
const READ_MS = 80
const FULL = 'inset(0px 0px 0px 0px round 0px)'

type Snapshot = { rows: StatRow[]; ruler?: Omit<StageRuler, 'set'> }

/**
 * Readings land in a store that only the readout and the ruler subscribe to, so a reading never
 * re-renders the stage or the demo inside it (a re-render mid-zoom would disturb the animation).
 */
function createStore() {
  let value: Snapshot | null = null
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: Snapshot | null) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
type Store = ReturnType<typeof createStore>

export function Stage({ label, caption, groups = [], display = [], read, wheelToPage = false, children }: StageProps) {
  const id = useId()
  const coarse = useCoarsePointer()
  const [slotRef, near] = useNearScreen<HTMLDivElement>()
  const frameRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const probeRef = useRef<HTMLSpanElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const [open, setOpen] = useState(false)
  const [debug, setDebug] = useState(false)
  const [outlines, setOutlines] = useState(true)
  const [epoch, setEpoch] = useState(0)
  const [size, setSize] = useState({ compact: false, width: 0 })
  const [inset, setInset] = useState({ top: 0, bottom: 0 })
  const [store] = useState(createStore)
  const setRuler = useRef<((value: number) => void) | undefined>(undefined)
  const closing = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
  const readRef = useRef(read)
  readRef.current = read
  const live = near || open
  const context: StageContext = { open, compact: size.compact, width: size.width, inset }
  const contextRef = useRef(context)
  contextRef.current = context

  // Where the box sits, relative to the full-screen frame: the frame opens from and closes to it.
  const slotInFrame = () => {
    const slot = slotRef.current!.getBoundingClientRect()
    const frame = frameRef.current!.getBoundingClientRect()
    return {
      x: slot.left - frame.left,
      y: slot.top - frame.top,
      clip: `inset(${slot.top - frame.top}px ${frame.right - slot.right}px ${frame.bottom - slot.bottom}px ${slot.left - frame.left}px round 14px)`,
    }
  }

  useLayoutEffect(() => {
    if (!open) return
    const frame = frameRef.current!
    const view = viewRef.current!
    const probe = probeRef.current
    if (probe) {
      const style = getComputedStyle(probe)
      setInset({ top: parseFloat(style.paddingTop) || 0, bottom: parseFloat(style.paddingBottom) || 0 })
    }
    document.documentElement.classList.add('stage-open')
    if (reducedMotion()) frame.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' })
    else {
      // The frame is already full size; a clip grows from the box, and the photos slide from
      // where they were, so nothing jumps.
      const from = slotInFrame()
      frame.animate([{ clipPath: from.clip }, { clipPath: FULL }], { duration: OPEN_MS, easing: OUT })
      view.animate([{ transform: `translate(${from.x}px, ${from.y}px)` }, { transform: 'translate(0, 0)' }], { duration: OPEN_MS, easing: OUT })
    }
    closeRef.current?.focus({ preventScroll: true })
    return () => document.documentElement.classList.remove('stage-open')
  }, [open])

  const close = () => {
    const frame = frameRef.current
    const view = viewRef.current
    if (!frame || !view || !openRef.current || closing.current) return
    closing.current = true
    const finish = (animations: Animation[]) => {
      flushSync(() => setOpen(false))
      for (const animation of animations) animation.cancel()
      closing.current = false
      returnFocusRef.current?.focus({ preventScroll: true })
    }
    if (reducedMotion()) {
      const fade = frame.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: 'ease-in', fill: 'forwards' })
      void fade.finished.then(() => finish([fade]))
      return
    }
    const to = slotInFrame()
    const options = { duration: CLOSE_MS, easing: OUT, fill: 'forwards' as const }
    const clip = frame.animate([{ clipPath: FULL }, { clipPath: to.clip }], options)
    const slide = view.animate([{ transform: 'translate(0, 0)' }, { transform: `translate(${to.x}px, ${to.y}px)` }], options)
    void clip.finished.then(() => finish([clip, slide]))
  }
  const closeLatest = useRef(close)
  closeLatest.current = close

  const ownsHistory = () => (history.state as { gallyStage?: string } | null)?.gallyStage === id
  /** Closing goes through history, so the phone's back button closes a demo too. */
  const requestClose = () => {
    if (ownsHistory()) history.back()
    else close()
  }

  useEffect(() => {
    if (!open) return
    if ((history.state as { gallyStage?: string } | null)?.gallyStage !== id) history.pushState({ gallyStage: id }, '')
    const onPop = () => closeLatest.current()
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if ((history.state as { gallyStage?: string } | null)?.gallyStage === id) history.back()
      else closeLatest.current()
    }
    addEventListener('popstate', onPop)
    addEventListener('keydown', onKey)
    return () => {
      removeEventListener('popstate', onPop)
      removeEventListener('keydown', onKey)
    }
  }, [open, id])

  const enter = (event: { currentTarget: HTMLElement }) => {
    returnFocusRef.current = event.currentTarget
    setOpen(true)
  }

  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const width = Math.round(entry.contentRect.width)
      setSize((current) => (current.width === width ? current : { compact: width < 600, width }))
    })
    observer.observe(frame)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || !wheelToPage) return
    const onWheel = (event: WheelEvent) => {
      // A pinch on a trackpad (ctrl+wheel) still reaches the canvas; plain scrolling doesn't.
      if (!openRef.current && !event.ctrlKey && !event.metaKey) event.stopPropagation()
    }
    view.addEventListener('wheel', onWheel, { capture: true, passive: true })
    return () => view.removeEventListener('wheel', onWheel, { capture: true })
  }, [wheelToPage])

  useEffect(() => {
    if (!live) return
    let frames = 0
    let since = performance.now()
    let fps = ''
    let last = ''
    let raf = requestAnimationFrame(function count() {
      frames++
      raf = requestAnimationFrame(count)
    })
    const tick = () => {
      const now = performance.now()
      if (now - since >= 600) {
        fps = `${Math.round((frames * 1000) / (now - since))} fps`
        frames = 0
        since = now
      }
      const reading = readRef.current?.(contextRef.current)
      if (!reading) return
      setRuler.current = reading.ruler?.set
      const { set: _set, ...ruler } = reading.ruler ?? ({} as StageRuler)
      const next: Snapshot = { rows: [...reading.rows, { label: 'Frames', value: fps || '…' }], ...(reading.ruler ? { ruler } : {}) }
      const key = JSON.stringify(next)
      if (key === last) return
      last = key
      store.set(next)
    }
    tick()
    const timer = setInterval(tick, READ_MS)
    return () => {
      cancelAnimationFrame(raf)
      clearInterval(timer)
    }
  }, [live, epoch, store])

  const preview = coarse && !open
  const onOff = (name: string, on: boolean, set: (value: boolean) => void): StageGroup => ({
    label: name,
    options: [
      { label: 'On', pressed: on, onPress: () => set(true) },
      { label: 'Off', pressed: !on, onPress: () => set(false) },
    ],
  })
  const displayGroups = [onOff('Outlines', outlines, setOutlines), ...display]
  const options = (list: StageGroup[]) => list.map((group) => <Option key={group.label} label={group.label} options={group.options} />)
  const onRuler = (value: number) => setRuler.current?.(value)

  return (
    <figure
      className="stage"
      data-open={open ? '' : undefined}
      data-debug={debug ? '' : undefined}
      data-outlines={debug && outlines ? '' : undefined}
      data-preview={preview ? '' : undefined}
    >
      <div className="stage__slot" ref={slotRef}>
        <div className="stage__frame" ref={frameRef} role={open ? 'dialog' : 'group'} aria-modal={open ? true : undefined} aria-label={label}>
          <span className="stage__probe" ref={probeRef} aria-hidden="true" />
          <div className="stage__view" ref={viewRef} inert={preview}>
            {live && <Fragment key={epoch}>{children(context)}</Fragment>}
          </div>
          {preview && (
            <button type="button" className="stage__enter" onClick={enter}>
              <span>
                Tap to explore
                <Icon name="expand" />
              </span>
            </button>
          )}
          <div className="stage__corner">
            {!open && (
              <button type="button" className="round" aria-label="Full screen" title="Full screen" onClick={enter}>
                <Icon name="expand" />
              </button>
            )}
            <button
              type="button"
              className="round"
              aria-pressed={debug}
              aria-label="Debug"
              title={debug ? 'Close debug' : 'Debug'}
              onClick={() => setDebug((value) => !value)}
            >
              <Icon name={debug && !open ? 'close' : 'bug'} />
            </button>
            {open && (
              <button type="button" className="round" ref={closeRef} aria-label="Exit full screen" title="Exit full screen" onClick={requestClose}>
                <Icon name="collapse" />
              </button>
            )}
          </div>
          {open && debug && <LiveReadout store={store} className="stage__float" />}
          {open && (
            <div className="stage__dock">
              <div className="stage__dock-groups">{options(debug ? [...groups, ...displayGroups] : groups)}</div>
              <LiveRuler store={store} onChange={onRuler} />
            </div>
          )}
        </div>
      </div>
      {/* Open, the ruler moves into the frame; this row keeps the layout from jumping behind it. */}
      <div className="stage__under" inert={open}>
        <LiveRuler store={store} onChange={onRuler} />
        {!debug && options(groups)}
      </div>
      {debug && (
        <div className="stage__panel" inert={open}>
          <section>
            <h3>Readout</h3>
            <LiveReadout store={store} />
          </section>
          <section>
            <h3>Display</h3>
            {options(displayGroups)}
          </section>
          {groups.length > 0 && (
            <section>
              <h3>Demo</h3>
              {options(groups)}
            </section>
          )}
        </div>
      )}
      {debug && (
        <button type="button" className="key stage__reset" inert={open} onClick={() => setEpoch((value) => value + 1)}>
          Reset
        </button>
      )}
      <figcaption>{caption}</figcaption>
    </figure>
  )
}

function LiveReadout({ store, className }: { store: Store; className?: string }) {
  const snapshot = useSyncExternalStore(store.subscribe, store.get)
  return (
    <dl className={['readout', className].filter(Boolean).join(' ')}>
      {(snapshot?.rows ?? []).map((row) => (
        <div key={row.label} data-tone={row.tone}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function LiveRuler({ store, onChange }: { store: Store; onChange: (value: number) => void }) {
  const ruler = useSyncExternalStore(store.subscribe, store.get)?.ruler
  /** The position under the pointer, shown at once; the demo's own reading follows. */
  const [scrub, setScrub] = useState<number | null>(null)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  if (!ruler) return <div className="ruler" />
  return (
    <Ruler
      label={ruler.label}
      value={scrub ?? ruler.value}
      text={ruler.text}
      live={scrub === null}
      onChange={(value) => {
        setScrub(value)
        onChange(value)
        clearTimeout(timer.current)
        timer.current = window.setTimeout(() => setScrub(null), 400)
      }}
      {...(ruler.steps ? { steps: ruler.steps } : {})}
      {...(ruler.split === undefined ? {} : { split: ruler.split })}
    />
  )
}
