package web

import (
	"slices"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
)

// As 92 funções que o painel chama por `.rpc` e que podem virar POST /rpc/{nome}: a cópia
// INDEPENDENTE do teste, tirada do plano (I.2/I.4/IV.2, por sub-plano: 5.2 = 5, 5.3 = 2, 5.7 = 1,
// 5.9 = 6, 5.10 = 16, 5.11 = 62) e conferida em 2026-10-12 contra o front: todo nome abaixo (e os 2 do
// Ruling 23) aparece como chamada literal em src/ (`.rpc('x'`, `chamar('x'`, `gravar('x'` ou
// `rest/v1/rpc/x`, fora de testes e de src/demonstracao/), e nenhuma outra função é chamada.
// Mudar esta lista exige Ruling.
var rpcDoPainel92 = []string{
	"conteudo_aprovar_e_agendar",
	"conteudo_casar_na_mao",
	"conteudo_decidir",
	"conteudo_decidir_casamento",
	"conteudo_ideia_virar_peca",
	"conteudo_reavisar",
	"criar_pessoa_rapida",
	"criar_setor_rapido",
	"etiqueta_quem_e",
	"frota_corrente_do_veiculo",
	"gt_registrar_problemas",
	"pessoas_para_escolher",
	"setores_para_escolher",
	"sincronizar_carro_e_bem",
	"vessel_agenda_das_lojas",
	"vessel_alertas",
	"vessel_baixar_garantia",
	"vessel_baixar_peca",
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
	"vessel_decidir_pedido_de_registro",
	"vessel_definir_material_do_lote",
	"vessel_desfazer_baixa",
	"vessel_desmarcar_gravada",
	"vessel_edicao_abrir",
	"vessel_edicao_criar",
	"vessel_edicao_encerrar",
	"vessel_edicao_incluir_stylist",
	"vessel_edicao_tirar_stylist",
	"vessel_edicao_turma",
	"vessel_edicoes_listar",
	"vessel_editar_lote",
	"vessel_eventos_de_origem",
	"vessel_excluir_lote",
	"vessel_excluir_peca",
	"vessel_fila_de_registros",
	"vessel_gerar_lote",
	"vessel_leads_da_beauty_session",
	"vessel_marcar_gravada",
	"vessel_pedir_cartoes",
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
	"vessel_sobrescrever_etiqueta",
	"vessel_stylist_avaliar",
	"vessel_stylist_contatos",
	"vessel_stylist_criar",
	"vessel_stylist_desativar",
	"vessel_stylist_editar",
	"vessel_stylist_etapa_criar",
	"vessel_stylist_etapa_excluir",
	"vessel_stylist_etapa_liberar_private_edit",
	"vessel_stylist_etapa_marcar_prospectada",
	"vessel_stylist_etapa_mover",
	"vessel_stylist_etapa_renomear",
	"vessel_stylist_etapa_tipo",
	"vessel_stylist_etapas",
	"vessel_stylist_historico_de_etapas",
	"vessel_stylist_motivo_ativar",
	"vessel_stylist_motivo_criar",
	"vessel_stylist_motivo_exigir_nota",
	"vessel_stylist_motivo_mover",
	"vessel_stylist_motivo_renomear",
	"vessel_stylist_mover_de_etapa",
	"vessel_stylist_qualificacoes",
	"vessel_stylist_registrar_contato",
	"vessel_stylists_para_escolher",
	"vessel_trocar_dono",
}

func nomesDe(fs []rpc.Funcao) []string {
	var n []string
	for _, f := range fs {
		n = append(n, f.Nome)
	}
	return n
}

// FuncoesRPC ∩ (RPCPendentes ∪ RPCForaDoPainel) = ∅ e FuncoesRPC ∪ RPCPendentes = exatamente as 92.
// Cada sub-plano move os seus nomes de pendentes para registrados; o Plano 8 entra com pendentes vazio.
func TestListasDeRPCFecham(t *testing.T) {
	reg, pend, fora := nomesDe(FuncoesRPC), slices.Clone(RPCPendentes), slices.Clone(RPCForaDoPainel)
	for _, n := range reg {
		if slices.Contains(pend, n) || slices.Contains(fora, n) {
			t.Errorf("%s registrada e também pendente/fora do painel", n)
		}
	}
	for _, n := range pend {
		if slices.Contains(fora, n) {
			t.Errorf("%s pendente e fora do painel", n)
		}
	}
	uniao := slices.Concat(reg, pend)
	slices.Sort(uniao)
	if !slices.Equal(uniao, rpcDoPainel92) {
		t.Errorf("FuncoesRPC ∪ RPCPendentes ≠ as 92 da triagem (len %d; sobram/faltam: %v)", len(uniao), diferenca(uniao, rpcDoPainel92))
	}
	slices.Sort(fora)
	if n := len(slices.Compact(slices.Clone(fora))); len(fora) != 15 || n != 15 {
		t.Errorf("RPCForaDoPainel tem %d nomes (%d distintos), esperava 15", len(fora), n)
	}
	if TotalRPCDoPainel != 92 || len(rpcDoPainel92) != 92 || len(slices.Compact(slices.Clone(rpcDoPainel92))) != 92 {
		t.Error("o total das 92 mudou")
	}
}

func diferenca(a, b []string) []string {
	var d []string
	for _, x := range a {
		if !slices.Contains(b, x) {
			d = append(d, "+"+x)
		}
	}
	for _, x := range b {
		if !slices.Contains(a, x) {
			d = append(d, "-"+x)
		}
	}
	return d
}

