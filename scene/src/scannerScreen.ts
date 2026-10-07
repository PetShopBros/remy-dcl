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
const NEAR_DISTANCE = 9       // 이 거리 안에 들어오면 클릭 안내를 띄운다

const LABEL_DEFAULT = 'CLICK > FULL SCANNER'
const LABEL_OPENING = 'OPENING...'
const PROMPT_TEXT = 'CLICK THE GLOWING PANEL\nTO OPEN THE LIVE MAP'

const DARK_TEXT = Color4.create(0.03, 0.04, 0.05, 1)
const OUTLINE = Color3.create(0.03, 0.04, 0.05)

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
  TextShape.create(north, { text: 'N', fontSize: 4, textColor: Color4.create(0.42, 1, 0.94, 1), outlineWidth: 0.1, outlineColor: OUTLINE })

  // 레이더 스윕: 지도 위를 도는 얇은 빛 막대
  const sweep = box(
    Vector3.create(MAP_CX, 0.12, MAP_CZ), Vector3.create(MAP_SIZE, 0.03, 0.12),
    { ...AQUA, albedoColor: Color4.create(0.42, 1, 0.94, 0.6) }
  )

  // ── 단말기: 지도 동쪽 ──
  box(Vector3.create(TERMINAL_X, 0.55, MAP_CZ), Vector3.create(1.0, 1.1, 3.0), PANEL, { collide: true })
  box(Vector3.create(TERMINAL_X, 1.12, MAP_CZ), Vector3.create(1.04, 0.05, 3.04), MINT)

  // 클릭 버튼 (지도를 향한 서쪽 면)
  const BTN_Y = 0.7
  const BTN_BASE = Vector3.create(0.04, 0.5, 2.4)
  const button = box(Vector3.create(TERMINAL_X - 0.51, BTN_Y, MAP_CZ), BTN_BASE, MINT)
  MeshCollider.setBox(button)

  // 1) 버튼 면 글자 (Billboard 라서 어느 쪽에서 봐도 읽힌다)
  const label = engine.addEntity()
  Transform.create(label, { position: Vector3.create(TERMINAL_X - 0.58, BTN_Y, MAP_CZ) })
  Billboard.create(label, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(label, { text: LABEL_DEFAULT, fontSize: 1.1, textColor: DARK_TEXT })

  // 2) 버튼 위에서 아래로 가리키는 화살표 (원뿔을 뒤집은 것)
  const ARROW_BASE_Y = 1.55
  const arrow = engine.addEntity()
  Transform.create(arrow, {
    position: Vector3.create(TERMINAL_X - 0.51, ARROW_BASE_Y, MAP_CZ),
    scale: Vector3.create(0.4, 0.55, 0.4),
    rotation: Quaternion.fromEulerDegrees(180, 0, 0),
  })
  MeshRenderer.setCylinder(arrow, 0.5, 0)
  Material.setPbrMaterial(arrow, AQUA)

  // 3) 가까이 오면 뜨는 안내 문구
  const prompt = engine.addEntity()
  Transform.create(prompt, { position: Vector3.create(TERMINAL_X - 0.51, 2.35, MAP_CZ) })
  Billboard.create(prompt, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(prompt, { text: '', fontSize: 0.9, textColor: Color4.create(0.42, 1, 0.94, 1), outlineWidth: 0.1, outlineColor: OUTLINE })
  let promptShown = false

  // 4) 클릭 피드백: 버튼이 번쩍이고 글자가 OPENING... 으로 바뀐다
  let flashUntil = 0
  let openingUntil = 0
  let t = 0
  pointerEventsSystem.onPointerDown(
    { entity: button, opts: { button: InputAction.IA_POINTER, hoverText: 'OPEN FULL SCANNER', maxDistance: 12 } },
    () => {
      flashUntil = t + 0.3
      openingUntil = t + 3
      TextShape.getMutable(label).text = LABEL_OPENING
      void openExternalUrl({ url: SCANNER_PAGE })
    }
  )

  // 숫자 보드
  board = engine.addEntity()
  Transform.create(board, { position: Vector3.create(TERMINAL_X, 4.0, MAP_CZ) })
  Billboard.create(board, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(board, {
    text: 'WORLD SCANNER\n\nLOADING...',
    fontSize: 1.6,
    textColor: Color4.create(0, 0.9, 0.63, 1),
    outlineWidth: 0.1,
    outlineColor: OUTLINE,
  })

  void refresh()

  let sinceRefresh = 0
  engine.addSystem((dt: number) => {
    t += dt
    sinceRefresh += dt

    Transform.getMutable(sweep).rotation = Quaternion.fromEulerDegrees(0, (t * 40) % 360, 0)

    // 2) 버튼 숨쉬기 + 클릭 순간 번쩍임, 화살표 위아래
    const pulse = t < flashUntil ? 1.18 : 1 + 0.04 * Math.sin(t * 3)
    Transform.getMutable(button).scale = Vector3.create(BTN_BASE.x, BTN_BASE.y * pulse, BTN_BASE.z * pulse)
    Transform.getMutable(arrow).position.y = ARROW_BASE_Y + 0.12 * Math.sin(t * 4)

    // 4) OPENING... 을 3초 뒤 원래 글자로
    if (openingUntil > 0 && t >= openingUntil) {
      openingUntil = 0
      TextShape.getMutable(label).text = LABEL_DEFAULT
    }

    // 3) 근접 안내
    const player = Transform.getOrNull(engine.PlayerEntity)
    const near = player ? Math.hypot(player.position.x - TERMINAL_X, player.position.z - MAP_CZ) < NEAR_DISTANCE : false
    if (near !== promptShown) {
      promptShown = near
      TextShape.getMutable(prompt).text = near ? PROMPT_TEXT : ''
    }

    if (sinceRefresh >= REFRESH_SECONDS) {
      sinceRefresh = 0
      void refresh()
    }
  }, 1, 'scanner-screen')
}
