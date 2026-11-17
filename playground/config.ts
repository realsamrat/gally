import networks from './networks.json'

/**
 * Everything the playground reads from its URL, in one place.
 *
 *   ?renderer=stable|hybrid|photos   which demo (the deployed site opens on photos)
 *   ?engine=hybrid|dom               GallyLibrary renderer in the library demo
 *   ?images=local|picsum             benchmark fixtures or picsum (deployed default: local)
 *   ?net=fast|4g|3g                  simulated network for local fixtures on the dev server
 *   ?bench=1|0  ?fps=0  ?autorun=1   benchmark panel, FPS meter, run the benchmark on load
 *   ?label=round-2                   tag saved benchmark runs, e.g. with an optimisation round
 *   ?probe=0                         benchmark without the idle probe (no capacity numbers), to
 *                                    check the probe against a performance trace
 *   ?input=touch|wheel               how a canvas benchmark moves the camera (default touch)
 *   ?debug=1                         library demo: a pinch indicator (level, columns, live scale,
 *                                    fingers, fps, a log of level changes) for screen recordings
 */

/** Networks the dev server simulates (see `vite.config.ts`). */
type SimulatedNetwork = keyof typeof networks
export const SIMULATED_NETWORKS = Object.keys(networks) as SimulatedNetwork[]
/** Where images come from: a simulated network, the deployed site's CDN, or picsum. */
export type ImageNetwork = SimulatedNetwork | 'cdn' | 'real'

export type Renderer = 'stable' | 'hybrid' | 'photos'

const params = new URLSearchParams(location.search)
const DEV = import.meta.env.DEV
const oneOf = <T extends string>(value: string | null, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback

const images = params.get('images') === 'local' || (!DEV && params.get('images') !== 'picsum') ? 'local' : 'picsum'

export const config = {
  renderer: oneOf<Renderer>(params.get('renderer'), ['stable', 'hybrid', 'photos'], DEV ? 'stable' : 'photos'),
  engine: params.get('engine') === 'dom' ? ('dom' as const) : ('hybrid' as const),
  images,
  net: (images === 'picsum' ? 'real' : DEV ? oneOf(params.get('net'), SIMULATED_NETWORKS, 'fast') : 'cdn') as ImageNetwork,
  bench: params.get('bench') === '1' || params.get('autorun') === '1' || (!DEV && params.get('bench') !== '0'),
  fps: params.get('fps') !== '0',
  autorun: params.get('autorun') === '1',
  label: params.get('label')?.slice(0, 40) ?? '',
  probe: params.get('probe') !== '0',
  input: params.get('input') === 'wheel' ? ('wheel' as const) : ('touch' as const),
  debug: params.get('debug') === '1',
}

/** The commit the playground was built from, with `+` when the working tree had changes. */
export const BUILD = __GALLY_BUILD__

/** Images go through the dev server's simulated network (not the CDN or picsum). */
export const simulatedNetwork = (SIMULATED_NETWORKS as string[]).includes(config.net)

/** Performance mark each demo sets when its component mounts; benchmark timings start there. */
export const MOUNT_MARK = 'gally-library-mount'

/** Set by the benchmark before it reloads the page for a measured run. */
const PENDING_RUN_KEY = 'gally-bench-autorun'

/** This page load is a measured benchmark run: images get fresh URLs so the browser cache is cold. */
export const benchRunPending = sessionStorage.getItem(PENDING_RUN_KEY) === '1'

export function setBenchRunPending(pending: boolean) {
  if (pending) sessionStorage.setItem(PENDING_RUN_KEY, '1')
  else sessionStorage.removeItem(PENDING_RUN_KEY)
}

/** Reload with one URL parameter changed. */
export function reloadWithParam(key: string, value: string) {
  const url = new URL(location.href)
  url.searchParams.set(key, value)
  location.href = url.toString()
}
