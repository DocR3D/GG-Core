package parser

import (
	"bufio"
	"encoding/json"
	"ggbot/internal/events"
	"os"
	"strings"
	"testing"
)


func TestTryParse(t *testing.T) {
	tests := []struct {
		name         string
		logLine      string
		wantType     string
		wantOk       bool
		verifyAssert func(t *testing.T, payload map[string]any)
	}{
		// Anti-Phantom Kill & Map Lifecycle
		{
			name:     "World Match_Start on de_inferno is ignored and NOT a kill",
			logLine:  `L 10/26/2026 - 21:43:21: World triggered "Match_Start" on "de_inferno"`,
			wantType: "",
			wantOk:   false,
		},
		{
			name:     "World Match_Reloaded on de_inferno is ignored and NOT a kill",
			logLine:  `L 10/26/2026 - 21:43:21: World triggered "Match_Reloaded" on "de_inferno"`,
			wantType: "",
			wantOk:   false,
		},
		{
			name:     "World Game_Commencing is ignored",
			logLine:  `World triggered "Game_Commencing"`,
			wantType: "",
			wantOk:   false,
		},
		{
			name:     "World Warmup_Start is ignored",
			logLine:  `World triggered "Warmup_Start"`,
			wantType: "",
			wantOk:   false,
		},

		// Rounds
		{
			name:     "Round Start",
			logLine:  `L 10/24/2026 - 19:20:00: World triggered "Round_Start"`,
			wantType: events.EvRoundStart,
			wantOk:   true,
		},
		{
			name:     "Round End",
			logLine:  `L 10/24/2026 - 19:20:34: World triggered "Round_End"`,
			wantType: events.EvRoundEnd,
			wantOk:   true,
		},

		// Kills
		{
			name:     "Standard Kill with Headshot",
			logLine:  `L 10/24/2026 - 19:21:48: "Alpha_Kilo<0><[U:1:1002]><CT>" [-1507 -341 105] killed "Bravo_Alfa<15><[U:1:2002]><TERRORIST>" [-470 -58 86] with "m4a1" (headshot)`,
			wantType: events.EvKill,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["kind"] != "player" {
					t.Fatalf("expected kind=player, got %v", payload["kind"])
				}
				if payload["weapon"] != "m4a1" {
					t.Fatalf("expected weapon=m4a1, got %v", payload["weapon"])
				}
				if payload["headshot"] != true {
					t.Fatalf("expected headshot=true, got %v", payload["headshot"])
				}
				killer := payload["killer"].(map[string]any)
				if killer["name"] != "Alpha_Kilo" || killer["team"] != "CT" {
					t.Fatalf("unexpected killer: %v", killer)
				}
				victim := payload["victim"].(map[string]any)
				if victim["name"] != "Bravo_Alfa" || victim["team"] != "TERRORIST" {
					t.Fatalf("unexpected victim: %v", victim)
				}
			},
		},
		{
			name:     "Kill with Noscope and Through Smoke",
			logLine:  `"Alpha_Echo<2><[U:1:1001]><CT>" [-595 -1933 -175] killed "Bravo_Sierra<12><[U:1:2005]><TERRORIST>" [-627 -2133 -153] with "awp" (noscope throughsmoke)`,
			wantType: events.EvKill,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["noscope"] != true {
					t.Fatalf("expected noscope=true")
				}
				if payload["throughsmoke"] != true {
					t.Fatalf("expected throughsmoke=true")
				}
				if payload["headshot"] == true {
					t.Fatalf("expected headshot=false")
				}
			},
		},
		{
			name:     "Suicide with World",
			logLine:  `L 10/24/2026 - 19:17:09: "Bravo_Sierra<12><[U:1:2005]><TERRORIST>" [-431 -2234 -163] committed suicide with "world"`,
			wantType: events.EvKill,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["kind"] != "suicide" {
					t.Fatalf("expected kind=suicide, got %v", payload["kind"])
				}
				if payload["weapon"] != "world" {
					t.Fatalf("expected weapon=world, got %v", payload["weapon"])
				}
				player := payload["player"].(map[string]any)
				if player["name"] != "Bravo_Sierra" || player["team"] != "TERRORIST" {
					t.Fatalf("unexpected player: %v", player)
				}
			},
		},

		// Team Round Win
		{
			name:     "CT Bomb Defused with Score",
			logLine:  `Team "CT" triggered "SFUI_Notice_Bomb_Defused" (CT "4") (T "5")`,
			wantType: events.EvTeamRoundWin,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["winner"] != "CT" {
					t.Fatalf("expected winner=CT, got %v", payload["winner"])
				}
				if payload["reason"] != "defused" {
					t.Fatalf("expected reason=defused, got %v", payload["reason"])
				}
				score := payload["score"].(map[string]any)
				if int(score["ct"].(float64)) != 4 || int(score["t"].(float64)) != 5 {
					t.Fatalf("unexpected score: %v", score)
				}
			},
		},
		{
			name:     "T Target Bombed",
			logLine:  `Team "TERRORIST" triggered "SFUI_Notice_Target_Bombed" (CT "0") (T "2")`,
			wantType: events.EvTeamRoundWin,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["winner"] != "T" {
					t.Fatalf("expected winner=T, got %v", payload["winner"])
				}
				if payload["reason"] != "bomb_exploded" {
					t.Fatalf("expected reason=bomb_exploded, got %v", payload["reason"])
				}
			},
		},
		{
			name:     "World Round Draw",
			logLine:  `World triggered "SFUI_Notice_Round_Draw" (CT "3") (T "2")`,
			wantType: events.EvTeamRoundWin,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["winner"] != "none" {
					t.Fatalf("expected winner=none, got %v", payload["winner"])
				}
				if payload["reason"] != "draw" {
					t.Fatalf("expected reason=draw, got %v", payload["reason"])
				}
			},
		},

		// Bomb Plants
		{
			name:     "Planted_The_Bomb CS2 Syntax at bombsite A",
			logLine:  `"Bravo_Sierra<7><[U:1:2005]><TERRORIST>" triggered "Planted_The_Bomb" at bombsite A`,
			wantType: events.EvBombPlanted,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["site"] != "A" {
					t.Fatalf("expected site=A, got %v", payload["site"])
				}
				planter := payload["planter"].(map[string]any)
				if planter["name"] != "Bravo_Sierra" || planter["team"] != "TERRORIST" {
					t.Fatalf("unexpected planter: %v", planter)
				}
			},
		},
		{
			name:     "Bomb_Begin_Plant at bombsite B",
			logLine:  `"Bravo_Sierra<7><[U:1:2005]><TERRORIST>" triggered "Bomb_Begin_Plant" at bombsite B`,
			wantType: events.EvBeginBombPlant,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["site"] != "B" {
					t.Fatalf("expected site=B, got %v", payload["site"])
				}
			},
		},

		// Bomb Defuses
		{
			name:     "Begin_Bomb_Defuse_Without_Kit",
			logLine:  `"Alpha_Kilo<5><[U:1:1002]><CT>" triggered "Begin_Bomb_Defuse_Without_Kit"`,
			wantType: events.EvDefuseBegin,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["hasKit"] != false {
					t.Fatalf("expected hasKit=false, got %v", payload["hasKit"])
				}
			},
		},
		{
			name:     "Begin_Bomb_Defuse_With_Kit",
			logLine:  `"Alpha_Kilo<5><[U:1:1002]><CT>" triggered "Begin_Bomb_Defuse_With_Kit"`,
			wantType: events.EvDefuseBegin,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["hasKit"] != true {
					t.Fatalf("expected hasKit=true, got %v", payload["hasKit"])
				}
			},
		},
		{
			name:     "Aborted_Bomb_Defuse",
			logLine:  `"Alpha_Kilo<5><[U:1:1002]><CT>" triggered "Aborted_Bomb_Defuse"`,
			wantType: events.EvDefuseAbort,
			wantOk:   true,
		},

		// Player Connections & Disconnections
		{
			name:     "Player Connect with empty team and IP",
			logLine:  `"Player_02<2><[U:1:10000002]><>" connected, address "10.0.0.14:61353"`,
			wantType: events.EvPlayerConnected,
			wantOk:   true,
		},
		{
			name:     "Bot Disconnect with reason",
			logLine:  `"Dragomir<14><BOT><CT>" disconnected (reason "NETWORK_DISCONNECT_KICKED")`,
			wantType: events.EvPlayerDisc,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["reason"] != "NETWORK_DISCONNECT_KICKED" {
					t.Fatalf("unexpected reason: %v", payload["reason"])
				}
			},
		},
		{
			name:     "Name Change",
			logLine:  `"Player_01<1><[U:1:10000001]><CT>" changed name to "AceMaster"`,
			wantType: events.EvPlayerNameChange,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["newName"] != "AceMaster" {
					t.Fatalf("unexpected newName: %v", payload["newName"])
				}
			},
		},

		// Item Purchase
		{
			name:     "Purchase item_assaultsuit",
			logLine:  `"Player_04<6><[U:1:10000004]><CT>" purchased "item_assaultsuit"`,
			wantType: events.EvItemPurchase,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["weapon"] != "item_assaultsuit" {
					t.Fatalf("unexpected weapon: %v", payload["weapon"])
				}
			},
		},

		// Chat & Commands
		{
			name:     "Command !ready",
			logLine:  `"Alpha_Kilo<0><[U:1:1002]><CT>" say "!ready"`,
			wantType: events.EvCommand,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["command"] != "ready" {
					t.Fatalf("expected command=ready, got %v", payload["command"])
				}
			},
		},
		{
			name:     "Standard Chat Message",
			logLine:  `"Alpha_Kilo<0><[U:1:1002]><CT>" say "nice try team"`,
			wantType: events.EvChatMessage,
			wantOk:   true,
			verifyAssert: func(t *testing.T, payload map[string]any) {
				if payload["message"] != "nice try team" {
					t.Fatalf("expected message='nice try team', got %v", payload["message"])
				}
			},
		},

		// Pauses
		{
			name:     "Match Paused via server_cvar",
			logLine:  `server_cvar: "mp_pause_match" "1"`,
			wantType: events.EvMatchPaused,
			wantOk:   true,
		},
		{
			name:     "Match Unpaused",
			logLine:  `Match Unpaused`,
			wantType: events.EvMatchUnpaused,
			wantOk:   true,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			evType, raw, ok := TryParse(StripCs2Prefix(tc.logLine))
			if ok != tc.wantOk {
				t.Fatalf("TryParse() ok = %v, wantOk = %v (event: %s)", ok, tc.wantOk, evType)
			}
			if evType != tc.wantType {
				t.Fatalf("TryParse() type = %s, wantType = %s", evType, tc.wantType)
			}
			if ok && tc.verifyAssert != nil {
				var payload map[string]any
				if err := json.Unmarshal(raw, &payload); err != nil {
					t.Fatalf("failed to unmarshal payload: %v", err)
				}
				tc.verifyAssert(t, payload)
			}
		})
	}
}

