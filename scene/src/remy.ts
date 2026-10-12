import { engine, Transform, Animator, GltfContainer, TextShape, Billboard, BillboardMode, Entity, PointerEvents, PointerEventType, InputAction, MeshCollider, inputSystem } from '@dcl/sdk/ecs'
import { isOnLand, isWalkable, parcelIdAt, randomWalkablePoint } from './land'
import { Color4, Vector3, Quaternion } from '@dcl/sdk/math'

export const RELAY_URL = (globalThis as any).REMY_RELAY_URL ?? 'https://remy-dcl-relay-roan.vercel.app'
const POLL_INTERVAL        = 1.5
const MOVE_DURATION        = 4.0
const EXPLORE_IDLE_TIMEOUT = 6.0
const EMOTE_INTERVAL       = 8.0
const FOLLOW_DISTANCE      = 2.5
const EDGE_MARGIN          = 1.5   // 땅 경계에서 이만큼 안쪽까지만 걷는다 (land.ts 의 실제 파셀 모양 기준)
const MAX_STEP             = 8

type AnimClip = 'Armature|Idle' | 'Armature|Walk' | 'Armature|Attack' | 'Armature|Hit'
type Phase = 'idle' | 'moving' | 'exploring' | 'following'
export type Intent = 'FOLLOW' | 'MOVE_TO' | 'STOP' | 'EXPLORE' | 'STATUS' | 'EMOTE'

export interface RemyOptions {
  name: string                 // 이름표 첫 줄
  tag: string                  // 이름표 둘째 줄
  spawn: { x: number; z: number }
  model?: string               // 없으면 원본 모델. 어두운 털 색만 바꾼 모델 파일 경로
  tint?: Color4                // 이름표 글자 색
  poll?: boolean               // 릴레이 명령(/api/command)을 받는 마리 (1번만)
  collect?: boolean            // 방문자가 있을 때 파셀을 직접 가져오는 마리 (GitHub Actions 와 별개)
  agent?: string               // collect 일 때 Lowdown actor 이름
  onClick?: (r: RemyAgent) => void
}

export class RemyAgent {
  readonly entity: Entity
  readonly label: Entity
  readonly clickTarget: Entity
  readonly name: string
  readonly tag: string

  private phase: Phase = 'idle'
  private pollTimer = 0
  private moveTimer = 0
  private idleTimer = 0
  private emoteTimer = 0
  private isEmoting = false
  private emoteDuration = 0
  private moveStartTime = 0
  private moveFrom = Vector3.create(0, 0, 0)
  private moveTo = Vector3.create(0, 0, 0)
  private currentParcel: string
  private currentCommandId: string | null = null
  private currentExploreId: string | null = null
  private readonly o: RemyOptions

  constructor(o: RemyOptions) {
    this.o = o
    this.name = o.name
    this.tag = o.tag
    const { x, z } = o.spawn
    this.currentParcel = parcelIdAt(x, z)

    this.entity = engine.addEntity()
    Transform.create(this.entity, {
      position: Vector3.create(x, 0.1, z),
      scale: Vector3.create(0.5, 0.5, 0.5),
      rotation: Quaternion.fromEulerDegrees(0, 180, 0),
    })
    GltfContainer.create(this.entity, { src: o.model ?? 'assets/rat.glb' })
    Animator.create(this.entity, {
      states: [
        { clip: 'Armature|Idle',   playing: true,  loop: true,  speed: 1.0 },
        { clip: 'Armature|Walk',   playing: false, loop: true,  speed: 1.0 },
        { clip: 'Armature|Attack', playing: false, loop: false, speed: 1.0 },
        { clip: 'Armature|Hit',    playing: false, loop: false, speed: 1.0 },
      ],
    })

    this.clickTarget = engine.addEntity()
    Transform.create(this.clickTarget, { position: Vector3.create(x, 0.7, z), scale: Vector3.create(1.0, 1.4, 1.0) })
    MeshCollider.setBox(this.clickTarget)
    PointerEvents.create(this.clickTarget, {
      pointerEvents: [{
        eventType: PointerEventType.PET_DOWN,
        eventInfo: { button: InputAction.IA_SECONDARY, hoverText: `Talk to ${o.name} [F]`, maxDistance: 15 },
      }],
    })

    this.label = engine.addEntity()
    Transform.create(this.label, { position: Vector3.create(x, 2.2, z) })
    TextShape.create(this.label, { text: `${o.name}\n${o.tag}`, fontSize: 1.5, ...(o.tint ? { textColor: o.tint } : {}) })
    Billboard.create(this.label, { billboardMode: BillboardMode.BM_Y })

    engine.addSystem((dt: number) => this.update(dt))
  }

