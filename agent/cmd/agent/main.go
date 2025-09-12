package main

// Agent (single-server) for GGBot/eBot++
// - Serves local HTTP /logs for CS2 `logaddress_add_http`
// - Batches & forwards logs to backend via POST (NDJSON)
// - Subscribes to Redis actions channel (ggbot:agent:<serverId>:actions)
// - Executes RCON sequentially with reconnect/backoff
// - Publishes heartbeat to Redis key (ggbot:agent:<serverId>:state) with TTL
//
// Build: go build -o agentd ./cmd/agent
// Requires go modules:
//   github.com/redis/go-redis/v9
//
// Run example:
//   ./agentd -config /etc/ggbot/agents.d/srv-a.yaml -serverId srv-a

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	// ...
	"ggbot/internal/parser"

	"ggbot/internal/execfg"
	myrcon "ggbot/internal/rcon"

	redis "github.com/redis/go-redis/v9"
	"gopkg.in/yaml.v3"
)

// ---- Types (actions, config, heartbeat)

type AgentAction struct {
	Type     string `json:"type"`
	ServerID string `json:"serverId"`
	Action   string `json:"action"`
	Payload  struct {
		MatchID     string            `json:"matchId"`
		TeamLogical string            `json:"teamLogical"`
		TeamSide    string            `json:"teamSide"`
		Seconds     int               `json:"seconds,omitempty"`
		Message     string            `json:"text,omitempty"`
		Map         string            `json:"map,omitempty"`
		Name        string            `json:"name,omitempty"`
		Vars        map[string]string `json:"vars,omitempty"` // ex: {"roundtime":"60"}
	} `json:"payload"`
	TS int64 `json:"ts"`
}

type AgentConfig struct {
	Version  int    `yaml:"version"`
	ServerID string `yaml:"serverId"`

	CS2 struct {
		Addr         string `yaml:"addr"` // host ou host:port (ex: 172.21.192.1 ou 172.21.192.1:27015)
		Port         int    `yaml:"port"` // si addr n'a pas de port, on utilise celui-ci
		RconPassword string `yaml:"rconPassword"`
		Rcon         struct {
			ConnectTimeoutMs int `yaml:"connectTimeoutMs"`
			CommandTimeoutMs int `yaml:"commandTimeoutMs"`
			RateLimitPerSec  int `yaml:"rateLimitPerSec"`
		} `yaml:"rcon"`
	} `yaml:"cs2"`

	// Inchangé
	Logs struct {
		Bind           string `yaml:"bind"`
		Token          string `yaml:"token"`
		BackendPostURL string `yaml:"backendPostUrl"`
		Batch          struct {
			MaxLines   int `yaml:"maxLines"`
			MaxDelayMs int `yaml:"maxDelayMs"`
			MaxBytes   int `yaml:"maxBytes"`
		} `yaml:"batch"`
		Retry struct {
			BaseMs         int  `yaml:"baseMs"`
			MaxMs          int  `yaml:"maxMs"`
			Jitter         bool `yaml:"jitter"`
			MaxBufferLines int  `yaml:"maxBufferLines"`
		} `yaml:"retry"`
	} `yaml:"logs"`

	// Inchangé
	Redis struct {
		URL            string `yaml:"url"`
		ActionsChannel string `yaml:"actionsChannel"`
		StateKey       string `yaml:"stateKey"`
		StateTtlSec    int    `yaml:"stateTtlSec"`
	} `yaml:"redis"`

	// Optionnel (si tu veux déjà poser GOTV avec port distinct)
	CSTV struct {
		Enabled  bool   `yaml:"enabled"`
		Host     string `yaml:"host"`     // vide = hérite de cs2.addr host
		Port     int    `yaml:"port"`     // vide = défaut cs2.port+5
		Password string `yaml:"password"` // tv_password si besoin
	} `yaml:"cstv"`
}

