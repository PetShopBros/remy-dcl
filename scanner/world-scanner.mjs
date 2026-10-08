// World Scanner (1단계): Catalyst 에서 전체 좌표를 묶음으로 조회해 parcels / catalyst_scenes / scanner_runs 를 갱신한다.
//
// 기본은 계산만 하고 DB 에 쓰지 않는다 (dry-run). 실제로 쓰려면 --write 를 붙인다.
//   $env:SUPABASE_URL = "https://<project>.supabase.co"
//   $env:SUPABASE_SERVICE_KEY = Read-Host "service key"     # 채팅에 붙이지 말 것
//   node scanner/world-scanner.mjs            # 계산만 (DB 읽기 전용)
//   node scanner/world-scanner.mjs --write    # parcels / catalyst_scenes / scanner_runs / map_snapshots 에 쓰기
//
// 규칙
//  - 조회 대상 좌표는 DB 의 parcels 에 있는 id 전부다 (격자 크기를 가정하지 않는다).
//  - 묶음 요청이 하나라도 끝내 실패하면 DB 는 건드리지 않고(실행 기록만 남김) 종료 코드 2 로 끝낸다.
//  - parcels 는 상태가 바뀐 행만 쓴다. "마지막으로 전체를 확인한 시각"은 scanner_runs 에 남는다.

const CATALYST = (process.env.CATALYST ?? 'https://peer.decentraland.org') + '/content'
const SB_URL = (process.env.SUPABASE_URL ?? '').replace(/\/$/, '')
const SB_KEY = process.env.SUPABASE_SERVICE_KEY ?? ''
const WRITE = process.argv.includes('--write')

const CHUNK = 1000          // Catalyst 묶음 크기 (측정에서 1000 까지 성공)
const CONCURRENCY = 3       // 동시 요청 수 (측정에서 429 없이 통과)
const RETRIES = 5
const RETRY_BASE_MS = Number(process.env.RETRY_BASE_MS ?? 1000)
const DB_PAGE = 1000        // PostgREST 한 번에 최대 1000행
const WRITE_BATCH = 1000
const SNAPSHOT_KEEP = Number(process.env.SNAPSHOT_KEEP ?? 24)     // map_snapshots 는 최근 24개만 남긴다

const sleep = ms => new Promise(r => setTimeout(r, ms))

if (!SB_URL || !SB_KEY) {
  console.error('SUPABASE_URL 과 SUPABASE_SERVICE_KEY 환경변수가 필요합니다.')
  process.exit(1)
}

// ── HTTP ──────────────────────────────────────────────────────
async function http(url, init = {}, label = url) {
  let last
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(90_000) })
      if (res.ok) return res
      const body = (await res.text()).replace(/\s+/g, ' ').slice(0, 200)
      last = new Error(`${label} → ${res.status} ${body}`)
      if (![429, 500, 502, 503, 504].includes(res.status)) throw Object.assign(last, { fatal: true })
    } catch (e) {
      if (e.fatal) throw e
      last = e
    }
    if (attempt < RETRIES) await sleep(RETRY_BASE_MS * 2 ** attempt)
  }
  throw last
}

const sbHeaders = extra => ({ apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'content-type': 'application/json', ...extra })
const sbGet = async path => (await http(`${SB_URL}/rest/v1/${path}`, { headers: sbHeaders() }, `GET ${path.split('?')[0]}`)).json()
const sbPost = async (path, body, prefer) =>
  http(`${SB_URL}/rest/v1/${path}`, { method: 'POST', headers: sbHeaders(prefer ? { Prefer: prefer } : {}), body: JSON.stringify(body) }, `POST ${path.split('?')[0]}`)

// ── 1) DB 에서 전체 좌표 읽기 ─────────────────────────────────
async function readParcels() {
  const out = []
  for (let off = 0; ; off += DB_PAGE) {
    let rows
    try {
      rows = await sbGet(`parcels?select=id,tile_type,has_scene,entity_id,state&order=id&limit=${DB_PAGE}&offset=${off}`)
    } catch (e) {
      if (/entity_id|state/.test(String(e.message))) throw new Error('parcels 에 새 컬럼이 없습니다. 먼저 scanner/001_world_scanner.sql 을 실행하세요.\n' + e.message)
      throw e
    }
    out.push(...rows)
    process.stdout.write(`\rDB 에서 좌표 읽는 중: ${out.length}`)
    if (rows.length < DB_PAGE) break
  }
  process.stdout.write('\n')
  return out
}

