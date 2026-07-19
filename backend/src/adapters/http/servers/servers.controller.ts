// src/adapters/http/servers/servers.controller.ts
import {
  Controller, Get, Post, Patch, Delete, Param, Body,
  HttpCode, NotFoundException, BadRequestException, ParseIntPipe,
} from '@nestjs/common';
import {
  ApiTags, ApiOperation, ApiParam, ApiBody, ApiProperty,
  ApiPropertyOptional, ApiOkResponse, ApiCreatedResponse,
  ApiNotFoundResponse, ApiBadRequestResponse, ApiNoContentResponse,
} from '@nestjs/swagger';
import { ServerRepository } from '@adapters/postgres/server.repository';
import { ServerProbeService } from '@app/servers/server-probe.service';
import type { ServerDto, ServerStatus } from '@domain/server.types';

// ─── DTOs ────────────────────────────────────────────────────────────────────

class CreateServerDto {
  @ApiProperty({ example: 'Server LAN-1', description: 'Nom affiché du serveur' })
  name: string;
  @ApiProperty({ example: '192.168.1.10', description: 'Adresse IP du serveur CS2 (même IP que l\'agent Go)' })
  ip: string;
  @ApiPropertyOptional({ example: 27015, default: 27015, description: 'Port jeu CS2 (défaut: 27015)' })
  port?: number;
  @ApiProperty({
    example: 'srv-a',
    description: 'Identifiant agent — doit correspondre au champ `serverId` dans `agents.d/*.yaml`',
  })
  server_id: string;
  @ApiProperty({
    example: 8082,
    description: 'Port HTTP de l\'agent Go (même IP que le serveur CS2). Requis pour envoyer des commandes au serveur.',
  })
  agent_port: number;
  @ApiPropertyOptional({
    example: 'manager',
    description: 'Host pour joindre l\'agent HTTP. Vide = utilise `ip`. Utile en dev Docker pour pointer vers le service Docker (ex: "manager") plutôt que l\'IP LAN.',
  })
  agent_host?: string;
  @ApiPropertyOptional({ description: 'Token X-Agent-Token pour les appels HTTP vers l\'agent (jamais exposé en GET)' })
  agent_token?: string;
}

class UpdateServerDto {
  @ApiPropertyOptional({ example: 'Server LAN-1' })  name?: string;
  @ApiPropertyOptional({ example: '192.168.1.10' })  ip?: string;
  @ApiPropertyOptional({ example: 27015 })           port?: number;
  @ApiPropertyOptional({ example: 'srv-a' })         server_id?: string;
  @ApiPropertyOptional({ example: 8082, description: 'Port HTTP de l\'agent Go' })
  agent_port?: number;
  @ApiPropertyOptional({ example: 'manager', description: 'Host agent HTTP (vide = utilise ip). Ex: "manager" en dev Docker.' })
  agent_host?: string;
  @ApiPropertyOptional({ description: 'Token X-Agent-Token pour l\'agent (jamais exposé en GET)' })
  agent_token?: string;
}

// ─── Schéma de réponse ───────────────────────────────────────────────────────

class ServerResponseDto {
  @ApiProperty({ example: 1 })
  id: number;
  @ApiProperty({ example: 'srv-a', description: 'Identifiant agent (clé Redis)' })
  server_id: string;
  @ApiProperty({ example: 'Server LAN-1' })
  name: string;
  @ApiProperty({ example: '192.168.1.10' })
  ip: string;
  @ApiProperty({ example: 27015 })
  port: number;
  @ApiProperty({ example: 8082, description: 'Port HTTP de l\'agent Go (0 = non configuré)' })
  agent_port: number;
  @ApiProperty({ example: 'manager', description: 'Host agent HTTP (vide = utilise ip). Ex: "manager" en dev Docker.' })
  agent_host: string;
  @ApiProperty({ example: '2026-04-13T12:00:00.000Z' })
  created_at: Date;
  @ApiProperty({
    enum: ['offline', 'start', 'used'] satisfies ServerStatus[],
    example: 'start',
    description: '`offline` = agent injoignable · `start` = disponible (aucun match en cours) · `used` = match en cours',
  })
  status: ServerStatus;
  @ApiProperty({ example: 'm-a1b2c3d4e5', nullable: true, description: 'ID Redis du match en cours, null si `status` ≠ `used`' })
  currentMatchId: string | null;
}

// ─── Controller ──────────────────────────────────────────────────────────────

@ApiTags('servers')
@Controller('servers')
export class ServersController {
  constructor(
    private readonly serverRepo: ServerRepository,
    private readonly probe: ServerProbeService,
  ) {}

