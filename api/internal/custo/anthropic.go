package custo

import (
	"cmp"
	"context"
	"fmt"
	"maps"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Anthropic é a API admin da Anthropic (custo-anthropic/index.ts): Cost Report, com o amount em
// CENTAVOS de dólar (texto decimal), e Usage Report por chave de API.
type Anthropic struct {
	Base  string                                     // vazio = https://api.anthropic.com
	HTTP  *http.Client                               // nil = semRedirecionar
	Pausa func(context.Context, time.Duration) error // nil = esperar
}

// ChaveRateada: o uso de uma chave e o custo REAL total rateado pelo uso (entrada×1 + saída×5). A
// Anthropic não dá custo por chave: é estimativa, e a tela diz isso (index.ts:91-94).
type ChaveRateada struct {
	Nome        string  `json:"nome"`
	TokensIn    float64 `json:"tokensIn"`
	TokensOut   float64 `json:"tokensOut"`
	UsdEstimado float64 `json:"usdEstimado"`
}

func (a Anthropic) base() string { return cmp.Or(a.Base, "https://api.anthropic.com") }

func (a Anthropic) cliente(chave string) cliente {
	pausa := a.Pausa
	if pausa == nil {
		pausa = esperar
	}
	return cliente{fornecedor: "Anthropic", chave: chave, http: cmp.Or(a.HTTP, semRedirecionar), pausa: pausa,
		prazo: 15 * time.Second, orcamento: 30 * time.Second,
		cabecalho: func(h http.Header, k string) { h.Set("x-api-key", k); h.Set("anthropic-version", "2023-06-01") }}
}

// Buscar: o total por dia (obrigatório) e, depois, os dois detalhamentos juntos (index.ts:168-174).
func (a Anthropic) Buscar(ctx context.Context, chave string, j Janela) (Fatura, error) {
	c := a.cliente(chave)
	base := url.Values{"starting_at": {j.Inicio.UTC().Format(isoSegundos)}, "ending_at": {j.Fim.UTC().Format(isoSegundos)},
		"bucket_width": {"1d"}, "limit": {"31"}}
	dias := []Dia{}
	err := c.paginas(ctx, a.base()+"/v1/organizations/cost_report", base, "custos/total", func(p pagina) error {
		for _, b := range p.Data {
			centavos := 0.0
			for _, x := range b.Results {
				v, err := numero(x["amount"])
				if err != nil {
					return c.inesperada()
				}
				centavos += v
			}
			dias = append(dias, Dia{Data: primeiros(texto(b.StartingAt), 10), Usd: centavos / 100})
		}
		return nil
	})
	if err != nil {
		return Fatura{}, err
	}
	soma := 0.0
	for _, d := range dias {
		soma += d.Usd
	}
	var cats []Categoria
	var chaves []ChaveRateada
	var wg sync.WaitGroup
	wg.Add(2)
	go func() { defer wg.Done(); cats = a.porCategoria(ctx, c, base) }()
	go func() { defer wg.Done(); chaves = a.porChave(ctx, c, base, soma) }()
	wg.Wait()
	return novaFatura(j, dias, cats, chaves), nil
}

// porCategoria é o extrato REAL por descrição (index.ts:66-89); qualquer falha = [].
func (a Anthropic) porCategoria(ctx context.Context, c cliente, base url.Values) []Categoria {
	q := maps.Clone(base)
	q.Add("group_by[]", "description")
	var acc somas
	err := c.paginas(ctx, a.base()+"/v1/organizations/cost_report", q, "custos/descricao", func(p pagina) error {
		for _, b := range p.Data {
			for _, x := range b.Results {
				v, err := numero(x["amount"])
				if err != nil {
					return err
				}
				nome := texto(x["description"])
				if nome == "" {
					nome = fmt.Sprintf("%s / %s", ouInterrogacao(x["model"]), ouInterrogacao(x["token_type"]))
				}
				acc.somar(nome, v/100)
			}
		}
		return nil
	})
	out := []Categoria{}
	if err != nil {
		return out
	}
	for _, nome := range acc.nomes {
		if v := acc.v[nome]; v > 0 {
			out = append(out, Categoria{Item: nome, Usd: v})
		}
	}
	maiorPrimeiro(out, func(x Categoria) float64 { return x.Usd })
	return out
}

func ouInterrogacao(v any) string {
	if v == nil {
		return "?"
	}
	return texto(v)
}

// porChave rateia o custo real pelo uso de cada chave (index.ts:95-137); qualquer falha do uso = [].
func (a Anthropic) porChave(ctx context.Context, c cliente, base url.Values, totalUsd float64) []ChaveRateada {
	nomes := map[string]string{}
	var k struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
	}
	if c.getJSON(ctx, a.base()+"/v1/organizations/api_keys?limit=100", "chaves", &k) == nil {
		for _, x := range k.Data {
			nomes[x.ID] = cmp.Or(x.Name, x.ID)
		}
	}
	q := maps.Clone(base)
	q.Add("group_by[]", "api_key_id")
	var in, out somas
	err := c.paginas(ctx, a.base()+"/v1/organizations/usage_report/messages", q, "uso/chave", func(p pagina) error {
		for _, b := range p.Data {
			for _, x := range b.Results {
				id := texto(x["api_key_id"])
				if id == "" {
					id = "desconhecida"
				}
				i := 0.0
				for _, campo := range []string{"uncached_input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"} {
					v, err := numero(x[campo])
					if err != nil {
						return err
					}
					i += v
				}
				o, err := numero(x["output_tokens"])
				if err != nil {
					return err
				}
				in.somar(id, i)
				out.somar(id, o)
			}
		}
		return nil
	})
	l := []ChaveRateada{}
	if err != nil {
		return l
	}
	pesos := make([]float64, len(in.nomes))
	somaPeso := 0.0
	for n, id := range in.nomes {
		pesos[n] = in.v[id] + out.v[id]*5
		somaPeso += pesos[n]
	}
	if somaPeso == 0 {
		somaPeso = 1
	}
	for n, id := range in.nomes {
		if ti, to := in.v[id], out.v[id]; ti+to > 0 {
			l = append(l, ChaveRateada{Nome: cmp.Or(nomes[id], id), TokensIn: ti, TokensOut: to, UsdEstimado: fixo(totalUsd*pesos[n]/somaPeso, 4)})
		}
	}
	maiorPrimeiro(l, func(x ChaveRateada) float64 { return x.UsdEstimado })
	return l
}
