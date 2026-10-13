package patrimonio

import (
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FrotaOuPatrimonio: a checagem de sincronizar_carro_e_bem (is_frota_admin() or is_patrimonio_admin()).
var FrotaOuPatrimonio = autz.Regra(func(e *autz.Escopo) bool { return autz.FrotaAdmin(e) || autz.PatrimonioAdmin(e) })

// FuncoesRPC: as RPCs do 5.2 na lista branca de POST /rpc/{nome} (web.FuncoesRPC as junta). As que
// gravam recusam a sessão de "entrar como" (Ruling 5.2-3); as listas de escolha não. O portão de cada
// uma é o que a função faz por dentro (vem antes: a frase 42501 da função não chega à tela). Erros 22023
// ("Digite o nome antes de criar.") e 23514 (travas de sincronizar_carro_e_bem) saem 400 regra_de_negocio
// com a frase da função. `bem_de_veiculo_segue_a_frota` e os `patrimonio_espelha_*` são gatilhos (ficam
// no banco), não RPC.
var FuncoesRPC = []rpc.Funcao{
	{Nome: "pessoas_para_escolher", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida},
	{Nome: "setores_para_escolher", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida},
	{Nome: "criar_pessoa_rapida", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_nome", Tipo: "text"}, {Nome: "p_cargo", Tipo: "text", Opcional: true},
			{Nome: "p_marca_id", Tipo: "uuid", Opcional: true}, {Nome: "p_setor_id", Tipo: "uuid", Opcional: true}}},
	{Nome: "criar_setor_rapido", Retorno: rpc.Conjunto, Portao: autz.PodeCadastrarPessoaRapida, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_nome", Tipo: "text"}}},
	{Nome: "sincronizar_carro_e_bem", Retorno: rpc.Valor, Portao: FrotaOuPatrimonio, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_carro_id", Tipo: "uuid", Opcional: true}, {Nome: "p_bem_id", Tipo: "uuid", Opcional: true},
			{Nome: "p_placa", Tipo: "text", Opcional: true}, {Nome: "p_etiqueta", Tipo: "integer", Opcional: true},
			{Nome: "p_nome", Tipo: "text", Opcional: true}, {Nome: "p_marca", Tipo: "text", Opcional: true},
			{Nome: "p_valor_centavos", Tipo: "bigint", Opcional: true}}},
}
