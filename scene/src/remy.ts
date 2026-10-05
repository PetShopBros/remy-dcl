import { engine, Transform, Animator, GltfContainer, TextShape, Billboard, BillboardMode, Entity, PointerEvents, PointerEventType, InputAction, MeshCollider, MeshRenderer, inputSystem } from '@dcl/sdk/ecs'
import { Vector3, Quaternion } from '@dcl/sdk/math'

export const RELAY_URL = (globalThis as any).REMY_RELAY_URL ?? 'https://remy-dcl-relay-roan.vercel.app'
const POLL_INTERVAL        = 1.5
const MOVE_DURATION        = 4.0
const EXPLORE_IDLE_TIMEOUT = 6.0
const EMOTE_INTERVAL       = 8.0

type AnimClip = 'Armature|Idle' | 'Armature|Walk' | 'Armature|Attack' | 'Armature|Hit'
type Phase = 'idle' | 'moving' | 'exploring' | 'following'

let phase: Phase = 'idle'
let followTimer = 0
const FOLLOW_UPDATE_INTERVAL = 0.1
const FOLLOW_DISTANCE = 2.5
let pollTimer    = 0
let moveTimer    = 0
let idleTimer    = 0
let emoteTimer   = 0
let isEmoting    = false
let emoteDuration = 0
let moveStartTime = 0
let moveFrom = Vector3.create(0, 0, 0)
let moveTo   = Vector3.create(0, 0, 0)
let currentParcel = '46,115'
let currentCommandId: string | null = null

let remyEntity:       Entity | null = null
let labelEntity:      Entity | null = null
let remyClickTarget:  Entity | null = null
let clickCallback:    (() => void) | null = null

export function setClickCallback(cb: () => void) { clickCallback = cb }

const PARCEL_BOUNDS = { minX: -22, maxX: 38, minZ: -30, maxZ: 30 }
const MAX_STEP = 8

export function getRemyEntity() { return remyEntity }

export function getRemyStatus(): string {
  if (!remyEntity) return 'Offline'
  const tf = Transform.get(remyEntity)
  const x = tf.position.x.toFixed(1)
  const z = tf.position.z.toFixed(1)
  return `Phase: ${phase}\nPos: ${x}, ${z}\nParcel: ${currentParcel}`
}

export function executeIntent(intent: 'FOLLOW' | 'MOVE_TO' | 'STOP' | 'EXPLORE' | 'STATUS' | 'EMOTE') {
  switch (intent) {
    case 'EXPLORE':
      idleTimer = EXPLORE_IDLE_TIMEOUT
      break
    case 'STOP':
      phase = 'idle'
      idleTimer = 0
      setClip('Armature|Idle')
      break
    case 'FOLLOW':
      phase = 'following'
      followTimer = 0
      setClip('Armature|Walk')
      break
    case 'STATUS':
      break
    case 'EMOTE':
      if (phase === 'idle') {
        const emotes: AnimClip[] = ['Armature|Attack', 'Armature|Hit']
        const pick = emotes[Math.floor(Math.random() * emotes.length)]
        isEmoting = true
        emoteDuration = 1.5
        setClip(pick)
      }
      break
    case 'MOVE_TO':
      break
  }
}

export function setupRemy(spawnX: number, spawnZ: number, onClickCb?: () => void) {
  if (onClickCb) clickCallback = onClickCb
  remyEntity = engine.addEntity()
  Transform.create(remyEntity, {
    position: Vector3.create(spawnX, 0.1, spawnZ),
    scale:    Vector3.create(0.5, 0.5, 0.5),
    rotation: Quaternion.fromEulerDegrees(0, 180, 0),
  })
  GltfContainer.create(remyEntity, { src: 'assets/rat.glb' })
  Animator.create(remyEntity, {
    states: [
      { clip: 'Armature|Idle',   playing: true,  loop: true,  speed: 1.0 },
      { clip: 'Armature|Walk',   playing: false, loop: true,  speed: 1.0 },
      { clip: 'Armature|Attack', playing: false, loop: false, speed: 1.0 },
      { clip: 'Armature|Hit',    playing: false, loop: false, speed: 1.0 },
    ],
  })

  remyClickTarget = engine.addEntity()
  Transform.create(remyClickTarget, {
    position: Vector3.create(spawnX, 0.7, spawnZ),
    scale: Vector3.create(1.0, 1.4, 1.0),
  })
  MeshCollider.setBox(remyClickTarget)
  PointerEvents.create(remyClickTarget, {
    pointerEvents: [{
      eventType: PointerEventType.PET_DOWN,
      eventInfo: { button: InputAction.IA_SECONDARY, hoverText: 'Talk to Remy [F]', maxDistance: 15 },
    }],
  })

  labelEntity = engine.addEntity()
  Transform.create(labelEntity, { position: Vector3.create(spawnX, 2.2, spawnZ) })
  TextShape.create(labelEntity, { text: 'Remy\nPetShopBros #1', fontSize: 1.5 })
  Billboard.create(labelEntity, { billboardMode: BillboardMode.BM_Y })

  engine.addSystem(remySystem)
}

