// House UI icon set: professional line glyphs from Lucide (MIT-licensed,
// designer-drawn), rendered as inline SVG that inherits `currentColor`. This
// replaces the dobutsu mascot PNGs with one factory — `buildUiIcon(name)` — so
// the whole app speaks one icon language and a new icon is a one-line map entry.
// Sizing/colour is the consumer's job via CSS (see ui-icon.css); the glyph
// tints to the surrounding text colour, so no per-theme asset variants.
import {
  Bell,
  Bot,
  ChessKnight,
  Crown,
  createElement,
  Globe,
  Handshake,
  Heart,
  type IconNode,
  Info,
  Lock,
  Mail,
  Megaphone,
  MessageSquare,
  MessagesSquare,
  Newspaper,
  Puzzle,
  RadioTower,
  Sparkles,
  SquarePen,
  Store,
  Swords,
  TrendingUp,
  Trophy,
  User,
  Users,
} from 'lucide';
import './ui-icon.css';
import type { AnnouncementKind } from './announcements.js';

export type UiIconName =
  | 'achievement-first-game'
  | 'achievement-forum'
  | 'achievement-lock'
  | 'achievement-puzzle'
  | 'achievement-rated'
  | 'achievement-versus'
  | 'announcement-release'
  | 'announcement-article'
  | 'announcement-status'
  | 'announcement-update'
  | 'challenge-friend'
  | 'correspondence'
  | 'create-topic'
  | 'event-broadcast'
  | 'event-tournament'
  | 'featured-channel'
  | 'find-opponent'
  | 'forum-topic'
  | 'language'
  | 'notification'
  | 'play-engine'
  | 'play-game'
  | 'player-human'
  | 'store'
  | 'support'
  | 'title-champion';

// Semantic app concept → Lucide glyph. Keep the mapping here, not at call sites,
// so the icon language is swappable in one place.
const UI_ICON_NODES: Record<UiIconName, IconNode> = {
  // Achievement glyphs, keyed by the definition's icon (@mistboard/game
  // achievements.ts) as `achievement-<icon>`.
  'achievement-first-game': ChessKnight,
  'achievement-forum': MessageSquare,
  'achievement-lock': Lock,
  'achievement-puzzle': Puzzle,
  'achievement-rated': TrendingUp,
  'achievement-versus': Handshake,
  'announcement-release': Megaphone,
  'announcement-article': Newspaper,
  'announcement-status': Info,
  'announcement-update': Sparkles,
  'challenge-friend': Swords,
  correspondence: Mail,
  'create-topic': SquarePen,
  'event-broadcast': RadioTower,
  'event-tournament': Trophy,
  'featured-channel': Crown,
  'find-opponent': Users,
  'forum-topic': MessagesSquare,
  // Globe, not Lucide's Languages: lichess's 文A mark is a glyph in their own
  // icon font (licon.Language, U+E06E), so there is nothing to import, and the
  // nearest Lucide equivalent is six strokes that turn to mush in an 18px row.
  language: Globe,
  notification: Bell,
  'play-engine': Bot,
  'play-game': Swords,
  'player-human': User,
  store: Store,
  support: Heart,
  'title-champion': Crown,
};

export function buildUiIcon(name: UiIconName, className = ''): SVGElement {
  const svg = createElement(UI_ICON_NODES[name]);
  svg.classList.add('ui-icon', `ui-icon-${name}`);
  for (const extra of className.split(' ')) {
    if (extra) svg.classList.add(extra);
  }
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  return svg;
}

export function uiIconForAnnouncementKind(kind: AnnouncementKind): UiIconName {
  // One glyph per kind: four kinds sharing two glyphs made a release and an
  // update indistinguishable in the feed's marker column.
  switch (kind) {
    case 'release':
      return 'announcement-release';
    case 'update':
      return 'announcement-update';
    case 'article':
      return 'announcement-article';
    case 'status':
      return 'announcement-status';
  }
}
