// Generic /analysis/<variant> entry: builds the variant dropdown (lichess's
// top-left variant select) and dispatches to the variant's analysis mount.
// The catalog (analysis-catalog.ts) is the fail-closed allowlist — main.ts only
// routes here for known slugs; the loader map below must cover every member of
// AnalysisVariantId or the build fails.

import './analysis-picker.css';
import { ANALYSIS_VARIANTS, type AnalysisVariantId } from './analysis-catalog.js';
import { EDITOR_VARIANTS, type EditorVariantId } from './editor/editor-catalog.js';
import { variantDisplayLabel } from './game-display.js';
import { t } from './i18n/catalog.js';
import { renderVariantMarker } from './variant-markers.js';
import { variantMiniIdForGameSpec } from './variants.js';

type AnalysisMount = (root: HTMLElement, picker: HTMLElement) => void | Promise<void>;

// Per-variant dynamic imports keep each board/review stack in its own chunk.
// Record over the union: adding a catalog member without a loader is a type
// error, and there is deliberately no default branch.
const LOADERS: Record<AnalysisVariantId, () => Promise<AnalysisMount>> = {
  xiangqi: () => import('./xiangqi-analysis-page.js').then((m) => m.mountXiangqiAnalysisPage),
  banqi: () => variantMount('banqi'),
  jungle: () => variantMount('jungle'),
  'jungle-flip': () => variantMount('jungle-flip'),
  'fortress-xiangqi': () => variantMount('fortress-xiangqi'),
  jieqi: () => variantMount('jieqi'),
  'dark-xiangqi': () => variantMount('dark-xiangqi'),
  'dark-chess': () => variantMount('dark-chess'),
  'duck-xiangqi': () => variantMount('duck-xiangqi'),
};

function variantMount(id: Exclude<AnalysisVariantId, 'xiangqi'>): Promise<AnalysisMount> {
  return import('./variant-analysis.js').then(
    (m) => (root: HTMLElement, picker: HTMLElement) => m.mountVariantAnalysisPage(root, id, picker),
  );
}

export async function mountAnalysisPage(
  root: HTMLElement,
  variant: AnalysisVariantId,
): Promise<void> {
  // Shared visual contract for every standalone analysis board. Review/postgame
  // pages use the same scaffold but keep their own board perimeter treatment.
  root.classList.add('analysis-route');
  const mount = await LOADERS[variant]();
  await mount(root, buildVariantPicker(variant));
}

// The top-left variant dropdown (lichess analysis anatomy): the ONLY element in
// the left rail — [variant marker] [select], one bordered card. Switching
// navigates to the target board fresh (seeded ?moves= / ?fen= links are
// variant-specific, so the query is dropped deliberately).
//
// The board editor (/editor) shares the picker; it passes its own base path and
// gets its own SHORTER list, because the editor covers a subset of the analysis
// catalog (editor-catalog.ts). Listing an editor-less variant in the editor's
// dropdown would offer the reader a 404. The overloads make the pairing a type
// error rather than a convention: an '/editor' picker only accepts an
// EditorVariantId.
export function buildVariantPicker(current: AnalysisVariantId): HTMLElement;
export function buildVariantPicker(current: AnalysisVariantId, basePath: '/analysis'): HTMLElement;
export function buildVariantPicker(current: EditorVariantId, basePath: '/editor'): HTMLElement;
export function buildVariantPicker(
  current: AnalysisVariantId,
  basePath: '/analysis' | '/editor' = '/analysis',
): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'analysis-variant-picker';
  const icon = document.createElement('span');
  icon.className = 'analysis-variant-picker__icon';
  const miniId = variantMiniIdForGameSpec(current);
  if (miniId) icon.innerHTML = renderVariantMarker(miniId, { size: 28 });
  const select = document.createElement('select');
  select.className = 'analysis-variant-picker__select';
  select.setAttribute(
    'aria-label',
    t(basePath === '/editor' ? 'editor.variantPicker' : 'analysis.variantPicker'),
  );
  for (const variant of basePath === '/editor' ? EDITOR_VARIANTS : ANALYSIS_VARIANTS) {
    const option = document.createElement('option');
    option.value = variant.id;
    option.textContent = variantDisplayLabel(variant.id);
    select.append(option);
  }
  // Select AFTER the options are attached: pre-attach `option.selected = true`
  // is unreliable (jsdom resolves it to the wrong option entirely).
  select.value = current;
  select.addEventListener('change', () => {
    window.location.assign(`${basePath}/${select.value}`);
  });
  wrap.append(icon, select);
  return wrap;
}
