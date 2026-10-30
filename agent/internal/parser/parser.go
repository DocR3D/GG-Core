package parser

import (
	"encoding/json"
	"ggbot/internal/events"
	"regexp"
	"strconv"
	"strings"
	"time" // NEW: pour TTL
)

// Raccourci: enlève le préfixe "L 09/10/2025 - 12:06:37.924 - "
var tsPrefix = regexp.MustCompile(`^(?:\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+\[[^\]]+\]\s+)?(?:L\s+)?\d{2}/\d{2}/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*[-:]\s*`)

func StripCs2Prefix(line string) string {
	return tsPrefix.ReplaceAllString(line, "")
}

// --- Regex (miroirs de ton TS) ---
var chatRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<(?P<uid>\d+)><(?P<steam>[^>]*)><(?P<team>[^>]+)>"\s+(?P<channel>say|say_team)\s+"(?P<msg>.*)"$`)

// --- Kills & players ---
// Game Over: competitive mg_active de_inferno score 5:7 after 29 min   (score is CT:T, map group optional)
var gameOverRe = regexp.MustCompile(`^Game Over:\s+(?P<mode>\S+)\s+(?:(?P<group>\S+)\s+)?(?P<map>\S+)\s+score\s+(?P<ct>\d+):(?P<t>\d+)\s+after\s+(?P<min>\d+)\s+min`)

var matchStartRe = regexp.MustCompile(`^World triggered "Match_Start"(?:\s+on\s+"(?P<map>[^"]+)")?`)
var mapLifecycleRe = regexp.MustCompile(`^World triggered "(?:Match_Reloaded|Game_Commencing|Warmup_Start|Restart_Round_\([^)]+\))"`)

// --- Round / bomb / team win ---
var roundStartRe = regexp.MustCompile(`^World triggered "Round_Start"`)
var roundEndRe = regexp.MustCompile(`^World triggered "Round_End"`)
var teamWinRe = regexp.MustCompile(`^(?:Team "(?P<winner>TERRORIST|CT)"|World)\s+triggered\s+"(?P<sfui>SFUI_Notice_[A-Za-z_]+)"(?:\s+\(CT\s+"(?P<ct>\d+)"\)\s+\(T\s+"(?P<t>\d+)"\))?`)
var bombPlantedRe = regexp.MustCompile(`^"(?P<planter>[^"<]+)<\d+><(?P<psteam>[^>]*)><(?P<pteam>CT|TERRORIST)>"\s+triggered\s+"Planted_The_Bomb"(?:\s+(?:at\s+bombsite|\(Site\))\s+(?P<site>[AB])\)?)?`)
var bombDefusedRe = regexp.MustCompile(`^"(?P<defuser>[^"<]+)<\d+><(?P<dsteam>[^>]*)><(?P<dteam>CT|TERRORIST)>"\s+triggered\s+"Defused_The_Bomb"`)

// --- Pause / unpause ---
var pauseRe = regexp.MustCompile(`^(?:(?:Match\s+Paused)|(?:Game\s+Paused)|(?:server_cvar:\s*"?mp_pause_match"?\s*"?[1-9]))`)
var unpauseRe = regexp.MustCompile(`^(?:(?:Match\s+Unpaused)|(?:Game\s+Unpaused)|(?:server_cvar:\s*"?mp_unpause_match"?)|(?:server_cvar:\s*"?mp_pause_match"?\s*"0"?))`)

// --- Defuse begin/abort ---
var defuseBeginRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>CT|TERRORIST)>"\s+triggered\s+"Begin_Bomb_Defuse(?:_(?:With|Without)_Kit)?"`)
var defuseAbortRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>CT|TERRORIST)>"\s+triggered\s+"Aborted_Bomb_Defuse"`)

// --- Player connect/disconnect/name change ---
var playerConnectRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]*)>"\s+connected`)
var playerDisconnectRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]*)>"\s+disconnected(?:\s+\((?:reason\s+)?"?(?P<reason>[^")]+)"?\))?`)
var nameChangeRe = regexp.MustCompile(`^"(?P<old>[^"<]+)<\d+><(?P<steam>[^>]*)><[^>]*>"\s+changed\s+name\s+to\s+"(?P<new>[^"]+)"`)

// --- Purchases ---
var purchaseRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]+)>"\s+purchased\s+"(?P<weapon>[^"]+)"`)

// --- Grenade throws ---
var nadeLandRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]+)>"\s+threw\s+(?P<nade>flashbang|smokegrenade|hegrenade|molotov|incgrenade|decoy)(?:\s|$)`)

