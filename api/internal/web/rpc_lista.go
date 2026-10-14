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

// RPCPendentes: os nomes de RPC que o painel chama e que AINDA não estão em FuncoesRPC. Vazia desde o 5.11
// (as 62 de atendimentos da Vessel entraram por atendimentos.FuncoesRPC): critério de entrada do Plano 8 cumprido.
// Registrar uma função nova exige TIRÁ-LA daqui no mesmo commit (a montagem recusa o nome nos dois lugares).
var RPCPendentes = []string{}

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
