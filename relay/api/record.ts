import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
  }

  const body = await req.json() as {
    actor: string
    target: string
    target_type: string
    task_type: string
    outcome: string
    from?: { x: number; z: number }
    to?: { x: number; z: number }
    latency_ms?: number
  }

  await supabase.from('interactions').insert({
    actor: body.actor,
    target: body.target,
    target_type: body.target_type ?? 'service',
    task_type: body.task_type,
    outcome: body.outcome,
    latency_ms: body.latency_ms ?? null,
    source: 'organic',
  })

  return Response.json({ ok: true }, { headers: cors })
}