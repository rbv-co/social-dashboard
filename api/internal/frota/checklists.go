package frota

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasChecklist = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.feita_em, t.cadencias, t.hodometro, ` +
	`t.hodometro_justificativa, t.resultado, t.anomalias, t.criada_em, t.criada_por, t.aberta_em, t.assinada_em, ` +
	`t.assinada_por, t.assinatura_hash, t.assinatura_hash_anterior, t.sem_assinatura_motivo, t.assinatura_rabisco, t.assinatura_versao`
const colunasResposta = `t.id, t.checklist_id, t.item_id, t.item_texto, t.cadencia, t.estado, t.observacao, t.ordem`
const colunasCopia = `t.checklist_id, t.situacao, t.tentativas, t.ultimo_erro, t.criado_em, t.enviado_em`

var consultaChecklists = dados.Consulta{Tabela: "frota_checklist", Alias: "t", SQL: `select ` + colunasChecklist + ` from frota_checklist t`,
	Filtros: []dados.Filtro{
		{Param: "veiculo_id", SQL: "t.veiculo_id = @veiculo_id::uuid", Tipo: "uuid"},
		{Param: "feita_de", SQL: "t.feita_em >= @feita_de::date", Tipo: "data"},
		{Param: "feita_ate", SQL: "t.feita_em <= @feita_ate::date", Tipo: "data"},
		{Param: "assinada", SQL: "(t.assinada_em is not null) = @assinada::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"feita_em": "t.feita_em"}, OrdemPadrao: "t.feita_em desc", Desempate: "t.id"}

var consultaRespostas = dados.Consulta{Tabela: "frota_checklist_respostas", Alias: "t",
	SQL:     `select ` + colunasResposta + ` from frota_checklist_respostas t`,
	Filtros: []dados.Filtro{{Param: "checklist_id", SQL: "t.checklist_id = any(@checklist_id::uuid[])", Tipo: "uuid[]"}},
	Ordens:  map[string]string{"ordem": "t.ordem"}, OrdemPadrao: "t.ordem", Desempate: "t.id"}

// A fila do PDF (frota_checklist_pdf_ler: is_frota_admin()): as três leituras de "cópias no Zoho".
var consultaCopias = dados.Consulta{Tabela: "frota_checklist_pdf", Alias: "t", SQL: `select ` + colunasCopia + ` from frota_checklist_pdf t`,
	Filtros: []dados.Filtro{
		{Param: "situacao", SQL: "t.situacao = @situacao::text", Tipo: "texto"},
		{Param: "pendente", SQL: "(t.situacao <> 'enviado') = @pendente::boolean", Tipo: "booleano"},
	},
	Ordens: map[string]string{"criado_em": "t.criado_em"}, OrdemPadrao: "t.criado_em", Desempate: "t.id"}

var tabelaChecklists = dados.Tabela{Nome: "frota_checklist", Resposta: colunasChecklist, Autor: "criada_por"}
var tabelaRespostas = dados.Tabela{Nome: "frota_checklist_respostas", Resposta: colunasResposta}

// A ficha (painel-de-checklist.vue:217-232 + pessoa e motivo, tela-de-frota.vue:2117, 2195). Fora:
// criada_por, assinada_* (vêm da sessão ou da assinatura) — mandar = 400.
type corpoFicha struct {
	VeiculoID              json.RawMessage `json:"veiculo_id,omitempty"`
	FeitaEm                json.RawMessage `json:"feita_em,omitempty"`
	PessoaID               json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome             json.RawMessage `json:"pessoa_nome,omitempty"`
	Cadencias              json.RawMessage `json:"cadencias,omitempty"`
	Hodometro              json.RawMessage `json:"hodometro,omitempty"`
	HodometroJustificativa json.RawMessage `json:"hodometro_justificativa,omitempty"`
	Resultado              json.RawMessage `json:"resultado,omitempty"`
	Anomalias              json.RawMessage `json:"anomalias,omitempty"`
	SemAssinaturaMotivo    json.RawMessage `json:"sem_assinatura_motivo,omitempty"`
}

// Uma resposta; checklist_id e ordem são da rota.
type corpoResposta struct {
	ItemID     json.RawMessage `json:"item_id,omitempty"`
	ItemTexto  json.RawMessage `json:"item_texto,omitempty"`
	Cadencia   json.RawMessage `json:"cadencia,omitempty"`
	Estado     json.RawMessage `json:"estado,omitempty"`
	Observacao json.RawMessage `json:"observacao,omitempty"`
}

// A assinatura (tela-de-frota.vue:2179-2193): o que foi assinado vem do corpo; assinada_por, da sessão.
type corpoAssinatura struct {
	AbertaEm               json.RawMessage `json:"aberta_em,omitempty"`
	AssinadaEm             json.RawMessage `json:"assinada_em,omitempty"`
	AssinaturaHash         json.RawMessage `json:"assinatura_hash,omitempty"`
	AssinaturaHashAnterior json.RawMessage `json:"assinatura_hash_anterior,omitempty"`
	AssinaturaVersao       json.RawMessage `json:"assinatura_versao,omitempty"`
	AssinaturaRabisco      json.RawMessage `json:"assinatura_rabisco,omitempty"`
}

type pedidoFicha struct {
	Ficha      corpoFicha       `json:"ficha"`
	Respostas  []corpoResposta  `json:"respostas"`
	Assinatura *corpoAssinatura `json:"assinatura"`
}

func (in pedidoFicha) validar() error {
	switch {
	case len(in.Respostas) > 200:
		return errors.New("Uma ficha tem no máximo 200 itens.")
	case in.Assinatura != nil && (vazio(in.Assinatura.AssinadaEm) || vazio(in.Assinatura.AssinaturaHash)):
		return errors.New("A assinatura precisa da hora e da impressão digital.")
	case in.Assinatura != nil && !vazio(in.Ficha.SemAssinaturaMotivo):
		return errors.New("Ficha assinada não tem motivo de ficar sem assinatura.")
	}
	return nil
}

// gravarFicha: POST /frota/checklists. Hoje são 3 gravações (tela-de-frota.vue:2209, 2229, 2247) e a tela
// trata à mão a ficha que ficou sem respostas ou sem assinatura — estados que o índice "um carro, um dia,
// uma ficha" e o gatilho de imutabilidade tornam PERMANENTES. Aqui é uma transação (Ruling 5.3-7).
func gravarFicha(p *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		e := autz.EscopoDo(r.Context())
		if e == nil {
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		var in pedidoFicha
		if !dados.LerCorpo(w, r, &in) { // decodificador estrito: campo a mais em qualquer nível = 400
			return
		}
		if err := in.validar(); err != nil {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", err.Error())
			return
		}
		ficha, err := dados.Campos(&in.Ficha)
		respostas := make([]map[string]any, len(in.Respostas))
		for i := range in.Respostas {
			if err == nil {
				respostas[i], err = dados.Campos(&in.Respostas[i])
			}
		}
		var assinatura map[string]any
		if err == nil && in.Assinatura != nil {
			if assinatura, err = dados.Campos(in.Assinatura); err == nil {
				assinatura["assinada_por"] = e.ID // autoria da sessão; o corpo não tem o campo
			}
		}
		if err != nil { // tag de struct inválida: defeito da rota
			dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
			return
		}
		ctx := r.Context()
		var linha []byte
		err = banco.ComUsuario(ctx, p, e.ID, func(tx pgx.Tx) error {
			var err error
			if linha, err = tabelaChecklists.Criar(ctx, tx, autz.Producao, e, ficha); err != nil {
				return err
			}
			id, err := idDaLinha(linha)
			if err != nil {
				return err
			}
			for i, rsp := range respostas {
				rsp["checklist_id"], rsp["ordem"] = id, i
				if _, err := tabelaRespostas.Criar(ctx, tx, autz.Producao, e, rsp); err != nil {
					return err
				}
			}
			if assinatura != nil {
				linha, err = tabelaChecklists.Editar(ctx, tx, autz.Producao, e, id, assinatura)
			}
			return err
		})
		if err != nil {
			dados.ErroDeEscrita(w, err)
			return
		}
		dados.Responder(w, http.StatusCreated, linha)
	}
}

func montarChecklists(r chi.Router, p *pgxpool.Pool) {
	for _, c := range []dados.Consulta{consultaChecklists, consultaRespostas, consultaCopias} {
		deve(c.Validar(autz.Producao))
	}
	deve(tabelaChecklists.Validar(autz.Producao))
	deve(tabelaRespostas.Validar(autz.Producao))
	r.Get("/frota/checklists", consultaChecklists.Handler(p, autz.Producao))
	r.Get("/frota/checklists/respostas", consultaRespostas.Handler(p, autz.Producao))
	r.Get("/frota/checklists/copias", consultaCopias.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/checklists", gravarFicha(p))
}
