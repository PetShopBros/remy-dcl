// 땅의 모양. 씬이 시작되면 loadLandFromScene() 이 scene.json 의 scene.parcels / scene.base 를
// 런타임에 읽어서 교체한다. 그래서 어느 땅에 배포해도 Remy 가 그 땅 모양 안에서만 걷는다.
// 읽기 전(첫 몇 프레임)이나 읽기 실패 시에는 아래 기본값(우리 8칸)을 쓴다.
// 씬 로컬 좌표: 기본 파셀의 남서쪽 모서리가 (0, 0). x = 동쪽, z = 북쪽.

import { getSceneInformation } from '~system/Runtime'

export const PARCEL_SIZE = 16

// 우리 땅 기본값 (scene.json 과 같음)
const DEFAULT_BASE = { x: 46, y: 115 }
const DEFAULT_PARCELS: ReadonlyArray<readonly [number, number]> = [
  [46, 115], [47, 115], [47, 116], [46, 116],
  [46, 114], [45, 114], [45, 113], [46, 113],
]

// ES 모듈 live binding: 다른 파일에서 import 해도 교체된 값이 보인다.
export let BASE_PARCEL: { x: number; y: number } = { ...DEFAULT_BASE }
export let LAND_PARCELS: ReadonlyArray<readonly [number, number]> = DEFAULT_PARCELS
let landSet = new Set(LAND_PARCELS.map(([x, y]) => `${x},${y}`))
let isOurLand = true   // 우리 8칸일 때만 KEEP_OUT(우리 건물 위치)을 적용한다
let loaded = false

function parseParcel(s: unknown): [number, number] | null {
  if (typeof s !== 'string') return null
  const m = /^\s*(-?\d+)\s*,\s*(-?\d+)\s*$/.exec(s)
  return m ? [Number(m[1]), Number(m[2])] : null
}

function sameSet(a: ReadonlyArray<readonly [number, number]>, b: ReadonlyArray<readonly [number, number]>) {
  if (a.length !== b.length) return false
  const sa = new Set(a.map(([x, y]) => `${x},${y}`))
  return b.every(([x, y]) => sa.has(`${x},${y}`))
}

/**
 * scene.json 을 런타임에 읽어서 땅 모양을 교체한다. 성공하면 true.
 * 실패하면 기본값을 유지하고 false (로그만 남김).
 */
export async function loadLandFromScene(): Promise<boolean> {
  try {
    const info = await getSceneInformation({})
    if (!info || !info.metadataJson) throw new Error('no metadata')
    const meta = JSON.parse(info.metadataJson)
    const rawParcels: unknown[] = meta?.scene?.parcels ?? []
    const parcels = rawParcels.map(parseParcel).filter((p): p is [number, number] => p !== null)
    if (parcels.length === 0) throw new Error('no parcels in scene.json')

    // base 가 없거나 파셀 목록에 없으면 남서쪽(최소 x, 최소 y) 파셀을 쓴다
    let base = parseParcel(meta?.scene?.base)
    if (!base || !parcels.some(([x, y]) => x === base![0] && y === base![1])) {
      base = [Math.min(...parcels.map(p => p[0])), Math.min(...parcels.map(p => p[1]))]
    }

    BASE_PARCEL = { x: base[0], y: base[1] }
    LAND_PARCELS = parcels
    landSet = new Set(parcels.map(([x, y]) => `${x},${y}`))
    isOurLand = sameSet(parcels, DEFAULT_PARCELS) && base[0] === DEFAULT_BASE.x && base[1] === DEFAULT_BASE.y
    loaded = true
    console.log(`[land] ${parcels.length} parcels, base ${base[0]},${base[1]}${isOurLand ? ' (our land)' : ''}`)
    return true
  } catch (e) {
    console.log('[land] scene.json read failed, using defaults:', String(e))
    return false
  }
}

export function isLandLoaded(): boolean {
  return loaded
}

export function hasParcel(px: number, py: number): boolean {
  return landSet.has(`${px},${py}`)
}

/** 파셀의 남서쪽 모서리 좌표 (씬 로컬) */
export function parcelOrigin(px: number, py: number): { x: number; z: number } {
  return { x: (px - BASE_PARCEL.x) * PARCEL_SIZE, z: (py - BASE_PARCEL.y) * PARCEL_SIZE }
}

function parcelAt(x: number, z: number): [number, number] {
  return [BASE_PARCEL.x + Math.floor(x / PARCEL_SIZE), BASE_PARCEL.y + Math.floor(z / PARCEL_SIZE)]
}

/** 씬 로컬 좌표가 속한 파셀 id ("x,y") */
export function parcelIdAt(x: number, z: number): string {
  const [px, py] = parcelAt(x, z)
  return `${px},${py}`
}

/**
 * (x, z) 가 내 땅 위인지. margin 을 주면 땅 가장자리에서 그만큼 안쪽이어야 true.
 * 네 방향으로 margin 만큼 떨어진 점도 모두 땅 위에 있는지 확인한다.
 */
export function isOnLand(x: number, z: number, margin = 0): boolean {
  const pts: Array<[number, number]> = [[x, z]]
  if (margin > 0) pts.push([x + margin, z], [x - margin, z], [x, z + margin], [x, z - margin])
  return pts.every(([px, pz]) => {
    const [ix, iy] = parcelAt(px, pz)
    return hasParcel(ix, iy)
  })
}

/** 우리 땅의 건물 자리. Remy 가 지나가지 않도록 원형으로 막는다. (observatory.ts 와 위치를 맞출 것)
 *  다른 땅에 배포되면 적용하지 않는다. */
export const KEEP_OUT: ReadonlyArray<{ x: number; z: number; r: number }> = [
  { x: 0, z: -16, r: 4.5 },   // 레이더 타워
  { x: 2, z: 0, r: 1.3 },     // 게이트 기둥
  { x: 14, z: 0, r: 1.3 },    // 게이트 기둥
  { x: 29.5, z: 16, r: 2.2 }, // 단말기 (scannerScreen.ts)
  { x: -5.4, z: -11.5, r: 2.4 }, // 제품 모니터 3개 (slate.ts: 타워 기준 반경 7m, -50/0/50도)
  { x: 0, z: -9, r: 2.4 },
  { x: 5.4, z: -11.5, r: 2.4 },
]

/** 땅 안쪽이고 건물과 겹치지 않는 자리인지 (Remy 이동용) */
export function isWalkable(x: number, z: number, margin = 0): boolean {
  if (!isOnLand(x, z, margin)) return false
  if (!isOurLand) return true
  return KEEP_OUT.every(k => Math.hypot(x - k.x, z - k.z) > k.r)
}

/** 땅 안의 걸을 수 있는 무작위 지점. 스폰 위치가 땅 밖일 때(다른 땅에 배포) 쓴다. */
export function randomWalkablePoint(margin = 0): { x: number; z: number } {
  for (let i = 0; i < 50; i++) {
    const [px, py] = LAND_PARCELS[Math.floor(Math.random() * LAND_PARCELS.length)]
    const o = parcelOrigin(px, py)
    const x = o.x + Math.random() * PARCEL_SIZE
    const z = o.z + Math.random() * PARCEL_SIZE
    if (isWalkable(x, z, margin)) return { x, z }
  }
  const [px, py] = LAND_PARCELS[0]
  const o = parcelOrigin(px, py)
  return { x: o.x + PARCEL_SIZE / 2, z: o.z + PARCEL_SIZE / 2 }
}
