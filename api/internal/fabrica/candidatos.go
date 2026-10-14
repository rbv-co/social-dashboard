package fabrica

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var reDeposito = regexp.MustCompile(`^[0-9]{1,18}$`)

type pedidoCandidatos struct {
	Lojas   []string        `json:"lojas"`
	Fonte   string          `json:"fonte"`
	Filtros json.RawMessage `json:"filtros"`
}

type filtrosCandidatos struct {
	Faixa      string    `json:"faixa"`
	Quadrantes *[]string `json:"quadrantes"`
	Categoria  string    `json:"categoria"`
	Termo      string    `json:"termo"`
}

// candidato: o formato da edge. sku/nome/categoria vêm crus do briefing (texto, número ou nulo); ausente
// some do JSON, como o JSON.stringify da edge fazia com undefined.
type candidato struct {
	SKU       json.RawMessage            `json:"sku"`
	Nome      json.RawMessage            `json:"nome,omitempty"`
	Categoria json.RawMessage            `json:"categoria,omitempty"`
	PorLoja   map[string]json.RawMessage `json:"porLoja"`
}

type lojaDaFabrica struct {
	deposito, nome string
	canal          *string
}

// Candidatos: POST /fabrica-candidatos. Portão (soFabricante) na montagem; só lê.
type Candidatos struct{ Pool *pgxpool.Pool }

func (cs *Candidatos) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	var c pedidoCandidatos
	if !dados.LerCorpo(w, r, &c) {
		return
	}
	var f filtrosCandidatos
	if len(c.Filtros) > 0 && !nulo(c.Filtros) {
		if !objeto(c.Filtros) || json.Unmarshal(c.Filtros, &f) != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "filtros é um objeto com faixa, quadrantes, categoria e termo.")
			return
		}
	}
	if len(c.Lojas) > 20 {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "No máximo 20 lojas.")
		return
	}
	for _, l := range c.Lojas {
		if !reDeposito.MatchString(l) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "lojas são ids de depósito.")
			return
		}
	}
	if !slices.Contains([]string{"oportunidades", "garimpo", "bcg", "abc", "manual"}, c.Fonte) {
		responder(w, http.StatusBadRequest, map[string]string{"error": "fonte_invalida"})
		return
	}
	ctx := r.Context()
	lojas, err := lojasDaFabrica(ctx, cs.Pool, c.Lojas)
	var out []candidato
	if err == nil {
		switch c.Fonte {
		case "oportunidades", "garimpo":
			out, err = doBriefing(ctx, cs.Pool, c.Fonte, lojas)
		case "bcg", "abc":
			out, err = deVendas(ctx, cs.Pool, c.Fonte, lojas, f)
		default:
			out, err = manual(ctx, cs.Pool, lojas, f)
		}
	}
	if err != nil {
		dados.ErroDoBanco(w, err)
		return
	}
	if out == nil {
		out = []candidato{}
	}
	responder(w, http.StatusOK, map[string]any{"candidatos": out})
}

// lojasDaFabrica: as pedidas que existem em fabrica_lojas, na ordem do pedido e sem repetição (Ruling 5.8-10).
func lojasDaFabrica(ctx context.Context, p *pgxpool.Pool, pedidas []string) ([]lojaDaFabrica, error) {
	linhas, err := p.Query(ctx, `select deposito_id, nome, canal_loja_id from fabrica_lojas where deposito_id = any($1::text[])`, pedidas)
	if err != nil {
		return nil, err
	}
	cfg := map[string]lojaDaFabrica{}
	var l lojaDaFabrica
	if _, err := pgx.ForEachRow(linhas, []any{&l.deposito, &l.nome, &l.canal}, func() error {
		cfg[l.deposito] = l
		return nil
	}); err != nil {
		return nil, err
	}
	var out []lojaDaFabrica
	for _, d := range pedidas {
		if x, ok := cfg[d]; ok {
			out = append(out, x)
			delete(cfg, d)
		}
	}
	return out, nil
}

func depositos(lojas []lojaDaFabrica) []int64 {
	var out []int64
	for _, l := range lojas {
		if n, err := strconv.ParseInt(l.deposito, 10, 64); err == nil {
			out = append(out, n)
		}
	}
	return out
}

