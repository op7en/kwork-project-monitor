import { afterEach, expect, it, vi } from 'vitest';
import { createMonitorController } from '../src/monitor/controller.js';
import { StorageError } from '../src/monitor/store.js';
import type { PassResult } from '../src/monitor/pass.js';
const completed: PassResult = { status: 'completed', messages: 1, found: 1, match: 1, review: 0, exclude: 0,
  sent: 1, unknown: 0, parseFailed: 0 };
afterEach(() => vi.useRealTimers());
function setup() {
  vi.useFakeTimers();
  const run = vi.fn<(allowed: () => boolean, reset?: boolean) => Promise<PassResult>>(async () => completed);
  const close = vi.fn();
  const create = vi.fn(() => ({ pass: { run }, store: { close, counts: () => ({ messages: 0, sent: 0, reserved: 0, filtered: 0, delivery_unknown: 0, review: 0, exclude: 0 }) } }));
  const notifier = { hasConfirmedDestination: () => true };
  const report = vi.fn();
  const monitor = createMonitorController(notifier, create, 1000, report);
  return { monitor, run, create, close, notifier, report };
}
it('begins off and allocates no resources or timer before opt-in', async () => {
  const s = setup();
  expect(s.monitor.status().enabled).toBe(false);
  expect((await s.monitor.run()).status).toBe('disabled');
  await vi.advanceTimersByTimeAsync(6000);
  expect(s.create).not.toHaveBeenCalled();
});
it('requires a private destination even with opt-in and arms only one settled timer', async () => {
  const s = setup(); s.notifier.hasConfirmedDestination = () => false;
  expect((await s.monitor.on()).status).toBe('destination_unconfirmed'); expect(s.create).not.toHaveBeenCalled();
  s.notifier.hasConfirmedDestination = () => true;
  await s.monitor.on(); await s.monitor.on();
  await vi.advanceTimersByTimeAsync(1000); expect(s.run).toHaveBeenCalledTimes(2);
  await s.monitor.off(); await vi.advanceTimersByTimeAsync(6000); expect(s.run).toHaveBeenCalledTimes(2);
});
it('does not overlap scheduled/manual operations and off cancels pending follow-up work', async () => {
  const s = setup(); let finish!: (r: PassResult) => void;
  s.run.mockImplementation(async allowed => {
    await new Promise<PassResult>(r => { finish = r; });
    return allowed() ? completed : { ...completed, status: 'stopped' };
  });
  const active = s.monitor.on(); await Promise.resolve(); await Promise.resolve();
  expect((await s.monitor.run()).status).toBe('busy');
  await vi.advanceTimersByTimeAsync(6000); expect(s.run).toHaveBeenCalledTimes(1);
  const stopping = s.monitor.off(); finish(completed); await active; await stopping;
  expect(s.monitor.status().enabled).toBe(false);
  await vi.advanceTimersByTimeAsync(6000); expect(s.run).toHaveBeenCalledTimes(1);
});
it('drains in-flight operations before storage close and cannot restart after shutdown', async () => {
  const s = setup(); let finish!: (r: PassResult) => void;
  s.run.mockImplementation(() => new Promise(r => { finish = r; }));
  const active = s.monitor.on(); await Promise.resolve(); await Promise.resolve();
  const shutdown = s.monitor.shutdown(); expect(s.close).not.toHaveBeenCalled();
  finish(completed); await active; await shutdown;
  expect(s.close).toHaveBeenCalledTimes(1);
  expect((await s.monitor.on()).status).toBe('closed');
  expect(s.monitor.status().lastStatus).toBe('completed');
});
it.each(['history_expired', 'discovery_overflow', 'discovery_error', 'storage_error', 'delivery_limit'] as const)(
  'pauses after %s instead of creating repeated automatic work', async status => {
    const s = setup(); s.run.mockResolvedValue({ ...completed, status }); await s.monitor.on();
    await vi.advanceTimersByTimeAsync(10000); expect(s.run).toHaveBeenCalledTimes(1);
    expect(s.monitor.status().enabled).toBe(false);
  });
it('temporary Gmail failure waits a full interval, without immediate retry', async () => {
  const s = setup(); s.run.mockResolvedValue({ ...completed, status: 'gmail_error' });
  await s.monitor.on(); await vi.advanceTimersByTimeAsync(999); expect(s.run).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(s.run).toHaveBeenCalledTimes(2); await s.monitor.off();
});
it('fails closed on storage creation and permits explicit baseline only while off', async () => {
  const s = setup(); s.create.mockImplementation(() => { throw new StorageError(); });
  expect((await s.monitor.on()).status).toBe('storage_error'); expect(s.monitor.status().enabled).toBe(false);
  expect(s.report.mock.calls.flat().map(String).join('')).not.toContain('synthetic-private');
});
it('exposes completion, next attempt and blocking error without pretending an expired cursor is healthy', async () => {
  const s = setup(); vi.setSystemTime(1000); await s.monitor.on();
  expect(s.monitor.status()).toMatchObject({ lastCompletedAt: 1000, nextAttemptAt: 2000, lastErrorCategory: null, blocked: false });
  s.run.mockResolvedValue({ ...completed, status: 'history_expired' }); await vi.advanceTimersByTimeAsync(1000);
  expect(s.monitor.status()).toMatchObject({ enabled: false, lastCompletedAt: 2000, nextAttemptAt: null,
    lastErrorCategory: 'history_expired', blocked: true });
});
it('serializes baseline against activation and forwards only explicit replacement confirmation', async () => {
  const s = setup(); let finish!: (r: PassResult) => void;
  s.run.mockImplementation(() => new Promise(r => { finish = r; }));
  const baseline = s.monitor.baseline(); await Promise.resolve(); await Promise.resolve();
  expect((await s.monitor.on()).status).toBe('busy'); expect((await s.monitor.baseline(true)).status).toBe('busy');
  finish(completed); await baseline; expect(s.run.mock.calls[0]?.slice(1)).toEqual([true, false]);
  const confirmed = s.monitor.baseline(true); await Promise.resolve(); await Promise.resolve(); finish(completed); await confirmed;
  expect(s.run.mock.calls[1]?.slice(1)).toEqual([true, true]);
});
