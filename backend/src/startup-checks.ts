import { appMode, isDevMode } from '@app/shared/app-mode';

/**
 * What must not be asked of the backend in the mode it runs in. A server that starts with a dangerous setting is worse
 * than one that does not start: it is refused here, with the reason, before anything listens.
 */
export function startupProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const problems: string[] = [];
  if (env.AUTH_DISABLED === '1' && !isDevMode(env)) {
    problems.push(
      `AUTH_DISABLED=1 switches the authentication off and is only allowed with GG_ENV=dev (GG_ENV is "${appMode(env)}"): remove it`,
    );
  }
  return problems;
}

export function assertStartupAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const problems = startupProblems(env);
  if (problems.length) throw new Error(problems.join('; '));
}
