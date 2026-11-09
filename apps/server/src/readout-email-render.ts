import { CONTENT_CAVEATS, contentSummary } from './content-readout.js';
import { emailPublicHost, escapeHtml, type RenderedEmail } from './email-layout.js';
import type {
  MistboardReadoutAction,
  MistboardReadoutProduct,
  MistboardReadoutV1,
} from './mistboard-readout.js';

const number = (value: number): string => value.toLocaleString('en-US');
const E = escapeHtml;
const green = '#16604b';
const muted = '#696760';

export function readoutDelta(current: number, previous: number | undefined): string {
  if (previous === undefined) return 'Comparison unavailable';
  const delta = current - previous;
  const absolute = delta > 0 ? `+${number(delta)}` : number(delta);
  if (!previous) return current ? `${absolute} (new)` : '0 (flat)';
  const percent = Math.round((delta / previous) * 100);
  return `${absolute} (${percent > 0 ? '+' : ''}${percent}%)`;
}

function previousProduct(report: MistboardReadoutV1): MistboardReadoutProduct | undefined {
  const comparison = report.comparison;
  if (
    !comparison ||
    comparison.periodStart !== report.previousPeriodStart ||
    comparison.periodEnd !== report.periodStart ||
    !comparison.product ||
    // If exclusion rules or a backfill changed the prior totals, do not mix
    // those new totals with an older snapshot's returning-player figures.
    comparison.product.completedGames !== report.product?.previousCompletedGames ||
    comparison.product.humanPlayers !== report.product?.previousHumanPlayers
  )
    return undefined;
  return comparison.product;
}

type Metric = { label: string; current: number; previous?: number; growth?: boolean };
type Action = { state: string; title: string; detail: string; url: string; urgent: boolean };

function urgent(action: MistboardReadoutAction): boolean {
  return (
    action.severity === 'blocked' ||
    /persistence|production|engines-missing|broadcast-boards-unservable|engine-workers-stale/.test(
      action.code,
    )
  );
}

function tone(action: Action): { border: string; background: string; text: string } {
  if (action.urgent) return { border: '#a32d28', background: '#fff0ee', text: '#8c2723' };
  if (action.state === 'Resolved') return { border: green, background: '#edf7f0', text: green };
  return { border: '#966719', background: '#fff8e9', text: '#765018' };
}

function actionsForEmail(report: MistboardReadoutV1): Action[] {
  const comparable =
    report.comparison?.periodStart === report.previousPeriodStart &&
    report.comparison.periodEnd === report.periodStart;
  const priority = (action: MistboardReadoutAction) =>
    action.code.endsWith('-resolved')
      ? 0
      : urgent(action)
        ? 3
        : action.severity === 'action'
          ? 2
          : 1;
  const actions = [...report.actions]
    .sort((a, b) => priority(b) - priority(a))
    .slice(0, 3)
    .map((action) => {
      const state = action.code.endsWith('-resolved')
        ? 'Resolved'
        : comparable
          ? report.comparison?.actionKeys.includes(action.dedupeKey)
            ? 'Ongoing review'
            : 'New'
          : 'Review';
      if (action.code === 'puzzle-outlier-set-changed' && report.puzzles?.outliers.length) {
        const puzzle = report.puzzles.outliers[0]!;
        const flags = puzzle.flags
          .map(
            (flag) =>
              ({
                'retry-heavy': 'unusually many wrong attempts',
                'low-approval': 'low approval',
                'high-reveal': 'frequent reveals',
                'high-abandonment': 'frequent abandonment',
              })[flag],
          )
          .join(', ');
        return {
          state,
          title:
            report.puzzles.outliers.length === 1
              ? `Review one puzzle: ${flags}`
              : `Review ${report.puzzles.outliers.length} flagged puzzles`,
          detail: `${puzzle.starts} starts / ${puzzle.sessions} sessions. Next: review the solution and difficulty; record whether to keep or correct it. A statistical flag alone does not prove a defect.`,
          url: `${emailPublicHost}/puzzles/${encodeURIComponent(puzzle.puzzleId)}`,
          urgent: false,
        };
      }
      return {
        state,
        title: action.text,
        detail:
          state === 'Resolved'
            ? 'The previous condition has cleared. No follow-up is needed unless it recurs.'
            : 'Next: inspect the evidence and record the decision in the owning task.',
        url: action.ownerIssue
          ? `https://github.com/brianhliou/mistboard/issues/${action.ownerIssue}`
          : `${emailPublicHost}/ops`,
        urgent: urgent(action),
      };
    });
  if (report.verdict === 'unknown') {
    const missing = report.collectorErrors.map((entry) => entry.section).join(', ');
    actions.unshift({
      state: 'Unknown',
      title: 'Check unavailable or unhealthy data',
      detail: missing
        ? `Unavailable: ${missing}. Inspect the full report before treating this check as healthy.`
        : 'Persistence is unavailable or reported recent errors. Inspect production health before trusting the activity totals.',
      url: `${emailPublicHost}/ops`,
      urgent: true,
    });
  }
  return actions.slice(0, 3);
}