// --- Kills & Suicides ---
var killRe = regexp.MustCompile(`^"(?P<killer>[^"<]+)<\d+><(?P<ksteam>[^>]*)><(?P<kteam>[^>]+)>"(?:\s+\[(?P<kpos>[-\d\s]+)\])?\s+killed\s+"(?P<victim>[^"<]+)<\d+><(?P<vsteam>[^>]*)><(?P<vteam>[^>]+)>"(?:\s+\[(?P<vpos>[-\d\s]+)\])?\s+with\s+"(?P<weapon>[^"]+)"(?P<tags>.*)$`)
var assistRe = regexp.MustCompile(`^"(?P<player>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]+)>"\s+(?:(?P<flash>flash)-)?assisted\s+killing\s+"(?P<victim>[^"<]+)<\d+><(?P<vsteam>[^>]*)><(?P<vteam>[^>]+)>"`)
var suicideRe = regexp.MustCompile(`^"(?P<player>[^"<]+)<\d+><(?P<psteam>[^>]*)><(?P<pteam>[^>]+)>"(?:\s+\[(?P<pos>[-\d\s]+)\])?\s+committed\s+suicide\s+with\s+"(?P<weapon>[^"]+)"$`)
var killedByBombRe = regexp.MustCompile(`^"(?P<player>[^"<]+)<\d+><(?P<psteam>[^>]*)><(?P<pteam>[^>]+)>"(?:\s+\[(?P<pos>[-\d\s]+)\])?\s+was\s+killed\s+by\s+the\s+bomb\.?$`)

// --- Begin bomb plant ---
var beginPlantRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>CT|TERRORIST)>"\s+triggered\s+"Bomb_Begin_Plant"\s+at\s+bombsite\s+(?P<site>A|B)$`)

// --- Grenade: deux familles de logs ---
var nadeThrowRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]+)>"\s+sv_throw_(?P<nade>smokegrenade|flashbang|hegrenade|molotov|incgrenade|decoy)\s+(?P<num>[-0-9.\s]+)$`)

// 2) "threw <type> [x y z]" (+ entindex optionnel, parenthèse orpheline tolérée)
var nadeThrewRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>[^>]*)><(?P<team>[^>]+)>"\s+threw\s+(?P<nade>molotov|flashbang|smokegrenade|hegrenade|incgrenade|decoy)\s+\[(?P<pos>[-\d\s]+)\](?:\s+\w+\s+entindex\s+(?P<ent>\d+)\)?)?$`)

// --- Grenade "landed / spawned" ---
var nadeSpawnedRe = regexp.MustCompile(`^(?i)(?P<nade>Molotov|Flashbang|Smokegrenade|HEGrenade|IncGrenade|Decoy)\s+projectile\s+spawned\s+at\s+(?P<x>-?\d+(?:\.\d+)?)\s+(?P<y>-?\d+(?:\.\d+)?)\s+(?P<z>-?\d+(?:\.\d+)?),\s+velocity\s+(?P<vx>-?\d+(?:\.\d+)?)\s+(?P<vy>-?\d+(?:\.\d+)?)\s+(?P<vz>-?\d+(?:\.\d+)?)$`)

// --- Player blinded ---
var blindedRe = regexp.MustCompile(`^"(?P<vname>[^"<]+)<\d+><(?P<vsteam>[^>]*)><(?P<vteam>[^>]+)>"\s+blinded\s+for\s+(?P<dur>\d+(?:\.\d+)?)\s+by\s+"(?P<aname>[^"<]+)<\d+><(?P<asteam>[^>]*)><(?P<ateam>[^>]+)>"\s+from\s+(?P<nade>flashbang)\s+entindex\s+(?P<ent>\d+)$`)

// --- Freeze time started ---
var freezeStartRe = regexp.MustCompile(`(?i)^Starting\s+(?:pre-?round\s+)?Freeze\s+period(?:\b.*)?$`)

