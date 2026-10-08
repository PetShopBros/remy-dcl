import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60',
}

export const config = { runtime: 'edge' }

// GET /api/parcel?x=46&y=115
//   parcel      : 현재 상태 (state / tile_type)
//   scene       : 그 파셀 위의 현재 씬 (catalyst_scenes) — 없으면 null
//   world       : 이 파셀에 영향을 준 변화 이력 (world_events, 최신순)
//   agent       : 이 파셀에 대한 에이전트 활동 (interactions, target = 'dcl:x,y', 최신순)
//   timeline    : world + agent 를 시간순(최신순)으로 합친 목록
// 변화 이력은 스캐너가 알아챈 시점부터만 있다. 씬의 배포 시각(scene.deployed_at)은 그 이전의 기준선이다.
const LIMIT = 20
const TIME_FIELDS = ['created_at', 'timestamp', 'ts', 'time']

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const q = new URL(req.url).searchParams
  const x = Number(q.get('x')), y = Number(q.get('y'))
  if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1000 || Math.abs(y) > 1000) {
    return Response.json({ ok: false, error: 'x and y must be integers' }, { status: 400, headers: { ...cors, 'Cache-Control': 'no-store' } })
  }
  const id = `${x},${y}`

  const [parcelRes, eventsRes, agentRes] = await Promise.all([
    supabase.from('parcels').select('id, state, tile_type, entity_id, state_changed_at').eq('id', id).maybeSingle(),
    supabase.from('world_events')
      .select('event_type, observed_at, deployed_at, title, prev_title, kind, prev_kind, parcel_count, entity_id, prev_entity_id')
      .contains('parcels', [id]).order('observed_at', { ascending: false }).limit(LIMIT),
    // interactions 의 시간 컬럼 이름을 확인하지 못해서 정렬은 서버에서 하지 않고, 읽은 뒤 가능한 필드로 정렬한다.
    supabase.from('interactions').select('*').eq('target', `dcl:${id}`).limit(100),
  ])

  if (parcelRes.error) return Response.json({ ok: false, error: parcelRes.error.message }, { status: 500, headers: cors })
  if (!parcelRes.data) return Response.json({ ok: false, error: 'unknown parcel' }, { status: 404, headers: cors })

  const p = parcelRes.data
  let scene: any = null
  if (p.entity_id) {
    const s = await supabase.from('catalyst_scenes')
      .select('entity_id, title, base, parcel_count, kind, deployed_at, first_seen_at').eq('entity_id', p.entity_id).maybeSingle()
    scene = s.data ?? null
  }

  const world = eventsRes.error ? [] : (eventsRes.data ?? [])
  const agent = (agentRes.error ? [] : (agentRes.data ?? []))
    .map((r: any) => {
      const field = TIME_FIELDS.find(f => r[f])
      return { at: field ? new Date(r[field]).toISOString() : null, actor: r.actor ?? null, task_type: r.task_type ?? null, outcome: r.outcome ?? null }
    })
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, LIMIT)

  const timeline = [
    ...world.map((e: any) => ({ at: e.observed_at, source: 'world', ...e })),
    ...agent.map(a => ({ source: 'agent', ...a })),
  ].sort((a: any, b: any) => (b.at ?? '').localeCompare(a.at ?? '')).slice(0, LIMIT)

  return Response.json(
    {
      ok: true,
      id, x, y,
      parcel: { state: p.state, tile_type: p.tile_type, state_changed_at: p.state_changed_at },
      scene,
      world, agent, timeline,
      warnings: [eventsRes.error && `world_events: ${eventsRes.error.message}`, agentRes.error && `interactions: ${agentRes.error.message}`].filter(Boolean),
    },
    { headers: cors }
  )
}
