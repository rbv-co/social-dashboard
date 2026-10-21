package comercial

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	_ "time/tzdata" // America/Sao_Paulo sem depender do zoneinfo do contêiner

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/webpush"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

var saoPaulo = func() *time.Location {
	l, err := time.LoadLocation("America/Sao_Paulo")
	if err != nil {
		panic(err)
	}
	return l
}()

// PushVendas porta supabase/functions/enviar-push-vendas: soma as vendas do dia por canal
// (22h: hoje × ontem; 07h: ontem × anteontem) e manda UM push a quem quer o tipo 'vendas'.
// EXATIDÃO PRIMEIRO: se faltar qualquer dado (Bling via core, data da nota, valor corrigido,
// itens), NÃO envia nada e a tarefa termina com erro (fica visível em robos_execucoes).
type PushVendas struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	VAPID webpush.VAPID
	HTTP  *http.Client     // para o serviço de push; nil = padrão
	Agora func() time.Time // nil = time.Now
	Fonte string           // VENDAS_FONTE: com `push=espelho` (ou `espelho`) pedidos e itens vêm do espelho do core, sem o Bling
}

const (
	itensOrcamento   = 90 * time.Second // teto para detalhar os itens que faltam no cache
	itensConcorrente = 8
)

// Tarefas: as agendas reais de produção (cron.job, UTC).
func (pv *PushVendas) Tarefas() []worker.Tarefa {
	return []worker.Tarefa{
		{Nome: "enviar-push-vendas-07h", Agenda: "0 10 * * *", Limite: 5 * time.Minute, Executar: func(ctx context.Context) error { return pv.Rodar(ctx, "ontem") }},
		{Nome: "enviar-push-vendas-22h", Agenda: "0 1 * * *", Limite: 5 * time.Minute, Executar: func(ctx context.Context) error { return pv.Rodar(ctx, "hoje") }},
	}
}

// pedidoBling é o pedaço do pedido de venda do Bling que importa aqui.
type pedidoBling struct {
	ID    numero `json:"id"`
	Data  string `json:"data"`
	Total numero `json:"total"`
	Loja  *struct {
		ID *numero `json:"id"` // null/ausente = sem loja (p.loja?.id ?? null)
	} `json:"loja"`
	Itens []json.RawMessage `json:"itens"`
}

// numero aceita número ou texto ("123", "99.9") no JSON; null, "" ou lixo valem 0, como o
// `Number(x) || 0` da edge (um campo estranho não derruba a rodada inteira).
type numero float64

func (n *numero) UnmarshalJSON(b []byte) error {
	f, err := strconv.ParseFloat(strings.TrimSpace(strings.Trim(strings.TrimSpace(string(b)), `"`)), 64)
	if err != nil || math.IsInf(f, 0) || math.IsNaN(f) {
		f = 0
	}
	*n = numero(f)
	return nil
}

// blingGET lê um caminho do Bling pelo core; qualquer coisa que não seja 2xx é erro.
func (pv *PushVendas) blingGET(ctx context.Context, caminho string, q map[string]any, destino any) error {
	r, err := pv.Core.Bling(ctx, core.PedidoBling{Metodo: http.MethodGet, Caminho: caminho, Query: q})
	if err != nil {
		return err
	}
	if r.Status < 200 || r.Status > 299 {
		return fmt.Errorf("bling %s -> %d", caminho, r.Status)
	}
	return json.Unmarshal(r.Corpo, destino)
}

// listarPedidos: pedidos de venda atendidos (situação 9) de um dia, de 100 em 100 (até 10 páginas).
func (pv *PushVendas) listarPedidos(ctx context.Context, dia string) ([]pedido, error) {
	var todos []pedido
	for pagina := 1; pagina <= 10; pagina++ {
		var resp struct {
			Data *[]pedidoBling `json:"data"` // ponteiro: ausente/null não é "dia sem pedido"
		}
		q := map[string]any{"dataInicial": dia, "dataFinal": dia, "idsSituacoes[]": "9", "pagina": strconv.Itoa(pagina), "limite": "100"}
		if err := pv.blingGET(ctx, "/pedidos/vendas", q, &resp); err != nil {
			return nil, err
		}
		if resp.Data == nil {
			return nil, fmt.Errorf("bling /pedidos/vendas: resposta sem lista de pedidos")
		}
		for _, p := range *resp.Data {
			np := pedido{ID: int64(p.ID), Data: p.Data, Total: float64(p.Total)}
			if p.Loja != nil && p.Loja.ID != nil {
				id := int64(*p.Loja.ID)
				np.LojaID = &id
			}
			todos = append(todos, np)
		}
		if len(*resp.Data) < 100 {
			break
		}
	}
	return todos, nil
}

