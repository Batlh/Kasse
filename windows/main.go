// Windows-Programm der Kasse: kleiner lokaler Server plus App-Fenster.
// Die Daten liegen in "Kasse-Daten.json" direkt neben dem Programm.
package main

import (
	"bytes"
	"crypto/rand"
	"embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

//go:embed index.html
var assets embed.FS

const port = 47650

var (
	mu       sync.Mutex
	dataPath string
	token    string
	lastSeen = time.Now()
	closing  bool
)

func writeState(body []byte) error {
	mu.Lock()
	defer mu.Unlock()
	tmp := dataPath + ".tmp"
	f, err := os.Create(tmp)
	if err != nil {
		return err
	}
	if _, err = f.Write(body); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	if _, serr := os.Stat(dataPath); serr == nil {
		bak := strings.TrimSuffix(dataPath, ".json") + ".bak.json"
		os.Remove(bak)
		os.Rename(dataPath, bak)
	}
	return os.Rename(tmp, dataPath)
}

func readState() []byte {
	mu.Lock()
	defer mu.Unlock()
	for _, p := range []string{dataPath, strings.TrimSuffix(dataPath, ".json") + ".bak.json"} {
		if b, err := os.ReadFile(p); err == nil && len(b) > 0 {
			return b
		}
	}
	return nil
}

func hostOK(r *http.Request) bool {
	h, _, err := net.SplitHostPort(r.Host)
	return err == nil && (h == "127.0.0.1" || h == "localhost")
}

func handler() http.Handler {
	page, _ := assets.ReadFile("index.html")
	boot, _ := json.Marshal(map[string]string{"token": token})
	page = bytes.Replace(page, []byte("/*__BOOT__*/"), []byte("window.KASSE_DESKTOP="+string(boot)+";"), 1)

	mux := http.NewServeMux()
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/" {
			http.NotFound(w, r)
			return
		}
		mu.Lock()
		closing, lastSeen = false, time.Now()
		mu.Unlock()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Write(page)
	})
	mux.HandleFunc("/api/state", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			b := readState()
			if b == nil {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			w.Write(b)
		case http.MethodPost:
			body, err := io.ReadAll(io.LimitReader(r.Body, 64<<20))
			if err != nil || !json.Valid(body) {
				http.Error(w, "ungültig", http.StatusBadRequest)
				return
			}
			if err := writeState(body); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
		default:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	})
	mux.HandleFunc("/api/ping", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		closing, lastSeen = false, time.Now()
		mu.Unlock()
	})
	mux.HandleFunc("/api/closing", func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		closing, lastSeen = true, time.Now()
		mu.Unlock()
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !hostOK(r) {
			http.Error(w, "nicht erlaubt", http.StatusForbidden)
			return
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			t := r.Header.Get("X-Kasse-Token")
			if t == "" {
				t = r.URL.Query().Get("t")
			}
			if t != token {
				http.Error(w, "nicht erlaubt", http.StatusForbidden)
				return
			}
		}
		mux.ServeHTTP(w, r)
	})
}

// Beendet das Programm, sobald das Fenster geschlossen wurde.
func watchClose() {
	for range time.Tick(time.Second) {
		mu.Lock()
		c, seen := closing, lastSeen
		mu.Unlock()
		if c && time.Since(seen) > 6*time.Second {
			os.Exit(0)
		}
	}
}

func dataLocation() string {
	if v := os.Getenv("KASSE_DATA"); v != "" {
		return v
	}
	exe, err := os.Executable()
	if err == nil {
		dir := filepath.Dir(exe)
		probe := filepath.Join(dir, ".kasse-test")
		if f, e := os.Create(probe); e == nil {
			f.Close()
			os.Remove(probe)
			return filepath.Join(dir, "Kasse-Daten.json")
		}
	}
	base, err := os.UserConfigDir()
	if err != nil {
		base = os.TempDir()
	}
	dir := filepath.Join(base, "Kasse")
	os.MkdirAll(dir, 0o755)
	return filepath.Join(dir, "Kasse-Daten.json")
}

func main() {
	url := fmt.Sprintf("http://127.0.0.1:%d/", port)
	ln, err := net.Listen("tcp", fmt.Sprintf("127.0.0.1:%d", port))
	if err != nil {
		// Läuft schon: nur das Fenster wieder öffnen.
		if c, e := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), time.Second); e == nil {
			c.Close()
			openWindow(url)
			return
		}
		showError("Kasse konnte nicht starten:\n" + err.Error())
		os.Exit(1)
	}
	dataPath = dataLocation()
	b := make([]byte, 16)
	rand.Read(b)
	token = hex.EncodeToString(b)
	go watchClose()
	openWindow(url)
	if err := http.Serve(ln, handler()); err != nil {
		showError("Kasse wurde beendet:\n" + err.Error())
	}
}