  status(): string {
    const tf = Transform.get(this.entity)
    return `${this.name}\nPhase: ${this.phase}\nPos: ${tf.position.x.toFixed(1)}, ${tf.position.z.toFixed(1)}\nParcel: ${this.currentParcel}`
  }

  intent(intent: Intent) {
    switch (intent) {
      case 'EXPLORE': this.idleTimer = EXPLORE_IDLE_TIMEOUT; break
      case 'STOP':
        this.phase = 'idle'; this.idleTimer = 0; this.setClip('Armature|Idle'); break
      case 'FOLLOW':
        this.phase = 'following'; this.setClip('Armature|Walk'); break
      case 'EMOTE':
        if (this.phase === 'idle') {
          const emotes: AnimClip[] = ['Armature|Attack', 'Armature|Hit']
          this.isEmoting = true
          this.emoteDuration = 1.5
          this.setClip(emotes[Math.floor(Math.random() * emotes.length)])
        }
        break
      default: break
    }
  }

  private setClip(clip: AnimClip) {
    const anim = Animator.getMutable(this.entity)
    for (const s of anim.states) s.playing = s.clip === clip
  }

  private syncAttachments(tf: { position: Vector3 }) {
    Transform.getMutable(this.label).position = Vector3.create(tf.position.x, tf.position.y + 2.1, tf.position.z)
    Transform.getMutable(this.clickTarget).position = Vector3.create(tf.position.x, tf.position.y + 0.7, tf.position.z)
  }

  private update(dt: number) {
    const cmd = inputSystem.getInputCommand(InputAction.IA_SECONDARY, PointerEventType.PET_DOWN, this.clickTarget)
    if (cmd && this.o.onClick) this.o.onClick(this)

    if (this.phase === 'idle') {
      this.pollTimer += dt
      this.idleTimer += dt
      this.emoteTimer += dt
      if (this.o.poll && this.pollTimer >= POLL_INTERVAL) { this.pollTimer = 0; void this.pollCommand() }
      if (this.idleTimer >= EXPLORE_IDLE_TIMEOUT) { this.idleTimer = 0; this.startExplore() }
      if (!this.isEmoting && this.emoteTimer >= EMOTE_INTERVAL) {
        this.emoteTimer = 0
        this.isEmoting = true
        const emotes: AnimClip[] = ['Armature|Attack', 'Armature|Hit']
        this.emoteDuration = 1.0
        this.setClip(emotes[Math.floor(Math.random() * emotes.length)])
      }
      if (this.isEmoting) {
        this.emoteDuration -= dt
        if (this.emoteDuration <= 0) { this.isEmoting = false; this.setClip('Armature|Idle') }
      }
    }

    if (this.phase === 'following') {
      const player = Transform.getOrNull(engine.PlayerEntity)
      if (!player || !isOnLand(player.position.x, player.position.z)) {
        this.phase = 'exploring'
        this.startExplore()
      } else {
        const tf = Transform.getMutable(this.entity)
        const dx = player.position.x - tf.position.x
        const dz = player.position.z - tf.position.z
        const dist = Math.sqrt(dx * dx + dz * dz)
        if (dist > FOLLOW_DISTANCE) {
          const ratio = (dist - FOLLOW_DISTANCE) / dist
          tf.position.x += dx * ratio * 4.0 * dt
          tf.position.z += dz * ratio * 4.0 * dt
          if (Math.abs(dx) + Math.abs(dz) > 0.01) tf.rotation = Quaternion.fromEulerDegrees(0, Math.atan2(dx, dz) * (180 / Math.PI), 0)
          this.setClip('Armature|Walk')
          this.syncAttachments(tf)
        } else {
          this.setClip('Armature|Idle')
        }
      }
    }

    if (this.phase === 'moving' || this.phase === 'exploring') {
      this.moveTimer += dt
      const t = Math.min(this.moveTimer / MOVE_DURATION, 1)
      const tf = Transform.getMutable(this.entity)
      tf.position = Vector3.lerp(this.moveFrom, this.moveTo, easeInOut(t))
      const dx = this.moveTo.x - this.moveFrom.x
      const dz = this.moveTo.z - this.moveFrom.z
      if (Math.abs(dx) + Math.abs(dz) > 0.01) tf.rotation = Quaternion.fromEulerDegrees(0, Math.atan2(dx, dz) * (180 / Math.PI), 0)
      this.syncAttachments(tf)
      if (t >= 1) {
        this.setClip('Armature|Idle')
        if (this.o.collect) {
          void this.reportStatus('success', Date.now() - this.moveStartTime)
          if (this.currentExploreId) {
            const agent = encodeURIComponent(this.o.agent ?? 'remy')
            void fetch(`${RELAY_URL}/api/explore-complete?id=${encodeURIComponent(this.currentExploreId)}&agent=${agent}`)
            this.currentExploreId = null
          }
        }
        this.phase = 'idle'
        this.idleTimer = 0
      }
    }
  }

