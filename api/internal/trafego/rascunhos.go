package trafego

import (
	"encoding/json"
	"errors"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasRascunho = `t.id, t.account_id, t.criado_por, t.estado, t.passo, t.nome, t.tipo, t.status, t.resultado, t.created_at, t.updated_at`

var consultaRascunhos = dados.Consulta{Tabela: "gt_campanhas_rascunho", Alias: "t",
	SQL:     `select ` + colunasRascunho + ` from gt_campanhas_rascunho t`,
	Filtros: []dados.Filtro{filtroConta, {Param: "status", SQL: "t.status = @status::text", Tipo: "texto"}},
	Ordens:  map[string]string{"updated_at": "t.updated_at"}, OrdemPadrao: "t.updated_at desc", Desempate: "t.id"}

// corpoRascunho: o que linhaParaSalvar (rascunhos.js) e _gtNovoFecharRascunho gravam. criado_por vem da
// sessão (Tabela.Autor): no corpo, dados.LerCorpo recusa.
type corpoRascunho struct {
	AccountID json.RawMessage `json:"account_id,omitempty"`
	Estado    json.RawMessage `json:"estado,omitempty"`
	Passo     json.RawMessage `json:"passo,omitempty"`
	Nome      json.RawMessage `json:"nome,omitempty"`
	Tipo      json.RawMessage `json:"tipo,omitempty"`
	Status    json.RawMessage `json:"status,omitempty"`
	Resultado json.RawMessage `json:"resultado,omitempty"`
}

func (c corpoRascunho) Validar() error {
	var e []error
	if c.AccountID != nil && !casa(c.AccountID, reUUID) {
		e = append(e, errors.New("account_id é o id da conta."))
	}
	if c.Estado != nil && !objeto(c.Estado) {
		e = append(e, errors.New("estado é um objeto."))
	}
	if c.Passo != nil && !inteiroEntre(c.Passo, 0, 50) {
		e = append(e, errors.New("passo é um número de 0 a 50."))
	}
	if c.Nome != nil && !textoAte(c.Nome, 200, true) {
		e = append(e, errors.New("nome tem até 200 caracteres."))
	}
	if c.Tipo != nil && !textoAte(c.Tipo, 120, true) {
		e = append(e, errors.New("tipo tem até 120 caracteres."))
	}
	if c.Status != nil && !textoEm(c.Status, "rascunho", "criada", "falhou") {
		e = append(e, errors.New("status é rascunho, criada ou falhou."))
	}
	if c.Resultado != nil && !nulo(c.Resultado) && !objeto(c.Resultado) {
		e = append(e, errors.New("resultado é um objeto ou nulo."))
	}
	return errors.Join(e...)
}

var tabelaRascunhos = dados.Tabela{Nome: "gt_campanhas_rascunho", Resposta: colunasRascunho, Autor: "criado_por"}

func montarRascunhos(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaRascunhos.Validar(autz.Producao))
	r.Get("/gestao-trafego/rascunhos", consultaRascunhos.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/gestao-trafego/rascunhos", dados.RotaCriar[corpoRascunho](p, autz.Producao, tabelaRascunhos))
	r.With(soSessaoPropria).Patch("/gestao-trafego/rascunhos/{id}", dados.RotaEditar[corpoRascunho](p, autz.Producao, tabelaRascunhos))
	r.With(soSessaoPropria).Delete("/gestao-trafego/rascunhos/{id}", dados.RotaApagar(p, autz.Producao, tabelaRascunhos))
}
