// DCL World Scanner 관측소 (1단계): 땅 윤곽선 + 바닥 + 레이더 타워 + 게이트
// 모든 오브젝트는 기본 도형이고, 땅 모양은 land.ts 의 파셀 목록에서 계산한다.
import {
  engine, Entity, Transform, MeshRenderer, MeshCollider, Material,
  MaterialTransparencyMode, TextShape, Billboard, BillboardMode,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { LAND_PARCELS, PARCEL_SIZE, hasParcel, parcelOrigin } from './land'

// ── 팔레트 (웹 World Scanner 와 동일) ───────────────────────────
export const FLOOR = { albedoColor: Color4.create(0.035, 0.05, 0.065, 1), metallic: 0.2, roughness: 0.9 }
export const PANEL = { albedoColor: Color4.create(0.055, 0.075, 0.1, 1), metallic: 0.5, roughness: 0.6 }
export const MINT = {
  albedoColor: Color4.create(0, 0.9, 0.63, 1),
  emissiveColor: Color3.create(0, 0.9, 0.63), emissiveIntensity: 2.2,
  metallic: 0, roughness: 1,
}
export const AQUA = {
  albedoColor: Color4.create(0.42, 1, 0.94, 1),
  emissiveColor: Color3.create(0.42, 1, 0.94), emissiveIntensity: 3,
  metallic: 0, roughness: 1,
}
export const BEAM = {
  albedoColor: Color4.create(0, 0.9, 0.63, 0.22),
  emissiveColor: Color3.create(0, 0.9, 0.63), emissiveIntensity: 1.6,
  transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  metallic: 0, roughness: 1,
}

export type Mat = Parameters<typeof Material.setPbrMaterial>[1]

interface Opts { collide?: boolean; parent?: Entity; rotation?: Quaternion }

function place(e: Entity, pos: Vector3, scale: Vector3, o: Opts) {
  Transform.create(e, { position: pos, scale, rotation: o.rotation ?? Quaternion.Identity(), parent: o.parent })
}

export function box(pos: Vector3, scale: Vector3, mat: Mat, o: Opts = {}): Entity {
  const e = engine.addEntity()
  place(e, pos, scale, o)
  MeshRenderer.setBox(e)
  if (o.collide) MeshCollider.setBox(e)
  Material.setPbrMaterial(e, mat)
  return e
}

/** 지름 1m, 높이 1m 기준 원기둥. scale 로 크기를 정한다. */
function cylinder(pos: Vector3, scale: Vector3, mat: Mat, o: Opts = {}, rBottom = 0.5, rTop = 0.5): Entity {
  const e = engine.addEntity()
  place(e, pos, scale, o)
  MeshRenderer.setCylinder(e, rBottom, rTop)
  if (o.collide) MeshCollider.setCylinder(e, rBottom, rTop)
  Material.setPbrMaterial(e, mat)
  return e
}

function sphere(pos: Vector3, scale: Vector3, mat: Mat): Entity {
  const e = engine.addEntity()
  place(e, pos, scale, {})
  MeshRenderer.setSphere(e)
  Material.setPbrMaterial(e, mat)
  return e
}

let built = false

export function buildObservatory() {
  if (built) return
  built = true

  buildFloorAndOutline()
  buildGate()
  buildRadarTower()
}

// ── 바닥 + 땅 윤곽선 ────────────────────────────────────────────
function buildFloorAndOutline() {
  const S = PARCEL_SIZE
  const LINE = 0.3        // 윤곽선 두께
  const LINE_Y = 0.085

  for (const [px, py] of LAND_PARCELS) {
    const { x: ox, z: oz } = parcelOrigin(px, py)

    // Remy 가 y=0.1 에서 걸으므로 바닥은 얇게 (윗면 y=0.06)
    box(Vector3.create(ox + S / 2, 0.03, oz + S / 2), Vector3.create(S, 0.06, S), FLOOR)

    // 이웃 파셀이 없는 변 = 땅의 바깥 경계. 파셀 안쪽으로 붙여서 경계 밖으로 나가지 않게 한다.
    if (!hasParcel(px - 1, py)) box(Vector3.create(ox + LINE / 2, LINE_Y, oz + S / 2), Vector3.create(LINE, 0.05, S), MINT)
    if (!hasParcel(px + 1, py)) box(Vector3.create(ox + S - LINE / 2, LINE_Y, oz + S / 2), Vector3.create(LINE, 0.05, S), MINT)
    if (!hasParcel(px, py - 1)) box(Vector3.create(ox + S / 2, LINE_Y, oz + LINE / 2), Vector3.create(S, 0.05, LINE), MINT)
    if (!hasParcel(px, py + 1)) box(Vector3.create(ox + S / 2, LINE_Y, oz + S - LINE / 2), Vector3.create(S, 0.05, LINE), MINT)
  }
}

// ── 게이트: 두 블록(북동/남서)이 만나는 z=0 경계에 세운다 ───────
function buildGate() {
  const Z = 0
  const H = 6
  // 기둥
  for (const x of [2, 14]) {
    box(Vector3.create(x, H / 2, Z), Vector3.create(0.8, H, 0.8), PANEL, { collide: true })
    box(Vector3.create(x, H / 2, Z), Vector3.create(0.12, H - 0.4, 0.84), MINT)
  }
  // 상단 보
  box(Vector3.create(8, H + 0.3, Z), Vector3.create(13.2, 0.6, 0.8), PANEL, { collide: true })
  box(Vector3.create(8, H - 0.02, Z), Vector3.create(12.4, 0.08, 0.86), MINT)
  box(Vector3.create(8, H + 0.62, Z), Vector3.create(13.2, 0.06, 0.86), AQUA)

  // 간판
  const sign = engine.addEntity()
  Transform.create(sign, { position: Vector3.create(8, H + 1.8, Z) })
  Billboard.create(sign, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(sign, {
    text: 'DCL WORLD SCANNER',
    fontSize: 3,
    textColor: Color4.create(0, 0.9, 0.63, 1),
    outlineWidth: 0.12,
    outlineColor: Color3.create(0.03, 0.04, 0.05),
  })
}

// ── 레이더 타워: 남서 블록 중앙 (0, -16) ───────────────────────
function buildRadarTower() {
  const CX = 0
  const CZ = -16

  // 받침 + 몸통
  box(Vector3.create(CX, 0.3, CZ), Vector3.create(6, 0.6, 6), PANEL, { collide: true })
  box(Vector3.create(CX, 0.62, CZ), Vector3.create(6.1, 0.05, 6.1), MINT)
  cylinder(Vector3.create(CX, 7.1, CZ), Vector3.create(1.8, 13, 1.8), PANEL, { collide: true }, 0.5, 0.3)

  // 몸통을 따라 올라가는 링 3개 (아래에서 위로 맥동)
  const rings: Entity[] = [3, 7, 11].map(y =>
    cylinder(Vector3.create(CX, y, CZ), Vector3.create(2.7, 0.12, 2.7), MINT)
  )

  // 회전 안테나: pivot 이 돌고, 자식들이 따라 돈다
  const pivot = engine.addEntity()
  Transform.create(pivot, { position: Vector3.create(CX, 14.4, CZ) })
  box(Vector3.create(0, 0.45, 0), Vector3.create(0.4, 0.9, 0.4), PANEL, { parent: pivot })
  box(Vector3.create(0, 0.95, 0), Vector3.create(7, 0.45, 0.3), PANEL, { parent: pivot })
  box(Vector3.create(3.5, 0.95, 0), Vector3.create(0.16, 0.5, 0.34), MINT, { parent: pivot })
  box(Vector3.create(-3.5, 0.95, 0), Vector3.create(0.16, 0.5, 0.34), MINT, { parent: pivot })
  // 접시
  cylinder(
    Vector3.create(1.6, 1.9, 0), Vector3.create(2.4, 0.12, 2.4), PANEL,
    { parent: pivot, rotation: Quaternion.fromEulerDegrees(0, 0, -55) }
  )

  // 비콘 + 위로 쏘는 스캔 빔
  sphere(Vector3.create(CX, 17.2, CZ), Vector3.create(0.9, 0.9, 0.9), AQUA)
  const beam = cylinder(Vector3.create(CX, 37.7, CZ), Vector3.create(0.6, 40, 0.6), BEAM)

  let t = 0
  engine.addSystem((dt: number) => {
    t += dt
    Transform.getMutable(pivot).rotation = Quaternion.fromEulerDegrees(0, (t * 30) % 360, 0)

    rings.forEach((r, i) => {
      const s = 2.7 * (1 + 0.1 * Math.sin(t * 3 - i * 1.1))
      const tf = Transform.getMutable(r)
      tf.scale.x = s
      tf.scale.z = s
    })

    const w = 0.7 + 0.2 * Math.sin(t * 2.2)
    const bt = Transform.getMutable(beam)
    bt.scale.x = w
    bt.scale.z = w
  }, 1, 'observatory-animation')
}
