import { engine, Transform, Animator, GltfContainer, TextShape, Billboard, BillboardMode, Entity } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

// ?€?€ Config ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
export const RELAY_URL = (globalThis as any).REMY_RELAY_URL ?? 'https://remy-dcl-relay-guan.vercel.app'
const POLL_INTERVAL = 1.5  // seconds between polls
const MOVE_DURATION = 2.0  // seconds to walk to target

// ?€?€ State ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
type Phase = 'idle' | 'moving'
let phase: Phase = 'idle'
let pollTimer = 0
let moveTimer = 0
let moveFrom = Vector3.create(0, 0, 0)
let moveTo = Vector3.create(0, 0, 0)

let remyEntity: Entity | null = null
let labelEntity: Entity | null = null

// ?€?€ Setup ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
export function setupRemy(spawnX: number, spawnZ: number) {
  remyEntity = engine.addEntity()
  Transform.create(remyEntity, {
    position: Vector3.create(spawnX, 0.1, spawnZ),
    scale: Vector3.create(0.5, 0.5, 0.5),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0),
  })
  GltfContainer.create(remyEntity, { src: 'assets/rat.glb' })
  Animator.create(remyEntity, {
    states: [
      { clip: 'Armature|Idle', playing: true,  loop: true, speed: 1.0 },
      { clip: 'Armature|Walk', playing: false, loop: true, speed: 1.0 },
    ],
  })

  labelEntity = engine.addEntity()
  Transform.create(labelEntity, {
    position: Vector3.create(spawnX, 2.2, spawnZ),
  })
  TextShape.create(labelEntity, {
    text: 'Remy\nPetShopBros #1',
    fontSize: 1.5,
  })
  Billboard.create(labelEntity, { billboardMode: BillboardMode.BM_Y })

  engine.addSystem(remySystem)
}

// ?€?€ Animation ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function setClip(clip: 'Armature|Idle' | 'Armature|Walk') {
  if (!remyEntity) return
  const anim = Animator.getMutable(remyEntity)
  for (const s of anim.states) {
    s.playing = s.clip === clip
  }
}

// ?€?€ System ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
function remySystem(dt: number) {
  if (phase === 'idle') {
    pollTimer += dt
    if (pollTimer >= POLL_INTERVAL) {
      pollTimer = 0
      void pollCommand()
    }
  }

  if (phase === 'moving' && remyEntity) {
    moveTimer += dt
    const t = Math.min(moveTimer / MOVE_DURATION, 1)
    const tf = Transform.getMutable(remyEntity)
    tf.position = Vector3.lerp(moveFrom, moveTo, easeInOut(t))

    // face direction of travel
    const dx = moveTo.x - moveFrom.x
    const dz = moveTo.z - moveFrom.z
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      const angle = Math.atan2(dx, dz) * (180 / Math.PI)
      tf.rotation = Quaternion.fromEulerDegrees(0, angle, 0)
    }

    // sync label
    if (labelEntity) {
      const ltf = Transform.getMutable(labelEntity)
      ltf.position = Vector3.create(tf.position.x, tf.position.y + 2.1, tf.position.z)
    }

    if (t >= 1) {
      setClip('Armature|Idle')
      phase = 'idle'
      void reportStatus({ action: 'move', status: 'success', position: moveTo })
    }
  }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
}

// ?€?€ Relay I/O ?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€?€
async function pollCommand() {
  try {
    const res = await fetch(`${RELAY_URL}/api/command`)
    const data = (await res.json()) as { ok: boolean; command: RemyCommand | null }
    if (data.ok && data.command) {
      executeCommand(data.command)
    }
  } catch { /* network issues ??skip */ }
}

type RemyCommand = { action: 'move'; x: number; y?: number; z: number }

function executeCommand(cmd: RemyCommand) {
  if (!remyEntity || phase !== 'idle') return

  if (cmd.action === 'move') {
    const tf = Transform.get(remyEntity)
    moveFrom = Vector3.clone(tf.position)
    moveTo = Vector3.create(cmd.x, cmd.y ?? 0.1, cmd.z)
    moveTimer = 0
    phase = 'moving'
    setClip('Armature|Walk')
  }
}

async function reportStatus(result: unknown) {
  try {
    await fetch(`${RELAY_URL}/api/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    })
  } catch { /* ignore */ }
}
