package frota

import (
	"encoding/json"
	"errors"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasRequisicao = `t.id, t.veiculo_id, t.pessoa_id, t.pessoa_nome, t.departamento, t.destino, t.finalidade, ` +
	`t.retirada_prevista, t.devolucao_prevista, t.situacao, t.criada_por, t.criada_em, t.decidida_por, t.decidida_em, ` +
	`t.motivo_decisao, t.uso_id, t.observacao, t.encerrada_por, t.encerrada_em, t.encerrada_motivo, t.arquivada_em, t.arquivada_por`

// GET /frota/requisicoes (frota_req_ler: is_frota_admin() — quem vê a Frota vê a agenda inteira).
var consultaRequisicoes = dados.Consulta{Tabela: "frota_requisicoes", Alias: "t",
	SQL:    `select ` + colunasRequisicao + ` from frota_requisicoes t`,
	Ordens: map[string]string{"retirada_prevista": "t.retirada_prevista"}, OrdemPadrao: "t.retirada_prevista", Desempate: "t.id"}

// POST /frota/requisicoes (frota_req_criar: is_frota_admin() AND criada_por = auth.uid()). criada_por vem
// da sessão por Tabela.Autor — e TEM de estar no mapa: o PodeCriar exige toda coluna que a regra lê.
// Sem situacao: a reserva nasce pendente (Ruling 5.3-11). tela-de-frota.vue:2439.
type corpoReservaNova struct {
	VeiculoID         json.RawMessage `json:"veiculo_id,omitempty"`
	PessoaID          json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome        json.RawMessage `json:"pessoa_nome,omitempty"`
	Departamento      json.RawMessage `json:"departamento,omitempty"`
	Destino           json.RawMessage `json:"destino,omitempty"`
	Finalidade        json.RawMessage `json:"finalidade,omitempty"`
	RetiradaPrevista  json.RawMessage `json:"retirada_prevista,omitempty"`
	DevolucaoPrevista json.RawMessage `json:"devolucao_prevista,omitempty"`
	Observacao        json.RawMessage `json:"observacao,omitempty"`
}

// PATCH /frota/requisicoes/{id} (frota_req_atualizar: is_frota_admin()). Quem pode decidir, cancelar,
// revogar, arquivar ou mudar o conteúdo é o GATILHO (frota_checar_decisao, frota_checar_arquivamento),
// com a frase dele; quem decidiu/encerrou/arquivou e o histórico também (auth.uid()). As colunas e os
// valores de situacao são os que a tela grava (1718, 2486, 2743, 2796, 2833).
type corpoReservaEdicao struct {
	VeiculoID         json.RawMessage `json:"veiculo_id,omitempty"`
	PessoaID          json.RawMessage `json:"pessoa_id,omitempty"`
	PessoaNome        json.RawMessage `json:"pessoa_nome,omitempty"`
	Departamento      json.RawMessage `json:"departamento,omitempty"`
	Destino           json.RawMessage `json:"destino,omitempty"`
	Finalidade        json.RawMessage `json:"finalidade,omitempty"`
	RetiradaPrevista  json.RawMessage `json:"retirada_prevista,omitempty"`
	DevolucaoPrevista json.RawMessage `json:"devolucao_prevista,omitempty"`
	Observacao        json.RawMessage `json:"observacao,omitempty"`
	Situacao          json.RawMessage `json:"situacao,omitempty"`
	MotivoDecisao     json.RawMessage `json:"motivo_decisao,omitempty"`
	EncerradaMotivo   json.RawMessage `json:"encerrada_motivo,omitempty"`
	ArquivadaEm       json.RawMessage `json:"arquivada_em,omitempty"`
	UsoID             json.RawMessage `json:"uso_id,omitempty"`
}

// Validar: situacao só com os valores que a tela grava (Ruling 5.3-11): nada volta a 'pendente'.
func (c corpoReservaEdicao) Validar() error {
	if c.Situacao == nil {
		return nil
	}
	var s string
	if json.Unmarshal(c.Situacao, &s) != nil || !slices.Contains([]string{"aprovada", "recusada", "cancelada", "revogada", "usada"}, s) {
		return errors.New("situacao deve ser aprovada, recusada, cancelada, revogada ou usada")
	}
	return nil
}

var tabelaRequisicoes = dados.Tabela{Nome: "frota_requisicoes", Resposta: colunasRequisicao, Autor: "criada_por"}

// Sem DELETE: não há policy de apagar reserva (ela se arquiva).
func montarRequisicoes(r chi.Router, p *pgxpool.Pool) {
	deve(consultaRequisicoes.Validar(autz.Producao))
	deve(tabelaRequisicoes.Validar(autz.Producao))
	r.Get("/frota/requisicoes", consultaRequisicoes.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/requisicoes", dados.RotaCriar[corpoReservaNova](p, autz.Producao, tabelaRequisicoes))
	r.With(soSessaoPropria).Patch("/frota/requisicoes/{id}", dados.RotaEditar[corpoReservaEdicao](p, autz.Producao, tabelaRequisicoes))
}
