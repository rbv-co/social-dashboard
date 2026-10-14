package acessos

import (
	"encoding/json"
	"errors"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Estrutura: organizações e setores. Regra só de ator (acessos_organizacoes_rw e acessos_setores_rw:
// is_acessos_admin() para ler, criar e apagar), nenhuma linha restringe. Sem PATCH: nenhuma tela renomeia.
//
// Apagar em uso é permitido, como em produção: as FKs on delete set null zeram organizacao_id de
// setores e fichas, setor_id de fichas e de times (equipes.setor_id), inclusive em linhas que a pessoa
// não alcança (ação de FK não passa pela RLS). A tela já avisa "ficarão sem setor". Nome repetido = 409:
// organização por nome (unique); setor por (organizacao_id, nome), PRESUMIDO da 014 (sem organização o
// índice não impede repetição; o conferir da Task 7 é a rede).
const (
	colunasOrganizacao = `t.id, t.nome, t.ordem, t.criado_em`
	colunasSetor       = `t.id, t.nome, t.cor, t.ordem, t.criado_em, t.organizacao_id`
)

// Leituras: as telas pedem ordem, depois nome (padrão); o admin pede só nome.
var (
	consultaOrganizacoes = dados.Consulta{Tabela: "acessos_organizacoes", Alias: "t",
		SQL:    `select ` + colunasOrganizacao + ` from acessos_organizacoes t`,
		Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
	consultaSetores = dados.Consulta{Tabela: "acessos_setores", Alias: "t",
		SQL:    `select ` + colunasSetor + ` from acessos_setores t`,
		Ordens: map[string]string{"nome": "t.nome"}, OrdemPadrao: "t.ordem, t.nome", Desempate: "t.id"}
)

// Corpos do POST (o "+" das telas). `cor` não entra: nenhuma tela a grava.
type corpoOrganizacao struct {
	Nome  json.RawMessage `json:"nome,omitempty"`
	Ordem json.RawMessage `json:"ordem,omitempty"`
}
type corpoSetor struct {
	Nome          json.RawMessage `json:"nome,omitempty"`
	Ordem         json.RawMessage `json:"ordem,omitempty"`
	OrganizacaoID json.RawMessage `json:"organizacao_id,omitempty"`
}

var errNome = errors.New("Nome é obrigatório")

func (c corpoOrganizacao) Validar() error {
	if emBranco(c.Nome) {
		return errNome
	}
	return nil
}

func (c corpoSetor) Validar() error {
	if emBranco(c.Nome) {
		return errNome
	}
	return nil
}

var (
	tabelaOrganizacoes = dados.Tabela{Nome: "acessos_organizacoes", Resposta: colunasOrganizacao}
	tabelaSetores      = dados.Tabela{Nome: "acessos_setores", Resposta: colunasSetor}
)

// montarEstrutura: GET, POST e DELETE {id} das duas; cada escrita com soSessaoPropria.
func montarEstrutura(r chi.Router, p *pgxpool.Pool) {
	deve(tabelaOrganizacoes.Validar(autz.Producao))
	deve(tabelaSetores.Validar(autz.Producao))
	r.Get("/acessos/organizacoes", consultaOrganizacoes.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/organizacoes", dados.RotaCriar[corpoOrganizacao](p, autz.Producao, tabelaOrganizacoes))
	r.With(soSessaoPropria).Delete("/acessos/organizacoes/{id}", dados.RotaApagar(p, autz.Producao, tabelaOrganizacoes))
	r.Get("/acessos/setores", consultaSetores.Handler(p, autz.Producao))
	r.With(soSessaoPropria).Post("/acessos/setores", dados.RotaCriar[corpoSetor](p, autz.Producao, tabelaSetores))
	r.With(soSessaoPropria).Delete("/acessos/setores/{id}", dados.RotaApagar(p, autz.Producao, tabelaSetores))
}
