import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const profilePath = resolve(here, '..', 'config', 'product-profile.json');
const rawProfile = JSON.parse(readFileSync(profilePath, 'utf8'));

export const PRODUCT_GAME_SPEC_IDS = Object.freeze([...rawProfile.gameSpecIds]);
export const PRODUCT_GAME_SPEC_ID_SET = new Set(PRODUCT_GAME_SPEC_IDS);
// Variant flags come from the spec map; `productAdditionalServerFlags` carries
// the launched NON-variant surfaces (correspondence), which have no game-spec id
// of their own but are just as much part of the product profile.
export const PRODUCT_SERVER_FLAGS = Object.freeze([
  ...new Set([
    ...PRODUCT_GAME_SPEC_IDS.flatMap((gameSpecId) => {
      const flag = rawProfile.serverFlagByGameSpecId[gameSpecId];
      return flag ? [flag] : [];
    }),
    ...(rawProfile.productAdditionalServerFlags ?? []),
  ]),
]);

validateProfile(rawProfile);

function validateProfile(profile) {
  if (!Array.isArray(profile.gameSpecIds) || profile.gameSpecIds.length === 0) {
    throw new Error('product profile must contain gameSpecIds');
  }
  if (new Set(profile.gameSpecIds).size !== profile.gameSpecIds.length) {
    throw new Error('product profile gameSpecIds must be unique');
  }
  if (
    !profile.serverFlagByGameSpecId ||
    typeof profile.serverFlagByGameSpecId !== 'object' ||
    (profile.productAdditionalServerFlags !== undefined &&
      !Array.isArray(profile.productAdditionalServerFlags))
  ) {
    throw new Error('product profile flag configuration is invalid');
  }
}
