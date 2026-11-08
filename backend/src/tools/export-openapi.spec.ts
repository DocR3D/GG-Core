import { exportOpenApi } from './export-openapi';

/**
 * The export builds the whole application (Redis stubbed, no server) and describes its routes. In Jest the
 * @nestjs/swagger compiler plugin does not run (it acts in `nest build`), so only the paths are checked here, not
 * the schemas the plugin infers from the DTO classes.
 */
describe('OpenAPI export', () => {
  it('lists the routes with the global /api prefix and its exclusions, and not the documentation itself', async () => {
    const document = await exportOpenApi();
    const paths = Object.keys(document.paths);

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info.title).toBe('GG-Core API');
    expect(paths.length).toBeGreaterThan(100);

    expect(document.paths['/api/tournament/teams']?.post).toBeDefined(); // under the /api prefix
    expect(document.paths['/api/tournament/live']?.get).toBeDefined();
    expect(paths.some((p) => p.startsWith('/sandbox'))).toBe(true); // excluded from the prefix, still listed
    expect(paths.some((p) => p.startsWith('/api/sandbox'))).toBe(false);
    expect(paths.some((p) => p.startsWith('/api/docs'))).toBe(false);
  }, 30_000);
});
