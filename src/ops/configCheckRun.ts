import { lstatSync, readFileSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { checkRuntimeConfig, EnvValidationError, parseComposeEnvFile, parseRuntimeEnvFile } from './configCheck.js';

try {
  const args = process.argv.slice(2);
  if (args.length === 0) checkRuntimeConfig(process.env);
  else {
    if (args.length !== 3 || args[0] !== '--file' || (!args[1]?.startsWith('/') && process.platform !== 'win32') ||
        !['runtime', 'compose'].includes(args[2]!)) throw new EnvValidationError('env_usage_invalid');
    let bytes: Buffer;
    try {
      const info = lstatSync(args[1]!);
      if (!info.isFile() || info.size > 65536) throw new EnvValidationError('env_file_invalid');
      if (process.platform === 'linux' && (info.uid !== 0 || (info.mode & 0o777) !== 0o600))
        throw new EnvValidationError('env_file_permissions');
      bytes = readFileSync(args[1]!);
    } catch (error: unknown) {
      throw error instanceof EnvValidationError ? error : new EnvValidationError('env_file_unreadable');
    }
    let content: string;
    try { content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new EnvValidationError('env_syntax_invalid'); }
    if (args[2] === 'runtime') parseRuntimeEnvFile(content); else parseComposeEnvFile(content);
  }
  console.info('env_configuration_ok');
} catch (error: unknown) {
  console.error(error instanceof EnvValidationError ? error.message : 'env_configuration_invalid');
  process.exitCode = 1;
}
