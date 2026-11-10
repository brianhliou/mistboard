import { type BanqiColor, FFQ_BANQI_START_HP, type FFQBanqiPlayerView } from '@mistboard/game';
import { t } from './i18n/catalog.js';
import './live-ffq-banqi.css';

export function createFFQBanqiHpRow(
  view: Pick<FFQBanqiPlayerView, 'hp'>,
  side: BanqiColor,
): HTMLDivElement {
  const row = document.createElement('div');
  row.className = 'ffq-banqi-hp';
  row.dataset.side = side;
  const name = document.createElement('span');
  name.textContent = t(side === 'red' ? 'setup.red' : 'setup.black');
  const bar = document.createElement('progress');
  bar.max = FFQ_BANQI_START_HP;
  bar.value = view.hp[side];
  bar.setAttribute('aria-label', name.textContent);
  const value = document.createElement('span');
  value.textContent = t('live.ffq.hp', { hp: view.hp[side], max: FFQ_BANQI_START_HP });
  row.append(name, bar, value);
  return row;
}
