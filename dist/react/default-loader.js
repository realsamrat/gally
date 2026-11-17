import { GallyImageLoader } from '../image-loader.js';
let shared;
/**
 * The loader canvases use when none is passed: one blob-mode loader for the page, so canvases
 * share one cache and one worker however often they mount, rather than leaving a worker behind
 * each time.
 */
export function defaultCanvasLoader() {
    return (shared ??= new GallyImageLoader({ mode: 'blob' }));
}
//# sourceMappingURL=default-loader.js.map