type heartbeat struct {
	TS   int64 `json:"ts"`
	RCON struct {
		Connected bool   `json:"connected"`
		Addr      string `json:"addr"`
	} `json:"rcon"`
	Logs struct {
		Bind    string `json:"bind"`
		OK      bool   `json:"ok"`
		Queue   int64  `json:"queue"`
		Dropped int64  `json:"dropped"`
	} `json:"logs"`
	CurrentMatchID string `json:"currentMatchId,omitempty"`
}

// Enveloppe bus publiée sur ggbot:events
type busEvent struct {
	V         int             `json:"v,omitempty"`
	ID        string          `json:"id,omitempty"`
	Timestamp int64           `json:"timestamp"`
	Type      string          `json:"type"`
	MatchID   string          `json:"matchId,omitempty"`
	ServerID  string          `json:"serverId"`
	Source    string          `json:"source,omitempty"` // "agent"
	Kind      string          `json:"kind,omitempty"`   // "primary"
	Payload   json.RawMessage `json:"payload"`
}

// ---- Globals (state)

var (
	flConfig   = flag.String("config", "./agents.d/srv-a.yaml", "Path to agent YAML file")
	flServerID = flag.String("serverId", "", "Server ID for this agent (overrides YAML)")
)

// log buffers
var (
	logQueue      = make(chan string, 10000)
	droppedLogs   int64
	logHTTPServer *http.Server
)

// rcon executor
var (
	rconMu   sync.Mutex
	rconCli  *myrcon.Client
	rconAddr string
)

func main() {
	flag.Parse()
	setLogFlags()

	// Load YAML
	b, err := os.ReadFile(*flConfig)
	if err != nil {
		log.Fatalf("read config: %v", err)
	}
	var cfg AgentConfig
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		log.Fatalf("yaml: %v", err)
	}
	if *flServerID != "" {
		cfg.ServerID = *flServerID
	}
	if cfg.ServerID == "" {
		log.Fatal("serverId required (flag or YAML)")
	}

	normalizeCS2(&cfg)

	// 🔎 DEBUG config normalisée
	log.Printf("[agent:%s] cfg: cs2.addr=%s (rconPwd? %t) logs.bind=%s backendPostURL=%s redis.url=%s actionsCh=%s stateKey=%s stateTTL=%ds cstv=%v:%d enabled=%t",
		cfg.ServerID, cfg.CS2.Addr, cfg.CS2.RconPassword != "",
		cfg.Logs.Bind, cfg.Logs.BackendPostURL, cfg.Redis.URL, cfg.Redis.ActionsChannel, cfg.Redis.StateKey, cfg.Redis.StateTtlSec,
		cfg.CSTV.Host, cfg.CSTV.Port, cfg.CSTV.Enabled)

	if strings.TrimSpace(cfg.CS2.Addr) == "" {
		log.Fatal("cs2.addr (ou host+port) requis")
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Redis client
	rdb, err := openRedis(cfg.Redis.URL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer rdb.Close()
	log.Printf("[agent:%s] redis connected: %s", cfg.ServerID, cfg.Redis.URL)

	// Start components
	go runLogsHTTP(ctx, cfg)
	go runEventsPusher(ctx, cfg, rdb) // ✅ nouveau: transforme log→events et XADD en Redis
	go runHeartbeat(ctx, cfg, rdb)
	go runActionsSubscriber(ctx, cfg, rdb)

	// Graceful shutdown
	ch := make(chan os.Signal, 2)
	signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
	<-ch
	log.Printf("[agent:%s] shutting down…", cfg.ServerID)
	cancel()
	if logHTTPServer != nil {
		_ = logHTTPServer.Shutdown(context.Background())
	}
	time.Sleep(200 * time.Millisecond)
}

// ---- Redis helpers

func openRedis(url string) (*redis.Client, error) {
	if strings.TrimSpace(url) == "" {
		return nil, errors.New("empty redis url")
	}
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opt), nil
}

// ---- Logs HTTP (intake)