// noEspelho: a fonte de pedidos e itens do push (VENDAS_FONTE, tela `push`).
func (pv *PushVendas) noEspelho() bool { return FonteDeVendas(pv.Fonte, "push") == "espelho" }

// listarPedidosEspelho é listarPedidos sem o Bling: os pedidos Atendido do dia e, de quebra, a quantidade de itens de
// cada um (linhas de pedido_itens), que no caminho do Bling vinha do cache da Gestão à Vista ou de um detalhe por pedido.
func (pv *PushVendas) listarPedidosEspelho(ctx context.Context, dia string) ([]pedido, map[int64]int, *core.Sincronia, error) {
	lidos, sinc, err := lerPedidosDoEspelho(ctx, pv.Core, dia, dia, nil)
	if err != nil {
		return nil, nil, nil, err
	}
	todos, itens := make([]pedido, 0, len(lidos)), make(map[int64]int, len(lidos))
	for _, p := range lidos {
		id, err := p.ID.Int64()
		if err != nil {
			return nil, nil, nil, fmt.Errorf("pedido com id torto: %q", p.ID)
		}
		np := pedido{ID: id, Data: p.Data, Total: p.Total}
		if p.Loja != nil {
			if l, err := p.Loja.ID.Int64(); err == nil {
				np.LojaID = &l
			}
		}
		todos = append(todos, np)
		itens[id] = len(p.Itens)
	}
	return todos, itens, sinc, nil
}

// espelhoServeAoPush: o espelho só vale para o push se a última sincronização boa cobre o dia lido. Pelo Bling o número era
// sempre o do momento; aqui, uma sincronia parada às 15h mandaria às 22h um total menor como se fosse o do dia. Para
// "hoje" o limite é a idade de 30 min da tela; para "ontem", ter sincronizado depois da virada do dia.
func espelhoServeAoPush(s *core.Sincronia, agora time.Time, diaRef string) error {
	if s == nil || s.UltimoOK == nil {
		return errors.New("sem informação de quando o espelho foi sincronizado")
	}
	if s.Atrasado {
		return fmt.Errorf("sincronia atrasada (última boa às %s)", s.UltimoOK.In(saoPaulo).Format("02/01 15:04"))
	}
	limite := agora.Add(-vendasIdadeAviso)
	if d, err := time.ParseInLocation("2006-01-02", diaRef, saoPaulo); err == nil {
		if fim := d.AddDate(0, 0, 1); fim.Before(limite) {
			limite = fim
		}
	}
	if s.UltimoOK.Before(limite) {
		return fmt.Errorf("última sincronização boa às %s não cobre o dia %s", s.UltimoOK.In(saoPaulo).Format("02/01 15:04"), diaRef)
	}
	return nil
}

// contarItensNoEspelho completa a contagem de itens dos pedidos que entraram pela data da nota (fora da lista do dia):
// também vêm do espelho, para o push "sem o Bling" não depender dele nesse caminho.
func (pv *PushVendas) contarItensNoEspelho(ctx context.Context, todos []*pedido, cache map[int64]int) error {
	var ids []string
	for _, p := range todos {
		if _, ok := cache[p.ID]; !ok {
			ids = append(ids, strconv.FormatInt(p.ID, 10))
		}
	}
	if len(ids) == 0 {
		return nil
	}
	lidos, _, err := lerPedidosDoEspelho(ctx, pv.Core, "", "", ids)
	if err != nil {
		return err
	}
	for _, p := range lidos {
		if id, err := p.ID.Int64(); err == nil {
			cache[id] = len(p.Itens)
		}
	}
	for _, p := range todos {
		if _, ok := cache[p.ID]; !ok {
			return fmt.Errorf("pedido %d fora do espelho", p.ID)
		}
	}
	return nil
}

// linhasDoDia: bling_pedido_nota que toca o dia (pela data da venda OU do pedido), com
// nota_situacao — a coluna que as telas leem e que a regra de nota negada/autorizada exige.
func (pv *PushVendas) linhasDoDia(ctx context.Context, dia string) ([]linhaDaNota, error) {
	linhas, err := pv.Pool.Query(ctx, `select pedido_id, data_pedido::text, coalesce(data_da_venda::text, ''), coalesce(total, 0)::float8, loja_id, nota_situacao::int
		from bling_pedido_nota where data_da_venda = $1::date or data_pedido = $1::date`, dia)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l linhaDaNota, err error) {
		return l, r.Scan(&l.PedidoID, &l.DataPedido, &l.DataDaVenda, &l.Total, &l.LojaID, &l.NotaSituacao)
	})
}