/** Shared data model for the email and the admin page; neither renderer owns the decisions. */
export function buildReadoutSummary(report: MistboardReadoutV1) {
  const product = report.product;
  const before = previousProduct(report);
  const comparison =
    report.comparison?.periodStart === report.previousPeriodStart &&
    report.comparison.periodEnd === report.periodStart
      ? report.comparison
      : null;
  const metrics: Metric[] = product
    ? [
        {
          label: 'Completed human games',
          current: product.completedGames,
          previous: product.previousCompletedGames,
          growth: true,
        },
        {
          label: 'Players',
          current: product.humanPlayers,
          previous: product.previousHumanPlayers,
          growth: true,
        },
        {
          label: 'Returning players',
          current: product.returningPlayers,
          previous: before?.returningPlayers,
        },
        {
          label: 'New accounts',
          current: product.accountsCreated,
          previous: product.previousAccountsCreated,
        },
      ].filter((metric) => typeof metric.current === 'number')
    : [];
  const variants = product?.completedGamesByVariant ?? [];
  const oldVariants = before
    ? new Map(before.completedGamesByVariant.map((entry) => [entry.variant, entry.count]))
    : null;
  const breakdown: Metric[] = [...variants]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((entry) => ({
      label: variantLabel(entry.variant),
      current: entry.count,
      previous: oldVariants ? (oldVariants.get(entry.variant) ?? 0) : undefined,
    }));
  const actions = actionsForEmail(report);
  const extraActions = Math.max(
    0,
    report.actions.length + (report.verdict === 'unknown' ? 1 : 0) - actions.length,
  );
  const context: string[] = [];
  if (
    product &&
    before &&
    product.activeAccounts28d !== undefined &&
    before.activeAccounts28d !== undefined &&
    product.activeAccounts28d !== before.activeAccounts28d
  ) {
    context.push(
      `28-day active players: ${number(product.activeAccounts28d)} vs ${number(before.activeAccounts28d)} at last week's check (overlapping rolling windows).`,
    );
  }
  if (
    report.broadcasts &&
    (report.broadcasts.unservableBoards > 0 ||
      (comparison?.broadcastBoards != null &&
        report.broadcasts.boards !== comparison.broadcastBoards))
  ) {
    const delta =
      comparison?.broadcastBoards == null
        ? ''
        : `${readoutDelta(report.broadcasts.boards, comparison.broadcastBoards)} stored boards; `;
    context.push(
      `Public broadcasts: ${delta}${report.broadcasts.unservableBoards} replay failures.`,
    );
  }
  if (
    report.engines &&
    (report.engines.failedTasks > 0 ||
      report.engines.staleWorkers > 0 ||
      (comparison?.engineFailedTasks != null &&
        report.engines.failedTasks !== comparison.engineFailedTasks))
  ) {
    context.push(
      `Engine failures: ${number(report.engines.failedTasks)}${comparison?.engineFailedTasks == null ? '' : ` vs ${number(comparison.engineFailedTasks)} at last week's check`}; ${report.engines.staleWorkers} stale workers.`,
    );
  }
  if (report.collectorErrors.length)
    context.push(
      `Unavailable: ${report.collectorErrors.map((entry) => entry.section).join(', ')}. Missing data is not a healthy result.`,
    );

  let summary =
    'Product activity is unavailable. Inspect the full report before drawing a conclusion.';
  if (product) {
    summary = `Completed games ${readoutDelta(product.completedGames, product.previousCompletedGames)}${typeof product.humanPlayers === 'number' ? `; players ${readoutDelta(product.humanPlayers, product.previousHumanPlayers)}` : ''}.`;
    if (before) {
      const additional = product.completedGames - product.previousCompletedGames;
      const gains = variants
        .map((entry) => ({
          variant: entry.variant,
          gain: entry.count - (oldVariants?.get(entry.variant) ?? 0),
        }))
        .sort((a, b) => b.gain - a.gain);
      if (additional > 0 && gains[0] && gains[0].gain > 0)
        summary += ` ${variantLabel(gains[0].variant)} accounts for ${Math.round((gains[0].gain / additional) * 100)}% of the additional games.`;
    }
  }
  const title =
    report.verdict === 'unknown'
      ? 'Some data is unavailable'
      : product
        ? `${number(product.completedGames)} completed games ${report.trigger === 'weekly' ? 'this week' : 'in the last 7 complete days'}`
        : 'Mistboard operating review';
  const end = new Date(Date.parse(report.periodEnd) - 1).toISOString().slice(0, 10);
  const period = `${report.periodStart.slice(0, 10)} to ${end} · ${report.trigger === 'weekly' ? 'complete UTC week' : 'rolling 7 complete UTC days'}`;
  const disruptive = report.deploys?.disruptive ?? [];
  const deploy = disruptive.length
    ? `${disruptive.length} release${disruptive.length === 1 ? '' : 's'} held new-game creation over 5 minutes or refused a request. Longest hold: ${(Math.max(...disruptive.map((entry) => entry.heldMs)) / 60_000).toFixed(1)} min; ${disruptive.reduce((sum, entry) => sum + entry.refusedCreates, 0)} refused requests recorded. Agent next: inspect release timings before the next ship.`
    : null;
  return {
    title,
    period,
    summary,
    metrics,
    actions,
    extraActions,
    breakdown,
    context,
    deploy,
    content: contentSummary(report.content),
    contentCaveats: [...CONTENT_CAVEATS],
  };
}