// RPCForaDoPainel e a recusa do rpc.Novo concordam: os 15 são recusados, e NENHUM dos 92 é.
func TestForaDoPainelEARecusaDoNovoConcordam(t *testing.T) {
	for _, n := range RPCForaDoPainel {
		if _, err := rpc.Novo(nil, rpc.Funcao{Nome: n, Portao: autz.SuperFicha}); err == nil {
			t.Errorf("rpc.Novo aceitou %s, que é RPCForaDoPainel", n)
		}
	}
	for _, n := range rpcDoPainel92 {
		if _, err := rpc.Novo(nil, rpc.Funcao{Nome: n, Portao: autz.SuperFicha}); err != nil {
			t.Errorf("rpc.Novo recusou %s, que é do painel: %v", n, err)
		}
	}
}

func TestMontarRPCRecusaListaErrada(t *testing.T) {
	g := autz.SuperFicha
	pend := slices.Clone(rpcDoPainel92)
	semNome := func(n string) []string {
		return slices.DeleteFunc(slices.Clone(pend), func(x string) bool { return x == n })
	}
	ok := rpc.Funcao{Nome: "vessel_gerar_lote", Portao: g}
	casos := []struct {
		nome        string
		registradas []rpc.Funcao
		pendentes   []string
		fora        []string
		quer        string // "" = monta
	}{
		{"nascimento: tudo pendente", nil, pend, RPCForaDoPainel, ""},
		{"uma movida de pendente para registrada", []rpc.Funcao{ok}, semNome("vessel_gerar_lote"), RPCForaDoPainel, ""},
		{"registrada e ainda pendente (copiou em vez de mover)", []rpc.Funcao{ok}, pend, RPCForaDoPainel, "ainda em RPCPendentes"},
		{"sem portão", []rpc.Funcao{{Nome: "vessel_gerar_lote"}}, semNome("vessel_gerar_lote"), RPCForaDoPainel, "sem portão"},
		{"nome proibido (Ruling 23)", []rpc.Funcao{{Nome: "marcar_senha_trocada", Portao: g}}, pend, RPCForaDoPainel, "proibido"},
		{"nome proibido (fila do abandono)", []rpc.Funcao{{Nome: "pegar_da_fila", Portao: g}}, pend, RPCForaDoPainel, "proibido"},
		{"nome proibido (checkout_)", []rpc.Funcao{{Nome: "checkout_qualquer", Portao: g}}, pend, RPCForaDoPainel, "proibido"},
		{"fora do painel que o Novo não conhece", []rpc.Funcao{{Nome: "nome_novo_fora", Portao: g}}, semNome("vessel_gerar_lote"), []string{"nome_novo_fora"}, "RPCForaDoPainel"},
		{"nome fora da triagem (digitado errado) com o certo ainda pendente", []rpc.Funcao{{Nome: "vessel_gerar_lot", Portao: g}}, pend, RPCForaDoPainel, "somam 93"},
		{"pendente perdida (sem registrar)", nil, semNome("vessel_gerar_lote"), RPCForaDoPainel, "somam 91"},
		{"pendente repetida", nil, append(slices.Clone(pend), pend[0]), RPCForaDoPainel, "repete"},
		{"pendente que é fora do painel", nil, append(semNome("vessel_gerar_lote"), "meus_vinculos"), RPCForaDoPainel, "RPCForaDoPainel"},
		{"duas registradas iguais", []rpc.Funcao{ok, ok}, semNome("vessel_gerar_lote"), RPCForaDoPainel, "duas vezes"},
	}
	for _, c := range casos {
		_, err := montarRPC(nil, c.registradas, c.pendentes, c.fora)
		if (err == nil) != (c.quer == "") || (err != nil && !strings.Contains(err.Error(), c.quer)) {
			t.Errorf("%s: err = %v, esperava %q", c.nome, err, c.quer)
		}
	}
}

// A montagem de verdade panica: lista errada nunca sobe (aqui pela FuncoesRPC do pacote).
func TestRotasPanicaComRPCRegistradaErrada(t *testing.T) {
	p := testebanco.Novo(t)
	original := FuncoesRPC
	t.Cleanup(func() { FuncoesRPC = original })
	for nome, fs := range map[string][]rpc.Funcao{
		"sem portão":            {{Nome: "vessel_gerar_lote"}},
		"nome proibido":         {{Nome: "minha_conta_esta_desativada", Portao: autz.SuperFicha}},
		"fora da triagem":       {{Nome: "funcao_que_ninguem_chama", Portao: autz.SuperFicha}},
		"pendente e registrada": {{Nome: "vessel_gerar_lote", Portao: autz.SuperFicha}},
	} {
		FuncoesRPC = append(slices.Clone(original), fs...) // as dos sub-planos ficam: a soma de TotalRPCDoPainel só estoura pela errada
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: Rotas não panicou", nome)
				}
			}()
			Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
		}()
	}
	// e uma registrada certa (movida de pendente) monta
	FuncoesRPC = append(slices.Clone(original), rpc.Funcao{Nome: "vessel_gerar_lote", Portao: autz.SuperFicha})
	saved := RPCPendentes
	t.Cleanup(func() { RPCPendentes = saved })
	RPCPendentes = slices.DeleteFunc(slices.Clone(saved), func(x string) bool { return x == "vessel_gerar_lote" })
	Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), config.Config{})
}
