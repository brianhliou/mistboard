import { describe, expect, it } from 'vitest';
import {
  applyClockEmphasis,
  clockEmergencyMs,
  clockFractionLeft,
  setClockFace,
} from './clock-emphasis.js';

describe('clock emphasis', () => {
  it('uses an eighth of the start, clamped to 10-60 s, as the emergency band', () => {
    expect(clockEmergencyMs(60_000)).toBe(10_000);
    expect(clockEmergencyMs(300_000)).toBe(37_500);
    expect(clockEmergencyMs(1_800_000)).toBe(60_000);
  });

  it('clamps the share left to 0..1 (an increment can push past the start)', () => {
    expect(clockFractionLeft(90_000, 60_000)).toBe(1);
    expect(clockFractionLeft(-5, 60_000)).toBe(0);
    expect(clockFractionLeft(30_000, 60_000)).toBe(0.5);
  });

  it('marks the row and clears it when there is no live start time', () => {
    const row = document.createElement('div');
    applyClockEmphasis(row, 5_000, 60_000);
    expect(row.classList.contains('emerg')).toBe(true);
    expect(row.classList.contains('has-bar')).toBe(true);
    expect(row.style.getPropertyValue('--clock-left')).toBe('0.0833');
    applyClockEmphasis(row, 5_000, null);
    expect(row.classList.contains('emerg')).toBe(false);
    expect(row.classList.contains('has-bar')).toBe(false);
    expect(row.style.getPropertyValue('--clock-left')).toBe('');
  });

  it('draws the lichess face: padded minutes, a colon span, small tenths', () => {
    const el = document.createElement('strong');
    setClockFace(el, '0:24.9');
    expect(el.textContent).toBe('00:24.9');
    expect(el.querySelector('.clock-sep')?.textContent).toBe(':');
    expect(el.querySelector('.clock-tenths')?.textContent).toBe('.9');
    setClockFace(el, '12:05');
    expect(el.textContent).toBe('12:05');
    expect(el.querySelector('.clock-tenths')).toBeNull();
    setClockFace(el, '1:05:00');
    expect(el.textContent).toBe('1:05:00');
  });
});