func runLogsHTTP(ctx context.Context, cfg AgentConfig) {
	mux := http.NewServeMux()
	mux.HandleFunc("/logs", func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()

		// auth token (query or header)
		tok := r.URL.Query().Get("token")
		if tok == "" {
			tok = r.Header.Get("X-Logs-Token")
		}
		if tok == "" || tok != cfg.Logs.Token {
			log.Printf("[agent:%s] /logs 401 (bad token) from %s ct=%s len=%d",
				cfg.ServerID, r.RemoteAddr, r.Header.Get("Content-Type"), r.ContentLength)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		ct := r.Header.Get("Content-Type")
		body, _ := io.ReadAll(r.Body)
		_ = r.Body.Close()

		lines := splitLines(string(body))
		for _, line := range lines {
			select {
			case logQueue <- line:
			default:
				atomic.AddInt64(&droppedLogs, 1)
			}
		}

		log.Printf("[agent:%s] /logs 200 from %s ct=%s bytes=%d lines=%d dur=%s queue=%d dropped=%d",
			cfg.ServerID, r.RemoteAddr, ct, len(body), len(lines), time.Since(start).Truncate(time.Millisecond),
			len(logQueue), atomic.LoadInt64(&droppedLogs))

		w.WriteHeader(http.StatusOK)
	})

	logHTTPServer = &http.Server{Addr: cfg.Logs.Bind, Handler: mux}
	log.Printf("[agent:%s] HTTP logs listening on http://%s/logs", cfg.ServerID, cfg.Logs.Bind)
	if err := logHTTPServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("[agent:%s] logs http error: %v", cfg.ServerID, err)
	}
}

func splitLines(s string) []string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	parts := strings.Split(s, "\n")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// ---- Actions subscriber (Redis) → RCON queue

