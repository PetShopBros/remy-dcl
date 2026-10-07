// DCL World Scanner 관측소 (2단계): 바닥 지도 화면 + 숫자 단말기 + 웹 열기 버튼 + 레이더 스윕
// 지도 이미지와 숫자는 relay 에서 가져온다. (이 파일의 fetch 는 index.ts 의 REPORT 와 같은 방식)
import {
  engine, Entity, Transform, MeshRenderer, MeshCollider, Material, TextShape, Billboard, BillboardMode,
  pointerEventsSystem, InputAction,
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'
import { PANEL, MINT, AQUA, box } from './observatory'

const RELAY = 'https://remy-dcl-relay-roan.vercel.app'
const SCANNER_PAGE = `${RELAY}/scanner.html`

// 북동 블록 중앙(16, 16)에 20m 지도를 깐다. 땅 경계에서 6m 이상 안쪽.
const MAP_CX = 16
const MAP_CZ = 16
const MAP_SIZE = 20
const MAP_Y = 0.075
// 지도가 뒤집혀 보이면 이 각도만 바꾼다. (90 = 위쪽을 향해 눕힘)
const MAP_ROTATION = Quaternion.fromEulerDegrees(90, 0, 0)

const TERMINAL_X = 29.5       // 지도 동쪽
const REFRESH_SECONDS = 300

let board: Entity
let map: Entity

function textureUrl(): string {
  return `${RELAY}/api/scanner.png?v=${Math.floor(Date.now() / (REFRESH_SECONDS * 1000))}`
}

function setMapTexture() {
  Material.setBasicMaterial(map, { texture: Material.Texture.Common({ src: textureUrl() }) })
}

function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return h < 48 ? `${h}h ${m % 60}m ago` : `${Math.floor(h / 24)}d ago`
}

function fmt(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

async function refresh() {
  try {
    const res = await fetch(`${RELAY}/api/heatmap`)
    const d: any = await res.json()
    if (!d.ok) throw new Error(d.error ?? 'error')
    let last = 0
    for (const p of d.parcels as Array<{ last_scanned: string | null }>) {
      const t = p.last_scanned ? Date.parse(p.last_scanned) : 0
      if (t > last) last = t
    }
    const cov = d.total ? (d.scanned / d.total) * 100 : 0
    TextShape.getMutable(board).text =
      `WORLD SCANNER\n\n${fmt(d.scanned)} / ${fmt(d.total)}\n${cov < 0.01 && d.scanned > 0 ? '<0.01' : cov.toFixed(2)}% COVERAGE\n\nLAST SCAN\n${last ? ago(Date.now() - last) : '-'}`
    setMapTexture()
  } catch {
    TextShape.getMutable(board).text = 'WORLD SCANNER\n\nDATA OFFLINE'
  }
}

export function buildScannerScreen() {
  // ── 바닥 지도 (북쪽이 위) ──
  map = engine.addEntity()
  Transform.create(map, { position: Vector3.create(MAP_CX, MAP_Y, MAP_CZ), scale: Vector3.create(MAP_SIZE, MAP_SIZE, 1), rotation: MAP_ROTATION })
  MeshRenderer.setPlane(map)
  setMapTexture()

  // 지도 테두리
  const h = MAP_SIZE / 2 + 0.15
  box(Vector3.create(MAP_CX, 0.1, MAP_CZ + h), Vector3.create(MAP_SIZE + 0.6, 0.05, 0.2), MINT)
  box(Vector3.create(MAP_CX, 0.1, MAP_CZ - h), Vector3.create(MAP_SIZE + 0.6, 0.05, 0.2), MINT)
  box(Vector3.create(MAP_CX + h, 0.1, MAP_CZ), Vector3.create(0.2, 0.05, MAP_SIZE + 0.6), MINT)
  box(Vector3.create(MAP_CX - h, 0.1, MAP_CZ), Vector3.create(0.2, 0.05, MAP_SIZE + 0.6), MINT)

  // 북쪽 표시 (지도 방향 확인용)
  const north = engine.addEntity()
  Transform.create(north, { position: Vector3.create(MAP_CX, 0.9, MAP_CZ + h + 1.0) })
  Billboard.create(north, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(north, { text: 'N', fontSize: 4, textColor: Color4.create(0.42, 1, 0.94, 1), outlineWidth: 0.1, outlineColor: Color3.create(0.03, 0.04, 0.05) })

  // 레이더 스윕: 지도 위를 도는 얇은 빛 막대
  const sweep = box(
    Vector3.create(MAP_CX, 0.12, MAP_CZ), Vector3.create(MAP_SIZE, 0.03, 0.12),
    { ...AQUA, albedoColor: Color4.create(0.42, 1, 0.94, 0.6) }
  )

  // ── 단말기: 지도 동쪽 ──
  box(Vector3.create(TERMINAL_X, 0.55, MAP_CZ), Vector3.create(1.0, 1.1, 3.0), PANEL, { collide: true })
  box(Vector3.create(TERMINAL_X, 1.12, MAP_CZ), Vector3.create(1.04, 0.05, 3.04), MINT)
  const button = box(Vector3.create(TERMINAL_X - 0.51, 0.7, MAP_CZ), Vector3.create(0.04, 0.5, 2.4), MINT)
  MeshCollider.setBox(button)
  pointerEventsSystem.onPointerDown(
    { entity: button, opts: { button: InputAction.IA_POINTER, hoverText: 'OPEN FULL SCANNER', maxDistance: 12 } },
    () => { void openExternalUrl({ url: SCANNER_PAGE }) }
  )

  board = engine.addEntity()
  Transform.create(board, { position: Vector3.create(TERMINAL_X, 3.1, MAP_CZ) })
  Billboard.create(board, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(board, {
    text: 'WORLD SCANNER\n\nLOADING...',
    fontSize: 1.6,
    textColor: Color4.create(0, 0.9, 0.63, 1),
    outlineWidth: 0.1,
    outlineColor: Color3.create(0.03, 0.04, 0.05),
  })

  void refresh()

  let t = 0
  let sinceRefresh = 0
  engine.addSystem((dt: number) => {
    t += dt
    sinceRefresh += dt
    Transform.getMutable(sweep).rotation = Quaternion.fromEulerDegrees(0, (t * 40) % 360, 0)
    if (sinceRefresh >= REFRESH_SECONDS) {
      sinceRefresh = 0
      void refresh()
    }
  }, 1, 'scanner-screen')
}
