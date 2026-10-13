package trafego

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// GestorDeTrafego: a checagem de gt_registrar_problemas (02-funções.csv:1223-1229): perfil com papel admin
// ou 'meta.gestor' em features. Sem conta_ativa e sem super-admin, como a função (a sessão de conta
// desativada nem existe: auth.Exigir a recusa).
var GestorDeTrafego = autz.Regra(func(e *autz.Escopo) bool {
	return e != nil && e.TemPerfil && (e.Papel == "admin" || e.Modulo("meta.gestor"))
})

// FuncoesRPC: as RPCs do 5.7 na lista branca de POST /rpc/{nome} (web.FuncoesRPC as junta).
var FuncoesRPC = []rpc.Funcao{
	{Nome: "gt_registrar_problemas", Retorno: rpc.Valor, Portao: GestorDeTrafego, SoSessaoPropria: true, ParamConta: "p_conta",
		Params:   []rpc.Param{{Nome: "p_conta", Tipo: "text"}, {Nome: "p_itens", Tipo: "jsonb"}},
		Conferir: itensSoDaConta},
}

// itensSoDaConta: a função faz upsert por (ad_id, codigo) — a chave da tabela não tem conta — e troca o
// account_id da linha existente. Item que já pertence a OUTRA conta (ou a nenhuma) moveria o problema
// de dono: 403 para todos, sem a função rodar. HOJE o robô vigia-problemas-meta (coletor/) chama
// POST ${SUPABASE_URL}/rest/v1/rpc/gt_registrar_problemas com SUPABASE_SERVICE_KEY, e PARA no corte; no
// Plano 7 (trilha C) ele passa a chamar a função por pg com
// set_config('request.jwt.claims','{"role":"service_role"}', true) e o papel de banco do robô com EXECUTE
// (COORDENACAO 12/10 23:10, a). Ou seja: nem hoje nem depois ele passa por esta rota.
//
// ponytail: janela de corrida com o robô, que grava por fora da API, entre esta conferência e a função (um
// item pode mudar de dono no intervalo); aceitável: o robô só grava a conta dele e a janela é de milissegundos.
// p_conta nulo ou vazio fica para a função (ela recusa com a própria frase); item malformado também:
// a validação do jsonb responde 400 como responderia na função.
func itensSoDaConta(ctx context.Context, tx pgx.Tx, _ *autz.Escopo, args map[string]json.RawMessage) error {
	var conta *string
	if json.Unmarshal(args["p_conta"], &conta) != nil || conta == nil || *conta == "" {
		return nil
	}
	var alheio bool
	if err := tx.QueryRow(ctx, `select exists (
		select 1 from gt_problemas_meta p
		join jsonb_to_recordset(coalesce(nullif(@itens::jsonb, 'null'::jsonb), '[]'::jsonb)) as i(ad_id text, codigo integer)
		  on p.ad_id = i.ad_id and p.codigo = i.codigo
		where p.account_id is distinct from @conta::text)`,
		pgx.NamedArgs{"itens": string(args["p_itens"]), "conta": *conta}).Scan(&alheio); err != nil {
		return err
	}
	if alheio {
		return autz.ErrNegado
	}
	return nil
}
