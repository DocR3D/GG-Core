// src/adapters/http/matches/admin-actions.controller.spec.ts
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { MatchAdminActionsController } from './admin-actions.controller';

const MATCH_ID  = 'm-cs2-001';
const SERVER_ID = 'srv-a';
const DB_ID     = 42;

const CT_TEAM  = 'uuid-ct';
const T_TEAM   = 'uuid-t';

function validScore() {
  return { ct: { team_id: CT_TEAM, score: 12 }, t: { team_id: T_TEAM, score: 3 } };
}

function makeController(overrides?: {
  findDbId?: number | null;
  serverId?: string | undefined;
  agentError?: Error | null;
}) {
  const resolvedServerId = overrides && 'serverId' in overrides ? overrides.serverId : SERVER_ID;
  const resolvedDbId     = overrides && 'findDbId' in overrides ? overrides.findDbId  : DB_ID;
  const matchState = {
    getServerIdFromMatchId: jest.fn().mockResolvedValue(resolvedServerId),
  };
  const matchRepo = {
    findDbIdByRedisId: jest.fn().mockResolvedValue(resolvedDbId),
  };
  const historyRepo = {
    insert: jest.fn().mockResolvedValue(undefined),
  };
  const agentClient = {
    adminAction: jest.fn().mockImplementation(() => {
      if (overrides?.agentError) return Promise.reject(overrides.agentError);
      return Promise.resolve();
    }),
  };

  const ctrl = new MatchAdminActionsController(
    matchState as any,
    matchRepo as any,
    historyRepo as any,
    agentClient as any,
  );

  return { ctrl, matchState, matchRepo, historyRepo, agentClient };
}

// ──────────────────────────────────────────────────────────────────────────────
// Validation 400
// ──────────────────────────────────────────────────────────────────────────────
describe('MatchAdminActionsController — validation', () => {
  it('TC-01 action invalide → 400', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.execute(MATCH_ID, { action: 'invalid_action' as any }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-02 set_game_phase sans phase → 400', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.execute(MATCH_ID, { action: 'set_game_phase' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-03 set_game_phase phase invalide → 400', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.execute(MATCH_ID, { action: 'set_game_phase', phase: 'invalid_phase' as any }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-04 next_map sans map → 400', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.execute(MATCH_ID, { action: 'set_game_phase', phase: 'next_map' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-05 overtime sans score → 400', async () => {
    const { ctrl } = makeController();
    await expect(ctrl.execute(MATCH_ID, { action: 'set_game_phase', phase: 'overtime' }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-06 score.ct.score négatif → 400', async () => {
    const { ctrl } = makeController();
    const score = { ct: { team_id: CT_TEAM, score: -1 }, t: { team_id: T_TEAM, score: 0 } };
    await expect(ctrl.execute(MATCH_ID, { action: 'set_game_phase', phase: 'overtime', score }))
      .rejects.toBeInstanceOf(BadRequestException);
  });

  it('TC-07 ct.team_id === t.team_id → 400', async () => {
    const { ctrl } = makeController();
    const score = { ct: { team_id: 'same-uuid', score: 0 }, t: { team_id: 'same-uuid', score: 0 } };
    await expect(ctrl.execute(MATCH_ID, { action: 'set_game_phase', phase: 'overtime', score }))
      .rejects.toBeInstanceOf(BadRequestException);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// 404
// ──────────────────────────────────────────────────────────────────────────────
describe('MatchAdminActionsController — 404', () => {
  it('TC-08 match sans serveur → 404', async () => {
    const { ctrl } = makeController({ serverId: undefined });
    await expect(ctrl.execute(MATCH_ID, { action: 'pause_match' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('TC-09 match introuvable (pas de dbId) → 404', async () => {
    const { ctrl } = makeController({ findDbId: null });
    await expect(ctrl.execute(MATCH_ID, { action: 'pause_match' }))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Erreurs agent (HTTP 200, success:false)
// ──────────────────────────────────────────────────────────────────────────────
describe('MatchAdminActionsController — erreurs agent', () => {
  it('TC-10 agent timeout (AbortError) → { success:false, code:AGENT_TIMEOUT }', async () => {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    const { ctrl } = makeController({ agentError: err });
    const res = await ctrl.execute(MATCH_ID, { action: 'pause_match' });
    expect(res).toMatchObject({ success: false, error: { code: 'AGENT_TIMEOUT' } });
  });

  it('TC-11 agent erreur HTTP → { success:false, code:AGENT_ERROR }', async () => {
    const { ctrl } = makeController({ agentError: new Error('agent /admin-action HTTP 500: internal') });
    const res = await ctrl.execute(MATCH_ID, { action: 'pause_match' });
    expect(res).toMatchObject({ success: false, error: { code: 'AGENT_ERROR' } });
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Succès
// ──────────────────────────────────────────────────────────────────────────────
describe('MatchAdminActionsController — succès', () => {
  it('TC-12 pause_match → history enregistré + { success:true }', async () => {
    const { ctrl, historyRepo, agentClient } = makeController();
    const res = await ctrl.execute(MATCH_ID, { action: 'pause_match' });

    expect(res).toEqual({ success: true });
    expect(historyRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      id_match: DB_ID,
      event_type: 'admin:action',
      data: expect.objectContaining({ action: 'pause_match', serverId: SERVER_ID }),
    }));
    expect(agentClient.adminAction).toHaveBeenCalledWith(SERVER_ID, { action: 'pause_match', phase: undefined, map: undefined, score: undefined });
  });

  it('TC-13 set_game_phase overtime avec score → history + agent appelé avec payload complet', async () => {
    const { ctrl, historyRepo, agentClient } = makeController();
    const score = validScore();
    const res = await ctrl.execute(MATCH_ID, { action: 'set_game_phase', phase: 'overtime', score });

    expect(res).toEqual({ success: true });
    expect(historyRepo.insert).toHaveBeenCalledWith(expect.objectContaining({
      id_match: DB_ID,
      event_type: 'admin:action',
      data: expect.objectContaining({ action: 'set_game_phase', phase: 'overtime', score }),
    }));
    expect(agentClient.adminAction).toHaveBeenCalledWith(SERVER_ID, {
      action: 'set_game_phase',
      phase: 'overtime',
      map: undefined,
      score,
    });
  });
});