func TestTryParse_RealMatchLogsNoPhantomKills(t *testing.T) {
	logPaths := []string{
		"../../../test/fixtures/raw-logs/gglan18_match_sample_anonymized.log",
		"../../../test/fixtures/raw-logs/gglan19_match71_ancient_pauses_anonymized.log",
		"../../../test/fixtures/raw-logs/gglan19_sample_match59_anonymized.log",
		"../../../test/fixtures/raw-logs/gglan19_match156_inferno_ot5_anonymized.log",
	}

	for _, logPath := range logPaths {
		file, err := os.Open(logPath)
		if err != nil {
			t.Logf("Skipping %s (not found or error: %v)", logPath, err)
			continue
		}

		scanner := bufio.NewScanner(file)
		lineCount := 0
		parsedCount := 0

		for scanner.Scan() {
			lineCount++
			line := scanner.Text()
			evType, raw, ok := TryParse(StripCs2Prefix(line))
			if !ok {
				continue
			}
			parsedCount++

			if evType == events.EvKill {
				var p map[string]any
				if err := json.Unmarshal(raw, &p); err == nil {
					if p["kind"] == "world" {
						file.Close()
						t.Fatalf("File %s, line %d: world kill emitted! line: %s", logPath, lineCount, line)
					}
					if victim, ok := p["victim"].(map[string]any); ok {
						vname, _ := victim["name"].(string)
						if strings.HasPrefix(vname, "de_") || strings.HasPrefix(vname, "cs_") {
							file.Close()
							t.Fatalf("File %s, line %d: Phantom map kill detected with victim '%s'! line: %s", logPath, lineCount, vname, line)
						}
					}
				}
			}
		}
		file.Close()

		t.Logf("Tested %s: %d lines processed, %d events successfully extracted", logPath, lineCount, parsedCount)
	}
}