// ── 2) Catalyst 묶음 조회 ─────────────────────────────────────
async function scanChunks(ids) {
  const chunks = []
  for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK))
  const entities = new Map()           // entity id → entity
  const pointerToEntity = new Map()    // 좌표 → entity (여러 묶음에 걸친 멀티 파셀 씬도 한 번에 연결)
  const failed = new Set()
  let done = 0
  const queue = [...chunks.keys()]

  async function worker() {
    while (queue.length) {
      const i = queue.shift()
      try {
        const res = await http(`${CATALYST}/entities/active`, {
          method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pointers: chunks[i] }),
        }, `POST entities/active #${i}`)
        const arr = await res.json()
        if (!Array.isArray(arr)) throw new Error('응답이 배열이 아님')
        for (const e of arr) {
          entities.set(e.id, e)
          for (const p of e.pointers ?? []) {
            const prev = pointerToEntity.get(p)
            if (!prev || (e.timestamp ?? 0) > (prev.timestamp ?? 0)) pointerToEntity.set(p, e)
          }
        }
      } catch (err) {
        failed.add(i)
        console.error(`\n묶음 #${i} 실패: ${err.message}`)
      }
      done++
      process.stdout.write(`\rCatalyst 조회: ${done}/${chunks.length} (실패 ${failed.size})`)
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  process.stdout.write('\n')
  return { entities, pointerToEntity, failed }
}

// ── 2-1) 분류 (kind) ──────────────────────────────────────────
// 현재 시점의 분류값이다. 제목이나 tile_type 이 바뀌면 다음 스캔에서 다시 계산되어 덮어써진다.
// scanner/002_scene_kind.sql 의 backfill 규칙과 같아야 한다.
const KINDS = ['user_scene', 'district', 'plaza', 'template', 'road', 'unknown']
const CONTENT_KINDS = new Set(['user_scene', 'district', 'plaza'])   // "콘텐츠가 있는" 씬
const TEMPLATE_TITLES = new Set(['interactive-text', 'empty', 'new scene', 'new', 'dcl scene', 'builder',
  'sdk7 template scene', 'sdk7 scene template', 'test', '新场景'])

function classifyKind(title, tileMode) {
  const t = title == null ? '' : String(title).replace(/^ +| +$/g, '')
  if (/^road at /i.test(title ?? '')) return 'road'
  if (t === '') return 'unknown'
  if (TEMPLATE_TITLES.has(t.toLowerCase()) || /^builder\s*-?\d/i.test(t) || /^new scene \d+$/i.test(title)) return 'template'
  if (tileMode === 'plaza') return 'plaza'
  if (tileMode === 'district') return 'district'
  return 'user_scene'
}

// 엔티티가 덮는 파셀(DB 기준)의 tile_type 최빈값. 동률이면 이름순 앞쪽 (SQL mode() 와 같은 동작)
function tileModes(parcels, scan) {
  const tally = new Map()   // entity id → Map(tile_type → n)
  parcels.forEach((p, idx) => {
    if (scan.failed.has(Math.floor(idx / CHUNK)) || p.tile_type == null) return
    const ent = scan.pointerToEntity.get(p.id)
    if (!ent) return
    const m = tally.get(ent.id) ?? new Map()
    m.set(p.tile_type, (m.get(p.tile_type) ?? 0) + 1)
    tally.set(ent.id, m)
  })
  const out = new Map()
  for (const [id, m] of tally) out.set(id, [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0])
  return out
}

