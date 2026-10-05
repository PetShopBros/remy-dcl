import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(req.url)
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ ok: false, error: 'id required' }, { status: 400, headers: cors })

  const { error } = await supabase
    .from('parcels')
    .update({ scan_status: 'completed', last_scanned: new Date().toISOString(), scan_count: 1 })
    .eq('id', id)

  // Lowdown 기록
  await supabase.from('interactions').insert({
    actor: 'remy',
    task_type: 'explore',
    target: `dcl:${id}`,
    outcome: 'success',
  })

  return Response.json({ ok: !error }, { headers: cors })
}