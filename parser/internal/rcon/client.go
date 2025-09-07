package rcon

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/gorcon/rcon"
)

type Config struct {
	Host        string
	Port        int
	Password    string
	Timeout     time.Duration // ex: 2 * time.Second
	RateLimit   time.Duration // ex: 200 * time.Millisecond
}

type Client struct {
	cfg   Config
	conn  *rcon.Conn
	last  time.Time
}

func New(cfg Config) *Client { return &Client{cfg: cfg} }

func (c *Client) Addr() string { return fmt.Sprintf("%s:%d", c.cfg.Host, c.cfg.Port) }

func (c *Client) Connect(ctx context.Context) error {
	// deadline global
	d := c.cfg.Timeout
	if d <= 0 { d = 3 * time.Second }
	done := make(chan error, 1)
	go func() {
		conn, err := rcon.Dial(c.Addr(), c.cfg.Password)
		if err == nil {
			c.conn = conn
			c.last = time.Now().Add(-c.cfg.RateLimit)
		}
		done <- err
	}()
	select {
	case err := <-done:
		return err
	case <-time.After(d):
		return errors.New("rcon connect timeout")
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (c *Client) Close() error {
	if c.conn != nil {
		return c.conn.Close()
	}
	return nil
}

// Send envoie une commande avec rate-limit et timeout.
func (c *Client) Send(ctx context.Context, cmd string) (string, error) {
	if c.conn == nil {
		return "", errors.New("rcon not connected")
	}

	// rate-limit simple
	if c.cfg.RateLimit > 0 {
		sleep := c.cfg.RateLimit - time.Since(c.last)
		if sleep > 0 {
			select {
			case <-time.After(sleep):
			case <-ctx.Done():
				return "", ctx.Err()
			}
		}
	}

	type res struct {
		out string
		err error
	}
	ch := make(chan res, 1)
	go func() {
		out, err := c.conn.Execute(cmd)
		ch <- res{out, err}
	}()

	// timeout par commande
	cmdTimeout := c.cfg.Timeout
	if cmdTimeout <= 0 { cmdTimeout = 3 * time.Second }

	select {
	case r := <-ch:
		if r.err == nil { c.last = time.Now() }
		return r.out, r.err
	case <-time.After(cmdTimeout):
		return "", errors.New("rcon command timeout")
	case <-ctx.Done():
		return "", ctx.Err()
	}
}

// Helpers pratiques (optionnel)
func (c *Client) Status(ctx context.Context) (string, error) { 
	return c.Send(ctx, "status") 
}
func (c *Client) ChangeLevel(ctx context.Context, mapName string) (string, error) {
	return c.Send(ctx, "changelevel "+mapName)
}

// PauseMatch envoie la pause compétitive (tech/tac déclenchée côté serveur/admin).
func (c *Client) PauseMatch(ctx context.Context) (string, error) {
	return c.Send(ctx, "mp_pause_match")
}

// UnpauseMatch annule la pause et relance le timer.
func (c *Client) UnpauseMatch(ctx context.Context) (string, error) {
	return c.Send(ctx, "mp_unpause_match")
}

// Say envoie un message dans le chat du serveur.
func (c *Client) Say(ctx context.Context, msg string) (string, error) {
	return c.Send(ctx, fmt.Sprintf("say %s", msg))
}