// Helpers extraction par nom de groupe
func grp(re *regexp.Regexp, line, name string) string {
	idx := re.SubexpIndex(name)
	if idx < 0 {
		return ""
	}
	m := re.FindStringSubmatch(line)
	if m == nil {
		return ""
	}
	return m[idx]
}

var cmdPrefixes = []string{"!", "/"}

// NEW: petit tampon pour réordonner spawned→threw
type queued struct {
	typ     string
	payload json.RawMessage
}

var deferred []queued

type pend struct {
	payload json.RawMessage
	seenAt  time.Time
}

var pendingSpawnByType = map[string]pend{}
var ignoreNextWorldSuicide = map[string]time.Time{}

const pendingTTL = 2 * time.Second // ajuste si besoin

// Event is one game event parsed from a log line.
type Event struct {
	Type    string
	Payload json.RawMessage
}

// Parse returns every event produced by a log line, in order: grenade "landed" events whose
// "threw" never came (expired), then the line's own event, then the events it released
// (a "threw" releases its pending "spawned" as landed, right after the throw).
//
// It replaces TryParse's one-event-per-line contract: releasing a deferred event used to
// return early and silently DROP the current line (e.g. the kill right after a molotov throw).
func Parse(line string) []Event {
	var out []Event
	for nade, p := range pendingSpawnByType {
		if time.Since(p.seenAt) > pendingTTL {
			delete(pendingSpawnByType, nade)
			out = append(out, Event{Type: events.EvNadeLanded, Payload: p.payload})
		}
	}
	if typ, payload, ok := parseLine(line); ok {
		out = append(out, Event{Type: typ, Payload: payload})
	}
	for _, q := range deferred {
		out = append(out, Event{Type: q.typ, Payload: q.payload})
	}
	deferred = deferred[:0]
	return out
}

