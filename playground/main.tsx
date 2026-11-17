import { createRef, StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { GallyCanvas, GallyHybridCanvas, type GallyCanvasHandle, type GallyCanvasPhoto, type GallyLibraryHandle } from '../src/react/index.js'
import '../styles/gally.css'
import { BenchPanel, type BenchSubject } from './bench/BenchPanel'
import { runCanvasBenchmark } from './bench/canvas-run'
import { runBenchmark } from './bench/run'
import { config, MOUNT_MARK, type Renderer } from './config'
import { FpsMeter } from './FpsMeter'
import { createLibrary, sourcesFor } from './library/library'
import { LibraryView } from './library/LibraryView'
import './playground.css'

/** The canvases' photos: benchmark fixtures when deployed (or `?images=local`), else picsum. */
const photos: GallyCanvasPhoto[] = createLibrary(160).map((photo) => ({
  id: photo.id,
  width: photo.width,
  height: photo.height,
  sources: sourcesFor(photo),
  alt: `Sample photo ${photo.index + 1}`,
}))

const RENDERERS: Array<{ value: Renderer; label: string }> = [
  { value: 'stable', label: 'GallyCanvas' },
  { value: 'hybrid', label: 'GallyHybridCanvas' },
  { value: 'photos', label: 'GallyLibrary' },
]

/** The library and the canvases, which the benchmark drives. */
const libraryRef = createRef<GallyLibraryHandle>()
const canvasRef = createRef<GallyCanvasHandle>()

const librarySubject: BenchSubject = {
  ready: () => Boolean(libraryRef.current),
  run: () => runBenchmark(libraryRef.current!),
  live: () => {
    const s = libraryRef.current?.getStats()
    return s ? { state: `L${s.level} ${s.mode}`, sharp: s.sharpTiles, tiles: s.visibleTiles, loading: `${s.loader.inFlight} loading · ${s.loader.queued} queued` } : null
  },
}

/** The last photo tapped or clicked, on the root element, for `scripts/check-gestures.mjs`. */
const onSelectPhoto = ({ id }: { id: string }) => {
  document.documentElement.dataset.gallySelected = id
}

const canvasSubject: BenchSubject = {
  ready: () => Boolean(canvasRef.current?.getElement()),
  run: () => runCanvasBenchmark(canvasRef.current!),
  live: () => {
    const s = canvasRef.current?.getStats()
    return s
      ? { state: `zoom ${s.zoom.toFixed(2)} ${s.layer}`, sharp: s.sharpTiles, tiles: s.visibleTiles, loading: `${s.loader.inFlight} loading · ${s.loader.queued} queued` }
      : null
  },
}

/** Marks when the canvas first renders: benchmark timings start there, as images start loading. */
function MountMark() {
  useState(() => performance.mark(MOUNT_MARK))
  return null
}

function Playground() {
  const [renderer, setRenderer] = useState<Renderer>(config.renderer)

  const select = (next: Renderer) => {
    setRenderer(next)
    const url = new URL(location.href)
    url.searchParams.set('renderer', next)
    history.replaceState(null, '', url)
  }

  return (
    <>
      {renderer === 'photos' ? (
        <LibraryView libraryRef={libraryRef} />
      ) : (
        <>
          <MountMark key={`mount-${renderer}`} />
          {renderer === 'hybrid' ? (
            <GallyHybridCanvas key="hybrid" ref={canvasRef} photos={photos} theme={{ background: 'dotted' }} onSelectPhoto={onSelectPhoto} />
          ) : (
            <GallyCanvas key="stable" ref={canvasRef} photos={photos} theme={{ background: 'dotted' }} onSelectPhoto={onSelectPhoto} />
          )}
        </>
      )}
      {config.bench ? <BenchPanel key={renderer} subject={renderer === 'photos' ? librarySubject : canvasSubject} /> : config.fps && <FpsMeter />}
      <div className="playground-switch" role="group" aria-label="Renderer">
        {RENDERERS.map((option) => (
          <button key={option.value} type="button" aria-pressed={renderer === option.value} onClick={() => select(option.value)}>
            {option.label}
          </button>
        ))}
      </div>
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Playground />
  </StrictMode>,
)
