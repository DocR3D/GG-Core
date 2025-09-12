package main

// Manager (orchestrator-only) for GGBot/eBot++
// - Watches a directory of agent configs (YAML files)
// - Starts/stops one agent process per serverId
// - Survives manager crashes: on startup it re-scans Redis heartbeats
//   (ggbot:agent:<serverId>:state with TTL) to avoid duplicating running agents
// - DOES NOT proxy logs/RCON; agents are autonomous (option 2b)
//
// Build: go build -o managerd ./cmd/manager
// Requires go modules:
//   github.com/fsnotify/fsnotify
//   github.com/redis/go-redis/v9

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"flag"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"syscall"
	"time"

	fsnotify "github.com/fsnotify/fsnotify"
	redis "github.com/redis/go-redis/v9"
	"gopkg.in/yaml.v3"
)

// ---- CLI flags

var (
	flAgentsDir  = flag.String("agents-dir", "./agents.d", "Directory containing <serverId>.yaml agent files")
	flAgentBin   = flag.String("agent-bin", "./agentd", "Path to the agent binary to start")
	flRedisURL   = flag.String("redis", "", "Redis URL for heartbeat resync (e.g. redis://localhost:6379). Empty = disabled")
	flLogLevel   = flag.String("log-level", "info", "Log level: debug|info|warn|error")
	flBackoffMax = flag.Duration("restart-backoff-max", 30*time.Second, "Max backoff when restarting a crashed agent")
)

// ---- Config minimal parsing (we only need serverId here)

type AgentYAML struct {
	Version  int    `yaml:"version"`
	ServerID string `yaml:"serverId"`
}

// ---- Manager state

type Manager struct {
	ctx    context.Context
	cancel context.CancelFunc

	agentsDir string
	agentBin  string

	rdb *redis.Client // optional

	mu      sync.Mutex
	procs   map[string]*procHandle // serverId -> process we launched
	files   map[string]string      // path -> fileHash
	bySrv   map[string]string      // serverId -> path
	debOnce map[string]*debouncer  // path -> debounce helper
}

type procHandle struct {
	serverId string
	filePath string
	fileHash string
	cmd      *exec.Cmd
	stopping bool
	backoff  time.Duration
}

type debouncer struct {
	mu   sync.Mutex
	t    *time.Timer
	wait time.Duration
}

func newDebouncer(wait time.Duration) *debouncer { return &debouncer{wait: wait} }
func (d *debouncer) Do(f func()) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.t != nil {
		d.t.Stop()
	}
	d.t = time.AfterFunc(d.wait, f)
}

// ---- Utilities

func hashFile(path string) (string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:]), nil
}

func inferServerIdFromFilename(path string) string {
	base := filepath.Base(path)
	// ex: srv-a.yaml or srv-a.config.yaml → take first token before '.'
	p := strings.SplitN(base, ".", 2)
	return p[0]
}

func loadAgentYAML(path string) (AgentYAML, error) {
	var a AgentYAML
	b, err := os.ReadFile(path)
	if err != nil {
		return a, err
	}
	if err := yaml.Unmarshal(b, &a); err != nil {
		return a, err
	}
	if a.ServerID == "" {
		a.ServerID = inferServerIdFromFilename(path)
	}
	return a, nil
}

// ---- Redis helpers (optional)

func openRedis(url string) (*redis.Client, error) {
	opt, err := redis.ParseURL(url)
	if err != nil {
		return nil, err
	}
	return redis.NewClient(opt), nil
}

func (m *Manager) aliveAgentsFromRedis(ctx context.Context) (map[string]bool, error) {
	alive := map[string]bool{}
	if m.rdb == nil {
		return alive, nil
	}
	// SCAN ggbot:agent:*:state
	var cur uint64
	for {
		keys, next, err := m.rdb.Scan(ctx, cur, "ggbot:agent:*:state", 200).Result()
		if err != nil {
			return alive, err
		}
		for _, k := range keys {
			// Extract serverId → pattern: ggbot:agent:<serverId>:state
			parts := strings.Split(k, ":")
			if len(parts) >= 3 {
				serverId := parts[2]
				// check TTL (if available)
				if ttl, err := m.rdb.TTL(ctx, k).Result(); err == nil {
					if ttl > 0 {
						alive[serverId] = true
					}
				} else {
					// if TTL check fails, assume alive to be safe
					alive[serverId] = true
				}
			}
		}
		cur = next
		if cur == 0 {
			break
		}
	}
	return alive, nil
}

// ---- Process control

