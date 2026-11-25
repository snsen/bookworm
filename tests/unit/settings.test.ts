import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from '../../src/settings';

describe('settings', () => {
  beforeEach(() => localStorage.clear());

  it('uses dark-room defaults', () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.tone).toBe('sepia');
    expect(DEFAULT_SETTINGS.brightness).toBeLessThan(1);
    expect(DEFAULT_SETTINGS.sound).toBe(false);
  });

  it('clamps and validates values', () => {
    const s = normalizeSettings({ interval: 1, brightness: 5, tone: 'neon', background: 'red', loop: 'yes' });
    expect(s.interval).toBe(3);
    expect(s.brightness).toBe(1);
    expect(s.tone).toBe(DEFAULT_SETTINGS.tone);
    expect(s.background).toBe(DEFAULT_SETTINGS.background);
    expect(s.loop).toBe(DEFAULT_SETTINGS.loop);
    expect(normalizeSettings({ interval: 600 }).interval).toBe(60);
  });

  it('round-trips through storage and survives corrupt data', () => {
    saveSettings({ ...DEFAULT_SETTINGS, interval: 42, tone: 'night' });
    expect(loadSettings()).toMatchObject({ interval: 42, tone: 'night' });
    localStorage.setItem('bookworm.settings.v1', '{not json');
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});
