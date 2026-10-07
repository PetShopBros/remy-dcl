import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)

export const config = { runtime: 'edge' }

// ---PURE-START (의존성 없는 순수 코드: PNG 인코딩 + 지도 그리기) ---------------
const W = 512                 // 이미지 한 변 (px)
const MIN = -150, MAX = 150
const N = MAX - MIN + 1       // 301 칸
const BIN = 10                // density 집계 단위
const DENSITY_AT = 1000       // 이 개수부터 density 모드
const RECENT_MS = 6 * 3600 * 1000

// 팔레트 인덱스 (웹 World Scanner 와 같은 색)
const BG = 0, CELL = 1, GRID = 2, AXIS = 3, SCAN = 4, RECENT = 5, GLOW = 6, GLOW_RECENT = 7, DENS0 = 8, DENS_LEVELS = 9

function buildPalette(): number[][] {
  const p: number[][] = [
    [0x10, 0x16, 0x1d], // BG
    [0x18, 0x20, 0x28], // CELL (미탐험)
    [0x26, 0x33, 0x3d], // GRID
    [0x3a, 0x4a, 0x57], // AXIS
    [0x00, 0xe5, 0xa0], // SCAN
    [0x6c, 0xff, 0xf0], // RECENT
    [0x0a, 0x5a, 0x45], // GLOW
    [0x2a, 0x8f, 0x88], // GLOW_RECENT
  ]
  const lo = [0x12, 0x38, 0x2f], hi = [0x00, 0xe5, 0xa0]
  for (let i = 0; i < DENS_LEVELS; i++) {
    const t = i / (DENS_LEVELS - 1)
    p.push([0, 1, 2].map(k => Math.round(lo[k] + (hi[k] - lo[k]) * t)))
  }
  return p
}
const PALETTE = buildPalette()

interface P { x: number; y: number; t: number }

/** 파셀 목록 → 인덱스 컬러 비트맵 (W×W). 위쪽이 북쪽(y 증가), 오른쪽이 동쪽(x 증가). */
function renderMap(parcels: P[], now: number): Uint8Array {
  const px = new Uint8Array(W * W).fill(CELL)
  const col = (c: number) => Math.min(W - 1, Math.floor((c + 0.5) * W / N)) // 셀 인덱스 → 중심 픽셀

  // 50칸마다 격자, 0 축은 더 밝게
  for (let v = MIN; v <= MAX; v += 50) {
    const idx = v === 0 ? AXIS : GRID
    const cx = col(v - MIN)          // x = v 인 세로선
    const cy = col(MAX - v)          // y = v 인 가로선 (위가 북쪽이라 뒤집음)
    for (let k = 0; k < W; k++) { px[k * W + cx] = idx; px[cy * W + k] = idx }
  }

  const rect = (x0: number, y0: number, x1: number, y1: number, idx: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(W - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) px[y * W + x] = idx
  }

  if (parcels.length >= DENSITY_AT) {
    const bins = new Map<string, number>()
    for (const p of parcels) {
      const k = Math.floor((p.x - MIN) / BIN) + ':' + Math.floor((p.y - MIN) / BIN)
      bins.set(k, (bins.get(k) ?? 0) + 1)
    }
    bins.forEach((count, k) => {
      const [bx, by] = k.split(':').map(Number)
      const level = Math.round(Math.sqrt(Math.min(1, count / (BIN * BIN))) * (DENS_LEVELS - 1))
      const c0 = bx * BIN, c1 = Math.min(N, c0 + BIN)              // 가로 셀 범위
      const r1 = N - by * BIN, r0 = Math.max(0, r1 - BIN)          // 세로 셀 범위(위가 북쪽)
      rect(Math.floor(c0 * W / N), Math.floor(r0 * W / N), Math.floor(c1 * W / N) - 1, Math.floor(r1 * W / N) - 1, DENS0 + level)
    })
  } else {
    const point = (p: P, core: number, glow: number) => {
      const cx = col(p.x - MIN), cy = col(MAX - p.y)
      rect(cx - 3, cy - 3, cx + 2, cy + 2, glow)   // 6×6 glow
      rect(cx - 2, cy - 2, cx + 1, cy + 1, core)   // 4×4 core
    }
    const isRecent = (p: P) => p.t > 0 && now - p.t <= RECENT_MS
    parcels.filter(p => !isRecent(p)).forEach(p => point(p, SCAN, GLOW))
    parcels.filter(isRecent).forEach(p => point(p, RECENT, GLOW_RECENT))
  }
  return px
}