async function readSceneKinds() {
  const kinds = new Map(), titles = new Map()
  for (let off = 0; ; off += DB_PAGE) {
    let rows
    try {
      rows = await sbGet(`catalyst_scenes?select=entity_id,kind,title&order=entity_id&limit=${DB_PAGE}&offset=${off}`)
    } catch (e) {
      if (/kind/.test(String(e.message))) throw new Error('catalyst_scenes 에 kind 컬럼이 없습니다. 먼저 scanner/002_scene_kind.sql 을 실행하세요.\n' + e.message)
      throw e
    }
    for (const r of rows) { kinds.set(r.entity_id, r.kind ?? null); titles.set(r.entity_id, r.title ?? null) }
    if (rows.length < DB_PAGE) break
  }
  return { kinds, titles }
}

// ── 2-2) 지도 스냅샷 ──────────────────────────────────────────
// 301x301 = 90,601 칸을 한 칸 한 글자로. 배치/글자 의미는 scanner/003_map_snapshots.sql 주석 참고.
const GRID_MIN = -150, GRID_MAX = 150, GRID_W = GRID_MAX - GRID_MIN + 1
const RECENT_DAYS = 7
const BASE_OF_KIND = { user_scene: 1, district: 1, plaza: 1, template: 2, road: 3, unknown: 4 }
const BASE_NAMES = ['empty', 'content', 'template', 'road', 'unknown']

function buildSnapshot(parcels, scan, kinds, dbKinds, nowMs) {
  const cut = nowMs - RECENT_DAYS * 24 * 3600e3
  const cells = new Array(GRID_W * GRID_W).fill('4')           // DB 에 없는 칸은 미확인
  const parcelBase = [0, 0, 0, 0, 0]                           // 전체 DB 파셀 기준 (격자 밖 포함)
  const recentEntities = new Set()
  let recentParcels = 0, outside = 0, unobserved = 0

  parcels.forEach((p, idx) => {
    let base, recent = false
    if (scan.failed.has(Math.floor(idx / CHUNK))) {
      unobserved++
      // 이번에 못 본 칸은 지난 스캔 결과를 그대로 유지 (지도가 깜빡이지 않게)
      if (p.state === 'empty') base = 0
      else if (p.state === 'active' && p.entity_id && dbKinds.has(p.entity_id)) base = BASE_OF_KIND[dbKinds.get(p.entity_id)] ?? 4
      else base = 4
    } else {
      const ent = scan.pointerToEntity.get(p.id)
      if (!ent) base = 0
      else {
        base = BASE_OF_KIND[kinds.get(ent.id)] ?? 4
        recent = (ent.timestamp ?? 0) >= cut
        if (recent) { recentEntities.add(ent.id); recentParcels++ }
      }
    }
    parcelBase[base]++
    const [x, y] = p.id.split(',').map(Number)
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < GRID_MIN || x > GRID_MAX || y < GRID_MIN || y > GRID_MAX) { outside++; return }
    cells[(GRID_MAX - y) * GRID_W + (x - GRID_MIN)] = String(base + (recent ? 5 : 0))
  })

  const sceneBase = [0, 0, 0, 0, 0]
  const sceneKinds = {}
  for (const k of kinds.values()) { sceneBase[BASE_OF_KIND[k] ?? 4]++; sceneKinds[k] = (sceneKinds[k] ?? 0) + 1 }

  const codes = cells.join('')
  const stats = {
    generated_at: new Date(nowMs).toISOString(),
    layout: 'row-major; first char = (x=-150, y=150); index = (max_y - y) * width + (x - min_x)',
    codes: { 0: 'empty', 1: 'content', 2: 'template', 3: 'road', 4: 'unknown', '5-9': '0-4 + recent' },
    recent_days: RECENT_DAYS,
    total_parcels: parcels.length,
    grid_cells: GRID_W * GRID_W,
    outside_grid_parcels: outside,
    unobserved_parcels: unobserved,
    scenes: { total: kinds.size, content: sceneBase[1], template: sceneBase[2], road: sceneBase[3], unknown: sceneBase[4], by_kind: sceneKinds },
    parcels: { content: parcelBase[1], template: parcelBase[2], road: parcelBase[3], unknown: parcelBase[4], empty: parcelBase[0] },
    recent: { scenes: recentEntities.size, parcels: recentParcels },
  }
  return { codes, stats, width: GRID_W, height: GRID_W, min_x: GRID_MIN, max_y: GRID_MAX }
}

