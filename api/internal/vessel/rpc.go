package vessel

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FuncoesRPC: as 16 funções do painel de Autenticidade em POST /rpc/{nome} (web.FuncoesRPC as junta). Portão =
// autz.VesselAdmin, a checagem da primeira linha de cada uma (is_vessel_admin(); TestPortoesIguaisAsFuncoes prova
// pessoa a pessoa). As 14 que gravam recusam "entrar como" (SoSessaoPropria); vessel_alertas e
// vessel_fila_de_registros só leem (a fila já mascara o CPF). Sem Conferir de alvo: o selo é um só para a casa e
// cada função confere a existência e o estado do que recebe na própria transação (Ruling 5.10-9) — a exceção é a
// decisão de registro (soNaMao). Parâmetros e DEFAULTs = levantamento/02-funções.csv; todas devolvem json (rpc.Valor).
var FuncoesRPC = []rpc.Funcao{
	{Nome: "vessel_alertas", Retorno: rpc.Valor, Portao: autz.VesselAdmin},
	{Nome: "vessel_fila_de_registros", Retorno: rpc.Valor, Portao: autz.VesselAdmin,
		Params: []rpc.Param{{Nome: "p_codigo", Tipo: "text", Opcional: true}}},
	grava("vessel_baixar_garantia", texto("p_codigo"), texto("p_motivo")),
	grava("vessel_baixar_peca", texto("p_codigo"), texto("p_motivo")),
	{Nome: "vessel_decidir_pedido_de_registro", Retorno: rpc.Valor, Portao: autz.VesselAdmin, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_pedido", Tipo: "uuid"}, texto("p_estado"), texto("p_quem_decidiu"),
			{Nome: "p_conferencia", Tipo: "jsonb", Opcional: true}, {Nome: "p_motivo", Tipo: "text", Opcional: true}},
		Conferir: soNaMao},
	grava("vessel_definir_material_do_lote", rpc.Param{Nome: "p_lote", Tipo: "uuid"}, texto("p_material")),
	grava("vessel_desfazer_baixa", texto("p_codigo")),
	grava("vessel_desmarcar_gravada", texto("p_codigo"), texto("p_motivo")),
	grava("vessel_editar_lote", rpc.Param{Nome: "p_lote", Tipo: "uuid"}, texto("p_modelo"), texto("p_cor"), texto("p_sku"),
		rpc.Param{Nome: "p_fabricado_em", Tipo: "date"}, rpc.Param{Nome: "p_quantidade", Tipo: "integer"},
		rpc.Param{Nome: "p_os", Tipo: "text", Opcional: true}),
	grava("vessel_excluir_lote", rpc.Param{Nome: "p_lote", Tipo: "uuid"}),
	grava("vessel_excluir_peca", texto("p_codigo")),
	grava("vessel_gerar_lote", texto("p_modelo"), texto("p_cor"), texto("p_sku"), rpc.Param{Nome: "p_quantidade", Tipo: "integer"},
		rpc.Param{Nome: "p_fabricado_em", Tipo: "date"}, rpc.Param{Nome: "p_fotos", Tipo: "text[]"},
		rpc.Param{Nome: "p_os", Tipo: "text", Opcional: true}),
	grava("vessel_marcar_gravada", texto("p_codigo")),
	grava("vessel_pedir_cartoes", rpc.Param{Nome: "p_pecas", Tipo: "text[]"}),
	grava("vessel_sobrescrever_etiqueta", texto("p_codigo_antigo"), texto("p_codigo_novo"), texto("p_destino"), texto("p_motivo")),
	grava("vessel_trocar_dono", texto("p_codigo"), texto("p_nome"), texto("p_cpf"), texto("p_whatsapp"), texto("p_motivo"),
		texto("p_confirmacao")),
}

func texto(nome string) rpc.Param { return rpc.Param{Nome: nome, Tipo: "text"} }

// grava: função do selo que muda o mundo — portão do selo e "entrar como" recusado.
func grava(nome string, params ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: params, Retorno: rpc.Valor, Portao: autz.VesselAdmin, SoSessaoPropria: true}
}

// soNaMao: o painel decide pedido de registro só "na mão" e sem conferência anexada (a tela manda 'na_mao' e
// p_conferencia null: tela-de-autenticidade.vue:3718-3729). 'bling' é a aprovação automática da edge
// vessel-registrar-garantia (Plano 6), e a conferência é a prova do Bling que só ela tem; vinda do painel, seria a
// tela dando a si mesma o selo de conferido, e o bling_pedido/bling_contato_id inventados iriam para o registro da
// dona (a trava "pedido_ja_usado" e o espelho do Bling os usam). 403 sem a função rodar (Ruling 5.10-10).
func soNaMao(_ context.Context, _ pgx.Tx, _ *autz.Escopo, args map[string]json.RawMessage) error {
	var quem string
	if json.Unmarshal(args["p_quem_decidiu"], &quem) != nil || quem != "na_mao" {
		return autz.ErrNegado
	}
	if c, tem := args["p_conferencia"]; tem && strings.TrimSpace(string(c)) != "null" {
		return autz.ErrNegado
	}
	return nil
}
