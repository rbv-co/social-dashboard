package leituradupla

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// Leitura dupla de PEDIDOS (plano 08-A): `vessel_pedidos` + `vessel_pedido_itens` (Central) × `pedidos` +
// `pedido_itens` (espelho do core). Só mede e loga; a Central segue servindo o dado local.
// Ligada por CORE_LEITURA_PEDIDOS (config.CoreLeituraPedidos).
//
// Janela: só pedidos com `data_do_pedido` nos últimos `Dias` dias (o espelho tem a história inteira; a
// Central, também, mas ler tudo a cada rodada gasta o balde de 120/min do consumidor). Itens são lidos por
// lotes de `pedido_id_bling[]`, e QUALQUER lote que falhe aborta a rodada (nunca compara com item faltando).

const (
	DiasPadrao  = 60
	loteDeItens = 100 // 2 GETs por lote (contagem + página): ~3.000 pedidos = ~60 GETs, abaixo do balde de 120/min
	// situacaoVenda: a Central só guarda como venda o pedido "Atendido" (9) do Bling (e os que deixaram de ser: ela os
	// mantém com a situação nova). Pedido do core em outra situação e ausente na Central não é divergência.
	situacaoVenda = "9"
)

// PedidoCentral é o que a Central tem do pedido E o espelho também (nada de contato, nome ou observação).
type PedidoCentral struct {
	ID        string // bling_pedido_id::text
	Numero    string
	Data      string // data_do_pedido, YYYY-MM-DD
	Total     string // total_do_bling
	Situacao  string // situacao_id ("" = nulo)
	Contato   string // bling_contato_id ("" = nulo)
	Loja      string // loja_id ("" = nulo)
	Vendedor  string // vendedor_id ("" = nulo)
	Itens     int
	SomaItens string // soma de quantidade × valor_unitario
}

// PedidoCore é a linha de `pedidos` do espelho já reduzida, com os itens agregados.
type PedidoCore struct {
	ID, Numero, Data, Total, Situacao, Contato string
	Loja, Vendedor                             string
	AtualizadoEm                               string
	Itens                                      int
	SomaItens                                  float64 // soma de quantidade × valor, sem arredondar
}

// RelatorioPedidos é a comparação. SoCoreAnterior = pedido do core mais antigo que o primeiro da Central.
type RelatorioPedidos struct {
	Central, Core                     int
	Iguais                            int
	SoCentral, SoCore, SoCoreAnterior []string
	SoCoreNaoVenda                    int // só no core e não Atendido: a Central não guarda, esperado
	Recentes                          int
	Diferencas                        []Diferenca
	// TotaisLoja e TotaisVendedor: soma de total (centavos) por loja e por vendedor dos pedidos Atendido casados nos
	// dois lados (plano 03-B: é o que Gestão à Vista e Análise de Vendas mostram). Só entra pedido com a loja (ou o
	// vendedor) conhecida dos dois lados; SemVendedorNoCore conta os que a Central sabe de quem é e o espelho não
	// (o Core guarda o vendedor só quando o detalhe do pedido chega): informativo, a tela cai no cache local.
	TotaisLoja, TotaisVendedor []Diferenca
	SemVendedorNoCore          int
	Defasado                   bool
}

func (r RelatorioPedidos) Limpo() bool {
	return r.Defasado || (len(r.SoCentral) == 0 && len(r.SoCore) == 0 && len(r.Diferencas) == 0 &&
		len(r.TotaisLoja) == 0 && len(r.TotaisVendedor) == 0)
}