func canais(lojas []lojaDaFabrica) []int64 {
	var out []int64
	for _, l := range lojas {
		if l.canal != nil {
			if n, err := strconv.ParseInt(*l.canal, 10, 64); err == nil {
				out = append(out, n)
			}
		}
	}
	return out
}

// estoques: "<depósito>|<sku>" → saldo, só dos depósitos da Fábrica pedidos.
func estoques(ctx context.Context, p *pgxpool.Pool, lojas []lojaDaFabrica) (map[string]int64, error) {
	linhas, err := p.Query(ctx, `select deposito_id::text, sku, saldo::bigint from gc_estoque_item
		where deposito_id = any($1::bigint[])`, depositos(lojas))
	if err != nil {
		return nil, err
	}
	out := map[string]int64{}
	var dep, sku string
	var saldo int64
	_, err = pgx.ForEachRow(linhas, []any{&dep, &sku, &saldo}, func() error {
		out[dep+"|"+sku] = saldo
		return nil
	})
	return out, err
}

func porLojaDoEstoque(lojas []lojaDaFabrica, est map[string]int64, sku string) map[string]json.RawMessage {
	out := map[string]json.RawMessage{}
	for _, l := range lojas {
		if n := est[l.deposito+"|"+sku]; n > 0 {
			out[l.deposito], _ = json.Marshal(map[string]any{"preco": nil, "pctPrevisto": nil, "precoComDesconto": nil, "estoque": n})
		}
	}
	return out
}

// bcgClass: a de supabase/functions/fabrica-candidatos/index.ts:4-10 (espelho do lib do coletor). Com d = 0
// (gc_* não tem a data da última venda), "recente" é sempre verdadeiro: Abacaxi nunca sai, como na edge.
func bcgClass(e, g, d float64) string {
	st := g / math.Max(1, g+e)
	recente := !math.IsNaN(d) && !math.IsInf(d, 0) && d <= 21
	switch {
	case g > 0 && st >= 0.5:
		return "Estrela"
	case g > 0 && st >= 0.25:
		return "Vaca leiteira"
	case recente || g > 0:
		return "Interrogação"
	}
	return "Abacaxi"
}

// textoJS: String(x) do JavaScript para o que a edge comparava (bloco.loja).
func textoJS(v json.RawMessage) string {
	if len(v) == 0 {
		return "undefined"
	}
	if s, ok := texto(v); ok {
		return s
	}
	return string(v)
}

func doBriefing(ctx context.Context, p *pgxpool.Pool, fonte string, lojas []lojaDaFabrica) ([]candidato, error) {
	var bruto []byte
	err := p.QueryRow(ctx, `select dados_json -> $1::text from gestao_comercial_briefings
		order by rodada desc, created_at desc limit 1`, fonte).Scan(&bruto)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var blocos []struct {
		Loja  json.RawMessage              `json:"loja"`
		Itens []map[string]json.RawMessage `json:"itens"`
	}
	if len(bruto) == 0 || json.Unmarshal(bruto, &blocos) != nil {
		return nil, nil // sem o bloco ou fora do formato [{loja, itens}]: nada (a edge quebraria com 500)
	}
	idx := map[string]int{}
	var out []candidato
	campos := [][2]string{{"precoOriginal", "preco"}, {"pct", "pctPrevisto"}, {"precoComDesconto", "precoComDesconto"}, {"estoqueLoja", "estoque"}}
	for _, b := range blocos {
		alvo := strings.ToLower(textoJS(b.Loja))
		dep := ""
		for _, l := range lojas {
			if strings.Contains(strings.ToLower(l.nome), alvo) {
				dep = l.deposito
				break
			}
		}
		if dep == "" {
			continue
		}
		for _, it := range b.Itens {
			sku, tem := it["sku"]
			if !tem || nulo(sku) {
				continue
			}
			chave := textoJS(sku)
			i, visto := idx[chave]
			if !visto {
				i, idx[chave] = len(out), len(out)
				out = append(out, candidato{SKU: sku, Nome: it["descricao"], Categoria: it["categoria"], PorLoja: map[string]json.RawMessage{}})
			}
			info := map[string]json.RawMessage{}
			for _, c := range campos {
				if v, tem := it[c[0]]; tem {
					info[c[1]] = v
				}
			}
			out[i].PorLoja[dep], _ = json.Marshal(info)
		}
	}
	return out, nil
}

type agregado struct {
	sku                   string
	nome, categoria       *string
	faturamento, unidades float64
}