// parseLine parses a single line into at most one event (it may queue a deferred one).
func parseLine(line string) (string, json.RawMessage, bool) {
	line = StripCs2Prefix(strings.TrimSpace(line))

	// CHAT (et éventuellement COMMAND)
	if chatRe.MatchString(line) {
		name := grp(chatRe, line, "name")
		steam := grp(chatRe, line, "steam")
		team := events.NormTeam(grp(chatRe, line, "team"))
		channel := grp(chatRe, line, "channel")
		msg := grp(chatRe, line, "msg")

		// a) COMMAND si préfixe + whitelist
		if isCommand(msg) {
			cmd, params := splitCommand(msg)
			payload := events.CommandPayload{
				Command:    cmd,
				Parameters: params,
			}
			payload.Sender.Name = name
			payload.Sender.SteamID = steam
			payload.Sender.Team = mapTeamForCommand(team)
			payload.Sender.Channel = channel
			raw, _ := json.Marshal(payload)

			return events.EvCommand, raw, true
		}

		// b) CHAT normal
		var userID *int
		payload := events.ChatPayload{
			Channel: channel,
			Message: msg,
		}
		payload.Player.Name = name
		payload.Player.UserID = userID
		payload.Player.SteamID = steam
		payload.Player.Team = team

		raw, _ := json.Marshal(payload)
		return events.EvChatMessage, raw, true
	}

	if killRe.MatchString(line) {
		killer := grp(killRe, line, "killer")
		ksteam := grp(killRe, line, "ksteam")
		kteam := events.NormTeam(grp(killRe, line, "kteam"))
		victim := grp(killRe, line, "victim")
		vsteam := grp(killRe, line, "vsteam")
		vteam := events.NormTeam(grp(killRe, line, "vteam"))
		weapon := grp(killRe, line, "weapon")
		tags := strings.ToLower(grp(killRe, line, "tags"))

		hs := strings.Contains(tags, "headshot")
		tk := strings.Contains(tags, "friendlyfire") || (kteam != "" && kteam == vteam && (kteam == "CT" || kteam == "T"))
		penetrated := strings.Contains(tags, "penetrated")
		noscope := strings.Contains(tags, "noscope")
		throughsmoke := strings.Contains(tags, "throughsmoke")
		blind := strings.Contains(tags, "attackerblind")
		inair := strings.Contains(tags, "attackerinair")

		kx, ky, kz := parseXYZBracket(grp(killRe, line, "kpos"))
		vx, vy, vz := parseXYZBracket(grp(killRe, line, "vpos"))

		payload := map[string]any{
			"kind":      "player",
			"killer":    map[string]any{"name": killer, "steamId": ksteam, "team": kteam},
			"victim":    map[string]any{"name": victim, "steamId": vsteam, "team": vteam},
			"weapon":    weapon,
			"headshot":  hs,
			"killerPos": map[string]float64{"x": kx, "y": ky, "z": kz},
			"victimPos": map[string]float64{"x": vx, "y": vy, "z": vz},
		}
		if tk {
			payload["teamkill"] = true
		}
		if penetrated {
			payload["penetrated"] = true
		}
		if noscope {
			payload["noscope"] = true
		}
		if throughsmoke {
			payload["throughsmoke"] = true
		}
		if blind {
			payload["attackerblind"] = true
		}
		if inair {
			payload["attackerinair"] = true
		}
		return events.EvKill, mustJSON(payload), true
	}

	if assistRe.MatchString(line) {
		player := grp(assistRe, line, "player")
		steam := grp(assistRe, line, "steam")
		team := events.NormTeam(grp(assistRe, line, "team"))
		victim := grp(assistRe, line, "victim")
		vsteam := grp(assistRe, line, "vsteam")
		vteam := events.NormTeam(grp(assistRe, line, "vteam"))
		flash := grp(assistRe, line, "flash") != ""

		payload := map[string]any{
			"player":      map[string]any{"name": player, "steamId": steam, "team": team},
			"victim":      map[string]any{"name": victim, "steamId": vsteam, "team": vteam},
			"flashAssist": flash,
		}
		return events.EvAssist, mustJSON(payload), true
	}

	// Bomb death: CS2 logs `was killed by the bomb.` then `committed suicide with "world"`.
	// CS2 (round_stats) counts ONE death: emit it here and skip the twin line.
	// (mirrored by parseCs2LineFallback in backend sandbox.service.ts)
	if killedByBombRe.MatchString(line) {
		player := grp(killedByBombRe, line, "player")
		steam := grp(killedByBombRe, line, "psteam")
		team := events.NormTeam(grp(killedByBombRe, line, "pteam"))
		if steam != "" {
			ignoreNextWorldSuicide[steam] = time.Now().Add(2 * time.Second)
		}
		vx, vy, vz := parseXYZBracket(grp(killedByBombRe, line, "pos"))
		payload := map[string]any{
			"kind":      "suicide",
			"player":    map[string]any{"name": player, "steamId": steam, "team": team},
			"weapon":    "bomb",
			"victimPos": map[string]float64{"x": vx, "y": vy, "z": vz},
		}
		return events.EvKill, mustJSON(payload), true
	}

	if suicideRe.MatchString(line) {
		player := grp(suicideRe, line, "player")
		steam := grp(suicideRe, line, "psteam")
		team := events.NormTeam(grp(suicideRe, line, "pteam"))
		weapon := grp(suicideRe, line, "weapon")
		if strings.EqualFold(weapon, "world") && steam != "" {
			if until, ok := ignoreNextWorldSuicide[steam]; ok {
				delete(ignoreNextWorldSuicide, steam)
				if time.Now().Before(until) {
					return "", nil, false
				}
			}
		}
		vx, vy, vz := parseXYZBracket(grp(suicideRe, line, "pos"))

		payload := map[string]any{
			"kind":      "suicide",
			"player":    map[string]any{"name": player, "steamId": steam, "team": team},
			"weapon":    weapon,
			"victimPos": map[string]float64{"x": vx, "y": vy, "z": vz},
		}
		return events.EvKill, mustJSON(payload), true
	}

	if gameOverRe.MatchString(line) {
		ct, _ := strconv.Atoi(grp(gameOverRe, line, "ct"))
		t, _ := strconv.Atoi(grp(gameOverRe, line, "t"))
		minutes, _ := strconv.Atoi(grp(gameOverRe, line, "min"))
		return events.EvGameOver, mustJSON(map[string]any{
			"mode": grp(gameOverRe, line, "mode"), "map": grp(gameOverRe, line, "map"),
			"scoreCT": ct, "scoreT": t, "minutes": minutes,
		}), true
	}

	if matchStartRe.MatchString(line) {
		ignoreNextWorldSuicide = map[string]time.Time{}
		m := grp(matchStartRe, line, "map")
		payload := map[string]any{}
		if m != "" {
			payload["map"] = m
		}
		return events.EvMatchStart, mustJSON(payload), true
	}

	// Map & match lifecycle (ignore, not a kill)
	if mapLifecycleRe.MatchString(line) {
		return "", nil, false
	}

	// ROUND_START
	if roundStartRe.MatchString(line) {
		ignoreNextWorldSuicide = map[string]time.Time{}
		return events.EvRoundStart, mustJSON(map[string]any{}), true
	}

	// ROUND_END
	if roundEndRe.MatchString(line) {
		return events.EvRoundEnd, mustJSON(map[string]any{}), true
	}

	// TEAM_ROUND_WIN + SFUI_TARGET_BOMBED / ROUND_DRAW
	if teamWinRe.MatchString(line) {
		winner := grp(teamWinRe, line, "winner")
		sfui := strings.ToLower(grp(teamWinRe, line, "sfui"))
		ctStr := grp(teamWinRe, line, "ct")
		tStr := grp(teamWinRe, line, "t")

		reason := "elim"
		switch {
		case strings.Contains(sfui, "target_bombed"):
			reason = "bomb_exploded"
		case strings.Contains(sfui, "target_saved"), strings.Contains(sfui, "bomb_defused"):
			reason = "defused"
		case strings.Contains(sfui, "wipe"), strings.Contains(sfui, "elimination"), strings.Contains(sfui, "win"):
			reason = "elim"
		case strings.Contains(sfui, "round_timed_out"):
			reason = "time"
		case strings.Contains(sfui, "round_draw"):
			reason = "draw"
		}
		mappedWinner := mapWinner(winner)
		if winner == "" && strings.Contains(sfui, "draw") {
			mappedWinner = "none"
		}
		payload := map[string]any{"winner": mappedWinner, "reason": reason}
		if ctStr != "" && tStr != "" {
			ctScore, _ := strconv.Atoi(ctStr)
			tScore, _ := strconv.Atoi(tStr)
			payload["score"] = map[string]int{"ct": ctScore, "t": tScore}
		}
		return events.EvTeamRoundWin, mustJSON(payload), true
	}

	// BOMB_PLANTED
	if bombPlantedRe.MatchString(line) {
		planter := grp(bombPlantedRe, line, "planter")
		steam := grp(bombPlantedRe, line, "psteam")
		team := grp(bombPlantedRe, line, "pteam")
		site := grp(bombPlantedRe, line, "site")
		p := map[string]any{}
		if planter != "" {
			p["planter"] = map[string]any{"name": planter, "steamId": steam, "team": team}
		}
		if site == "A" || site == "B" {
			p["site"] = site
		}
		return events.EvBombPlanted, mustJSON(p), true
	}

	// BOMB_DEFUSED
	if bombDefusedRe.MatchString(line) {
		defuser := grp(bombDefusedRe, line, "defuser")
		steam := grp(bombDefusedRe, line, "dsteam")
		team := grp(bombDefusedRe, line, "dteam")
		p := map[string]any{}
		if defuser != "" {
			p["defuser"] = map[string]any{"name": defuser, "steamId": steam, "team": team}
		}
		return events.EvBombDefused, mustJSON(p), true
	}

	// MATCH_PAUSED / MATCH_UNPAUSED
	if pauseRe.MatchString(line) {
		return events.EvMatchPaused, mustJSON(map[string]any{}), true
	}
	if unpauseRe.MatchString(line) {
		return events.EvMatchUnpaused, mustJSON(map[string]any{}), true
	}

	// DEFUSE_BEGIN / DEFUSE_ABORT
	if defuseBeginRe.MatchString(line) {
		name := grp(defuseBeginRe, line, "name")
		steam := grp(defuseBeginRe, line, "steam")
		team := grp(defuseBeginRe, line, "team")
		hasKit := strings.Contains(line, "Begin_Bomb_Defuse_With_Kit")
		payload := map[string]any{
			"player": map[string]any{"name": name, "steamId": steam, "team": team},
			"hasKit": hasKit,
		}
		return events.EvDefuseBegin, mustJSON(payload), true
	}
	if defuseAbortRe.MatchString(line) {
		name := grp(defuseAbortRe, line, "name")
		steam := grp(defuseAbortRe, line, "steam")
		team := grp(defuseAbortRe, line, "team")
		payload := map[string]any{
			"player": map[string]any{"name": name, "steamId": steam, "team": team},
		}
		return events.EvDefuseAbort, mustJSON(payload), true
	}

	// PLAYER_CONNECTED / PLAYER_DISCONNECTED / NAME_CHANGE
	if playerConnectRe.MatchString(line) {
		name := grp(playerConnectRe, line, "name")
		steam := grp(playerConnectRe, line, "steam")
		team := grp(playerConnectRe, line, "team")
		payload := map[string]any{
			"player": map[string]any{"name": name, "steamId": steam, "team": events.NormTeam(team)},
		}
		return events.EvPlayerConnected, mustJSON(payload), true
	}
	if playerDisconnectRe.MatchString(line) {
		name := grp(playerDisconnectRe, line, "name")
		steam := grp(playerDisconnectRe, line, "steam")
		reason := grp(playerDisconnectRe, line, "reason")
		// The `committed suicide with "world"` that follows a disconnect IS a death for CS2 (round_stats):
		// it is no longer skipped.
		payload := map[string]any{
			"player": map[string]any{"name": name, "steamId": steam},
		}
		if reason != "" {
			payload["reason"] = reason
		}
		return events.EvPlayerDisc, mustJSON(payload), true
	}
	if nameChangeRe.MatchString(line) {
		old := grp(nameChangeRe, line, "old")
		steam := grp(nameChangeRe, line, "steam")
		newn := grp(nameChangeRe, line, "new")
		payload := map[string]any{
			"steamId": steam, "oldName": old, "newName": newn,
		}
		return events.EvPlayerNameChange, mustJSON(payload), true
	}

	// ITEM PURCHASE
	if purchaseRe.MatchString(line) {
		name := grp(purchaseRe, line, "name")
		steam := grp(purchaseRe, line, "steam")
		team := events.NormTeam(grp(purchaseRe, line, "team"))
		weap := grp(purchaseRe, line, "weapon")
		payload := map[string]any{
			"player": map[string]any{"name": name, "steamId": steam, "team": team},
			"weapon": weap,
		}
		return events.EvItemPurchase, mustJSON(payload), true
	}

	// BEGIN / ABORT BOMB PLANT
	if beginPlantRe.MatchString(line) {
		name := grp(beginPlantRe, line, "name")
		steam := grp(beginPlantRe, line, "steam")
		team := grp(beginPlantRe, line, "team")
		site := grp(beginPlantRe, line, "site")
		p := map[string]any{
			"player": map[string]any{"name": name, "steamId": steam, "team": team},
			"site":   site,
		}
		return events.EvBeginBombPlant, mustJSON(p), true
	}

	// sv_throw_<type> ... → on ignore (évite doublons)
	if nadeThrowRe.MatchString(line) {
		return "", nil, false
	}

	// "... threw <type> [x y z]" (+ entindex optionnel)
	if nadeThrewRe.MatchString(line) {
		name := grp(nadeThrewRe, line, "name")
		steam := grp(nadeThrewRe, line, "steam")
		team := events.NormTeam(grp(nadeThrewRe, line, "team"))
		nade := grp(nadeThrewRe, line, "nade")
		pos := grp(nadeThrewRe, line, "pos")
		ent := grp(nadeThrewRe, line, "ent")
		x, y, z := parseXYZBracket(pos)
		payload := map[string]any{
			"player":  map[string]any{"name": name, "steamId": steam, "team": team},
			"grenade": nade,
			"origin":  map[string]float64{"x": x, "y": y, "z": z},
		}
		if ent != "" {
			payload["entindex"] = ent
		}

		// Un spawned récent pour ce type est émis comme landed juste après le throw (cf. Parse)
		if p, ok := pendingSpawnByType[strings.ToLower(nade)]; ok && time.Since(p.seenAt) <= pendingTTL {
			deferred = append(deferred, queued{typ: events.EvNadeLanded, payload: p.payload})
			delete(pendingSpawnByType, strings.ToLower(nade))
		}
		return events.EvGrenadeThrow, mustJSON(payload), true
	}

	if nadeSpawnedRe.MatchString(line) {
		n := strings.ToLower(grp(nadeSpawnedRe, line, "nade")) // e.g. "molotov"
		x := grp(nadeSpawnedRe, line, "x")
		y := grp(nadeSpawnedRe, line, "y")
		z := grp(nadeSpawnedRe, line, "z")
		vx := grp(nadeSpawnedRe, line, "vx")
		vy := grp(nadeSpawnedRe, line, "vy")
		vz := grp(nadeSpawnedRe, line, "vz")

		xf, _ := strconv.ParseFloat(x, 64)
		yf, _ := strconv.ParseFloat(y, 64)
		zf, _ := strconv.ParseFloat(z, 64)
		vxf, _ := strconv.ParseFloat(vx, 64)
		vyf, _ := strconv.ParseFloat(vy, 64)
		vzf, _ := strconv.ParseFloat(vz, 64)

		payload := map[string]any{
			"grenade":  n, // "molotov" | "flashbang" | "smokegrenade" | "hegrenade" | "incgrenade" | "decoy"
			"position": map[string]float64{"x": xf, "y": yf, "z": zf},
			"velocity": map[string]float64{"x": vxf, "y": vyf, "z": vzf},
		}

		// NEW: on met en attente et on n'émet pas tout de suite (ordre throw → landed garanti)
		pendingSpawnByType[n] = pend{payload: mustJSON(payload), seenAt: time.Now()}
		return "", nil, false
	}

	// FLASH blinded … entindex N → EvPlayerBlinded (pas "landed")
	if blindedRe.MatchString(line) {
		vname := grp(blindedRe, line, "vname")
		vsteam := grp(blindedRe, line, "vsteam")
		vteam := events.NormTeam(grp(blindedRe, line, "vteam"))
		dur := grp(blindedRe, line, "dur")
		aname := grp(blindedRe, line, "aname")
		asteam := grp(blindedRe, line, "asteam")
		ateam := events.NormTeam(grp(blindedRe, line, "ateam"))
		ent := grp(blindedRe, line, "ent")

		payload := map[string]any{
			"victim":   map[string]any{"name": vname, "steamId": vsteam, "team": vteam},
			"attacker": map[string]any{"name": aname, "steamId": asteam, "team": ateam},
			"grenade":  "flashbang",
			"duration": dur,
			"entindex": ent,
		}
		return events.EvPlayerBlinded, mustJSON(payload), true
	}

	if freezeStartRe.MatchString(line) {
		return events.EvRoundFreezeStart, mustJSON(map[string]any{}), true
	}
	// pas de match → aucun event
	return "", nil, false
}

