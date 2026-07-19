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

	// ---- Score / match-state events (CS2 authoritative) ----
	EvTeamScore          = "team_score"           // score absolu par équipe (teamId + score)
	EvRoundEnd           = "round_end"            // fin de round (winner + reason)
	EvTeamInfo           = "team_info"            // nom d'équipe par teamid
	EvMatchWinPanel      = "cs_win_panel_match"   // match terminé définitivement
	EvMatchIntermission  = "cs_intermission"      // halftime ou fin de prolongation
	EvBeginNewMatch      = "begin_new_match"      // restart / nouvelle map
	EvMatchEndConditions = "match_end_conditions" // win_rounds + max_rounds du serveur
	EvTeamSwap           = "team_swap"            // échange de côté CT↔T (halftime)
	EvMatchStatusScore   = "match_status_score"   // MatchStatus: Score: CT:T RoundsPlayed: N
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

// ---- Score / match-state payloads ----

// TeamScorePayload est émis sur EvTeamScore.
// teamId=2 → TERRORIST, teamId=3 → CT (constantes CS2 immuables).
type TeamScorePayload struct {
	TeamID         int    `json:"teamId"`
	Score          int    `json:"score"`
	FirstHalfScore int    `json:"firstHalfScore,omitempty"`
	TeamName       string `json:"teamName,omitempty"`
}

// RoundEndPayload est émis sur EvRoundEnd.
type RoundEndPayload struct {
	Winner  string `json:"winner"`  // "CT" | "TERRORIST"
	Reason  string `json:"reason"`  // sfui_notice_xxx
	ScoreCT int    `json:"scoreCt"` // score CT à la fin du round
	ScoreT  int    `json:"scoreT"`  // score T à la fin du round
}

// TeamInfoPayload est émis sur EvTeamInfo.
type TeamInfoPayload struct {
	TeamID   int    `json:"teamId"`
	TeamName string `json:"teamName"`
}

// MatchEndConditionsPayload est émis sur EvMatchEndConditions.
type MatchEndConditionsPayload struct {
	WinRounds int `json:"winRounds"` // ex: 16
	MaxRounds int `json:"maxRounds"` // ex: 30
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
