# Sound credits

The `futuristic/`, `nes/`, `piano/`, and `sfx/` sound sets are from
[lichess (lila)](https://github.com/lichess-org/lila), authored by
[Enigmahack](https://github.com/Enigmahack), licensed AGPLv3+ (per lila's
COPYING.md). Mistboard ships a subset of each set's files.

The `wood/` sound set (real pieces on a wooden board) is from
[el_boss](https://freesound.org/people/el_boss/)'s "Chess Puzzle Blitz SFX"
pack ([freesound.org pack 30764](https://freesound.org/people/el_boss/packs/30764/)),
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
(public domain, no attribution required — credited here as courtesy):
`move.mp3` (Piece Placement, 546119), `capture.mp3` (Piece Capture, 546120),
`slide.mp3` (Piece Slide, 546118), `start.mp3` (Board Start, 546121).
Its terminal cues are from
[Kenney's Music Jingles](https://www.kenney.nl/assets/music-jingles), also
released under CC0 1.0: `win.ogg` is pizzicato 02, `loss.ogg` is pizzicato 01,
and `draw.ogg` is pizzicato 12.

The Duck Xiangqi quack (`duck/quack.mp3`) is
[D4XX](https://freesound.org/people/D4XX/)'s "Ducks"
([freesound.org 607226](https://freesound.org/people/D4XX/sounds/607226/)),
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/)
(credited here as courtesy). Mistboard ships one quack from it, trimmed to
0.28 s, mono, and peak-matched to the wood set's `move.mp3`. The synthesized
quack in `apps/web/src/duck-xiangqi-quack.ts` plays while the file decodes.

The "Mist" sounds are Mistboard's own WebAudio-synthesized tones
(`apps/web/src/live-sound.ts`), no external assets.
