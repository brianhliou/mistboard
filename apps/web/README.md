# @mistboard/web

Browser client for Mistboard. Vite-bundled vanilla TypeScript — no framework.

## Key responsibilities

- Render boards: `chessground` for the 8x8 chess family, the repo's own SVG renderer (`packages/board-render`) for xiangqi-family and other intersection boards
- Manage client-side WebSocket connection and `PlayerView` state
- Page modules: landing, live game, replay, review, articles, leaderboard, broadcasts
- OG share surfaces and account UI

## Running locally

```bash
npm run dev    # from repo root — starts both server and web
```

The dev server runs on port 3000 and proxies `/api/*` to the game server on `http://127.0.0.1:3001` (see `vite.config.ts`).

## Layout

`src/main.ts` is the entry point. It inspects the URL and dynamic-imports the matching page module — there is no client-side router framework.

| File | Page / role |
|------|-------------|
| `main.ts` | URL → page-module dispatcher |
| `landing.ts` | Landing, watch page, account, game review, profile |
| `live.ts` | In-game client for the chess stack: WS connect/reconnect, board, clocks |
| `live-render.ts`, `live-socket.ts`, `live-state.ts` | Live-game subsystems |
| `replay.ts` | Postgame replay viewer |
| `articles.ts`, `articles-data.ts` | Articles index + content |
| `variant-tenant/` | Live play and replay for the xiangqi family and other tenant variants |
| `review/` | Game review, analysis board, and the in-browser engines |
| `theme.ts` | Board/fog/piece-set theming, sound volume (localStorage) |
| `account-nav.ts` | Account UI in the top nav |
| `analytics.ts` | PostHog event firing |

Tests live in `src/*.test.ts` and run under Vitest (`npm run test:unit`).

## Board rendering

The 8x8 chess family uses `chessground`; xiangqi-family boards use the shared SVG renderer in `packages/board-render`. Legal move destinations come from `PlayerView.legalMoves` sent by the server — the client does not compute legality locally. The server owns move authority.

## Fog of War UI contract

- The client renders only what is in `PlayerView`. It never requests or reconstructs hidden state.
- Hidden squares should visually communicate fog, not look like missing textures.
- Spectator and replay are separate rendering paths and do not receive live `PlayerView` updates for an in-progress game.
