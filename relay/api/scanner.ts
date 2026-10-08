import { createClient } from '@supabase/supabase-js'

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_KEY!)

export const config = { runtime: 'edge' }

// ---PURE-START (의존성 없는 순수 코드: 스냅샷 → 비트맵 → PNG) ---------------
const SCALE = 4               // 한 칸을 4×4 픽셀로 (최근 변경 테두리가 보이도록)

// 팔레트 인덱스 (웹 World Scanner 와 같은 색)
const NONE = 0, CONTENT = 1, TEMPLATE = 2, ROAD = 3, UNKNOWN = 4, GRID = 5, AXIS = 6, RECENT = 7
const PALETTE: number[][] = [
  [0x14, 0x1b, 0x23], // NONE      씬 없음 (어두운 색)
  [0x00, 0xe5, 0xa0], // CONTENT   콘텐츠 있음 (강조색)
  [0x4f, 0x7f, 0x76], // TEMPLATE  템플릿/빈 씬 (옅은 색)
  [0x6b, 0x75, 0x80], // ROAD      도로 (회색)
  [0xc9, 0x8a, 0x2b], // UNKNOWN   미확인 (점선 무늬)
  [0x26, 0x33, 0x3d], // GRID
  [0x3a, 0x4a, 0x57], // AXIS
  [0xf4, 0xff, 0xfd], // RECENT    최근 변경 (밝은 테두리 overlay, 칸 색은 그대로)
]
const BASE_COLOR = [NONE, CONTENT, TEMPLATE, ROAD, UNKNOWN]

/** codes(한 칸 한 글자) → 인덱스 컬러 비트맵. 위쪽이 북쪽(y 증가), 오른쪽이 동쪽(x 증가). */
function renderSnapshot(codes: string, width: number, height: number, minX: number, maxY: number): { px: Uint8Array; w: number; h: number } {
  const w = width * SCALE, h = height * SCALE
  const px = new Uint8Array(w * h)

  for (let cy = 0; cy < height; cy++) {
    for (let cx = 0; cx < width; cx++) {
      const c = codes.charCodeAt(cy * width + cx) - 48
      const valid = c >= 0 && c <= 9
      const base = valid ? c % 5 : 4
      const recent = valid && c >= 5
      for (let dy = 0; dy < SCALE; dy++) {
        for (let dx = 0; dx < SCALE; dx++) {
          let idx = BASE_COLOR[base]
          if (base === 4 && (dx + dy) % 2 === 1) idx = NONE                      // 점선 무늬
          if (recent && (dx === 0 || dy === 0 || dx === SCALE - 1 || dy === SCALE - 1)) idx = RECENT   // 색은 유지, 테두리만 overlay
          px[(cy * SCALE + dy) * w + cx * SCALE + dx] = idx
        }
      }
    }
  }

  // 50칸마다 격자 (0 축은 더 밝게). 칸 색을 덮지 않고 "씬 없음" 픽셀 위에만 그린다.
  for (let v = -150; v <= 150; v += 50) {
    const idx = v === 0 ? AXIS : GRID
    const gx = (v - minX) * SCALE + (SCALE >> 1)          // x = v 인 세로선
    const gy = (maxY - v) * SCALE + (SCALE >> 1)          // y = v 인 가로선 (위가 북쪽)
    if (gx >= 0 && gx < w) for (let k = 0; k < h; k++) if (px[k * w + gx] === NONE) px[k * w + gx] = idx
    if (gy >= 0 && gy < h) for (let k = 0; k < w; k++) if (px[gy * w + k] === NONE) px[gy * w + k] = idx
  }
  return { px, w, h }
}

// ── PNG 인코더 (팔레트 8bit) ──
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

/** zlib 압축 없이 stored 블록으로 감싸기 (CompressionStream 이 없을 때의 대비책) */
function zlibStored(raw: Uint8Array): Uint8Array {
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
  return z
}

async function zlibDeflate(raw: Uint8Array): Promise<Uint8Array> {
  const CS = (globalThis as any).CompressionStream
  if (!CS) return zlibStored(raw)
  try {
    const cs = new CS('deflate')                       // 'deflate' = zlib 형식
    const writer = cs.writable.getWriter()
    writer.write(raw); writer.close()
    return new Uint8Array(await new Response(cs.readable).arrayBuffer())
  } catch {
    return zlibStored(raw)
  }
}

async function encodePng(indices: Uint8Array, w: number, h: number, palette: number[][]): Promise<Uint8Array> {
  const raw = new Uint8Array((w + 1) * h)               // 각 행 앞에 필터 바이트 0
  for (let y = 0; y < h; y++) raw.set(indices.subarray(y * w, (y + 1) * w), y * (w + 1) + 1)
  const z = await zlibDeflate(raw)

  const ihdr = new Uint8Array([...be32(w), ...be32(h), 8, 3, 0, 0, 0])
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

export default async function handler(req: Request) {
  const headersBase = { 'Access-Control-Allow-Origin': '*' }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headersBase, 'Access-Control-Allow-Methods': 'GET, OPTIONS' } })

  const { data, error } = await supabase
    .from('map_snapshots')
    .select('width, height, min_x, max_y, codes')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500, headers: headersBase })

  // 스냅샷이 아직 없으면 빈 지도(전부 "씬 없음")를 짧게만 캐시해서 돌려준다
  const width = data?.width ?? 301, height = data?.height ?? 301
  const codes = data?.codes ?? '0'.repeat(width * height)
  const { px, w, h } = renderSnapshot(codes, width, height, data?.min_x ?? -150, data?.max_y ?? 150)
  const png = await encodePng(px, w, h, PALETTE)

  return new Response(png as unknown as BodyInit, {
    headers: {
      ...headersBase,
      'Content-Type': 'image/png',
      'Cache-Control': data ? 'public, s-maxage=60, stale-while-revalidate=120' : 'public, s-maxage=10',
    },
  })
}
