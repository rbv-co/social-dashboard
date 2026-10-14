package fabrica

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const (
	depT = "14888726315" // Tivoli, canal 205834140
	depI = "14888726277" // Iguatemi, canal 205834116
)

// Dados do cálculo (além do mundo): estoque, vendas por canal e dois briefings (o mais novo manda).
const linhasDosCandidatos = `
insert into gc_estoque_item (deposito_id, sku, produto, categoria, saldo) values
  (14888726315, 'S1', 'Bolsa Um', 'Bolsas', 2), (14888726315, 'S2', 'Carteira', 'Acessórios', 0),
  (14888726277, 'S2', 'Carteira', 'Acessórios', 5), (14888726277, 'S3', 'Mochila', 'Bolsas', 1),
  (99999, 'S1', 'Bolsa Um', 'Bolsas', 50);
insert into gc_vendas_item (mes, canal_loja_id, sku, produto, categoria, unidades, faturamento) values
  ('2026-09-01', 205834140, 'S1', 'Bolsa Um', 'Bolsas', 3, 300), ('2026-08-01', 205834140, 'S1', 'Bolsa Um', 'Bolsas', 1, 100),
  ('2026-09-01', 205834140, 'S2', 'Carteira', 'Acessórios', 1, 50),
  ('2026-09-01', 205834116, 'S3', 'Mochila', 'Bolsas', 0, 0), ('2026-09-01', 205834116, 'S2', 'Carteira', 'Acessórios', 1, 50);
insert into gestao_comercial_briefings (rodada, resumo, conteudo, dados_json, created_at) values
  ('2026-10-12', 'nova', 'x', '{"oportunidades":[{"loja":"tivoli","itens":[{"sku":"S1","descricao":"Bolsa 1","categoria":"Bolsas","precoOriginal":100,"pct":30,"precoComDesconto":70,"estoqueLoja":2}]},{"loja":"Shopping X","itens":[{"sku":"S9"}]}],"garimpo":[{"loja":"iguatemi","itens":[{"sku":"S2","descricao":"Carteira"}]}]}', '2026-10-12T12:00:00Z'),
  ('2026-10-05', 'velha', 'x', '{"oportunidades":[{"loja":"iguatemi","itens":[{"sku":"S7"}]}]}', '2026-10-05T12:00:00Z');`

func mundoDosCandidatos(t *testing.T) *mundoteste.Mundo {
	t.Helper()
	m := novoMundo(t, func(r chi.Router, p *pgxpool.Pool) { Montar(r, p, nil, t.TempDir()) })
	if _, err := m.P.Exec(context.Background(), linhasDosCandidatos); err != nil {
		t.Fatal(err)
	}
	return m
}

func TestBcgClass(t *testing.T) {
	for _, c := range []struct {
		e, g, d float64
		quer    string
	}{{2, 4, 0, "Estrela"}, {5, 2, 0, "Vaca leiteira"}, {0, 0, 0, "Interrogação"}, {0, 0, 30, "Abacaxi"}} {
		if got := bcgClass(c.e, c.g, c.d); got != c.quer {
			t.Errorf("bcgClass(%v, %v, %v) = %q, esperava %q", c.e, c.g, c.d, got, c.quer)
		}
	}
}

type respostaCand struct {
	Candidatos []struct {
		SKU     string                     `json:"sku"`
		PorLoja map[string]json.RawMessage `json:"porLoja"`
	} `json:"candidatos"`
}

// skus: a respostaCand de um pedido válido como "S1,S2" na ordem em que veio ("" = lista vazia).
func skus(t *testing.T, m *mundoteste.Mundo, quem, corpo string) (string, respostaCand) {
	t.Helper()
	st, b := m.Pedir(t, quem, http.MethodPost, "/fabrica-candidatos", corpo)
	var r respostaCand
	if st != 200 || json.Unmarshal([]byte(b), &r) != nil || r.Candidatos == nil {
		t.Fatalf("%s = %d %s", corpo, st, b)
	}
	var out []string
	for _, c := range r.Candidatos {
		out = append(out, c.SKU)
	}
	return strings.Join(out, ","), r
}

func pedido(lojas []string, fonte, filtros string) string {
	l, _ := json.Marshal(lojas)
	return fmt.Sprintf(`{"lojas":%s,"fonte":%q,"filtros":%s}`, l, fonte, filtros)
}

