// Every variant the lab can measure. Adding one is a new adapter file and a
// line here; nothing else in the lab changes.

import type { AnyLabVariant } from '../types.js';
import { duckXiangqiVariant } from './duck-xiangqi.js';
import { xiangqiVariant } from './xiangqi.js';

export const LAB_VARIANTS: readonly AnyLabVariant[] = [xiangqiVariant, duckXiangqiVariant];

export function findLabVariant(id: string): AnyLabVariant {
  const found = LAB_VARIANTS.find((v) => v.id === id);
  if (!found)
    throw new Error(
      `unknown lab variant "${id}"; known: ${LAB_VARIANTS.map((v) => v.id).join(', ')}`,
    );
  return found;
}
