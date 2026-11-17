/**
 * Fetching and decoding for the image loader's blob mode, off the main thread when possible.
 *
 * A screenful of thumbnails arriving at once is hundreds of fetches, blobs and decodes. On the main
 * thread each costs a few small tasks, and together they fill the frames of a pinch. In a worker
 * they cost the main thread one batched message per few milliseconds instead.
 */
export type FetchedImage = {
    blob: Blob;
    width: number;
    height: number;
    /** The decoded image, kept when its short edge is at most the requested `keepEdge`. */
    bitmap?: ImageBitmap | undefined;
    bytes: number;
    /** `nextHopProtocol` from the request's resource timing, when the browser exposes it. */
    protocol?: string | undefined;
    /**
     * An object URL for the blob made in the worker, sparing the main thread that synchronous call
     * into the browser. `revoke` releases it.
     */
    url?: string | undefined;
    revoke?: (() => void) | undefined;
};
export type FetchJob = {
    promise: Promise<FetchedImage>;
    /** Cancels the request if no bytes have arrived yet; the promise then rejects with `FetchAborted`. */
    cancel(): void;
};
export declare class FetchAborted extends Error {
}
/**
 * The request never got a response: blocked (a cross-origin image without CORS) or a network
 * failure. An HTTP error status is a response, and isn't this.
 */
export declare class FetchBlocked extends Error {
}
export type ImageFetcher = {
    fetch(src: string, priority: 'high' | 'low', keepEdge: number): FetchJob;
    /** A bitmap of a fetched blob resized to `width` × `height`, for canvas renderers. */
    bitmap(blob: Blob, width: number, height: number): Promise<ImageBitmap>;
};
/** Decodes a blob on the main thread's side, keeping the bitmap when it is small (the worker has its own copy). */
declare function decode(blob: Blob, keepEdge: number): Promise<{
    width: number;
    height: number;
    bitmap: ImageBitmap | undefined;
}>;
/** Fetches and decodes on the main thread: the fallback where workers are unavailable. */
export declare const mainThreadFetcher: ImageFetcher;
export { decode as decodeImageBlob };
/**
 * A worker fetcher, or undefined where one can't start (no workers or `createImageBitmap` in
 * workers, or a content security policy that blocks blob: workers).
 */
export declare function createWorkerFetcher(): ImageFetcher | undefined;
//# sourceMappingURL=image-fetcher.d.ts.map