func TestCandidatos(t *testing.T) {
	m := mundoDosCandidatos(t)
	ti := []string{depT, depI}
	quer := func(nome, corpo, esperado string) respostaCand {
		t.Helper()
		got, r := skus(t, m, "fabricante", corpo)
		if got != esperado {
			t.Errorf("%s: %q, esperava %q", nome, got, esperado)
		}
		return r
	}

	// abc: S1 = 400 de 500 (0,8) é a faixa A; só o depósito T entra no porLoja (S1 não tem saldo em I)
	r := quer("abc faixa A", pedido(ti, "abc", `{"faixa":"A"}`), "S1")
	if len(r.Candidatos[0].PorLoja) != 1 || !strings.Contains(string(r.Candidatos[0].PorLoja[depT]), `"estoque":2`) {
		t.Errorf("porLoja do S1 = %v", r.Candidatos[0].PorLoja)
	}
	quer("abc sem faixa", pedido(ti, "abc", `{}`), "S1,S2,S3")

	// bcg
	quer("bcg padrão", pedido(ti, "bcg", `{}`), "S1,S2,S3")
	quer("bcg Estrela", pedido(ti, "bcg", `{"quadrantes":["Estrela"]}`), "S1,S2")
	quer("bcg Vaca leiteira", pedido(ti, "bcg", `{"quadrantes":["Vaca leiteira"]}`), "S2")
	quer("bcg categoria", pedido(ti, "bcg", `{"categoria":"bolsa"}`), "S1,S3")
	quer("bcg sem quadrante (lista vazia é lista)", pedido(ti, "bcg", `{"quadrantes":[]}`), "")

	// manual
	r = quer("manual carteira", pedido(ti, "manual", `{"termo":"carteira"}`), "S2")
	if len(r.Candidatos[0].PorLoja) != 1 || !strings.Contains(string(r.Candidatos[0].PorLoja[depI]), `"estoque":5`) {
		t.Errorf("porLoja do S2 = %v (S2 tem saldo 0 em T e 5 em I)", r.Candidatos[0].PorLoja)
	}
	quer("manual s3", pedido(ti, "manual", `{"termo":"s3"}`), "S3")
	quer("manual sem termo", pedido(ti, "manual", `{}`), "S1,S2,S3")

	// briefing: o MAIS NOVO; "Shopping X" não casa com nenhuma loja
	r = quer("oportunidades", pedido(ti, "oportunidades", `{}`), "S1")
	if got := string(r.Candidatos[0].PorLoja[depT]); !strings.Contains(got, `"preco":100`) || !strings.Contains(got, `"pctPrevisto":30`) ||
		!strings.Contains(got, `"precoComDesconto":70`) || !strings.Contains(got, `"estoque":2`) {
		t.Errorf("porLoja de T = %s", got)
	}
	quer("oportunidades só em I", pedido([]string{depI}, "oportunidades", `{}`), "")
	r = quer("garimpo", pedido(ti, "garimpo", `{}`), "S2")
	if got := string(r.Candidatos[0].PorLoja[depI]); got != "{}" {
		t.Errorf("porLoja de I = %s, esperava {}", got)
	}

	// só lojas da Fábrica: o depósito 99999 (de outra loja do Bling) nunca aparece
	quer("manual com depósito fora", pedido([]string{"99999"}, "manual", `{}`), "")
	r = quer("manual com T e fora", pedido([]string{depT, "99999"}, "manual", `{}`), "S1,S2") // só o canal de T
	for _, c := range r.Candidatos {
		if _, vazou := c.PorLoja["99999"]; vazou {
			t.Errorf("o saldo do depósito 99999 vazou em %s", c.SKU)
		}
	}
	if s := m.Um(t, `select count(*)::text from gc_estoque_item where deposito_id = 99999`); s != "1" {
		t.Fatalf("dado do teste: %s", s)
	}

	// sem briefing, e briefing fora do formato
	if _, err := m.P.Exec(context.Background(), `update gestao_comercial_briefings set dados_json = '{"oportunidades":{"a":1}}' where rodada = '2026-10-12'`); err != nil {
		t.Fatal(err)
	}
	quer("oportunidades em objeto", pedido(ti, "oportunidades", `{}`), "")
	if _, err := m.P.Exec(context.Background(), `delete from gestao_comercial_briefings`); err != nil {
		t.Fatal(err)
	}
	quer("sem briefing", pedido(ti, "oportunidades", `{}`), "")

	// portão
	corpo := pedido(ti, "manual", `{}`)
	for quem, st := range map[string]int{"leitor": 403, "semModulo": 403, "roboSemFabrica": 403, "robo": 403, "impersonado": 200, "desativado": 401, "": 401} {
		if got, b := m.Pedir(t, quem, http.MethodPost, "/fabrica-candidatos", corpo); got != st {
			t.Errorf("%q = %d %s, esperava %d", quem, got, b, st)
		}
	}

	// 400
	if st, b := m.Pedir(t, "fabricante", http.MethodPost, "/fabrica-candidatos", pedido(ti, "x", `{}`)); st != 400 || !strings.Contains(b, `"fonte_invalida"`) {
		t.Errorf("fonte inválida = %d %s", st, b)
	}
	var vinte []string
	for i := range 21 {
		vinte = append(vinte, fmt.Sprint(1000+i))
	}
	for nome, c := range map[string]string{
		"loja que não é número": pedido([]string{"abc"}, "manual", `{}`),
		"21 lojas":              pedido(vinte, "manual", `{}`),
		"filtros em texto":      pedido(ti, "manual", `"x"`),
		"faixa em número":       pedido(ti, "abc", `{"faixa":1}`),
	} {
		if st, b := m.Pedir(t, "fabricante", http.MethodPost, "/fabrica-candidatos", c); st != 400 || !strings.Contains(b, "pedido_invalido") {
			t.Errorf("%s = %d %s", nome, st, b)
		}
	}
}

// Sem o teto de 1000 linhas do PostgREST: 1200 SKUs no canal de T, cada um com estoque.
func TestCandidatosSemOTetoDe1000(t *testing.T) {
	m := mundoDosCandidatos(t)
	if _, err := m.P.Exec(context.Background(), `
		insert into gc_vendas_item (mes, canal_loja_id, sku, produto, categoria, unidades, faturamento)
		  select '2026-09-01', 205834140, 'X' || lpad(g::text, 5, '0'), 'Produto ' || g, 'Bolsas', 1, 1 from generate_series(1, 1200) g;
		insert into gc_estoque_item (deposito_id, sku, produto, categoria, saldo)
		  select 14888726315, 'X' || lpad(g::text, 5, '0'), 'Produto ' || g, 'Bolsas', 1 from generate_series(1, 1200) g;`); err != nil {
		t.Fatal(err)
	}
	if _, r := skus(t, m, "fabricante", pedido([]string{depT}, "manual", `{}`)); len(r.Candidatos) != 1202 {
		t.Errorf("candidatos = %d, esperava 1202 (S1, S2 e os 1200 novos do canal de T)", len(r.Candidatos))
	}
}
