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

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  // POST: 씬이 완료 보고
  if (req.method === 'POST') {
    const body = await req.json() as { id?: string; action: string; status: string; position?: { x: number; y: number; z: number } }
    if (body.id) {
      await supabase.from('remy_commands').update({ status: body.status }).eq('id', body.id)
    }
    return Response.json({ ok: true }, { headers: cors })
  }

  // GET: 마지막 완료 상태 조회
  if (req.method === 'GET') {
    const { data } = await supabase
      .from('remy_commands')
      .select('*')
      .in('status', ['success', 'error'])
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    return Response.json({ ok: true, status: data ?? null }, { headers: cors })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
}
