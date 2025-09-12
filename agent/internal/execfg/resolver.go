package execfg

import (
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// FileResolver permet d'ouvrir un fichier .cfg (disque, HTTP, mémoire, etc.)
type FileResolver interface {
	Open(name string) (io.ReadCloser, error)
}

// OSResolver ouvre des fichiers locaux (ex: Base = "/app/cfg" dans le conteneur)
type OSResolver struct{ Base string }

func (r OSResolver) Open(name string) (io.ReadCloser, error) {
	path := name
	if r.Base != "" && !strings.HasPrefix(name, r.Base) {
		path = filepath.Join(r.Base, name)
	}
	return os.Open(path)
}

// HTTPResolver télécharge des .cfg depuis un backend (optionnel)
type HTTPResolver struct {
	BaseURL string
	Client  *http.Client
}

func (r HTTPResolver) Open(name string) (io.ReadCloser, error) {
	c := r.Client
	if c == nil {
		c = http.DefaultClient
	}
	url := strings.TrimRight(r.BaseURL, "/") + "/" + strings.TrimLeft(name, "/")
	resp, err := c.Get(url)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, &httpError{code: resp.StatusCode}
	}
	return resp.Body, nil
}

type httpError struct{ code int }

func (e *httpError) Error() string { return "http status " + http.StatusText(e.code) }
