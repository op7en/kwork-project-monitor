import { expect, it } from 'vitest';
import { loadMonitorConfig } from '../src/config/monitor.js';
it('uses six hours by default and accepts a bounded configured interval', () => {
  expect(loadMonitorConfig({}).intervalMs).toBe(21_600_000);
  expect(loadMonitorConfig({ MONITOR_INTERVAL_MINUTES: '60' }).intervalMs).toBe(3_600_000);
});
it.each(['0', '4', '1441', 'abc', '1.5'])('rejects interval %s without reflecting input', value => {
  expect(() => loadMonitorConfig({ MONITOR_INTERVAL_MINUTES: value })).toThrow('monitor_configuration_error');
});
it('can restrict production per-pass limits without claiming a whole-run acceptance budget', () => {
  expect(loadMonitorConfig({ MONITOR_MAX_MESSAGES: '1', MONITOR_MAX_SENDS: '1' }).limits)
    .toMatchObject({ maxMessages: 1, maxSends: 1 });
  expect(() => loadMonitorConfig({ MONITOR_MAX_SENDS: '11' })).toThrow('monitor_configuration_error');
});