func (pv *PushVendas) Rodar(ctx context.Context, modo string) error {
	// Config errada falha AQUI, uma vez, e vira erro da tarefa (robos_execucoes ok=false) em vez
	// de 100% das inscrições falharem caladas.
	if _, err := webpush.ValidarVAPID(pv.VAPID); err != nil {
		return err
	}
	agora := time.Now
	if pv.Agora != nil {
		agora = pv.Agora
	}
	hoje := agora().In(saoPaulo)
	dia := func(n int) string { return hoje.AddDate(0, 0, -n).Format("2006-01-02") }
	diaRef, diaCmp, refLabel, cmpLabel := dia(0), dia(1), "hoje", "ontem"
	if modo == "ontem" {
		diaRef, diaCmp, refLabel, cmpLabel = dia(1), dia(2), "ontem", "anteontem"
	}

	// A fonte dos pedidos: o Bling (via core) ou o espelho do core, que também já traz a quantidade de itens.
	var sinc *core.Sincronia
	listar, indisponivel := func(ctx context.Context, dia string) ([]pedido, map[int64]int, error) {
		p, err := pv.listarPedidos(ctx, dia)
		return p, nil, err
	}, "bling_indisponivel"
	if pv.noEspelho() {
		listar, indisponivel = func(ctx context.Context, dia string) ([]pedido, map[int64]int, error) {
			p, it, s, err := pv.listarPedidosEspelho(ctx, dia)
			sinc = piorSincronia(sinc, s)
			return p, it, err
		}, "espelho_indisponivel"
	}
	ref, itensRef, err := listar(ctx, diaRef)
	if err != nil {
		return fmt.Errorf("%s: %w", indisponivel, err)
	}
	cmpDia, itensCmp, err := listar(ctx, diaCmp)
	if err != nil {
		return fmt.Errorf("%s: %w", indisponivel, err)
	}
	if pv.noEspelho() {
		if err := espelhoServeAoPush(sinc, agora(), diaRef); err != nil {
			return fmt.Errorf("espelho_defasado: %w", err)
		}
	}
	lRef, err := pv.linhasDoDia(ctx, diaRef)
	if err != nil {
		return fmt.Errorf("data_da_venda_indisponivel: %w", err)
	}
	lCmp, err := pv.linhasDoDia(ctx, diaCmp)
	if err != nil {
		return fmt.Errorf("data_da_venda_indisponivel: %w", err)
	}
	ref = ajustarPelaDataDaNota(ref, lRef, diaRef, diaRef)
	cmpDia = ajustarPelaDataDaNota(cmpDia, lCmp, diaCmp, diaCmp)

	ajustes := map[int64]float64{}
	linhas, err := pv.Pool.Query(ctx, `select pedido_id, total_corrigido::float8 from bling_pedido_ajuste_valor where total_corrigido is not null`)
	if err != nil {
		return fmt.Errorf("valor_corrigido_indisponivel: %w", err)
	}
	var id int64
	var v float64
	if _, err := pgx.ForEachRow(linhas, []any{&id, &v}, func() error { ajustes[id] = v; return nil }); err != nil {
		return fmt.Errorf("valor_corrigido_indisponivel: %w", err)
	}
	ref = aplicarValorCorrigido(ref, ajustes)
	cmpDia = aplicarValorCorrigido(cmpDia, ajustes)

	// Itens: o cache que a Gestão à Vista popula; o que faltar, detalhe no Bling. Se não der
	// para contar TODOS, os itens não seriam exatos: não envia.
	todos := append(append([]*pedido{}, ponteiros(ref)...), ponteiros(cmpDia)...)
	ids := make([]int64, len(todos))
	for i, p := range todos {
		ids[i] = p.ID
	}
	cache := map[int64]int{}
	linhas, err = pv.Pool.Query(ctx, `select pedido_id, qtd_itens from bling_pedido_vendedor where pedido_id = any($1) and qtd_itens is not null`, ids)
	if err != nil {
		return fmt.Errorf("itens_incompletos: %w", err)
	}
	var qtd int
	if _, err := pgx.ForEachRow(linhas, []any{&id, &qtd}, func() error { cache[id] = qtd; return nil }); err != nil {
		return fmt.Errorf("itens_incompletos: %w", err)
	}
	for _, m := range []map[int64]int{itensRef, itensCmp} { // a contagem do espelho vale mais que a do cache
		for k, n := range m {
			cache[k] = n
		}
	}
	completar := pv.detalharFaltantes
	if pv.noEspelho() {
		completar = pv.contarItensNoEspelho
	}
	if err := completar(ctx, todos, cache); err != nil {
		return fmt.Errorf("itens_incompletos: %w", err)
	}
	for _, p := range todos {
		p.Itens = cache[p.ID]
	}

	linhas, err = pv.Pool.Query(ctx, `select loja_id, coalesce(nome, '') from bling_lojas`)
	if err != nil {
		return err
	}
	lojas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c canalAgregado, err error) {
		return c, r.Scan(&c.LojaID, &c.Nome)
	})
	if err != nil {
		return err
	}
	payload, _ := json.Marshal(montarCorpo(agregarVendasPorCanal(ref, cmpDia, lojas), refLabel, cmpLabel))

	// Quem quer 'vendas': inscrição COM dono; sem preferência gravada vale o padrão do tipo,
	// que para 'vendas' é LIGADO (_shared/notificacoes.js).
	alvos, err := webpush.Destinatarios(ctx, pv.Pool, "vendas", "")
	if err != nil {
		return err
	}
	// Rodar de novo nunca reenvia: o livro leva a TAREFA e o dia de referência. O 22h de D e o 07h de D+1
	// têm o mesmo diaRef (D), por isso o modo entra na chave: são dois pushes diferentes, um por tarefa.
	tarefa := "enviar-push-vendas-22h"
	if modo == "ontem" {
		tarefa = "enviar-push-vendas-07h"
	}
	r, err := webpush.Entregar(ctx, pv.Pool, pv.HTTP, alvos, payload, pv.VAPID, tarefa+":"+diaRef)
	if err != nil {
		return err
	}
	slog.Info("push de vendas", "modo", modo, "dia", diaRef, "pedidos", len(todos), "enviados", r.Enviados, "podados", r.Podados, "repetidos", r.Repetidos, "falhas", r.Falhas)
	// Assinante morto (404/410) podado é manutenção normal e destino já servido hoje (Repetido) conta como
	// entregue; falha é ter destino que recusou/falhou e nenhum push aceito nem já entregue (mesma regra do frota).
	if r.Falhas > 0 && r.Enviados+r.Repetidos == 0 {
		return fmt.Errorf("nenhum_push_entregue: %d inscrições, 0 aceitas (%d falharam, %d podadas)", len(alvos), r.Falhas, r.Podados)
	}
	return nil
}

