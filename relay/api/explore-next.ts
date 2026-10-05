import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const url = new URL(req.url)
  const agent = url.searchParams.get('agent') ?? 'remy'

  // atomic claim: pending → claimed
  const { data, error } = await supabase.rpc('claim_next_parcel', { agent_name: agent })

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors })
  if (!data) return Response.json({ ok: false, error: 'no pending parcels' }, { status: 404, headers: cors })

  return Response.json({ ok: true, parcel: data }, { headers: cors })
}