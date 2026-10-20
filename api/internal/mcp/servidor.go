package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// prazoDaFerramenta: o mesmo PrazoDominio do grupo de domínio de web.Rotas.
const prazoDaFerramenta = 30 * time.Second

var versoes = []string{"2025-06-18", "2025-03-26", "2024-11-05"}

// Servidor é o POST /mcp: Streamable HTTP SEM estado (cada POST é uma mensagem JSON-RPC e a resposta é JSON; sem
// SSE nem Mcp-Session-Id), que é o que o ChatGPT usa para ferramentas.
type Servidor struct {
	Pool     *pgxpool.Pool
	Sessoes  *auth.Store
	Emissor  string
	interno  http.Handler
	catalogo *catalogo
}

// Dominio: o que o MCP monta por dentro. Montar põe as MESMAS rotas de domínio do painel (web.Rotas) e Avisar é o
// handler de POST /avisar-decisao-de-reserva (frota.Reserva); RPCs e Contrato descrevem as tabelas e funções ao modelo.
type Dominio struct {
	Montar   func(chi.Router)
	Avisar   http.Handler
	RPCs     []rpc.Funcao
	Contrato []byte // contrato_front.json: tabela → rota, como a tela
}

// NovoServidor monta, por dentro, as rotas de domínio do painel atrás do mesmo autz.ComEscopo: cada ferramenta é
// uma requisição a elas, com a autorização do catálogo, os gatilhos e as frases de erro de sempre. Rota nova de
// domínio entra sozinha, e quem não pode na tela não pode aqui.
func NovoServidor(p *pgxpool.Pool, s *auth.Store, emissor string, d Dominio) *Servidor {
	r := chi.NewRouter()
	r.Use(autz.ComEscopo(p))
	d.Montar(r)
	r.With(auth.ExigirPermissao("frota.aprovar", "ver"), dados.SoSessaoPropria(dados.FraseEntrarComo)).
		Post("/avisar-decisao-de-reserva", d.Avisar.ServeHTTP)
	cat, err := montarCatalogo(r, d.Contrato, d.RPCs)
	if err != nil {
		panic(err) // contrato ilegível: a API não sobe
	}
	return &Servidor{Pool: p, Sessoes: s, Emissor: emissor, interno: r, catalogo: cat}
}

type mensagem struct {
	Versao string          `json:"jsonrpc"`
	ID     json.RawMessage `json:"id,omitempty"`
	Metodo string          `json:"method"`
	Params json.RawMessage `json:"params,omitempty"`
}

type erroRPC struct {
	Codigo   int    `json:"code"`
	Mensagem string `json:"message"`
}

func (s *Servidor) naoAutenticado(w http.ResponseWriter) {
	w.Header().Set("WWW-Authenticate", `Bearer resource_metadata="`+s.Emissor+`/.well-known/oauth-protected-resource/mcp", scope="`+escopo+`"`)
	responderJSON(w, http.StatusUnauthorized, map[string]string{"error": "nao_autenticado"})
}

func (s *Servidor) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		http.Error(w, "use POST", http.StatusMethodNotAllowed)
		return
	}
	tok, ok := bytes.CutPrefix([]byte(r.Header.Get("Authorization")), []byte("Bearer "))
	if !ok || len(tok) == 0 {
		s.naoAutenticado(w)
		return
	}
	se, err := s.Sessoes.Buscar(r.Context(), string(tok))
	if errors.Is(err, auth.ErrSessaoInvalida) || (err == nil && se.Tipo != "mcp") {
		// sessão do painel aqui não: o token do ChatGPT e o da tela são portas diferentes
		s.naoAutenticado(w)
		return
	}
	if err != nil {
		responderJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro_interno"})
		return
	}
	// Dentro desta porta a pessoa age como no painel (o Ator de tipo 'mcp' não passaria em Pode), e só nas rotas
	// de domínio montadas em NovoServidor: cada uma confere a permissão dela, na hora (tirar acesso vale já). A sessão
	// 'mcp' nunca é de "entrar como" (constraint no banco) e só nasce do consentimento de conta do painel (SoPainel).
	painel := *se
	painel.Tipo = "painel"
	a, err := auth.CarregarAtor(r.Context(), s.Pool, &painel)
	if err != nil {
		responderJSON(w, http.StatusInternalServerError, map[string]string{"error": "erro_interno"})
		return
	}
	var m mensagem
	if json.NewDecoder(http.MaxBytesReader(w, r.Body, 256<<10)).Decode(&m) != nil || m.Versao != "2.0" || m.Metodo == "" {
		responderJSON(w, http.StatusBadRequest, map[string]any{"jsonrpc": "2.0", "id": nil,
			"error": erroRPC{-32700, "mensagem JSON-RPC inválida (lote não é aceito)"}})
		return
	}
	if m.ID == nil { // notificação (notifications/initialized etc.): nada a responder
		w.WriteHeader(http.StatusAccepted)
		return
	}
	res, e := s.responder(auth.NoContexto(r.Context(), a), m)
	if e != nil {
		responderJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": m.ID, "error": e})
		return
	}
	responderJSON(w, http.StatusOK, map[string]any{"jsonrpc": "2.0", "id": m.ID, "result": res})
}

