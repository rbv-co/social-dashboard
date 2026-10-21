package comercial

import (
	"context"
	"encoding/json"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// Reserva dos produtos (plano 03-D.2, BLING-FORA-ESPELHO). O espelho de produtos sincroniza 1×/dia e não traz a miniatura:
// como fonte PRIMÁRIA faria sumir o SKU cadastrado hoje (a Fábrica cria lote com SKU novo). Por isso é só RESERVA: com o
// Bling em 5xx/429/408, `produtos` e `produtos/{id}` respondem do espelho, no formato do Bling e marcados `fonte:"espelho"`
// (com a sincronia). A foto grande continua ao vivo: sem Bling, a tela cai para o quadrinho vazio.

const produtosCacheTTL = 5 * time.Minute

// produtosCache guarda a tabela inteira (≈3.200 linhas) por 5 min: a busca por texto e a paginação são em memória, e a
// reserva não pode custar uma carga do Core por tecla digitada. Zero-value pronto para uso.
type produtosCache struct {
	mu     sync.Mutex
	em     time.Time
	linhas []map[string]any
	sinc   *core.Sincronia
}

// blingFalhou: o Core respondeu, mas o Bling não (instável, limitado, fora do prazo). 404 e outros 4xx são resposta de
// verdade. Erro montado aqui (`propria`: Core mudo, sem token) NÃO conta: o espelho mora no mesmo Core, e tentar
// só dobraria a espera.
func (s saida) blingFalhou() bool {
	return !s.propria && (s.status >= 500 || s.status == 429 || s.status == 408)
}

func (c *produtosCache) tudo(ctx context.Context, cli *core.Cliente) ([]map[string]any, *core.Sincronia, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.linhas != nil && time.Since(c.em) < produtosCacheTTL {
		return c.linhas, c.sinc, nil
	}
	l, err := espelhoTodas(ctx, cli, "produtos_bling", url.Values{})
	if err != nil {
		return nil, nil, err
	}
	c.linhas, c.sinc, c.em = l.Linhas, l.Sincronia, time.Now()
	return c.linhas, c.sinc, nil
}

func marcaDoEspelho(s *core.Sincronia) map[string]any {
	m := map[string]any{"fonte": "espelho"}
	if s != nil {
		m["sincronia"] = map[string]any{"ultimo_ok": s.UltimoOK, "atrasado": s.Atrasado}
	}
	return m
}

// produtoDaLista converte uma linha de `produtos_bling` no item da lista do Bling (sem `imagemURL`: o espelho não tem).
func produtoDaLista(x map[string]any) map[string]any {
	situacao := "I"
	if texto(x["id_situacaocadastro"]) == "1" {
		situacao = "A"
	}
	p := map[string]any{"codigo": textoOuVazio(x["codigo"]), "nome": textoOuVazio(x["descricao"]), "tipo": textoOuVazio(x["tipo"]), "situacao": situacao}
	if id := textoOuVazio(x["id_bling"]); reNumero.MatchString(id) {
		p["id"] = json.Number(id)
	}
	if v, ok := x["preco"].(json.Number); ok {
		p["preco"] = v
	}
	return p
}

// produtosDoEspelho responde `produtos` (lista: criterio, codigo, pesquisa, pagina, limite) ou `produtos/{id}` como o
// Bling responderia. ok=false = o espelho não tem como responder; o chamador devolve o erro do Bling como veio.
func (b *Bling) produtosDoEspelho(ctx context.Context, endpoint string, params map[string]any) (map[string]any, bool) {
	if b.Core == nil {
		return nil, false
	}
	if id, achou := strings.CutPrefix(endpoint, "produtos/"); achou {
		return b.produtoDetalheDoEspelho(ctx, id)
	}
	linhas, sinc, err := b.produtos.tudo(ctx, b.Core)
	if err != nil {
		return nil, false
	}
	p := func(k string) string { return strings.TrimSpace(strings.ToLower(textoOuVazio(params[k]))) }
	criterio, codigo, pesquisa := p("criterio"), p("codigo"), p("pesquisa")
	var achados []any
	for _, x := range linhas {
		ativo := texto(x["id_situacaocadastro"]) == "1"
		if (criterio == "" || criterio == "2") && !ativo || criterio == "3" && ativo { // 5 = todos; ausente = ativos, como o Bling
			continue
		}
		cod, nome := strings.ToLower(textoOuVazio(x["codigo"])), strings.ToLower(textoOuVazio(x["descricao"]))
		if codigo != "" && cod != codigo || pesquisa != "" && !strings.Contains(cod, pesquisa) && !strings.Contains(nome, pesquisa) {
			continue
		}
		achados = append(achados, produtoDaLista(x))
	}
	limite, _ := strconv.Atoi(p("limite"))
	if limite <= 0 || limite > 100 {
		limite = 100
	}
	pagina, _ := strconv.Atoi(p("pagina"))
	if pagina < 1 {
		pagina = 1
	}
	de := min((pagina-1)*limite, len(achados))
	resp := marcaDoEspelho(sinc)
	resp["data"] = append([]any{}, achados[de:min(de+limite, len(achados))]...)
	return resp, true
}

// produtoDetalheDoEspelho: o JSON do detalhe do Bling (estrutura, tributação, mídia) que o Core guarda em
// `bling_produtos_detalhe`; sem ele (só 1.906 dos 3.206 produtos têm), a linha da lista. `_espelho_em` diz a idade.
func (b *Bling) produtoDetalheDoEspelho(ctx context.Context, id string) (map[string]any, bool) {
	if !reNumero.MatchString(id) {
		return nil, false
	}
	l, err := espelhoTodas(ctx, b.Core, "bling_produtos_detalhe", url.Values{"id_bling": {id}})
	if err != nil {
		return nil, false
	}
	var dado map[string]any
	sinc := l.Sincronia
	if len(l.Linhas) > 0 {
		dado, _ = l.Linhas[0]["detalhe"].(map[string]any)
	}
	if dado == nil {
		linhas, s, err := b.produtos.tudo(ctx, b.Core)
		if err != nil {
			return nil, false
		}
		for _, x := range linhas {
			if textoOuVazio(x["id_bling"]) == id {
				dado, sinc = produtoDaLista(x), s
				break
			}
		}
	}
	if dado == nil {
		return nil, false
	}
	if sinc != nil && sinc.UltimoOK != nil {
		dado["_espelho_em"] = sinc.UltimoOK
	}
	resp := marcaDoEspelho(sinc)
	resp["data"] = dado
	return resp, true
}
