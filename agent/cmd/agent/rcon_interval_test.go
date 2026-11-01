package main

import (
	"testing"
	"time"
)

func TestRconIntervalNeverExceedsSixPerSecond(t *testing.T) {
	cases := map[int]time.Duration{
		0:  time.Second / 6, // missing config
		-1: time.Second / 6,
		8:  time.Second / 6, // above the project limit
		6:  time.Second / 6,
		2:  time.Second / 2,
	}
	for perSec, want := range cases {
		if got := rconInterval(perSec); got != want {
			t.Errorf("rconInterval(%d) = %v, want %v", perSec, got, want)
		}
	}
}