// ── 2-3) 변화 이벤트 (world_events) ───────────────────────────
// 스캔 전 DB 상태(parcels.entity_id/state)와 이번 스캔 결과를 비교해 "씬 단위" 변화만 뽑는다.
//   scene_created  : 비어 있던 땅에 씬이 올라옴
//   scene_removed  : 씬이 사라지고 다른 씬이 그 땅을 이어받지 않음
//   scene_updated  : 같은 파셀 구성에서 엔티티만 새 버전으로 바뀜 (제목은 동일성 판단에 쓰지 않는다)
//   scene_replaced : 파셀 구성이 바뀌었거나 분류(kind)가 바뀐 교체
// 첫 스캔(이전 state 가 없는 파셀)은 baseline 이라 이벤트로 만들지 않는다.
// 이번에 못 본 파셀이 하나라도 걸린 씬은 판단을 미룬다 (다음 스캔에서 다시 본다).
const MAX_EVENTS_PER_RUN = 2000   // 이보다 많으면 비정상(예: DB 초기화)으로 보고 이벤트를 쓰지 않는다

function detectEvents(parcels, scan, kinds, dbKinds, dbTitles) {
  const events = []
  const skipped = { unobserved: 0, baseline: 0 }
  const idx = new Map(parcels.map((p, i) => [p.id, i]))
  const observed = id => !scan.failed.has(Math.floor(idx.get(id) / CHUNK))
  const nextEnt = id => scan.pointerToEntity.get(id) ?? null
  const prevEnt = id => { const p = parcels[idx.get(id)]; return p.state === 'active' ? (p.entity_id ?? null) : null }
  const hasPrev = id => parcels[idx.get(id)].state != null

  // 이전(DB) 기준 엔티티별 파셀 집합
  const prevFoot = new Map()
  for (const p of parcels) if (p.state === 'active' && p.entity_id) {
    if (!prevFoot.has(p.entity_id)) prevFoot.set(p.entity_id, new Set())
    prevFoot.get(p.entity_id).add(p.id)
  }

  const newIds = new Set(), oldIds = new Set()
  for (const p of parcels) {
    if (!observed(p.id) || !hasPrev(p.id)) continue
    const a = prevEnt(p.id), b = nextEnt(p.id)?.id ?? null
    if (a === b) continue
    if (b) newIds.add(b)
    if (a) oldIds.add(a)
  }

  const sameSet = (a, b) => a.size === b.size && [...a].every(x => b.has(x))
  const claimed = new Set()        // 이번에 새 씬이 이어받은 옛 파셀

  for (const eid of [...newIds].sort()) {
    const e = scan.entities.get(eid)
    const foot = (e.pointers ?? []).filter(id => idx.has(id))
    if (foot.some(id => !observed(id))) { skipped.unobserved++; continue }
    if (foot.some(id => !hasPrev(id))) { skipped.baseline++; continue }

    const overlap = new Map()      // 옛 엔티티 → 겹치는 파셀 수
    let empties = 0
    for (const id of foot) {
      const a = prevEnt(id)
      if (a) overlap.set(a, (overlap.get(a) ?? 0) + 1); else empties++
    }
    const prevMain = [...overlap.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))[0]?.[0] ?? null
    for (const a of overlap.keys()) for (const id of prevFoot.get(a) ?? []) claimed.add(id)

    const newKind = kinds.get(eid), prevKind = prevMain ? dbKinds.get(prevMain) ?? null : null
    let type
    if (!prevMain) type = 'scene_created'
    else {
      const sameFoot = empties === 0 && overlap.size === 1 && sameSet(new Set(foot), prevFoot.get(prevMain) ?? new Set())
      const kindChanged = prevKind != null && prevKind !== newKind
      type = sameFoot && !kindChanged ? 'scene_updated' : 'scene_replaced'
    }
    const affected = new Set(foot)
    if (prevMain) for (const id of prevFoot.get(prevMain) ?? []) affected.add(id)
    events.push({
      event_key: `${type}|${eid}|${prevMain ?? ''}`,
      event_type: type,
      parcels: [...affected].sort(),
      entity_id: eid, prev_entity_id: prevMain,
      title: titleOf(e) || null, prev_title: prevMain ? dbTitles.get(prevMain) ?? null : null,
      kind: newKind, prev_kind: prevKind,
      parcel_count: parcelCountOf(e),
      deployed_at: e.timestamp ? new Date(e.timestamp).toISOString() : null,
    })
  }

  // 사라진 씬: 옛 엔티티의 모든 파셀이 이번에 관측됐고, 전부 비었고, 새 씬이 이어받지 않은 경우
  for (const aid of [...oldIds].sort()) {
    const foot = [...(prevFoot.get(aid) ?? [])]
    if (!foot.length) continue
    if (foot.some(id => !observed(id))) { skipped.unobserved++; continue }
    if (foot.some(id => claimed.has(id) || nextEnt(id))) continue
    events.push({
      event_key: `scene_removed||${aid}`,
      event_type: 'scene_removed',
      parcels: foot.sort(),
      entity_id: null, prev_entity_id: aid,
      title: null, prev_title: dbTitles.get(aid) ?? null,
      kind: null, prev_kind: dbKinds.get(aid) ?? null,
      parcel_count: foot.length,
      deployed_at: null,
    })
  }
  return { events, skipped }
}

