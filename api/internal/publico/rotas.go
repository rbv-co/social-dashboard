// Package publico: a Vessel anônima e o que o Core encaminha, sem sessão de painel, no DIALETO DO SUPABASE: o Core e o
// site chamam hoje `rest/v1/rpc/<nome>` e `functions/v1/<edge>` com `Authorization: Bearer <chave>`; com os mesmos
// caminhos aqui, a virada troca só a base e a chave nos dois (a frase do próprio Core: cadastro.go).
//
//   - Chave do Core (VESSEL_INTERNO_SEGREDO, comparada em tempo constante): as 14 funções de escrita e as leituras,
//     `p_teste` vale e o IP do cliente é o X-Forwarded-For que ele manda.
//   - Qualquer outra chave (a anon do navegador, que aqui não vale nada): as leituras e contadores; as 14 de escrita só
//     enquanto VESSEL_SO_CORE for falso (o site no ar ainda as chama direto). `p_teste` é removido; o IP é o do nginx.
//   - JSON obrigatório (415, antes dos limitadores), limite por IP e teto global (429), corpo ≤ 32 KiB, lista fechada.
//
// As funções são as de produção (SECURITY DEFINER, com o teto por IP delas em vessel_teto_de_chamadas): rodam numa
// transação sem usuário e com `request.headers` trazendo o IP (vessel_hash_de_origem lê dali).
package publico

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/json"
	"io"
	"mime"
	"net"
	"net/http"
	"slices"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

const (
	// TetoCorpo: o mesmo teto do Core (cadastro.corpoMax).
	TetoCorpo = 32 << 10

	LimitePorIP    = 60
	JanelaPublica  = time.Minute
	TetoGlobal     = 3000
	TetoGlobalCore = 6000 // o Core é um chamador só: o teto é o disjuntor, o por-IP é das funções
	prazoDaChamada = 25 * time.Second
)

// Servico guarda o que as rotas precisam. Segredo vazio = ninguém é "o Core": só o anônimo.
type Servico struct {
	Pool    *pgxpool.Pool
	Segredo string   // VESSEL_INTERNO_SEGREDO
	SoCore  bool     // VESSEL_SO_CORE: as 14 de escrita só com a chave do Core
	Origens []string // CORS (ORIGENS_PERMITIDAS)

	// Tetos por minuto (0 = o padrão): por IP e global do anônimo, e o disjuntor do Core.
	PorIP, Global, DoCore int

	limIP, limGlobal, limCore *auth.Limitador
	Edges                     map[string]Edge // functions/v1/<nome>
}

// Edge é uma edge portada: recebe o pedido já limitado, com o IP e se quem chama é o Core.
type Edge func(w http.ResponseWriter, r *http.Request, ip string, ehCore bool)

func p(nome, tipo string) rpc.Param { return rpc.Param{Nome: nome, Tipo: tipo} }
func o(nome, tipo string) rpc.Param { return rpc.Param{Nome: nome, Tipo: tipo, Opcional: true} }

// nunca: estas declarações não passam por rpc.Novo (o portão é o do pacote); se alguém as registrar lá, ficam fechadas.
func nunca(*autz.Escopo) bool { return false }

func d(nome string, ps ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: ps, Retorno: rpc.Valor, Portao: nunca}
}

// Funcoes: os nomes de todas as funções do banco que as rotas e as edges chamam (as 14 de escrita, as 10 leituras e as
// 21 das duas edges): o `api worker conferir` as exige no banco restaurado antes da virada.
func Funcoes() []string {
	var nomes []string
	for _, l := range [][]rpc.Funcao{interno, publico, deEdge} {
		for _, f := range l {
			if !slices.Contains(nomes, f.Nome) {
				nomes = append(nomes, f.Nome)
			}
		}
	}
	return nomes
}

// dt: função `returns table`/`setof`, devolvida como lista JSON.
func dt(nome string, ps ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: ps, Retorno: rpc.Conjunto, Portao: nunca}
}

func porNome(l []rpc.Funcao) map[string]rpc.Funcao {
	m := make(map[string]rpc.Funcao, len(l))
	for _, f := range l {
		m[f.Nome] = f
	}
	return m
}

func novo(max int, janela time.Duration) *auth.Limitador {
	l := auth.NovoLimitador()
	l.Max, l.Janela = max, janela
	return l
}

// Montar registra as rotas no dialeto do Supabase. O preflight responde antes de tudo; o 415 vem antes dos
// limitadores (um <form> de outro site não gasta a cota de ninguém).
func (s *Servico) Montar(r chi.Router) {
	teto := func(v, padrao int) int {
		if v > 0 {
			return v
		}
		return padrao
	}
	s.limIP, s.limGlobal, s.limCore = novo(teto(s.PorIP, LimitePorIP), JanelaPublica), novo(teto(s.Global, TetoGlobal), JanelaPublica), novo(teto(s.DoCore, TetoGlobalCore), JanelaPublica)
	pub, internas := porNome(publico), porNome(interno)
	r.Route("/rest/v1/rpc", func(r chi.Router) {
		r.Use(s.cors)
		r.Options("/{nome}", func(http.ResponseWriter, *http.Request) {}) // o cors responde 204
		r.With(soJSON, s.limitar).Post("/{nome}", func(w http.ResponseWriter, r *http.Request) {
			core := s.ehCore(r)
			f, ok := pub[chi.URLParam(r, "nome")]
			if !ok && (core || !s.SoCore) {
				f, ok = internas[chi.URLParam(r, "nome")]
			}
			if !ok {
				dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
				return
			}
			s.chamar(w, r, f, s.ipDe(r, core), core)
		})
	})
	r.Route("/functions/v1", func(r chi.Router) {
		r.Use(s.cors)
		r.Options("/{edge}", func(http.ResponseWriter, *http.Request) {})
		r.With(soJSON, s.limitar).Post("/{edge}", func(w http.ResponseWriter, r *http.Request) {
			e, ok := s.Edges[chi.URLParam(r, "edge")]
			if !ok {
				dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
				return
			}
			core := s.ehCore(r)
			e(w, r, s.ipDe(r, core), core)
		})
	})
}

