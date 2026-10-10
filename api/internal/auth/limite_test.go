package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestLimitarPorIP(t *testing.T) {
	h := LimitarPorIP(2, time.Minute)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) }))
	pedir := func(ip string) *httptest.ResponseRecorder {
		r := httptest.NewRequest("POST", "/x", nil)
		r.RemoteAddr = ip + ":1234"
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		return w
	}
	pedir("203.0.113.1")
	pedir("203.0.113.1")
	if w := pedir("203.0.113.1"); w.Code != 429 || w.Header().Get("Retry-After") != "60" {
		t.Fatalf("terceira do mesmo IP: %d RA=%q", w.Code, w.Header().Get("Retry-After"))
	}
	if w := pedir("203.0.113.2"); w.Code != 200 {
		t.Fatalf("outro IP não divide o balde: %d", w.Code)
	}
}