// ── 3) 비교 · 통계 ────────────────────────────────────────────
const titleOf = e => e.metadata?.display?.title ?? ''
const parcelCountOf = e => e.metadata?.scene?.parcels?.length ?? e.pointers?.length ?? 0

function table(title, rows) {
  console.log(`\n${title}`)
  for (const [k, v] of rows) console.log(`  ${String(k).padEnd(28)} ${v}`)
}

function histogram(items, keyFn, top) {
  const m = new Map()
  for (const it of items) m.set(keyFn(it), (m.get(keyFn(it)) ?? 0) + 1)
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, top)
}

function plan(parcels, scan) {
  const changes = []
  let active = 0, empty = 0, unobserved = 0
  const cross = new Map()      // tile_type|state
  const crossScene = new Map() // has_scene|state

  parcels.forEach((p, idx) => {
    if (scan.failed.has(Math.floor(idx / CHUNK))) { unobserved++; return }
    const ent = scan.pointerToEntity.get(p.id)
    const state = ent ? 'active' : 'empty'
    const entityId = ent ? ent.id : null
    if (ent) active++; else empty++
    const k1 = `${p.tile_type}|${state}`; cross.set(k1, (cross.get(k1) ?? 0) + 1)
    const k2 = `${p.has_scene ? 'has_scene' : 'no_scene'}|${state}`; crossScene.set(k2, (crossScene.get(k2) ?? 0) + 1)
    if ((p.entity_id ?? null) !== entityId || (p.state ?? null) !== state) changes.push({ id: p.id, entity_id: entityId, state })
  })
  return { changes, active, empty, unobserved, cross, crossScene }
}

function sceneRows(entities, nowIso, kinds) {
  return [...entities.values()].map(e => {
    const m = e.metadata ?? {}
    return {
      entity_id: e.id,
      title: m.display?.title ?? null,
      base: m.scene?.base ?? null,
      parcel_count: parcelCountOf(e),
      owner: m.owner || null,
      tags: Array.isArray(m.tags) ? m.tags : null,
      main: m.main ?? null,
      deployed_at: e.timestamp ? new Date(e.timestamp).toISOString() : null,
      kind: kinds.get(e.id),
      last_seen_at: nowIso,
      meta: { description: (m.display?.description ?? '').slice(0, 300) || null, runtimeVersion: m.runtimeVersion ?? null, type: e.type ?? null },
    }
  })
}

// ── main ─────────────────────────────────────────────────────
const t0 = Date.now()
const startedAt = new Date().toISOString()
console.log(`모드: ${WRITE ? '쓰기 (--write)' : '계산만 (dry-run, DB 에 쓰지 않음)'}  /  Catalyst: ${CATALYST}`)

const parcels = await readParcels()
const scan = await scanChunks(parcels.map(p => p.id))
const pl = plan(parcels, scan)

