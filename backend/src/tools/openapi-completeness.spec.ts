import type { OpenAPIObject } from '@nestjs/swagger';
import { byCodeUnit, checkAgainstList, findGaps, gapsOfOperation } from './openapi-completeness';

const schemas = {
  Player: {
    type: 'object',
    description: 'A player',
    properties: { id: { type: 'string', description: 'His id', example: 'p1' } },
  },
  Bare: {
    type: 'object',
    properties: { id: { type: 'string' }, flag: { type: 'boolean', description: 'A flag' }, list: { type: 'array', description: 'The players', items: { $ref: '#/components/schemas/Player' } } },
  },
};

/** A route with everything: what the check wants to see. */
const complete = {
  summary: 'Adds a player',
  description: 'Admin only. The rules.',
  security: [{ bearer: [] }],
  parameters: [{ name: 'id', in: 'path', required: true, description: 'Id of the match', schema: { type: 'string', example: 'm1' } }],
  requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/Player' } } } },
  responses: {
    '201': { description: 'Added' },
    '400': { description: 'Refused' },
    '401': { description: 'Not signed in' },
    '403': { description: 'Not admin' },
  },
};

const gaps = (operation: object, method = 'post') => gapsOfOperation(method, '/api/x', operation as never, schemas);

describe('gapsOfOperation', () => {
  it('has nothing to say about a route that is complete', () => {
    expect(gaps(complete)).toEqual([]);
  });

  it('asks for a summary and for the rules of the route', () => {
    expect(gaps({ ...complete, summary: ' ', description: undefined })).toEqual(['no summary', 'no description (the rules of the route)']);
  });

  it('asks for the description and the example of each parameter, unless an enum gives the values', () => {
    const bare = { ...complete, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }] };
    expect(gaps(bare)).toEqual(['parameter id: no description', 'parameter id: no example']);

    const listed = { ...complete, parameters: [{ name: 'side', in: 'path', required: true, description: 'A side', schema: { type: 'string', enum: ['CT', 'T'] } }] };
    expect(gaps(listed)).toEqual([]);
  });

  it('asks for a success answer, and a description for every answer', () => {
    expect(gaps({ ...complete, responses: { '400': { description: 'Refused' }, '401': { description: 'a' }, '403': { description: 'b' } } })).toEqual(['no success answer declared']);
    expect(gaps({ ...complete, responses: { ...complete.responses, '201': { description: '' } } })).toEqual(['answer 201: no description']);
  });

  it('asks for the padlock on a write, and for the 401 and 403 it brings', () => {
    expect(gaps({ ...complete, security: undefined })).toEqual(['no padlock (admin only?)']);
    expect(gaps({ ...complete, responses: { '201': { description: 'Added' }, '400': { description: 'Refused' } } })).toEqual([
      'no 401 answer (the padlock needs it)',
      'no 403 answer (the padlock needs it)',
    ]);
  });

  it('does not ask for a padlock on a read, but asks for a 400 when a body is taken', () => {
    const read = { summary: 's', description: 'Public.', responses: { '200': { description: 'ok' } } };
    expect(gaps(read, 'get')).toEqual([]);
    expect(gaps({ ...complete, responses: { '201': { description: 'a' }, '401': { description: 'b' }, '403': { description: 'c' } } })).toEqual(['no 400 answer (a body is taken)']);
  });

  it('looks at the classes of the body and of the answers: the class, then each field, through lists', () => {
    const bare = { ...complete, requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Bare' } } } } };
    expect(gaps(bare)).toEqual([
      'schema Bare: no description of the class',
      'schema Bare.id: no description',
      'schema Bare.id: no example',
      'schema Bare.flag: no example',
    ]);
  });

  it('looks at a class once, however many times it is used', () => {
    const twice = {
      ...complete,
      responses: { ...complete.responses, '200': { description: 'ok', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Bare' } } } } } },
      requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Bare' } } } },
    };
    expect(gaps(twice).filter((gap) => gap === 'schema Bare: no description of the class')).toHaveLength(1);
  });
});

describe('byCodeUnit', () => {
  it('orders the routes the same way on every machine: capitals before small letters, equal ones kept', () => {
    expect(['b', 'a', 'B', 'a'].sort(byCodeUnit)).toEqual(['B', 'a', 'a', 'b']);
    expect(byCodeUnit('GET /api/a', 'GET /api/a')).toBe(0);
  });
});

describe('findGaps and the list', () => {
  const document = {
    openapi: '3.0.0',
    info: { title: 't', version: '1' },
    components: { schemas },
    paths: { '/api/a': { post: complete, get: { responses: { '200': { description: 'ok' } } } }, '/api/b': { delete: { summary: 's' } } },
  } as unknown as OpenAPIObject;

  it('lists the routes that have gaps, by method and path', () => {
    const found = findGaps(document);
    expect(Object.keys(found)).toEqual(['GET /api/a', 'DELETE /api/b']);
    expect(found['GET /api/a']).toEqual(['no summary', 'no description (the rules of the route)']);
  });

  it('lets a route of the list have gaps, refuses a new one, and wants a complete one out of the list', () => {
    const found = findGaps(document);
    expect(checkAgainstList(found, ['GET /api/a', 'DELETE /api/b'])).toEqual({ newGaps: [], stale: [] });
    expect(checkAgainstList(found, ['DELETE /api/b'])).toEqual({ newGaps: ['GET /api/a'], stale: [] });
    expect(checkAgainstList(found, ['GET /api/a', 'DELETE /api/b', 'POST /api/a'])).toEqual({ newGaps: [], stale: ['POST /api/a'] });
  });
});