function setClip(clip: AnimClip) {
  if (!remyEntity) return
  const anim = Animator.getMutable(remyEntity)
  for (const s of anim.states) { s.playing = s.clip === clip }
}

function remySystem(dt: number) {
  if (remyClickTarget) {
    const cmd = inputSystem.getInputCommand(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN, remyClickTarget)
    if (cmd) { if (clickCallback) clickCallback() }
  }
  if (phase === 'idle') {
    pollTimer  += dt
    idleTimer  += dt
    emoteTimer += dt
    if (pollTimer >= POLL_INTERVAL) { pollTimer = 0; void pollCommand() }
    if (idleTimer >= EXPLORE_IDLE_TIMEOUT) { idleTimer = 0; startExplore() }
    if (!isEmoting && emoteTimer >= EMOTE_INTERVAL) {
      emoteTimer = 0
      isEmoting  = true
      const emotes: AnimClip[] = ['Armature|Attack', 'Armature|Hit']
      const pick = emotes[Math.floor(Math.random() * emotes.length)]
      emoteDuration = 1.0
      setClip(pick)
    }
    if (isEmoting) {
      emoteDuration -= dt
      if (emoteDuration <= 0) {
        isEmoting = false
        setClip('Armature|Idle')
      }
    }
  }
  if (phase === 'following' && remyEntity) {
    const player = Transform.getOrNull(engine.PlayerEntity)
    if (!player) {
      phase = 'exploring'
      startExplore()
    } else {
      const px = player.position.x
      const pz = player.position.z
      const inBounds = px >= PARCEL_BOUNDS.minX && px <= PARCEL_BOUNDS.maxX &&
                       pz >= PARCEL_BOUNDS.minZ && pz <= PARCEL_BOUNDS.maxZ
      if (!inBounds) {
        phase = 'exploring'
        startExplore()
      } else {
        const tf = Transform.getMutable(remyEntity)
        const dx = px - tf.position.x
        const dz = pz - tf.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist > FOLLOW_DISTANCE) {
          const speed = 4.0 * dt
          const ratio = (dist - FOLLOW_DISTANCE) / dist
          tf.position.x += dx * ratio * speed
          tf.position.z += dz * ratio * speed
          if (Math.abs(dx) + Math.abs(dz) > 0.01) {
            tf.rotation = Quaternion.fromEulerDegrees(0, Math.atan2(dx, dz) * (180 / Math.PI), 0)
          }
          setClip('Armature|Walk')
          if (labelEntity) {
            const ltf = Transform.getMutable(labelEntity)
            ltf.position = Vector3.create(tf.position.x, tf.position.y + 2.1, tf.position.z)
          }
          if (remyClickTarget) {
            const ctf = Transform.getMutable(remyClickTarget)
            ctf.position = Vector3.create(tf.position.x, tf.position.y + 0.7, tf.position.z)
          }
        } else {
          setClip('Armature|Idle')
        }
      }
    }
  }

  if ((phase === 'moving' || phase === 'exploring') && remyEntity) {
    moveTimer += dt
    const t = Math.min(moveTimer / MOVE_DURATION, 1)
    const tf = Transform.getMutable(remyEntity)
    tf.position = Vector3.lerp(moveFrom, moveTo, easeInOut(t))
    const dx = moveTo.x - moveFrom.x
    const dz = moveTo.z - moveFrom.z
    if (Math.abs(dx) + Math.abs(dz) > 0.01) {
      tf.rotation = Quaternion.fromEulerDegrees(0, Math.atan2(dx, dz) * (180 / Math.PI), 0)
    }
    if (labelEntity) {
      const ltf = Transform.getMutable(labelEntity)
      ltf.position = Vector3.create(tf.position.x, tf.position.y + 2.1, tf.position.z)
    }
    if (remyClickTarget) {
      const ctf = Transform.getMutable(remyClickTarget)
      ctf.position = Vector3.create(tf.position.x, tf.position.y + 0.7, tf.position.z)
    }
    if (t >= 1) {
      setClip('Armature|Idle')
      void reportStatus('success', Date.now() - moveStartTime)
      if (currentExploreId) {
        void fetch(`${RELAY_URL}/api/explore-complete?id=${encodeURIComponent(currentExploreId)}`)
        currentExploreId = null
      }
      phase = 'idle'
      idleTimer = 0
    }
  }
}

