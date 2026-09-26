import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type OpsSchedule,
  type OpsTour,
  type PollState,
  parseSourceUrls,
  pollStatusText,
  schedulePanel,
} from './xiangqi-broadcast-ops.js';

describe('parseSourceUrls', () => {
  it('splits one URL per line, trimming blanks', () => {
    const raw = '  https://a.test/1.html \n\nhttps://a.test/2.html\n  ';
    expect(parseSourceUrls(raw)).toEqual(['https://a.test/1.html', 'https://a.test/2.html']);
  });

  it('also tolerates space- and comma-separated URLs', () => {
    expect(
      parseSourceUrls('https://a.test/1.html, https://a.test/2.html https://a.test/3.html'),
    ).toEqual(['https://a.test/1.html', 'https://a.test/2.html', 'https://a.test/3.html']);
  });

  it('de-duplicates in first-seen order', () => {
    const raw = 'https://a.test/1.html\nhttps://a.test/2.html\nhttps://a.test/1.html';
    expect(parseSourceUrls(raw)).toEqual(['https://a.test/1.html', 'https://a.test/2.html']);
  });

  it('returns a single URL unchanged (back-compat with the old single-input flow)', () => {
    expect(parseSourceUrls('http://www.dpxq.com/hldcg/search/view_m_140500.html')).toEqual([
      'http://www.dpxq.com/hldcg/search/view_m_140500.html',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseSourceUrls('   \n  ')).toEqual([]);
  });
});

function schedule(state: Partial<PollState>, overrides: Partial<OpsSchedule> = {}): OpsSchedule {
  const pollState: PollState = {
    mode: 'auto',
    polling: false,
    reason: 'auto-before',
    opensAt: '2026-10-01T12:00:00+08:00',
    closesAt: '2026-10-15T23:59:59+08:00',
    afterEvent: false,
    ...state,
  };
  return {
    pollMode: pollState.mode,
    pollEnabled: pollState.polling,
    pollIntervalMs: 30_000,
    pollState,
    ...overrides,
  };
}

function opsTour(sched: OpsSchedule, sourceUrl: string | null = 'mistboard-discover://x'): OpsTour {
  return {
    tour: {
      slug: '2026-asian-individual-men',
      name: 'Asian',
      startsAt: '2026-10-02T00:00:00+08:00',
      endsAt: '2026-10-08T23:59:59+08:00',
    },
    sourceUrl,
    schedule: sched,
    roundCount: 0,
    boardCount: 0,
    liveBoardCount: 0,
    completeBoardCount: 0,
    scheduledBoardCount: 0,
    totalPlies: 0,
    updatedAt: null,
    sourceHealth: {
      state: 'unknown',
      label: 'No sync log',
      lastKind: null,
      lastMessage: null,
      checkedAt: null,
      buckets: {
        successfulPolls: 0,
        fetchFailures: 0,
        parseFailures: 0,
        dataFailures: 0,
        configFailures: 0,
        operatorFailures: 0,
        corrections: 0,
      },
    },
    syncLogs: [],
  };
}

describe('pollStatusText', () => {
  it('says when an auto window opens, on the event clock', () => {
    expect(pollStatusText(schedule({}))).toBe(
      'Not polling (auto: window opens Oct 1, 2026, 12:00 PM)',
    );
  });

  it('says polling now and when an open auto window closes', () => {
    expect(pollStatusText(schedule({ polling: true, reason: 'auto-open' }))).toBe(
      'Polling now, every 30s (auto: window closes Oct 15, 2026, 11:59 PM)',
    );
  });

  it('names the slow cadence once the event is over', () => {
    expect(
      pollStatusText(schedule({ mode: 'on', polling: true, reason: 'on', afterEvent: true })),
    ).toBe('Polling now, every 30 min while late records land (on: always)');
  });

  it('covers closed, undated, off and sourceless tours', () => {
    expect(pollStatusText(schedule({ reason: 'auto-closed' }))).toBe(
      'Not polling (auto: window closed Oct 15, 2026, 11:59 PM)',
    );
    expect(
      pollStatusText(schedule({ reason: 'auto-undated', opensAt: null, closesAt: null })),
    ).toBe('Not polling (auto: the tour has no dates; choose On to poll it)');
    expect(pollStatusText(schedule({ mode: 'off', reason: 'off' }))).toBe('Not polling (off)');
    expect(pollStatusText(schedule({ reason: 'no-source' }))).toBe('Not polling (no source URL)');
  });
});

describe('schedulePanel', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders a three-way Auto / On / Off control with the saved mode checked', () => {
    const panel = schedulePanel(opsTour(schedule({})));
    const radios = [...panel.querySelectorAll<HTMLInputElement>('input[type="radio"]')];
    expect(radios.map((input) => input.value)).toEqual(['auto', 'on', 'off']);
    expect(radios.find((input) => input.checked)?.value).toBe('auto');
    expect(panel.querySelector('.xqb-ops-poll-result')?.textContent).toContain('window opens');
  });

  it('disables On for a tour with no source', () => {
    const panel = schedulePanel(opsTour(schedule({ reason: 'no-source' }), null));
    const on = panel.querySelector<HTMLInputElement>('input[value="on"]');
    expect(on?.disabled).toBe(true);
    expect(panel.querySelector<HTMLInputElement>('input[value="auto"]')?.disabled).toBe(false);
  });

  it("saves the chosen mode and shows the server's new state", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        schedule: schedule({ mode: 'on', polling: true, reason: 'on' }, { pollIntervalMs: 60_000 }),
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const panel = schedulePanel(opsTour(schedule({})));
    panel.querySelector<HTMLInputElement>('input[value="on"]')!.checked = true;
    panel.querySelector<HTMLInputElement>('input[type="number"]')!.value = '60';
    panel.querySelector<HTMLButtonElement>('button')!.click();
    await vi.waitFor(() =>
      expect(panel.querySelector('.xqb-ops-poll-result')?.textContent).toBe(
        'Polling now, every 60s (on: always)',
      ),
    );
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ mode: 'on', intervalMs: 60_000 });
  });
});
