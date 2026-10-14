package web

import (
	"fmt"
	"slices"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// TotalRPCDoPainel: as funções SQL que o painel chama por `.rpc` e que podem virar POST /rpc/{nome}
// (plano 5, I.2: 94 nomes chamados pelo front menos os 2 do Ruling 23). FuncoesRPC e RPCPendentes
// dividem sempre este total.
const TotalRPCDoPainel = 92

// RPCPendentes: os nomes de RPC que o painel chama e que AINDA não estão em FuncoesRPC, por
// sub-plano. Registrar uma função em FuncoesRPC exige TIRÁ-LA daqui no mesmo commit (a montagem
// recusa o nome nos dois lugares: mover, não copiar). Critério de entrada do Plano 8: lista vazia.
var RPCPendentes = []string{
	// 5.3 (frota): 2
	"etiqueta_quem_e",
	"frota_corrente_do_veiculo",
	// 5.10 (autenticidade): 16
	"vessel_alertas",
	"vessel_baixar_garantia",
	"vessel_baixar_peca",
	"vessel_decidir_pedido_de_registro",
	"vessel_definir_material_do_lote",
	"vessel_desfazer_baixa",
	"vessel_desmarcar_gravada",
	"vessel_editar_lote",
	"vessel_excluir_lote",
	"vessel_excluir_peca",
	"vessel_fila_de_registros",
	"vessel_gerar_lote",
	"vessel_marcar_gravada",
	"vessel_pedir_cartoes",
	"vessel_sobrescrever_etiqueta",
	"vessel_trocar_dono",
	// 5.11 (comercial Vessel e leads): 62
	"vessel_agenda_das_lojas",
	"vessel_beauty_session_apagar",
	"vessel_beauty_session_arquivar",
	"vessel_beauty_session_cadastrar_lead",
	"vessel_beauty_session_criar",
	"vessel_beauty_session_editar",
	"vessel_beauty_session_encerrar",
	"vessel_chave_da_convidada",
	"vessel_conta_das_beauty_sessions",
	"vessel_conta_das_private_edits",
	"vessel_convidadas_do_encontro",
	"vessel_convidar_para_encontro",
	"vessel_convite_marcar",
	"vessel_criar_private_edit",
	"vessel_edicao_abrir",
	"vessel_edicao_criar",
	"vessel_edicao_encerrar",
	"vessel_edicao_incluir_stylist",
	"vessel_edicao_tirar_stylist",
	"vessel_edicao_turma",
	"vessel_edicoes_listar",
	"vessel_eventos_de_origem",
	"vessel_leads_da_beauty_session",
	"vessel_placar_da_edicao",
	"vessel_praca_cidade_desvincular",
	"vessel_praca_cidade_vincular",
	"vessel_praca_criar",
	"vessel_praca_editar",
	"vessel_pracas_listar",
	"vessel_private_edit_apagar",
	"vessel_private_edit_arquivar",
	"vessel_private_edit_editar",
	"vessel_private_edit_encerrar",
	"vessel_private_edit_situacao",
	"vessel_private_edit_sobreposicoes",
	"vessel_qualificacoes_vigentes",
	"vessel_rastreio_dos_stylists",
	"vessel_scorecard_da_stylist",
	"vessel_situacao_do_atendimento",
	"vessel_stylist_avaliar",
	"vessel_stylist_contatos",
	"vessel_stylist_criar",
	"vessel_stylist_desativar",
	"vessel_stylist_editar",
	"vessel_stylist_etapas",
	"vessel_stylist_historico_de_etapas",
	"vessel_stylist_mover_de_etapa",
	"vessel_stylist_qualificacoes",
	"vessel_stylist_registrar_contato",
	"vessel_stylist_etapa_criar",
	"vessel_stylist_etapa_excluir",
	"vessel_stylist_etapa_liberar_private_edit",
	"vessel_stylist_etapa_marcar_prospectada",
	"vessel_stylist_etapa_mover",
	"vessel_stylist_etapa_renomear",
	"vessel_stylist_etapa_tipo",
	"vessel_stylist_motivo_ativar",
	"vessel_stylist_motivo_criar",
	"vessel_stylist_motivo_exigir_nota",
	"vessel_stylist_motivo_mover",
	"vessel_stylist_motivo_renomear",
	"vessel_stylists_para_escolher",
}

// RPCForaDoPainel: as 15 funções do levantamento que NUNCA entram em FuncoesRPC (rpc.Novo também as
// recusa; um teste confere que as duas listas concordam):
//   - Ruling 23: o login diz conta_desativada e trocar-senha tira a cobrança de troca;
//   - 3 de página pública (chave anon), do Plano 6;
//   - 5 internas, com EXECUTE revogado de `authenticated` (só outras funções as chamam);
//   - 5 sem chamada de rede (ajudantes de policy, que viraram Go, ou só citadas em comentário).
var RPCForaDoPainel = []string{
	"marcar_senha_trocada", "minha_conta_esta_desativada",
	"vessel_convite_da_convidada", "vessel_rsvp_da_convidada", "vessel_pedir_atendimento",
	"vessel_cpf_valido", "vessel_faixa_da_nota", "vessel_situacao_do_convite", "vessel_numeros_do_stylist_circle", "vessel_telefone_canonico",
	"is_vessel_atendimentos_editar", "meus_vinculos", "vessel_chave_do_produto", "vessel_email_canonico", "vessel_placar_do_stylist_circle",
}

// montarRPC valida as três listas e monta o registro; qualquer erro derruba a montagem (a API não
// sobe, nunca sobe com uma função a mais aberta ou uma a menos sem ninguém ver):
//   - cada registro tem portão e nome permitido (rpc.Novo: lista de nomes proibidos);
//   - nenhuma registrada está em RPCForaDoPainel;
//   - nenhuma registrada continua em RPCPendentes (mover, não copiar);
//   - registradas + pendentes são exatamente TotalRPCDoPainel nomes (nome digitado errado ou fora da
//     triagem do plano estoura a conta).
func montarRPC(p *pgxpool.Pool, registradas []rpc.Funcao, pendentes, fora []string) (*rpc.Registro, error) {
	reg, err := rpc.Novo(p, registradas...)
	if err != nil {
		return nil, err
	}
	todos := map[string]bool{}
	for _, n := range pendentes {
		if todos[n] {
			return nil, fmt.Errorf("RPCPendentes repete %q", n)
		}
		todos[n] = true
		if slices.Contains(fora, n) {
			return nil, fmt.Errorf("RPCPendentes tem %q, que é RPCForaDoPainel", n)
		}
	}
	for _, f := range registradas {
		switch {
		case slices.Contains(fora, f.Nome):
			return nil, fmt.Errorf("rpc %q está em RPCForaDoPainel: não vira RPC do painel", f.Nome)
		case todos[f.Nome]:
			return nil, fmt.Errorf("rpc %q registrada e ainda em RPCPendentes: tire-a de RPCPendentes", f.Nome)
		}
		todos[f.Nome] = true
	}
	if len(todos) != TotalRPCDoPainel {
		return nil, fmt.Errorf("FuncoesRPC + RPCPendentes somam %d nomes, esperava %d (nome fora da triagem do plano ou perdido)", len(todos), TotalRPCDoPainel)
	}
	return reg, nil
}