func runActionsSubscriber(ctx context.Context, cfg AgentConfig, rdb *redis.Client) {
	chName := cfg.Redis.ActionsChannel
	if strings.TrimSpace(chName) == "" {
		log.Printf("[agent:%s] no redis actionsChannel configured — actions disabled", cfg.ServerID)
		return
	}
	sub := rdb.Subscribe(ctx, chName)
	defer sub.Close()
	if _, err := sub.Receive(ctx); err != nil {
		log.Printf("[agent:%s] subscribe error: %v", cfg.ServerID, err)
		return
	}
	msgCh := sub.Channel()
	log.Printf("[agent:%s] subscribed to %s", cfg.ServerID, chName)

	for {
		select {
		case <-ctx.Done():
			return
		case m, ok := <-msgCh:
			if !ok {
				log.Printf("[agent:%s] subscribe channel closed", cfg.ServerID)
				return
			}
			log.Printf("[agent:%s] RX action raw: %s", cfg.ServerID, m.Payload)

			var act AgentAction
			if err := json.Unmarshal([]byte(m.Payload), &act); err != nil {
				log.Printf("[agent:%s] invalid action json: %v", cfg.ServerID, err)
				continue
			}
			if act.ServerID != "" && !strings.EqualFold(act.ServerID, cfg.ServerID) {
				log.Printf("[agent:%s] skip action for another serverId=%s", cfg.ServerID, act.ServerID)
				continue
			}
			if err := execAction(ctx, cfg, &act); err != nil {
				log.Printf("[agent:%s] action %s error: %v", cfg.ServerID, act.Action, err)
			} else {
				log.Printf("[agent:%s] action %s OK", cfg.ServerID, act.Action)
			}
		}
	}
}
func execAction(ctx context.Context, cfg AgentConfig, act *AgentAction) error {
	log.Printf("[agent:%s] exec action=%s match=%s payload=%+v", cfg.ServerID, act.Action, act.Payload.MatchID, act.Payload)

	switch act.Action {
	case "tac_timeout", "tech_timeout":
		out, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
			log.Printf("[agent:%s] RCON PauseMatch()", cfg.ServerID)
			return c.PauseMatch(ctx)
		})
		log.Printf("[agent:%s] RCON PauseMatch -> %q err=%v", cfg.ServerID, out, err)
		return err

	case "unpause":
		out, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
			log.Printf("[agent:%s] RCON UnpauseMatch()", cfg.ServerID)
			return c.UnpauseMatch(ctx)
		})
		log.Printf("[agent:%s] RCON UnpauseMatch -> %q err=%v", cfg.ServerID, out, err)
		return err

	case "say":
		msg := strings.TrimSpace(act.Payload.Message)
		if msg == "" {
			return fmt.Errorf("say: payload.text missing")
		}
		out, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
			log.Printf("[agent:%s] RCON Say(%q)", cfg.ServerID, msg)
			return c.Say(ctx, msg)
		})
		log.Printf("[agent:%s] RCON Say -> %q err=%v", cfg.ServerID, out, err)
		return err

	case "changelevel":
		mp := strings.TrimSpace(act.Payload.Map)
		if mp == "" {
			return fmt.Errorf("changelevel: payload.map missing")
		}
		out, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
			log.Printf("[agent:%s] RCON ChangeLevel(%q)", cfg.ServerID, mp)
			return c.ChangeLevel(ctx, mp)
		})
		log.Printf("[agent:%s] RCON ChangeLevel -> %q err=%v", cfg.ServerID, out, err)
		return err

	case "restart_game", "restart":
		out, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
			log.Printf("[agent:%s] RCON mp_restartgame 1", cfg.ServerID)
			return c.Send(ctx, "mp_restartgame 1")
		})
		log.Printf("[agent:%s] RCON mp_restartgame -> %q err=%v", cfg.ServerID, out, err)
		return err
	case "exec_cfg":
		name := strings.TrimSpace(act.Payload.Name)
		if name == "" {
			// fallback: on autorise aussi d’envoyer le nom dans "text" si besoin
			name = strings.TrimSpace(act.Payload.Message)
		}
		if name == "" {
			return fmt.Errorf("exec_cfg: payload.name manquant")
		}

		base := os.Getenv("CFG_BASE")
		if base == "" {
			base = "/app/cfg" // le volume monté via docker-compose
		}
		resolver := execfg.OSResolver{Base: base}

		f, err := resolver.Open(name)
		if err != nil {
			return fmt.Errorf("exec_cfg: open %q: %w", name, err)
		}
		defer f.Close()

		rcon := &RconAdapter{Cfg: cfg}
		opts := execfg.Options{
			Throttle:         75 * time.Millisecond,
			MaxLines:         1000,
			MaxLineLen:       512,
			AllowChangeLevel: false,
			WhitelistPrefix:  []string{"mp_", "sv_", "tv_", "bot_", "say", "echo"},
			Resolver:         resolver,
			Vars:             act.Payload.Vars, // peut être nil
			Logger: func(format string, args ...any) {
				log.Printf("[agent:%s] execCfg "+format, append([]any{}, args...)...)
			},
		}

		log.Printf("[agent:%s] exec_cfg: %s (base=%s)", cfg.ServerID, name, base)
		if err := execfg.ExecCfg(ctx, rcon, f, opts); err != nil {
			return fmt.Errorf("exec_cfg: %w", err)
		}
		return nil

	default:
		log.Printf("[agent:%s] unknown action: %q (ignored)", cfg.ServerID, act.Action)
		return nil
	}
}

// withRcon maintains a single connection with reconnect/backoff
func withRcon(ctx context.Context, cfg AgentConfig, fn func(context.Context, *myrcon.Client) (string, error)) (string, error) {
	rconMu.Lock()
	defer rconMu.Unlock()

	if rconCli == nil {
		host, port := splitHostPort(cfg.CS2.Addr)
		rconAddr = cfg.CS2.Addr
		log.Printf("[agent:%s] RCON new client host=%s port=%d", cfg.ServerID, host, port)
		rconCli = myrcon.New(myrcon.Config{
			Host:      host,
			Port:      port,
			Password:  cfg.CS2.RconPassword,
			Timeout:   time.Duration(max(500, cfg.CS2.Rcon.CommandTimeoutMs)) * time.Millisecond,
			RateLimit: time.Second / time.Duration(max(1, cfg.CS2.Rcon.RateLimitPerSec)),
		})
	}
	if err := ensureRcon(ctx, rconCli); err != nil {
		log.Printf("[agent:%s] RCON connect error: %v", cfg.ServerID, err)
		return "", err
	}

	out, err := fn(ctx, rconCli)
	if err != nil {
		log.Printf("[agent:%s] RCON cmd error: %v — closing to force reconnect", cfg.ServerID, err)
		_ = rconCli.Close()
		rconCli = nil
	}
	return out, err
}

