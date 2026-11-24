import { NotFoundException } from '@nestjs/common';
import { SidesController } from './sides.controller';

function makeController(swapped: boolean) {
  const matchState = { swapSides: jest.fn().mockResolvedValue(swapped) };
  return { matchState, controller: new SidesController(matchState as never) };
}

describe('SidesController : swap', () => {
  it('asks the match state to swap the sides and answers ok', async () => {
    const { controller, matchState } = makeController(true);

    expect(await controller.swap('m1')).toEqual({ ok: true });
    expect(matchState.swapSides).toHaveBeenCalledWith('m1');
  });

  it('answers a 404, naming the match, when its sides are not set yet (nothing to swap)', async () => {
    const { controller } = makeController(false);

    const answer = controller.swap('m1');

    await expect(answer).rejects.toBeInstanceOf(NotFoundException);
    await expect(answer).rejects.toThrow('m1');
  });
});
