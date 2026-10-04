import { describe, expect, it } from 'vitest';
import { DEFAULTS, loadSettings, SettingsError } from '../../src/server/settings.ts';

describe('loadSettings', () => {
  it('empty env gives defaults', () => {
    const s = loadSettings({});
    expect(s.port).toBe(DEFAULTS.port);
    expect(s.transcriptDir).toBeNull();
    expect(s.allowedHosts).toEqual([]);
    expect(s.quietAfterSeconds).toBe(DEFAULTS.quietAfterSeconds);
    expect(s.streamsPollSeconds).toBe(DEFAULTS.streamsPollSeconds);
  });

  it('QUIET_AFTER_SECONDS and STREAMS_POLL_SECONDS are used when valid', () => {
    const s = loadSettings({ QUIET_AFTER_SECONDS: '300', STREAMS_POLL_SECONDS: '5' });
    expect(s.quietAfterSeconds).toBe(300);
    expect(s.streamsPollSeconds).toBe(5);
  });

  it('METRICS_URL and METRICS_TOKEN_ENV are null unless set, and trimmed', () => {
    const unset = loadSettings({ METRICS_URL: '  ', METRICS_TOKEN_ENV: '' });
    expect(unset.metricsUrl).toBeNull();
    expect(unset.metricsTokenEnv).toBeNull();
    const set = loadSettings({ METRICS_URL: ' http://metrics.example ', METRICS_TOKEN_ENV: ' TOKEN_VAR ' });
    expect(set.metricsUrl).toBe('http://metrics.example');
    expect(set.metricsTokenEnv).toBe('TOKEN_VAR');
  });

  it('METRICS_POLL_SECONDS and FOLLOW_POLL_SECONDS default, and are used when valid', () => {
    expect(loadSettings({}).metricsPollSeconds).toBe(DEFAULTS.metricsPollSeconds);
    expect(loadSettings({}).followPollSeconds).toBe(DEFAULTS.followPollSeconds);
    const s = loadSettings({ METRICS_POLL_SECONDS: '30', FOLLOW_POLL_SECONDS: '3' });
    expect(s.metricsPollSeconds).toBe(30);
    expect(s.followPollSeconds).toBe(3);
  });

  it.each(['QUIET_AFTER_SECONDS', 'STREAMS_POLL_SECONDS', 'FOLLOW_POLL_SECONDS', 'METRICS_POLL_SECONDS'])('%s rejects 0 and non-numbers', (name) => {
    for (const v of ['0', 'abc', '1.5']) {
      expect(() => loadSettings({ [name]: v })).toThrow(new RegExp(name));
    }
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
