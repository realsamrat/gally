// Downloads the sample photos once into public/fixtures (gitignored), for the demo site and the
// playground, so benchmarks measure Gally rather than a remote image service. Each photo is saved in three sizes that match
// Gally's thumb / small / medium sources (a typical srcset ladder), and the manifest carries a
// ~24 px inline preview per photo for blur-up placeholders.
//
// Count, sizes and aspect ratios come from fixtures.json, which the site and the playground read too.
//
//   npm run fixtures
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const spec = JSON.parse(await readFile(join(process.cwd(), 'fixtures.json'), 'utf8'))
const { count: COUNT, sizes: SIZES, previewSize: PREVIEW, ratios: RATIOS } = spec
const OUT = join(process.cwd(), 'public/fixtures')
const CONCURRENCY = 12

await mkdir(OUT, { recursive: true })

const jobs = []
for (let i = 0; i < COUNT; i++) {
  const [w, h] = RATIOS[i % RATIOS.length]
  for (const [key, short] of Object.entries(SIZES)) {
    const width = w >= h ? Math.round((short * w) / h) : short
    const height = w >= h ? short : Math.round((short * h) / w)
    // WebP: what a modern photo CDN serves; about a third smaller than JPEG at the same quality.
    jobs.push({ file: join(OUT, `${i}-${key}.webp`), url: `https://picsum.photos/seed/gally-bench-${i}/${width}/${height}.webp` })
  }
}

let done = 0
let next = 0
async function worker() {
  while (next < jobs.length) {
    const job = jobs[next++]
    try {
      await access(job.file)
    } catch {
      const response = await fetch(job.url)
      if (!response.ok) throw new Error(`${response.status} for ${job.url}`)
      await writeFile(job.file, Buffer.from(await response.arrayBuffer()))
    }
    done++
    if (done % 60 === 0 || done === jobs.length) process.stdout.write(`\r${done}/${jobs.length} images`)
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker))

// Inline previews: tiny JPEGs as data URLs.
const previews = new Array(COUNT)
let nextPreview = 0
async function previewWorker() {
  while (nextPreview < COUNT) {
    const i = nextPreview++
    const [w, h] = RATIOS[i % RATIOS.length]
    const width = w >= h ? Math.round((PREVIEW * w) / h) : PREVIEW
    const height = w >= h ? PREVIEW : Math.round((PREVIEW * h) / w)
    const response = await fetch(`https://picsum.photos/seed/gally-bench-${i}/${width}/${height}`)
    if (!response.ok) throw new Error(`${response.status} for preview ${i}`)
    previews[i] = `data:image/jpeg;base64,${Buffer.from(await response.arrayBuffer()).toString('base64')}`
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, previewWorker))
await writeFile(join(OUT, 'manifest.json'), JSON.stringify({ previews }))
process.stdout.write(`\nSaved ${COUNT} photos to ${OUT}\n`)