/** Every value and state is also present in text; color never carries meaning alone. */
export function renderReadoutEmail(report: MistboardReadoutV1): RenderedEmail {
  if (report.trigger !== 'weekly') return renderDailyEmail(report);
  const { title, period, summary, metrics, actions, extraActions, breakdown, context, deploy } =
    buildReadoutSummary(report);
  const content = contentSummary(report.content);
  const contentUrl = `${emailPublicHost}/ops?tab=activity#content`;
  const contentHtml = `<h2 style="font-size:17px;margin:24px 0 9px">Content</h2><p style="font-size:13px;line-height:1.7">${content.map(E).join('<br>')}</p><p style="font-size:12px">Observed visitors may include automation. Board events cover xiangqi replays only; assisted outcomes overlap.</p><a href="${E(contentUrl)}">Article comparison and definitions →</a>`;
  const text: string[] = ['Mistboard weekly review', period, '', summary, ''];
  for (const metric of metrics)
    text.push(
      `${metric.label}: ${number(metric.current)} · ${readoutDelta(metric.current, metric.previous)}${metric.previous === undefined ? '' : ` vs ${number(metric.previous)}`}`,
    );
  text.push('', 'What needs attention');
  if (!actions.length) text.push('No action needed.');
  for (const action of actions)
    text.push(`${action.state}: ${action.title}`, action.detail, action.url, '');
  if (deploy)
    text.push(
      'Release follow-up',
      deploy,
      `${emailPublicHost}/ops?tab=operations#deploy-history`,
      '',
    );
  if (extraActions)
    text.push(
      `${extraActions} more ${extraActions === 1 ? 'action' : 'actions'} in the full report.`,
    );
  if (breakdown.length)
    text.push(
      '',
      'Variant games: current / previous week / change',
      ...breakdown.map(
        (entry) =>
          `${entry.label}: ${number(entry.current)} / ${entry.previous === undefined ? 'unavailable' : number(entry.previous)} / ${readoutDelta(entry.current, entry.previous)}`,
      ),
    );
  text.push(
    '',
    ...context,
    '',
    'Content',
    ...content,
    'Observed visitors may include automation. Board events cover xiangqi replays only; assisted outcomes overlap.',
    contentUrl,
    '',
    'Database counts include guest browsers and accounts; bot-vs-bot games are excluded. Returning players is not a cohort-retention rate.',
    `${emailPublicHost}/ops`,
  );

  const cards = metrics.map(
    (metric) =>
      `<td width="50%" valign="top" style="padding:13px 11px;background:#fbfaf7;border:1px solid #dedbd4;border-radius:6px"><div style="font-size:12px;color:${muted}">${E(metric.label)}</div><div style="font-size:31px;font-weight:700;line-height:1.5">${number(metric.current)}</div><div style="font-size:13px;color:${metric.growth && metric.current > (metric.previous ?? metric.current) ? green : muted}">${E(readoutDelta(metric.current, metric.previous))}${metric.previous === undefined ? '' : ` vs ${number(metric.previous)}`}</div></td>`,
  );
  const attention = actions
    .map(
      (action) =>
        `<div style="margin-top:10px;padding:15px;border-left:4px solid ${tone(action).border};background:${tone(action).background};border-radius:4px"><div style="font-size:11px;font-weight:700;color:${tone(action).text}">${E(action.urgent ? 'URGENT' : action.state.toUpperCase())}</div><h3 style="font-size:15px;line-height:1.5;margin:7px 0">${E(action.title)}</h3><p style="font-size:13px;line-height:1.6;margin:7px 0">${E(action.detail)}</p><a href="${E(action.url)}" style="font-size:13px;color:${tone(action).text};font-weight:700">Review evidence →</a></div>`,
    )
    .join('');
  const table = breakdown.length
    ? `<h2 style="font-size:17px;margin:24px 0 10px">Where the change came from</h2><table width="100%" cellspacing="0" cellpadding="7" style="font-size:12px;border-collapse:collapse"><thead><tr><th scope="col" align="left">Variant games</th><th scope="col" align="right">This week</th><th scope="col" align="right">Last week</th><th scope="col" align="right">Change</th></tr></thead><tbody>${breakdown.map((entry) => `<tr><th scope="row" align="left" style="font-weight:400;border-top:1px solid #eeece6">${E(entry.label)}</th><td align="right" style="border-top:1px solid #eeece6">${number(entry.current)}</td><td align="right" style="border-top:1px solid #eeece6">${entry.previous === undefined ? '—' : number(entry.previous)}</td><td align="right" style="border-top:1px solid #eeece6">${E(readoutDelta(entry.current, entry.previous))}</td></tr>`).join('')}</tbody></table>`
    : '';
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(title)}</title></head><body style="margin:0;background:#eeeae3;color:#34322d;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif"><div style="display:none;max-height:0;overflow:hidden">${E(summary)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:20px 8px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="width:100%;max-width:640px;border:1px solid #d8d7d4;border-radius:9px;background:#fff"><tr><td style="padding:24px 16px"><div style="font-size:12px;color:#1f6f5b;font-weight:700">MISTBOARD / ${report.trigger === 'weekly' ? 'WEEKLY REVIEW' : 'OPERATING CHECK'}</div><p style="font-size:12px;color:${muted};line-height:1.6">${E(period)}</p><h1 style="font-size:25px;line-height:1.25;margin:12px 0">${E(title)}</h1><p style="font-size:14px;line-height:1.6">${E(summary)}</p><table role="presentation" width="100%" cellspacing="6" cellpadding="0">${cards.length ? `<tr>${cards.slice(0, 2).join('')}</tr><tr>${cards.slice(2, 4).join('')}</tr>` : ''}</table><h2 style="font-size:17px;margin:24px 0 10px">What needs attention</h2>${attention || '<p style="font-size:14px">No action needed.</p>'}${deploy ? `<div style="margin-top:12px;padding:14px;border:1px solid #dedbd4;border-radius:4px"><strong style="font-size:12px">Release follow-up</strong><p style="font-size:13px;line-height:1.6">${E(deploy)}</p><a href="${E(emailPublicHost)}/ops?tab=operations#deploy-history" style="font-size:13px;color:#1f6f5b">Open deploy history →</a></div>` : ''}${extraActions ? `<p>${extraActions} more ${extraActions === 1 ? 'action' : 'actions'} in the full report.</p>` : ''}${table}${contentHtml}${context.length ? `<h2 style="font-size:17px;margin:24px 0 9px">Other changes</h2><p style="font-size:13px;line-height:1.7">${context.map(E).join('<br>')}</p>` : ''}<p style="font-size:11px;color:${muted};line-height:1.6">UTC days. Database counts include guests and accounts; bot-vs-bot games are excluded. Returning players is not a cohort-retention rate.</p><a href="${E(emailPublicHost)}/ops" style="display:inline-block;margin-top:8px;padding:12px 16px;background:#1f6f5b;color:#fff;border-radius:5px;text-decoration:none;font-size:13px;font-weight:700">Full report and history →</a></td></tr></table></td></tr></table></body></html>`;
  return { text: text.join('\n'), html };
}

function variantLabel(id: string): string {
  const words = id.split('-').join(' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function renderDailyEmail(report: MistboardReadoutV1): RenderedEmail {
  const actions = actionsForEmail(report);
  const title = `Mistboard check: ${report.verdict.toUpperCase()}`;
  const unavailable = report.collectorErrors.length
    ? `Unavailable: ${report.collectorErrors.map((entry) => entry.section).join(', ')}.`
    : '';
  const text = [
    title,
    ...actions.flatMap((action) => [action.title, action.detail, action.url]),
    unavailable,
    `${emailPublicHost}/ops`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:Arial,sans-serif;color:#34322d;margin:0;padding:24px;background:#eeeae3"><table role="presentation" width="600" style="width:100%;max-width:600px;background:#fff;border:1px solid #d8d7d4;border-radius:8px" cellpadding="20"><tr><td><h1 style="font-size:21px">${E(title)}</h1>${actions.map((action) => `<h2 style="font-size:16px">${E(action.title)}</h2><p style="font-size:14px;line-height:1.6">${E(action.detail)}</p><a href="${E(action.url)}" style="color:#1f6f5b">Review evidence →</a>`).join('')}${unavailable ? `<p style="color:#8c2723">${E(unavailable)}</p>` : ''}<p><a href="${E(emailPublicHost)}/ops" style="color:#1f6f5b">Full report and history →</a></p></td></tr></table></body></html>`;
  return { text, html };
}