func (m *Manager) startAgent(serverId, filePath, fileHash string) error {
	m.mu.Lock()
	if _, ok := m.procs[serverId]; ok {
		m.mu.Unlock()
		log.Printf("[manager] serverId %s already started", serverId)
		return nil
	}
	m.mu.Unlock()

	args := []string{"-config", filePath, "-serverId", serverId}
	cmd := exec.CommandContext(m.ctx, m.agentBin, args...)
	stdout, _ := cmd.StdoutPipe()
	stderr, _ := cmd.StderrPipe()
	prefix := fmt.Sprintf("[%s] ", serverId)

	if err := cmd.Start(); err != nil {
		return fmt.Errorf("start agent %s: %w", serverId, err)
	}

	ph := &procHandle{serverId: serverId, filePath: filePath, fileHash: fileHash, cmd: cmd, backoff: 0}
	m.mu.Lock()
	m.procs[serverId] = ph
	m.mu.Unlock()

	go m.pipeLogs(prefix, stdout)
	go m.pipeLogs(prefix, stderr)
	go m.waitAndMaybeRestart(ph)

	log.Printf("[manager] started agent %s (pid=%d) from %s", serverId, cmd.Process.Pid, filePath)
	return nil
}

func (m *Manager) stopAgent(serverId string, reason string) error {
	m.mu.Lock()
	ph, ok := m.procs[serverId]
	m.mu.Unlock()
	if !ok {
		return nil
	}
	log.Printf("[manager] stopping agent %s: %s", serverId, reason)
	ph.stopping = true
	if ph.cmd.Process == nil {
		m.mu.Lock()
		delete(m.procs, serverId)
		m.mu.Unlock()
		return nil
	}
	_ = ph.cmd.Process.Signal(syscall.SIGTERM)
	done := make(chan struct{})
	go func() { _ = ph.cmd.Wait(); close(done) }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		_ = ph.cmd.Process.Kill()
	}
	m.mu.Lock()
	delete(m.procs, serverId)
	m.mu.Unlock()
	return nil
}

func (m *Manager) waitAndMaybeRestart(ph *procHandle) {
	err := ph.cmd.Wait()
	m.mu.Lock()
	serverId := ph.serverId
	stopping := ph.stopping
	path := ph.filePath
	hash := ph.fileHash
	m.mu.Unlock()

	if stopping {
		log.Printf("[manager] agent %s exited (stopped)", serverId)
		return
	}

	// crashed → prepare restart
	log.Printf("[manager] agent %s crashed: %v", serverId, err)
	// ensure old entry is removed before restart
	m.mu.Lock()
	delete(m.procs, serverId)
	m.mu.Unlock()

	// backoff
	if ph.backoff == 0 {
		ph.backoff = time.Second
	}
	if ph.backoff > *flBackoffMax {
		ph.backoff = *flBackoffMax
	}
	wait := ph.backoff
	if ph.backoff < *flBackoffMax {
		ph.backoff *= 2
	}
	log.Printf("[manager] restarting %s in %s", serverId, wait)
	select {
	case <-time.After(wait):
	case <-m.ctx.Done():
		return
	}
	_ = m.startAgent(serverId, path, hash)
}

func (m *Manager) pipeLogs(prefix string, r io.Reader) {
	s := bufio.NewScanner(r)
	for s.Scan() {
		line := s.Text()
		log.Printf("%s%s", prefix, line)
	}
}

// ---- Directory scanning & watching

var yamlFileRe = regexp.MustCompile(`(?i)^[^\.].*\.ya?ml$`)

func (m *Manager) initialScan(alive map[string]bool) error {
	entries, err := os.ReadDir(m.agentsDir)
	if err != nil {
		return err
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if !yamlFileRe.MatchString(name) {
			continue
		}
		path := filepath.Join(m.agentsDir, name)
		if strings.HasSuffix(strings.ToLower(name), ".disabled.yaml") {
			continue
		}
		if err := m.handleFileCreateOrWrite(path, alive); err != nil {
			log.Printf("[manager] initialScan err for %s: %v", path, err)
		}
	}
	return nil
}

