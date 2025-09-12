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
var tsPrefix = regexp.MustCompile(`^(?:L\s+)?\d{2}/\d{2}/\d{4}\s*-\s*\d{2}:\d{2}:\d{2}(?:\.\d{3})?\s*[-:]\s*`)

func StripCs2Prefix(line string) string {
	return tsPrefix.ReplaceAllString(line, "")
}

// --- Regex (miroirs de ton TS) ---
var chatRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<(?P<uid>\d+)><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>[^>]+)>"\s+(?P<channel>say|say_team)\s+"(?P<msg>.*)"$`)

// --- Kills & players ---
var worldRe = regexp.MustCompile(`^World triggered "(?P<cause>[^"]+)" on "(?P<victim>[^"]+)"`)

// --- Round / bomb / team win ---
var roundStartRe = regexp.MustCompile(`^World triggered "Round_Start"`)
var teamWinRe = regexp.MustCompile(`^Team "(?P<winner>TERRORIST|CT)" triggered "(?P<sfui>SFUI_Notice_[A-Za-z_]+)"`)
var bombPlantedRe = regexp.MustCompile(`^"(?P<planter>[^"<]+)<\d+><(?P<psteam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<pteam>CT|TERRORIST)>" triggered "Planted_The_Bomb"(?: \(Site (?P<site>[AB])\))?`)

// --- Pause / unpause ---
var pauseRe = regexp.MustCompile(`^(?:(?:Match\s+Paused)|(?:Game\s+Paused)|(?:server_cvar:\s*mp_pause_match))`)
var unpauseRe = regexp.MustCompile(`^(?:(?:Match\s+Unpaused)|(?:Game\s+Unpaused))`)

// --- Defuse begin/abort ---
var defuseBeginRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>CT|TERRORIST)>"\s+triggered\s+"Begin_Bomb_Defuse(?:_With_Kit)?"`)
var defuseAbortRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>CT|TERRORIST)>"\s+triggered\s+"Aborted_Bomb_Defuse"`)

// --- Player connect/disconnect/name change ---
var playerConnectRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>[^>]+)>"\s+connected`)
var playerDisconnectRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>[^>]+)>"\s+disconnected(?:\s+\((?P<reason>[^)]+)\))?`)
var nameChangeRe = regexp.MustCompile(`^"(?P<old>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><[^>]*>"\s+changed\s+name\s+to\s+"(?P<new>[^"]+)"`)

// --- Purchases ---
var purchaseRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>[^>]+)>"\s+purchased\s+"(?P<weapon>[^"]+)"`)

// --- Grenade throws ---
var nadeLandRe = regexp.MustCompile(`^"(?P<name>[^"<]+)<\d+><(?P<steam>\[U:[^]]+\]|\w+:[^>]+|)><(?P<team>[^>]+)>"\s+threw\s+(?P<nade>flashbang|smokegrenade|hegrenade|molotov|incgrenade|decoy)(?:\s|$)`)

// --- Kills & Suicides ---
var killRe = regexp.MustCompile(`^"(?P<killer>[^"<]+)<\d+><(?P<ksteam>[^>]*)><(?P<kteam>[^>]+)>"(?:\s+\[(?P<kpos>[-\d\s]+)\])?\s+killed\s+"(?P<victim>[^"<]+)<\d+><(?P<vsteam>[^>]*)><(?P<vteam>[^>]+)>"(?:\s+\[(?P<vpos>[-\d\s]+)\])?\s+with\s+"(?P<weapon>[^"]+)"(?P<tags>.*)$`)
var suicideRe = regexp.MustCompile(`^"(?P<player>[^"<]+)<\d+><(?P<psteam>[^>]*)><(?P<pteam>[^>]+)>"(?:\s+\[(?P<pos>[-\d\s]+)\])?\s+committed\s+suicide\s+with\s+"(?P<weapon>[^"]+)"$`)

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

// Commandes autorisées
var allowed = map[string]struct{}{
	"init": {}, "pause": {}, "unpause": {}, "tech": {}, "tac": {}, "start": {}, "knife": {},
	"stop": {}, "ready": {}, "unready": {}, "timeout": {}, "restart": {},
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

const pendingTTL = 2 * time.Second // ajuste si besoin

// TryParse retourne (type, payloadJSON, ok)
func TryParse(line string) (string, json.RawMessage, bool) {
	line = StripCs2Prefix(strings.TrimSpace(line))

	// NEW: si on a un event différé à sortir, on le renvoie *avant* de parser la nouvelle ligne
	if len(deferred) > 0 {
		ev := deferred[0]
		deferred = deferred[1:]
		return ev.typ, ev.payload, true
	}
	// NEW: on émet un landed expiré si son "threw" n'est jamais venu
	for nade, p := range pendingSpawnByType {
		if time.Since(p.seenAt) > pendingTTL {
			delete(pendingSpawnByType, nade)
			return events.EvNadeLanded, p.payload, true
		}
	}

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
			if _, ok := allowed[cmd]; ok {
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
		tk := strings.Contains(tags, "friendlyfire")

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
		return events.EvKill, mustJSON(payload), true
	}

	if suicideRe.MatchString(line) {
		player := grp(suicideRe, line, "player")
		steam := grp(suicideRe, line, "psteam")
		team := events.NormTeam(grp(suicideRe, line, "pteam"))
		weapon := grp(suicideRe, line, "weapon")
		vx, vy, vz := parseXYZBracket(grp(suicideRe, line, "pos"))

		payload := map[string]any{
			"kind":      "suicide",
			"player":    map[string]any{"name": player, "steamId": steam, "team": team},
			"weapon":    weapon,
			"victimPos": map[string]float64{"x": vx, "y": vy, "z": vz},
		}
		return events.EvKill, mustJSON(payload), true
	}

	// WORLD kill (rare)
	if worldRe.MatchString(line) {
		cause := grp(worldRe, line, "cause")
		victim := grp(worldRe, line, "victim")
		payload := map[string]any{
			"kind":   "world",
			"victim": map[string]any{"name": victim, "steamId": "", "team": "Unassigned"},
			"cause":  cause,
		}
		return events.EvKill, mustJSON(payload), true
	}

	// ROUND_START
	if roundStartRe.MatchString(line) {
		return events.EvRoundStart, mustJSON(map[string]any{}), true
	}

	// TEAM_ROUND_WIN + SFUI_TARGET_BOMBED
	if teamWinRe.MatchString(line) {
		winner := grp(teamWinRe, line, "winner")
		sfui := strings.ToLower(grp(teamWinRe, line, "sfui"))

		if strings.Contains(sfui, "target_bombed") {
			return events.EvSfuiTargetBombed, mustJSON(map[string]any{
				"winner": mapWinner(winner),
			}), true
		}

		reason := "elim"
		switch {
		case strings.Contains(sfui, "target_bombed"):
			reason = "bomb_exploded"
		case strings.Contains(sfui, "target_saved"), strings.Contains(sfui, "bomb_defused"):
			reason = "defused"
		case strings.Contains(sfui, "wipe"), strings.Contains(sfui, "elimination"):
			reason = "elim"
		case strings.Contains(sfui, "round_timed_out"), strings.Contains(sfui, "round_draw"):
			reason = "time"
		}
		payload := map[string]any{"winner": mapWinner(winner), "reason": reason}
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

		// NEW: si on a un spawned récent pour ce type, on le déferre pour la prochaine ligne
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