// CompararPedidos casa por id do Bling (texto). Compara número, total e soma dos itens (centavos),
// situação, contato (só quando os dois lados têm) e quantidade de itens. `corte` = quando o lado local foi
// lido: pedido mexido no core depois de corte-5min não conta (a Central é lida antes do core).
func CompararPedidos(central []PedidoCentral, doCore map[string]PedidoCore, defasado bool, corte time.Time) RelatorioPedidos {
	r := RelatorioPedidos{Central: len(central), Core: len(doCore), Defasado: defasado}
	var primeiro string
	vistas := make(map[string]bool, len(central))
	lojaC, lojaK, vendC, vendK := map[string]int64{}, map[string]int64{}, map[string]int64{}, map[string]int64{}
	for _, c := range central {
		vistas[c.ID] = true
		if primeiro == "" || c.Data < primeiro {
			primeiro = c.Data
		}
		k, ok := doCore[c.ID]
		if !ok {
			r.SoCentral = append(r.SoCentral, c.ID)
			continue
		}
		if recente(k.AtualizadoEm, corte) {
			r.Recentes++
			continue
		}
		n := len(r.Diferencas)
		dif := func(campo, a, b string) { r.Diferencas = append(r.Diferencas, Diferenca{c.ID, campo, a, b}) }
		if strings.TrimPrefix(c.Numero, "#") != strings.TrimPrefix(k.Numero, "#") {
			dif("numero", c.Numero, k.Numero)
		}
		if a, okA := cents(c.Total); !okA || !centsIgual(a, k.Total) {
			dif("total", c.Total, k.Total)
		}
		if c.Situacao != "" && c.Situacao != k.Situacao {
			dif("situacao", c.Situacao, k.Situacao)
		}
		if c.Contato != "" && k.Contato != "" && c.Contato != k.Contato {
			dif("contato", "(id)", "(id)") // id de contato é dado pessoal indireto: só o fato de divergir
		}
		if c.Loja != "" && c.Loja != k.Loja { // espelho sem loja também conta: o pedido some para quem é limitado a canal
			dif("loja", c.Loja, k.Loja)
		}
		if c.Vendedor != "" && k.Vendedor != "" && c.Vendedor != k.Vendedor {
			dif("vendedor", c.Vendedor, k.Vendedor)
		}
		if c.Situacao == situacaoVenda && k.Situacao == situacaoVenda {
			a, okA := cents(c.Total)
			b, okB := cents(k.Total)
			if okA && okB && c.Loja != "" && k.Loja != "" {
				lojaC[c.Loja] += a
				lojaK[k.Loja] += b
			}
			if okA && okB && c.Vendedor != "" && k.Vendedor != "" {
				vendC[c.Vendedor] += a
				vendK[k.Vendedor] += b
			}
			if c.Vendedor != "" && k.Vendedor == "" {
				r.SemVendedorNoCore++
			}
		}
		if c.Itens != k.Itens {
			dif("itens", strconv.Itoa(c.Itens), strconv.Itoa(k.Itens))
		} else if a, okA := cents(c.SomaItens); !okA || absInt(a-int64(math.Round(k.SomaItens*100))) > int64(c.Itens) {
			// tolerância de 1 centavo por item (teto: pedido de N linhas esconde diferença de até N centavos; o total, que
			// vem do cabeçalho do Bling, é comparado à parte). Origem: arredondamento do valor da linha (medido em 21/10:
			// 4 de 521 pedidos, todos com 1 centavo)
			dif("soma_itens", c.SomaItens, strconv.FormatFloat(k.SomaItens, 'f', 2, 64))
		}
		if len(r.Diferencas) == n {
			r.Iguais++
		}
	}
	r.TotaisLoja = totaisDiferentes("total_loja", lojaC, lojaK)
	r.TotaisVendedor = totaisDiferentes("total_vendedor", vendC, vendK)
	for id, k := range doCore {
		if vistas[id] {
			continue
		}
		if recente(k.AtualizadoEm, corte) {
			r.Recentes++
			continue
		}
		if k.Situacao != situacaoVenda {
			r.SoCoreNaoVenda++
			continue
		}
		if primeiro != "" && k.Data < primeiro {
			r.SoCoreAnterior = append(r.SoCoreAnterior, id)
			continue
		}
		r.SoCore = append(r.SoCore, id)
	}
	return r
}

// totaisDiferentes compara as somas por chave (centavos) e devolve as chaves que não batem, em ordem.
func totaisDiferentes(campo string, central, doCore map[string]int64) []Diferenca {
	var out []Diferenca
	chaves := map[string]bool{}
	for k := range central {
		chaves[k] = true
	}
	for k := range doCore {
		chaves[k] = true
	}
	for k := range chaves {
		if a, b := central[k], doCore[k]; a != b {
			out = append(out, Diferenca{k, campo, centavos(a), centavos(b)})
		}
	}
	slices.SortFunc(out, func(x, y Diferenca) int { return strings.Compare(x.ID, y.ID) })
	return out
}