func (m *Manager) handleFileCreateOrWrite(path string, alive map[string]bool) error {
	h, err := hashFile(path)
	if err != nil {
		return err
	}
	ay, err := loadAgentYAML(path)
	if err != nil {
		return err
	}
	serverId := ay.ServerID

	m.mu.Lock()
	oldHash := m.files[path]
	m.files[path] = h
	m.bySrv[serverId] = path
	_, already := m.procs[serverId]
	m.mu.Unlock()

	// If already running and hash changed → restart
	if already && oldHash != "" && oldHash != h {
		_ = m.stopAgent(serverId, "config changed")
	}

	// After possible stop, if process still running skip
	m.mu.Lock()
	_, still := m.procs[serverId]
	m.mu.Unlock()
	if still {
		return nil
	}

	// If agent heartbeat says alive → do not start duplicate
	if alive[serverId] {
		log.Printf("[manager] %s present and heartbeat alive → skip start (external agent assumed)", serverId)
		return nil
	}

	return m.startAgent(serverId, path, h)
}

func (m *Manager) handleFileRemove(path string) {
	m.mu.Lock()
	// find serverId owning this path
	var srv string
	for sid, p := range m.bySrv {
		if p == path {
			srv = sid
			break
		}
	}
	delete(m.files, path)
	if srv != "" {
		delete(m.bySrv, srv)
	}
	m.mu.Unlock()

	if srv == "" {
		return
	}
	_ = m.stopAgent(srv, "config removed/renamed")
}

func (m *Manager) watchDir() error {
	w, err := fsnotify.NewWatcher()
	if err != nil {
		return err
	}
	defer w.Close()
	if err := w.Add(m.agentsDir); err != nil {
		return err
	}
	log.Printf("[manager] watching %s", m.agentsDir)

	for {
		select {
		case ev := <-w.Events:
			base := filepath.Base(ev.Name)
			if ev.Op&(fsnotify.Create|fsnotify.Write|fsnotify.Chmod) != 0 {
				if !yamlFileRe.MatchString(base) {
					continue
				}
				if strings.HasSuffix(strings.ToLower(base), ".disabled.yaml") {
					continue
				}
				d := m.getDebouncer(ev.Name)
				d.Do(func() {
					alive, _ := m.aliveAgentsFromRedis(m.ctx)
					if err := m.handleFileCreateOrWrite(ev.Name, alive); err != nil {
						log.Printf("[manager] file write err: %v", err)
					}
				})
			}
			if ev.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
				m.handleFileRemove(ev.Name)
			}
		case err := <-w.Errors:
			log.Printf("[manager] watcher error: %v", err)
		case <-m.ctx.Done():
			return nil
		}
	}
}

func (m *Manager) getDebouncer(path string) *debouncer {
	m.mu.Lock()
	defer m.mu.Unlock()
	d, ok := m.debOnce[path]
	if !ok {
		d = newDebouncer(300 * time.Millisecond)
		m.debOnce[path] = d
	}
	return d
}

// ---- Main

func main() {
	flag.Parse()
	setLogFlags()

	if _, err := os.Stat(*flAgentsDir); os.IsNotExist(err) {
		log.Fatalf("agents-dir not found: %s", *flAgentsDir)
	}
	if _, err := os.Stat(*flAgentBin); os.IsNotExist(err) {
		log.Fatalf("agent-bin not found: %s", *flAgentBin)
	}

	ctx, cancel := context.WithCancel(context.Background())
	mgr := &Manager{
		ctx:       ctx,
		cancel:    cancel,
		agentsDir: *flAgentsDir,
		agentBin:  *flAgentBin,
		procs:     map[string]*procHandle{},
		files:     map[string]string{},
		bySrv:     map[string]string{},
		debOnce:   map[string]*debouncer{},
	}
	// optional Redis
	if *flRedisURL != "" {
		rdb, err := openRedis(*flRedisURL)
		if err != nil {
			log.Fatalf("redis: %v", err)
		}
		mgr.rdb = rdb
	}

	// graceful shutdown
	go func() {
		ch := make(chan os.Signal, 2)
		signal.Notify(ch, syscall.SIGINT, syscall.SIGTERM)
		<-ch
		log.Printf("[manager] shutting down…")
		mgr.cancel()
		// stop all we launched
		mgr.mu.Lock()
		for sid := range mgr.procs {
			go mgr.stopAgent(sid, "manager shutdown")
		}
		mgr.mu.Unlock()
	}()

	alive, err := mgr.aliveAgentsFromRedis(ctx)
	if err != nil {
		log.Printf("[manager] redis resync failed: %v", err)
	}
	if err := mgr.initialScan(alive); err != nil {
		log.Fatalf("initial scan: %v", err)
	}
	if err := mgr.watchDir(); err != nil {
		log.Fatalf("watch: %v", err)
	}
}

// small wrappers for portability
func setLogFlags() { log.SetFlags(log.LstdFlags | log.Lmicroseconds) }
