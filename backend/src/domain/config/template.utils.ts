// src/domain/config/template.utils.ts

/**
 * Replaces placeholders in `{variable}` format with provided params.
 * If a variable is missing, it is left as is or replaced by empty string depending on context.
 */
export function interpolateTemplate(
  template: string,
  params: Record<string, unknown> = {},
): string {
  if (!template) return '';
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const val = params[key];
      if (val === null || val === undefined) return '';
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || typeof val === 'bigint') {
        return String(val);
      }
      return '';
    }
    return match;
  });
}
