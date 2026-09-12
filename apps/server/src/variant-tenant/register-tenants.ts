/**
 * The single side-effect import that populates the VariantTenant registry.
 * index.ts (and any test that exercises registry-backed dispatch) imports
 * this module; each *-registration.ts file registers its tenant at module
 * load. Adding a variant = adding its registration import here.
 */

import '../banqi-registration.js';
import '../dark-chess-registration.js';
import '../dark-crazyhouse-registration.js';
import '../dark-mini-xiangqi-registration.js';
import '../dark-xiangqi-registration.js';
import '../duck-xiangqi-registration.js';
import '../fortress-xiangqi-registration.js';
import '../jieqi-registration.js';
import '../jungle-flip-registration.js';
import '../jungle-registration.js';
import '../kriegspiel-registration.js';
import '../luzhanqi-registration.js';
import '../mahjong-registration.js';
import '../mini-xiangqi-registration.js';
import '../reveal-chess-registration.js';
import '../xiangqi-registration.js';