  private async computeStatus(
    serverId: string,
  ): Promise<{ status: ServerStatus; currentMatchId: string | null }> {
    if (!serverId) return { status: 'offline', currentMatchId: null };
    const cached = await this.probe.getCachedStatus(serverId);
    return {
      status:         cached?.status         ?? 'offline',
      currentMatchId: cached?.currentMatchId ?? null,
    };
  }

  @Get()
  @ApiOperation({
    summary: 'Liste tous les serveurs',
    description: 'Retourne tous les serveurs CS2 enregistrés avec leur statut live issu du **cache probe agent** (mis à jour toutes les 20 s via `GET /health` sur l\'agent Go). Le champ `agent_token` n\'est jamais exposé.',
  })
  @ApiOkResponse({ type: [ServerResponseDto] })
  async findAll(): Promise<ServerDto[]> {
    const rows = await this.serverRepo.findAll();
    return Promise.all(
      rows.map(async (row) => {
        const { status, currentMatchId } = await this.computeStatus(row.server_id);
        const { agent_token: _a, ...safe } = row;
        return { ...safe, status, currentMatchId };
      }),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Détails d\'un serveur',
    description: 'Retourne le serveur avec son statut live depuis le cache probe RCON.',
  })
  @ApiParam({ name: 'id', description: 'ID PostgreSQL du serveur', example: 1 })
  @ApiOkResponse({ type: ServerResponseDto })
  @ApiNotFoundResponse({ description: 'Serveur introuvable' })
  async findOne(@Param('id', ParseIntPipe) id: number): Promise<ServerDto> {
    const row = await this.serverRepo.findById(id);
    if (!row) throw new NotFoundException(`Server ${id} not found`);
    const { status, currentMatchId } = await this.computeStatus(row.server_id);
    const { agent_token: _a, ...safe } = row;
    return { ...safe, status, currentMatchId };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Créer un serveur CS2',
    description: `Enregistre un nouveau serveur. Le champ \`server_id\` doit correspondre exactement au champ \`serverId\` dans le fichier \`agents.d/*.yaml\` de l\'agent Go.

Le probe d\'agent démarrera automatiquement dans les 20 s suivant la création (via \`GET /health\` sur l\'agent).`,
  })
  @ApiBody({ type: CreateServerDto })
  @ApiCreatedResponse({ type: ServerResponseDto })
  @ApiBadRequestResponse({ description: 'name, ip, server_id ou agent_port manquant' })
  async create(@Body() dto: CreateServerDto): Promise<ServerDto> {
    if (!dto.name || !dto.ip)       throw new BadRequestException('name et ip sont requis');
    if (!dto.server_id)             throw new BadRequestException('server_id est requis');
    if (!dto.agent_port)            throw new BadRequestException('agent_port est requis');
    const row = await this.serverRepo.create({
      name: dto.name,
      ip: dto.ip,
      port: dto.port ?? 27015,
      server_id: dto.server_id,
      agent_port: dto.agent_port,
      agent_host: dto.agent_host ?? '',
      agent_token: dto.agent_token ?? '',
    });
    const { agent_token: _a, ...safe } = row;
    return { ...safe, status: 'offline', currentMatchId: null };
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Modifier un serveur',
    description: 'Met à jour les champs fournis. Les champs non fournis ne sont pas modifiés. Utile pour changer le `agent_port`, l\'`agent_token` ou lier un `server_id`.',
  })
  @ApiParam({ name: 'id', description: 'ID PostgreSQL du serveur', example: 1 })
  @ApiBody({ type: UpdateServerDto })
  @ApiOkResponse({ type: ServerResponseDto })
  @ApiNotFoundResponse({ description: 'Serveur introuvable' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateServerDto,
  ): Promise<ServerDto> {
    const row = await this.serverRepo.update(id, dto);
    if (!row) throw new NotFoundException(`Server ${id} not found`);
    const { status, currentMatchId } = await this.computeStatus(row.server_id);
    const { agent_token: _a, ...safe } = row;
    return { ...safe, status, currentMatchId };
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Supprimer un serveur' })
  @ApiParam({ name: 'id', description: 'ID PostgreSQL du serveur', example: 1 })
  @ApiNoContentResponse({ description: 'Serveur supprimé' })
  @ApiNotFoundResponse({ description: 'Serveur introuvable' })
  async remove(@Param('id', ParseIntPipe) id: number): Promise<void> {
    const deleted = await this.serverRepo.delete(id);
    if (!deleted) throw new NotFoundException(`Server ${id} not found`);
  }
}