const modes = tileModes(parcels, scan)
const kinds = new Map([...scan.entities.values()].map(e => [e.id, classifyKind(titleOf(e) || null, modes.get(e.id))]))
const { kinds: dbKinds, titles: dbTitles } = await readSceneKinds()
const snap = buildSnapshot(parcels, scan, kinds, dbKinds, Date.now())
const ev = detectEvents(parcels, scan, kinds, dbKinds, dbTitles)

const entityList = [...scan.entities.values()]
const sceneType = entityList.filter(e => e.type === 'scene')
console.log('\n=== 결과 ===')
console.log(`DB 좌표 ${parcels.length}  |  active ${pl.active}  empty ${pl.empty}  미관측 ${pl.unobserved} (실패한 묶음 ${scan.failed.size})`)
console.log(`엔티티 ${entityList.length} (type=scene ${sceneType.length})  |  DB 에 쓸 변경 행 ${pl.changes.length}`)

{
  const sceneN = new Map(), parcelN = new Map()
  for (const k of kinds.values()) sceneN.set(k, (sceneN.get(k) ?? 0) + 1)
  parcels.forEach((p, idx) => {
    if (scan.failed.has(Math.floor(idx / CHUNK))) return
    const ent = scan.pointerToEntity.get(p.id)
    if (ent) { const k = kinds.get(ent.id); parcelN.set(k, (parcelN.get(k) ?? 0) + 1) }
  })
  table('kind (현재 분류)  씬 수 / 파셀 수', KINDS.map(k => [k, `${sceneN.get(k) ?? 0} / ${parcelN.get(k) ?? 0}`]))
  const cs = [...CONTENT_KINDS].reduce((a, k) => a + (sceneN.get(k) ?? 0), 0)
  const cp = [...CONTENT_KINDS].reduce((a, k) => a + (parcelN.get(k) ?? 0), 0)
  console.log(`\nScenes (콘텐츠): ${cs}\nContent parcels: ${cp} / ${parcels.length} (${(100 * cp / parcels.length).toFixed(1)}%)`)

  // SQL backfill(DB kind) 과 스캐너 계산값 비교
  let same = 0, diff = 0, missing = 0
  const diffs = []
  for (const [id, k] of kinds) {
    if (!dbKinds.has(id)) missing++
    else if (dbKinds.get(id) === k) same++
    else { diff++; if (diffs.length < 10) diffs.push([id.slice(0, 18) + '…', `${titleOf(scan.entities.get(id)).slice(0, 24)}  DB=${dbKinds.get(id)}  scanner=${k}`]) }
  }
  const dbOnly = [...dbKinds.keys()].filter(id => !kinds.has(id)).length
  console.log(`\nDB kind 와 비교: 일치 ${same} / 불일치 ${diff} / DB 에 없음(신규) ${missing} / DB 에만 있음 ${dbOnly}`)
  if (diffs.length) table('불일치 샘플 (최대 10)', diffs)
}
{
  const c = snap.stats
  const dec = new Array(10).fill(0)
  for (const ch of snap.codes) dec[ch.charCodeAt(0) - 48]++
  console.log('\n=== 지도 스냅샷 (map_snapshots) ===')
  console.log(`codes ${snap.codes.length}자 (= ${snap.width} × ${snap.height}), 격자 밖 DB 파셀 ${c.outside_grid_parcels}, 이번에 못 본 파셀 ${c.unobserved_parcels}`)
  table('칸 글자별 개수 (0 없음 / 1 콘텐츠 / 2 템플릿 / 3 도로 / 4 미확인, 5~9 = 최근 변경 겹침)', dec.map((n, i) => [`${i}${i >= 5 ? ' (' + BASE_NAMES[i - 5] + ' + 최근)' : ' (' + BASE_NAMES[i] + ')'}`, n]).filter(([, n]) => n > 0))
  console.log(`\nScenes: ${c.scenes.content}`)
  console.log(`Content parcels: ${c.parcels.content} / ${c.total_parcels}`)
  console.log(`Templates: ${c.parcels.template}\nRoads: ${c.parcels.road}\nEmpty: ${c.parcels.empty}\nUnverified: ${c.parcels.unknown}`)
  console.log(`최근 ${c.recent_days}일 변경: 씬 ${c.recent.scenes} / 파셀 ${c.recent.parcels}`)
  const gridTotal = dec.reduce((a, b) => a + b, 0)
  if (snap.codes.length !== snap.width * snap.height || gridTotal !== snap.codes.length) throw new Error('스냅샷 길이 검증 실패')
}
{
  const byType = new Map()
  for (const e of ev.events) byType.set(e.event_type, (byType.get(e.event_type) ?? 0) + 1)
  console.log('\n=== 변화 이벤트 (world_events) ===')
  console.log(`감지 ${ev.events.length}건  |  판단 보류: 못 본 파셀 ${ev.skipped.unobserved}, baseline(이전 상태 없음) ${ev.skipped.baseline}`)
  table('종류별', ['scene_created', 'scene_updated', 'scene_replaced', 'scene_removed'].map(t => [t, byType.get(t) ?? 0]))
  const show = ev.events.slice(0, 10).map(e => [e.event_type, `${(e.title ?? '(없음)').slice(0, 22)} ← ${(e.prev_title ?? '(없음)').slice(0, 22)} | ${e.kind ?? '-'}←${e.prev_kind ?? '-'} | ${e.parcels.length}칸 | ${e.parcels[0]}`])
  if (show.length) table('샘플 (최대 10)', show)
  if (ev.events.length > MAX_EVENTS_PER_RUN) console.log(`\n경고: 이벤트가 ${MAX_EVENTS_PER_RUN}건을 넘어 --write 에서도 기록하지 않습니다 (비정상 가능성).`)
}
table('tile_type × state', [...pl.cross.entries()].sort().map(([k, v]) => [k, v]))
table('has_scene(Places 기준) × state', [...pl.crossScene.entries()].sort().map(([k, v]) => [k, v]))
table('엔티티 제목 패턴 상위 15 (숫자는 #)', histogram(entityList, e => titleOf(e).replace(/-?\d+/g, '#').slice(0, 26), 15))
table('엔티티 파셀 수 분포', histogram(entityList, e => { const n = parcelCountOf(e); return n === 1 ? '1' : n <= 4 ? '2-4' : n <= 9 ? '5-9' : '10+' }, 4).sort())
const recent = Date.now()
table('최근 배포 (엔티티 timestamp 기준)', [
  ['24시간 이내', entityList.filter(e => recent - (e.timestamp ?? 0) < 24 * 3600e3).length],
  ['7일 이내', entityList.filter(e => recent - (e.timestamp ?? 0) < 7 * 24 * 3600e3).length],
  ['30일 이내', entityList.filter(e => recent - (e.timestamp ?? 0) < 30 * 24 * 3600e3).length],
])

