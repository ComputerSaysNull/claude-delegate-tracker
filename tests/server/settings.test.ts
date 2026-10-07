import { join } from 'node:path';
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

  it('NODES is a comma-separated list of name=user@host[:port]', () => {
    expect(loadSettings({}).nodes).toEqual([]);
    expect(loadSettings({ NODES: ' ' }).nodes).toEqual([]);
    expect(loadSettings({ NODES: 'one=u@nodea, two=v@some-host:2222' }).nodes).toEqual([
      { name: 'one', user: 'u', host: 'nodea', port: 22 },
      { name: 'two', user: 'v', host: 'some-host', port: 2222 },
    ]);
  });

  it.each(['one', 'one=nodea', '=u@nodea', 'one=@node-a.example', 'one=u@', 'one=u@h:0', 'one=u@h:x', 'a=u@h,a=v@h2'])(
    'NODES rejects %s',
    (v) => {
      expect(() => loadSettings({ NODES: v })).toThrow(/NODES/);
    },
  );

  it('NODE_KEY and NODE_KNOWN_HOSTS are null unless set', () => {
    expect(loadSettings({ NODE_KEY: ' ', NODE_KNOWN_HOSTS: '' }).nodeKey).toBeNull();
    expect(loadSettings({}).nodeKnownHosts).toBeNull();
    const s = loadSettings({ NODE_KEY: 'C:\\k\\key', NODE_KNOWN_HOSTS: 'C:\\k\\hosts' });
    expect(s.nodeKey).toBe('C:\\k\\key');
    expect(s.nodeKnownHosts).toBe('C:\\k\\hosts');
  });

  it('HISTORY_WINDOW_SECONDS defaults and is used when valid', () => {
    expect(loadSettings({}).historyWindowSeconds).toBe(DEFAULTS.historyWindowSeconds);
    expect(loadSettings({ HISTORY_WINDOW_SECONDS: '600' }).historyWindowSeconds).toBe(600);
    expect(() => loadSettings({ HISTORY_WINDOW_SECONDS: '0' })).toThrow(/HISTORY_WINDOW_SECONDS/);
  });

  it('the load and heat thresholds default and are used when valid', () => {
    expect(loadSettings({}).limits).toEqual({
      loadWarn: DEFAULTS.loadWarnPercent, loadHot: DEFAULTS.loadHotPercent,
      tempWarn: DEFAULTS.tempWarnC, tempHot: DEFAULTS.tempHotC,
    });
    const s = loadSettings({ LOAD_WARN_PERCENT: '40', LOAD_HOT_PERCENT: '90', TEMP_WARN_C: '60', TEMP_HOT_C: '95' });
    expect(s.limits).toEqual({ loadWarn: 40, loadHot: 90, tempWarn: 60, tempHot: 95 });
  });

  it('a warning threshold must sit below its hot one', () => {
    expect(() => loadSettings({ LOAD_WARN_PERCENT: '80', LOAD_HOT_PERCENT: '80' })).toThrow(/LOAD_WARN_PERCENT/);
    expect(() => loadSettings({ TEMP_WARN_C: '90', TEMP_HOT_C: '85' })).toThrow(/TEMP_WARN_C/);
    expect(() => loadSettings({ LOAD_HOT_PERCENT: '101' })).toThrow(/LOAD_HOT_PERCENT/);
  });

  it('NODES_POLL_SECONDS defaults and is used when valid', () => {
    expect(loadSettings({}).nodesPollSeconds).toBe(DEFAULTS.nodesPollSeconds);
    expect(loadSettings({ NODES_POLL_SECONDS: '15' }).nodesPollSeconds).toBe(15);
    expect(() => loadSettings({ NODES_POLL_SECONDS: '0' })).toThrow(/NODES_POLL_SECONDS/);
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

  it('DATA_DIR defaults from LOCALAPPDATA, then XDG_DATA_HOME, then HOME, and is null with none', () => {
    expect(loadSettings({ LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' }).dataDir).toBe(join('C:\\Users\\me\\AppData\\Local', 'claude-delegate-tracker'));
    expect(loadSettings({ XDG_DATA_HOME: '/home/me/.local/share' }).dataDir).toBe(join('/home/me/.local/share', 'claude-delegate-tracker'));
    expect(loadSettings({ HOME: '/home/me' }).dataDir).toBe(join('/home/me', '.local', 'share', 'claude-delegate-tracker'));
    expect(loadSettings({}).dataDir).toBeNull();
  });

  it('DATA_DIR overrides the default, and a blank one falls back to it', () => {
    expect(loadSettings({ DATA_DIR: 'C:\\runs', LOCALAPPDATA: 'C:\\appdata' }).dataDir).toBe('C:\\runs');
    expect(loadSettings({ DATA_DIR: '  ', LOCALAPPDATA: 'C:\\appdata' }).dataDir).toBe(join('C:\\appdata', 'claude-delegate-tracker'));
    expect(loadSettings({ DATA_DIR: '  ' }).dataDir).toBeNull();
  });

  it('RUNS_SCAN_SECONDS defaults and is used when valid', () => {
    expect(loadSettings({}).runsScanSeconds).toBe(DEFAULTS.runsScanSeconds);
    expect(loadSettings({ RUNS_SCAN_SECONDS: '30' }).runsScanSeconds).toBe(30);
  });

  it.each(['4', '3601', '0', 'abc', '1.5'])('RUNS_SCAN_SECONDS rejects %s', (v) => {
    expect(() => loadSettings({ RUNS_SCAN_SECONDS: v })).toThrow(/RUNS_SCAN_SECONDS/);
  });
});
