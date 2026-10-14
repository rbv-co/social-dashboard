package atendimentos

import (
	"slices"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// Ferramentas do Comercial Vessel (autz.FerramentasVessel) e os dois níveis de vessel_pode.
const (
	atend       = "atendimentos"
	beauty      = "atendimentos.beauty-sessions"
	privateEdit = "atendimentos.private-edit"
	circle      = "atendimentos.stylist-circle"
	grafico     = "atendimentos.material-grafico"
	pracas      = "atendimentos.pracas"
	edicoes     = "atendimentos.edicoes"

	ver    = "ver"
	editar = "editar"
)

// FuncoesRPC: as 62 RPCs de atendimentos da Vessel (Beauty Sessions, Private Edit, Stylist Circle, Praças e
// Edições) em POST /rpc/{nome} (web.FuncoesRPC as junta). Portão = o vessel_pode(...) da primeira linha de cada uma
// (TestPortoesIguaisAsFuncoes prova pessoa a pessoa); as que gravam recusam "entrar como" (SoSessaoPropria).
// Parâmetros, DEFAULTs e retorno = levantamento/02-funções.csv.
var FuncoesRPC = []rpc.Funcao{
	le("vessel_agenda_das_lojas", pode(privateEdit, ver), p("p_de", "date"), p("p_ate", "date"), o("p_loja", "text")),
	grava("vessel_beauty_session_apagar", pode(beauty, editar), p("p_codigo", "text")),
	grava("vessel_beauty_session_arquivar", pode(beauty, editar), p("p_codigo", "text"), o("p_arquivada", "boolean")),
	grava("vessel_beauty_session_cadastrar_lead", pode(beauty, editar), p("p_codigo", "text"), p("p_nome", "text"), p("p_whatsapp", "text"), o("p_instagram", "text"), o("p_interesse", "text"), o("p_email", "text")),
	grava("vessel_beauty_session_criar", pode(beauty, editar), p("p_codigo", "text"), p("p_quando", "date"), p("p_praca", "text"), p("p_loja", "text"), o("p_parceiro", "text")),
	grava("vessel_beauty_session_editar", pode(beauty, editar), p("p_codigo", "text"), o("p_quando", "date"), o("p_loja", "text")),
	grava("vessel_beauty_session_encerrar", pode(beauty, editar), p("p_codigo", "text"), o("p_ativa", "boolean")),
	grava("vessel_chave_da_convidada", pode(privateEdit, ver), p("p_id", "bigint")),
	le("vessel_conta_das_beauty_sessions", qualquer(pode(beauty, ver), pode(grafico, ver)), o("p_dias", "integer"), o("p_incluir_arquivadas", "boolean")),
	le("vessel_conta_das_private_edits", qualquer(pode(privateEdit, ver), pode(grafico, ver)), o("p_dias", "integer"), o("p_incluir_arquivadas", "boolean")),
	le("vessel_convidadas_do_encontro", contaAtiva, p("p_codigo", "text"), o("p_dias", "integer")),
	grava("vessel_convidar_para_encontro", pode(privateEdit, editar), p("p_codigo", "text"), p("p_nome", "text"), p("p_whatsapp", "text"), o("p_email", "text")),
	// o portão de editar é da migração 00009 (produção deixava quem só vê marcar o convite; o comentário da função pede a trava da situação)
	grava("vessel_convite_marcar", qualquer(pode(atend, editar), pode(privateEdit, editar)), p("p_id", "bigint"), p("p_marca", "text")),
	grava("vessel_criar_private_edit", pode(privateEdit, editar), p("p_stylist", "text"), p("p_quando", "timestamptz"), o("p_local", "text"), o("p_praca", "text"), o("p_loja", "text"), o("p_vagas", "integer"), o("p_teste", "boolean"), o("p_confirmar_sobreposicao", "boolean")),
	grava("vessel_edicao_abrir", pode(edicoes, editar), p("p_id", "bigint")),
	grava("vessel_edicao_criar", pode(edicoes, editar), p("p_praca_id", "bigint"), p("p_nome", "text"), p("p_comeca_em", "date"), p("p_termina_em", "date")),
	grava("vessel_edicao_encerrar", pode(edicoes, editar), p("p_id", "bigint"), p("p_levar_para", "bigint")),
	grava("vessel_edicao_incluir_stylist", qualquer(pode(edicoes, editar), pode(circle, editar)), p("p_codigo", "text"), p("p_edicao_id", "bigint")),
	grava("vessel_edicao_tirar_stylist", qualquer(pode(edicoes, editar), pode(circle, editar)), p("p_codigo", "text"), p("p_edicao_id", "bigint")),
	tabela("vessel_edicao_turma", qualquer(pode(edicoes, ver), pode(circle, ver)), p("p_edicao_id", "bigint")),
	le("vessel_edicoes_listar", qualquer(pode(pracas, ver), pode(edicoes, ver), pode(circle, ver), pode(privateEdit, ver)), p("p_praca_id", "bigint")),
	tabela("vessel_eventos_de_origem", qualquer(pode(privateEdit, ver), pode(circle, ver), pode(edicoes, ver))),
	le("vessel_leads_da_beauty_session", pode(beauty, ver), p("p_codigo", "text"), o("p_dias", "integer")),
	le("vessel_placar_da_edicao", pode(circle, ver), p("p_edicao_id", "bigint")),
	grava("vessel_praca_cidade_desvincular", pode(pracas, editar), p("p_id", "bigint")),
	grava("vessel_praca_cidade_vincular", pode(pracas, editar), p("p_praca_id", "bigint"), p("p_cidade", "text")),
	grava("vessel_praca_criar", pode(pracas, editar), p("p_sigla", "text"), p("p_nome", "text"), p("p_loja_destino", "text")),
	grava("vessel_praca_editar", pode(pracas, editar), p("p_id", "bigint"), p("p_nome", "text"), p("p_loja_destino", "text"), p("p_ativa", "boolean")),
	le("vessel_pracas_listar", qualquer(pode(pracas, ver), pode(edicoes, ver), pode(circle, ver), pode(privateEdit, ver))),
	grava("vessel_private_edit_apagar", pode(privateEdit, editar), p("p_codigo", "text")),
	grava("vessel_private_edit_arquivar", pode(privateEdit, editar), p("p_codigo", "text"), o("p_arquivada", "boolean")),
	grava("vessel_private_edit_editar", pode(privateEdit, editar), p("p_codigo", "text"), o("p_quando", "timestamptz"), o("p_local", "text"), o("p_praca", "text"), o("p_loja", "text"), o("p_vagas", "integer"), o("p_stylist", "text"), o("p_confirmar_sobreposicao", "boolean")),
	grava("vessel_private_edit_encerrar", pode(privateEdit, editar), p("p_codigo", "text"), o("p_ativa", "boolean")),
	grava("vessel_private_edit_situacao", pode(privateEdit, editar), p("p_codigo", "text"), p("p_status", "text"), o("p_realizado_em", "date"), o("p_motivo", "text"), o("p_observacoes", "text")),
	le("vessel_private_edit_sobreposicoes", pode(privateEdit, ver), p("p_quando", "timestamptz"), p("p_loja", "text"), o("p_ignorar_codigo", "text"), o("p_praca", "text"), o("p_local", "text")),
	le("vessel_qualificacoes_vigentes", pode(circle, ver)),
	le("vessel_rastreio_dos_stylists", qualquer(pode(circle, ver), pode(grafico, ver)), o("p_dias", "integer"), o("p_incluir_desativadas", "boolean"), o("p_praca_id", "bigint"), o("p_edicao_id", "bigint")),
	le("vessel_scorecard_da_stylist", pode(circle, ver), p("p_codigo", "text"), o("p_de", "date"), o("p_ate", "date"), o("p_dias", "integer")),
	grava("vessel_situacao_do_atendimento", qualquer(pode(atend, editar), pode(privateEdit, editar)), p("p_id", "bigint"), p("p_situacao", "text")),
	grava("vessel_stylist_avaliar", pode(circle, editar), p("p_codigo", "text"), p("p_carteira", "integer"), p("p_portfolio", "integer"), p("p_mobilizacao", "integer"), p("p_acesso", "integer"), p("p_confiabilidade", "integer"), o("p_observacao", "text")),
	le("vessel_stylist_contatos", contaAtiva, p("p_codigo", "text")),
	grava("vessel_stylist_criar", pode(circle, editar), p("p_nome", "text"), p("p_whatsapp", "text"), o("p_cidade", "text"), o("p_instagram", "text"), o("p_atuacao", "text"), o("p_praca", "text"), o("p_loja", "text"), o("p_origem_contato", "text"), o("p_responsavel", "text"), o("p_prospectado_em", "date"), o("p_proxima_acao", "text"), o("p_proxima_acao_em", "date"), o("p_observacoes", "text"), o("p_sem_contato", "boolean")),
	grava("vessel_stylist_desativar", pode(circle, editar), p("p_codigo", "text"), o("p_ativa", "boolean")),
	grava("vessel_stylist_editar", pode(circle, editar), p("p_codigo", "text"), o("p_nome", "text"), o("p_whatsapp", "text"), o("p_cidade", "text"), o("p_instagram", "text"), o("p_atuacao", "text"), o("p_estagio", "text"), o("p_praca", "text"), o("p_loja", "text"), o("p_origem_contato", "text"), o("p_responsavel", "text"), o("p_prospectado_em", "date"), o("p_proxima_acao", "text"), o("p_proxima_acao_em", "date"), o("p_sem_proxima_acao", "boolean"), o("p_observacoes", "text"), o("p_sem_contato", "boolean")),
	le("vessel_stylist_etapas", qualquer(pode(circle, ver), pode(privateEdit, ver))),
	le("vessel_stylist_historico_de_etapas", pode(circle, ver), p("p_codigo", "text")),
	grava("vessel_stylist_mover_de_etapa", pode(circle, editar), p("p_codigo", "text"), p("p_etapa_id", "bigint"), o("p_motivo_id", "bigint"), o("p_nota", "text")),
	le("vessel_stylist_qualificacoes", contaAtiva, p("p_codigo", "text")),
	grava("vessel_stylist_registrar_contato", pode(circle, editar), p("p_codigo", "text"), p("p_canal", "text"), p("p_resultado", "text"), o("p_nota", "text"), o("p_proxima_acao", "text"), o("p_proxima_acao_em", "date")),
	grava("vessel_stylist_etapa_criar", pode(circle, editar), p("p_nome", "text"), o("p_posicao", "integer"), o("p_tipo", "text")),
	grava("vessel_stylist_etapa_excluir", pode(circle, editar), p("p_id", "bigint"), o("p_destino", "bigint"), o("p_motivo_id", "bigint"), o("p_nota", "text")),
	grava("vessel_stylist_etapa_liberar_private_edit", pode(circle, editar), p("p_id", "bigint"), p("p_libera", "boolean")),
	grava("vessel_stylist_etapa_marcar_prospectada", pode(circle, editar), p("p_id", "bigint")),
	grava("vessel_stylist_etapa_mover", pode(circle, editar), p("p_id", "bigint"), p("p_direcao", "text")),
	grava("vessel_stylist_etapa_renomear", pode(circle, editar), p("p_id", "bigint"), p("p_nome", "text")),
	grava("vessel_stylist_etapa_tipo", pode(circle, editar), p("p_id", "bigint"), p("p_tipo", "text")),
	grava("vessel_stylist_motivo_ativar", pode(circle, editar), p("p_id", "bigint"), p("p_ativo", "boolean")),
	grava("vessel_stylist_motivo_criar", pode(circle, editar), p("p_etapa_id", "bigint"), p("p_nome", "text"), o("p_exige_nota", "boolean")),
	grava("vessel_stylist_motivo_exigir_nota", pode(circle, editar), p("p_id", "bigint"), p("p_exige", "boolean")),
	grava("vessel_stylist_motivo_mover", pode(circle, editar), p("p_id", "bigint"), p("p_direcao", "text")),
	grava("vessel_stylist_motivo_renomear", pode(circle, editar), p("p_id", "bigint"), p("p_nome", "text")),
	le("vessel_stylists_para_escolher", pode(privateEdit, ver)),
}

// contaAtiva: o portão das três funções que, sem a permissão, devolvem lista vazia em vez de erro (convidadas do
// encontro, contatos e qualificações da stylist: "um bloco dentro de uma ficha já aberta"). Responder 403 mudaria o
// contrato; a função continua sendo a barreira (vessel_pode na primeira linha) e o Go só barra a conta desativada,
// o que vessel_pode já faz por dentro (conta_ativa()).
var contaAtiva = autz.Regra(func(e *autz.Escopo) bool { return e.Ativo })

// pode: vessel_pode(f, n) como portão; a lista é fechada e conferida na subida (nome errado = a API não sobe).
func pode(f, n string) autz.Regra {
	r, err := autz.VesselPode(f, n)
	if err != nil {
		panic(err)
	}
	return r
}

// qualquer: o "ou" de vessel_pode entre ferramentas (a função de produção aceita quem tiver QUALQUER uma).
func qualquer(rs ...autz.Regra) autz.Regra {
	return func(e *autz.Escopo) bool {
		return slices.ContainsFunc(rs, func(r autz.Regra) bool { return r(e) })
	}
}

func p(nome, tipo string) rpc.Param { return rpc.Param{Nome: nome, Tipo: tipo} }

// o: parâmetro com DEFAULT na função.
func o(nome, tipo string) rpc.Param { return rpc.Param{Nome: nome, Tipo: tipo, Opcional: true} }

// le: função que só lê e devolve json (aberta a quem entrou como: ver o que a pessoa vê).
func le(nome string, portao autz.Regra, params ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: params, Retorno: rpc.Valor, Portao: portao}
}

// tabela: função `returns table`, devolvida como lista JSON.
func tabela(nome string, portao autz.Regra, params ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: params, Retorno: rpc.Conjunto, Portao: portao}
}

// grava: função que muda o mundo; "entrar como" é recusado.
func grava(nome string, portao autz.Regra, params ...rpc.Param) rpc.Funcao {
	return rpc.Funcao{Nome: nome, Params: params, Retorno: rpc.Valor, Portao: portao, SoSessaoPropria: true}
}