  private randomInBounds() {
    const tf = Transform.get(this.entity)
    // 땅 밖에 있으면 (다른 땅에 배포되어 스폰 위치가 맞지 않는 경우) 땅 안으로 걸어 들어간다
    if (!isOnLand(tf.position.x, tf.position.z)) return randomWalkablePoint(EDGE_MARGIN)
    for (let i = 0; i < 20; i++) {
      const x = tf.position.x + (Math.random() - 0.5) * 2 * MAX_STEP
      const z = tf.position.z + (Math.random() - 0.5) * 2 * MAX_STEP
      if (isWalkable(x, z, EDGE_MARGIN)) return { x, z }
    }
    if (isWalkable(this.o.spawn.x, this.o.spawn.z, EDGE_MARGIN)) return { x: this.o.spawn.x, z: this.o.spawn.z }
    return randomWalkablePoint(EDGE_MARGIN)
  }

  private startExplore() {
    if (this.phase !== 'idle') return
    const dest = this.randomInBounds()
    this.moveFrom = Vector3.clone(Transform.get(this.entity).position)
    this.moveTo = Vector3.create(dest.x, 0.1, dest.z)
    this.currentParcel = parcelIdAt(dest.x, dest.z)
    this.currentCommandId = null
    this.moveTimer = 0
    this.moveStartTime = Date.now()
    this.idleTimer = -(2 + Math.random() * 3)
    this.phase = 'exploring'
    this.setClip('Armature|Walk')
    if (this.o.collect) void this.claimNextParcel()
  }

  private async claimNextParcel() {
    try {
      const res = await fetch(`${RELAY_URL}/api/explore-next?agent=${encodeURIComponent(this.o.agent ?? 'remy')}`)
      const data = await res.json() as any
      if (data.ok && data.parcel) {
        this.currentExploreId = data.parcel.id
        this.currentParcel = data.parcel.id
      }
    } catch { /* ignore */ }
  }

  private async pollCommand() {
    try {
      const res = await fetch(`${RELAY_URL}/api/command`)
      const data = (await res.json()) as { ok: boolean; command: RemyCommand | null }
      if (data.ok && data.command) this.executeCommand(data.command)
    } catch { /* skip */ }
  }

  private executeCommand(cmd: RemyCommand) {
    this.currentCommandId = cmd.id
    if (this.phase !== 'idle') return
    if (cmd.action === 'move') {
      this.moveFrom = Vector3.clone(Transform.get(this.entity).position)
      this.moveTo = Vector3.create(cmd.x, cmd.y ?? 0.1, cmd.z)
      if (cmd.parcel) this.currentParcel = cmd.parcel
      this.moveTimer = 0
      this.moveStartTime = Date.now()
      this.idleTimer = 0
      this.phase = 'moving'
      this.setClip('Armature|Walk')
    }
  }

  private async reportStatus(outcome: 'success' | 'failure', latency_ms: number) {
    const isExplore = this.currentCommandId === null
    if (!isExplore) {
      try {
        await fetch(`${RELAY_URL}/api/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: this.currentCommandId, action: 'move', status: outcome, position: this.moveTo }),
        })
      } catch { /* ignore */ }
    }
    try {
      await fetch(`${RELAY_URL}/api/record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actor: this.o.agent ?? 'remy',
          target: `dcl:${this.currentParcel}`,
          target_type: 'dcl_parcel',
          task_type: isExplore ? 'explore' : 'move',
          outcome,
          from: { x: this.moveFrom.x, z: this.moveFrom.z },
          to:   { x: this.moveTo.x,   z: this.moveTo.z },
          latency_ms,
        }),
      })
    } catch { /* ignore */ }
    if (!isExplore) this.currentCommandId = null
  }
}

type RemyCommand = { id: string; action: 'move'; x: number; y?: number; z: number; parcel?: string }

function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t }
