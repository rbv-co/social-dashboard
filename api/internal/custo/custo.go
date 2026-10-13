// Package custo é a fatura real das contas de IA, portada das edges custo-anthropic e custo-openai
// (supabase/functions/custo-*/index.ts): POST /custo-anthropic e POST /custo-openai, só para quem
// tem papel admin. A chave admin de cada fornecedor vem de variável de ambiente e nunca sai em log,
// erro ou resposta; as chamadas não seguem redirecionamento (o cabeçalho com a chave iria junto).
package custo

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"maps"
	"math"
	"math/big"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// Cambio: US$ → R$, o mesmo das edges e dos robôs (custo-anthropic/index.ts:17, custo-openai/index.ts:45).
const Cambio = 5.5

const isoSegundos = "2006-01-02T15:04:05Z"

// Janela é [Inicio, Fim) em UTC; Fim é a meia-noite UTC de amanhã (o dia de hoje entra inteiro).
type Janela struct{ Inicio, Fim time.Time }

// janelaDe é a régua das edges (custo-anthropic/index.ts:161-166): Math.min(90, Math.max(1, dias)).
func janelaDe(dias float64, agora time.Time) Janela {
	dias = math.Min(90, math.Max(1, dias))
	a := agora.UTC()
	fim := time.Date(a.Year(), a.Month(), a.Day()+1, 0, 0, 0, 0, time.UTC)
	return Janela{Inicio: fim.Add(-time.Duration(dias * float64(24*time.Hour))), Fim: fim}
}

type Dia struct {
	Data string  `json:"data"`
	Usd  float64 `json:"usd"`
}

type Categoria struct {
	Item string  `json:"item"`
	Usd  float64 `json:"usd"`
}

// Fatura é a resposta das edges, campo a campo e na mesma ordem.
type Fatura struct {
	Desde        string      `json:"desde"`
	Ate          string      `json:"ate"`
	Cambio       float64     `json:"cambio"`
	TotalUsd     float64     `json:"totalUsd"`
	TotalBrl     float64     `json:"totalBrl"`
	Dias         []Dia       `json:"dias"`
	PorCategoria []Categoria `json:"porCategoria"`
	PorChave     any         `json:"porChave"` // Anthropic: []ChaveRateada; OpenAI: []ChaveReal (nunca nil)
}

// somaDosDias é o reduce das edges: soma NA ORDEM dos dias (a ordem muda o último bit do float).
func somaDosDias(dias []Dia) float64 {
	soma := 0.0
	for _, d := range dias {
		soma += d.Usd
	}
	return soma
}

// novaFatura soma os dias NA ORDEM (o reduce das edges) e arredonda como o toFixed. Lista vazia sai
// [] (nunca null: a tela faz Array.isArray).
func novaFatura(j Janela, dias []Dia, cats []Categoria, porChave any) Fatura {
	soma := somaDosDias(dias)
	if dias == nil {
		dias = []Dia{}
	}
	if cats == nil {
		cats = []Categoria{}
	}
	return Fatura{Desde: j.Inicio.UTC().Format(time.DateOnly), Ate: j.Fim.UTC().Format(time.DateOnly), Cambio: Cambio,
		TotalUsd: fixo(soma, 4), TotalBrl: fixo(soma*Cambio, 2), Dias: dias, PorCategoria: cats, PorChave: porChave}
}

// fixo é o Number(x.toFixed(casas)) do JS: arredonda o valor EXATO do float (não o decimal que se lê),
// empate para longe do zero, e devolve o float mais próximo do decimal. Zero sai sem sinal (o JSON da
// edge escrevia 0, nunca -0). Ex.: 13.35*5.5 = 73.42499… → 73.42 (Math.round(x*100)/100 daria 73.43).
func fixo(x float64, casas int) float64 {
	if math.IsNaN(x) || math.IsInf(x, 0) {
		return x // não acontece (numero recusa); responder transforma em erro, nunca em null
	}
	esc := new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(casas)), nil)
	r := new(big.Rat).SetFloat64(math.Abs(x))
	r.Mul(r, new(big.Rat).SetInt(esc)).Add(r, big.NewRat(1, 2))
	n := new(big.Int).Quo(r.Num(), r.Denom()) // piso (r ≥ 0)
	f, _ := new(big.Rat).SetFrac(n, esc).Float64()
	if f == 0 {
		return 0
	}
	return math.Copysign(f, x)
}

