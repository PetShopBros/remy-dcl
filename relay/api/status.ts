import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const config = { runtime: 'edge' }

// 씬은 'success' | 'failure' 를 보낸다.
const ALLOWED_STATUS = ['success', 'failure', 'error']
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  // POST: 씬이 완료 보고 (씬은 공개 코드라 키를 둘 수 없음 → 형식 검증 + 처리 중인 명령만 갱신)
  if (req.method === 'POST') {
    let body: { id?: unknown; status?: unknown }
    try {
      body = (await req.json()) as typeof body
    } catch {
      return Response.json({ ok: false, error: 'invalid json' }, { status: 400, headers: cors })
    }
    if (typeof body.status !== 'string' || !ALLOWED_STATUS.includes(body.status)) {
      return Response.json({ ok: false, error: 'invalid status' }, { status: 400, headers: cors })
    }
    if (body.id !== undefined && body.id !== null) {
      if (typeof body.id !== 'string' || !UUID_RE.test(body.id)) {
        return Response.json({ ok: false, error: 'invalid id' }, { status: 400, headers: cors })
      }
      // 대기 중(pending) 명령을 임의로 완료 처리할 수 없게, 처리 중인 명령만 바꾼다.
      await supabase.from('remy_commands').update({ status: body.status }).eq('id', body.id).eq('status', 'processing')
    }
    return Response.json({ ok: true }, { headers: cors })
  }

  // GET: 마지막 완료 상태 조회
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('remy_commands')
      .select('*')
      .in('status', ALLOWED_STATUS)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return Response.json({ ok: true, status: data ?? null }, { headers: cors })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
}
