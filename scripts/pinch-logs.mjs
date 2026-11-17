// Pinch recordings from the playground's `?debug=1` indicator (see playground/functions/api/_pinch-logs.js).
//
//   npm run pinch-logs                       recent sessions on the deployed site
//   npm run pinch-logs -- <id>               one session: every pinch, its level changes and input
//   npm run pinch-logs -- <id> --json        the raw session
//   npm run pinch-logs -- --url http://localhost:4317
import { parseArgs } from 'node:util'

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: 'string', default: 'https://gally-playground.vercel.app' }, json: { type: 'boolean', default: false } },
})
const [id] = positionals
const response = await fetch(`${args.url}/api/pinch-logs${id ? `?id=${encodeURIComponent(id)}` : ''}`)
if (!response.ok) throw new Error(`HTTP ${response.status}`)
const body = await response.json()

if (!id) {
  for (const s of body.sessions) {
    const loops = s.loops ? ` · ${s.loops} loops` : ''
    console.log(`${s.id}  ${s.at}  ${s.tester ?? '?'}  ${s.device.viewport} @${s.device.dpr}  ${s.pinches} pinches · ${s.commits} level changes${loops} · ${s.events} events  ${s.build}`)
    console.log(`  ${s.device.userAgent}`)
  }
  process.exit(0)
}
if (args.json) {
  console.log(JSON.stringify(body, null, 2))
  process.exit(0)
}

console.log(`${body.id}  ${body.at}  ${body.tester ?? '?'}  ${body.device.viewport} @${body.device.dpr}  ${body.build}\n${body.device.userAgent}\n`)
let pinch = null
for (const event of body.events) {
  const [t, phase, level, columns, scale, fingers] = event
  // Newer sessions record the scroll position seventh, before the summary.
  const scrollTop = typeof event[6] === 'number' ? event[6] : undefined
  // Newer still: the fingers' zoom since the pinch began, eighth.
  const zoom = typeof event[7] === 'number' ? ` fingers ×${event[7].toFixed(2)}` : ''
  const summary = event.find((value) => typeof value === 'object' && value !== null)
  const scrolled = scrollTop === undefined ? '' : ` @${Math.round(scrollTop)}px`
  const at = `${(t / 1000).toFixed(2)}s`.padStart(9)
  if (phase === 'start') {
    pinch = { t, levels: [`L${level}(${columns})`] }
    console.log(`${at} start L${level} (${columns} cols), ${fingers} fingers${scrolled}`)
  } else if (phase === 'commit') {
    console.log(`${at}   → L${level} (${columns} cols)${scrolled}${zoom}`)
    pinch?.levels.push(`L${level}(${columns})`)
  } else if (phase === 'end') {
    const s = summary ?? {}
    console.log(
      `${at} end   L${level} (${columns} cols)${scrolled} after ${pinch ? ((t - pinch.t) / 1000).toFixed(2) : '?'}s · scale ×${s.min?.toFixed?.(2)}–${s.max?.toFixed?.(2)} · ${s.moves} touch moves, ${s.gestures} Safari gestures, ${s.cancels} cancels · ${s.fps} fps${s.loops ? ` · ${s.loops} LOOP` : ''}`,
    )
    // Two levels back and forth within one pinch.
    const path = pinch?.levels ?? []
    for (let i = 2; i < path.length; i++) if (path[i] === path[i - 2] && path[i - 1] !== path[i]) console.log(`          ⚠ back and forth: ${path.join(' → ')}`)
    pinch = null
  }
}
