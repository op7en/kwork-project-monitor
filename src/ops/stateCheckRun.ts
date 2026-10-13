import { join } from 'node:path';
import { checkDeploymentState, checkRestoreGuard, DeploymentStateError } from './deploymentState.js';

try {
  if (process.argv.length > 4) throw new DeploymentStateError('deployment_usage_error');
  const directory = process.argv[2] ?? join(process.cwd(), '.local-state');
  checkDeploymentState(directory);
  if (process.argv[3] !== undefined) checkRestoreGuard(directory, process.argv[3]);
  console.info('deployment_state_ok');
} catch (error: unknown) {
  console.error(error instanceof DeploymentStateError ? error.message : 'deployment_state_invalid');
  process.exitCode = 1;
}
