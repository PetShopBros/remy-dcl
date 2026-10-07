// 내 땅(8 파셀)의 모양. scene.json 의 scene.parcels 와 반드시 같아야 한다.
// 씬 로컬 좌표: 기본 파셀(46,115)의 남서쪽 모서리가 (0, 0). x = 동쪽, z = 북쪽.

export const BASE_PARCEL = { x: 46, y: 115 }
export const PARCEL_SIZE = 16

export const LAND_PARCELS: ReadonlyArray<readonly [number, number]> = [
  [46, 115], [47, 115], [47, 116], [46, 116],
  [46, 114], [45, 114], [45, 113], [46, 113],
]

const landSet = new Set(LAND_PARCELS.map(([x, y]) => `${x},${y}`))

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

/** 건물이 서 있는 자리. Remy 가 지나가지 않도록 원형으로 막는다. (observatory.ts 와 위치를 맞출 것) */
export const KEEP_OUT: ReadonlyArray<{ x: number; z: number; r: number }> = [
  { x: 0, z: -16, r: 4.5 },   // 레이더 타워
  { x: 2, z: 0, r: 1.3 },     // 게이트 기둥
  { x: 14, z: 0, r: 1.3 },    // 게이트 기둥
  { x: 29.5, z: 16, r: 2.2 }, // 단말기 (scannerScreen.ts)
]

/** 땅 안쪽이고 건물과 겹치지 않는 자리인지 (Remy 이동용) */
export function isWalkable(x: number, z: number, margin = 0): boolean {
  if (!isOnLand(x, z, margin)) return false
  return KEEP_OUT.every(k => Math.hypot(x - k.x, z - k.z) > k.r)
}
