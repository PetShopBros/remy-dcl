// Remy 클릭 메뉴: 월드 안의 작은 패널 (Remy 옆, 눈높이).
//
// 구조 — 부모(root) 하나에만 Billboard 를 붙이고, 배경/버튼/글자는 모두 자식으로 위치만 준다.
//   root (Billboard BM_Y, Remy 위치를 따라감)
//    ├─ panel   : 둥근 모서리 + 민트 테두리 + 반투명 배경 (이미지 assets/remy_panel.png 한 장, 클릭 영역 없음)
//    ├─ title   : 머리글
//    └─ 버튼 x6 : 불투명 판(클릭 영역 = 판 크기) + 글자(판보다 앞)
//
// 미리보기 확인 포인트:
//   - 패널이 뒤집혀 보이거나 글자가 배경 뒤에 묻히면 FRONT 를 1 로 바꾼다.
//   - 패널이 Remy 반대쪽에 붙으면 SIDE 를 -1 로 바꾼다.

import {
  engine, Entity, Transform, TextShape, Billboard, BillboardMode, MeshRenderer, MeshCollider,
  Material, MaterialTransparencyMode, PointerEvents, PointerEventType, InputAction, inputSystem,
} from '@dcl/sdk/ecs'
import { Color4, Vector3 } from '@dcl/sdk/math'

const FRONT = -1          // 카메라 쪽 z 방향 (로컬). 깨지면 1
const SIDE = 1            // 패널을 Remy 의 어느 쪽에 둘지. 반대면 -1
const OFFSET_X = 1.7      // Remy 중심에서 패널 중심까지 (m). 이름표(폭 약 1m)와 겹치지 않게
const CENTER_Y = 1.55     // 패널 중심 높이 (Remy 발 기준, m)

const COLS = 2
const BTN_W = 0.9
const BTN_H = 0.32
const GAP = 0.08
const PAD = 0.12
const TITLE_H = 0.3

const AUTO_CLOSE_SEC = 12
const CLOSE_DISTANCE = 12   // 플레이어가 이만큼 멀어지면 닫힘

// 패널(배경)만 반투명, 버튼 판은 불투명.
// (반투명 판끼리는 보는 각도에 따라 그리는 순서가 뒤바뀌어 먼 쪽 버튼이 배경 뒤로 숨는다. 버튼을 불투명으로 두면 해결)
// 패널 이미지의 투명도/모서리/테두리 색은 이미지 안에 들어 있다. 바꾸려면 이미지를 다시 만들어야 한다.
// 이미지는 아래 W, H(2.12 x 1.66 m)와 같은 비율이어야 한다.
const PANEL_IMG = 'assets/remy_panel.png'
const MINT = Color4.create(0.0, 0.85, 0.65, 1)
const BTN = Color4.create(0.13, 0.19, 0.25, 1)

// 판 사이 간격 (m). 너무 좁으면 깜빡이는 z-fighting 이 생긴다
const Z_STEP = 0.04
const TEXT = Color4.create(0.85, 1.0, 0.95, 1)

export type MenuItem<T extends string> = { label: string; intent: T }

type Button = { plate: Entity; text: Entity }

const HIDDEN = Vector3.create(0, -50, 0)

export class RemyMenu<T extends string> {
  private readonly root: Entity
  private readonly title: Entity
  private readonly buttons: Button[] = []
  private target: Entity | null = null
  private openTimer = 0
  private open = false