func isCommand(msg string) bool {
	m := strings.TrimSpace(msg)
	for _, p := range cmdPrefixes {
		if strings.HasPrefix(m, p) {
			return true
		}
	}
	return false
}

func splitCommand(msg string) (string, []string) {
	m := strings.TrimSpace(msg)
	for _, p := range cmdPrefixes {
		if strings.HasPrefix(m, p) {
			m = strings.TrimSpace(m[len(p):])
			break
		}
	}
	parts := strings.Fields(m)
	if len(parts) == 0 {
		return "", nil
	}
	return strings.ToLower(parts[0]), parts[1:]
}

func mapTeamForCommand(team string) string {
	switch strings.ToUpper(team) {
	case "CT":
		return "CT"
	case "TERRORIST":
		return "T"
	case "SPECTATOR":
		return "SPECTATOR"
	default:
		return "Unassigned"
	}
}

// --- helpers locaux manquants ---

func mustJSON(v any) json.RawMessage {
	b, _ := json.Marshal(v)
	return b
}

func mapWinner(csTeam string) string {
	if strings.EqualFold(csTeam, "CT") {
		return "CT"
	}
	return "T"
}

func parseFirst3Floats(s string) (float64, float64, float64) {
	f := func(tok string) float64 {
		if tok == "" {
			return 0
		}
		if v, err := strconv.ParseFloat(tok, 64); err == nil {
			return v
		}
		return 0
	}
	parts := strings.Fields(s)
	if len(parts) < 3 {
		return 0, 0, 0
	}
	return f(parts[0]), f(parts[1]), f(parts[2])
}

func parseXYZBracket(s string) (float64, float64, float64) {
	return parseFirst3Floats(s)
}