// ── PNG 인코더 (팔레트 8bit, zlib stored 블록 → 압축 라이브러리 불필요) ──
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function adler32(buf: Uint8Array): number {
  let a = 1, b = 0
  for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521 }
  return ((b << 16) | a) >>> 0
}

function be32(n: number): number[] { return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255] }

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  out.set(be32(data.length), 0)
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i)
  out.set(data, 8)
  out.set(be32(crc32(out.subarray(4, 8 + data.length))), 8 + data.length)
  return out
}

function encodePng(indices: Uint8Array, size: number, palette: number[][]): Uint8Array {
  // 각 행 앞에 필터 바이트 0
  const raw = new Uint8Array((size + 1) * size)
  for (let y = 0; y < size; y++) raw.set(indices.subarray(y * size, (y + 1) * size), y * (size + 1) + 1)

  // zlib: 헤더 + stored 블록(최대 65535바이트) + adler32
  const blocks = Math.ceil(raw.length / 65535)
  const z = new Uint8Array(2 + raw.length + blocks * 5 + 4)
  z[0] = 0x78; z[1] = 0x01
  let o = 2
  for (let i = 0; i < blocks; i++) {
    const part = raw.subarray(i * 65535, Math.min(raw.length, (i + 1) * 65535))
    z[o++] = i === blocks - 1 ? 1 : 0
    z[o++] = part.length & 255; z[o++] = part.length >>> 8
    z[o++] = ~part.length & 255; z[o++] = (~part.length >>> 8) & 255
    z.set(part, o); o += part.length
  }
  z.set(be32(adler32(raw)), o)

  const ihdr = new Uint8Array([...be32(size), ...be32(size), 8, 3, 0, 0, 0])
  const plte = new Uint8Array(palette.flat())
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('PLTE', plte), chunk('IDAT', z), chunk('IEND', new Uint8Array(0)),
  ]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const part of parts) { out.set(part, p); p += part.length }
  return out
}
// ---PURE-END ---------------------------------------------------------------

const PAGE = 1000 // PostgREST 기본 max-rows

export default async function handler(req: Request) {
  const headersBase = { 'Access-Control-Allow-Origin': '*' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headersBase, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })

  const countRes = await supabase.from('parcels').select('id', { count: 'exact', head: true }).eq('scan_status', 'completed')
  if (countRes.error) return Response.json({ ok: false, error: countRes.error.message }, { status: 500, headers: headersBase })

  const pages = Math.ceil((countRes.count ?? 0) / PAGE)
  const results = await Promise.all(
    Array.from({ length: pages }, (_, i) =>
      supabase.from('parcels').select('x, y, last_scanned').eq('scan_status', 'completed').order('id').range(i * PAGE, i * PAGE + PAGE - 1)
    )
  )
  const failed = results.find(r => r.error)
  if (failed?.error) return Response.json({ ok: false, error: failed.error.message }, { status: 500, headers: headersBase })

  const parcels: P[] = results.flatMap(r => r.data ?? []).map(r => ({ x: r.x, y: r.y, t: r.last_scanned ? Date.parse(r.last_scanned) : 0 }))
  const png = encodePng(renderMap(parcels, Date.now()), W, PALETTE)

  return new Response(png, {
    headers: { ...headersBase, 'Content-Type': 'image/png', 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' },
  })
}