func ponteiros(ps []pedido) []*pedido {
	out := make([]*pedido, len(ps))
	for i := range ps {
		out[i] = &ps[i]
	}
	return out
}

// detalharFaltantes busca no Bling (via core) os itens dos pedidos fora do cache, com até 8
// em paralelo e 90 s no total. Qualquer falha = erro (os itens não seriam exatos).
func (pv *PushVendas) detalharFaltantes(ctx context.Context, todos []*pedido, cache map[int64]int) error {
	var faltam []int64
	for _, p := range todos {
		if _, ok := cache[p.ID]; !ok {
			faltam = append(faltam, p.ID)
		}
	}
	if len(faltam) == 0 {
		return nil
	}
	ctx, cancela := context.WithTimeout(ctx, itensOrcamento)
	defer cancela()
	var (
		mu     sync.Mutex
		wg     sync.WaitGroup
		falhou error
		fila   = make(chan int64)
	)
	for range min(itensConcorrente, len(faltam)) {
		wg.Go(func() {
			for id := range fila {
				var det struct {
					Data pedidoBling `json:"data"`
				}
				err := pv.blingGET(ctx, "/pedidos/vendas/"+strconv.FormatInt(id, 10), nil, &det)
				mu.Lock()
				if err != nil && falhou == nil {
					falhou = err
					cancela() // ninguém começa outra: o resultado já não seria exato
				}
				if err == nil {
					cache[id] = len(det.Data.Itens)
				}
				mu.Unlock()
			}
		})
	}
	for _, id := range faltam {
		if ctx.Err() != nil {
			break
		}
		fila <- id
	}
	close(fila)
	wg.Wait()
	if falhou == nil && ctx.Err() != nil {
		falhou = ctx.Err()
	}
	return falhou
}
