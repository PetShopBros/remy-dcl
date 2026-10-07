import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
}

export const config = { runtime: 'edge' }

// 씬의 제품 슬레이트(scene/src/slate.ts)와 같은 id 만 받는다.
const SLIDES = ['dcl-agent-mcp', 'lowdown', 'remy']

export default async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })

  const slide = new URL(req.url).searchParams.get('slide')
  if (!slide || !SLIDES.includes(slide)) {
    return Response.json({ ok: false, error: 'unknown slide' }, { status: 400, headers: cors })
  }

  const { error } = await supabase.from('interactions').insert({
    actor: 'visitor',
    target: `dcl-scene:slate:${slide}`,
    target_type: 'service',
    task_type: 'click',
    outcome: 'success',
  })

  return Response.json({ ok: !error, error: error?.message }, { status: error ? 500 : 200, headers: cors })
}
