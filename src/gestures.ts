import type { Point } from './types.js'

/**
 * Camera gestures for a Photo Surface: drag to pan (with momentum when a touch or pen flick lets
 * go), two-finger pinch, trackpad pinch (ctrl+wheel), Safari's gesture events, and wheel panning.
 *
 * The surface only says how to move its camera, in screen terms, so the same gestures drive any
 * camera convention. Points are in the element's coordinates.
 */
export type CameraGestureTarget = {
  /** Move the content by this many screen pixels. */
  pan(dx: number, dy: number): void
  /** Scale the zoom by `factor` around `point`, keeping what's under it in place. */
  zoom(point: Point, factor: number): void
  /** Called when a gesture starts moving the camera, and again if a pan turns into a pinch. */
  start?(kind: 'pan' | 'zoom'): void
  /** Called when the camera stops: fingers lifted and momentum done, or wheel input paused. */
  end?(): void
  /** Return false to leave a pointer down on this element to the page (e.g. a control). */
  accept?(event: PointerEvent): boolean
}

export type CameraGestureOptions = {
  /** Wheel zoom per pixel of `deltaY` while ctrl/⌘ is held (trackpad pinch). Default 0.01. */
  wheelZoomSpeed?: number
  /** A pan lets go with momentum above this speed, in px/ms. Default 0.15. */
  momentumMinSpeed?: number
  /** Momentum decay time constant in ms (iOS scroll views use about 325). Default 325. */
  momentumDecayMs?: number
  /** Movement in px after which a press counts as a drag and its click is cancelled. Default 6. */
  clickSlop?: number
}

const WHEEL_END_MS = 140
const VELOCITY_WINDOW_MS = 100

type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number }

