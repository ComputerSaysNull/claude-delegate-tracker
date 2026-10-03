import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, SettingsError } from '../../src/server/settings.ts';

describe('loadSettings', () => {
  it('empty env gives defaults', () => {
    const s = loadSettings({});
    expect(s.port).toBe(DEFAULTS.port);
    expect(s.transcriptDir).toBeNull();
    expect(s.allowedHosts).toEqual([]);
  });

  it('valid TRACKER_PORT is used', () => {
    expect(loadSettings({ TRACKER_PORT: '9000' }).port).toBe(9000);
  });

  it.each(['0', '65536', 'abc', '80.5', '-1', ' 8080x'])(
    'invalid TRACKER_PORT %s throws',
    (v) => {
      expect(() => loadSettings({ TRACKER_PORT: v })).toThrow(SettingsError);
      expect(() => loadSettings({ TRACKER_PORT: v })).toThrow(/TRACKER_PORT/);
    },
  );

  it('spaces around port are trimmed', () => {
    expect(loadSettings({ TRACKER_PORT: ' 9000 ' }).port).toBe(9000);
  });

  it('ALLOWED_HOSTS splits, trims, lowercases, drops empty', () => {
    const s = loadSettings({ ALLOWED_HOSTS: ' Foo.example , ,bar ' });
    expect(s.allowedHosts).toEqual(['foo.example', 'bar']);
  });

  it('TRANSCRIPT_DIR blank is null, otherwise trimmed kept', () => {
    expect(loadSettings({ TRANSCRIPT_DIR: '  ' }).transcriptDir).toBeNull();
    expect(loadSettings({ TRANSCRIPT_DIR: 'C:\\x' }).transcriptDir).toBe('C:\\x');
  });
});