// numero é o Number(v ?? 0) do JS para o que as APIs mandam: número, texto numérico (o amount da
// Anthropic é texto decimal) ou nulo/ausente (= 0). Outra coisa é resposta inesperada — nunca NaN.
func numero(v any) (float64, error) {
	switch x := v.(type) {
	case nil:
		return 0, nil
	case float64:
		return x, nil
	case string:
		s := strings.TrimSpace(x)
		if s == "" {
			return 0, nil // Number("") = 0
		}
		if f, err := strconv.ParseFloat(s, 64); err == nil && !math.IsInf(f, 0) && !math.IsNaN(f) {
			return f, nil
		}
	}
	return 0, errors.New("número inválido")
}

// texto é o String(v) do JS para os nomes que as APIs mandam (nulo = "").
func texto(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	}
	return fmt.Sprint(v)
}

// primeiros: os n primeiros caracteres (o .slice(0, n) das edges, para datas ISO).
func primeiros(s string, n int) string {
	if r := []rune(s); len(r) > n {
		return string(r[:n])
	}
	return s
}

// somas acumula por nome na ordem em que o nome apareceu (a ordem do Object.entries das edges;
// ponytail: o JS põe antes as chaves que parecem inteiros, e nenhum nome destas APIs é assim).
type somas struct {
	nomes []string
	v     map[string]float64
}

func (s *somas) somar(nome string, x float64) {
	if s.v == nil {
		s.v = map[string]float64{}
	}
	if _, ok := s.v[nome]; !ok {
		s.nomes = append(s.nomes, nome)
	}
	s.v[nome] += x
}

// maiorPrimeiro ordena do maior valor para o menor; empate fica na ordem de chegada (o sort do JS é estável).
func maiorPrimeiro[T any](l []T, valor func(T) float64) {
	slices.SortStableFunc(l, func(a, b T) int { return cmp.Compare(valor(b), valor(a)) })
}

// cliente faz os GETs na API admin de UM fornecedor com a política de nova tentativa da edge
// custo-openai (_shared/tentar-de-novo.js:82-138).
type cliente struct {
	fornecedor       string // "Anthropic" | "OpenAI": entra nas frases e no log
	chave            string
	cabecalho        func(h http.Header, chave string)
	http             *http.Client
	prazo, orcamento time.Duration // por tentativa / pela chamada inteira
	pausa            func(context.Context, time.Duration) error
}

// semRedirecionar: 3xx volta como resposta (e vira erro); seguir levaria o cabeçalho com a chave
// a outro endereço (x-api-key é cabeçalho comum: o cliente do Go o repassaria).
var semRedirecionar = &http.Client{CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}

