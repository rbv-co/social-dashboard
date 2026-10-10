// Package meta: Graph API da Meta (anúncios e Instagram), sempre pelo core
// (POST /api/interno/meta/graph, token global do core). Nenhum token da Meta passa por aqui.
package meta

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
)

func responder(w http.ResponseWriter, status int, corpo any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func erro(w http.ResponseWriter, status int, msg string) {
	responder(w, status, map[string]string{"error": msg})
}

// textoDe é o `${v}` do JS para um valor do corpo (id de conta, data em segundos...).
func textoDe(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case json.Number:
		return x.String()
	}
	return fmt.Sprint(v)
}

// Proxy é POST /meta-proxy {accountId, path, params, method, imageFromUrl, imageField,
// videoFromUrl}: porta do ramo CORE_META de supabase/functions/meta-proxy (viaCore).
// Deve vir DEPOIS de auth.Exigir + auth.ExigirModulo("meta").
type Proxy struct {
	Pool         *pgxpool.Pool
	Core         *core.Cliente
	HostsDeMidia []string // vazio = nenhum upload de mídia é aceito
}

// midiaPermitida fecha o SSRF: a URL de mídia só pode ser https num host da lista.
func (p *Proxy) midiaPermitida(bruta string) bool {
	u, err := url.Parse(bruta)
	return err == nil && u.Scheme == "https" && u.Host != "" && slices.Contains(p.HostsDeMidia, u.Host)
}

func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var in struct {
		AccountID    any            `json:"accountId"`
		Path         string         `json:"path"`
		Params       map[string]any `json:"params"`
		Method       string         `json:"method"`
		ImageFromURL string         `json:"imageFromUrl"`
		ImageField   string         `json:"imageField"`
		VideoFromURL string         `json:"videoFromUrl"`
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 64<<10)) // o core recusa parametros > 64 KB
	d.UseNumber()
	if err := d.Decode(&in); err != nil {
		var grande *http.MaxBytesError
		if errors.As(err, &grande) {
			erro(w, http.StatusRequestEntityTooLarge, "corpo grande demais")
			return
		}
		erro(w, http.StatusBadRequest, "accountId e path obrigatorios")
		return
	}
	conta := textoDe(in.AccountID)
	if conta == "" || conta == "0" || in.Path == "" {
		erro(w, http.StatusBadRequest, "accountId e path obrigatorios")
		return
	}
	var existe bool
	if err := p.Pool.QueryRow(r.Context(), `select exists(select 1 from accounts where id::text = $1)`, conta).Scan(&existe); err != nil {
		erro(w, http.StatusInternalServerError, "erro_interno")
		return
	}
	if !existe {
		erro(w, http.StatusBadRequest, "conta nao encontrada")
		return
	}
	if in.ImageFromURL != "" && !p.midiaPermitida(in.ImageFromURL) {
		erro(w, http.StatusBadRequest, "origem da imagem nao permitida")
		return
	}
	if in.ImageFromURL == "" && in.VideoFromURL != "" && !p.midiaPermitida(in.VideoFromURL) {
		erro(w, http.StatusBadRequest, "origem do video nao permitida")
		return
	}
	ped := core.PedidoMeta{Caminho: in.Path, Metodo: "GET", Parametros: map[string]any{}}
	for k, v := range in.Params {
		if v != nil {
			ped.Parametros[k] = v
		}
	}
	if m := strings.ToUpper(in.Method); m == "POST" || m == "DELETE" {
		ped.Metodo = m
	}
	prazo := 25 * time.Second
	switch {
	case in.ImageFromURL != "":
		ped.Metodo, ped.ImagemURL, ped.ImagemCampo, prazo = "POST", in.ImageFromURL, in.ImageField, 45*time.Second
	case in.VideoFromURL != "":
		ped.Metodo, ped.VideoURL, prazo = "POST", in.VideoFromURL, 75*time.Second
	}
	ctx, cancela := context.WithTimeout(r.Context(), prazo)
	defer cancela()
	// Sem repetição aqui (tentativas = 1): o gestor e os robôs já tentam de novo.
	resp, err := p.Core.Meta(ctx, ped, 1)
	if errors.Is(err, core.ErrSemToken) {
		erro(w, http.StatusServiceUnavailable, "core nao configurado")
		return
	}
	if err != nil {
		slog.Error("meta-proxy: sem resposta do core", "caminho", in.Path)
		erro(w, http.StatusInternalServerError, "falha ao falar com o core")
		return
	}
	var j any
	dj := json.NewDecoder(bytes.NewReader(resp.Corpo))
	dj.UseNumber() // números da Graph saem como entraram
	if dj.Decode(&j) != nil {
		j = map[string]any{"raw": string(resp.Corpo)}
	}
	// Erro do PRÓPRIO core vem em `erro` e volta como STRING em `error`: o gestor classifica
	// por aí (barrado antes da Meta = status < 500; desistiu no meio = 500).
	obj, eObj := j.(map[string]any)
	barrado := resp.Status >= 400 && resp.Status < 500 && resp.Status != 401 && resp.Status != 403
	if e, ok := obj["erro"]; eObj && ok {
		st := http.StatusInternalServerError
		if barrado {
			st = resp.Status
		}
		if resp.Status == http.StatusTooManyRequests && resp.RetryAfter != "" {
			w.Header().Set("Retry-After", resp.RetryAfter)
		}
		erro(w, st, fmt.Sprint(e))
		return
	}
	if _, temErro := obj["error"]; eObj && !temErro && resp.Status >= 400 {
		st := http.StatusInternalServerError
		if barrado {
			st = resp.Status
		}
		erro(w, st, fmt.Sprintf("core: %d", resp.Status))
		return
	}
	responder(w, resp.Status, j) // a Graph tal qual (inclusive {error:{...}} da Meta)
}
