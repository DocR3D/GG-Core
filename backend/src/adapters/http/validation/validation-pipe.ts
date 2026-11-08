import { ArgumentMetadata, BadRequestException, Logger, ValidationPipe } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';

/**
 * How the inputs of the routes that have a described class (DTO with class-validator rules) are checked:
 * - tolerant (default): a request that breaks the rules goes through exactly as before, and the problem is written in
 *   the log. Used to see what the front and the scripts really send before refusing anything;
 * - strict: the request is refused with a 400 listing the broken rules;
 * - off: no check.
 * Routes whose body is a plain TypeScript type (erased at run time) have nothing to check, whatever the mode.
 */
export type ValidationMode = 'tolerant' | 'strict' | 'off';

export function validationMode(env: NodeJS.ProcessEnv = process.env): ValidationMode {
  const value = env.GG_VALIDATION?.trim().toLowerCase();
  return value === 'strict' || value === 'off' ? value : 'tolerant';
}

/**
 * Validates like Nest's ValidationPipe (nothing is converted, nothing is stripped: the value that reaches the handler
 * is the one that was sent) but never refuses: what it would have refused is logged, with the class and the rules
 * broken (never the values sent).
 */
export class TolerantValidationPipe extends ValidationPipe {
  private readonly log = new Logger('Validation');

  override async transform(value: unknown, metadata: ArgumentMetadata): Promise<unknown> {
    try {
      return await super.transform(value, metadata);
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      const { message } = error.getResponse() as { message?: string | string[] };
      const rules = Array.isArray(message) ? message.join('; ') : String(message ?? 'invalid');
      this.log.warn(`[tolerant] ${metadata.metatype?.name ?? 'body'} (${metadata.type}) would be refused: ${rules}`);
      return value;
    }
  }
}

/** The global pipe for the mode of GG_VALIDATION; `null` when the check is off. */
export function createValidationPipe(env: NodeJS.ProcessEnv = process.env): PipeTransform | null {
  switch (validationMode(env)) {
    case 'off':
      return null;
    case 'strict':
      return new ValidationPipe();
    default:
      return new TolerantValidationPipe();
  }
}
