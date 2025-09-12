package execfg

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"time"
)

type Rcon interface {
	Exec(ctx context.Context, cmd string) (string, error)
}

type Options struct {
	Throttle         time.Duration // délai entre commandes (ex: 75ms)
	MaxLines         int           // anti-abus (ex: 1000)
	MaxLineLen       int           // anti-abus (ex: 512)
	AllowChangeLevel bool          // sécurité (sinon bloque changelevel)
	WhitelistPrefix  []string      // ex: []{"mp_", "sv_", "tv_", "bot_", "say", "echo"}
	Resolver         FileResolver  // pour @include et ouverture de fichiers
	Vars             map[string]string
	Logger           func(format string, args ...any)
}

var (
	semiSplit   = regexp.MustCompile(`\s*;\s*`)
	commentTrim = regexp.MustCompile(`\s*(?://|#|;).*?$`)
	varRefRe    = regexp.MustCompile(`\$\{([a-zA-Z0-9_.-]+)\}`)
)

// ExecCfg exécute un flux .cfg (ouvert via Resolver ou fourni directement) avec directives.
// Directives supportées: @sleep <ms>, @include <path>, @set key=value
func ExecCfg(ctx context.Context, r Rcon, src io.Reader, opts Options) error {
	logf := opts.Logger
	if logf == nil {
		logf = func(string, ...any) {}
	}
	sc := bufio.NewScanner(src)
	if opts.MaxLineLen <= 0 {
		opts.MaxLineLen = 512
	}
	buf := make([]byte, 0, opts.MaxLineLen)
	sc.Buffer(buf, opts.MaxLineLen)

	if opts.MaxLines <= 0 {
		opts.MaxLines = 1000
	}
	if opts.WhitelistPrefix == nil {
		opts.WhitelistPrefix = []string{"mp_", "sv_", "tv_", "bot_", "say", "echo"}
	}

	lines := 0
	for sc.Scan() {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		if lines++; lines > opts.MaxLines {
			return fmt.Errorf("cfg: dépasse MaxLines (%d)", opts.MaxLines)
		}

		raw := strings.TrimSpace(sc.Text())
		raw = commentTrim.ReplaceAllString(raw, "")
		if raw == "" {
			continue
		}

		parts := semiSplit.Split(raw, -1)
		for _, part := range parts {
			cmd := strings.TrimSpace(part)
			if cmd == "" {
				continue
			}

			// directives
			if strings.HasPrefix(cmd, "@") {
				if err := handleDirective(ctx, r, cmd, &opts, logf); err != nil {
					return fmt.Errorf("directive '%s': %w", cmd, err)
				}
				continue
			}

			// substitutions ${var}
			cmd = varRefRe.ReplaceAllStringFunc(cmd, func(m string) string {
				key := varRefRe.FindStringSubmatch(m)[1]
				if v, ok := opts.Vars[key]; ok {
					return v
				}
				return m
			})

			// sécurité changelevel
			if !opts.AllowChangeLevel && strings.HasPrefix(strings.ToLower(cmd), "changelevel ") {
				return errors.New("changelevel interdit (AllowChangeLevel=false)")
			}

			// whitelist
			if !isWhitelisted(cmd, opts.WhitelistPrefix) {
				return fmt.Errorf("commande non autorisée: %q", cmd)
			}

			// envoi RCON
			logf("RCON> %s", cmd)
			if _, err := r.Exec(ctx, cmd); err != nil {
				return fmt.Errorf("rcon: %w", err)
			}
			if opts.Throttle > 0 {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-time.After(opts.Throttle):
				}
			}
		}
	}
	return sc.Err()
}

func isWhitelisted(cmd string, prefixes []string) bool {
	low := strings.ToLower(strings.TrimSpace(cmd))
	for _, p := range prefixes {
		if strings.HasPrefix(low, strings.ToLower(p)) {
			return true
		}
	}
	switch first := strings.Fields(low)[0]; first {
	case "say", "echo", "mp_restartgame", "mp_pause_match", "mp_unpause_match", "mp_warmup_start", "mp_warmup_end":
		return true
	}
	return false
}

func handleDirective(ctx context.Context, r Rcon, cmd string, opts *Options, logf func(format string, args ...any)) error {
	fields := strings.Fields(cmd)

	switch {
	case strings.HasPrefix(cmd, "@sleep"):
		if len(fields) < 2 {
			return errors.New("@sleep <millis>")
		}
		d, err := time.ParseDuration(fields[1] + "ms")
		if err != nil {
			return err
		}
		logf("⏳ sleep %v", d)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(d):
			return nil
		}

	case strings.HasPrefix(cmd, "@include"):
		if len(fields) < 2 {
			return errors.New("@include <path>")
		}
		if opts.Resolver == nil {
			return errors.New("pas de resolver configuré")
		}
		child, err := opts.Resolver.Open(fields[1])
		if err != nil {
			return err
		}
		defer child.Close()
		logf("📄 include %s", fields[1])
		return ExecCfg(ctx, r, child, *opts)

	case strings.HasPrefix(cmd, "@set"):
		rest := strings.TrimSpace(strings.TrimPrefix(cmd, "@set"))
		kv := strings.SplitN(strings.TrimSpace(rest), "=", 2)
		if len(kv) != 2 {
			return errors.New("@set key=value")
		}
		k := strings.TrimSpace(kv[0])
		v := strings.TrimSpace(kv[1])
		if opts.Vars == nil {
			opts.Vars = map[string]string{}
		}
		opts.Vars[k] = v
		logf("🔧 set %s=%s", k, v)
		return nil
	}

	return fmt.Errorf("directive inconnue: %s", cmd)
}
