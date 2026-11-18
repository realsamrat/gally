import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

/** The primary pointer is a finger: demos open full screen instead of taking gestures inline. */
export function useCoarsePointer() {
  const [coarse, setCoarse] = useState(() => matchMedia('(pointer: coarse)').matches)
  useEffect(() => {
    const query = matchMedia('(pointer: coarse)')
    const update = () => setCoarse(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return coarse
}

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

/** True once the element has come near the screen, and (unless `once`) false again when it leaves. */
export function useNearScreen<T extends Element>(margin = '25% 0px', once = false) {
  const ref = useRef<T>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return
        if (entry.isIntersecting) {
          setNear(true)
          if (once) observer.disconnect()
        } else if (!once) setNear(false)
      },
      { rootMargin: margin },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [margin, once])
  return [ref, near] as const
}

/** Fades a block up as it first comes on screen. */
export function Reveal({ children, as: Tag = 'div', className, delay = 0 }: { children: ReactNode; as?: 'div' | 'section' | 'header' | 'footer'; className?: string; delay?: number }) {
  const [ref, seen] = useNearScreen<HTMLElement>('0px 0px -8% 0px', true)
  return (
    <Tag
      ref={ref as never}
      className={['reveal', className].filter(Boolean).join(' ')}
      data-seen={seen ? '' : undefined}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </Tag>
  )
}

/**
 * A scrubber drawn as a ruler: its name, tick marks that light up around a playhead, and its value.
 * Positions run 0 to 1; the caller maps them to its own scale. A real range input sits over the
 * track, so it drags, takes arrow keys and reads to assistive tech like any slider.
 */
export function Ruler({
  label,
  value,
  text,
  chars,
  onChange,
  steps,
  split,
  live = false,
}: {
  label: string
  value: number
  /** The value as shown and read out, e.g. "1.20×". */
  text: string
  /** Room for the longest value, in digits, when it's more than five: the track mustn't resize as the value changes. */
  chars?: number
  onChange: (value: number) => void
  /** A discrete ruler with this many stops, instead of a continuous one. */
  steps?: number
  /** Where the ticks change from canvas (left) to elements (right), 0 to 1. */
  split?: number
  /** The value also changes by itself (someone pinching), so the playhead glides between readings. */
  live?: boolean
}) {
  const p = Math.max(0, Math.min(1, value))
  const ticks = useMemo(() => {
    const count = steps ?? 41
    return Array.from({ length: count }, (_, index) => (
      <i key={index} data-major={steps || index % 10 === 0 ? '' : undefined} data-zone={split === undefined ? undefined : index / (count - 1) < split ? 'canvas' : 'dom'} />
    ))
  }, [steps, split])
  return (
    <div
      className="ruler"
      data-live={live ? '' : undefined}
      data-steps={steps ? '' : undefined}
      style={{ '--p': p, ...(chars === undefined ? {} : { '--chars': chars }) } as React.CSSProperties}
    >
      <span>{label}</span>
      <div className="ruler__track">
        <div className="ruler__ticks" aria-hidden="true">
          {ticks}
        </div>
        {/* The same ticks again, bright, showing only around the playhead. */}
        <div className="ruler__ticks" data-lit="" aria-hidden="true">
          {ticks}
        </div>
        <i className="ruler__head" aria-hidden="true" />
        <input
          type="range"
          aria-label={label}
          aria-valuetext={text}
          min={0}
          max={1}
          step={steps ? 1 / (steps - 1) : 0.001}
          value={p}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      <span className="ruler__value">{text}</span>
    </div>
  )
}

export type Choice = { label: string; pressed?: boolean; onPress(): void }

/**
 * A named choice in one card: the label on the left, the options on the right, and a thumb that
 * slides to whichever is pressed.
 */
export function Option({ label, options }: { label: string; options: Choice[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)
  const [settled, setSettled] = useState(false)
  const pressed = options.findIndex((option) => option.pressed)
  const names = options.map((option) => option.label).join('|')
  useLayoutEffect(() => {
    const row = ref.current
    if (!row) return
    const measure = () => {
      const button = row.querySelectorAll('button')[pressed]
      setThumb(button ? { left: button.offsetLeft, width: button.offsetWidth } : null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [pressed, names])
  // The thumb is placed before it starts sliding, so it doesn't fly in on first paint.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setSettled(true))
    return () => cancelAnimationFrame(frame)
  }, [])
  return (
    <div className="option" role="group" aria-label={label}>
      <span>{label}</span>
      <hr />
      <div ref={ref}>
        {thumb && <i data-settled={settled ? '' : undefined} style={{ width: thumb.width, transform: `translateX(${thumb.left}px)` }} />}
        {options.map((option) => (
          <button key={option.label} type="button" aria-pressed={option.pressed ?? false} onClick={option.onPress}>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export type Cell = { name: string; detail: string; on?: boolean; tone?: 'dom' | 'canvas'; swatch?: 'on' | 'near' | 'off' }

/** A row of small labelled cells: a legend, a set of counts, or which of several things is active. */
export function Cells({ cells, label }: { cells: Cell[]; label: string }) {
  return (
    <ul className="cells" aria-label={label}>
      {cells.map((cell) => (
        <li key={cell.detail} data-on={cell.on ? '' : undefined} data-tone={cell.tone}>
          {cell.swatch && <i data-swatch={cell.swatch} />}
          <b>{cell.name}</b>
          <span>{cell.detail}</span>
        </li>
      ))}
    </ul>
  )
}

export function CopyButton({ text, label, className, children }: { text: string; label: string; className?: string; children?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1400)
  }
  return (
    <button type="button" className={className} aria-label={copied ? 'Copied' : label} title={label} data-copied={copied ? '' : undefined} onClick={copy}>
      {children}
      <span className="swap" aria-hidden="true">
        <Icon name="copy" />
        <Icon name="check" />
      </span>
    </button>
  )
}

const PATHS = {
  bug: 'M9 8.5V7a3 3 0 0 1 6 0v1.5M8 12a4 4 0 0 1 8 0v3a4 4 0 0 1-8 0v-3ZM4.5 13H8m8 0h3.5M5.5 8.5 8 10.3m10.5-1.8L16 10.3M5.5 18.5 8 16.7m10.5 1.8L16 16.7M12 12v7',
  reset: 'M5 9a7.5 7.5 0 1 1-.4 5M5 4.5V9h4.5',
  expand: 'M14 5h5v5M10 19H5v-5M19 5l-6 6M5 19l6-6',
  close: 'M6 6l12 12M18 6 6 18',
  copy: 'M9 9h9.5a1.5 1.5 0 0 1 1.5 1.5V20a1.5 1.5 0 0 1-1.5 1.5H9A1.5 1.5 0 0 1 7.5 20v-9.5A1.5 1.5 0 0 1 9 9ZM16.5 6V4.5A1.5 1.5 0 0 0 15 3H5.5A1.5 1.5 0 0 0 4 4.5V14a1.5 1.5 0 0 0 1.5 1.5',
  check: 'M5 12.5 10 17.5 19.5 7',
  minus: 'M6 12h12',
  plus: 'M12 6v12M6 12h12',
  arrow: 'M7 17 17 7M9 7h8v8',
  collapse: 'M19 10h-5V5M5 14h5v5M14 10l6-6M10 14l-6 6',
  file: 'M13.5 3.5H8A1.5 1.5 0 0 0 6.5 5v14A1.5 1.5 0 0 0 8 20.5h8a1.5 1.5 0 0 0 1.5-1.5V7.5l-4-4ZM13.5 3.5v4h4M9.5 12h5M9.5 15.5h5',
} as const

export function Icon({ name }: { name: keyof typeof PATHS }) {
  return (
    <svg className="icon" data-icon={name} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}

export function GitHubIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M12 2.2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.08 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02a9.5 9.5 0 0 1 5 0c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.57 4.93.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2.2Z" />
    </svg>
  )
}
