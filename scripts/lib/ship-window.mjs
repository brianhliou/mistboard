// The ship window: production restarts at most once per window (default 4h),
// so releases batch instead of each session shipping on its own "ship".
// 2026-10-16 restarted prod 7 times (08:33 to 16:52 PDT) while the rule was
// "two ships a day, batched": a cadence every session must keep lives in the
// tool they all run, with a logged bypass (--extra-ship "<reason>") for a prod
// bug, not in instructions each session reads.
//
// "Last push" comes from the release log (~/.local/share/mistboard/
// releases.jsonl): a push counts when the push itself succeeded, whatever the
// release's outcome (a release whose hosted CI failed after the push still
// restarted prod), and only when it deployed. Pure functions here; the git and
// file reads are release-prod.mjs's.

export const DEFAULT_SHIP_WINDOW_HOURS = 4;
export const PUSH_STAGE_LABEL = 'git push release head';
const HOUR_MS = 3_600_000;

function parseTime(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

function sameRevision(left, right) {
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

/**
 * When this record's push reached the remote, or null if it never pushed.
 * In order: `pushedAt` (written at the moment the push succeeds, since
 * 2026-10-16); the end of a successful "git push release head" stage; for a
 * record with no stage list at all, startedAt when it pushed a head production
 * was not already serving. A record whose stages show no successful push
 * (refused, failed in the gate) never counts, whatever its `push` flag says.
 */
export function pushTimeOf(record) {
  if (!record || typeof record !== 'object') return null;
  const pushedAt = parseTime(record.pushedAt);
  if (pushedAt !== null) return pushedAt;
  if (Array.isArray(record.stages)) {
    const stage = record.stages.find(
      (entry) => entry && entry.label === PUSH_STAGE_LABEL && entry.ok === true,
    );
    if (!stage) return null;
    const started = parseTime(stage.startedAt);
    if (started === null) return null;
    return started + (Number.isFinite(stage.ms) ? stage.ms : 0);
  }
  if (
    record.push === true &&
    record.head &&
    !sameRevision(record.head, record.productionRevisionBefore ?? '')
  ) {
    return parseTime(record.startedAt);
  }
  return null;
}

/**
 * Did this record's push restart production? A push that changed nothing
 * deploy-affecting (deployRequired false), or pushed a head main already had,
 * did not.
 */
export function restartedProd(record) {
  if (pushTimeOf(record) === null) return false;
  if (record.deployRequired === false) return false;
  if (record.head && record.targetRevision && sameRevision(record.head, record.targetRevision)) {
    return false;
  }
  return true;
}

/** Parse the release log; bad lines are skipped, never fatal. */
export function parseReleaseLog(text) {
  const records = [];
  for (const line of String(text ?? '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      if (record && typeof record === 'object') records.push(record);
    } catch {}
  }
  return records;
}

/** Every production-restarting push in the log, oldest first. */
export function prodPushes(records) {
  return records
    .filter(restartedProd)
    .map((record) => ({
      at: pushTimeOf(record),
      source: 'release log',
      cwd: record.cwd ?? null,
      head: record.head ?? null,
      outcome: record.outcome ?? null,
      extraShip: record.extraShip ?? null,
    }))
    .sort((left, right) => left.at - right.at);
}

/**
 * The remote tip is accounted for when a logged release pushed it. A tip no
 * logged push explains was pushed from outside the script (a plain git push,
 * another machine) or by a release still running; its committer date is the
 * cheap lower bound for when that push happened.
 */
export function tipAccounted(records, tipRevision) {
  if (!tipRevision) return true;
  return records.some(
    (record) => pushTimeOf(record) !== null && sameRevision(record.head ?? '', tipRevision),
  );
}

/**
 * The most recent production push, from the log and (optionally) an unlogged
 * remote tip: { at, source, cwd, head } or null.
 */
export function lastProdPush({ records, tip = null }) {
  const pushes = prodPushes(records);
  let last = pushes.length > 0 ? pushes[pushes.length - 1] : null;
  if (
    tip &&
    Number.isFinite(tip.committedAt) &&
    !tipAccounted(records, tip.revision) &&
    (!last || tip.committedAt > last.at)
  ) {
    last = {
      at: tip.committedAt,
      source: 'unlogged push of the remote tip (committer date)',
      cwd: null,
      head: tip.revision,
      outcome: null,
      extraShip: null,
    };
  }
  return last;
}

/**
 * The guard's decision. `allow` when no push sits inside the window, `bypass`
 * when one does and --extra-ship gave a reason, `refuse` otherwise.
 */
export function evaluateShipWindow({
  now,
  last,
  windowHours = DEFAULT_SHIP_WINDOW_HOURS,
  extraShip = null,
}) {
  if (!last) return { decision: 'allow', open: true, opensAt: null, last: null, windowHours };
  const opensAt = last.at + windowHours * HOUR_MS;
  const open = now >= opensAt;
  const bypass = !open && typeof extraShip === 'string' && extraShip.trim() !== '';
  return {
    decision: open ? 'allow' : bypass ? 'bypass' : 'refuse',
    open,
    opensAt,
    last,
    windowHours,
  };
}

/** --extra-ship's value: a reason is required. */
export function parseExtraShipReason(value) {
  const reason = typeof value === 'string' ? value.trim() : '';
  if (reason === '' || reason.startsWith('--')) {
    throw new Error('--extra-ship needs a reason, e.g. --extra-ship "prod bug: <what is broken>"');
  }
  return reason;
}

export function parseWindowHours(value) {
  const hours = Number(value);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error('--ship-window-hours must be a positive number');
  }
  return hours;
}

/**
 * Parse `git for-each-ref --format='%(refname:short)%09%(worktreepath)'` plus
 * an ahead count per branch into parked work: branches with commits not on
 * the remote main, sorted by name.
 */
export function parkedBranches(entries, { current = null } = {}) {
  return entries
    .filter((entry) => entry?.branch && Number(entry.ahead) > 0)
    .map((entry) => ({
      branch: entry.branch,
      worktree: entry.worktree || null,
      ahead: Number(entry.ahead),
      current: entry.branch === current,
    }))
    .sort((left, right) => left.branch.localeCompare(right.branch));
}

export function parseBranchRefs(output) {
  return String(output ?? '')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const [branch, worktree = ''] = line.split('\t');
      return { branch: branch.trim(), worktree: worktree.trim() || null };
    });
}

