package parser

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestBulkDump parses every <BULK_DUMP_DIR>/*.log exactly like the agent does (one TryParse call per log line)
// and writes <BULK_DUMP_DIR>/go/<name>.jsonl = { line, type, payload } per event. The backend bulk CS2 oracle
// (fixtures-golden-master.spec.ts, BULK_ORACLE_DIR) then replays those events and compares them with CS2.
// Skipped unless BULK_DUMP_DIR is set (local real logs, never committed).
func TestBulkDump(t *testing.T) {
	dir := os.Getenv("BULK_DUMP_DIR")
	if dir == "" {
		t.Skip("BULK_DUMP_DIR not set")
	}
	logs, err := filepath.Glob(filepath.Join(dir, "*.log"))
	if err != nil || len(logs) == 0 {
		t.Fatalf("no .log in %s (%v)", dir, err)
	}
	outDir := filepath.Join(dir, "go")
	if err := os.MkdirAll(outDir, 0o755); err != nil {
		t.Fatal(err)
	}

	for _, logPath := range logs {
		// fresh parser state per match, as for a new agent
		ignoreNextWorldSuicide = map[string]time.Time{}
		deferred = nil

		in, err := os.ReadFile(logPath)
		if err != nil {
			t.Fatal(err)
		}
		outPath := filepath.Join(outDir, strings.TrimSuffix(filepath.Base(logPath), ".log")+".jsonl")
		out, err := os.Create(outPath)
		if err != nil {
			t.Fatal(err)
		}
		w := bufio.NewWriter(out)
		for i, line := range strings.Split(strings.ReplaceAll(string(in), "\r\n", "\n"), "\n") {
			if strings.TrimSpace(line) == "" {
				continue
			}
			for _, ev := range Parse(line) {
				b, _ := json.Marshal(map[string]any{"line": i, "type": ev.Type, "payload": ev.Payload})
				w.Write(append(b, '\n'))
			}
		}
		w.Flush()
		out.Close()
	}
	t.Logf("dumped %d logs to %s", len(logs), outDir)
}
