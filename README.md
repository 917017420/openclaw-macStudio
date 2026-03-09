# OpenClaw macStudio WebUI

This branch now boots a React/Tauri desktop workspace as the primary shell, with:

- live Gateway connection management
- usable chat sessions and agent/model selection
- dedicated sessions workspace with preview + per-session overrides
- agent inspection with tool catalog support
- channel status + WhatsApp login actions
- raw config editing/apply diagnostics
- embedded upstream OpenClaw Control UI at `/control-ui`

## Development

- `pnpm install`
- `pnpm dev`
- `pnpm build`
- `pnpm tauri dev`