  constructor(private readonly items: MenuItem<T>[], private readonly onSelect: (intent: T) => void) {
    const rows = Math.ceil(items.length / COLS)
    const w = COLS * BTN_W + (COLS - 1) * GAP + PAD * 2
    const h = TITLE_H + rows * BTN_H + (rows - 1) * GAP + PAD * 2

    this.root = engine.addEntity()
    Transform.create(this.root, { position: HIDDEN })
    Billboard.create(this.root, { billboardMode: BillboardMode.BM_Y })

    const cx = SIDE * OFFSET_X

    // 패널: 둥근 모서리 + 테두리 + 반투명 배경 (이미지 한 장)
    panelPlane(this.root, Vector3.create(cx, CENTER_Y, 0), w, h)

    // 머리글
    const top = CENTER_Y + h / 2
    this.title = engine.addEntity()
    Transform.create(this.title, { parent: this.root, position: Vector3.create(cx, top - PAD - TITLE_H / 2 + 0.02, FRONT * Z_STEP * 2) })
    TextShape.create(this.title, { text: 'REMY', fontSize: 1.0, textColor: MINT })

    // 버튼 (왼쪽 위부터 가로로 채움)
    const gridTop = top - PAD - TITLE_H
    const left = cx - w / 2 + PAD
    items.forEach((item, i) => {
      const col = i % COLS
      const row = Math.floor(i / COLS)
      const x = left + col * (BTN_W + GAP) + BTN_W / 2
      const y = gridTop - row * (BTN_H + GAP) - BTN_H / 2

      const plate = plane(this.root, Vector3.create(x, y, FRONT * Z_STEP), BTN_W, BTN_H, BTN)
      MeshCollider.setPlane(plate)
      PointerEvents.create(plate, {
        pointerEvents: [{
          eventType: PointerEventType.PET_DOWN,
          eventInfo: { button: InputAction.IA_SECONDARY, hoverText: item.label, maxDistance: 20 },
        }],
      })

      const text = engine.addEntity()
      Transform.create(text, { parent: this.root, position: Vector3.create(x, y, FRONT * Z_STEP * 2) })
      TextShape.create(text, { text: item.label, fontSize: 1.1, textColor: TEXT })

      this.buttons.push({ plate, text })
    })

    engine.addSystem((dt: number) => this.update(dt))
  }

  isOpenFor(e: Entity): boolean {
    return this.open && this.target === e
  }

  /** e 옆에 메뉴를 연다. title 은 머리글 (예: "REMY · PetShopBros #1") */
  show(e: Entity, title: string) {
    this.target = e
    this.open = true
    this.openTimer = 0
    TextShape.getMutable(this.title).text = title
    this.follow()
  }

  hide() {
    this.open = false
    this.target = null
    Transform.getMutable(this.root).position = HIDDEN
  }

  private follow() {
    if (!this.target) return
    const p = Transform.get(this.target).position
    Transform.getMutable(this.root).position = Vector3.create(p.x, 0, p.z)
  }

  private update(dt: number) {
    if (!this.open || !this.target) return
    this.follow()

    this.openTimer += dt
    const player = Transform.getOrNull(engine.PlayerEntity)
    const p = Transform.get(this.target).position
    const far = player ? Math.hypot(player.position.x - p.x, player.position.z - p.z) > CLOSE_DISTANCE : false
    if (this.openTimer >= AUTO_CLOSE_SEC || far) { this.hide(); return }

    for (let i = 0; i < this.buttons.length; i++) {
      const cmd = inputSystem.getInputCommand(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN, this.buttons[i].plate)
      if (cmd) {
        this.hide()
        this.onSelect(this.items[i].intent)
        return
      }
    }
  }
}

function plane(parent: Entity, position: Vector3, w: number, h: number, color: Color4): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, scale: Vector3.create(w, h, 1) })
  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, {
    albedoColor: color,
    emissiveColor: Color4.create(color.r, color.g, color.b, 1),
    emissiveIntensity: 0.4,
    transparencyMode: MaterialTransparencyMode.MTM_OPAQUE,
  })
  return e
}

function panelPlane(parent: Entity, position: Vector3, w: number, h: number): Entity {
  const e = engine.addEntity()
  Transform.create(e, { parent, position, scale: Vector3.create(w, h, 1) })
  MeshRenderer.setPlane(e)
  const tex = Material.Texture.Common({ src: PANEL_IMG })
  Material.setPbrMaterial(e, {
    texture: tex,
    emissiveTexture: tex,
    emissiveColor: Color4.White(),
    emissiveIntensity: 1,
    roughness: 1,
    metallic: 0,
    specularIntensity: 0,
    transparencyMode: MaterialTransparencyMode.MTM_ALPHA_BLEND,
  })
  return e
}
