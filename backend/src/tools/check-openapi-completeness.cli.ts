/**
 * Command line entry of the completeness check of the API contract: run it from the backend folder, after
 * `node dist/tools/export-openapi.cli.js` (it reads `openapi.json`) - `npm run openapi:check` does both.
 *
 * - `openapi-gaps.json` lists the routes not described yet. A route outside the list with a gap fails the check, and so
 *   does a route of the list that has none (leave it: the list only gets shorter).
 * - `--update` rewrites the list from the document. Use it when a route is described (it leaves the list), never to let a
 *   new route in with gaps.
 * The file names are fixed on purpose: nothing from the command line reaches the file system.
 */
import { readFileSync, writeFileSync } from 'fs';
import type { OpenAPIObject } from '@nestjs/swagger';
import { byCodeUnit, checkAgainstList, findGaps } from './openapi-completeness';

const DOCUMENT_FILE = 'openapi.json';
const LIST_FILE = 'openapi-gaps.json';

const document = JSON.parse(readFileSync(DOCUMENT_FILE, 'utf8')) as OpenAPIObject;
const found = findGaps(document);
const total = Object.keys(document.paths).reduce((n, path) => n + Object.keys(document.paths[path]).length, 0);

if (process.argv.includes('--update')) {
  writeFileSync(LIST_FILE, `${JSON.stringify(Object.keys(found).sort(byCodeUnit), null, 2)}\n`);
  console.log(`${LIST_FILE} rewritten: ${Object.keys(found).length} routes of ${total} still have gaps`);
  process.exit(0);
}

const allowed = JSON.parse(readFileSync(LIST_FILE, 'utf8')) as string[];
const { newGaps, stale } = checkAgainstList(found, allowed);

for (const route of newGaps) console.error(`${route} has gaps and is not in ${LIST_FILE}:\n  - ${found[route].join('\n  - ')}`);
for (const route of stale) console.error(`${route} is complete: take it out of ${LIST_FILE} (npm run openapi:check -- --update)`);

if (newGaps.length > 0 || stale.length > 0) process.exit(1);
console.log(`API contract: ${total - allowed.length} routes of ${total} complete, ${allowed.length} still to describe (${LIST_FILE})`);
process.exit(0);
