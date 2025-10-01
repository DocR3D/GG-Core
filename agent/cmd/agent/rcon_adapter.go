// cmd/agent/rcon_adapter.go
package main

import (
	"context"
	"fmt"

	"ggbot/internal/execfg"
	myrcon "ggbot/internal/rcon"
)

// Adaptateur qui implémente execfg.Rcon en délégant à withRcon/Client.
type RconAdapter struct {
	Cfg AgentConfig
}

// Compile-time check: RconAdapter satisfait bien l’interface execfg.Rcon
var _ execfg.Rcon = (*RconAdapter)(nil)

func (a *RconAdapter) Exec(ctx context.Context, cmd string) (string, error) {
	if (a.Cfg == AgentConfig{}) {
		return "", fmt.Errorf("RconAdapter: cfg vide")
	}

	return withRcon(ctx, a.Cfg, func(ctx context.Context, cli *myrcon.Client) (string, error) {
		return cli.Send(ctx, cmd)
	})
}
