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

  // POST: AI가 명령 전송
  if (req.method === 'POST') {
    const body = await req.json() as { action: string; x?: number; y?: number; z?: number; npc_id?: string }
    const { error } = await supabase.from('remy_commands').insert({
      npc_id: body.npc_id ?? 'remy',
      action: body.action,
      x: body.x ?? null,
      y: body.y ?? null,
      z: body.z ?? null,
      status: 'pending',
    })
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors })
    return Response.json({ ok: true }, { headers: cors })
  }

  // GET: 씬이 pending 명령 폴링
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