func (s *Servidor) responder(ctx context.Context, m mensagem) (any, *erroRPC) {
	switch m.Metodo {
	case "initialize":
		var p struct {
			Versao string `json:"protocolVersion"`
		}
		json.Unmarshal(m.Params, &p)
		v := versoes[0]
		if slices.Contains(versoes, p.Versao) {
			v = p.Versao
		}
		return map[string]any{"protocolVersion": v, "capabilities": map[string]any{"tools": map[string]any{}},
			"serverInfo":   map[string]string{"name": "central-rbv", "title": "Central RBV", "version": "2"},
			"instructions": instrucoes}, nil
	case "ping":
		return map[string]any{}, nil
	case "tools/list":
		lista := make([]map[string]any, len(ferramentas))
		for i, f := range ferramentas {
			lista[i] = map[string]any{"name": f.nome, "title": f.titulo, "description": f.descricao,
				"inputSchema": json.RawMessage(f.esquema),
				"annotations": map[string]bool{"readOnlyHint": f.leitura, "destructiveHint": f.destrutiva, "openWorldHint": false}}
		}
		return map[string]any{"tools": lista}, nil
	case "tools/call":
		var p struct {
			Nome string          `json:"name"`
			Args json.RawMessage `json:"arguments"`
		}
		if json.Unmarshal(m.Params, &p) != nil {
			return nil, &erroRPC{-32602, "params inválidos"}
		}
		i := slices.IndexFunc(ferramentas, func(f ferramenta) bool { return f.nome == p.Nome })
		if i < 0 {
			return nil, &erroRPC{-32602, "ferramenta desconhecida: " + p.Nome}
		}
		if len(p.Args) == 0 || string(p.Args) == "null" {
			p.Args = json.RawMessage("{}")
		}
		ctx, cancela := context.WithTimeout(ctx, prazoDaFerramenta)
		defer cancela()
		texto, falhou := ferramentas[i].rodar(chamada{s: s, ctx: ctx}, p.Args)
		return map[string]any{"content": []map[string]string{{"type": "text", "text": texto}}, "isError": falhou}, nil
	}
	return nil, &erroRPC{-32601, "método não suportado: " + m.Metodo}
}

// chamada: o que uma ferramenta usa para falar com as rotas internas.
type chamada struct {
	s   *Servidor
	ctx context.Context
}

// pedir faz a requisição interna e devolve status e corpo. corpo nil = sem corpo.
func (c chamada) pedir(metodo, caminho string, q url.Values, corpo any) (int, []byte) {
	var b *bytes.Reader
	if corpo == nil {
		b = bytes.NewReader(nil)
	} else {
		j, err := json.Marshal(corpo)
		if err != nil {
			return http.StatusBadRequest, []byte(`{"mensagem":"argumentos inválidos"}`)
		}
		b = bytes.NewReader(j)
	}
	if len(q) > 0 {
		caminho += "?" + q.Encode()
	}
	// sem o RouteContext do POST /mcp: com ele o chi interno se comportaria como sub-roteador montado e herdaria o
	// método e o caminho de fora (um GET virava o POST de escrita da mesma rota)
	ctx := context.WithValue(c.ctx, chi.RouteCtxKey, (*chi.Context)(nil))
	r, err := http.NewRequestWithContext(ctx, metodo, caminho, b)
	if err != nil {
		return http.StatusBadRequest, []byte(`{"mensagem":"caminho inválido"}`)
	}
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder() // ResponseWriter em memória da stdlib: a resposta volta para o modelo, não para a rede
	c.s.interno.ServeHTTP(w, r)
	return w.Code, w.Body.Bytes()
}