/** Attach camera gestures to `element`. Returns a function that detaches them. */
export function attachCameraGestures(element: HTMLElement, target: CameraGestureTarget, options: CameraGestureOptions = {}): () => void {
  const wheelZoomSpeed = options.wheelZoomSpeed ?? 0.01
  const momentumMinSpeed = options.momentumMinSpeed ?? 0.15
  const momentumDecayMs = options.momentumDecayMs ?? 325
  const clickSlop = options.clickSlop ?? 6

  const pointers = new Map<number, Point>()
  /** Recent pan positions of the primary pointer, for the release velocity. */
  let samples: Array<{ t: number; x: number; y: number }> = []
  let origin = { left: 0, top: 0 }
  let downAt: Point | null = null
  let dragged = false
  /** The click this press would make goes nowhere: it dragged, pinched, or stopped a glide. */
  let cancelClick = false
  /** The current one-finger pan began as a pinch, so lifting it doesn't fling. */
  let fromPinch = false
  let wheeling = false
  let pinchDistance = 0
  let pinchCenter: Point = { x: 0, y: 0 }
  let gestureScale = 0
  let active: 'pan' | 'zoom' | null = null
  let momentum = 0
  let wheelTimer: ReturnType<typeof setTimeout> | undefined

  const local = (clientX: number, clientY: number): Point => ({ x: clientX - origin.left, y: clientY - origin.top })
  const measure = () => {
    const rect = element.getBoundingClientRect()
    origin = { left: rect.left, top: rect.top }
  }

  const begin = (kind: 'pan' | 'zoom') => {
    if (active === kind) return
    active = kind
    target.start?.(kind)
  }
  const finish = () => {
    if (active === null) return
    active = null
    target.end?.()
  }
  const stopMomentum = () => {
    if (momentum) cancelAnimationFrame(momentum)
    momentum = 0
  }

  const pair = () => {
    const [a, b] = [...pointers.values()] as [Point, Point]
    return { center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.hypot(a.x - b.x, a.y - b.y) }
  }
  const startPinch = () => {
    fromPinch = true
    const { center, distance } = pair()
    pinchCenter = center
    pinchDistance = distance
    begin('zoom')
  }
  /** Restart a single-finger pan from wherever the remaining finger is. */
  const restartPan = () => {
    const [point] = [...pointers.values()]
    samples = point ? [{ t: performance.now(), ...point }] : []
  }

  const onPointerDown = (event: PointerEvent) => {
    const first = pointers.size === 0
    const gliding = momentum !== 0
    // Any press stops a glide, even one on a control the gestures leave alone.
    if (first) {
      stopMomentum()
      dragged = false
      cancelClick = false
    }
    const accepted = !(event.pointerType === 'mouse' && event.button !== 0) && (!target.accept || target.accept(event))
    if (!accepted) {
      if (first && gliding) finish()
      return
    }
    if (first) {
      measure()
      downAt = { x: event.clientX, y: event.clientY }
      fromPinch = false
      // A tap that stops a glide only stops it, as on iOS.
      cancelClick = gliding
    }
    pointers.set(event.pointerId, local(event.clientX, event.clientY))
    // A finger joining a drag or pinch belongs to it too.
    if (dragged) {
      try {
        element.setPointerCapture(event.pointerId)
      } catch {
        // See `startDrag`.
      }
    }
    if (pointers.size === 2) {
      startDrag()
      startPinch()
    }
    else if (pointers.size === 1) restartPan()
  }

  /**
   * The press is a drag (or pinch) now, not a click: keep its pointers here even when they leave
   * the element. Capturing only now leaves a plain click on the element it was pressed on.
   */
  const startDrag = () => {
    if (dragged) return
    dragged = true
    cancelClick = true
    for (const id of pointers.keys()) {
      try {
        element.setPointerCapture(id)
      } catch {
        // Synthetic or already-released pointers can't be captured; their events still arrive here.
      }
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    const previous = pointers.get(event.pointerId)
    if (!previous) return
    // A mouse whose button came up where this element couldn't hear it (outside, before capture).
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      onPointerEnd(event)
      return
    }
    const point = local(event.clientX, event.clientY)
    pointers.set(event.pointerId, point)
    if (!dragged && downAt && Math.hypot(event.clientX - downAt.x, event.clientY - downAt.y) > clickSlop) startDrag()
    if (!dragged) return

    if (pointers.size >= 2) {
      if (pointers.size > 2) return
      const { center, distance } = pair()
      begin('zoom')
      target.pan(center.x - pinchCenter.x, center.y - pinchCenter.y)
      // Fingers on one spot have no spread to scale by; the pinch picks up once they part.
      if (distance > 0 && pinchDistance > 0) target.zoom(center, distance / pinchDistance)
      pinchCenter = center
      if (distance > 0) pinchDistance = distance
      return
    }

    begin('pan')
    target.pan(point.x - previous.x, point.y - previous.y)
    const now = performance.now()
    samples.push({ t: now, ...point })
    while (samples.length > 2 && now - samples[0]!.t > VELOCITY_WINDOW_MS) samples.shift()
  }

  const onPointerEnd = (event: PointerEvent) => {
    if (!pointers.delete(event.pointerId)) return
    if (pointers.size === 2) {
      startPinch()
      return
    }
    if (pointers.size === 1) {
      // A pinch became a pan: carry on from the finger still down.
      pinchDistance = 0
      restartPan()
      return
    }
    pinchDistance = 0
    const wasPan = active === 'pan'
    const velocity = wasPan && !fromPinch && event.type === 'pointerup' ? releaseVelocity() : null
    if (velocity && event.pointerType !== 'mouse') glide(velocity)
    // A wheel or trackpad pinch still running ends on its own.
    else if (!wheeling && !gestureScale) finish()
  }

  const releaseVelocity = () => {
    const now = performance.now()
    const recent = samples.filter((sample) => now - sample.t <= VELOCITY_WINDOW_MS)
    if (recent.length < 2) return null
    const first = recent[0]!
    const last = recent[recent.length - 1]!
    // A finger that stopped before lifting has no momentum.
    if (now - last.t > 50) return null
    // Too short a stretch to trust its speed (a twitch as a finger lifts).
    if (last.t - first.t < 20) return null
    const dt = last.t - first.t
    const vx = (last.x - first.x) / dt
    const vy = (last.y - first.y) / dt
    return Math.hypot(vx, vy) >= momentumMinSpeed ? { vx, vy } : null
  }

  const glide = ({ vx, vy }: { vx: number; vy: number }) => {
    let last = performance.now()
    const step = (now: number) => {
      // A frame's timestamp can precede the release that started the glide.
      const dt = Math.max(0, Math.min(64, now - last))
      last = now
      const decay = Math.exp(-dt / momentumDecayMs)
      // Distance covered over this step under exponential decay.
      const travel = momentumDecayMs * (1 - decay)
      target.pan(vx * travel, vy * travel)
      vx *= decay
      vy *= decay
      if (Math.hypot(vx, vy) < 0.02) {
        momentum = 0
        finish()
        return
      }
      momentum = requestAnimationFrame(step)
    }
    momentum = requestAnimationFrame(step)
  }

  const onWheel = (event: WheelEvent) => {
    event.preventDefault()
    stopMomentum()
    // Measured once per wheel gesture: reading layout on every event can force it.
    if (!wheeling) measure()
    wheeling = true
    const point = local(event.clientX, event.clientY)
    // Lines and pages (mouse wheels on some systems) into pixels.
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
    if (event.ctrlKey || event.metaKey) {
      // Safari's gesture events already zoom this pinch.
      if (!gestureScale) {
        begin('zoom')
        // At most about 1.3× per event: a mouse wheel notch (deltaY 100) would otherwise jump 2.7×.
        target.zoom(point, Math.exp(Math.max(-0.25, Math.min(0.25, -event.deltaY * unit * wheelZoomSpeed))))
      }
    } else {
      begin('pan')
      target.pan(-event.deltaX * unit, -event.deltaY * unit)
    }
    clearTimeout(wheelTimer)
    wheelTimer = setTimeout(() => {
      wheeling = false
      if (pointers.size === 0 && !momentum && !gestureScale) finish()
    }, WHEEL_END_MS)
  }

  // Safari (trackpad pinch on macOS; on iOS alongside pointer events, which win while two fingers are down).
  const onGestureStart = (event: Event) => {
    event.preventDefault()
    // Fingers on the screen (iOS): pointer events carry the pinch. Safari's gesture events zoom
    // only a trackpad pinch (macOS), which has no pointers down.
    if (pointers.size > 0) return
    stopMomentum()
    measure()
    gestureScale = 1
    begin('zoom')
  }
  const onGestureChange = (event: Event) => {
    event.preventDefault()
    if (pointers.size > 0 || !gestureScale) return
    const e = event as GestureEvent
    if (!e.scale) return
    begin('zoom')
    target.zoom(local(e.clientX, e.clientY), e.scale / gestureScale)
    gestureScale = e.scale
  }
  const onGestureEnd = (event: Event) => {
    event.preventDefault()
    if (!gestureScale) return
    gestureScale = 0
    if (pointers.size === 0 && !wheeling && !momentum) finish()
  }

  // A press that turned into a drag or pinch doesn't click what it started on.
  const onClick = (event: MouseEvent) => {
    // Keyboard clicks (Enter or Space on a focused tile) are never a gesture's.
    if (!cancelClick || event.detail === 0) return
    // Fingers still down: the gesture isn't over, so later clicks are its too.
    if (pointers.size === 0) cancelClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  // Ends are heard on the window: a press that leaves the element before it becomes a drag (and
  // so before capture) still ends there.
  window.addEventListener('pointerup', onPointerEnd, true)
  window.addEventListener('pointercancel', onPointerEnd, true)
  element.addEventListener('wheel', onWheel, { passive: false })
  element.addEventListener('gesturestart', onGestureStart)
  element.addEventListener('gesturechange', onGestureChange)
  element.addEventListener('gestureend', onGestureEnd)
  element.addEventListener('click', onClick, true)

  return () => {
    stopMomentum()
    clearTimeout(wheelTimer)
    element.removeEventListener('pointerdown', onPointerDown)
    element.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerEnd, true)
    window.removeEventListener('pointercancel', onPointerEnd, true)
    element.removeEventListener('wheel', onWheel)
    element.removeEventListener('gesturestart', onGestureStart)
    element.removeEventListener('gesturechange', onGestureChange)
    element.removeEventListener('gestureend', onGestureEnd)
    element.removeEventListener('click', onClick, true)
  }
}
