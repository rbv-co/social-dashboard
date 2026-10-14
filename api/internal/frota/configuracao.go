package frota

import (
	"encoding/json"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasItem = `t.id, t.ordem, t.item, t.cadencia, t.ativo, t.observacao, t.impede_uso`
const colunasConfig = `t.id, t.dia_semanal, t.semana_mensal, t.dia_mensal`
const colunasPlano = `t.id, t.item, t.a_cada_km, t.ordem, t.ativo, t.observacao`

var consultaItens = dados.Consulta{Tabela: "frota_checklist_itens", Alias: "t", SQL: `select ` + colunasItem + ` from frota_checklist_itens t`,
	Ordens: map[string]string{"ordem": "t.ordem"}, OrdemPadrao: "t.ordem", Desempate: "t.id"}

var consultaConfig = dados.Consulta{Tabela: "frota_checklist_config", Alias: "t", SQL: `select ` + colunasConfig + ` from frota_checklist_config t`,
	Ordens: map[string]string{"id": "t.id"}, OrdemPadrao: "t.id", Desempate: "t.id"}

var consultaPlano = dados.Consulta{Tabela: "frota_plano_revisao", Alias: "t", SQL: `select ` + colunasPlano + ` from frota_plano_revisao t`,
	Ordens: map[string]string{"ordem": "t.ordem"}, OrdemPadrao: "t.ordem", Desempate: "t.id"}

// POST /frota/checklist-itens {item, cadencia, ordem} (editor-de-checklist.vue:68) e PATCH /{id}
// {impede_uso, ativo} (tela-de-frota.vue:2307, 2320). Nome repetido = 409.
type corpoItemNovo struct {
	Item     json.RawMessage `json:"item,omitempty"`
	Cadencia json.RawMessage `json:"cadencia,omitempty"`
	Ordem    json.RawMessage `json:"ordem,omitempty"`
}

type corpoItemEdicao struct {
	ImpedeUso json.RawMessage `json:"impede_uso,omitempty"`
	Ativo     json.RawMessage `json:"ativo,omitempty"`
}

var tabelaItens = dados.Tabela{Nome: "frota_checklist_itens", Resposta: colunasItem}

// PATCH /frota/checklist-config {dia_semanal, semana_mensal, dia_mensal}: a linha única id = true,
// fixada pela rota com naLinha (Ruling 5.3-16).
type corpoConfig struct {
	DiaSemanal   json.RawMessage `json:"dia_semanal,omitempty"`
	SemanaMensal json.RawMessage `json:"semana_mensal,omitempty"`
	DiaMensal    json.RawMessage `json:"dia_mensal,omitempty"`
}

var tabelaConfig = dados.Tabela{Nome: "frota_checklist_config", Resposta: colunasConfig}

// POST /frota/plano-revisao {item, a_cada_km, observacao, ordem}; PATCH /{id} {item, a_cada_km,
// observacao, ativo} (tela-de-frota.vue:2935, 2936, 2945). Sem DELETE (a tela desliga).
type corpoPlano struct {
	Item       json.RawMessage `json:"item,omitempty"`
	ACadaKm    json.RawMessage `json:"a_cada_km,omitempty"`
	Observacao json.RawMessage `json:"observacao,omitempty"`
	Ordem      json.RawMessage `json:"ordem,omitempty"`
	Ativo      json.RawMessage `json:"ativo,omitempty"`
}

var tabelaPlano = dados.Tabela{Nome: "frota_plano_revisao", Resposta: colunasPlano}

func montarConfiguracao(r chi.Router, p *pgxpool.Pool) {
	for _, c := range []dados.Consulta{consultaItens, consultaConfig, consultaPlano} {
		deve(c.Validar(autz.Producao))
	}
	for _, t := range []dados.Tabela{tabelaItens, tabelaConfig, tabelaPlano} {
		deve(t.Validar(autz.Producao))
	}
	r.Get("/frota/checklist-itens", consultaItens.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/checklist-itens", dados.RotaCriar[corpoItemNovo](p, autz.Producao, tabelaItens))
	r.With(soSessaoPropria).Patch("/frota/checklist-itens/{id}", dados.RotaEditar[corpoItemEdicao](p, autz.Producao, tabelaItens))
	r.Get("/frota/checklist-config", consultaConfig.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Patch("/frota/checklist-config", naLinha("true", dados.RotaEditar[corpoConfig](p, autz.Producao, tabelaConfig)))
	r.Get("/frota/plano-revisao", consultaPlano.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/frota/plano-revisao", dados.RotaCriar[corpoPlano](p, autz.Producao, tabelaPlano))
	r.With(soSessaoPropria).Patch("/frota/plano-revisao/{id}", dados.RotaEditar[corpoPlano](p, autz.Producao, tabelaPlano))
}
