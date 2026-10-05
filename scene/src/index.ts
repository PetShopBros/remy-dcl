import { setupRemy, executeIntent, getRemyEntity, getRemyStatus } from './remy'
import { engine, Transform, TextShape, Billboard, BillboardMode, MeshCollider, PointerEvents, PointerEventType, InputAction, inputSystem, Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

const MENU_ITEMS: { label: string; intent: 'FOLLOW' | 'STOP' | 'EXPLORE' | 'STATUS' | 'EMOTE' | 'REPORT' }[] = [
  { label: '[ FOLLOW ]',  intent: 'FOLLOW'  },
  { label: '[ EXPLORE ]', intent: 'EXPLORE' },
  { label: '[ STATUS ]',  intent: 'STATUS'  },
  { label: '[ EMOTE ]',   intent: 'EMOTE'   },
  { label: '[ REPORT ]',  intent: 'REPORT'  },
  { label: '[ STOP ]',    intent: 'STOP'    },
]

let menuVisible = false
const menuEntities: Entity[] = []

let statusEntity: Entity | null = null
let reportEntity: Entity | null = null
let reportTimer = 0
let reportVisible = false

function showReport() {
  const remy = getRemyEntity()
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
  const remy = getRemyEntity()
  const basePos = remy ? Transform.get(remy).position : Vector3.create(8, 0, 8)
  if (!statusEntity) {
    statusEntity = engine.addEntity()
    Billboard.create(statusEntity, { billboardMode: BillboardMode.BM_Y })
  }
  Transform.createOrReplace(statusEntity, {
    position: Vector3.create(basePos.x, basePos.y + 1.2, basePos.z)
  })
  TextShape.createOrReplace(statusEntity, {
    text: getRemyStatus(),
    fontSize: 1.2,
    textColor: { r: 0.0, g: 1.0, b: 0.2, a: 1.0 },
  })
  statusTimer = 0
  statusVisible = true
}

let statusTimer = 0
let statusVisible = false

function buildMenu() {
  MENU_ITEMS.forEach((item, i) => {
    const e = engine.addEntity()
    Transform.create(e, { position: Vector3.create(0, -100, 0) })
    TextShape.create(e, { text: '', fontSize: 1.4 })
    Billboard.create(e, { billboardMode: BillboardMode.BM_Y })
    MeshCollider.setBox(e)
    PointerEvents.create(e, {
      pointerEvents: [{
        eventType: PointerEventType.PET_DOWN,
        eventInfo: { button: InputAction.IA_SECONDARY, hoverText: item.label, maxDistance: 20 },
      }],
    })
    menuEntities.push(e)
  })
}

function setMenuVisible(v: boolean) {
  menuVisible = v
  const remy = getRemyEntity()
  const basePos = remy ? Transform.get(remy).position : Vector3.create(8, 0, 8)
  menuEntities.forEach((e, i) => {
    Transform.getMutable(e).position = v ? Vector3.create(basePos.x, basePos.y + 3.8 - i * 0.65, basePos.z) : Vector3.create(0, -100, 0)
    TextShape.getMutable(e).text = v ? MENU_ITEMS[i].label : ''
  })
}

engine.addSystem(() => {
  if (statusVisible && statusEntity) {
    const remy = getRemyEntity()
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
    const remy = getRemyEntity()
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
  if (!menuVisible) return
  const remy = getRemyEntity()
  if (remy) {
    const basePos = Transform.get(remy).position
    menuEntities.forEach((e, i) => {
      Transform.getMutable(e).position = Vector3.create(basePos.x, basePos.y + 3.8 - i * 0.65, basePos.z)
    })
  }
  menuEntities.forEach((e, i) => {
    const cmd = inputSystem.getInputCommand(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN, e)
    if (cmd) {
      if (MENU_ITEMS[i].intent === 'STATUS') {
        showStatus()
      } else if (MENU_ITEMS[i].intent === 'REPORT') {
        showReport()
      } else {
        executeIntent(MENU_ITEMS[i].intent as any)
      }
      setMenuVisible(false)
    }
  })
})

export function main() {
  buildMenu()
  setupRemy(8, 8, () => { setMenuVisible(!menuVisible) })
}