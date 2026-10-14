package vendas

import (
	"cmp"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const (
	colunasVendedora     = `t.vendor_id, t.nome, t.updated_at`
	colunasCacheVendedor = `t.pedido_id, t.vendor_id, t.pedido_data, t.qtd_itens, t.loja_id`
	// LinhasPorLote: a Gestão à Vista grava de 10 em 10; a Análise de Vendas, os pedidos do período sem quantidade.
	LinhasPorLote = 1000
)

var (
	// GET /comercial/vendedoras: gav:757; admin:559, 4109 (?ordem=nome); av:396.
	consultaVendedoras = dados.Consulta{Tabela: "bling_vendedores", Alias: "t", SQL: `select ` + colunasVendedora + ` from bling_vendedores t`,
		Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.vendor_id", Desempate: "t.vendor_id"}
	// GET /comercial/pedidos-vendedor: gav:758; admin:560, 4111; av:485, 487.
	consultaCacheVendedor = dados.Consulta{Tabela: "bling_pedido_vendedor", Alias: "t", SQL: `select ` + colunasCacheVendedor + ` from bling_pedido_vendedor t`,
		Filtros: []dados.Filtro{{Param: "pedido_id", SQL: "t.pedido_id = any(@pedido_id::bigint[])", Tipo: "inteiro[]"}},
		Ordens:  map[string]string{"pedido_data": "t.pedido_data"}, OrdemPadrao: "t.pedido_id", Desempate: "t.pedido_id"}

	tabelaVendedoras    = dados.Tabela{Nome: "bling_vendedores", Chave: "vendor_id", Resposta: colunasVendedora}
	tabelaCacheVendedor = dados.Tabela{Nome: "bling_pedido_vendedor", Chave: "pedido_id", Resposta: colunasCacheVendedor}

	reChavePositiva = regexp.MustCompile(`^[1-9][0-9]{0,17}$`)
)

// linhaCacheVendedor: o que as telas gravam no cache (tela-de-gestao-a-vista.vue:246, 285; tela-de-analise-vendas.vue:630-636).
type linhaCacheVendedor struct {
	PedidoID   json.RawMessage `json:"pedido_id,omitempty"`
	VendorID   json.RawMessage `json:"vendor_id,omitempty"`
	PedidoData json.RawMessage `json:"pedido_data,omitempty"`
	QtdItens   json.RawMessage `json:"qtd_itens,omitempty"`
	LojaID     json.RawMessage `json:"loja_id,omitempty"`
}

func validarCacheVendedor(l linhaCacheVendedor) error {
	if !reChavePositiva.Match(l.PedidoID) {
		return errors.New("falta o pedido_id (número).")
	}
	if l.VendorID == nil && l.PedidoData == nil && l.QtdItens == nil && l.LojaID == nil {
		return errors.New("nada para gravar além do pedido_id.")
	}
	return nil
}

// linhaVendedora: o que a Gestão à Vista grava (tela-de-gestao-a-vista.vue:308).
type linhaVendedora struct {
	VendorID  json.RawMessage `json:"vendor_id,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	UpdatedAt json.RawMessage `json:"updated_at,omitempty"`
}

func validarVendedora(l linhaVendedora) error {
	if !reChavePositiva.Match(l.VendorID) {
		return errors.New("falta o vendor_id (número).")
	}
	if l.Nome == nil && l.UpdatedAt == nil {
		return errors.New("nada para gravar além do vendor_id.")
	}
	return textoOuNulo("o nome", l.Nome, 200)
}

// gravarLote: POST {linhas:[…]} → cada linha passa pela validação, vira mapa pela MESMA struct
// (dados.Campos) e é gravada por Tabela.Gravar (PodeX + SQL com o mesmo mapa), em ordem de chave, numa
// transação só. ponytail: ~3 consultas por linha (até 1000); um upsert único quando o volume pedir —
// sem perder o PodeX por linha.
func gravarLote[L any](p *pgxpool.Pool, tab dados.Tabela, validar func(L) error) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in struct {
			Linhas []L `json:"linhas"`
		}
		if !dados.LerCorpo(w, r, &in) {
			return
		}
		if n := len(in.Linhas); n == 0 || n > LinhasPorLote {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", fmt.Sprintf("Mande de 1 a %d linhas.", LinhasPorLote))
			return
		}
		type item struct {
			chave  int64
			campos map[string]any
		}
		lote := make([]item, 0, len(in.Linhas))
		for i := range in.Linhas {
			if err := validar(in.Linhas[i]); err != nil {
				dados.Erro(w, http.StatusBadRequest, "pedido_invalido", fmt.Sprintf("Linha %d: %s", i+1, err))
				return
			}
			campos, err := dados.Campos(&in.Linhas[i])
			if err != nil {
				dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
				return
			}
			k, _ := strconv.ParseInt(string(campos[tab.Chave].(json.RawMessage)), 10, 64) // validar já conferiu
			lote = append(lote, item{k, campos})
		}
		// ordem da chave (estável: repetida no lote mantém a ordem da tela, a última vence)
		slices.SortStableFunc(lote, func(a, b item) int { return cmp.Compare(a.chave, b.chave) })
		ctx := r.Context()
		err := banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			for _, it := range lote {
				if _, err := tab.Gravar(ctx, tx, autz.Producao, e, it.campos); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusOK, fmt.Appendf(nil, `{"gravadas":%d}`, len(lote)))
	}
}

func montarCaches(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaVendedoras.Validar(autz.Producao))
	deve(tabelaCacheVendedor.Validar(autz.Producao))
	r.Get("/comercial/vendedoras", consultaVendedoras.Handler(p, autz.Producao))
	r.Get("/comercial/pedidos-vendedor", consultaCacheVendedor.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/comercial/vendedoras/gravar", gravarLote(p, tabelaVendedoras, validarVendedora))
	r.With(soSessaoPropria).Post("/comercial/pedidos-vendedor/gravar", gravarLote(p, tabelaCacheVendedor, validarCacheVendedor))
}
