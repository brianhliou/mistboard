import {
  relatedClosing,
  SERVER_FOG_ACCESS_POLICY,
  SERVER_FOG_DELTA_PAYLOAD,
  SERVER_FOG_FOG_B,
  SERVER_FOG_FOG_W,
  SERVER_FOG_FRAME_B,
  SERVER_FOG_FRAME_W,
  SERVER_FOG_MOVE_PAYLOAD,
  SERVER_FOG_REVIEW_POLICY,
  SERVER_FOG_TRUTH_STATE,
  SERVER_FOG_VIEW_KERNEL,
} from '../diagrams.js';
import type { Article, ArticleBlock } from '../types.js';

export const serverEnforcedFogArticle: Article = {
    slug: 'server-enforced-fog',
    kind: 'article',
    publisher: 'mistboard',
    title: 'Programming Fog Chess with Server-Side Truth',
    cardTitle: 'Server-Side Fog Chess',
    summary:
      'How Mistboard keeps hidden information on the server: canonical state, seat-scoped views, private live rooms, and public postgame review.',
    status: 'published',
    publishedAt: '2026-06-08',
    audience:
      'Players and engineers who want a practical reference for building live hidden-information games without sending the true board to the browser.',
    thumbnail: {
      kind: 'image',
      src: '/article-thumbs/server-fog-cutaway-truth-20260708.jpg',
      alt: 'A foggy visible board layer floating above a hidden golden truth layer.',
    },
    sections: [
      {
        heading: 'Truth stays server-side',
        blocks: [
          { kind: 'paragraph', text: 'Fog Chess adds one hidden-information rule to chess: each side sees only the squares its own pieces reach. The implementation question is where that rule runs. On Mistboard, it runs on the server, so the browser receives a `PlayerView`, not a full board with fog painted over it.' },
          {
            kind: 'live-boards',
            spec: {
              layout: 'triptych',
              boards: [
                { board: SERVER_FOG_FRAME_W.state.board, fogSquares: SERVER_FOG_FOG_W, orientation: 'white', label: "WHITE'S VIEW" },
                { board: SERVER_FOG_TRUTH_STATE.board, orientation: 'white', label: 'CANONICAL TRUTH' },
                { board: SERVER_FOG_FRAME_B.state.board, fogSquares: SERVER_FOG_FOG_B, orientation: 'white', label: "BLACK'S VIEW" },
              ],
            },
          } as ArticleBlock,
          { kind: 'paragraph', text: 'The triptych is the architecture in miniature. The center board exists only on the server. White and Black each receive a different projection, and neither projection contains the full truth with a visual layer hiding it.' },
          { kind: 'paragraph', text: 'The rule is simple: compute truth once, project the allowed view per seat, and keep the full event log private until the game is over.' },
          { kind: 'paragraph', text: 'That single boundary supports live PvP, engine games, calibration, tournaments, and review. This article stays focused on the player-facing live room: what each browser receives, who can receive it, and when the record becomes public.' },
        ],
      },
      {
        heading: 'How views are computed',
        blocks: [
          { kind: 'paragraph', text: 'For a player, the boundary is `PlayerView`: visible squares, visible pieces, legal moves, status, and clock for that seat. Opponent pieces outside the visibility set are not hidden fields. They are absent.' },
          { kind: 'code', language: 'typescript', text: SERVER_FOG_VIEW_KERNEL },
          { kind: 'paragraph', text: 'The important part is the direction of dependency. The client can render fog because it receives a visibility mask, but it cannot remove fog to recover pieces it was never sent.' },
        ],
      },
      {
        heading: 'Sample data payload',
        blocks: [
          { kind: 'paragraph', text: 'The live move stream uses `event-appended`, a per-move frame. This is the white payload from the position above, shortened to the fields that matter:' },
          { kind: 'code', language: 'json', text: SERVER_FOG_DELTA_PAYLOAD },
          { kind: 'paragraph', text: '**Core fields:** `seat` identifies the recipient, `seq` orders the stream, `state.board` is the redacted board, `state.visibleSquares` is the clear-vs-fog mask, and `state.status` carries the canonical turn/result state.' },
          { kind: 'paragraph', text: 'If the appended event is visible to this seat, the frame includes one filtered `event`. If the move is hidden, `event` is omitted and the projected `state` still advances. The player knows a turn happened, not what happened in the fog.' },
          { kind: 'paragraph', text: 'Snapshots still exist for first connect, explicit recovery, and final resync. They carry the filtered event history needed to hydrate the client, so they are larger than per-move frames.' },
        ],
      },
      {
        heading: 'Player move',
        blocks: [
          { kind: 'paragraph', text: 'A move request is just coordinates:' },
          { kind: 'code', language: 'typescript', text: SERVER_FOG_MOVE_PAYLOAD },
          { kind: 'paragraph', text: 'The server validates the request against canonical state, applies the move, appends an event, and projects the next view. The client never decides whether hidden information exists, whether an invisible move happened, or whether the game is over.' },
        ],
      },
      {
        heading: 'Seat-gated live rooms',
        blocks: [
          { kind: 'paragraph', text: 'During a live game, the server sends game data only to the two seats. After each move, it projects one view for White and one view for Black, then sends each view only to a socket that has proven it controls that seat.' },
          { kind: 'code', language: 'typescript', text: SERVER_FOG_ACCESS_POLICY },
          { kind: 'sub-heading', text: 'Seat proof' },
          { kind: 'paragraph', text: 'A socket gets live room data only after it proves control of the white or black seat. Anonymous seats use random bearer tokens; the server stores a SHA-256 token hash and compares the presented token in constant time.' },
          { kind: 'sub-heading', text: 'Account seats' },
          { kind: 'paragraph', text: 'Signed-in seats add the account session check on top of the seat claim. The token proves this browser can reclaim the seat; the session proves the account still matches the seat assignment.' },
          { kind: 'sub-heading', text: 'No live spectator view' },
          { kind: 'paragraph', text: 'Non-players do not get a live spectator projection. A socket without a valid seat is rejected before room data is sent, and the live replay endpoint returns 403 until the game reaches a terminal state.' },
        ],
      },
      {
        heading: 'Postgame review',
        blocks: [
          { kind: 'paragraph', text: 'When the game becomes terminal, the privacy rule changes. The room no longer rejects non-players after the result, and the game page becomes the durable public review surface.' },
          { kind: 'code', language: 'text', text: SERVER_FOG_REVIEW_POLICY },
          { kind: 'paragraph', text: 'A spectator who opens the room during play gets no board. The same person can open the finished game page after the result and inspect the event log. That is the product rule: private while decisions are live, reviewable once the record is settled.' },
          { kind: 'paragraph', text: 'That split is important for rated play. A rated result can point at a public completed game without giving non-players access to live hidden information.' },
          { kind: 'paragraph', text: 'It also keeps reconnect and review on the same foundation. Live reconnect rebuilds a filtered player view from the event log. Postgame review uses the same log after the hidden-information constraint has expired.' },
        ],
      },
      {
        heading: 'Scope and verification',
        blocks: [
          { kind: 'paragraph', text: 'This is not a full anti-cheat claim. It is the narrower integrity claim this architecture can prove: during live play, hidden truth is not sent to unauthorized browser paths; after the game ends, the record is reviewable.' },
          { kind: 'paragraph', text: 'Anonymous casual seats are bearer-token seats, not account-grade identity, and there is no live spectator mode for hidden-information games.' },
          { kind: 'paragraph', text: 'Mistboard covers this boundary with WebSocket and payload regression tests that drive real moves and assert on the bytes each seat receives.' },
          { kind: 'paragraph', text: 'That is the line Mistboard defends: during play, there is no browser-side truth to unmask. After play, there is a public record to inspect.' },
        ],
      },
      relatedClosing({
        heading: 'Where to next',
        lead: 'Play Misty in Fog Chess, or read the rules article for the player-facing version of the same visibility model.',
        links: [
          { label: 'Play Misty', href: '/?play=computer', emphasis: 'primary' },
          { label: 'Read Fog Chess Rules', href: '/rules/fog-chess', emphasis: 'secondary' },
          { label: 'All articles', href: '/blog', emphasis: 'secondary' },
        ],
      }),
    ],
};
