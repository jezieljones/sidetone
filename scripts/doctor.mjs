import { checkConfig, loadEnv } from './config.mjs';
const result = checkConfig(loadEnv(), { production: process.argv.includes('--production') });
for (const error of result.errors) console.error(`ERROR: ${error}`);
for (const warning of result.warnings) console.warn(`NOTE: ${warning}`);
console.log(result.errors.length ? `${result.errors.length} configuration issue(s). No secret values were printed.` : 'Configuration is complete. Next: verify authentication, background jobs, and a test recording.');
process.exitCode = result.errors.length ? 1 : 0;
