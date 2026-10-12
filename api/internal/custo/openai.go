package custo

import (
	"cmp"
	"context"
	"net/http"
	"net/url"
	"strconv"
	"sync"
	"time"
)

// OpenAI é a API admin da OpenAI (custo-openai/index.ts): Costs API com amount.value em DÓLARES
// (não divida por 100: index.ts:13-16) e custo REAL por chave de API.
type OpenAI struct {
	Base  string                                     // vazio = https://api.openai.com/v1/organization
	HTTP  *http.Client                               // nil = semRedirecionar
	Pausa func(context.Context, time.Duration) error // nil = esperar
}

// ChaveReal: o custo cobrado por chave (a OpenAI cobra separado: não é rateio).
type ChaveReal struct {
	Nome string  `json:"nome"`
	Usd  float64 `json:"usd"`
}

type balde struct {
	data    string
	results []map[string]any
}

func (o OpenAI) base() string { return cmp.Or(o.Base, "https://api.openai.com/v1/organization") }

func (o OpenAI) cliente(chave string) cliente {
	pausa := o.Pausa
	if pausa == nil {
		pausa = esperar
	}
	return cliente{fornecedor: "OpenAI", chave: chave, http: cmp.Or(o.HTTP, semRedirecionar), pausa: pausa,
		prazo: 8 * time.Second, orcamento: 20 * time.Second,
		cabecalho: func(h http.Header, k string) { h.Set("Authorization", "Bearer "+k) }}
}

// Buscar faz as quatro perguntas juntas; só o total derruba a resposta (index.ts:225-239).
func (o OpenAI) Buscar(ctx context.Context, chave string, j Janela) (Fatura, error) {
	c := o.cliente(chave)
	var (
		wg            sync.WaitGroup
		total         []balde
		errTotal      error
		linhas, porID somas
		nomes         map[string]string
	)
	wg.Add(4)
	go func() { defer wg.Done(); total, errTotal = o.varrer(ctx, c, j, "") }()
	go func() { defer wg.Done(); linhas = o.detalhe(ctx, c, j, "line_item") }()
	go func() { defer wg.Done(); porID = o.detalhe(ctx, c, j, "api_key_id") }()
	go func() { defer wg.Done(); nomes = o.nomesDasChaves(ctx, c) }()
	wg.Wait()
	if errTotal != nil {
		return Fatura{}, errTotal
	}
	dias := []Dia{}
	for _, b := range total {
		usd := 0.0
		for _, x := range b.results {
			v, err := valor(x)
			if err != nil {
				return Fatura{}, c.inesperada()
			}
			usd += v
		}
		dias = append(dias, Dia{Data: b.data, Usd: usd})
	}
	cats := []Categoria{}
	for _, k := range linhas.nomes {
		if v := fixo(linhas.v[k], 6); v > 0 {
			cats = append(cats, Categoria{Item: k, Usd: v})
		}
	}
	maiorPrimeiro(cats, func(x Categoria) float64 { return x.Usd })
	chaves := []ChaveReal{}
	for _, id := range porID.nomes {
		if v := fixo(porID.v[id], 6); v > 0 {
			chaves = append(chaves, ChaveReal{Nome: cmp.Or(nomes[id], id), Usd: v})
		}
	}
	maiorPrimeiro(chaves, func(x ChaveReal) float64 { return x.Usd })
	return novaFatura(j, dias, cats, chaves), nil
}

// varrer é uma varredura da Costs API em baldes de 1 dia (index.ts:128-148).
func (o OpenAI) varrer(ctx context.Context, c cliente, j Janela, agrupar string) ([]balde, error) {
	q := url.Values{"start_time": {strconv.FormatInt(j.Inicio.Unix(), 10)}, "end_time": {strconv.FormatInt(j.Fim.Unix(), 10)},
		"bucket_width": {"1d"}, "limit": {"180"}}
	rotulo := "custos/total"
	if agrupar != "" {
		q.Add("group_by[]", agrupar)
		rotulo = "custos/" + agrupar
	}
	var out []balde
	err := c.paginas(ctx, o.base()+"/costs", q, rotulo, func(p pagina) error {
		for _, b := range p.Data {
			d := primeiros(texto(b.StartTimeISO), 10)
			if d == "" && b.StartTime != nil {
				s, err := numero(b.StartTime)
				if err != nil {
					return c.inesperada()
				}
				d = time.UnixMilli(int64(s * 1000)).UTC().Format(time.DateOnly)
			}
			out = append(out, balde{data: d, results: b.Results})
		}
		return nil
	})
	return out, err
}

// detalhe soma o custo por <campo> (line_item | api_key_id); qualquer falha = vazio (index.ts:213-223).
func (o OpenAI) detalhe(ctx context.Context, c cliente, j Janela, campo string) somas {
	bs, err := o.varrer(ctx, c, j, campo)
	if err != nil {
		return somas{}
	}
	var acc somas
	for _, b := range bs {
		for _, x := range b.results {
			v, err := valor(x)
			if err != nil {
				return somas{}
			}
			nome := "(sem nome)"
			if x[campo] != nil {
				nome = texto(x[campo])
			}
			acc.somar(nome, v)
		}
	}
	return acc
}

// valor é o Number(x?.amount?.value ?? 0) da edge (index.ts:152): DÓLARES.
func valor(x map[string]any) (float64, error) {
	m, _ := x["amount"].(map[string]any)
	return numero(m["value"])
}

// nomesDasChaves troca key_… pelo nome da chave, perguntando os projetos de uma vez (index.ts:162-180).
func (o OpenAI) nomesDasChaves(ctx context.Context, c cliente) map[string]string {
	nomes := map[string]string{}
	var proj struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if c.getJSON(ctx, o.base()+"/projects?limit=50", "projetos", &proj) != nil {
		return nomes // segue sem nome: o id ainda identifica
	}
	type chave struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	listas := make([][]chave, len(proj.Data))
	var wg sync.WaitGroup
	for i, p := range proj.Data {
		if p.ID == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			var k struct {
				Data []chave `json:"data"`
			}
			if c.getJSON(ctx, o.base()+"/projects/"+url.PathEscape(p.ID)+"/api_keys?limit=100", "chaves", &k) == nil {
				listas[i] = k.Data
			}
		}()
	}
	wg.Wait()
	for _, l := range listas {
		for _, k := range l {
			if k.ID != "" {
				nomes[k.ID] = cmp.Or(k.Name, k.ID)
			}
		}
	}
	return nomes
}
