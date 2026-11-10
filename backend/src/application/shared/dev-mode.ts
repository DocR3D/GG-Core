/**
 * Development mode: the environment says `NODE_ENV=development` (the backend images and the CI set it). Anything else,
 * including no value at all, is NOT development: what is reserved to development stays closed unless it is asked for.
 */
export function isDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === 'development';
}
