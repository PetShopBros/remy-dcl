import { Redis } from '@upstash/redis'

const redis = Redis.fromEnv()
const STATUS_KEY = 'remy:last_status'

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
    const payload = { ...body, timestamp: new Date().toISOString() }
    await redis.set(STATUS_KEY, JSON.stringify(payload), { ex: 60 })
    return Response.json({ ok: true }, { headers: cors })
  }

  if (req.method === 'GET') {
    const raw = await redis.get(STATUS_KEY)
    if (!raw) return Response.json({ ok: true, status: null }, { headers: cors })
    const status = typeof raw === 'string' ? JSON.parse(raw) : raw
    return Response.json({ ok: true, status }, { headers: cors })
  }

  return Response.json({ error: 'Method not allowed' }, { status: 405, headers: cors })
}