func ensureRcon(ctx context.Context, c *myrcon.Client) error {
	if c != nil {
		if err := c.Connect(ctx); err == nil {
			return nil
		} else {
			// 1er échec — retente
			time.Sleep(100 * time.Millisecond)
			return c.Connect(ctx)
		}
	}
	return fmt.Errorf("nil rcon client")
}

// ---- Heartbeat publisher

func runHeartbeat(ctx context.Context, cfg AgentConfig, rdb *redis.Client) {
	key := cfg.Redis.StateKey
	if strings.TrimSpace(key) == "" {
		log.Printf("[agent:%s] heartbeat disabled (no stateKey)", cfg.ServerID)
		return
	}
	interval := 3 * time.Second
	if cfg.Redis.StateTtlSec > 0 && cfg.Redis.StateTtlSec < 6 {
		interval = time.Duration(cfg.Redis.StateTtlSec/2) * time.Second
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
			hb := heartbeat{TS: time.Now().Unix()}
			hb.RCON.Connected = rconCli != nil
			hb.RCON.Addr = rconAddr
			hb.Logs.Bind = cfg.Logs.Bind
			hb.Logs.OK = true
			hb.Logs.Queue = int64(len(logQueue))
			hb.Logs.Dropped = atomic.LoadInt64(&droppedLogs)
			b, _ := json.Marshal(&hb)
			_ = rdb.Publish(ctx, "ggbot:events", b).Err() // live

			exp := time.Duration(max(10, cfg.Redis.StateTtlSec)) * time.Second
			if err := rdb.Set(ctx, key, string(b), exp).Err(); err != nil {
				log.Printf("[agent:%s] heartbeat err: %v", cfg.ServerID, err)
			} else {
				log.Printf("[agent:%s] heartbeat -> key=%s ttl=%s value=%s", cfg.ServerID, key, exp, string(b))
			}
		}
	}
}

// ---- Helpers

func setLogFlags() { log.SetFlags(log.LstdFlags | log.Lmicroseconds) }

