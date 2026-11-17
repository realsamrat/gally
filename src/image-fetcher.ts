/**
 * Fetching and decoding for the image loader's blob mode, off the main thread when possible.
 *
 * A screenful of thumbnails arriving at once is hundreds of fetches, blobs and decodes. On the main
 * thread each costs a few small tasks, and together they fill the frames of a pinch. In a worker
 * they cost the main thread one batched message per few milliseconds instead.
 */

export type FetchedImage = {
  blob: Blob
  width: number
  height: number
  /** The decoded image, kept when its short edge is at most the requested `keepEdge`. */
  bitmap?: ImageBitmap | undefined
  bytes: number
  /** `nextHopProtocol` from the request's resource timing, when the browser exposes it. */
  protocol?: string | undefined
  /**
   * An object URL for the blob made in the worker, sparing the main thread that synchronous call
   * into the browser. `revoke` releases it.
   */
  url?: string | undefined
  revoke?: (() => void) | undefined
}

export type FetchJob = {
  promise: Promise<FetchedImage>
  /** Cancels the request if no bytes have arrived yet; the promise then rejects with `FetchAborted`. */
  cancel(): void
}

export class FetchAborted extends Error {}

/**
 * The request never got a response: blocked (a cross-origin image without CORS) or a network
 * failure. An HTTP error status is a response, and isn't this.
 */
export class FetchBlocked extends Error {}

/** The worker failed to start; its jobs run on the main thread instead. */
class WorkerUnavailable extends Error {}

export type ImageFetcher = {
  fetch(src: string, priority: 'high' | 'low', keepEdge: number): FetchJob
  /** A bitmap of a fetched blob resized to `width` × `height`, for canvas renderers. */
  bitmap(blob: Blob, width: number, height: number): Promise<ImageBitmap>
}

/** Resizing reads the blob's bytes; from the main thread that is a stream of small tasks per image. */
const resizeBitmap = (blob: Blob, width: number, height: number) =>
  createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' }).catch(() => createImageBitmap(blob))

/** Decodes a blob on the main thread's side, keeping the bitmap when it is small (the worker has its own copy). */
async function decode(blob: Blob, keepEdge: number): Promise<{ width: number; height: number; bitmap: ImageBitmap | undefined }> {
  if (typeof createImageBitmap !== 'function') {
    // Old browsers: an image element finds the size; elements made later decode it again.
    const image = new Image()
    const url = URL.createObjectURL(blob)
    image.src = url
    try {
      await image.decode()
      return { width: image.naturalWidth, height: image.naturalHeight, bitmap: undefined }
    } finally {
      URL.revokeObjectURL(url)
    }
  }
  const bitmap = await createImageBitmap(blob)
  const { width, height } = bitmap
  if (Math.min(width, height) <= keepEdge) return { width, height, bitmap }
  bitmap.close()
  return { width, height, bitmap: undefined }
}