if (!WRITE) {
  console.log(`\n(dry-run) DB 에는 아무것도 쓰지 않았습니다. 숫자를 확인한 뒤 --write 로 실행하세요. 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`)
  process.exit(0)
}

// ── 쓰기 ─────────────────────────────────────────────────────
// 아무것도 쓰기 전에 필요한 테이블이 있는지 먼저 확인한다 (없으면 중간에 멈추지 않도록)
for (const [table, sql] of [['map_snapshots', '003_map_snapshots.sql'], ['world_events', '004_world_events.sql']]) {
  try {
    await sbGet(`${table}?select=id&limit=1`)
  } catch (e) {
    console.error(`${table} 테이블이 없습니다. 먼저 scanner/${sql} 을 실행하세요.\n` + e.message)
    process.exit(1)
  }
}
const nowIso = new Date().toISOString()

// 실행 기록을 먼저 만들고(진행 중), 끝에서 결과를 채운다. 도중에 멈추면 finished_at 이 빈 채로 남아 흔적이 된다.
const runRes = await sbPost('scanner_runs', { started_at: startedAt, mode: 'full', note: '진행 중' }, 'return=representation')
const runId = (await runRes.json())?.[0]?.id ?? null
const notes = []

// 일부 묶음이라도 못 봤으면 DB 는 건드리지 않는다. 여러 파셀에 걸친 씬을 반만 보고 갱신하면
// 이력(updated / replaced 판정)이 틀어지기 때문이다. 다음 스캔에서 처음부터 다시 본다.
if (scan.failed.size) {
  const note = `불완전한 스캔: 묶음 ${scan.failed.size}개 실패 → 기록하지 않음`
  await http(`${SB_URL}/rest/v1/scanner_runs?id=eq.${runId}`, {
    method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
    body: JSON.stringify({ finished_at: new Date().toISOString(), mode: 'full', failed_count: pl.unobserved, duration_ms: Date.now() - t0, note }),
  }, 'PATCH scanner_runs')
  console.error(`\n${note}. 다음 스캔에서 다시 시도합니다. (run ${runId})`)
  process.exit(2)
}

