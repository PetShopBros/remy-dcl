import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
)

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  const { data, error } = await supabase
    .from('interactions')
    .select('task_type, outcome, target, created_at')
    .eq('actor', 'remy')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500, headers: cors })
  }

  const explored   = data.filter(r => r.task_type === 'explore').length
  const moved      = data.filter(r => r.task_type === 'move').length
  const discovered = data.filter(r => r.outcome === 'success').length
  const last       = data[0]
  const lastParcel = last ? last.target.replace('dcl:', '') : '-'
  const lastScan   = last ? timeAgo(new Date(last.created_at)) : '-'

  return Response.json({
    ok: true,
    explored,
    moved,
    discovered,
    lastParcel,
    lastScan,
  }, { headers: cors })
}

function timeAgo(date: Date): string {
  const sec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}