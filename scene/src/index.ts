import { RemyAgent } from './remy'
import { engine, Transform, TextShape, Billboard, BillboardMode, MeshCollider, PointerEvents, PointerEventType, InputAction, inputSystem, Entity, executeTask } from '@dcl/sdk/ecs'
import { loadLandFromScene } from './land'
import { Color4, Vector3 } from '@dcl/sdk/math'
import { buildObservatory } from './observatory'
import { buildScannerScreen } from './scannerScreen'
import { buildSlate } from './slate'
import { RemyMenu } from './remyMenu'

const MENU_ITEMS: { label: string; intent: 'FOLLOW' | 'STOP' | 'EXPLORE' | 'STATUS' | 'EMOTE' | 'REPORT' }[] = [
  { label: '[ FOLLOW ]',  intent: 'FOLLOW'  },
  { label: '[ EXPLORE ]', intent: 'EXPLORE' },
  { label: '[ STATUS ]',  intent: 'STATUS'  },
  { label: '[ EMOTE ]',   intent: 'EMOTE'   },
  { label: '[ REPORT ]',  intent: 'REPORT'  },
  { label: '[ STOP ]',    intent: 'STOP'    },
]

let active: RemyAgent | null = null
let menu: RemyMenu<typeof MENU_ITEMS[number]['intent']> | null = null

let statusEntity: Entity | null = null
let reportEntity: Entity | null = null
let reportTimer = 0
let reportVisible = false

function showReport() {
  const remy = active?.entity
  const basePos = remy ? Transform.get(remy).position : Vector3.create(8, 0, 8)
  if (!reportEntity) {
    reportEntity = engine.addEntity()
    Billboard.create(reportEntity, { billboardMode: BillboardMode.BM_Y })
  }
  Transform.createOrReplace(reportEntity, {
    position: Vector3.create(basePos.x, basePos.y + 1.2, basePos.z)
  })
  TextShape.createOrReplace(reportEntity, {
    text: '[ REPORT ]\nLoading...',
    fontSize: 1.1,
    textColor: { r: 0.0, g: 1.0, b: 0.2, a: 1.0 },
  })
  reportTimer = 0
  reportVisible = true

  fetch('https://remy-dcl-relay-roan.vercel.app/api/report')
    .then(r => r.json())
    .then((d: any) => {
      if (!reportEntity) return
      const text = d.ok
        ? `[ REMY REPORT ]\nExplored : ${d.explored}\nMoved    : ${d.moved}\nDiscovered: ${d.discovered}\nLast Parcel: ${d.lastParcel}\nLast Scan: ${d.lastScan}`
        : `[ REPORT ]\nError: ${d.error}`
      TextShape.getMutable(reportEntity).text = text
    })
    .catch(() => {
      if (!reportEntity) return
      TextShape.getMutable(reportEntity).text = '[ REPORT ]\nFetch failed'
    })
}

function showStatus() {
  const remy = active?.entity
  const basePos = remy ? Transform.get(remy).position : Vector3.create(8, 0, 8)
  if (!statusEntity) {
    statusEntity = engine.addEntity()
    Billboard.create(statusEntity, { billboardMode: BillboardMode.BM_Y })
  }
  Transform.createOrReplace(statusEntity, {
    position: Vector3.create(basePos.x, basePos.y + 1.2, basePos.z)
  })
  TextShape.createOrReplace(statusEntity, {
    text: active ? active.status() : 'Offline',
    fontSize: 1.2,
    textColor: { r: 0.0, g: 1.0, b: 0.2, a: 1.0 },
  })
  statusTimer = 0
  statusVisible = true
}

let statusTimer = 0
let statusVisible = false

engine.addSystem(() => {
  if (statusVisible && statusEntity) {
    const remy = active?.entity
    if (remy) {
      const basePos = Transform.get(remy).position
      Transform.getMutable(statusEntity).position = Vector3.create(basePos.x, basePos.y + 1.2, basePos.z)
    }
    statusTimer += 1/30
    if (statusTimer >= 5.0) {
      statusTimer = 0
      statusVisible = false
      TextShape.getMutable(statusEntity).text = ''
    }
  }
  if (reportVisible && reportEntity) {
    const remy = active?.entity
    if (remy) {
      const basePos = Transform.get(remy).position
      Transform.getMutable(reportEntity).position = Vector3.create(basePos.x, basePos.y + 1.2, basePos.z)
    }
    reportTimer += 1/30
    if (reportTimer >= 10.0) {
      reportTimer = 0
      reportVisible = false
      TextShape.getMutable(reportEntity).text = ''
    }
  }
})

export function main() {
  // scene.json 의 파셀 목록을 읽어 땅 모양을 맞춘다 (다른 땅에 배포해도 그 땅 안에서만 걷는다)
  executeTask(async () => { await loadLandFromScene() })
  buildObservatory()
  buildScannerScreen()
  buildSlate()
  menu = new RemyMenu(MENU_ITEMS, (intent) => {
    if (intent === 'STATUS') showStatus()
    else if (intent === 'REPORT') showReport()
    else active?.intent(intent)
  })
  // 세 마리 모두 자유롭게 걷는다. 24시간 파셀 수집은 GitHub Actions(remy1~3)가 맡는다.
  const onClick = (r: RemyAgent) => {
    if (!menu) return
    if (menu.isOpenFor(r.entity)) { menu.hide(); return }
    active = r
    menu.show(r.entity, `${r.name.toUpperCase()} · ${r.tag}`)
  }
  active = new RemyAgent({
    name: 'Remy', tag: 'PetShopBros #1', spawn: { x: 8, z: 8 },
    poll: true, collect: true, agent: 'remy', onClick,
  })
  new RemyAgent({
    name: 'Remy', tag: 'PetShopBros #2', spawn: { x: 24, z: 6 },
    model: 'assets/rat_amber.glb', tint: Color4.create(1, 0.69, 0.13, 1), onClick,
  })
  new RemyAgent({
    name: 'Remy', tag: 'PetShopBros #3', spawn: { x: -8, z: -8 },
    model: 'assets/rat_violet.glb', tint: Color4.create(0.62, 0.42, 1, 1), onClick,
  })
}