import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()
const COMMAND_KEY = 'remy:pending_command'

export const config = { runtime: 'edge' }

export default async function handler(req: Request) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  }

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors })
  }

  if (req.method === 'POST') {
    const body = await req.json()
    await redis.set(COMMAND_KEY, JSON.stringify(body), { ex: 30 }) // 30초 TTL
    return Response.json({ ok: true }, { headers: cors })
  }

  if (req.method === 'GET') {
    const raw = await redis.getdel(COMMAND_KEY)
    if (!raw) return Response.json({ ok: true, command: null }, { headers: cors })
    const command = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Response.json({ ok: true, command }, { headers: cors })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
}
