import { ConfigError } from '../config/env.js';
import { loadGmailConfig } from '../config/gmail.js';
import { createGmailClient, GmailError } from './client.js';
import { findKworkEmails } from './kworkEmails.js';

export async function runGmailCheck(): Promise<number> {
  let stage = 'configuration';
  try {
    const config = loadGmailConfig();
    stage = 'access_token';
    const client = await createGmailClient(config);
    stage = 'messages_list';
    const emails = await findKworkEmails(client);
    console.info('Gmail connection: OK');
    console.info('Account: verified');
    console.info(`Matching Kwork emails: ${emails.length}`);
    return 0;
  } catch (error: unknown) {
    if (error instanceof GmailError) {
      // No error message/object or API response is logged: only the diagnostic
      // fields constructed by the application from explicit allowlists.
      console.error(`Gmail check failed: stage=${error.stage}; category=${error.category}` +
        (error.httpStatus !== undefined ? `; http_status=${error.httpStatus}` : ''));
    } else if (error instanceof ConfigError) {
      // ConfigError messages are application-authored and contain variable names,
      // never their values. Keep that actionable hint for local setup.
      console.error(`Gmail check failed: stage=configuration; category=configuration_error. ${error.message}`);
    } else {
      console.error(`Gmail check failed: stage=${stage}; category=unknown_error`);
    }
    return 1;
  }
}
