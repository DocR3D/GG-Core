/**
 * Command line entry of the OpenAPI export: `npm run openapi:export` (after `nest build`, from the backend folder)
 * writes `openapi.json` in the current folder. The file name is fixed on purpose: nothing from the command line reaches
 * the file system. The work itself is in export-openapi.ts, which the unit test runs.
 */
import { writeFileSync } from 'fs';
import { exportOpenApi } from './export-openapi';

const OUTPUT_FILE = 'openapi.json';

exportOpenApi().then(
  (document) => {
    writeFileSync(OUTPUT_FILE, `${JSON.stringify(document, null, 2)}\n`);
    console.log(`OpenAPI document written to ${OUTPUT_FILE} (${Object.keys(document.paths).length} paths)`);
    process.exit(0);
  },
  (error: unknown) => {
    console.error('OpenAPI export failed', error);
    process.exit(1);
  },
);
