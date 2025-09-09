package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	logs "ggbot/internal/ingest/httpLogs"
	myrcon "ggbot/internal/rcon"

	"gopkg.in/yaml.v3"

	"github.com/redis/go-redis/v9"
)

type AgentAction struct {
	Type     string `json:"type"`     // "action"
	ServerID string `json:"serverId"` // "srv-a" etc.
	Action   string `json:"action"`   // "pause_tac","unpause","say","changelevel","restart_round"...
	Payload  struct {
		MatchID     string `json:"matchId"`
		TeamLogical string `json:"teamLogical"` // "home"/"away"
		TeamSide    string `json:"teamSide"`    // "CT"/"T"
		Seconds     int    `json:"seconds,omitempty"`
		Text        string `json:"text,omitempty"`
		Map         string `json:"map,omitempty"`
	} `json:"payload"`
	Source struct {
		Via    string `json:"via"`
		Player struct {
			Name    string `json:"name"`
			SteamID string `json:"steamId"`
			Team    string `json:"team"`
		} `json:"player"`
	} `json:"source"`
	TS int64 `json:"ts"`
}

type Config struct {
	Servers []ServerConfig `yaml:"servers"`
	Redis   struct {
		URL string `yaml:"url"`
	} `yaml:"redis"`
}

type ServerConfig struct {
	Name string  `yaml:"name"`
	RCON RconCfg `yaml:"rcon"`
	CSTV CstvCfg `yaml:"cstv"`
}
type RconCfg struct {
	Host        string `yaml:"host"`
	Port        int    `yaml:"port"`
	Password    string `yaml:"password"`
	TimeoutMs   int    `yaml:"timeoutMs"`
	RateLimitMs int    `yaml:"rateLimitMs"`
}
type CstvCfg struct {
	Enabled bool `yaml:"enabled"`
	Port    int  `yaml:"port"`
	Delay   int  `yaml:"delay"`
}

func main() {
	// Flags
	cfgPath := flag.String("cfg", "config.yaml", "chemin du fichier YAML")
	server := flag.String("server", "", "nom du serveur (ex: srv-a)")
	cmd := flag.String("cmd", "status", "commande: status|pause|unpause|changelevel|say|listen-chat|agent")
	flag.Parse()

	// Charge YAML
	b, err := os.ReadFile(*cfgPath)
	if err != nil {
		log.Fatalf("read %s: %v", *cfgPath, err)
	}
	var cfg Config
	if err := yaml.Unmarshal(b, &cfg); err != nil {
		log.Fatalf("yaml: %v", err)
	}

	ctx := context.Background()

	// ----- Mode agent -----
	if *cmd == "agent" {
		if cfg.Redis.URL == "" {
			log.Fatal("❌ aucun redis.url défini dans config.yaml")
		}

		log.Printf("✅ Agent: connexion à Redis %s", cfg.Redis.URL)

		if err := runAgent(ctx, &cfg); err != nil {
			log.Fatal(err)
		}
		return
	}

	// ----- Autres commandes (RCON direct) -----
	if *server == "" {
		log.Fatal("utilisation: -server <name> [-cmd status|pause|unpause|changelevel|say|listen-chat] [-cfg config.yaml]")
	}

	// Trouve la cible
	var target *ServerConfig
	for i := range cfg.Servers {
		if cfg.Servers[i].Name == *server {
			target = &cfg.Servers[i]
			break
		}
	}
	if target == nil {
		log.Fatalf("serveur %q introuvable dans %s", *server, *cfgPath)
	}

	// Connect RCON
	client := myrcon.New(myrcon.Config{
		Host:      target.RCON.Host,
		Port:      target.RCON.Port,
		Password:  target.RCON.Password,
		Timeout:   time.Duration(max(500, target.RCON.TimeoutMs)) * time.Millisecond,
		RateLimit: time.Duration(max(0, target.RCON.RateLimitMs)) * time.Millisecond,
	})
	if err := client.Connect(ctx); err != nil {
		log.Fatalf("RCON connect %s:%d: %v", target.RCON.Host, target.RCON.Port, err)
	}
	defer client.Close()

	switch *cmd {
	case "status":
		out, err := client.Status(ctx)
		check(err)
		fmt.Println(out)

	case "pause":
		out, err := client.PauseMatch(ctx)
		check(err)
		fmt.Println(out)

	case "unpause":
		out, err := client.UnpauseMatch(ctx)
		check(err)
		fmt.Println(out)

	case "changelevel":
		if flag.NArg() < 1 {
			log.Fatal("utilisation: -cmd changelevel <map>")
		}
		mapName := flag.Arg(0)
		out, err := client.ChangeLevel(ctx, mapName)
		check(err)
		fmt.Println(out)

	case "say":
		out, err := client.Say(ctx, "Hello depuis GGBot 🚀")
		check(err)
		fmt.Println(out)

	case "listen-chat":
		log.Println("👂 écoute des logs HTTP sur :8081")
		logs.RunHTTP("0.0.0.0:8081")

	default:
		log.Fatalf("commande inconnue: %s (attendu: status|pause|unpause|changelevel|say|listen-chat|agent)", *cmd)
	}
}

