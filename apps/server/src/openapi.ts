// The public HTTP API, described as an OpenAPI 3.1 document.
//
// Served at GET /api/openapi.json and rendered by /api-docs. Hand-authored on
// purpose: the routes are a hand-ordered tryHandle walk with no metadata to
// generate from, so a generator would have nothing to read. What keeps this
// honest is openapi.test.ts, which walks every documented GET through the real
// dispatcher and fails if the server does not claim the path.
//
// Scope is the ANONYMOUS READ surface only: what a curl with no cookie gets.
// Session-gated reads (favourites, inbox, your own studies) and every write are
// deliberately absent; documenting them would promise a contract they do not
// have. Version 0: shapes may change, and the description says so.

type Schema = Record<string, unknown>;

const ref = (name: string): Schema => ({ $ref: `#/components/schemas/${name}` });

const ERROR_RESPONSE = (description: string): Schema => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

const OK = (schema: Schema, description = 'OK'): Schema => ({
  description,
  content: { 'application/json': { schema } },
});

const query = (name: string, schema: Schema, description: string, required = false): Schema => ({
  name,
  in: 'query',
  required,
  schema,
  description,
});

const pathParam = (name: string, description: string): Schema => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
  description,
});

const NOT_FOUND = ERROR_RESPONSE('Not found (`not_found`).');
const PERSISTENCE = ERROR_RESPONSE('The database is unavailable (`persistence_disabled`).');

export const WATCH_CHANNEL_IDS = [
  'top',
  'xiangqi',
  'banqi',
  'jieqi',
  'fortress-xiangqi',
  'dark-xiangqi',
  'duck-xiangqi',
  'dark-chess',
  'jungle',
  'jungle-flip',
  'engines',
] as const;

const TIME_CLASS = { type: 'string', enum: ['bullet', 'blitz', 'rapid'], default: 'blitz' };

const GAME_ID_NOTE =
  'A room id: the last segment of a game’s review URL. This route matches the raw ' +
  'request line, so it takes no query string at all.';

