import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120',
}

export const config = { runtime: 'edge' }

// World Scanner 가 스캔마다 저장하는 지도 스냅샷(map_snapshots) 중 최신 1행을 돌려준다.
//   snapshot.codes : 301x301 글자. 인덱스 = (max_y - y) * width + (x - min_x)
//     0 씬 없음 / 1 콘텐츠 있음 / 2 템플릿·빈 씬 / 3 도로 / 4 미확인, 5~9 = 0~4 + 최근 변경(overlay)
//   snapshot.stats : 숫자 요약 (scenes, parcels, recent …)
export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const { data, error } = await supabase
    .from('map_snapshots')
    .select('id, created_at, run_id, width, height, min_x, max_y, codes, stats')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors })
  if (!data) return Response.json({ ok: false, error: 'no snapshot yet' }, { status: 404, headers: { ...cors, 'Cache-Control': 'no-store' } })

  const s: any = data.stats ?? {}
  return Response.json(
    {
      ok: true,
      snapshot: data,
      updated_at: data.created_at,
      // ── 이전 버전 호환 (이미 배포된 씬 단말기가 읽는 필드) ──
      // 씬 단말기는 total / scanned / parcels[].last_scanned 만 읽는다. 씬 UI 를 바꾸기 전까지 유지한다.
      total: s.total_parcels ?? 0,
      scanned: (s.total_parcels ?? 0) - (s.unobserved_parcels ?? 0),
      parcels: [{ last_scanned: data.created_at }],
    },
    { headers: cors }
  )
}
