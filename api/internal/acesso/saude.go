package acesso

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

const colunasConferencia = `t.id, t.checked_date, t.account_id, t.check_name, t.status, t.detail, t.created_at`

// GET /saude/conferencias (aba Saúde e a faixa do admin). Regras: dic_sel (true) E a restritiva
// so_contas_permitidas: pode_ver_conta(account_id::text) — conta fora de allowed_accounts nunca aparece
// (a linha sem conta, account_id nulo, passa na regra).
var consultaConferencias = dados.Consulta{Tabela: "data_integrity_checks", Alias: "t",
	SQL: `select ` + colunasConferencia + ` from data_integrity_checks t`,
	Filtros: []dados.Filtro{
		{Param: "checked_date", SQL: "t.checked_date = @checked_date::date", Tipo: "data"},
		{Param: "status", SQL: "t.status = @status::text", Tipo: "texto"},
	},
	Ordens:      map[string]string{"checked_date": "t.checked_date", "created_at": "t.created_at"},
	OrdemPadrao: "t.created_at desc", Desempate: "t.id"}

const colunasExecucao = `t.id, t.run_at, t.robo, t.acao, t.modelo, t.input_tokens, t.output_tokens, t.chamadas, ` +
	`t.usd, t.duracao_ms, t.itens, t.unidade, t.status, t.detalhe, t.github_run_id, t.created_at`

// GET /saude/ia-execucoes. Regra ia_exec_select: true. Rota do admin do 5.1, com colunas declaradas;
// a do 5.12 (/status-ia/execucoes, pacote paineis) é outra rota e não é tocada aqui.
var consultaExecucoes = dados.Consulta{Tabela: "ia_execucoes", Alias: "t",
	SQL:    `select ` + colunasExecucao + ` from ia_execucoes t`,
	Ordens: map[string]string{"run_at": "t.run_at"}, OrdemPadrao: "t.run_at desc", Desempate: "t.id"}

func montarSaude(r chi.Router, p *pgxpool.Pool) {
	deve(consultaConferencias.Validar(autz.Producao))
	deve(consultaExecucoes.Validar(autz.Producao))
	r.Get("/saude/conferencias", consultaConferencias.Handler(p, autz.Producao))
	r.Get("/saude/ia-execucoes", consultaExecucoes.Handler(p, autz.Producao))
}
