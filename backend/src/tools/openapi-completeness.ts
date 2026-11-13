/**
 * What is still missing from the OpenAPI document, route by route. The goal is a contract a reader can use without opening
 * the code: a sentence and the rules for each route, a description and an example for each parameter and each field,
 * the answers it can give, and the padlock on what only an admin may call.
 *
 * It is a ratchet (see check-openapi-completeness.cli.ts): the routes not described yet are listed in openapi-gaps.json,
 * a route that is not in the list must have no gap, and a route of the list that has none must leave it. The list can
 * only get shorter.
 */
import type { OpenAPIObject } from '@nestjs/swagger';
import type { OperationObject, ParameterObject, ReferenceObject, SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
const SUCCESS = /^2\d\d$/;

/**
 * Writes that no admin padlock belongs on, because anybody may call them (the login, the veto of a captain). Each one
 * is named here on purpose: a write that is not in this list and has no padlock is a gap.
 */
export const PUBLIC_WRITES: readonly string[] = [];

type Schemas = Record<string, SchemaObject | ReferenceObject>;

function isRef(node: unknown): node is ReferenceObject {
  return typeof node === 'object' && node !== null && '$ref' in node;
}

function refName(ref: ReferenceObject): string {
  return ref.$ref.split('/').pop() ?? ref.$ref;
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim() !== '';
}

function hasExample(node: { example?: unknown; examples?: unknown; enum?: unknown[]; default?: unknown }): boolean {
  return node.example !== undefined || node.examples !== undefined;
}

/** The schemas an operation takes or gives, named, so that each one is looked at once. */
function schemasOf(operation: OperationObject, found: Set<string>, into: string[]): void {
  const bodies = [operation.requestBody, ...Object.values(operation.responses ?? {})];
  for (const body of bodies) {
    if (!body || isRef(body)) continue;
    const content = (body as { content?: Record<string, { schema?: SchemaObject | ReferenceObject }> }).content ?? {};
    for (const media of Object.values(content)) collect(media.schema, found, into);
  }
}

function collect(schema: SchemaObject | ReferenceObject | undefined, found: Set<string>, into: string[]): void {
  if (!schema) return;
  if (isRef(schema)) {
    const name = refName(schema);
    if (found.has(name)) return;
    found.add(name);
    into.push(name);
    return;
  }
  if (schema.items) collect(schema.items, found, into);
}

/** The gaps of one schema (a class of the code): its description, then each field: description, example, and what it refers to. */
function gapsOfSchema(name: string, schemas: Schemas, seen: Set<string>): string[] {
  if (seen.has(name)) return [];
  seen.add(name);
  const schema = schemas[name];
  if (!schema || isRef(schema)) return [];
  const gaps: string[] = [];
  if (!hasText(schema.description)) gaps.push(`schema ${name}: no description of the class`);
  for (const [field, property] of Object.entries(schema.properties ?? {})) {
    if (isRef(property)) {
      gaps.push(...gapsOfSchema(refName(property), schemas, seen));
      continue;
    }
    if (!hasText(property.description)) gaps.push(`schema ${name}.${field}: no description`);
    const nested = property.items && isRef(property.items) ? refName(property.items) : undefined;
    if (nested) {
      gaps.push(...gapsOfSchema(nested, schemas, seen));
      continue;
    }
    const needsExample = property.type !== 'object' && property.type !== 'array';
    if (needsExample && !hasExample(property)) gaps.push(`schema ${name}.${field}: no example`);
  }
  return gaps;
}

function gapsOfParameter(parameter: ParameterObject): string[] {
  const gaps: string[] = [];
  if (!hasText(parameter.description)) gaps.push(`parameter ${parameter.name}: no description`);
  const schema = (parameter.schema ?? {}) as SchemaObject;
  if (!hasExample(parameter) && !hasExample(schema) && !schema.enum) gaps.push(`parameter ${parameter.name}: no example`);
  return gaps;
}

/** Everything missing from the operation, in a readable sentence each. Empty when the route is complete. */
export function gapsOfOperation(method: string, path: string, operation: OperationObject, schemas: Schemas): string[] {
  const gaps: string[] = [];
  if (!hasText(operation.summary)) gaps.push('no summary');
  if (!hasText(operation.description)) gaps.push('no description (the rules of the route)');

  for (const parameter of operation.parameters ?? []) {
    if (!isRef(parameter)) gaps.push(...gapsOfParameter(parameter));
  }

  const answers = Object.entries(operation.responses ?? {});
  if (!answers.some(([code]) => SUCCESS.test(code))) gaps.push('no success answer declared');
  for (const [code, answer] of answers) {
    if (!isRef(answer) && !hasText((answer as { description?: string }).description)) gaps.push(`answer ${code}: no description`);
  }

  const isWrite = method !== 'get';
  const secured = (operation.security ?? []).length > 0;
  if (isWrite && !secured && !PUBLIC_WRITES.includes(`${method.toUpperCase()} ${path}`)) gaps.push('no padlock (admin only?)');
  if (secured) {
    for (const code of ['401', '403']) if (!operation.responses?.[code]) gaps.push(`no ${code} answer (the padlock needs it)`);
  }
  if (isWrite && operation.requestBody && !operation.responses?.['400']) gaps.push('no 400 answer (a body is taken)');

  const names: string[] = [];
  schemasOf(operation, new Set(), names);
  const seen = new Set<string>();
  for (const name of names) gaps.push(...gapsOfSchema(name, schemas, seen));
  return gaps;
}

/** The gaps of every route that has some, by `METHOD /path`. */
export function findGaps(document: OpenAPIObject): Record<string, string[]> {
  const schemas = (document.components?.schemas ?? {}) as Schemas;
  const result: Record<string, string[]> = {};
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = item[method];
      if (!operation) continue;
      const gaps = gapsOfOperation(method, path, operation, schemas);
      if (gaps.length > 0) result[`${method.toUpperCase()} ${path}`] = gaps;
    }
  }
  return result;
}

/** What the ratchet says, given the gaps found and the routes the list allows to have some. */
export function checkAgainstList(found: Record<string, string[]>, allowed: readonly string[]): { newGaps: string[]; stale: string[] } {
  const known = new Set(allowed);
  const newGaps = Object.keys(found).filter((route) => !known.has(route)).sort();
  const stale = allowed.filter((route) => !(route in found)).sort();
  return { newGaps, stale };
}
