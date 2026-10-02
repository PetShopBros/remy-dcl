# remy-dcl

AI-controllable NPC for Decentraland. Drop Remy into any DCL scene and let your AI agent move, animate, and log actions — via MCP, Command Relay, and Lowdown.

## Structure

```
remy-dcl/
├── relay/    ← Vercel Command Relay API (Upstash Redis)
└── scene/    ← DCL SDK7 scene (Remy NPC + polling)
```

## How it works

```
User's AI
    ↓ POST /api/command
Command Relay (Vercel)
    ↑ GET /api/command  (scene polls every 1.5s)
SDK7 Scene
    ↓
🐭 Remy walks + animates
    ↓ POST /api/status
Command Relay
    ↑ dcl-agent-mcp reads status
```

## Setup

### 1. Deploy Relay

```bash
cd relay
vercel deploy
```

Set environment variables in Vercel:
- `UPSTASH_REDIS_REST_URL`
- `UPSTASH_REDIS_REST_TOKEN`

### 2. Configure Scene

Set `REMY_RELAY_URL` in `scene/src/remy.ts` to your deployed relay URL.

Copy your `rat.glb` to `scene/assets/rat.glb`.

### 3. Deploy Scene

```bash
cd scene
npm install
npm run deploy
```

## API

### POST /api/command
Send a move command to Remy.
```json
{ "action": "move", "x": 8, "z": 12 }
```

### GET /api/command
Scene polls this to fetch pending command (auto-clears on read).

### POST /api/status
Scene reports completion.
```json
{ "action": "move", "status": "success", "position": { "x": 8, "y": 0.1, "z": 12 } }
```

### GET /api/status
Check last action result.

## Integration with dcl-agent-mcp

Add a `move_remy` tool that posts to `/api/command`, waits, then polls `/api/status`.

## License

MIT — PetShopBros
