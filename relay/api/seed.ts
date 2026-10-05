import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = { 'Access-Control-Allow-Origin': '*' }

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const url = new URL(req.url)
  const x1 = parseInt(url.searchParams.get('x1') ?? '-150')
  const x2 = parseInt(url.searchParams.get('x2') ?? '-146')

  const res = await fetch(
    `https://api.decentraland.org/v2/tiles?x1=${x1}&x2=${x2}&y1=-150&y2=150`,
    { signal: AbortSignal.timeout(25000) }
  )
  const json = await res.json() as any
  const tiles = Object.entries(json.data ?? {}) as [string, any][]

  const rows = tiles.map(([id, t]) => ({
    id,
    x: t.x,
    y: t.y,
    tile_type: t.type,
    owner: t.owner ?? null,
    name: t.name ?? null,
    estate_id: t.estateId ?? null,
    scan_status: 'pending',
  }))

  let inserted = 0
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from('parcels')
      .upsert(rows.slice(i, i + 200), { onConflict: 'x,y' })
    if (!error) inserted += Math.min(200, rows.length - i)
  }

  return Response.json({ ok: true, range: `${x1}~${x2}`, tiles: tiles.length, inserted }, { headers: cors })
}