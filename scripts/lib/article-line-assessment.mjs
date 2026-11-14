// Red-POV root assessment shared by fresh measurement and verified cached runs.
export function articleLineAssessment({ cp, mate }) {
  if (mate != null && mate !== 0) return mate > 0 ? '+−' : '−+';
  if (cp == null) return null;
  const magnitude = Math.abs(cp);
  if (magnitude < 30) return '=';
  if (magnitude < 90) return cp > 0 ? '⩲' : '⩱';
  if (magnitude < 250) return cp > 0 ? '±' : '∓';
  return cp > 0 ? '+−' : '−+';
}