func deVendas(ctx context.Context, p *pgxpool.Pool, fonte string, lojas []lojaDaFabrica, f filtrosCandidatos) ([]candidato, error) {
	est, err := estoques(ctx, p, lojas)
	if err != nil {
		return nil, err
	}
	linhas, err := p.Query(ctx, `select sku, produto, categoria, unidades::float8, faturamento::float8 from gc_vendas_item
		where canal_loja_id = any($1::bigint[]) order by sku, canal_loja_id, mes`, canais(lojas))
	if err != nil {
		return nil, err
	}
	var arr []*agregado
	idx := map[string]*agregado{}
	var sku string
	var nome, categoria *string
	var un, fat float64
	if _, err := pgx.ForEachRow(linhas, []any{&sku, &nome, &categoria, &un, &fat}, func() error {
		a := idx[sku]
		if a == nil {
			a = &agregado{sku: sku, nome: nome, categoria: categoria}
			idx[sku] = a
			arr = append(arr, a)
		}
		a.faturamento += fat
		a.unidades += un
		return nil
	}); err != nil {
		return nil, err
	}
	if fonte == "abc" {
		sort.SliceStable(arr, func(i, j int) bool { return arr[i].faturamento > arr[j].faturamento })
		total := 0.0
		for _, a := range arr {
			total += a.faturamento
		}
		if total == 0 {
			total = 1
		}
		acc, filtrados := 0.0, arr[:0]
		for _, a := range arr {
			acc += a.faturamento
			faixa := "C"
			if p := acc / total; p <= 0.8 {
				faixa = "A"
			} else if p <= 0.95 {
				faixa = "B"
			}
			if f.Faixa == "" || f.Faixa == faixa {
				filtrados = append(filtrados, a)
			}
		}
		arr = filtrados
	} else {
		quads := []string{"Estrela", "Vaca leiteira", "Interrogação"}
		if f.Quadrantes != nil {
			quads = *f.Quadrantes
		}
		filtrados := arr[:0]
		for _, a := range arr {
			noQuadrante := slices.ContainsFunc(lojas, func(l lojaDaFabrica) bool {
				return slices.Contains(quads, bcgClass(float64(est[l.deposito+"|"+a.sku]), a.unidades, 0))
			})
			cat := ""
			if a.categoria != nil {
				cat = *a.categoria
			}
			if noQuadrante && (f.Categoria == "" || strings.Contains(strings.ToLower(cat), strings.ToLower(f.Categoria))) {
				filtrados = append(filtrados, a)
			}
		}
		arr = filtrados
	}
	out := make([]candidato, 0, len(arr))
	for _, a := range arr {
		s, _ := json.Marshal(a.sku)
		n, _ := json.Marshal(a.nome)
		c, _ := json.Marshal(a.categoria)
		out = append(out, candidato{SKU: s, Nome: n, Categoria: c, PorLoja: porLojaDoEstoque(lojas, est, a.sku)})
	}
	return out, nil
}

func manual(ctx context.Context, p *pgxpool.Pool, lojas []lojaDaFabrica, f filtrosCandidatos) ([]candidato, error) {
	est, err := estoques(ctx, p, lojas)
	if err != nil {
		return nil, err
	}
	linhas, err := p.Query(ctx, `select sku, produto, categoria from gc_vendas_item
		where canal_loja_id = any($1::bigint[]) order by sku, canal_loja_id, mes`, canais(lojas))
	if err != nil {
		return nil, err
	}
	termo := strings.ToLower(f.Termo)
	visto := map[string]bool{}
	var out []candidato
	var sku string
	var produto, categoria *string
	_, err = pgx.ForEachRow(linhas, []any{&sku, &produto, &categoria}, func() error {
		nome := ""
		if produto != nil {
			nome = *produto
		}
		if visto[sku] || !(termo == "" || strings.Contains(strings.ToLower(nome), termo) || strings.Contains(strings.ToLower(sku), termo)) {
			return nil
		}
		visto[sku] = true
		s, _ := json.Marshal(sku)
		n, _ := json.Marshal(produto)
		c, _ := json.Marshal(categoria)
		out = append(out, candidato{SKU: s, Nome: n, Categoria: c, PorLoja: porLojaDoEstoque(lojas, est, sku)})
		return nil
	})
	return out, err
}