export function formatClock(ms, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(new Date(ms));
  const get = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')} ${get('timeZoneName')}`;
}

export function formatSpan(ms) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** The lines the guard prints for a decision. */
export function describeShipWindow(verdict, { now, parked = [], timeZone } = {}) {
  const lines = [];
  const { last } = verdict;
  if (!last) {
    lines.push(`ship window: open (no production push on record)`);
    return lines;
  }
  const from = last.cwd ? ` from ${last.cwd}` : '';
  const how = last.source === 'release log' ? '' : ` [${last.source}]`;
  lines.push(
    `ship window: last production push ${formatClock(last.at, timeZone)} (${formatSpan(
      now - last.at,
    )} ago)${from}${how}`,
  );
  if (verdict.open) {
    lines.push(`ship window: open (window is ${verdict.windowHours}h)`);
    return lines;
  }
  lines.push(
    `ship window: closed until ${formatClock(verdict.opensAt, timeZone)} (${formatSpan(
      verdict.opensAt - now,
    )} from now; window is ${verdict.windowHours}h)`,
  );
  if (parked.length > 0) {
    lines.push('parked work to batch into the next ship:');
    for (const entry of parked) {
      lines.push(
        `  ${entry.branch} (+${entry.ahead}) ${entry.worktree ?? '(no worktree)'}${
          entry.current ? '  <- this release' : ''
        }`,
      );
    }
  } else {
    lines.push('parked work: no agent/* branch is ahead of main');
  }
  return lines;
}
