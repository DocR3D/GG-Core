// cmd/agent/kickall.go
package main

import (
	"context"
	"fmt"
	"log"
	"strconv"
	"strings"

	myrcon "ggbot/internal/rcon"
)

// CS2 has no "kickall": the players are read from `status`, then kicked one by one with kickid.

// statusPlayerIDs returns the userids of the human players listed by CS2's `status`
// (section "---------players--------" … "#end"). Bots (GOTV included, time "BOT") and
// half-open connections (id 65535, "challenging") are skipped.
func statusPlayerIDs(status string) []int {
	var ids []int
	inPlayers := false
	for _, raw := range strings.Split(status, "\n") {
		line := strings.TrimSpace(raw)
		switch {
		case strings.HasPrefix(line, "---------players"):
			inPlayers = true
			continue
		case !inPlayers:
			continue
		case strings.HasPrefix(line, "#end"):
			return ids
		}
		f := strings.Fields(line)
		if len(f) < 2 || f[1] == "BOT" {
			continue
		}
		id, err := strconv.Atoi(f[0])
		if err != nil || id < 0 || id >= 65535 {
			continue
		}
		ids = append(ids, id)
	}
	return ids
}

// kickAllPlayers kicks every human player of the server, with a message (rate limited like any RCON command).
func kickAllPlayers(ctx context.Context, cfg AgentConfig, message string) error {
	status, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
		return c.Send(ctx, "status")
	})
	if err != nil {
		return fmt.Errorf("kick_all: status: %w", err)
	}
	ids := statusPlayerIDs(status)
	msg := strings.ReplaceAll(strings.TrimSpace(message), `"`, "'")
	log.Printf("[agent:%s] kick_all: %d player(s) %v", cfg.ServerID, len(ids), ids)
	for _, id := range ids {
		cmd := fmt.Sprintf("kickid %d", id)
		if msg != "" {
			cmd += fmt.Sprintf(" %q", msg)
		}
		if _, err := withRcon(ctx, cfg, func(ctx context.Context, c *myrcon.Client) (string, error) {
			return c.Send(ctx, cmd)
		}); err != nil {
			log.Printf("[agent:%s] kick_all: %s failed: %v", cfg.ServerID, cmd, err)
		}
	}
	return nil
}
