package publico

import "github.com/rbv-co/social-dashboard/api/internal/rpc"

// GERADO do levantamento de produção (02-funções.csv): parâmetros, tipos e DEFAULTs das funções que o navegador do
// site e o Core chamam. Toda declaração devolve json (a rota só repassa). Não edite à mão: se a função mudar,
// gere de novo e rode TestDeclaracoesIguaisAsFuncoes.

// interno: o que o Core encaminha (POST /interno/vessel/{acao}, com o segredo; `p_teste` vale).
var interno = []rpc.Funcao{
	d("vessel_entrar_na_lista", p("p_nome", "text"), p("p_email", "text"), p("p_whatsapp", "text"), p("p_aceite_versao", "text"), o("p_armadilha", "text"), o("p_origem", "text"), o("p_rastreio", "jsonb")),
	d("vessel_marcar_objetivo_e_motivo", p("p_senha", "text"), p("p_objetivo", "text"), o("p_motivo", "text"), o("p_loja", "text")),
	d("vessel_detalhar_visita", p("p_senha", "text"), p("p_data", "date"), p("p_hora", "text"), o("p_bolsa", "text"), o("p_ocasiao", "text"), o("p_atelier", "boolean"), o("p_acompanhantes", "integer"), o("p_pedido", "text"), o("p_loja", "text")),
	d("vessel_interesse_da_beauty_session", p("p_nome", "text"), p("p_whatsapp", "text"), p("p_evento", "text"), o("p_interesse", "text"), o("p_aceite_marketing", "boolean"), o("p_aceite_versao", "text"), o("p_origem", "jsonb"), o("p_armadilha", "text"), o("p_teste", "boolean"), o("p_instagram", "text"), o("p_email", "text")),
	d("vessel_solicitar_atendimento", p("p_nome", "text"), p("p_whatsapp", "text"), p("p_loja", "text"), o("p_momento", "text"), o("p_periodo", "text"), o("p_recado", "text"), o("p_aceite_marketing", "boolean"), o("p_aceite_versao", "text"), o("p_origem", "jsonb"), o("p_armadilha", "text"), o("p_teste", "boolean")),
	d("vessel_pedido_de_personal_atelier", p("p_nome", "text"), p("p_whatsapp", "text"), p("p_loja", "text"), o("p_modelo", "text"), o("p_tecido", "text"), o("p_ferragem", "text"), o("p_periodo", "text"), o("p_observacao", "text"), o("p_aceite_marketing", "boolean"), o("p_aceite_versao", "text"), o("p_origem", "jsonb"), o("p_armadilha", "text"), o("p_teste", "boolean")),
	d("vessel_rsvp_da_private_edit", p("p_chave", "text"), p("p_nome", "text"), p("p_whatsapp", "text"), p("p_resposta", "text"), o("p_aceite_marketing", "boolean"), o("p_aceite_versao", "text"), o("p_armadilha", "text"), o("p_teste", "boolean")),
	d("vessel_rsvp_da_convidada", p("p_chave", "text"), p("p_convidada", "text"), p("p_resposta", "text"), o("p_aceite_marketing", "boolean"), o("p_aceite_versao", "text"), o("p_armadilha", "text")),
	d("vessel_pedido_do_stylist", p("p_nome", "text"), p("p_whatsapp", "text"), o("p_cidade", "text"), o("p_instagram", "text"), o("p_atuacao", "text"), o("p_quer_sessao", "text"), o("p_convidadas", "text"), o("p_praca", "text"), o("p_aceite_marketing", "boolean"), o("p_aceite_versao", "text"), o("p_origem", "jsonb"), o("p_armadilha", "text"), o("p_teste", "boolean")),
	d("vessel_candidatar_vaga", p("p_vaga", "text"), p("p_nome", "text"), p("p_whatsapp", "text"), p("p_cidade", "text"), p("p_experiencia", "text"), p("p_fim_de_semana", "boolean"), o("p_curriculo", "text"), o("p_origem", "jsonb"), o("p_armadilha", "text"), o("p_teste", "boolean")),
	d("vessel_registrar_cartao", p("p_nome", "text"), p("p_whatsapp", "text"), p("p_loja", "text"), p("p_quando", "timestamptz"), p("p_client_advisor", "text"), o("p_armadilha", "text"), o("p_teste", "boolean")),
	d("vessel_identificar_client_advisor", p("p_nome", "text"), o("p_loja", "text"), o("p_teste", "boolean")),
	d("vessel_ligar_vendedor", p("p_codigo", "text"), o("p_vendedor_id", "bigint")),
	d("vessel_marcar_presenca", p("p_codigo", "text"), p("p_veio", "boolean"), o("p_teste", "boolean")),
}

