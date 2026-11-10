/**
 * The mode the application runs in, from the one variable `GG_ENV`:
 * - dev: development tools are open (the `!init` chat command, ...);
 * - rec: acceptance test (a server close to production, to try things out);
 * - prod: a real event. This is also the answer for a missing or unknown value: what is reserved to development
 *   stays closed unless the mode asks for it, so a forgotten setting never opens a tool.
 * `NODE_ENV` stays for Node and its libraries: it has two useful values, it cannot carry a third mode.
 */
export type AppMode = 'dev' | 'rec' | 'prod';

export function appMode(env: NodeJS.ProcessEnv = process.env): AppMode {
  const value = env.GG_ENV?.trim().toLowerCase();
  return value === 'dev' || value === 'rec' ? value : 'prod';
}

export function isDevMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return appMode(env) === 'dev';
}