// 1) 변화 이벤트 (event_key 가 같으면 무시 → 다시 실행해도 중복되지 않는다). parcels 를 바꾸기 전에 먼저 기록한다.
if (ev.events.length > MAX_EVENTS_PER_RUN) {
  notes.push(`이벤트 ${ev.events.length}건이 한도 ${MAX_EVENTS_PER_RUN} 초과라 기록하지 않음`)
} else {
  for (let i = 0; i < ev.events.length; i += 500) {
    const rows = ev.events.slice(i, i + 500).map(e => ({ ...e, observed_at: nowIso, run_id: runId }))
    await sbPost('world_events?on_conflict=event_key', rows, 'resolution=ignore-duplicates,return=minimal')
  }
  if (ev.events.length) process.stdout.write(`world_events 기록: ${ev.events.length}건\n`)
}
if (ev.skipped.unobserved) notes.push(`판단 보류(못 본 파셀) ${ev.skipped.unobserved}`)

// 2) 씬 정보
const scenes = sceneRows(scan.entities, nowIso, kinds)
for (let i = 0; i < scenes.length; i += 500) {
  await sbPost('catalyst_scenes?on_conflict=entity_id', scenes.slice(i, i + 500), 'resolution=merge-duplicates,return=minimal')
  process.stdout.write(`\rscenes 쓰는 중: ${Math.min(i + 500, scenes.length)}/${scenes.length}`)
}
process.stdout.write('\n')

// 3) 파셀 상태
let applied = 0
for (let i = 0; i < pl.changes.length; i += WRITE_BATCH) {
  const res = await sbPost('rpc/apply_parcel_observations', { p_rows: pl.changes.slice(i, i + WRITE_BATCH), p_changed_at: nowIso })
  applied += Number(await res.json())
  process.stdout.write(`\rparcels 쓰는 중: ${Math.min(i + WRITE_BATCH, pl.changes.length)}/${pl.changes.length}`)
}
process.stdout.write('\n')

// 4) 지도 스냅샷 1행 저장 + 오래된 것 정리 (최근 SNAPSHOT_KEEP 개만 유지)
await sbPost('map_snapshots', { run_id: runId, ...snap }, 'return=minimal')
const old = await sbGet(`map_snapshots?select=id&order=id.desc&offset=${SNAPSHOT_KEEP}&limit=1`)
if (old.length) {
  await http(`${SB_URL}/rest/v1/map_snapshots?id=lte.${old[0].id}`, { method: 'DELETE', headers: sbHeaders() }, 'DELETE map_snapshots')
}

// 5) 실행 기록 마무리
if (scan.failed.size) notes.push(`실패한 묶음 ${scan.failed.size}`)
await http(`${SB_URL}/rest/v1/scanner_runs?id=eq.${runId}`, {
  method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
  body: JSON.stringify({
    finished_at: new Date().toISOString(), mode: 'full',
    total_checked: pl.active + pl.empty, active_count: pl.active, empty_count: pl.empty,
    entity_count: entityList.length, changed_count: applied, failed_count: pl.unobserved,
    duration_ms: Date.now() - t0, note: notes.length ? notes.join(' / ') : null,
  }),
}, 'PATCH scanner_runs')

console.log(`\n완료: scenes ${scenes.length}, parcels 변경 ${applied}/${pl.changes.length}, 이벤트 ${ev.events.length > MAX_EVENTS_PER_RUN ? '0 (한도 초과)' : ev.events.length}, 스냅샷 1개 저장(run ${runId}), 소요 ${((Date.now() - t0) / 1000).toFixed(1)}초`)
