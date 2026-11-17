import { useEffect, useRef } from 'react'
import type { GallyLibraryPinchEvent } from '../../src/react/index.js'
import { BUILD } from '../config'

/**
 * A pinch indicator for screen recordings (`?debug=1`): one short line with the level, columns, the
 * grid's live scale, fingers down, fps and how many events it has recorded, red when two levels
 * swap back and forth. It records every pinch event of the visit and saves the recording to this
 * browser and to `/api/pinch-logs` (see `playground/functions/api/_pinch-logs.js`). It writes to the DOM
 * directly and takes no touches, so it adds no renders to a pinch and doesn't get in its way.
 */
export function usePinchDebug() {
  const listeners = useRef(new Set<(event: GallyLibraryPinchEvent) => void>())
  const onPinch = useRef((event: GallyLibraryPinchEvent) => {
    for (const listener of listeners.current) listener(event)
  }).current
  return { onPinch, listeners: listeners.current }
}

type Summary = { min: number; max: number; moves: number; gestures: number; cancels: number; fps: number; loops: number }
/**
 * [ms since the visit began, phase, level on screen, columns, scale, fingers down, scrollTop,
 * the fingers' zoom since the pinch began, summary on `end`]
 */
type LogEvent = [number, GallyLibraryPinchEvent['phase'], number, number, number, number, number, number, Summary?]

/**
 * Who made a recording: `?tester=` names it (scripted and Simulator runs pass one), browsers driven
 * by automation say so, anything else is a person on a device.
 */
function tester() {
  const named = new URLSearchParams(location.search).get('tester')
  if (named) return named.slice(0, 40)
  return navigator.webdriver ? 'automation' : 'person'
}

const LOOP_WINDOW_MS = 2000
const STORAGE_KEY = 'gally-pinch-log'
/** Save at most this often while pinching, and right after each pinch ends. */
const SAVE_EVERY_MS = 3000
const MAX_EVENTS = 20000