function easeInOut(t: number) { return t < 0.5 ? 2*t*t : -1+(4-2*t)*t }

function randomInBounds() {
  if (!remyEntity) return { x: 8, z: 8 }
  const tf = Transform.get(remyEntity)
  const dx = (Math.random() - 0.5) * 2 * MAX_STEP
  const dz = (Math.random() - 0.5) * 2 * MAX_STEP
  const x = Math.max(PARCEL_BOUNDS.minX, Math.min(PARCEL_BOUNDS.maxX, tf.position.x + dx))
  const z = Math.max(PARCEL_BOUNDS.minZ, Math.min(PARCEL_BOUNDS.maxZ, tf.position.z + dz))
  return { x, z }
}

function parcelFromPos(x: number, z: number): string {
  const px = Math.floor(x / 16)
  const pz = Math.floor(z / 16)
  return `${46 + px},${115 + pz}`
}

let currentExploreId: string | null = null

function startExplore() {
  if (!remyEntity || phase !== 'idle') return
  const dest = randomInBounds()
  const tf = Transform.get(remyEntity)
  moveFrom  = Vector3.clone(tf.position)
  moveTo    = Vector3.create(dest.x, 0.1, dest.z)
  currentParcel    = parcelFromPos(dest.x, dest.z)
  currentCommandId = null
  moveTimer    = 0
  moveStartTime = Date.now()
  idleTimer = -(2 + Math.random() * 3)
  phase = 'exploring'
  setClip('Armature|Walk')
  void claimNextParcel()
}

async function claimNextParcel() {
  try {
    const res = await fetch(`${RELAY_URL}/api/explore-next?agent=remy`)
    const data = await res.json() as any
    if (data.ok && data.parcel) {
      currentExploreId = data.parcel.id
      currentParcel = data.parcel.id
    }
  } catch { /* ignore */ }
}

async function pollCommand() {
  try {
    const res  = await fetch(`${RELAY_URL}/api/command`)
    const data = (await res.json()) as { ok: boolean; command: RemyCommand | null }
    if (data.ok && data.command) executeCommand(data.command)
  } catch { /* skip */ }
}

type RemyCommand = { id: string; action: 'move'; x: number; y?: number; z: number; parcel?: string }

function executeCommand(cmd: RemyCommand) {
  currentCommandId = cmd.id
  if (!remyEntity || phase !== 'idle') return
  if (cmd.action === 'move') {
    const tf = Transform.get(remyEntity)
    moveFrom  = Vector3.clone(tf.position)
    moveTo    = Vector3.create(cmd.x, cmd.y ?? 0.1, cmd.z)
    if (cmd.parcel) currentParcel = cmd.parcel
    moveTimer = 0
    moveStartTime = Date.now()
    idleTimer = 0
    phase = 'moving'
    setClip('Armature|Walk')
  }
}

async function reportStatus(outcome: 'success' | 'failure', latency_ms: number) {
  const isExplore = currentCommandId === null
  if (!isExplore) {
    try {
      await fetch(`${RELAY_URL}/api/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: currentCommandId, action: 'move', status: outcome, position: moveTo }),
      })
    } catch { /* ignore */ }
  }
  try {
    await fetch(`${RELAY_URL}/api/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        actor: 'remy',
        target: `dcl:${currentParcel}`,
        target_type: 'dcl_parcel',
        task_type: isExplore ? 'explore' : 'move',
        outcome,
        from: { x: moveFrom.x, z: moveFrom.z },
        to:   { x: moveTo.x,   z: moveTo.z },
        latency_ms,
      }),
    })
  } catch { /* ignore */ }
  if (!isExplore) currentCommandId = null
}