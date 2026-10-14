package frota

import (
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FuncoesRPC: as funções que a tela da Frota chama por .rpc (tela-de-frota.vue:3025, 3123). Nome, parâmetros
// e retorno de levantamento/02-funções.csv; portão = a checagem da própria função (Ruling 26 do mestre).
// As duas só leem: a sessão de "entrar como" passa (leitura segue).
var FuncoesRPC = []rpc.Funcao{
	// etiqueta_quem_e(p_numero integer) returns jsonb, SECURITY DEFINER: por dentro devolve {existe:false} a
	// quem não é is_patrimonio_admin() — o portão é essa checagem (Ruling 5.3-10).
	{Nome: "etiqueta_quem_e", Params: []rpc.Param{{Nome: "p_numero", Tipo: "integer"}}, Retorno: rpc.Valor, Portao: autz.PatrimonioAdmin},
	// frota_corrente_do_veiculo(p_veiculo uuid) returns table, SECURITY INVOKER: lia frota_checklist e
	// frota_checklist_respostas pela RLS de quem chamava (is_frota_admin), que deixa de existir.
	{Nome: "frota_corrente_do_veiculo", Params: []rpc.Param{{Nome: "p_veiculo", Tipo: "uuid"}}, Retorno: rpc.Conjunto, Portao: autz.FrotaAdmin},
}
