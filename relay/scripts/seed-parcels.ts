import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_KEY!
)

async function fetchWithRetry(url: string, retries = 3): Promise<any> {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } catch (e) {
      console.log(`Attempt ${i + 1} failed: ${(e as Error).message}`)
      if (i === retries - 1) throw e
      await new Promise(r => setTimeout(r, 2000))
    }
  }
}

async function seed() {
  console.log('Fetching DCL tiles...')
  const json = await fetchWithRetry('https://api.decentraland.org/v2/tiles')
  const tiles = Object.entries(json.data) as [string, any][]
  console.log(`Total tiles: ${tiles.length}`)

  const rows = tiles.map(([id, t]) => ({
    id,
    x: t.x,
    y: t.y,
    tile_type: t.type,
    owner: t.owner ?? null,
    name: t.name ?? null,
    estate_id: t.estateId ?? null,
  }))

  let inserted = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    let ok = false
    for (let retry = 0; retry < 3; retry++) {
      const { error } = await supabase
        .from('parcels')
        .upsert(batch, { onConflict: 'x,y' })
      if (!error) { ok = true; break }
      console.error(`Batch ${i} retry ${retry}: ${error.message}`)
      await new Promise(r => setTimeout(r, 1000))
    }
    if (ok) {
      inserted += batch.length
      process.stdout.write(`\r${inserted} / ${rows.length}`)
    }
  }
  console.log('\nDone.')
}

seed().catch(console.error)