import { runGmailCheck } from './smokeCheck.js';

process.exitCode = await runGmailCheck();
