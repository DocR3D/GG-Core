/**
 * MatchAdminController, the manual-restore/backup route: the file of a state asked for, or every problem of that state at once.
 */
import { HEADERS_METADATA } from '@nestjs/common/constants';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { MatchAdminError } from '@app/match/admin/match-admin.service';
import { RestoreStateError } from '@app/match/restore/restore-backup.service';
import { MatchAdminController } from './match-admin.controller';
import type { RestoreState } from '@domain/restore/restore-state';

const body = { round: 6, homeSide: 'T', home: { score: 3, lossStreak: 0 }, away: { score: 2, lossStreak: 2 }, players: [] } as unknown as RestoreState;

function setup() {
  const restoreBackups = { build: jest.fn() };
  const restoreDrafts = { draft: jest.fn() };
  return { controller: new MatchAdminController({} as never, restoreBackups as never, restoreDrafts as never), restoreBackups, restoreDrafts };
}

const admin = { ggSession: { role: 'admin', sub: 'a', name: 'Lana', via: 'steam' } } as never;
const visitor = { ggSession: null } as never;
const player = { ggSession: { role: 'player', sub: 'p', name: 'cap', via: 'steam' } } as never;

describe('MatchAdminController : manual-restore/draft', () => {
  it('gives the draft to an admin, for the round or the scores of the address, as numbers', async () => {
    const { controller, restoreDrafts } = setup();
    const draft = { state: {}, sources: {}, missing: [], teams: { home: 'A', away: 'B' } };
    restoreDrafts.draft.mockResolvedValue(draft);

    await expect(controller.restoreDraft('m-1', '6', undefined, undefined, admin)).resolves.toBe(draft);
    await controller.restoreDraft('m-1', undefined, '3', '2', admin);
    await controller.restoreDraft('m-1', '', '', '', admin);

    expect(restoreDrafts.draft).toHaveBeenNthCalledWith(1, 'm-1', { round: 6, scoreHome: undefined, scoreAway: undefined });
    expect(restoreDrafts.draft).toHaveBeenNthCalledWith(2, 'm-1', { round: undefined, scoreHome: 3, scoreAway: 2 });
    expect(restoreDrafts.draft).toHaveBeenNthCalledWith(3, 'm-1', { round: undefined, scoreHome: undefined, scoreAway: undefined });
  });

  it('is never kept in a cache: it holds SteamIDs and money', () => {
    expect(Reflect.getMetadata(HEADERS_METADATA, MatchAdminController.prototype.restoreDraft)).toEqual([{ name: 'Cache-Control', value: 'private, no-store' }]);
  });

  it.each([['a visitor', visitor], ['a player', player]])('refuses %s: it holds the SteamIDs and the money', (_who, req) => {
    const { controller, restoreDrafts } = setup();

    expect(() => controller.restoreDraft('m-1', '6', undefined, undefined, req)).toThrow(ForbiddenException);
    expect(restoreDrafts.draft).not.toHaveBeenCalled();
  });

  it('keeps the mapping of the console errors', async () => {
    const { controller, restoreDrafts } = setup();
    restoreDrafts.draft.mockRejectedValue(new MatchAdminError('conflict', 'no sides'));

    await expect(controller.restoreDraft('m-1', '6', undefined, undefined, admin)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('MatchAdminController : manual-restore/backup', () => {
  it('hands the state to the service, for the match of the address, and gives the file back as it is', async () => {
    const { controller, restoreBackups } = setup();
    const file = { fileName: 'ggcore_round05.txt', content: '"SaveFile"', rconCommand: 'mp_backup_restore_load_file ggcore_round05.txt', round: 6, warnings: [] };
    restoreBackups.build.mockResolvedValue(file);

    await expect(controller.restoreBackup('m-1', body)).resolves.toBe(file);

    expect(restoreBackups.build).toHaveBeenCalledWith('m-1', body);
  });

  it('answers 400 with the list of the problems, and the warnings, when the state is wrong', async () => {
    const { controller, restoreBackups } = setup();
    restoreBackups.build.mockRejectedValue(new RestoreStateError(['score: wrong', 'money: too much'], ['a warning']));

    const failure = controller.restoreBackup('m-1', body);

    await expect(failure).rejects.toBeInstanceOf(BadRequestException);
    await expect(failure).rejects.toMatchObject({
      response: { statusCode: 400, error: 'Bad Request', message: ['score: wrong', 'money: too much'], warnings: ['a warning'] },
    });
  });

  it.each([
    ['not_found', NotFoundException],
    ['conflict', ConflictException],
    ['invalid', BadRequestException],
  ] as const)('keeps the usual mapping of the console errors: %s', async (code, exception) => {
    const { controller, restoreBackups } = setup();
    restoreBackups.build.mockRejectedValue(new MatchAdminError(code, 'no way'));

    await expect(controller.restoreBackup('m-1', body)).rejects.toBeInstanceOf(exception);
  });

  it('lets any other failure through untouched', async () => {
    const { controller, restoreBackups } = setup();
    const boom = new Error('redis is gone');
    restoreBackups.build.mockRejectedValue(boom);

    await expect(controller.restoreBackup('m-1', body)).rejects.toBe(boom);
  });
});