// publico: leituras e contadores anônimos (POST /publico/vessel/{nome}; `p_teste` é removido do corpo).
var publico = []rpc.Funcao{
	d("vessel_visita_da_sessao", p("p_codigo", "text"), o("p_peca", "text"), o("p_via", "text")),
	d("vessel_pre_venda_restantes"),
	d("vessel_horarios_ocupados", p("p_loja", "text"), p("p_data", "date")),
	d("vessel_abrir_convite", p("p_codigo", "text"), o("p_praca", "text"), o("p_client_advisor", "text"), o("p_via", "text"), o("p_teste", "boolean")),
	d("vessel_leitura_do_card", p("p_chave", "text")),
	d("vessel_card_da_stylist", p("p_quem", "text")),
	d("vessel_visita_do_stylist", p("p_codigo", "text"), o("p_via", "text")),
	d("vessel_convite_da_private_edit", p("p_chave", "text")),
	d("vessel_convite_da_convidada", p("p_chave", "text"), p("p_convidada", "text"), o("p_equipe", "boolean")),
	d("vessel_verificar", p("p_codigo", "text")),
}

// deEdge: as funções que as edges portadas (vessel-conta e vessel-registrar-garantia) chamam com a chave de serviço; o
// retorno é qualquer um (json, boolean, lista).
var deEdge = []rpc.Funcao{
	d("vessel_conta_criar", p("p_nome", "text"), p("p_cpf", "text"), p("p_email", "text"), p("p_whatsapp", "text"), p("p_nascimento", "date"), p("p_senha", "text")),
	d("vessel_conta_entrar", p("p_login", "text"), p("p_senha", "text"), p("p_lembrar", "boolean"), o("p_agente", "text"), o("p_ip_hash", "text")),
	d("vessel_conta_da_sessao", p("p_token", "text")),
	d("vessel_conta_sair", p("p_token", "text"), o("p_todas", "boolean")),
	d("vessel_conta_pedido_de_nova_senha", p("p_login", "text")),
	d("vessel_conta_efetivar_nova_senha", p("p_cliente_id", "uuid"), p("p_senha", "text")),
	d("vessel_conta_editar", p("p_token", "text"), o("p_nome", "text"), o("p_whatsapp", "text"), o("p_senha_atual", "text"), o("p_senha_nova", "text")),
	d("vessel_conta_apagar_recem_criada", p("p_cliente_id", "uuid")),
	d("vessel_minhas_pecas", p("p_token", "text")),
	d("vessel_transferencia_gerar", p("p_token", "text"), p("p_codigo", "text")),
	d("vessel_transferencia_aberta", p("p_token", "text"), p("p_codigo", "text")),
	d("vessel_transferencia_cancelar", p("p_token", "text"), p("p_codigo", "text")),
	d("vessel_transferencia_aceitar", p("p_token", "text"), p("p_codigo", "text"), p("p_codigo_transferencia", "text")),
	d("vessel_lembrete_criar", p("p_codigo", "text"), p("p_email", "text"), p("p_token_opcional", "text"), p("p_consentimento", "boolean")),
	d("vessel_lembrete_cancelar_por_token", p("p_token", "text")),
	d("vessel_teto_de_chamadas", p("p_chave", "text"), p("p_max", "integer"), p("p_janela_segundos", "integer")),
	d("vessel_registrar_como_cliente", p("p_token", "text"), p("p_codigo", "text"), o("p_onde", "text"), o("p_comprado_em", "date"), o("p_so_teste", "boolean"), o("p_presente_de_nome", "text")),
	d("vessel_tentativa_de_presente", p("p_codigo", "text")),
	dt("vessel_candidatos_de_presente", p("p_sku", "text")),
	d("vessel_decidir_pedido_de_registro", p("p_pedido", "uuid"), p("p_estado", "text"), p("p_quem_decidiu", "text"), o("p_conferencia", "jsonb"), o("p_motivo", "text")),
	d("vessel_abrir_pedido_de_registro", p("p_codigo", "text"), p("p_nome", "text"), p("p_cpf", "text"), p("p_whatsapp", "text"), o("p_onde", "text"), o("p_comprado_em", "date"), o("p_nascimento", "date")),
}
