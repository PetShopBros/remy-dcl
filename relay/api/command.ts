import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-relay-key',
}

const ALLOWED_NPCS = ['remy']
const COORD_LIMIT = 1000 // 씬 좌표(m) 절댓값 상한

export const config = { runtime: 'edge' }

// 상수 시간 비교 (키 길이·내용을 응답 시간으로 알 수 없게)
function sameKey(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length)
  let diff = a.length ^ b.length
  for (let i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0)
  return diff === 0
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  // POST: AI가 명령 전송 — x-relay-key 필요. RELAY_COMMAND_KEY 가 없으면 모든 POST 거부.
  if (req.method === 'POST') {
    const expected = process.env.RELAY_COMMAND_KEY
    const given = req.headers.get('x-relay-key') ?? ''
    if (!expected || !sameKey(given, expected)) {
      return Response.json({ ok: false, error: 'unauthorized' }, { status: 401, headers: cors })
    }

    let body: { action?: unknown; x?: unknown; y?: unknown; z?: unknown; npc_id?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return Response.json({ ok: false, error: 'invalid json' }, { status: 400, headers: cors })
    }

    const npc_id = body.npc_id ?? 'remy'
    if (typeof npc_id !== 'string' || !ALLOWED_NPCS.includes(npc_id)) {
      return Response.json({ ok: false, error: 'invalid npc_id' }, { status: 400, headers: cors })
    }
    if (body.action !== 'move') {
      return Response.json({ ok: false, error: 'invalid action' }, { status: 400, headers: cors })
    }
    const { x, y, z } = body
    if (!finite(x) || !finite(z) || Math.abs(x) > COORD_LIMIT || Math.abs(z) > COORD_LIMIT) {
      return Response.json({ ok: false, error: 'invalid coordinates' }, { status: 400, headers: cors })
    }
    if (y !== undefined && y !== null && (!finite(y) || y < 0 || y > 50)) {
      return Response.json({ ok: false, error: 'invalid coordinates' }, { status: 400, headers: cors })
    }

    const { error } = await supabase.from('remy_commands').insert({
      npc_id,
      action: 'move',
      x,
      y: y ?? null,
      z,
      status: 'pending',
    })
    if (error) return Response.json({ ok: false, error: 'insert failed' }, { status: 500, headers: cors })
    return Response.json({ ok: true }, { headers: cors })
  }

  // GET: 씬이 pending 명령 폴링 (씬은 공개 코드라 키를 둘 수 없음)
  if (req.method === 'GET') {
    const npc_id = new URL(req.url).searchParams.get('npc_id') ?? 'remy'
    const { data, error } = await supabase
      .from('remy_commands')
      .select('*')
      .eq('npc_id', npc_id)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(1)
      .single()

    if (error || !data) return Response.json({ ok: true, command: null }, { headers: cors })

    // processing 으로 마킹
    await supabase.from('remy_commands').update({ status: 'processing' }).eq('id', data.id)

    return Response.json({ ok: true, command: { id: data.id, action: data.action, x: data.x, y: data.y, z: data.z } }, { headers: cors })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
}
