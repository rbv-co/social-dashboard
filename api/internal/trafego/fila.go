package trafego

import (
	"encoding/json"
	"errors"
	"maps"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

var (
	filtroVeredito = dados.Filtro{Param: "veredito", SQL: "t.veredito = @veredito::text", Tipo: "texto"}
	filtroCampanha = dados.Filtro{Param: "campaign_id", SQL: "t.campaign_id = @campaign_id::text", Tipo: "texto"}
)

var consultaAnalisesDeOrcamento = dados.Consulta{Tabela: "gt_budget_analises", Alias: "t",
	SQL: `select t.campaign_id, t.account_id, t.objetivo, t.effective_status, t.veredito, t.justificativa,
	  t.impacto_estimado, t.impactos, t.budget_atual_centavos, t.budget_sugerido_centavos, t.gerado_em, t.valida_ate
	  from gt_budget_analises t`,
	Filtros:     []dados.Filtro{filtroConta, filtroVeredito},
	OrdemPadrao: "t.gerado_em desc", Desempate: "t.campaign_id"}

var consultaAnalisesDeAnuncio = dados.Consulta{Tabela: "gt_ad_analises", Alias: "t",
	SQL: `select t.ad_id, t.campaign_id, t.account_id, t.veredito, t.justificativa, t.gerado_em, t.valida_ate
	  from gt_ad_analises t`,
	Filtros:     []dados.Filtro{filtroConta, filtroVeredito, filtroCampanha},
	OrdemPadrao: "t.gerado_em desc", Desempate: "t.ad_id"}

// colunasDecisao: o que a tela lê da fila (campaign_id, decisao, decidido_em, silenciar_ate, escopo) + id,
// conta e veredito. decidido_por (uuid de pessoa) não sai: nenhuma tela o lê.
const colunasDecisao = `t.id, t.campaign_id, t.account_id, t.escopo, t.veredito, t.decisao, t.decidido_em, t.silenciar_ate`

var consultaDecisoes = dados.Consulta{Tabela: "gt_fila_decisoes", Alias: "t",
	SQL:     `select ` + colunasDecisao + ` from gt_fila_decisoes t`,
	Filtros: []dados.Filtro{filtroConta, filtroCampanha, {Param: "escopo", SQL: "t.escopo = @escopo::text", Tipo: "texto"}},
	Ordens:  map[string]string{"decidido_em": "t.decidido_em"}, OrdemPadrao: "t.decidido_em desc", Desempate: "t.id"}

// corpoDecisao: o que _gtFilaGravarDecisao grava (tela-de-gestao-trafego.vue:1351-1377), sem decidido_por.
type corpoDecisao struct {
	Escopo                 json.RawMessage `json:"escopo,omitempty"`
	CampaignID             json.RawMessage `json:"campaign_id,omitempty"`
	AccountID              json.RawMessage `json:"account_id,omitempty"`
	Veredito               json.RawMessage `json:"veredito,omitempty"`
	BudgetAtualCentavos    json.RawMessage `json:"budget_atual_centavos,omitempty"`
	BudgetSugeridoCentavos json.RawMessage `json:"budget_sugerido_centavos,omitempty"`
	AnaliseGeradaEm        json.RawMessage `json:"analise_gerada_em,omitempty"`
	Decisao                json.RawMessage `json:"decisao,omitempty"`
	Aplicado               json.RawMessage `json:"aplicado,omitempty"`
	Erro                   json.RawMessage `json:"erro,omitempty"`
}

func (c corpoDecisao) Validar() error {
	var e []error
	if !textoEm(c.Decisao, "aprovada", "recusada") {
		e = append(e, errors.New("decisao é aprovada ou recusada."))
	}
	if c.Escopo != nil && !textoEm(c.Escopo, "orcamento", "criativos", "saude") {
		e = append(e, errors.New("escopo é orcamento, criativos ou saude."))
	}
	if !casa(c.CampaignID, reIDDaMeta) {
		e = append(e, errors.New("campaign_id é o id da campanha na Meta."))
	}
	if c.AccountID != nil && !nulo(c.AccountID) && !casa(c.AccountID, reUUID) {
		e = append(e, errors.New("account_id é o id da conta."))
	}
	if !textoAte(c.Veredito, 40, false) {
		e = append(e, errors.New("veredito tem de 1 a 40 caracteres."))
	}
	if c.Erro != nil && !nulo(c.Erro) && !textoAte(c.Erro, 2000, true) {
		e = append(e, errors.New("erro tem até 2000 caracteres."))
	}
	return errors.Join(e...)
}

// diasDeSilencio: recusar cala a campanha por 7 dias (DIAS_DE_SILENCIO de tela-de-gestao-trafego.vue).
const diasDeSilencio = 7

var tabelaDecisoes = dados.Tabela{Nome: "gt_fila_decisoes", Resposta: colunasDecisao, Autor: "decidido_por"}

// criarDecisao: POST /gestao-trafego/decisoes. Append-only (a migration 2026-07-29-fila-decisoes.sql: corrigir
// é decidir de novo). A linha nova passa na regra de criar do catálogo (Tabela.Criar → PodeCriar) E na
// de LER de quem decide, na MESMA transação e sobre o MESMO mapa (Ruling 5.7-5: decisão de conta que a
// pessoa não vê = 403, nada gravado).
//
// A conta vem da CAMPANHA: a tela junta decisões por campaign_id, então confiar no account_id do corpo
// deixaria quem tem lista calar a campanha de outra conta (mandando conta nula ou a própria). Se a campanha
// está em `campaigns` (tabela do 5.6, leitura direta só para esta checagem) com conta: corpo com conta
// diferente = 403; corpo sem conta (nulo/ausente) = o servidor preenche a conta da campanha. Campanha
// desconhecida (ou sem conta) segue como antes: vale o corpo. Depois vem a conferência de Ler.
func criarDecisao(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var c corpoDecisao
		if !dados.LerCorpo(w, r, &c) {
			return
		}
		if err := c.Validar(); err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		campos, err := dados.Campos(&c)
		if err != nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		// Ruling 5.7-17: o silêncio é do servidor (a tela mandava agora + DIAS_DE_SILENCIO, falsificável).
		if textoEm(c.Decisao, "recusada") {
			campos["silenciar_ate"] = time.Now().UTC().Add(diasDeSilencio * 24 * time.Hour).Format(time.RFC3339Nano)
		}
		ctx := r.Context()
		var corpo []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var conta *string
			err := tx.QueryRow(ctx, `select account_id::text from campaigns where campaign_id = @c::text`,
				pgx.NamedArgs{"c": idDaCampanha(c.CampaignID)}).Scan(&conta)
			if err != nil && !errors.Is(err, pgx.ErrNoRows) {
				return err
			}
			campos := maps.Clone(campos) // o mapa que vai à conferência E ao insert
			if conta != nil {
				if enviada, ok := texto(c.AccountID); ok && !strings.EqualFold(enviada, *conta) {
					return autz.ErrNegado
				}
				campos["account_id"] = *conta
			}
			nova := maps.Clone(campos)
			nova["decidido_por"] = e.ID
			if _, tem := nova["account_id"]; !tem {
				nova["account_id"] = nil // o banco grava nulo: a conferência vê o mesmo
			}
			f, err := autz.Producao.Filtro(e, "gt_fila_decisoes", autz.Ler, "autz_nova")
			if err != nil {
				return err
			}
			ok, err := autz.Conferir(ctx, tx, f, "gt_fila_decisoes", nova)
			if err != nil {
				return err
			}
			if !ok {
				return autz.ErrNegado
			}
			corpo, err = tabelaDecisoes.Criar(ctx, tx, autz.Producao, e, campos)
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, corpo)
	}
}

// idDaCampanha: o campaign_id já validado (Validar) como texto.
func idDaCampanha(v json.RawMessage) string {
	s, _ := texto(v)
	return s
}

func montarFila(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaDecisoes.Validar(autz.Producao))
	r.Get("/gestao-trafego/analises-de-orcamento", consultaAnalisesDeOrcamento.Handler(p, autz.Producao))
	r.Get("/gestao-trafego/analises-de-anuncio", consultaAnalisesDeAnuncio.Handler(p, autz.Producao))
	r.Get("/gestao-trafego/decisoes", consultaDecisoes.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/gestao-trafego/decisoes", criarDecisao(p))
}