func centavos(n int64) string { return strconv.FormatFloat(float64(n)/100, 'f', 2, 64) }

func absInt(n int64) int64 {
	if n < 0 {
		return -n
	}
	return n
}

func centsIgual(a int64, b string) bool {
	x, ok := cents(b)
	return ok && x == a
}

// PedidosFonte lê o lado local.
type PedidosFonte interface {
	Pedidos(ctx context.Context, desde time.Time) ([]PedidoCentral, error)
}

// PedidosPG lê `vessel_pedidos` e `vessel_pedido_itens` do api-db, em transação READ ONLY.
type PedidosPG struct{ Pool *pgxpool.Pool }

func (c PedidosPG) Pedidos(ctx context.Context, desde time.Time) ([]PedidoCentral, error) {
	tx, err := c.Pool.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx) //nolint:errcheck
	rows, err := tx.Query(ctx, `select p.bling_pedido_id::text, coalesce(p.numero,''), p.data_do_pedido::text,
	  coalesce(p.total_do_bling::text,''), coalesce(p.situacao_id::text,''), coalesce(p.bling_contato_id::text,''),
	  coalesce(p.loja_id::text,''), coalesce(p.vendedor_id::text,''), coalesce(i.n,0), coalesce(i.soma,0)::text
	from vessel_pedidos p
	left join lateral (select count(*) n, sum(coalesce(quantidade,0) * coalesce(valor_unitario,0)) soma
	  from vessel_pedido_itens where pedido_id = p.id) i on true
	where p.data_do_pedido >= $1::date`, desde)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PedidoCentral
	for rows.Next() {
		var l PedidoCentral
		if err := rows.Scan(&l.ID, &l.Numero, &l.Data, &l.Total, &l.Situacao, &l.Contato, &l.Loja, &l.Vendedor, &l.Itens, &l.SomaItens); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// Pedidos é a tarefa de leitura dupla de pedidos e itens.
type Pedidos struct {
	Fonte    PedidosFonte
	Core     *core.Cliente
	Agora    func() time.Time
	MaxIdade time.Duration
	Dias     int // janela em dias; 0 = DiasPadrao
}

func (s *Pedidos) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "leitura-dupla-pedidos", Agenda: "17 * * * *", Limite: 5 * time.Minute, Executar: s.Rodar}
}

// lerCore devolve os pedidos da janela com os itens agregados. Qualquer falha = erro (nunca lista parcial).
func (s *Pedidos) lerCore(ctx context.Context, desde time.Time, local []PedidoCentral) (map[string]PedidoCore, []*core.Leitura, error) {
	q := url.Values{}
	q.Set("data_de", desde.Format("2006-01-02"))
	q.Set("campos", "pedido_id_bling,numero,data,total,status_id_bling,contato_id,loja_id_bling,vendedor_id_bling,updated_at")
	l, err := s.Core.EspelhoTodas(ctx, "pedidos", q)
	if err != nil {
		return nil, nil, err
	}
	out := make(map[string]PedidoCore, len(l.Linhas))
	leituras := []*core.Leitura{l}
	for _, x := range l.Linhas {
		id := texto(x["pedido_id_bling"])
		if id == "" {
			return nil, nil, fmt.Errorf("%w: pedido sem id", core.ErrIndisponivel)
		}
		out[id] = PedidoCore{ID: id, Numero: texto(x["numero"]), Data: dia(texto(x["data"])), Total: texto(x["total"]),
			Situacao: texto(x["status_id_bling"]), Contato: texto(x["contato_id"]),
			Loja: texto(x["loja_id_bling"]), Vendedor: texto(x["vendedor_id_bling"]), AtualizadoEm: texto(x["updated_at"])}
	}
	// itens só do que vai ser comparado: o que a Central tem e as vendas do core
	quer := make(map[string]bool, len(local))
	for _, c := range local {
		quer[c.ID] = true
	}
	var ids []string
	for id, k := range out {
		if quer[id] || k.Situacao == situacaoVenda {
			ids = append(ids, id)
		}
	}
	slices.Sort(ids)
	for i := 0; i < len(ids); i += loteDeItens {
		lote := ids[i:min(i+loteDeItens, len(ids))]
		qi := url.Values{}
		qi["pedido_id_bling[]"] = lote
		qi.Set("campos", "pedido_id_bling,quantidade,valor")
		it, err := s.Core.EspelhoTodas(ctx, "pedido_itens", qi)
		if err != nil {
			return nil, nil, err
		}
		leituras = append(leituras, it)
		for _, x := range it.Linhas {
			k, ok := out[texto(x["pedido_id_bling"])]
			v, okV := produto(texto(x["quantidade"]), texto(x["valor"]))
			if !ok || !okV { // item de pedido que não pedi, ou número torto
				return nil, nil, fmt.Errorf("%w: item inesperado", core.ErrIndisponivel)
			}
			k.Itens++
			k.SomaItens += v
			out[k.ID] = k
		}
	}
	return out, leituras, nil
}

