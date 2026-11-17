// Pinch recordings in the private Vercel Blob store, one JSON file per session. See `_pinch-logs.js`.
import { get, list, put } from '@vercel/blob'
import { parsePinchLog, pinchLogKey, PINCH_LOGS_PAGE_SIZE, summarize } from './_pinch-logs.js'

const read = async (pathname) => {
  try {
    const file = await get(pathname, { access: 'private' })
    return file?.stream ? JSON.parse(await new Response(file.stream).text()) : null
  } catch {
    return null
  }
}

export async function GET(request) {
  const params = new URL(request.url).searchParams
  const id = params.get('id')
  const headers = { 'Cache-Control': 'no-store' }
  if (id) {
    if (!/^[\w-]{1,40}$/.test(id)) return Response.json({ error: 'Bad id' }, { status: 400 })
    const page = await list({ prefix: 'pinch-logs/', limit: 1000 })
    const blob = page.blobs.find((b) => b.pathname.endsWith(`-${id}.json`))
    const log = blob && (await read(blob.pathname))
    return log ? Response.json(log, { headers }) : Response.json({ error: 'Not found' }, { status: 404 })
  }
  const page = await list({ prefix: 'pinch-logs/', limit: PINCH_LOGS_PAGE_SIZE })
  const logs = await Promise.all(page.blobs.map((blob) => read(blob.pathname)))
  return Response.json({ sessions: logs.filter(Boolean).map(summarize) }, { headers })
}

export async function POST(request) {
  const { log, status, error } = parsePinchLog(await request.text())
  if (!log) return Response.json({ error }, { status })
  await put(pinchLogKey(log), JSON.stringify(log), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' })
  return Response.json({ ok: true }, { status: 201 })
}
