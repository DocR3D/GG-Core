package logs

import (
	"fmt"
	"io"
	"log"
	"net/http"
)

func RunHTTP(addr string) {
	http.HandleFunc("/logs", func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		defer r.Body.Close()
		fmt.Printf("[LOG] %s\n", string(body))
		w.WriteHeader(http.StatusOK)
	})

	log.Printf("HTTP log listener sur %s/logs\n", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}