// Quem: o IP do cliente e se a chave é a do Core, para quem monta rotas irmãs com a mesma regra (o envio de currículo).
func (s *Servico) Quem(r *http.Request) (string, bool) {
	core := s.ehCore(r)
	return s.ipDe(r, core), core
}

// ehCore: Authorization: Bearer <segredo>, comparado em tempo constante (hash dos dois: tamanho fixo). Sem segredo
// configurado, ninguém é o Core.
func (s *Servico) ehCore(r *http.Request) bool {
	cab := r.Header.Get("Authorization")
	if s.Segredo == "" || !strings.HasPrefix(cab, "Bearer ") {
		return false
	}
	quer, tem := sha256.Sum256([]byte(s.Segredo)), sha256.Sum256([]byte(strings.TrimPrefix(cab, "Bearer ")))
	return subtle.ConstantTimeCompare(quer[:], tem[:]) == 1
}

// limitar: o Core tem só o disjuntor global; o anônimo, por IP e depois o teto global (quem estoura o seu IP não gasta
// o teto dos outros). Em memória, por instância.
func (s *Servico) limitar(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		core := s.ehCore(r)
		ok := false
		if core {
			ok = s.limCore.Tentar("core")
		} else {
			ok = s.limIP.Tentar(auth.IPDe(r)) && s.limGlobal.Tentar("global")
		}
		if !ok {
			w.Header().Set("Retry-After", "60")
			dados.Erro(w, http.StatusTooManyRequests, "muitas_requisicoes", "")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// ipDe: o IP do cliente. Do Core, o primeiro IP do X-Forwarded-For (ele o põe; só vale depois da chave); do anônimo,
// o que o nginx diz (auth.IPDe).
func (s *Servico) ipDe(r *http.Request, core bool) string {
	if core {
		for _, e := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
			if ip := net.ParseIP(strings.TrimSpace(e)); ip != nil {
				return ip.String()
			}
		}
	}
	return auth.IPDe(r)
}

// soJSON: 415 sem ler o corpo se o Content-Type não for application/json.
func soJSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
			dados.Erro(w, http.StatusUnsupportedMediaType, "tipo_de_conteudo", "Envie o pedido como application/json.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// cors: só as origens configuradas; preflight responde 204 sem tocar no banco.
func (s *Servico) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Vary", "Origin") // a resposta muda com a origem: cache não pode misturar
		if og := r.Header.Get("Origin"); og != "" {
			for _, ok := range s.Origens {
				if og == ok {
					w.Header().Set("Access-Control-Allow-Origin", og)
					w.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
					w.Header().Set("Access-Control-Allow-Headers", "apikey, authorization, content-type, x-client-info, prefer")
					w.Header().Set("Access-Control-Max-Age", "600")
				}
			}
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// corpoDe lê o corpo (objeto JSON, ≤ TetoCorpo; vazio vale {}) para o mapa de parâmetros.
func corpoDe(w http.ResponseWriter, r *http.Request) (map[string]json.RawMessage, bool) {
	bruto, err := io.ReadAll(http.MaxBytesReader(w, r.Body, TetoCorpo))
	if err != nil {
		dados.Erro(w, http.StatusRequestEntityTooLarge, "corpo_grande_demais", "")
		return nil, false
	}
	corpo := map[string]json.RawMessage{}
	if len(bytes.TrimSpace(bruto)) > 0 { // corpo vazio vale {} (função sem parâmetro)
		r.Body = io.NopCloser(bytes.NewReader(bruto))
		if !dados.LerCorpo(w, r, &corpo) {
			return nil, false
		}
	}
	return corpo, true
}

// chamar: monta e roda a função sem usuário, com o IP em request.headers. p_teste só vale com ehCore.
func (s *Servico) chamar(w http.ResponseWriter, r *http.Request, f rpc.Funcao, ip string, ehCore bool) {
	corpo, ok := corpoDe(w, r)
	if !ok {
		return
	}
	if !ehCore {
		delete(corpo, "p_teste")
	}
	ped, msg := f.Montar(corpo)
	if msg != "" {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", msg)
		return
	}
	ctx, cancela := context.WithTimeout(r.Context(), prazoDaChamada)
	defer cancela()
	var saida []byte
	err := banco.ComAnonimo(ctx, s.Pool, "anon", ip, r.UserAgent(), func(tx pgx.Tx) (err error) {
		saida, err = f.Rodar(ctx, tx, ped)
		return err
	})
	if err != nil {
		dados.ErroDoBanco(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(saida)
}