export function PinchDebug({ listeners }: { listeners: Set<(event: GallyLibraryPinchEvent) => void> }) {
  const lineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const begun = performance.now()
    const session = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      build: BUILD,
      tester: tester(),
      device: { userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio },
      events: [] as LogEvent[],
    }
    let fingers = 0
    let fps = 0
    let last: GallyLibraryPinchEvent | null = null
    let loop = ''
    let saved: 'saved' | 'saving' | 'offline' | '' = ''
    const raw = { moves: 0, gestures: 0, cancels: 0, min: 1, max: 1, loops: 0 }
    const commits: Array<{ at: number; from: number; to: number; fingers: number }> = []

    const render = () => {
      const line = lineRef.current
      if (!line) return
      const state = last ? `L${last.level} · ${last.columns} cols · ×${last.scale.toFixed(2)}` : 'pinch to record'
      line.textContent = `${loop || state} · ${fingers}☝ · ${fps} fps · ● ${session.events.length}${saved ? ` ${saved}` : ''}`
      line.dataset.loop = loop ? '1' : ''
    }

    // Saved here first (survives a reload), then uploaded; the server keeps the latest copy per visit.
    let saveTimer = 0
    let lastSave = 0
    const save = () => {
      clearTimeout(saveTimer)
      saveTimer = 0
      lastSave = performance.now()
      const body = JSON.stringify(session)
      try {
        localStorage.setItem(STORAGE_KEY, body)
      } catch {
        // Storage full or blocked: the upload still goes.
      }
      saved = 'saving'
      render()
      fetch('/api/pinch-logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: body.length < 60_000 })
        .then((response) => (saved = response.ok ? 'saved' : 'offline'))
        .catch(() => (saved = 'offline'))
        .finally(render)
    }
    const saveSoon = (now: number) => {
      if (saveTimer) return
      saveTimer = window.setTimeout(save, Math.max(0, SAVE_EVERY_MS - (now - lastSave)))
    }

    const listener = (event: GallyLibraryPinchEvent) => {
      const now = performance.now()
      const previous = last
      last = event
      if (event.phase === 'start') {
        raw.moves = raw.gestures = raw.cancels = raw.loops = 0
        raw.min = raw.max = 1
      }
      if (event.phase === 'move' || event.phase === 'commit') {
        raw.min = Math.min(raw.min, event.scale)
        raw.max = Math.max(raw.max, event.scale)
      }
      const record: LogEvent = [
        Math.round(now - begun),
        event.phase,
        event.level,
        event.columns,
        Math.round(event.scale * 1000) / 1000,
        fingers,
        Math.round(event.scrollTop * 10) / 10,
        Math.round(event.fingers * 1000) / 1000,
      ]
      if (event.phase === 'end') record.push({ ...raw, fps })
      if (session.events.length < MAX_EVENTS) session.events.push(record)
      if (event.phase === 'commit' && previous) {
        commits.push({ at: now, from: previous.level, to: event.level, fingers: event.fingers })
        while (commits.length && now - commits[0]!.at > LOOP_WINDOW_MS) commits.shift()
        // A loop: the last three changes swap between the same two levels while the fingers don't
        // turn back between them (they kept going one way, or hardly moved). Fingers going back and
        // forth across a level change it back and forth, as they should.
        const recent = commits.slice(-3)
        const swaps = recent.length === 3 && recent.every((c, i) => i === 0 || (c.from === recent[i - 1]!.to && c.to === recent[i - 1]!.from))
        const steps = recent.slice(1).map((c, i) => Math.log(c.fingers / recent[i]!.fingers))
        const followsFingers = steps.length === 2 && steps[0]! * steps[1]! < 0 && steps.every((step) => Math.abs(step) > 0.03)
        if (swaps && !followsFingers) {
          raw.loops++
          loop = `LOOP L${recent[0]!.from}↔L${recent[0]!.to}`
          window.setTimeout(() => {
            loop = ''
            render()
          }, 3000)
        }
      }
      if (event.phase === 'end') save()
      else saveSoon(now)
      render()
    }
    listeners.add(listener)

    // Fingers down, from touch pointers (touch events can miss a lift).
    const down = new Set<number>()
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== 'touch') return
      // A new touch: fingers from before are gone, even if their lift was missed.
      if (event.isPrimary) down.clear()
      down.add(event.pointerId)
      fingers = down.size
      render()
    }
    const onUp = (event: PointerEvent) => {
      if (!down.delete(event.pointerId)) return
      fingers = down.size
      render()
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') raw.moves++
    }
    const onCancel = (event: PointerEvent) => {
      raw.cancels++
      onUp(event)
    }
    const onGesture = () => raw.gestures++
    const onHide = () => {
      if (document.visibilityState === 'hidden' && session.events.length) save()
    }
    const options = { capture: true, passive: true }
    window.addEventListener('pointermove', onMove, options)
    window.addEventListener('pointercancel', onCancel, options)
    window.addEventListener('gesturechange', onGesture, options)
    window.addEventListener('pointerdown', onDown, options)
    window.addEventListener('pointerup', onUp, options)
    document.addEventListener('visibilitychange', onHide)

    let frames = 0
    let windowStart = performance.now()
    let raf = 0
    const tick = (now: number) => {
      frames++
      if (now - windowStart >= 500) {
        fps = Math.round((frames * 1000) / (now - windowStart))
        frames = 0
        windowStart = now
        render()
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    render()
    return () => {
      if (session.events.length) save()
      listeners.delete(listener)
      window.removeEventListener('pointermove', onMove, { capture: true })
      window.removeEventListener('pointercancel', onCancel, { capture: true })
      window.removeEventListener('gesturechange', onGesture, { capture: true })
      window.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointerup', onUp, { capture: true })
      document.removeEventListener('visibilitychange', onHide)
      cancelAnimationFrame(raf)
      clearTimeout(saveTimer)
    }
  }, [listeners])

  return <div ref={lineRef} className="pinch-debug" aria-hidden="true" />
}
