package config

import "testing"

func TestExpandEnv(t *testing.T) {
	t.Setenv("GG_TEST_SET", "redis://redis:6379")
	t.Setenv("GG_TEST_EMPTY", "")

	cases := []struct{ in, want string }{
		{`url: "${GG_TEST_SET:-redis://127.0.0.1:6379}"`, `url: "redis://redis:6379"`},
		{`url: "${GG_TEST_UNSET:-redis://127.0.0.1:6379}"`, `url: "redis://127.0.0.1:6379"`},
		{`url: "${GG_TEST_EMPTY:-fallback}"`, `url: "fallback"`},
		{`url: "${GG_TEST_SET}"`, `url: "redis://redis:6379"`},
		{`url: "${GG_TEST_UNSET}"`, `url: ""`},
		{`rconPassword: "pa$$word$GG_TEST_SET"`, `rconPassword: "pa$$word$GG_TEST_SET"`}, // bare $ untouched
		{`backendPostUrl: "${GG_TEST_UNSET:-http://127.0.0.1:8081}/cs2/logs"`, `backendPostUrl: "http://127.0.0.1:8081/cs2/logs"`},
	}
	for _, c := range cases {
		if got := string(ExpandEnv([]byte(c.in))); got != c.want {
			t.Errorf("ExpandEnv(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