func splitHostPort(addr string) (string, int) {
	// addr format host:port
	p := strings.Split(addr, ":")
	if len(p) != 2 {
		return addr, 27015
	}
	var port int
	fmt.Sscanf(p[1], "%d", &port)
	return p[0], port
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func normalizeCS2(cfg *AgentConfig) {
	// Déduire host/port depuis cs2.addr (host ou host:port)
	host, port := splitHostPort(cfg.CS2.Addr) // si pas de ":", port = 0
	if port == 0 {
		if cfg.CS2.Port > 0 {
			port = cfg.CS2.Port
		} else {
			port = 27015
		}
	}
	// On fige l'adresse normalisée pour RCON/heartbeat
	cfg.CS2.Addr = fmt.Sprintf("%s:%d", host, port)

	// CSTV : même host par défaut, port = cs2.port + 5 si absent
	if cfg.CSTV.Host == "" {
		cfg.CSTV.Host = host
	}
	if cfg.CSTV.Port == 0 {
		cfg.CSTV.Port = port + 5
	}
}

// ---- Events pusher (parse → Redis Streams) ----

// Stream: ggbot:events_primary:<serverId>
// Champs: v,id,timestamp,source,kind,serverId,matchId,type,payload,(map?,round?,tick?)
func runEventsPusher(ctx context.Context, cfg AgentConfig, rdb *redis.Client) {
	const (
		maxBatch        = 200
		flushEvery      = 50 * time.Millisecond
		maxLen          = 100_000
		refreshMatchTTL = 1 * time.Second
	)

	streamKey := "ggbot:events_primary:" + cfg.ServerID
	pubChan := "ggbot:events"
	serverID := cfg.ServerID

	matchKey := "ggbot:server:" + serverID + ":currentMatch"

	type entry struct {
		streamVals map[string]any
		pubJSON    []byte
	}
	batch := make([]entry, 0, maxBatch)
	ticker := time.NewTicker(flushEvery)
	defer ticker.Stop()

	// --- cache matchId ---
	var cachedMatchID = "unknown"
	var lastFetch time.Time
	resolveMatchID := func() string {
		// refresh au plus toutes les 1s
		if time.Since(lastFetch) < refreshMatchTTL {
			return cachedMatchID
		}
		lastFetch = time.Now()
		mid, err := rdb.Get(ctx, matchKey).Result()
		if err == nil && mid != "" {
			cachedMatchID = mid
			return cachedMatchID
		}
		// en cas d’erreur/clé absente on garde le dernier (ou "unknown")
		return cachedMatchID
	}

	flush := func() {
		if len(batch) == 0 {
			return
		}
		pipe := rdb.Pipeline()
		for _, e := range batch {
			pipe.XAdd(ctx, &redis.XAddArgs{
				Stream: streamKey,
				MaxLen: maxLen, Approx: true,
				Values: e.streamVals,
			})
			pipe.Publish(ctx, pubChan, e.pubJSON)
		}
		if _, err := pipe.Exec(ctx); err != nil {
			log.Printf("[agent:%s] batch flush error: %v", serverID, err)
		} else {
			log.Printf("[agent:%s] XADD+PUBLISH -> stream=%s count=%d", serverID, streamKey, len(batch))
		}
		batch = batch[:0]
	}

	for {
		select {
		case <-ctx.Done():
			flush()
			return

		case <-ticker.C:
			flush()

		case line := <-logQueue:
			if line == "" {
				continue
			}

			if typ, payloadJSON, ok := parser.TryParse(line); ok {
				// ⬅️ récupère le matchId courant
				matchID := resolveMatchID()

				ev := makeBaseEvent(serverID, matchID, typ, payloadJSON)

				streamFields := map[string]any{
					"v":         ev.V,
					"id":        ev.ID,
					"timestamp": ev.Timestamp,
					"source":    ev.Source,
					"kind":      ev.Kind,
					"serverId":  ev.ServerID,
					"matchId":   ev.MatchID,
					"type":      ev.Type,
					"payload":   string(ev.Payload),
				}

				pub := struct {
					V         int             `json:"v,omitempty"`
					ID        string          `json:"id,omitempty"`
					Timestamp int64           `json:"timestamp"`
					Type      string          `json:"type"`
					MatchID   string          `json:"matchId,omitempty"`
					ServerID  string          `json:"serverId"`
					Source    string          `json:"source,omitempty"`
					Kind      string          `json:"kind,omitempty"`
					Payload   json.RawMessage `json:"payload"`
				}{
					V: ev.V, ID: ev.ID, Timestamp: ev.Timestamp, Type: ev.Type,
					MatchID: ev.MatchID, ServerID: ev.ServerID, Source: ev.Source, Kind: ev.Kind,
					Payload: json.RawMessage(ev.Payload),
				}
				b, _ := json.Marshal(pub)

				batch = append(batch, entry{streamVals: streamFields, pubJSON: b})
				if len(batch) >= maxBatch {
					flush()
				}
				continue
			}
		}
	}
}

func genID() string {
	// ID lisible sans crypto pour éviter dépendance
	return fmt.Sprintf("evt-%d", time.Now().UnixNano())
}

type baseEvt struct {
	V         int             `json:"v"`
	ID        string          `json:"id"`
	Timestamp int64           `json:"timestamp"`
	Source    string          `json:"source"`
	Kind      string          `json:"kind"`
	ServerID  string          `json:"serverId"`
	MatchID   string          `json:"matchId"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

func makeBaseEvent(serverId, matchId, typ string, payload json.RawMessage) baseEvt {
	return baseEvt{
		V: 1, ID: genID(), Timestamp: time.Now().UnixMilli(),
		Source: "logs", Kind: "primary",
		ServerID: serverId, MatchID: matchId,
		Type: typ, Payload: payload,
	}
}
