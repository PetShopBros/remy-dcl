// 제품 모니터: 레이더 타워 북쪽에 원형 모니터 3개 (민트 원 + 검정 글자). 제품 하나당 모니터 하나.
// 클릭하면 링크가 열리고, relay /api/click 으로 Lowdown(interactions)에 기록된다.
import {
  engine, Entity, Transform, MeshRenderer, MeshCollider, Material, TextShape, pointerEventsSystem, InputAction,
} from '@dcl/sdk/ecs'
import { Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { openExternalUrl } from '~system/RestrictedActions'
import { PANEL, MINT, box } from './observatory'

const RELAY = 'https://remy-dcl-relay-roan.vercel.app'
const SCANNER_PAGE = `${RELAY}/scanner.html`

interface Monitor {
  id: string        // relay/api/click.ts 의 허용 목록과 같아야 한다
  title: string
  body: string
  footer: string
  url: string
  angle: number     // 타워 기준 각도 (0 = 북쪽, 양수 = 동쪽)
}

const MONITORS: Monitor[] = [
  {
    id: 'dcl-agent-mcp', angle: -50,
    title: 'DCL-AGENT-MCP',
    body: 'Give your AI agent\na body in\nDecentraland.',
    footer: 'npm: dcl-agent-mcp',
    url: 'https://www.npmjs.com/package/dcl-agent-mcp',
  },
  {
    id: 'lowdown', angle: 0,
    title: 'LOWDOWN',
    body: 'What happens when\nAI acts in the\nreal world?',
    footer: 'Live agent data',
    url: SCANNER_PAGE, // TODO: Lowdown 소개 페이지 주소가 정해지면 교체
  },
  {
    id: 'remy', angle: 50,
    title: 'REMY',
    body: 'An AI NPC scanning\nthis world, one\nparcel at a time.',
    footer: 'See the live map',
    url: SCANNER_PAGE,
  },
]

// 타워 중심(observatory.ts 와 같은 값)과 모니터 배치
const TOWER_X = 0
const TOWER_Z = -16
const RADIUS = 7            // 타워에서 모니터까지 거리
const CENTER_Y = 2.4
const DIAMETER = 3.4
const DISC_THICK = 0.12

// 글자가 거울처럼 뒤집혀 보이면 180 으로 바꾼다. (TextShape 기본 방향은 문서에 없어서 확인이 필요)
const TEXT_YAW_OFFSET = 0

const BLACK = Color4.create(0.02, 0.03, 0.04, 1)
const FOOTER_DEFAULT_SUFFIX = ' >'
const SIZE = { title: 4.2, body: 2.8, footer: 2.2 }

function text(pos: Vector3, yaw: number, value: string, fontSize: number): Entity {
  const e = engine.addEntity()
  Transform.create(e, { position: pos, rotation: Quaternion.fromEulerDegrees(0, yaw, 0) })
  TextShape.create(e, { text: value, fontSize, textColor: BLACK })
  return e
}

export function buildSlate() {
  const footers: Array<{ entity: Entity; label: string; until: number }> = []
  let t = 0

  for (const m of MONITORS) {
    const rad = (m.angle * Math.PI) / 180
    const nx = Math.sin(rad), nz = Math.cos(rad)             // 바깥(방문자) 방향
    const cx = TOWER_X + RADIUS * nx, cz = TOWER_Z + RADIUS * nz
    const facing = Quaternion.fromEulerDegrees(90, m.angle, 0) // 원판 면이 바깥을 향하도록 눕힌 원기둥
    const at = (d: number, y: number) => Vector3.create(cx + nx * d, y, cz + nz * d)

    // 받침대 + 어두운 테두리 + 민트 원판
    box(Vector3.create(cx - nx * 0.25, (CENTER_Y - DIAMETER / 2) / 2, cz - nz * 0.25), Vector3.create(0.2, CENTER_Y - DIAMETER / 2, 0.2), PANEL)

    const bezel = engine.addEntity()
    Transform.create(bezel, { position: at(-0.07, CENTER_Y), scale: Vector3.create(DIAMETER + 0.35, 0.1, DIAMETER + 0.35), rotation: facing })
    MeshRenderer.setCylinder(bezel)
    Material.setPbrMaterial(bezel, PANEL)

    const disc = engine.addEntity()
    Transform.create(disc, { position: at(0, CENTER_Y), scale: Vector3.create(DIAMETER, DISC_THICK, DIAMETER), rotation: facing })
    MeshRenderer.setCylinder(disc)
    MeshCollider.setCylinder(disc)
    Material.setPbrMaterial(disc, MINT)

    // 고정 글자 (Billboard 없음): 원판 바깥 면 바로 앞에 붙인다
    const yaw = m.angle + 180 + TEXT_YAW_OFFSET
    const d = DISC_THICK / 2 + 0.04
    text(at(d, CENTER_Y + 1.05), yaw, m.title, SIZE.title)
    text(at(d, CENTER_Y + 0.05), yaw, m.body, SIZE.body)
    const footer = text(at(d, CENTER_Y - 1.05), yaw, m.footer + FOOTER_DEFAULT_SUFFIX, SIZE.footer)
    const rec = { entity: footer, label: m.footer + FOOTER_DEFAULT_SUFFIX, until: 0 }
    footers.push(rec)

    pointerEventsSystem.onPointerDown(
      { entity: disc, opts: { button: InputAction.IA_POINTER, hoverText: `OPEN ${m.title}`, maxDistance: 14 } },
      () => {
        TextShape.getMutable(rec.entity).text = 'OPENING...'
        rec.until = t + 3
        void openExternalUrl({ url: m.url })
        // 클릭 기록 (실패해도 링크 열기에는 영향 없음)
        void fetch(`${RELAY}/api/click?slide=${encodeURIComponent(m.id)}`).catch(() => {})
      }
    )
  }

  // 클릭 3초 뒤 안내 문구 복귀
  engine.addSystem((dt: number) => {
    t += dt
    for (const f of footers) {
      if (f.until > 0 && t >= f.until) {
        f.until = 0
        TextShape.getMutable(f.entity).text = f.label
      }
    }
  }, 1, 'product-monitors')
}