func runAgent(ctx context.Context, cfg *Config) error {
	// Détermine l'URL Redis
	redisURL := cfg.Redis.URL
	if redisURL == "" {
		redisURL = getenv("REDIS_URL", "redis://localhost:6379")
	}
	redisChan := getenv("REDIS_CHANNEL", "ggbot:agent:actions")

	// Parse l’URL
	opt, err := redis.ParseURL(redisURL)
	if err != nil {
		return fmt.Errorf("redis URL invalide: %w", err)
	}
	rdb := redis.NewClient(opt)
	defer rdb.Close()

	sub := rdb.Subscribe(ctx, redisChan)
	defer sub.Close()

	if _, err := sub.Receive(ctx); err != nil {
		return fmt.Errorf("subscribe: %w", err)
	}
	ch := sub.Channel()
	log.Printf("Agent Go subscribed to %s (Redis=%s)", redisChan, redisURL)

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case m, ok := <-ch:
			if !ok {
				return fmt.Errorf("canal Redis fermé")
			}
			var act AgentAction
			if err := json.Unmarshal([]byte(m.Payload), &act); err != nil {
				log.Printf("JSON invalide: %v | raw=%s", err, truncate(m.Payload, 400))
				continue
			}
			if err := handleAction(ctx, cfg, act); err != nil {
				log.Printf("❌ Action %s -> %s ERREUR: %v", act.Action, act.ServerID, err)
			} else {
				log.Printf("✅ Action %s -> %s OK", act.Action, act.ServerID)
			}
		}
	}
}

func getenv(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}
func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n]) + "…"
}

func handleAction(ctx context.Context, cfg *Config, act AgentAction) error {
	if strings.ToLower(act.Type) != "action" {
		return nil
	}
	target := findServer(cfg, act.ServerID)
	if target == nil {
		return fmt.Errorf("serveur inconnu: %s", act.ServerID)
	}

	switch act.Action {
	case "pause_tac", "pause_tech":
		_, err := withRcon(ctx, target, func(ctx context.Context, c *myrcon.Client) (string, error) {
			return c.PauseMatch(ctx)
		})
		return err

	case "unpause":
		_, err := withRcon(ctx, target, func(ctx context.Context, c *myrcon.Client) (string, error) {
			return c.UnpauseMatch(ctx)
		})
		return err

	case "say":
		msg := strings.TrimSpace(act.Payload.Text)
		if msg == "" {
			return fmt.Errorf("say: payload.text manquant")
		}
		_, err := withRcon(ctx, target, func(ctx context.Context, c *myrcon.Client) (string, error) {
			return c.Say(ctx, msg)
		})
		return err

	case "changelevel":
		mp := strings.TrimSpace(act.Payload.Map)
		if mp == "" {
			return fmt.Errorf("changelevel: payload.map manquant")
		}
		_, err := withRcon(ctx, target, func(ctx context.Context, c *myrcon.Client) (string, error) {
			return c.ChangeLevel(ctx, mp)
		})
		return err

	case "restart_game":
		_, err := withRcon(ctx, target, func(ctx context.Context, c *myrcon.Client) (string, error) {
			return c.Send(ctx, "mp_restartgame 1") // si tu as un wrapper dédié, remplace
		})
		return err

	default:
		// On ignore ce qu'on ne connait pas (ou log)
		log.Printf("Action inconnue: %q (server=%s)", act.Action, act.ServerID)
		return nil
	}
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
func check(err error) {
	if err != nil {
		log.Fatalf("erreur: %v", err)
	}
}

func findServer(cfg *Config, name string) *ServerConfig {
	for i := range cfg.Servers {
		if cfg.Servers[i].Name == name {
			return &cfg.Servers[i]
		}
	}
	return nil
}

func withRcon(ctx context.Context, target *ServerConfig, fn func(ctx context.Context, c *myrcon.Client) (string, error)) (string, error) {
	client := myrcon.New(myrcon.Config{
		Host:      target.RCON.Host,
		Port:      target.RCON.Port,
		Password:  target.RCON.Password,
		Timeout:   time.Duration(max(500, target.RCON.TimeoutMs)) * time.Millisecond,
		RateLimit: time.Duration(max(0, target.RCON.RateLimitMs)) * time.Millisecond,
	})
	if err := client.Connect(ctx); err != nil {
		return "", fmt.Errorf("RCON connect %s:%d: %w", target.RCON.Host, target.RCON.Port, err)
	}
	defer client.Close()
	return fn(ctx, client)
}
