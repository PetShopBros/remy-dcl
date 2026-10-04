import { setupRemy, executeIntent, getRemyEntity } from './remy'
import { engine, Transform, TextShape, Billboard, BillboardMode, MeshCollider, PointerEvents, PointerEventType, InputAction, inputSystem, Entity } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'

const MENU_ITEMS: { label: string; intent: 'FOLLOW' | 'MOVE_TO' | 'STOP' | 'EXPLORE' }[] = [
  { label: '[ FOLLOW ]',  intent: 'FOLLOW'  },
  { label: '[ MOVE TO ]', intent: 'MOVE_TO' },
  { label: '[ STOP ]',    intent: 'STOP'    },
  { label: '[ EXPLORE ]', intent: 'EXPLORE' },
]

let menuVisible = false
const menuEntities: Entity[] = []

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
      executeIntent(MENU_ITEMS[i].intent)
      setMenuVisible(false)
    }
  })
})

export function main() {
  buildMenu()
  setupRemy(8, 8, () => { setMenuVisible(!menuVisible) })
}