// Benchmark run history in a private Vercel Blob store, one JSON file per run. See `_runs.js`.
import { get, list, put } from '@vercel/blob'
import { parseRun, RUNS_PAGE_SIZE } from './_runs.js'

// Pathnames sort newest first: the timestamp is inverted.
const keyFor = (run) => `runs/${String(1e13 - Date.parse(run.at)).padStart(13, '0')}-${run.id}.json`

export async function GET(request) {
  const cursor = new URL(request.url).searchParams.get('cursor') || undefined
  const page = await list({ prefix: 'runs/', limit: RUNS_PAGE_SIZE, ...(cursor ? { cursor } : {}) })
  const runs = await Promise.all(
    page.blobs.map(async (blob) => {
      // One unreadable run shouldn't hide the rest.
      try {
        const file = await get(blob.pathname, { access: 'private' })
        return file?.stream ? JSON.parse(await new Response(file.stream).text()) : null
      } catch {
        return null
      }
    }),
  )
  return Response.json(
    { runs: runs.filter(Boolean), cursor: page.hasMore ? page.cursor : null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function POST(request) {
  const { run, status, error } = parseRun(await request.text())
  if (!run) return Response.json({ error }, { status })
  await put(keyFor(run), JSON.stringify(run), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' })
  return Response.json({ ok: true }, { status: 201 })
}
