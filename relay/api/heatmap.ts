import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
}

export const config = { runtime: 'edge' }

const PAGE = 1000 // PostgREST 기본 max-rows

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const [totalRes, scannedRes] = await Promise.all([
    supabase.from('parcels').select('id', { count: 'exact', head: true }),
    supabase.from('parcels').select('id', { count: 'exact', head: true }).eq('scan_status', 'completed'),
  ])
  if (totalRes.error || scannedRes.error) {
    const msg = totalRes.error?.message ?? scannedRes.error?.message
    return Response.json({ ok: false, error: msg }, { status: 500, headers: cors })
  }

  const total = totalRes.count ?? 0
  const scanned = scannedRes.count ?? 0

  // 완료 파셀만 페이지 단위로 조회 (x, y, last_scanned)
  const pages = Math.ceil(scanned / PAGE)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase
        .from('parcels')
        .select('x, y, last_scanned')
        .eq('scan_status', 'completed')
        .order('id')
        .range(i * PAGE, i * PAGE + PAGE - 1)
    )
  )
  const failed = results.find(r => r.error)
  if (failed?.error) {
    return Response.json({ ok: false, error: failed.error.message }, { status: 500, headers: cors })
  }

  const parcels = results.flatMap(r => r.data ?? [])

  return Response.json(
    { ok: true, total, scanned, parcels, updated_at: new Date().toISOString() },
    { headers: cors }
  )
}
