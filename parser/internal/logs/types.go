package logs

type ChatMsg struct {
	SteamID string
	Name    string
	Text    string
	Team    string // "T" | "CT" | "Spec" | ""
}

type KillEvt struct {
	KillerSteam string
	VictimSteam string
	Weapon      string
	HS          bool
}

type RoundEvt struct {
	Number  int
	Winner  string // "T" | "CT"
	Reason  string
}
