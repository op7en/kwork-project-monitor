import { loadConfig } from '../config/env.js';
import { MESSAGE_ID_PATTERN } from '../config/smoke.js';
import { createBotLifecycle } from '../bot/lifecycle.js';
import { createGmailMonitoringClient } from '../gmail/client.js';
import { createAcceptancePass } from './acceptance.js';
import { createAcceptanceBot } from './acceptanceBot.js';
import { openMonitorStore } from './runtime.js';

// Manual LIVE entry point; never imported by production. Separate authorization is required.
try {
  const { telegramBotToken, telegramOwnerId } = loadConfig();
  const selected = process.env['MONITOR_ACCEPTANCE_MESSAGE_ID'];
  if (!selected || !MESSAGE_ID_PATTERN.test(selected) || selected === 'your_selected_message_id_here')
    throw Error('acceptance_configuration_error');
  let timer: NodeJS.Timeout | undefined;
  const acceptance = createAcceptanceBot(telegramBotToken, telegramOwnerId, notifier => {
    const { store, config } = openMonitorStore(telegramOwnerId);
    return { store, pass: createAcceptancePass({ store, notifier,
      connect: (floor, allowed) => createGmailMonitoringClient(config, floor, allowed) }, selected) };
  }, result => {
    console.info('Acceptance: ' + JSON.stringify(result));
    process.exitCode = 'sent' in result && result.sent === 1 ? 0 : 1;
    clearTimeout(timer); void lifecycle.stop();
  });
  const lifecycle = createBotLifecycle(acceptance.bot, acceptance, () => {
    console.error('acceptance_shutdown_error'); process.exitCode = 1;
  });
  const stop = () => { clearTimeout(timer); process.exitCode = 1; void lifecycle.stop(); };
  acceptance.bot.catch(() => { console.error('acceptance_update_error'); stop(); });
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await acceptance.bot.start({ drop_pending_updates: true, onStart: () => {
      if (!lifecycle.ready()) return;
      timer = setTimeout(stop, 10 * 60_000);
      console.info('Acceptance ready: send one /acceptance in the private owner chat.');
    } });
  } finally {
    clearTimeout(timer); await lifecycle.stop();
    process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
  }
} catch {
  console.error('acceptance_startup_error'); process.exitCode = 1;
}