func esperar(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

func (c cliente) inesperada() error {
	return errors.New("Resposta inesperada do " + c.fornecedor + ".")
}

// getJSON busca endereco e decodifica a resposta 2xx em destino. O erro é a frase da edge para a
// pessoa: sem a chave, sem o endereço e sem o corpo do fornecedor (o corpo, com a chave mascarada
// e cortado, só vai para o log).
func (c cliente) getJSON(ctx context.Context, endereco, rotulo string, destino any) error {
	comecou := time.Now()
	for tentativa := 1; ; tentativa++ {
		status, retryAfter, corpo, err := c.uma(ctx, endereco)
		if err == nil && status >= 200 && status < 300 {
			if json.Unmarshal(corpo, destino) != nil {
				slog.Warn("custo: resposta fora do formato", "fornecedor", c.fornecedor, "rotulo", rotulo)
				return c.inesperada()
			}
			return nil
		}
		if err != nil {
			status = 0
			slog.Warn("custo: tentativa sem resposta", "fornecedor", c.fornecedor, "rotulo", rotulo, "tentativa", tentativa,
				"prazo", errors.Is(err, context.DeadlineExceeded))
		} else {
			slog.Warn("custo: tentativa recusada", "fornecedor", c.fornecedor, "rotulo", rotulo, "tentativa", tentativa, "status", status,
				"corpo", primeiros(strings.ReplaceAll(string(corpo), c.chave, "***"), 200))
		}
		repetir, espera, motivo := decidir(c.fornecedor, tentativa, status, time.Since(comecou), retryAfter, c.prazo, c.orcamento)
		if !repetir {
			return errors.New(fraseDeDesistencia(motivo, tentativa, c.fornecedor))
		}
		if c.pausa(ctx, espera) != nil {
			return errors.New(fraseDeDesistencia("o prazo desta chamada acabou", tentativa, c.fornecedor))
		}
	}
}

// uma faz UMA tentativa com prazo próprio. status 0 = não houve resposta.
func (c cliente) uma(ctx context.Context, endereco string) (status int, retryAfter time.Duration, corpo []byte, err error) {
	ctx, cancela := context.WithTimeout(ctx, c.prazo)
	defer cancela()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endereco, nil)
	if err != nil {
		return 0, 0, nil, err
	}
	c.cabecalho(req.Header, c.chave)
	resp, err := c.http.Do(req)
	if err != nil {
		return 0, 0, nil, err
	}
	defer resp.Body.Close()
	if corpo, err = io.ReadAll(io.LimitReader(resp.Body, 10<<20)); err != nil {
		return 0, 0, nil, err
	}
	if s, e := strconv.ParseFloat(resp.Header.Get("Retry-After"), 64); e == nil && s > 0 {
		retryAfter = time.Duration(math.Min(s, 3600) * float64(time.Second))
	}
	return resp.StatusCode, retryAfter, corpo, nil
}

// decidir é o decidirRepeticao da edge (_shared/tentar-de-novo.js:82-128), com o prazo e o orçamento
// do fornecedor. ponytail: mesma política de core.decidir (Bling, não exportada); unificar no 3º uso.
func decidir(f string, tentativa, status int, decorrido, retryAfter, prazo, orcamento time.Duration) (bool, time.Duration, string) {
	if status != 0 && status != 429 && status < 500 {
		return false, 0, "o " + f + " respondeu, e a resposta é essa"
	}
	if tentativa >= 3 {
		return false, 0, "já tentei 3 vezes"
	}
	espera := (600 * time.Millisecond) << (tentativa - 1)
	if status == 429 && retryAfter > espera {
		espera = retryAfter
	}
	if decorrido+espera+prazo > orcamento {
		return false, 0, "não caberia outra tentativa no tempo desta chamada"
	}
	return true, espera, ""
}

// fraseDeDesistencia é a da edge (_shared/tentar-de-novo.js:133-137), palavra por palavra.
func fraseDeDesistencia(motivo string, tentativas int, f string) string {
	vez := "vezes"
	if tentativas == 1 {
		vez = "vez"
	}
	return fmt.Sprintf("Não consegui falar com o %s agora (%s). Tentei %d %s. Tente de novo em instantes; se continuar, o %s está fora do ar.",
		f, motivo, tentativas, vez, f)
}

// pagina é o envelope das duas APIs: {data: [{…, results: […]}], has_more, next_page}.
type pagina struct {
	Data []struct {
		StartingAt   any              `json:"starting_at"`    // Anthropic
		StartTime    any              `json:"start_time"`     // OpenAI (segundos Unix)
		StartTimeISO any              `json:"start_time_iso"` // OpenAI
		Results      []map[string]any `json:"results"`
	} `json:"data"`
	HasMore  bool    `json:"has_more"`
	NextPage *string `json:"next_page"`
}

