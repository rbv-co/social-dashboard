package trafego

import (
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
		Params: []rpc.Param{{Nome: "p_conta", Tipo: "text"}, {Nome: "p_itens", Tipo: "jsonb"}}},
}
