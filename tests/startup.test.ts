import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const projectDirectory = fileURLToPath(new URL('../', import.meta.url));

describe('application startup without credentials', () => {
  it.each(['', 'your_telegram_bot_token_here'])('exits with a helpful configuration error: %j', (token) => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: projectDirectory,
      env: {
        ...process.env,
        TELEGRAM_BOT_TOKEN: token,
        TELEGRAM_OWNER_ID: '123456789',
      },
      encoding: 'utf8',
      timeout: 5000,
    });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('TELEGRAM_BOT_TOKEN');
    expect(result.stderr).toContain('BotFather');
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('your_telegram_bot_token_here');
  });
});
