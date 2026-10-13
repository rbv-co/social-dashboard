// Package mapa: POST /buscar-lugar, a recepção do mapa (supabase/functions/buscar-lugar/index.ts): quem
// liga para o Nominatim (OpenStreetMap) em nome da Central, identificado, devagar e com memória — a regra
// de uso deles pede User-Agent e nada de rajada. Serve à Gestão de Tráfego e à Fábrica.
package mapa

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	nominatim = "https://nominatim.openstreetmap.org"
	// a identificação que a regra de uso do Nominatim pede (a mesma da edge)
	quemSou        = "iamundi-central-inteligencia/1.0 (contato: erick@rbvcompany.com)"
	validade       = 24 * time.Hour
	tetoDoCache    = 500
	tetoDaResposta = 1 << 20
)

type guardado struct {
	quando time.Time
	valor  []byte
}

// Mapa: o handler. Os campos não exportados só são trocados pelos testes deste pacote (o endereço do
// Nominatim é constante em produção: Ruling 5.7-14).
type Mapa struct {
	base      string
	http      *http.Client
	intervalo time.Duration
	lim       *auth.Limitador
	vez       chan struct{} // uma ligação por vez
	mu        sync.Mutex    // ultima e cache
	ultima    time.Time
	cache     map[string]guardado
}

func Novo() *Mapa {
	lim := auth.NovoLimitador()
	lim.Max, lim.Janela = 60, time.Minute
	return &Mapa{base: nominatim, intervalo: time.Second, lim: lim, vez: make(chan struct{}, 1), cache: map[string]guardado{},
		http: &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
}

func erro(w http.ResponseWriter, status int, frase string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": frase})
}

func (m *Mapa) doCache(chave string) ([]byte, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	g, ok := m.cache[chave]
	if !ok || time.Since(g.quando) > validade {
		delete(m.cache, chave)
		return nil, false
	}
	return g.valor, true
}

func (m *Mapa) guardar(chave string, valor []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.cache) >= tetoDoCache {
		for k := range m.cache { // ponytail: sai uma chave qualquer; LRU se o volume crescer
			delete(m.cache, k)
			break
		}
	}
	m.cache[chave] = guardado{time.Now(), valor}
}

// ligar faz UMA chamada ao Nominatim, na vez dela e respeitando o intervalo. Devolve o corpo (até 1 MiB),
// o status, ou o erro de rede/prazo.
func (m *Mapa) ligar(ctx context.Context, caminho string, q url.Values) ([]byte, int, error) {
	select {
	case m.vez <- struct{}{}:
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	}
	defer func() {
		m.mu.Lock()
		m.ultima = time.Now()
		m.mu.Unlock()
		<-m.vez
	}()
	m.mu.Lock()
	espera := m.intervalo - time.Since(m.ultima)
	m.mu.Unlock()
	if espera > 0 {
		select {
		case <-time.After(espera):
		case <-ctx.Done():
			return nil, 0, ctx.Err()
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.base+caminho+"?"+q.Encode(), nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", quemSou)
	req.Header.Set("Accept-Language", "pt-BR")
	res, err := m.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer res.Body.Close()
	corpo, err := io.ReadAll(io.LimitReader(res.Body, tetoDaResposta+1))
	return corpo, res.StatusCode, err
}

// buscarFora: cache → Nominatim → valida → (guarda). ok=false quando já respondeu o erro.
func (m *Mapa) buscarFora(w http.ResponseWriter, r *http.Request, acao, chave, caminho string, q url.Values) ([]byte, bool, bool) {
	if v, ok := m.doCache(chave); ok {
		return v, true, true
	}
	corpo, status, err := m.ligar(r.Context(), caminho, q)
	switch {
	case err != nil:
		slog.Warn("buscar-lugar: o Nominatim não respondeu", "acao", acao)
		erro(w, http.StatusBadGateway, "o servico de mapa nao respondeu")
		return nil, false, false
	case status < 200 || status > 299:
		slog.Warn("buscar-lugar: o Nominatim recusou", "acao", acao, "status", status)
		erro(w, http.StatusBadGateway, "o servico de mapa respondeu "+strconv.Itoa(status))
		return nil, false, false
	case len(corpo) > tetoDaResposta || !json.Valid(corpo):
		erro(w, http.StatusBadGateway, "o servico de mapa respondeu algo ilegivel")
		return nil, false, false
	}
	return corpo, false, true
}

func (m *Mapa) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	a := auth.AtorDoContexto(r.Context())
	if a == nil {
		erro(w, http.StatusUnauthorized, "nao_autenticado")
		return
	}
	var in struct {
		Acao  string   `json:"acao"`
		Termo string   `json:"termo"`
		Lat   *float64 `json:"lat"`
		Lng   *float64 `json:"lng"`
	}
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	if !m.lim.Tentar(a.ID) {
		erro(w, http.StatusTooManyRequests, "muitas buscas seguidas; espere um minuto")
		return
	}
	switch in.Acao {
	case "buscar":
		termo := strings.TrimSpace(in.Termo)
		switch n := utf8.RuneCountInString(termo); {
		case n < 3:
			erro(w, http.StatusBadRequest, "digite pelo menos 3 letras")
			return
		case n > 200:
			erro(w, http.StatusBadRequest, "termo longo demais")
			return
		}
		// countrycodes=br: as contas anunciam no Brasil (o mesmo recorte da edge)
		q := url.Values{"format": {"jsonv2"}, "addressdetails": {"1"}, "limit": {"8"}, "countrycodes": {"br"}, "q": {termo}}
		corpo, doCache, ok := m.buscarFora(w, r, in.Acao, "buscar:"+strings.ToLower(termo), "/search", q)
		if !ok {
			return
		}
		if !doCache {
			m.guardar("buscar:"+strings.ToLower(termo), corpo)
		}
		saida := `{"lugares":` + string(corpo)
		if doCache {
			saida += `,"doCache":true`
		}
		dados.Responder(w, http.StatusOK, []byte(saida+"}"))
	case "ondeCaiu":
		if in.Lat == nil || in.Lng == nil || *in.Lat < -90 || *in.Lat > 90 || *in.Lng < -180 || *in.Lng > 180 {
			erro(w, http.StatusBadRequest, "coordenada invalida")
			return
		}
		chave := fmt.Sprintf("ondeCaiu:%.5f,%.5f", *in.Lat, *in.Lng)
		q := url.Values{"format": {"jsonv2"}, "addressdetails": {"1"},
			"lat": {strconv.FormatFloat(*in.Lat, 'f', -1, 64)}, "lon": {strconv.FormatFloat(*in.Lng, 'f', -1, 64)}}
		corpo, doCache, ok := m.buscarFora(w, r, in.Acao, chave, "/reverse", q)
		if !ok {
			return
		}
		var lugar map[string]json.RawMessage
		if json.Unmarshal(corpo, &lugar) != nil {
			erro(w, http.StatusBadGateway, "o servico de mapa respondeu algo ilegivel")
			return
		}
		if doCache {
			lugar["doCache"] = json.RawMessage("true")
			corpo, _ = json.Marshal(lugar)
		} else if _, falhou := lugar["error"]; !falhou {
			m.guardar(chave, bytes.Clone(corpo))
		}
		dados.Responder(w, http.StatusOK, corpo)
	default:
		erro(w, http.StatusBadRequest, "acao desconhecida")
	}
}