export function buildOpenApiDocument(origin: string): Record<string, unknown> {
  const gameRecord: Schema = {
    type: 'object',
    description: 'A finished game as the site lists it.',
    properties: {
      roomId: { type: 'string' },
      variant: { type: 'string', description: 'A game spec id, e.g. `xiangqi`, `dark-chess`.' },
      mode: { type: 'string', enum: ['pvp', 'pve', 'eve', 'imported', 'manual'] },
      result: { type: 'string', description: '`red-wins`, `black-wins`, `white-wins`, `draw`, …' },
      termination: { type: 'string' },
      plyCount: { type: 'integer' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: 'string', format: 'date-time' },
      whiteName: { type: ['string', 'null'], description: 'First seat (red in xiangqi).' },
      blackName: { type: ['string', 'null'] },
      corpusId: { type: ['string', 'null'] },
      rated: { type: 'boolean' },
      visibility: { type: 'string' },
      timeControl: { type: ['object', 'null'] },
      initialMs: { type: ['integer', 'null'] },
      incrementMs: { type: ['integer', 'null'] },
      participants: { type: 'array', items: { type: 'object' } },
    },
    required: ['roomId', 'variant', 'result', 'termination', 'plyCount'],
  };

  const postgamePlayer: Schema = {
    type: 'object',
    properties: {
      color: { type: 'string', description: 'Seat token: `white` (first mover) or `black`.' },
      name: { type: 'string', description: '`Anonymous` for a seat its owner made private.' },
      rating: { type: ['integer', 'null'] },
      kind: { type: 'string', enum: ['account', 'guest', 'engine'] },
    },
  };

  const postgameGame: Schema = {
    type: 'object',
    description: 'The finished-game envelope every per-variant postgame route shares.',
    properties: {
      roomId: { type: 'string' },
      variant: { type: 'string' },
      mode: { type: 'string' },
      result: { type: 'string' },
      termination: { type: 'string' },
      plyCount: { type: 'integer' },
      startedAt: { type: 'string', format: 'date-time' },
      endedAt: { type: 'string', format: 'date-time' },
      rated: { type: 'boolean' },
      visibility: { type: 'string' },
      initialMs: { type: ['integer', 'null'] },
      incrementMs: { type: ['integer', 'null'] },
      players: { type: 'array', items: ref('PostgamePlayer') },
    },
  };

  const leaderboardEntry: Schema = {
    type: 'object',
    properties: {
      rank: { type: 'integer' },
      handle: { type: 'string' },
      displayName: { type: 'string' },
      title: { type: ['string', 'null'] },
      eloRating: { type: 'integer' },
      gamesPlayed: { type: 'integer' },
      provisional: { type: 'boolean' },
    },
  };

  const puzzleSummary: Schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      variant: {
        type: 'string',
        enum: ['xiangqi', 'mini-xiangqi', 'drop-mini-xiangqi', 'fortress-xiangqi', 'jungle'],
      },
      title: { type: 'string' },
      sideToMove: { type: ['string', 'null'], enum: ['red', 'black', null] },
      goal: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['checkmate', 'win', 'winning-advantage'] },
          winner: { type: 'string' },
          centipawns: { type: 'integer' },
        },
      },
      themes: { type: 'array', items: { type: 'string' } },
      solutionPlyCount: { type: 'integer' },
      rating: { type: 'integer' },
      ratingProvisional: { type: 'boolean' },
    },
  };

  const puzzleDetail: Schema = {
    allOf: [
      ref('PuzzleSummary'),
      {
        type: 'object',
        properties: {
          initial: {
            type: 'object',
            description: 'The variant’s full game state at the puzzle start.',
          },
          sourceGame: { type: 'object', description: 'Attribution for mined puzzles.' },
        },
      },
    ],
    description: 'The solution is never included; it is revealed by a solving action.',
  };

  const studySummary: Schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      description: { type: ['string', 'null'] },
      visibility: { type: 'string', enum: ['public', 'unlisted'] },
      featuredAt: { type: ['string', 'null'], format: 'date-time' },
      createdAt: { type: 'string', format: 'date-time' },
      updatedAt: { type: 'string', format: 'date-time' },
      owner: {
        type: 'object',
        properties: { handle: { type: 'string' }, displayName: { type: 'string' } },
      },
      chapterCount: { type: 'integer' },
      chapterNames: { type: 'array', items: { type: 'string' } },
      likeCount: { type: 'integer' },
    },
  };

  const chapter: Schema = {
    type: 'object',
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      variant: { type: 'string' },
      orientation: { type: 'string' },
      root: {
        type: 'object',
        description: 'The move tree: nested `children` of `{ uci, annotations }`.',
      },
      tags: { type: 'object' },
      version: { type: 'integer' },
    },
  };

  const explorerMove: Schema = {
    type: 'object',
    properties: {
      from: { type: 'string' },
      to: { type: 'string' },
      games: { type: 'integer' },
      redWins: { type: 'integer' },
      blackWins: { type: 'integer' },
      draws: { type: 'integer' },
      unknowns: { type: 'integer' },
    },
  };

  const oembed: Schema = {
    type: 'object',
    properties: {
      type: { type: 'string', const: 'rich' },
      version: { type: 'string', const: '1.0' },
      provider_name: { type: 'string' },
      provider_url: { type: 'string' },
      title: { type: 'string' },
      width: { type: 'integer' },
      height: { type: 'integer' },
      html: { type: 'string', description: 'An `<iframe>` element.' },
    },
  };

  const games = (schema: Schema): Schema => ({
    type: 'object',
    properties: { games: { type: 'array', items: schema } },
  });

  const paths: Record<string, Record<string, unknown>> = {
    '/api/ping': {
      get: {
        tags: ['Site'],
        summary: 'Round-trip probe',
        description: 'No database, no allocations, `cache-control: no-store`.',
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              now: { type: 'integer', description: 'Server time, ms since epoch.' },
              lagMs: { type: 'number', description: 'Event-loop lag on the server.' },
            },
          }),
        },
      },
    },
    '/api/live-stats': {
      get: {
        tags: ['Site'],
        summary: 'How many people are playing and online',
        responses: {
          '200': OK({
            type: 'object',
            properties: { playing: { type: 'integer' }, online: { type: 'integer' } },
          }),
        },
      },
    },
    '/api/players/online': {
      get: {
        tags: ['Site'],
        summary: 'Players online now',
        description:
          'At most 50 named players; `count` is the untruncated total. Private profiles are excluded.',
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              players: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    handle: { type: 'string' },
                    displayName: { type: 'string' },
                    title: { type: ['string', 'null'] },
                    rating: { type: ['object', 'null'] },
                    playing: { type: 'boolean' },
                  },
                },
              },
              count: { type: 'integer' },
              anonymousOnline: { type: 'integer' },
            },
          }),
        },
      },
    },
    '/api/stats/public': {
      get: {
        tags: ['Site'],
        summary: 'Site-wide game statistics',
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              generatedAt: { type: 'string', format: 'date-time' },
              totalCompletedGames: { type: 'integer' },
              last30dCompletedGames: { type: 'integer' },
              publicGames: { type: 'integer' },
              modeTotals: { type: 'object' },
              variantTotals: { type: 'array', items: { type: 'object' } },
              dailyCompletedGames: { type: 'array', items: { type: 'object' } },
            },
          }),
          '503': PERSISTENCE,
        },
      },
    },

    '/api/games/recent': {
      get: {
        tags: ['Games'],
        summary: 'The ten most recent public games',
        responses: { '200': OK(games(ref('GameRecord'))), '503': PERSISTENCE },
      },
    },
    '/api/games/showcase': {
      get: {
        tags: ['Games'],
        summary: 'Curated recent games across variants',
        description:
          'The pool the homepage board draws from: substantial finished games, interleaved across variants for breadth, not sorted by recency.',
        responses: { '200': OK(games(ref('GameRecord'))), '503': PERSISTENCE },
      },
    },
    '/api/eve-games/recent': {
      get: {
        tags: ['Games'],
        summary: 'Recent engine-versus-engine games',
        responses: { '200': OK(games(ref('GameRecord'))), '503': PERSISTENCE },
      },
    },
    '/api/games/{roomId}': {
      get: {
        tags: ['Games'],
        summary: 'One finished game',
        description: `${GAME_ID_NOTE} A game still in progress is 404 until it finishes.`,
        parameters: [pathParam('roomId', 'Room id.')],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              game: {
                allOf: [
                  ref('GameRecord'),
                  {
                    type: 'object',
                    properties: { players: { type: 'array', items: ref('PostgamePlayer') } },
                  },
                ],
              },
            },
          }),
          '404': NOT_FOUND,
        },
      },
    },
    '/api/games/{roomId}/events': {
      get: {
        tags: ['Games'],
        summary: 'The event log of a finished game',
        description: `The replay source of truth. ${GAME_ID_NOTE} Fog games answer 403 until they finish: hidden information is never served early.`,
        parameters: [pathParam('roomId', 'Room id.')],
        responses: {
          '200': OK({
            type: 'object',
            properties: { events: { type: 'array', items: { type: 'object' } } },
          }),
          '403': ERROR_RESPONSE('The game is not public yet (`game_not_public`).'),
          '404': NOT_FOUND,
        },
      },
    },
    '/api/games/{roomId}/export.pgn': {
      get: {
        tags: ['Games'],
        summary: 'A finished game as PGN',
        parameters: [pathParam('roomId', 'Room id.')],
        responses: {
          '200': {
            description: 'The PGN text, `content-disposition: inline`.',
            content: { 'application/x-chess-pgn': { schema: { type: 'string' } } },
          },
          '403': ERROR_RESPONSE('`game_not_public`'),
          '404': NOT_FOUND,
          '501': ERROR_RESPONSE('`export_not_supported_for_variant`'),
        },
      },
    },
    '/api/games/{roomId}/export.json': {
      get: {
        tags: ['Games'],
        summary: 'A finished game as JSON',
        parameters: [pathParam('roomId', 'Room id.')],
        responses: {
          '200': OK({ type: 'object' }, 'The export document.'),
          '403': ERROR_RESPONSE('`game_not_public`'),
          '404': NOT_FOUND,
          '501': ERROR_RESPONSE('`export_not_supported_for_variant`'),
        },
      },
    },
    '/api/games/{roomId}/crosstable': {
      get: {
        tags: ['Games'],
        summary: 'Head-to-head record of the two players',
        description:
          'A 200 with `{ available: false, reason }` when the seats do not resolve to a rated pair.',
        parameters: [pathParam('roomId', 'Room id.')],
        responses: { '200': OK({ type: 'object' }), '404': NOT_FOUND, '503': PERSISTENCE },
      },
    },
    '/api/{variant}/games/{roomId}': {
      get: {
        tags: ['Games'],
        summary: 'A finished game with its per-ply views',
        description:
          'The postgame payload the review pages render: the game envelope, the final view, and every position of the game. One route per variant: `/api/xiangqi/games/{roomId}`, `/api/banqi/games/{roomId}`, `/api/jieqi/games/{roomId}`, `/api/dark-xiangqi/games/{roomId}`, and so on for every variant with a game route. Finished games only; a variant mismatch is a 404.',
        parameters: [
          pathParam('variant', 'A game spec id with a review route, e.g. `xiangqi`.'),
          pathParam('roomId', 'Room id.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              game: ref('PostgameGame'),
              state: { type: 'object' },
              timeline: { type: 'array', items: { type: 'object' } },
              view: { type: 'object', description: 'The final position.' },
              history: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { ply: { type: 'integer' }, view: { type: 'object' } },
                },
              },
            },
          }),
          '404': NOT_FOUND,
        },
      },
    },

    '/api/watch': {
      get: {
        tags: ['Watch'],
        summary: 'A watch channel: its finished games and the rail',
        parameters: [
          query(
            'channel',
            { type: 'string', enum: [...WATCH_CHANNEL_IDS], default: 'top' },
            'Which channel. The set is what /watch offers and can change as variants launch.',
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              activeChannel: { type: 'string' },
              channels: { type: 'array', items: { type: 'object' } },
              now: { type: 'string', format: 'date-time' },
              unlockLimit: { type: 'integer' },
              sealedCount: {
                type: 'integer',
                description: 'Games still sealed (recently finished, not yet public).',
              },
              unlocked: { type: 'array', items: ref('GameRecord') },
            },
          }),
          '404': ERROR_RESPONSE('`unknown_watch_channel`'),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/watch/live': {
      get: {
        tags: ['Watch'],
        summary: 'The featured live game of a channel',
        description:
          'What Mistboard TV follows. `featured` is null when nothing is live. Pass `room` and `ply` for the game you are already showing and the payload is omitted while the position is unchanged. Fog games are never featured.',
        parameters: [
          query(
            'channel',
            { type: 'string', enum: [...WATCH_CHANNEL_IDS], default: 'top' },
            'Which channel.',
          ),
          query('room', { type: 'string' }, 'The room you are following.'),
          query('ply', { type: 'integer', minimum: 0 }, 'The ply you last rendered.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              channel: { type: 'string' },
              featured: {
                type: ['object', 'null'],
                properties: {
                  roomId: { type: 'string' },
                  gameSpecId: { type: 'string' },
                  ply: { type: 'integer' },
                  players: { type: 'array', items: { type: 'object' } },
                  payload: { type: 'object', description: 'The postgame-shaped live payload.' },
                },
              },
              now: { type: 'string', format: 'date-time' },
            },
          }),
          '404': ERROR_RESPONSE('`unknown_watch_channel`'),
        },
      },
    },

    '/api/leaderboard': {
      get: {
        tags: ['Ratings'],
        summary: 'One rating ladder',
        parameters: [
          query(
            'variant',
            { type: 'string', default: 'fog' },
            'A rating pool: `xiangqi`, `jieqi`, `banqi`, `fog` (fog chess), `dark_xiangqi`, `jungle`, `jungle_flip`, `fortress_xiangqi`, … (underscores). A game spec id is accepted too.',
          ),
          query('timeClass', TIME_CLASS, 'Which clock class.'),
          query('limit', { type: 'integer', minimum: 1, maximum: 500, default: 100 }, 'Rows.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              leaderboard: { type: 'array', items: ref('LeaderboardEntry') },
              bucket: {
                type: 'object',
                properties: { variant: { type: 'string' }, timeClass: { type: 'string' } },
              },
              timeClasses: { type: 'array', items: { type: 'string' } },
            },
          }),
          '400': ERROR_RESPONSE('`invalid_rating_time_class`'),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/leaderboard/summary': {
      get: {
        tags: ['Ratings'],
        summary: 'The top of every ladder, plus active players',
        parameters: [
          query('timeClass', TIME_CLASS, 'Which clock class.'),
          query(
            'limit',
            { type: 'integer', minimum: 1, maximum: 50, default: 10 },
            'Rows per ladder.',
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              timeClass: { type: 'string' },
              ladders: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    variant: { type: 'string' },
                    leaderboard: { type: 'array', items: ref('LeaderboardEntry') },
                  },
                },
              },
              activePlayers: { type: 'array', items: { type: 'object' } },
            },
          }),
          '400': ERROR_RESPONSE('`invalid_rating_time_class`'),
          '503': PERSISTENCE,
        },
      },
    },

    '/api/users/{handle}/profile': {
      get: {
        tags: ['Players'],
        summary: 'A player’s public profile',
        description:
          'Private profiles are 404. Signed-in viewers also get a `relation` field; anonymous callers get null.',
        parameters: [pathParam('handle', 'The player’s handle.')],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              profile: {
                type: 'object',
                properties: {
                  user: { type: 'object' },
                  ratings: { type: 'array', items: { type: 'object' } },
                  puzzleRatings: { type: 'array', items: { type: 'object' } },
                  games: { type: 'array', items: { type: 'object' } },
                  gamesTotal: { type: 'integer' },
                },
              },
            },
          }),
          '400': ERROR_RESPONSE('`invalid_handle`'),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },
    '/api/users/{handle}/games': {
      get: {
        tags: ['Players'],
        summary: 'A player’s public games, paged',
        parameters: [
          pathParam('handle', 'The player’s handle.'),
          query('offset', { type: 'integer', minimum: 0, default: 0 }, 'Skip this many.'),
          query('limit', { type: 'integer', minimum: 1, maximum: 50, default: 15 }, 'Page size.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              games: { type: 'array', items: { type: 'object' } },
              total: { type: 'integer' },
            },
          }),
          '400': ERROR_RESPONSE('`invalid_handle`'),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },
    '/api/users/{handle}/rating-history': {
      get: {
        tags: ['Players'],
        summary: 'A player’s rating over time in one pool',
        parameters: [
          pathParam('handle', 'The player’s handle.'),
          query('variant', { type: 'string' }, 'A rating pool (see the leaderboard).', true),
          query('timeClass', TIME_CLASS, 'Which clock class.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              history: {
                type: 'object',
                properties: {
                  variant: { type: 'string' },
                  timeClass: { type: 'string' },
                  points: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        roomId: { type: 'string' },
                        endedAt: { type: 'string', format: 'date-time' },
                        ratingBefore: { type: 'integer' },
                        ratingAfter: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          }),
          '400': ERROR_RESPONSE(
            '`invalid_handle`, `invalid_rating_variant` or `invalid_rating_time_class`',
          ),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },

    '/api/bots': {
      get: {
        tags: ['Bots'],
        summary: 'Every bot a player can be offered',
        description:
          'The one source that knows what a player is offered: each bot with the specs it can play right now.',
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              bots: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    displayName: { type: 'string' },
                    bio: { type: 'string' },
                    activeEngineId: { type: 'string' },
                    defaultGameSpecId: { type: 'string' },
                    supportedGameSpecIds: { type: 'array', items: { type: 'string' } },
                    rating: { type: ['object', 'null'] },
                    playOptions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          gameSpecId: { type: 'string' },
                          engineId: { type: 'string' },
                          playable: { type: 'boolean' },
                        },
                      },
                    },
                  },
                },
              },
            },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/bots/{id}': {
      get: {
        tags: ['Bots'],
        summary: 'One bot',
        parameters: [pathParam('id', 'Bot id.')],
        responses: {
          '200': OK({ type: 'object', properties: { bot: { type: 'object' } } }),
          '400': ERROR_RESPONSE('`invalid_bot_id`'),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },
    '/api/engines/playable': {
      get: {
        tags: ['Bots'],
        summary: 'Engines available for fog chess play',
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              engines: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    familyName: { type: 'string' },
                    kind: { type: 'string' },
                  },
                },
              },
            },
          }),
        },
      },
    },

    '/api/puzzles': {
      get: {
        tags: ['Puzzles'],
        summary: 'The puzzle list',
        description:
          'Signed-in callers also get `attemptedIds`; anonymous callers get an empty list there.',
        parameters: [
          query(
            'variant',
            {
              type: 'string',
              enum: ['xiangqi', 'mini-xiangqi', 'drop-mini-xiangqi', 'fortress-xiangqi', 'jungle'],
            },
            'Restrict to one variant; omit for all.',
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              puzzles: { type: 'array', items: ref('PuzzleSummary') },
              attemptedIds: { type: 'array', items: { type: 'string' } },
            },
          }),
          '400': ERROR_RESPONSE('`invalid_variant`'),
        },
      },
    },
    '/api/puzzles/daily': {
      get: {
        tags: ['Puzzles'],
        summary: 'Today’s puzzle',
        parameters: [
          query(
            'slot',
            { type: 'string', enum: ['homepage'], default: 'homepage' },
            'The rotation slot.',
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              daily: {
                type: 'object',
                properties: {
                  day: { type: 'string', description: 'YYYY-MM-DD' },
                  persisted: { type: 'boolean' },
                  selectedAt: { type: ['string', 'null'] },
                  slot: { type: 'string' },
                  source: { type: 'string' },
                },
              },
              puzzle: ref('PuzzleDetail'),
            },
          }),
          '400': ERROR_RESPONSE('`invalid_slot`'),
        },
      },
    },
    '/api/puzzles/{id}': {
      get: {
        tags: ['Puzzles'],
        summary: 'One puzzle',
        parameters: [pathParam('id', 'A puzzle id, or its short code.')],
        responses: {
          '200': OK({ type: 'object', properties: { puzzle: ref('PuzzleDetail') } }),
          '404': NOT_FOUND,
        },
      },
    },

    '/api/studies/public': {
      get: {
        tags: ['Studies'],
        summary: 'Public studies',
        parameters: [
          query('limit', { type: 'integer', minimum: 1, maximum: 50, default: 5 }, 'Rows.'),
          query('q', { type: 'string', minLength: 2 }, 'Filter by name.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: { studies: { type: 'array', items: ref('StudySummary') } },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/studies/{id}': {
      get: {
        tags: ['Studies'],
        summary: 'One study with its chapters',
        description:
          'Public and unlisted studies answer; a private study is a 404 of the same shape.',
        parameters: [pathParam('id', 'Study id: the segment after `/study/`.')],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              study: ref('StudySummary'),
              chapters: { type: 'array', items: ref('Chapter') },
            },
          }),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },

    '/api/xiangqi/explorer': {
      get: {
        tags: ['Xiangqi'],
        summary: 'Opening explorer: what was played from a position',
        parameters: [
          query(
            'fen',
            { type: 'string', maxLength: 120 },
            'A standard xiangqi FEN, or just `<placement> <r|b>`. Only placement and side to move are read.',
            true,
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              position: { type: 'string' },
              total: { type: 'integer' },
              moves: { type: 'array', items: ref('ExplorerMove') },
              opening: { type: ['string', 'null'] },
              topGames: { type: 'array', items: { type: 'object' }, maxItems: 8 },
              build: { type: ['object', 'null'] },
            },
          }),
          '400': ERROR_RESPONSE('`invalid_position`'),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/xiangqi/broadcasts': {
      get: {
        tags: ['Xiangqi'],
        summary: 'Broadcast tournaments',
        responses: {
          '200': OK({
            type: 'object',
            properties: { tours: { type: 'array', items: { type: 'object' } } },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/xiangqi/broadcasts/{tourSlug}': {
      get: {
        tags: ['Xiangqi'],
        summary: 'One tournament and its rounds',
        parameters: [pathParam('tourSlug', 'The tour slug.')],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              tour: { type: 'object' },
              rounds: { type: 'array', items: { type: 'object' } },
            },
          }),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },
    '/api/xiangqi/broadcasts/{tourSlug}/rounds/{roundId}': {
      get: {
        tags: ['Xiangqi'],
        summary: 'One round and its boards',
        description:
          'Append `/events` for a server-sent-events stream of the same payload (`pollMs` 250 to 30000, default 1500).',
        parameters: [
          pathParam('tourSlug', 'The tour slug.'),
          pathParam('roundId', 'The round id.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              tour: { type: 'object' },
              round: { type: 'object' },
              boards: { type: 'array', items: { type: 'object' } },
            },
          }),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },
    '/api/xiangqi/broadcasts/boards/{boardId}': {
      get: {
        tags: ['Xiangqi'],
        summary: 'One broadcast board, replayable',
        description:
          'Append `/events` for a server-sent-events stream, or `/export` for the moves as JSON.',
        parameters: [pathParam('boardId', 'The board id.')],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              board: { type: 'object' },
              state: { type: 'object' },
              timeline: { type: 'array', items: { type: 'object' } },
              history: { type: 'array', items: { type: 'object' } },
            },
          }),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },

    '/api/forum/categories': {
      get: {
        tags: ['Forum'],
        summary: 'Forum categories',
        responses: {
          '200': OK({
            type: 'object',
            properties: { categories: { type: 'array', items: { type: 'object' } } },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/forum/topics': {
      get: {
        tags: ['Forum'],
        summary: 'Topics, newest activity first',
        parameters: [
          query('category', { type: 'string' }, 'A category slug; omit for all.'),
          query('limit', { type: 'integer', minimum: 1, maximum: 50, default: 20 }, 'Rows.'),
          query(
            'offset',
            { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
            'Skip this many.',
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: { topics: { type: 'array', items: { type: 'object' } } },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/forum/topics/{id}': {
      get: {
        tags: ['Forum'],
        summary: 'One topic with its posts',
        parameters: [
          pathParam('id', 'Topic id.'),
          query('limit', { type: 'integer', minimum: 1, maximum: 100 }, 'Posts per page.'),
          query(
            'offset',
            { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
            'Skip this many posts.',
          ),
        ],
        responses: {
          '200': OK({ type: 'object', properties: { topic: { type: 'object' } } }),
          '404': NOT_FOUND,
          '503': PERSISTENCE,
        },
      },
    },
    '/api/forum/latest-posts': {
      get: {
        tags: ['Forum'],
        summary: 'The latest posts across the forum',
        parameters: [
          query('limit', { type: 'integer', minimum: 1, maximum: 20, default: 8 }, 'Rows.'),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: { posts: { type: 'array', items: { type: 'object' } } },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/forum/search': {
      get: {
        tags: ['Forum'],
        summary: 'Search posts',
        description:
          'A query shorter than 2 or longer than 120 characters returns an empty result, not an error.',
        parameters: [
          query('q', { type: 'string', minLength: 2, maxLength: 120 }, 'Search text.', true),
          query('limit', { type: 'integer', minimum: 1, maximum: 50, default: 20 }, 'Rows.'),
          query(
            'offset',
            { type: 'integer', minimum: 0, maximum: 10000, default: 0 },
            'Skip this many.',
          ),
        ],
        responses: {
          '200': OK({
            type: 'object',
            properties: {
              posts: { type: 'array', items: { type: 'object' } },
              total: { type: 'integer' },
            },
          }),
          '503': PERSISTENCE,
        },
      },
    },

    '/api/coaches': {
      get: {
        tags: ['Coaches'],
        summary: 'The coach directory',
        description: 'Only published coaches who currently hold a verified title.',
        responses: {
          '200': OK({
            type: 'object',
            properties: { coaches: { type: 'array', items: { type: 'object' } } },
          }),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/coaches/{handle}': {
      get: {
        tags: ['Coaches'],
        summary: 'One coach',
        parameters: [pathParam('handle', 'The coach’s handle.')],
        responses: {
          '200': OK({ type: 'object', properties: { coach: { type: 'object' } } }),
          '404': ERROR_RESPONSE('`coach_not_found`'),
          '503': PERSISTENCE,
        },
      },
    },

    '/api/oembed': {
      get: {
        tags: ['Embeds'],
        summary: 'oEmbed provider for studies and games',
        description:
          'Turn a Mistboard link into an embeddable frame. Accepts a study chapter permalink, a game review permalink, or either embed path. See /developers for the frames themselves.',
        parameters: [
          query('url', { type: 'string', format: 'uri' }, 'The Mistboard URL to embed.', true),
          query('maxwidth', { type: 'integer' }, 'Clamped into the range the widget works in.'),
          query('format', { type: 'string', enum: ['json'] }, 'Only `json` is offered.'),
        ],
        responses: {
          '200': OK(ref('OEmbed')),
          '400': ERROR_RESPONSE('`url_required`'),
          '404': ERROR_RESPONSE(
            '`not_embeddable` (URL shape) or `not_found` (private, missing, or unfinished).',
          ),
          '501': ERROR_RESPONSE('`unsupported_format`'),
          '503': PERSISTENCE,
        },
      },
    },
    '/api/openapi.json': {
      get: {
        tags: ['Embeds'],
        summary: 'This document',
        responses: { '200': OK({ type: 'object' }, 'The OpenAPI 3.1 document.') },
      },
    },
  };

  return {
    openapi: '3.1.0',
    info: {
      title: 'Mistboard API',
      version: '0.1.0',
      description:
        'The public read API behind mistboard.com: games, watch feeds, puzzles, studies, ratings, the xiangqi opening explorer, and the forum. Everything here answers to an anonymous GET with no key. It is version 0: field names are stable in practice but not yet promised, and anything not listed here is not public.\n\nErrors are `{ "error": "<code>" }` with the codes named per route. There is no CORS header, so call it from a server or a same-origin page. Please keep polling gentle: the watch feeds cache for seconds, and nothing here is meant to be hit more than about once a second.',
    },
    servers: [{ url: origin }],
    tags: [
      { name: 'Site', description: 'Liveness and site-wide counts.' },
      {
        name: 'Games',
        description: 'Finished games. A game is public once it ends and never before.',
      },
      { name: 'Watch', description: 'The feeds Mistboard TV and /watch read.' },
      { name: 'Ratings', description: 'The rating ladders.' },
      { name: 'Players', description: 'Public profiles.' },
      { name: 'Bots', description: 'Engines a player can be offered.' },
      { name: 'Puzzles', description: 'The puzzle trainer.' },
      { name: 'Studies', description: 'Public studies and their chapters.' },
      { name: 'Xiangqi', description: 'The opening explorer and tournament broadcasts.' },
      { name: 'Forum', description: 'Forum reads.' },
      { name: 'Coaches', description: 'The coach directory.' },
      { name: 'Embeds', description: 'oEmbed and this document.' },
    ],
    paths,
    components: {
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'string', description: 'A snake_case code.' } },
          required: ['error'],
        },
        GameRecord: gameRecord,
        PostgamePlayer: postgamePlayer,
        PostgameGame: postgameGame,
        LeaderboardEntry: leaderboardEntry,
        PuzzleSummary: puzzleSummary,
        PuzzleDetail: puzzleDetail,
        StudySummary: studySummary,
        Chapter: chapter,
        ExplorerMove: explorerMove,
        OEmbed: oembed,
      },
    },
  };
}
