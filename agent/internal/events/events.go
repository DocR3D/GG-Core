package events

import (
	"encoding/json"
	"time"
)

// ---- Event types (mirror de event.types.ts) ----
const (
	EvRoundStart       = "round_start"
	EvBombPlanted      = "bomb_planted"
	EvTeamRoundWin     = "team_round_win"
	EvSfuiTargetBombed = "sfui_notice_target_bombed"
	EvBombDefused      = "bomb_defused"
	EvKill             = "kill"
	EvPlayerConnected  = "player_connect"
	EvPlayerDisc       = "player_disconnect"
	EvPlayerNameChange = "name_change"
	EvDefuseBegin      = "defuse_begin"
	EvDefuseAbort      = "defuse_abort"
	EvMatchPaused      = "match_paused"
	EvMatchUnpaused    = "match_unpaused"
	EvChatMessage      = "chat_message"
	EvCommand          = "command"
	EvRawLog           = "raw_log"
	EvRoundStats       = "round_stats"
	EvItemPurchase     = "item_purchase"
	EvBeginBombPlant   = "begin_bomb_plant"
	EvNadeLanded       = "grenade_land"
	EvPlayerBlinded    = "player_blinded"
	EvGrenadeThrow     = "grenade_throw"
	EvRoundFreezeStart = "round_freeze_start"
)

type EventSource string
type EventKind string

const (
	SourceLogs   EventSource = "logs"
	SourceCSTV   EventSource = "cstv"
	SourceManual EventSource = "manual"

	KindPrimary   EventKind = "primary"
	KindTelemetry EventKind = "telemetry"
)

// ---- Base event (mirror de BaseEvent<T>) ----
type BaseEvent struct {
	V         int         `redis:"v"         json:"v"`
	ID        string      `redis:"id"        json:"id"`
	Timestamp int64       `redis:"timestamp" json:"timestamp"` // ms epoch
	Source    EventSource `redis:"source"    json:"source"`
	Kind      EventKind   `redis:"kind"      json:"kind"`

	ServerID string `redis:"serverId" json:"serverId"`
	MatchID  string `redis:"matchId"  json:"matchId"`
	Map      string `redis:"map,omitempty"   json:"map,omitempty"`
	Round    *int   `redis:"round,omitempty" json:"round,omitempty"`
	Tick     *int   `redis:"tick,omitempty"  json:"tick,omitempty"`

	Type    string          `redis:"type"    json:"type"`
	Payload json.RawMessage `redis:"payload" json:"payload"` // JSON compact
}

func NowMs() int64 { return time.Now().UnixMilli() }

// ---- Payloads (mirrors) ----
type ChatPayload struct {
	Channel string `json:"channel"` // "say" | "say_team"
	Player  struct {
		Name    string `json:"name"`
		UserID  *int   `json:"userId,omitempty"`
		SteamID string `json:"steamId,omitempty"`
		Team    string `json:"team"` // "CT" | "TERRORIST" | "Spectator" | "Unassigned" | string
	} `json:"player"`
	Message string `json:"message"`
}

type CommandPayload struct {
	Command    string   `json:"command"`
	Parameters []string `json:"parameters"`
	Sender     struct {
		Name    string `json:"name"`
		SteamID string `json:"steamId,omitempty"`
		Team    string `json:"team"`    // "T" | "CT" | "SPECTATOR" | "Unassigned"
		Channel string `json:"channel"` // "say" | "say_team"
	} `json:"sender"`
}

// ---- Helpers ----
type Ctx struct {
	ServerID string
	MatchID  string // "unknown" si non défini pour aligner avec ton TS
	Map      string
	Round    *int
	Tick     *int
	Source   EventSource
	Kind     EventKind
}

type IDGen func() string

func MakeBase(ctx Ctx, typ string, payload any, idgen IDGen) (BaseEvent, error) {
	raw, err := json.Marshal(payload)
	if err != nil {
		return BaseEvent{}, err
	}
	id := "evt-" + time.Now().Format("20060102-150405.000")
	if idgen != nil {
		id = idgen()
	}
	return BaseEvent{
		V:         1,
		ID:        id,
		Timestamp: NowMs(),
		Source:    ctx.Source,
		Kind:      ctx.Kind,
		ServerID:  ctx.ServerID,
		MatchID:   ctx.MatchID,
		Map:       ctx.Map,
		Round:     ctx.Round,
		Tick:      ctx.Tick,
		Type:      typ,
		Payload:   raw,
	}, nil
}

// Normalisation team comme côté TS
func NormTeam(team string) string {
	t := lower(team)
	switch {
	case hasPrefix(t, "ct"):
		return "CT"
	case hasPrefix(t, "t"), hasPrefix(t, "terror"):
		return "TERRORIST"
	case hasPrefix(t, "spec"):
		return "Spectator"
	case hasPrefix(t, "unass"), t == "":
		return "Unassigned"
	default:
		return team
	}
}

func lower(s string) string {
	b := []byte(s)
	for i := range b {
		if b[i] >= 'A' && b[i] <= 'Z' {
			b[i] = b[i] + 32
		}
	}
	return string(b)
}
func hasPrefix(s, p string) bool {
	if len(p) > len(s) {
		return false
	}
	return s[:len(p)] == p
}
