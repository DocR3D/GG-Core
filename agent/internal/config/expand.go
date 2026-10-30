// Package config holds helpers shared by the agent and the manager to load YAML configuration.
package config

import (
	"os"
	"regexp"
)

// Only the explicit ${VAR} / ${VAR:-default} form is expanded, so values such as RCON passwords
// containing a bare '$' are left untouched.
var envRef = regexp.MustCompile(`\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}`)

// ExpandEnv replaces ${VAR} and ${VAR:-default} references with environment values.
// An unset or empty VAR yields the default (or an empty string without default).
// The same agents.d/*.yaml file can thus target 127.0.0.1 natively and service names under Docker.
func ExpandEnv(b []byte) []byte {
	return envRef.ReplaceAllFunc(b, func(m []byte) []byte {
		parts := envRef.FindSubmatch(m)
		if v, ok := os.LookupEnv(string(parts[1])); ok && v != "" {
			return []byte(v)
		}
		return parts[2]
	})
}