// paginas busca endereco?q e segue next_page enquanto has_more, no máximo 50 páginas (a trava
// `while (page && ++guarda < 50)` das edges). Erro de `cada` = erro da busca inteira.
func (c cliente) paginas(ctx context.Context, endereco string, q url.Values, rotulo string, cada func(pagina) error) error {
	proxima := ""
	for range 50 {
		qp := maps.Clone(q)
		if qp == nil {
			qp = url.Values{}
		}
		if proxima != "" {
			qp.Set("page", proxima)
		}
		var p pagina
		if err := c.getJSON(ctx, endereco+"?"+qp.Encode(), rotulo, &p); err != nil {
			return err
		}
		if err := cada(p); err != nil {
			return err
		}
		if !p.HasMore || p.NextPage == nil || *p.NextPage == "" {
			return nil
		}
		proxima = *p.NextPage
	}
	return nil
}

// Rota é POST /custo-anthropic e POST /custo-openai com o contrato das edges.
type Rota struct {
	Chave  string // ANTHROPIC_ADMIN_KEY / OPENAI_ADMIN_KEY
	Buscar func(ctx context.Context, chave string, j Janela) (Fatura, error)
	Agora  func() time.Time // nil = time.Now (o teste fixa o relógio)
}

func (rt Rota) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	// O portão das edges (custo-anthropic/index.ts:150-153): profiles.role = 'admin', ANTES de ler o
	// corpo, a chave ou chamar o fornecedor. Super-admin pela ficha e claude.status NÃO abrem (Ruling 8).
	a := auth.AtorDoContexto(r.Context())
	if a == nil || a.Tipo != "painel" || a.Papel != "admin" {
		responder(w, http.StatusForbidden, erroDaEdge{Error: "sem_permissao"})
		return
	}
	var p struct {
		Dias *float64 `json:"dias"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&p); err != nil && !errors.Is(err, io.EOF) {
		responder(w, http.StatusBadRequest, erroDaEdge{Error: "pedido_invalido"})
		return
	}
	dias := 30.0
	if p.Dias != nil {
		dias = *p.Dias
	}
	if rt.Chave == "" {
		slog.Warn("custo: devolvendo 500", "rota", r.URL.Path, "detalhe", "chave_admin_nao_configurada")
		responder(w, http.StatusInternalServerError, erroDaEdge{"falha", "chave_admin_nao_configurada"})
		return
	}
	agora := time.Now
	if rt.Agora != nil {
		agora = rt.Agora
	}
	f, err := rt.Buscar(r.Context(), rt.Chave, janelaDe(dias, agora()))
	if err != nil {
		// a frase já vem sem a chave (getJSON); o ReplaceAll é a última barreira. A API não tem log de
		// acesso: sem este aviso, o erro que nasce fora do getJSON (valor ilegível) não deixaria rastro.
		detalhe := strings.ReplaceAll(err.Error(), rt.Chave, "***")
		slog.Warn("custo: devolvendo 500", "rota", r.URL.Path, "detalhe", detalhe)
		responder(w, http.StatusInternalServerError, erroDaEdge{"falha", detalhe})
		return
	}
	responder(w, http.StatusOK, f)
}

// erroDaEdge é o corpo de erro das edges, com "error" antes de "detalhe" (um map sairia em ordem alfabética).
type erroDaEdge struct {
	Error   string `json:"error"`
	Detalhe string `json:"detalhe,omitempty"`
}

func responder(w http.ResponseWriter, status int, v any) {
	b, err := json.Marshal(v)
	if err != nil { // número não finito: erro, nunca null no lugar do valor
		status, b = http.StatusInternalServerError, []byte(`{"error":"falha","detalhe":"resposta inesperada do fornecedor"}`)
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	w.Write(b)
}
