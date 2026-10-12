import { ConfigError } from './env.js';
import { MONITOR_LIMITS, type MonitorLimits } from '../monitor/discovery.js';
export function loadMonitorConfig(env: NodeJS.ProcessEnv = process.env): { intervalMs: number; limits: MonitorLimits } {
  const raw = env['MONITOR_INTERVAL_MINUTES'] ?? '360';
  if (!/^\d{1,4}$/.test(raw)) throw new ConfigError('monitor_configuration_error');
  const minutes = Number(raw);
  if (minutes < 5 || minutes > 1440) throw new ConfigError('monitor_configuration_error');
  const bounded = (key: string, fallback: number, maximum: number) => {
    const value = env[key] ?? String(fallback);
    if (!/^[1-9]\d{0,2}$/.test(value) || Number(value) > maximum) throw new ConfigError('monitor_configuration_error');
    return Number(value);
  };
  return { intervalMs: minutes * 60_000, limits: { ...MONITOR_LIMITS,
    maxMessages: bounded('MONITOR_MAX_MESSAGES', MONITOR_LIMITS.maxMessages, 100),
    maxSends: bounded('MONITOR_MAX_SENDS', MONITOR_LIMITS.maxSends, 10) } };
}
