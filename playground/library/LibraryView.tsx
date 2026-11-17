import { useEffect, useLayoutEffect, useMemo, useState, type RefObject } from 'react'
import { GallyImageLoader } from '../../src/index.js'
import { GallyLibrary, type GallyCanvasPhoto, type GallyLibraryFit, type GallyLibraryHandle } from '../../src/react/index.js'
import { config, MOUNT_MARK } from '../config'
import { createLibrary, loadPreviews, previewFor, SOURCE_SIZES, sourcesFor } from './library'
import { PinchDebug, usePinchDebug } from './PinchDebug'
import './library.css'

/*
 * The playground's photo library: `GallyLibrary` filling the page, with zoom and fit buttons.
 * Everything a photo library needs (layout, zoom levels, pinch, rendering, image loading) is the
 * component's; this file only passes it photos and wires the benchmark's handle.
 */

const DEFAULT_LEVEL = 1
/** Use each image size up to 10% past its short edge. */
const LOD = {
  thumbMaxScreenWidth: SOURCE_SIZES.thumb * 1.1,
  smallMaxScreenWidth: SOURCE_SIZES.small * 1.1,
  mediumMaxScreenWidth: SOURCE_SIZES.medium * 1.1,
}

/**
 * One loader for the demo, in blob mode: the images are same-origin (or CORS-enabled picsum), so
 * the loader can fetch them with real network priorities, cancel ones that scroll away, and make
 * canvas bitmaps off the main thread.
 */
const libraryLoader = new GallyImageLoader({ mode: 'blob' })

/** Waits for the photo previews, as an app waits for its photo metadata, then shows the library. */
export function LibraryView({ libraryRef }: { libraryRef: RefObject<GallyLibraryHandle | null> }) {
  const [previews, setPreviews] = useState<string[] | null>(null)
  useEffect(() => {
    void loadPreviews().then(setPreviews)
  }, [])
  return previews ? <Library libraryRef={libraryRef} previews={previews} /> : null
}

function Library({ libraryRef, previews }: { libraryRef: RefObject<GallyLibraryHandle | null>; previews: string[] }) {
  const photos = useMemo<GallyCanvasPhoto[]>(
    () =>
      createLibrary(1200).map((photo) => {
        const placeholder = previewFor(previews, photo)
        return {
          id: photo.id,
          width: photo.width,
          height: photo.height,
          alt: `Photo ${photo.index + 1}`,
          sources: sourcesFor(photo),
          ...(placeholder ? { placeholder } : {}),
        }
      }),
    [previews],
  )
  const [fit, setFit] = useState<GallyLibraryFit>('square')
  const [selected, setSelected] = useState<number | null>(null)
  const pinchDebug = usePinchDebug()

  // Benchmark timings start when the library mounts.
  useLayoutEffect(() => {
    performance.mark(MOUNT_MARK)
  }, [])

  useEffect(() => libraryRef.current?.focus(), [libraryRef])

  // ⌘+ / ⌘− zoom the library from anywhere on the page, not only when it has focus.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return
      if (event.key === '=' || event.key === '+') {
        event.preventDefault()
        libraryRef.current?.zoomIn()
      } else if (event.key === '-') {
        event.preventDefault()
        libraryRef.current?.zoomOut()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [libraryRef])

  return (
    <div className="library-view">
      <GallyLibrary
        ref={libraryRef}
        photos={photos}
        fit={fit}
        defaultLevel={DEFAULT_LEVEL}
        standardLevel={DEFAULT_LEVEL}
        {...(config.debug && { onPinch: pinchDebug.onPinch })}
        initialScroll="end"
        selectedIndex={selected}
        onSelectedIndexChange={setSelected}
        loader={libraryLoader}
        renderer={config.engine}
        lod={LOD}
        aria-label="Photo library"
      />
      <div className="library-view__tools" role="group" aria-label="Library">
        <button type="button" aria-label="Zoom out" onClick={() => libraryRef.current?.zoomOut()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9" />
          </svg>
        </button>
        <button type="button" aria-label="Zoom in" onClick={() => libraryRef.current?.zoomIn()}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3.5 8h9M8 3.5v9" />
          </svg>
        </button>
        <button
          type="button"
          aria-label={fit === 'square' ? 'Show aspect ratio grid' : 'Show square grid'}
          aria-pressed={fit === 'aspect'}
          onClick={() => setFit((value) => (value === 'square' ? 'aspect' : 'square'))}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            {fit === 'square' ? <rect x="3" y="3" width="10" height="10" rx="1.5" /> : <rect x="2" y="4.5" width="12" height="7" rx="1.5" />}
          </svg>
        </button>
      </div>
      {config.debug && <PinchDebug listeners={pinchDebug.listeners} />}
    </div>
  )
}