/** The worker: fetches, decodes, and posts results in batches. Runs as its own script, so it must be self-contained. */
function workerMain() {
  type Job = { controller: AbortController; responding: boolean }
  const jobs = new Map<number, Job>()
  let batch: Array<{ result: unknown; transfer: Transferable[] }> = []
  let flushTimer: ReturnType<typeof setTimeout> | 0 = 0
  const post = (result: unknown, transfer: Transferable[] = []) => {
    batch.push({ result, transfer })
    // A few milliseconds of results per message: one main-thread task instead of one per image.
    flushTimer ||= setTimeout(() => {
      flushTimer = 0
      const sent = batch
      batch = []
      ;(self as unknown as Worker).postMessage(
        sent.map((item) => item.result),
        sent.flatMap((item) => item.transfer),
      )
    }, 4)
  }
  self.onmessage = async (event: MessageEvent) => {
    const message = event.data as
      | { type: 'fetch'; id: number; src: string; priority: string; keepEdge: number }
      | { type: 'bitmap'; id: number; blob: Blob; width: number; height: number }
      | { type: 'cancel'; id: number }
      | { type: 'revoke'; url: string }
    if (message.type === 'bitmap') {
      const { id, blob, width, height } = message
      try {
        const bitmap = await createImageBitmap(blob, { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' }).catch(() =>
          createImageBitmap(blob),
        )
        post({ id, bitmap }, [bitmap])
      } catch {
        post({ id, error: true, unsupported: typeof createImageBitmap !== 'function' })
      }
      return
    }
    if (message.type === 'revoke') {
      URL.revokeObjectURL(message.url)
      return
    }
    if (message.type === 'cancel') {
      const job = jobs.get(message.id)
      if (job && !job.responding) job.controller.abort()
      return
    }
    const { id, src, priority, keepEdge } = message
    const job: Job = { controller: new AbortController(), responding: false }
    jobs.set(id, job)
    let blocked = false
    try {
      const response = await fetch(src, { signal: job.controller.signal, priority } as RequestInit).catch((error: unknown) => {
        blocked = true
        throw error
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      job.responding = true
      const blob = await response.blob()
      const bitmap = await createImageBitmap(blob)
      const { width, height } = bitmap
      const keep = Math.min(width, height) <= keepEdge
      if (!keep) bitmap.close()
      const timing = performance.getEntriesByName(src).at(-1) as PerformanceResourceTiming | undefined
      // Inline images render from their data URL.
      const url = src.startsWith('data:') ? undefined : URL.createObjectURL(blob)
      post({ id, blob, url, width, height, bitmap: keep ? bitmap : undefined, bytes: blob.size, protocol: timing?.nextHopProtocol || undefined }, keep ? [bitmap] : [])
    } catch {
      // Workers without `createImageBitmap` say so, and the page fetches on the main thread instead.
      post({ id, error: true, aborted: job.controller.signal.aborted, blocked, unsupported: typeof createImageBitmap !== 'function' })
    } finally {
      jobs.delete(id)
    }
    // Resource timings would otherwise fill the worker's buffer and stop protocol detection.
    if (performance.getEntriesByType('resource').length > 200) performance.clearResourceTimings()
  }
}

/** Fetches and decodes on the main thread: the fallback where workers are unavailable. */
export const mainThreadFetcher: ImageFetcher = {
  fetch(src, priority, keepEdge) {
    const controller = new AbortController()
    let responding = false
    const promise = (async () => {
      try {
        const response = await fetch(src, { signal: controller.signal, priority } as RequestInit).catch((error: unknown) => {
          throw controller.signal.aborted ? new FetchAborted() : new FetchBlocked(String(error))
        })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        responding = true
        const blob = await response.blob()
        return { blob, bytes: blob.size, ...(await decode(blob, keepEdge)) }
      } catch (error) {
        throw controller.signal.aborted ? new FetchAborted() : error
      }
    })()
    return {
      promise,
      cancel: () => {
        if (!responding) controller.abort()
      },
    }
  },
  bitmap: resizeBitmap,
}

export { decode as decodeImageBlob }

/**
 * A worker fetcher, or undefined where one can't start (no workers or `createImageBitmap` in
 * workers, or a content security policy that blocks blob: workers).
 */
export function createWorkerFetcher(): ImageFetcher | undefined {
  if (typeof Worker !== 'function' || typeof Blob !== 'function' || typeof URL.createObjectURL !== 'function') return undefined
  let worker: Worker
  try {
    const url = URL.createObjectURL(new Blob([`(${workerMain.toString()})()`], { type: 'text/javascript' }))
    worker = new Worker(url)
    URL.revokeObjectURL(url)
  } catch {
    return undefined
  }
  // Fetch jobs resolve with a fetched image, bitmap jobs with `{ bitmap }`.
  const pending = new Map<number, { resolve: (result: never) => void; reject: (error: unknown) => void }>()
  let nextId = 1
  let broken = false
  worker.onmessage = (event: MessageEvent) => {
    for (const result of event.data as Array<FetchedImage & { id: number; error?: boolean; aborted?: boolean; blocked?: boolean; unsupported?: boolean }>) {
      const job = pending.get(result.id)
      if (!job) continue
      pending.delete(result.id)
      if (result.unsupported) broken = true
      if (result.error)
        job.reject(
          result.aborted ? new FetchAborted() : result.unsupported ? new WorkerUnavailable() : result.blocked ? new FetchBlocked('Image request blocked') : new Error('Image failed'),
        )
      else {
        const url = result.url
        job.resolve({ ...result, revoke: url ? () => worker.postMessage({ type: 'revoke', url }) : undefined } as never)
      }
    }
  }
  // A worker that fails to start (e.g. blocked by CSP) or can't decode fails its jobs with
  // `WorkerUnavailable`; each job then runs on the main thread, and later ones start there.
  worker.onerror = () => {
    broken = true
    for (const job of pending.values()) job.reject(new WorkerUnavailable())
    pending.clear()
  }
  return {
    fetch(src, priority, keepEdge) {
      if (broken) return mainThreadFetcher.fetch(src, priority, keepEdge)
      const id = nextId++
      let fallback: FetchJob | undefined
      const promise = new Promise<FetchedImage>((resolve, reject) => pending.set(id, { resolve: resolve as (result: never) => void, reject })).catch((error) => {
        if (!(error instanceof WorkerUnavailable)) throw error
        fallback = mainThreadFetcher.fetch(src, priority, keepEdge)
        return fallback.promise
      })
      // Workers resolve relative URLs against their own (blob:) URL, so send absolute ones.
      worker.postMessage({ type: 'fetch', id, src: new URL(src, location.href).href, priority, keepEdge })
      return {
        promise,
        cancel: () => (fallback ? fallback.cancel() : worker.postMessage({ type: 'cancel', id })),
      }
    },
    bitmap(blob, width, height) {
      if (broken) return resizeBitmap(blob, width, height)
      const id = nextId++
      const promise = new Promise<{ bitmap: ImageBitmap }>((resolve, reject) => pending.set(id, { resolve: resolve as (result: never) => void, reject }))
      worker.postMessage({ type: 'bitmap', id, blob, width, height })
      return promise.then(
        ({ bitmap }) => bitmap,
        (error) => {
          if (error instanceof WorkerUnavailable) return resizeBitmap(blob, width, height)
          throw error
        },
      )
    },
  }
}
