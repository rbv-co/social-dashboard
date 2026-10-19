package acessos

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/microsoft"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
)

// Proxy do Acessos (Plano 07a): `POST /acessos-proxy {action, ...}`, a porta da edge acessos-proxy do Supabase, com as
// 29 ações (14 do Zoho, 15 da Microsoft) e as mesmas formas de resposta, porque a tela lê `r.error`/`r.ok`/`r.items` etc.
// A edge segue no ar: o rollback para o Supabase só desliga a área `acessos` no front.
//
// Portão: is_acessos_admin() (conta ativa e papel admin ou 'acessos' nas features). Ação que ESCREVE num provedor
// (convidar, tirar acesso, criar caixa, importar) recusa quem entrou como outra pessoa: a trilha sairia no nome do alvo.
type Proxy struct {
	Pool *pgxpool.Pool
	Zoho *zoho.Cliente
	MS   *microsoft.Cliente
	// Fotos grava a foto do Zoho no bucket acessos-avatars e devolve a URL pública; nil = o import segue sem foto.
	Fotos Fotos
	// APIPublica: a base pública da API (sem barra final), ex. https://socialdashboard.rbvcompany.com/api. É o host do
	// redirect_uri do OAuth (registrado no Zoho e no Azure); vazia, o authUrl recusa em vez de montar um endereço errado.
	APIPublica string
}

type Fotos interface {
	Gravar(ctx context.Context, caminho, tipo string, corpo []byte) (url string, err error)
}

// texto: string tolerante, como o JS da edge (número ou objeto no lugar do texto vira vazio, não erro de corpo).
type texto string

func (t *texto) UnmarshalJSON(b []byte) error {
	var s string
	if json.Unmarshal(b, &s) == nil {
		*t = texto(s)
	}
	return nil
}

// pedido: a união dos campos que as 29 ações leem. Campo desconhecido é ignorado (a edge também ignora).
type pedido struct {
	Action      texto           `json:"action"`
	Email       texto           `json:"email"`
	Password    texto           `json:"password"`
	FirstName   texto           `json:"firstName"`
	LastName    texto           `json:"lastName"`
	ItemID      texto           `json:"itemId"`
	PermID      texto           `json:"permId"`
	RecursoID   texto           `json:"recursoId"`
	Name        texto           `json:"name"`
	Caminho     texto           `json:"caminho"`
	Role        texto           `json:"role"`
	ResourceID  texto           `json:"resourceId"`
	Papel       texto           `json:"papel"`
	LinkID      texto           `json:"linkId"`
	PermissaoID texto           `json:"permissaoId"`
	Depth       json.RawMessage `json:"depth"`
	Items       json.RawMessage `json:"items"`
	Emails      json.RawMessage `json:"emails"`
}

// resposta: o status e o corpo JSON. Quase todo "erro" da edge é 200 com {error}: a tela lê o corpo.
type resposta struct {
	status int
	corpo  any
}

func ok(corpo any) resposta { return resposta{http.StatusOK, corpo} }

type mapa = map[string]any

func erro(status int, codigo string) resposta { return resposta{status, mapa{"error": codigo}} }

func erroComDetalhe(status int, codigo string, detalhe any) resposta {
	return resposta{status, mapa{"error": codigo, "detalhe": detalhe}}
}

var naoConectado = ok(mapa{"error": "nao_conectado"})

// falhaInterna: a edge devolvia `falha_interna` com a mensagem; aqui só mensagem de erro dos pacotes zoho e microsoft
// (sem segredo por construção) vai ao cliente; o resto fica no log.
func falhaInterna(acao string, err error) resposta {
	slog.Error("acessos-proxy", "acao", acao, "erro", err)
	d := ""
	if m := err.Error(); strings.HasPrefix(m, "zoho") || strings.HasPrefix(m, "microsoft") {
		d = m
	}
	return erroComDetalhe(http.StatusInternalServerError, "falha_interna", d)
}

// semConexao: o provedor não está conectado (nada a fazer) ou deu defeito de verdade.
func semConexao(acao string, err error) (resposta, bool) {
	if errors.Is(err, zoho.ErrDesconectado) || errors.Is(err, microsoft.ErrDesconectado) {
		return naoConectado, true
	}
	return resposta{}, false
}

type acao struct {
	f       func(x *Proxy, ctx context.Context, e *autz.Escopo, p pedido) resposta
	escreve bool
}

// acoes: as 29 do acessos-proxy. zoho.* em proxy_zoho.go, microsoft.* em proxy_microsoft.go (init de cada um).
var acoes = map[string]acao{}

func (x *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	e := autz.EscopoDo(r.Context())
	if e == nil {
		responder(w, erro(http.StatusInternalServerError, "erro_interno"))
		return
	}
	if !autz.AcessosAdmin(e) {
		responder(w, erro(http.StatusForbidden, "sem_permissao"))
		return
	}
	bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	var p pedido
	if err != nil || json.Unmarshal(bruto, &p) != nil {
		responder(w, erro(http.StatusBadRequest, "json_invalido"))
		return
	}
	a, existe := acoes[string(p.Action)]
	if !existe {
		var nome any = string(p.Action)
		if p.Action == "" {
			nome = nil
		}
		responder(w, resposta{http.StatusBadRequest, mapa{"error": "acao_desconhecida", "action": nome}})
		return
	}
	if at := auth.AtorDoContexto(r.Context()); a.escreve && (at == nil || at.ImpersonadorID != nil) {
		responder(w, resposta{http.StatusForbidden, mapa{"error": "sem_permissao",
			"mensagem": "Quem entrou como outra pessoa não grava em Colaboradores e Acessos."}})
		return
	}
	responder(w, a.f(x, r.Context(), e, p))
}

func responder(w http.ResponseWriter, r resposta) {
	b, err := json.Marshal(r.corpo)
	if err != nil {
		slog.Error("acessos-proxy: resposta", "erro", err)
		http.Error(w, `{"error":"erro_interno"}`, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(r.status)
	w.Write(b)
}

// trilha grava em acessos_log (resultado só aceita ok/erro: o 'parcial' da edge nunca chegou ao banco). Falha de log
// não derruba a ação, como na edge.
func (x *Proxy) trilha(ctx context.Context, quem, acao, provedor string, alvo *string, resultado string, detalhe any) {
	d, _ := json.Marshal(detalhe)
	if s, ok := detalhe.(string); ok {
		d = []byte(s)
	}
	var q *string
	if quem != "" {
		q = &quem
	}
	if _, err := x.Pool.Exec(context.WithoutCancel(ctx), `insert into acessos_log (quem, acao, provedor, alvo, resultado, detalhe) values ($1, $2, $3, $4, $5, $6)`,
		q, acao, provedor, alvo, resultado, string(d)); err != nil {
		slog.Warn("acessos-proxy: log falhou", "acao", acao, "erro", err)
	}
}

func ptr(s string) *string { return &s }

// URLs de retorno do OAuth: precisam ser as registradas no Zoho e no Azure.
func (x *Proxy) callback(provedor string) string {
	return strings.TrimRight(x.APIPublica, "/") + "/acessos-oauth/callback/" + provedor
}
