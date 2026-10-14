import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig } from '../config/env.js';
import { loadGmailConfig } from '../config/gmail.js';
import { checkRuntimeState, DeploymentStateError } from './deploymentState.js';
import { checkRuntimeConfig, EnvValidationError } from './configCheck.js';

try {
  checkRuntimeConfig(process.env);
  const { telegramOwnerId } = loadConfig();
  const { expectedAccountEmail } = loadGmailConfig();
  const binding = createHash('sha256').update(expectedAccountEmail.trim().toLowerCase() + ':' + telegramOwnerId).digest('hex');
  checkRuntimeState(join(process.cwd(), '.local-state'), binding);
  // Import only after state/config gates. No dotenv loading or network in the preflight.
  await import('../index.js');
} catch (error: unknown) {
  console.error(error instanceof DeploymentStateError || error instanceof EnvValidationError ? error.message : 'deployment_configuration_error');
  process.exitCode = 1;
}
