import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadConfig } from '../config/env.js';
import { loadGmailConfig } from '../config/gmail.js';
import { checkDeploymentState, DeploymentStateError } from './deploymentState.js';

try {
  const { telegramOwnerId } = loadConfig();
  const { expectedAccountEmail } = loadGmailConfig();
  const binding = createHash('sha256').update(expectedAccountEmail.trim().toLowerCase() + ':' + telegramOwnerId).digest('hex');
  checkDeploymentState(join(process.cwd(), '.local-state'), binding);
  // Import only after state/config gates. No dotenv loading or network in the preflight.
  await import('../index.js');
} catch (error: unknown) {
  console.error(error instanceof DeploymentStateError ? error.message : 'deployment_configuration_error');
  process.exitCode = 1;
}
