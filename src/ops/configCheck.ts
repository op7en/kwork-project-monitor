import { loadConfig } from '../config/env.js';
import { loadGmailConfig } from '../config/gmail.js';
import { loadMonitorConfig } from '../config/monitor.js';

const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_OWNER_ID', 'GMAIL_CLIENT_ID',
  'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN', 'GMAIL_EXPECTED_ACCOUNT_EMAIL'] as const;
const optional = ['MONITOR_INTERVAL_MINUTES', 'MONITOR_MAX_MESSAGES', 'MONITOR_MAX_SENDS'] as const;
const composeRequired = ['KWORK_RELEASE', 'KWORK_SECRETS_FILE', 'KWORK_STATE_DIR'] as const;
const composeOptional = ['KWORK_NODE_IMAGE'] as const;
export class EnvValidationError extends Error {}
function fail(code: string): never { throw new EnvValidationError(code); }

/** No dotenv, SDK, startup, state or API access. Values never appear in errors. */
export function checkRuntimeConfig(env: NodeJS.ProcessEnv): void {
  for (const key of required) {
    const value = env[key];
    if (value === undefined || !value.trim()) fail(`env_missing:${key}`);
    if (value !== value.trim()) fail('env_surrounding_whitespace');
    // eslint-disable-next-line no-control-regex -- ENV must remain one bounded raw line.
    if (value.length > 32768 || /[\u0000-\u001f\u007f]/u.test(value)) fail('env_syntax_invalid');
  }
  try { loadConfig(env); loadGmailConfig(env); loadMonitorConfig(env); }
  catch { fail('env_application_invalid'); }
}

/** Strict documented subset of Compose raw. No inherited bare names or duplicate overrides. */
function parse(content: string, allowed: readonly string[]): NodeJS.ProcessEnv {
  // eslint-disable-next-line no-control-regex -- Reject control bytes without echoing raw input.
  if (Buffer.byteLength(content) > 65536 || content.startsWith('\ufeff') || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/u.test(content))
    fail('env_syntax_invalid');
  const env: NodeJS.ProcessEnv = {};
  for (let line of content.split('\n')) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.includes('\r') || Buffer.byteLength(line) > 32768) fail('env_syntax_invalid');
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const delimiter = line.indexOf('=');
    if (delimiter < 1) fail('env_syntax_invalid');
    const key = line.slice(0, delimiter), value = line.slice(delimiter + 1);
    if (!/^[A-Z][A-Z0-9_]*$/.test(key)) fail('env_syntax_invalid');
    if (!allowed.includes(key)) fail('env_unknown_key');
    if (Object.hasOwn(env, key)) fail('env_duplicate_key');
    env[key] = value;
  }
  return env;
}
export function parseRuntimeEnvFile(content: string): NodeJS.ProcessEnv {
  const env = parse(content, [...required, ...optional]); checkRuntimeConfig(env); return env;
}
export function parseComposeEnvFile(content: string): NodeJS.ProcessEnv {
  const env = parse(content, [...composeRequired, ...composeOptional]);
  for (const key of composeRequired) if (!env[key]) fail(`env_missing:${key}`);
  if (!/^[a-f0-9]{40}$/.test(env['KWORK_RELEASE']!)) fail('env_compose_invalid');
  for (const key of ['KWORK_SECRETS_FILE', 'KWORK_STATE_DIR']) {
    const path = env[key]!;
    if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.split('/').some(part => part === '..' || part === '.') ||
        path.includes('//') || path.endsWith('/')) fail('env_compose_invalid');
  }
  if (env['KWORK_NODE_IMAGE'] !== undefined && !/^node:24-bookworm-slim@sha256:[a-f0-9]{64}$/.test(env['KWORK_NODE_IMAGE']))
    fail('env_compose_invalid');
  return env;
}