// dia fica com YYYY-MM-DD (o espelho pode devolver a hora junto).
func dia(s string) string { return s[:min(len(s), 10)] }

// produto: quantidade × valor, ou false se algum dos dois não for número.
func produto(qtd, valor string) (float64, bool) {
	q, err1 := strconv.ParseFloat(strings.TrimSpace(qtd), 64)
	v, err2 := strconv.ParseFloat(strings.TrimSpace(valor), 64)
	return q * v, err1 == nil && err2 == nil
}

// Rodar lê os dois lados e registra. Core fora = erro, sem registrar divergência.
func (s *Pedidos) Rodar(ctx context.Context) error {
	agora := time.Now
	if s.Agora != nil {
		agora = s.Agora
	}
	dias := s.Dias
	if dias <= 0 {
		dias = DiasPadrao
	}
	corte := agora()
	desde := corte.AddDate(0, 0, -dias)
	local, err := s.Fonte.Pedidos(ctx, desde)
	if err != nil {
		return fmt.Errorf("leitura dupla pedidos: lado local: %w", err)
	}
	doCore, leituras, err := s.lerCore(ctx, desde, local)
	if err != nil {
		if errors.Is(err, core.ErrIndisponivel) {
			slog.Warn("leitura dupla", "tabela", "pedidos", "resultado", "core_indisponivel")
		}
		return fmt.Errorf("leitura dupla pedidos: core: %w", err)
	}
	defasado, informada := false, true // defasada qualquer uma das leituras (pedidos ou itens) = a rodada não vale como divergência
	for _, l := range leituras {
		defasado = defasado || l.Defasado(agora(), s.MaxIdade)
		informada = informada && l.Sincronia != nil
	}
	r := CompararPedidos(local, doCore, defasado, corte)
	atributos := []any{"tabela", "pedidos", "dias", dias, "central", r.Central, "core", r.Core, "iguais", r.Iguais,
		"so_central", len(r.SoCentral), "so_core", len(r.SoCore), "so_core_anterior", len(r.SoCoreAnterior), "so_core_nao_venda", r.SoCoreNaoVenda,
		"diferencas", len(r.Diferencas), "totais_loja_dif", len(r.TotaisLoja), "totais_vendedor_dif", len(r.TotaisVendedor),
		"sem_vendedor_no_core", r.SemVendedorNoCore, "recentes_ignorados", r.Recentes, "defasado", r.Defasado, "sincronia_informada", informada}
	if r.Limpo() && !r.Defasado && r.Iguais == 0 && r.Central > 0 {
		// nada foi comparado (tudo "recente" no core, por exemplo): não dá para dizer que está limpo
		slog.Warn("leitura dupla", append(atributos, "resultado", "inconclusiva")...)
		return nil
	}
	if r.Limpo() {
		slog.Info("leitura dupla", append(atributos, "resultado", "limpa")...)
		return nil
	}
	slog.Warn("leitura dupla", append(atributos, "resultado", "divergente",
		"amostra_so_central", amostra(r.SoCentral), "amostra_so_core", amostra(r.SoCore),
		"amostra_diferencas", amostraDif(r.Diferencas), "amostra_totais_loja", amostraDif(r.TotaisLoja),
		"amostra_totais_vendedor", amostraDif(r.TotaisVendedor))...)
	return nil
}
