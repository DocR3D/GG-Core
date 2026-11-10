/**
 * MatchAdminController, the manual-restore/backup route: the file of a state asked for, or every problem of that state at once.
 */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { MatchAdminError } from '@app/match/admin/match-admin.service';
import { RestoreStateError } from '@app/match/restore/restore-backup.service';
import { MatchAdminController } from './match-admin.controller';
import type { RestoreStateDto } from './dto/restore-state.dto';

const body = { round: 6, homeSide: 'T', home: { score: 3, lossStreak: 0 }, away: { score: 2, lossStreak: 2 }, players: [] } as unknown as RestoreStateDto;

function setup() {
  const restoreBackups = { build: jest.fn() };
  return { controller: new MatchAdminController({} as never, restoreBackups as never), restoreBackups };
}

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
