package main

import (
	"reflect"
	"testing"
)

// Players section of a real CS2 `status` (dev server: GOTV + half-open connections), plus human rows.
const statusSample = `----- Status -----
hostname : GG-Core Dev
players  : 2 humans, 1 bots (0 max) (not hibernating) (unreserved)
---------players--------
  id     time ping loss      state   rate adr name
   0      BOT    0    0     active      0 'GG-Core Dev CSTV'
   2    12:41   18    0     active 786432 172.30.0.1:27005 'Alpha_Kilo'
   3    03:02   25    0     active 786432 172.30.0.1:27006 'Bravo Alfa'
65535 [NoChan]    0    0 challenging      0unknown ''
#end
--- SourceTV[0] Status ---
# userid name uniqueid connected ping loss state rate adr
#end
`

func TestStatusPlayerIDsKeepsHumansOnly(t *testing.T) {
	if got, want := statusPlayerIDs(statusSample), []int{2, 3}; !reflect.DeepEqual(got, want) {
		t.Fatalf("statusPlayerIDs = %v, want %v", got, want)
	}
}

func TestStatusPlayerIDsEmptyServer(t *testing.T) {
	if got := statusPlayerIDs("---------players--------\n  id time\n   0 BOT 0 0 active 0 'CSTV'\n#end\n"); len(got) != 0 {
		t.Fatalf("expected no player, got %v", got)
	}
}
