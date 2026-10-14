package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"slices"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

// O que o código da API (worker, rotas do core, webhooks) presume do schema de PRODUÇÃO restaurado: várias
// tabelas são anteriores às migrations e não têm DDL no repositório. `api worker conferir` roda isto no
// ensaio do Plano 2, depois do restore: cada item listado é uma premissa quebrada (coluna, tipo, índice
// único usado em ON CONFLICT ou função SQL). As listas foram derivadas das consultas SQL de TODOS os pacotes
// de api/internal (comercial, conteudo, fabrica, frota, mensagens, meta, vessel, webhooks, webpush, worker,
// canais, auth); quem mexer numa consulta com tabela, coluna ou função nova acrescenta aqui.
var colunasDoWorker = map[string]string{
	"accounts":               "id,name,username,instagram_id,ad_account_id,access_token,profile_picture_url,picture_url,accent_color,persona,conteudo_usa_portal,publicacao_automatica",
	"daily_snapshots":        "account_id,captured_at,followers_count,gained,lost",
	"followers_leituras":     "id,account_id,followers_count,origem,lido_em",
	"engagement_snapshots":   "account_id,captured_at,period_days,likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views,created_at",
	"content_snapshots":      "account_id,captured_at,period_days,posts_count,reels_count,stories_count,story_shares,story_replies,story_reach,story_interactions,story_navigation,story_profile_visits,story_follows,story_nav_forward,story_nav_back,story_nav_exit,story_nav_next",
	"data_integrity_checks":  "id,checked_date,account_id,check_name,status,detail,created_at", // + Plano 5.1: /saude/conferencias
	"campaigns":              "campaign_id,account_id,name,objective,status,synced_at",
	"ads":                    "ad_id,campaign_id,account_id,name,status,destino_link,synced_at",
	"campaign_adsets":        "adset_id,campaign_id,account_id,destination_type,optimization_goal,synced_at",
	"campaign_insights":      "campaign_id,account_id,captured_at,period_days,spend,impressions,clicks,reach,post_engagement,likes,comments,shares,saves,conversas,cadastros,compras,visitas",
	"campaign_insights_hora": "campaign_id,account_id,dia,hora,gasto_acumulado,conversas_acumuladas,cliques_acumulados,gasto_hora,conversas_hora,cliques_hora",
	"perfil_visitas_hora":    "account_id,dia,hora,visitas_acumuladas,visitas_hora",
	"ad_insights_hora":       "ad_id,campaign_id,account_id,dia,hora,gasto_acumulado,cliques_acumulados,gasto_hora,cliques_hora",
	"push_subs":              "id,endpoint,p256dh,auth,user_id,created_at",
	"push_preferencias":      "user_id,tipo,ativo,alterado_em,alterado_por",
	"profiles":               "id,email,name,role,is_superadmin,disabled,features,permissions,escopo_por_equipe,allowed_accounts,avatar_url,precisa_trocar_senha,perfil_id,permissions_excecao,created_at",
	"equipes":                "id,nome,tipo,ativo,canal_loja_id,local_id,setor_id,empresa_id,deposito_id,ordem,criado_em,atualizado_em",
	"equipes_permissoes":     "id,equipe_id,profile_id,chave,concedido_por,criado_em",
	// a auditoria do "entrar como" (Plano 5.0): a API insere e o super-admin lê; conferirAuditoria olha o dono/RLS
	"entradas_como_outro_usuario": "admin_id,admin_email,alvo_id,alvo_email,criado_em",
	"equipes_membros":             "id,equipe_id,profile_id,papel,criado_em,criado_por",
	"canais_grupos":               "id,nome,ordem,ativo,criado_em",
	"acessos_perfis":              "id,nome,permissions,criado_em,criado_por",
	"access_requests":             "id,name,email,message,status,created_at", // esquema PRESUMIDO no 5.1: o conferir é quem pega divergência
	"audit_log":                   "actor_id,actor_email,action,detail",
	"canais_grupos_membros":       "id,grupo_id,profile_id,papel,concedido_por,concedido_em",
	// Plano 5.5 (Comercial): as colunas que as rotas de internal/vendas leem e gravam (o D0 vem do pg_dump do ensaio)
	"bling_lojas":                  "loja_id,nome,grupo,grupo_id,fechado_em",
	"bling_depositos":              "deposito_id,nome,ativo,padrao",
	"bling_metas":                  "id,loja_id,year,month,meta_valor,daily_goals",
	"bling_vendedor_metas":         "id,vendor_id,year,month,meta_valor,daily_goals",
	"bling_vendedores":             "vendor_id,nome,updated_at",
	"bling_pedido_vendedor":        "pedido_id,vendor_id,pedido_data,qtd_itens,loja_id",
	"bling_pedido_nota":            "pedido_id,pedido_numero,data_pedido,data_da_venda,total,loja_id,nota_situacao",
	"bling_pedido_ajuste_valor":    "pedido_id,loja_id,total_corrigido",
	"bling_pedido_ajuste_vendedor": "pedido_id,loja_id,vendor_id_corrigido",
	"bling_pedido_forma_pagamento": "parcela_id,pedido_id,loja_id,valor,eh_devolucao",
	"gc_estoque_item":              "deposito_id,sku,produto,categoria,saldo",
	"gc_vendas_item":               "mes,canal_loja_id,sku,produto,categoria,unidades,faturamento",
	"gestao_comercial_briefings":   "id,rodada,periodo,resumo,conteudo,dados_json,created_at",
	"acessos_pessoas":              "id,nome,profile_id,email_corporativo,cargo,status,setor_id,marca_id",       // + Plano 5.2 (cadastro rápido, ficha); o 5.4 amplia
	"frota_veiculos":               "id,placa,nome,marca,fipe_centavos,situacao,pessoa_id,bem_id,atualizado_em", // + Plano 5.2 (sincronizar_carro_e_bem); o 5.3 amplia
	"frota_checklist_itens":        "cadencia,ordem,ativo",
	"frota_checklist_config":       "dia_semanal,semana_mensal,dia_mensal",
	"frota_checklist":              "veiculo_id,feita_em,cadencias",
	"frota_uso":                    "id,veiculo_id,pessoa_id,tipo,saida_em,volta_em",
	"frota_requisicoes":            "id,veiculo_id,situacao,retirada_prevista,destino,motivo_decisao,encerrada_motivo,pessoa_id,pessoa_nome,criada_por",
	"conteudo_pecas":               "id,account_id,titulo,formato,status,legenda,hashtags,observacoes,publicar_em,publicado_em,avisado_em,ig_media_id,ig_permalink,responsavel,criado_por,aprovado_por,aprovado_em,motivo_reprovacao,created_at,updated_at", // + Plano 5.9
	"conteudo_eventos":             "id,peca_id,de,para,acao,detalhe,quem,quando",                                                                                                                                                                           // + Plano 5.9
	"conteudo_casamentos":          "id,peca_id,ig_media_id,ig_permalink,ig_timestamp,ig_caption,ig_thumb,pontuacao,situacao,motivo,decidido_por,decidido_em,created_at",                                                                                    // + Plano 5.9
	"conteudo_metricas":            "peca_id,capturado_em,curtidas,comentarios,alcance,salvamentos,compartilhamentos,visualizacoes,bruto",
	"checkout_abandono":            "token,status",
	"contatos_sem_mensagem":        "telefone,motivo",
	"chatwoot_eventos":             "tipo,chatwoot_account_id,conversation_id,conversation_display_id,contact_id,contact_name,contact_phone_number,loja,classificacao_ia,criado_em_chatwoot,dia_br",
	"shopify_pedidos":              "id,numero,loja_id,total,moeda,status_financeiro,cliente_nome,cliente_email,criado_em_shopify,bruto,atualizado_em",
	"carrinho_eventos":             "tipo,cart_token,evento_shopify_id",
	"vessel_rd_envios":             "id,origem_id,pessoa_id,status,tentativas,http_status,resposta,atualizado_em",
	"vessel_pessoas":               "id,email",
	"fabrica_campanhas":            "id,nome,status,objetivo,job_id,desconto_tipo,desconto_pct,parcelas,criado_por,created_at,fechada_em,purgado_em",
	"fabrica_criativos":            "id,campanha_id,sku,arquetipo,template,formato,variante,preco_de,preco_por,storage_path,url,legenda,escolhido,purgado_em,created_at",
	"robos_execucoes":              "robo,disparado_em,status_code,ok,resposta,conferido_em",
	// Plano 5.6 (rotas /redes): os presumidos (sem DDL no repositório) são conferidos aqui no banco restaurado
	"account_insights":      "account_id,captured_at,period_days,spend,impressions,clicks,reach,frequency",
	"social_metas":          "account_id,periodo,indicador,valor",
	"campaign_filters":      "account_id,selected_ids,updated_at",
	"noticias_concorrentes": "id,rodada,destaque,created_at", // Plano 5.12: filtro e ordem das leituras
	"noticias_panorama":     "rodada,conteudo_md,modelo,created_at",
	"ia_execucoes":          "id,robo,acao,modelo,input_tokens,output_tokens,chamadas,usd,duracao_ms,itens,unidade,status,detalhe,github_run_id,run_at", // + Plano 5.8: o robô da Fábrica grava
	"robos_saude":           "robo,critico",                                                                                                             // visão (relkind 'v'): ordem da leitura
	// Plano 5.7 (gestão de tráfego): o que as rotas e a RPC presumem. Presumidos sem DDL no repositório:
	// gt_budget_analises.impactos e gt_ponderada_config.limiares_resultado.
	"gt_config_metricas":      "balde,metricas,updated_at",
	"gt_objetivo_interacao":   "alvo_id,nivel,interacao,conta_id,updated_at,updated_by",
	"gt_ponderada_config":     "id,pesos,metas,limiares,limiares_resultado,metas_por_conta,updated_at,updated_by",
	"gt_ponderada_config_log": "id,mudou_em,mudou_quem,antes,depois",
	"gt_budget_analises":      "campaign_id,account_id,objetivo,effective_status,veredito,justificativa,impacto_estimado,impactos,budget_atual_centavos,budget_sugerido_centavos,gerado_em,valida_ate",
	"gt_ad_analises":          "ad_id,campaign_id,account_id,veredito,justificativa,gerado_em,valida_ate",
	"gt_fila_decisoes":        "id,campaign_id,account_id,escopo,veredito,budget_atual_centavos,budget_sugerido_centavos,analise_gerada_em,decisao,decidido_em,decidido_por,silenciar_ate,aplicado,erro",
	"gt_campanhas_rascunho":   "id,account_id,criado_por,estado,passo,nome,tipo,status,resultado,created_at,updated_at",
	"gt_problemas_meta":       "ad_id,codigo,account_id,titulo,grave,primeira_vez,ultima_vez,resolvido_em",
	"fabrica_marcas":          "id,nome,caption_template,ad_account,page_id,ig_id,account_id,ativo,segmento,termos_produto,created_at", // + Plano 5.8: GET /fabrica/marcas
	"interesses_sugeridos":    "id,marca_id,objetivo,itens,propostos,validos,gerado_em",
	// Plano 5.2 (patrimônio e cadastros): o que as rotas, as RPCs e os gatilhos do bem presumem. Tabelas sem DDL
	// no repositório (a D0 as reproduz das migrations): o conferir pega a divergência no banco restaurado.
	"patrimonio_bens":       "id,numero,nome,valor_centavos,data_compra,empresa_id,local_id,comodo_id,categoria_id,tipo_id,marca,numero_serie,pessoa_id,dono_texto,etiquetado,situacao,observacao,detalhes,criado_em,atualizado_em",
	"patrimonio_posse":      "id,bem_id,pessoa_id,pessoa_nome,de,ate,motivo,criado_em",
	"patrimonio_empresas":   "id,nome,ordem,criado_em",
	"patrimonio_locais":     "id,nome,ordem,criado_em,empresa_id",
	"patrimonio_comodos":    "id,nome,ordem,criado_em,local_id",
	"patrimonio_categorias": "id,nome,vida_util_anos,ordem,criado_em",
	"patrimonio_tipos":      "id,categoria_id,nome,ordem,criado_em",
	"patrimonio_config":     "chave,valor,atualizado_em",
	"patrimonio_log":        "id,quem,acao,alvo,resultado,detalhe,quando",
	"acessos_setores":       "id,nome,ordem",
	// Plano 5.9 (conteúdo): o que as rotas, as RPCs e o /conteudo-trigger presumem; conteudo_jobs é a fila do vigia
	// da VPS. Todas com DDL no repositório.
	"conteudo_arquivos":     "id,peca_id,ordem,bucket,caminho,tipo,mime,bytes,created_at",
	"conteudo_ideias":       "id,account_id,titulo,gancho,formato,pilar,roteiro,legenda_sugerida,hashtags_sugeridas,por_que_agora,referencia,origem,modelo,job_id,situacao,peca_id,criado_por,created_at,cta,producao,porque_formato",
	"conteudo_blocos":       "id,account_id,tipo,nome,texto,usos,ativo,criado_por,created_at",
	"conteudo_jobs":         "id,tipo,account_id,params,status,github_run_id,resultado,erro,criado_por,created_at,updated_at",
	"conteudo_concorrentes": "id,account_id,handle,nome,observacao,ativo,created_at",
	// Plano 5.8 (Fábrica): leituras, edges e rotas de robô. Todas com DDL em db/migrations (014-030): o conferir
	// pega o que foi acrescentado em produção sem migration. fabrica_campanhas, fabrica_criativos, fabrica_marcas e
	// ia_execucoes são AMPLIADAS acima. gc_vendas_item, gc_estoque_item e gestao_comercial_briefings entram com a
	// Task 7 (fabrica-candidatos), que espera o 5.5.
	"fabrica_jobs":      "id,tipo,params,status,github_run_id,resultado,erro,criado_por,created_at,updated_at",
	"fabrica_lojas":     "deposito_id,nome,ativo,ordem,marca_id,whatsapp,geo_cities,canal_loja_id",
	"fabrica_objetivos": "chave,rotulo,descricao,meta_objective,optimization_goal,billing_event,destination_type,promoted_object_tipo,cta_type,looks,pede_desconto,ativo,ordem",
	"fabrica_looks":     "chave,nome,arquetipo,objetivos,ativo,excluido,ordem,preview_url,tipo,canva_formato_map,campo_map,created_at",
	"fabrica_publicos":  "id,nome,marca_id,geo,idade_min,idade_max,generos,interesses,custom_audiences,ativo,criado_por,created_at",
	"fabrica_meta_jobs": "id,tipo,loja,ad_account_id,meta_campaign_id,adset_ids,ad_ids,payload,status,erro,created_at",
}

// tiposDoWorker: tabela.coluna -> tipo (nome de regtype) de que o código depende (cast do parâmetro, junção,
// leitura direta no Scan ou texto de data). "a|b" = qualquer um dos dois; "text" aceita varchar. Só entram
// as colunas em que o tipo errado quebra o SQL ou muda o resultado (o resto o código converte com cast).
var tiposDoWorker = map[string]string{
	"accounts.id": "uuid", "accounts.conteudo_usa_portal": "boolean", "accounts.persona": "text", "profiles.id": "uuid", "profiles.features": "text[]", "profiles.permissions": "jsonb",
	"profiles.is_superadmin": "boolean", "profiles.disabled": "boolean", "profiles.escopo_por_equipe": "boolean",
	"profiles.precisa_trocar_senha": "boolean", "equipes.deposito_id": "bigint|integer", "equipes.canal_loja_id": "bigint|integer",
	"entradas_como_outro_usuario.admin_id": "uuid", "entradas_como_outro_usuario.alvo_id": "uuid",
	"entradas_como_outro_usuario.criado_em": "timestamp with time zone",
	"daily_snapshots.captured_at":           "date", "engagement_snapshots.captured_at": "date", "content_snapshots.captured_at": "date",
	"data_integrity_checks.checked_date": "date", "campaign_insights.captured_at": "date", "campaign_insights_hora.dia": "date",
	"perfil_visitas_hora.dia": "date", "ad_insights_hora.dia": "date", "conteudo_metricas.capturado_em": "date",
	"frota_checklist.feita_em": "date", "frota_checklist.cadencias": "text[]", "chatwoot_eventos.dia_br": "date",
	"bling_pedido_nota.data_pedido": "date", "bling_pedido_nota.data_da_venda": "date", "bling_pedido_nota.nota_situacao": "smallint|integer",
	"bling_pedido_ajuste_valor.pedido_id": "bigint|integer", "bling_pedido_vendedor.pedido_id": "bigint|integer",
	"interesses_sugeridos.marca_id": "uuid", "campaigns.campaign_id": "text", "ads.ad_id": "text", "ads.campaign_id": "text", "campaign_adsets.adset_id": "text",
	"campaign_adsets.campaign_id": "text", "campaign_insights.campaign_id": "text", "campaign_insights_hora.campaign_id": "text",
	"ad_insights_hora.ad_id": "text", "ad_insights_hora.campaign_id": "text",
	"push_subs.endpoint": "text", "push_subs.p256dh": "text", "push_subs.auth": "text", "push_preferencias.tipo": "text", "push_preferencias.ativo": "boolean",
	"conteudo_pecas.id": "uuid", "conteudo_pecas.ig_media_id": "text", "conteudo_pecas.publicar_em": "timestamp with time zone",
	"conteudo_pecas.publicado_em": "timestamp with time zone", "conteudo_pecas.avisado_em": "timestamp with time zone",
	"conteudo_eventos.peca_id": "uuid", "conteudo_casamentos.peca_id": "uuid", "conteudo_casamentos.ig_media_id": "text",
	"conteudo_casamentos.ig_timestamp": "timestamp with time zone", "conteudo_metricas.peca_id": "uuid", "conteudo_metricas.bruto": "jsonb",
	"frota_checklist.veiculo_id": "uuid", "fabrica_campanhas.id": "uuid", "fabrica_criativos.campanha_id": "uuid",
	"followers_leituras.lido_em": "timestamp with time zone", "checkout_abandono.token": "text", "contatos_sem_mensagem.telefone": "text",
	"shopify_pedidos.bruto": "jsonb", "robos_execucoes.disparado_em": "timestamp with time zone", "robos_execucoes.conferido_em": "timestamp with time zone",
	"robos_execucoes.robo": "text", "robos_execucoes.resposta": "text", "robos_execucoes.ok": "boolean",
	"vessel_rd_envios.atualizado_em": "timestamp with time zone",
	// Plano 5.6: os filtros fazem ::uuid/::date/::timestamptz; as escritas presumem estes tipos
	"account_insights.captured_at": "date", "social_metas.account_id": "text", "social_metas.periodo": "text",
	"social_metas.indicador": "text", "social_metas.valor": "numeric", "campaign_filters.account_id": "uuid",
	"campaign_filters.selected_ids": "text[]", "campaign_filters.updated_at": "timestamp with time zone",
	// Plano 5.1: os filtros e o upsert fazem ::uuid nestas colunas; permissions tem de ser objeto jsonb
	"profiles.perfil_id": "uuid", "profiles.permissions_excecao": "jsonb", "acessos_perfis.permissions": "jsonb",
	"equipes_membros.equipe_id": "uuid", "equipes_membros.profile_id": "uuid",
	"equipes_permissoes.equipe_id": "uuid", "equipes_permissoes.profile_id": "uuid",
	"canais_grupos_membros.grupo_id": "uuid", "canais_grupos_membros.profile_id": "uuid",
	"push_subs.user_id": "uuid", "push_preferencias.user_id": "uuid",
	"noticias_concorrentes.rodada": "date", "noticias_panorama.rodada": "date", // o filtro faz @rodada::date[]
	// Plano 5.7: account_id das gt_* e de fabrica_marcas é TEXTO (as policies fazem pode_ver_conta(account_id) sem
	// cast; os filtros fazem ::text); os jsonb que as escritas gravam por jsonb_populate_record
	"gt_budget_analises.account_id": "text", "gt_ad_analises.account_id": "text", "gt_fila_decisoes.account_id": "text",
	"gt_campanhas_rascunho.account_id": "text", "gt_problemas_meta.account_id": "text", "fabrica_marcas.account_id": "text",
	"gt_objetivo_interacao.conta_id": "uuid", "gt_campanhas_rascunho.criado_por": "uuid", "gt_fila_decisoes.decidido_por": "uuid",
	"gt_ponderada_config.metas_por_conta": "jsonb", "gt_ponderada_config.limiares_resultado": "jsonb",
	"gt_config_metricas.metricas": "jsonb", "gt_budget_analises.impactos": "jsonb", "gt_campanhas_rascunho.estado": "jsonb",
	// Plano 5.2: os filtros fazem ::uuid/::date nestas colunas e os embutidos de bens casam por uuid
	"patrimonio_bens.pessoa_id": "uuid", "patrimonio_bens.local_id": "uuid", "patrimonio_bens.categoria_id": "uuid",
	"patrimonio_bens.comodo_id": "uuid", "patrimonio_posse.bem_id": "uuid", "patrimonio_posse.de": "date",
	"patrimonio_posse.ate": "date", "patrimonio_config.valor": "text", "equipes.local_id": "uuid", "acessos_pessoas.profile_id": "uuid",
	// Plano 5.9: os casts das rotas, das RPCs e do /conteudo-trigger (account_id das conteudo_* é uuid: o init completa)
	"conteudo_pecas.criado_por": "uuid", "conteudo_pecas.responsavel": "uuid", "conteudo_arquivos.id": "uuid",
	"conteudo_arquivos.peca_id": "uuid", "conteudo_arquivos.ordem": "integer", "conteudo_eventos.quem": "uuid",
	"conteudo_casamentos.id": "uuid", "conteudo_ideias.id": "uuid", "conteudo_ideias.peca_id": "uuid", "conteudo_ideias.roteiro": "jsonb",
	"conteudo_ideias.criado_por": "uuid", "conteudo_blocos.criado_por": "uuid", "conteudo_jobs.id": "uuid", "conteudo_jobs.params": "jsonb",
	"conteudo_jobs.resultado": "jsonb", "conteudo_jobs.criado_por": "uuid", "conteudo_jobs.created_at": "timestamp with time zone",
	// Plano 5.8: os casts e as conversões de que as rotas da Fábrica dependem. deposito_id da loja é TEXTO (a
	// Task 7 compara texto com texto e converte para bigint só no parâmetro de gc_estoque_item.deposito_id).
	"fabrica_lojas.deposito_id": "text", "fabrica_lojas.canal_loja_id": "text", "fabrica_lojas.geo_cities": "jsonb",
	"fabrica_campanhas.job_id": "uuid", "fabrica_campanhas.criado_por": "uuid", "fabrica_jobs.id": "uuid",
	"fabrica_jobs.params": "jsonb", "fabrica_jobs.resultado": "jsonb", "fabrica_jobs.criado_por": "uuid",
	"fabrica_meta_jobs.payload": "jsonb", "fabrica_meta_jobs.adset_ids": "jsonb", "fabrica_meta_jobs.ad_ids": "jsonb",
	"fabrica_looks.objetivos": "text[]", "fabrica_publicos.id": "uuid", "fabrica_publicos.generos": "integer[]",
	"fabrica_publicos.geo": "jsonb", "fabrica_publicos.idade_min": "integer", "fabrica_publicos.idade_max": "integer",
	// Plano 5.5: filtros com cast, chaves das escritas, dinheiro e datas do Comercial
	"bling_lojas.loja_id": "bigint", "bling_lojas.grupo_id": "uuid", "bling_lojas.fechado_em": "date",
	"bling_metas.loja_id": "bigint|integer", "bling_metas.year": "integer|bigint", "bling_metas.month": "integer|bigint",
	"bling_metas.daily_goals": "jsonb", "bling_vendedor_metas.vendor_id": "bigint|integer", "bling_vendedor_metas.daily_goals": "jsonb",
	"bling_vendedores.vendor_id": "bigint|integer", "bling_pedido_vendedor.pedido_data": "date",
	"bling_pedido_forma_pagamento.eh_devolucao": "boolean", "gc_estoque_item.deposito_id": "bigint",
	"gc_vendas_item.mes": "date", "gc_vendas_item.canal_loja_id": "bigint", "shopify_pedidos.criado_em_shopify": "timestamp with time zone",
}

// anulaveisDoWorker: colunas que precisam ACEITAR nulo (a migração de 2026-09-18 tirou o NOT NULL do cart_token).
var anulaveisDoWorker = []string{"carrinho_eventos.cart_token"}

func init() { // toda coluna account_id é uuid, SALVO a que tiposDoWorker declara (gt_*, fabrica_marcas, social_metas: texto)
	for tabela, cols := range colunasDoWorker {
		if _, definido := tiposDoWorker[tabela+".account_id"]; !definido && slices.Contains(strings.Split(cols, ","), "account_id") {
			tiposDoWorker[tabela+".account_id"] = "uuid" // social_metas.account_id é text e fica como declarado
		}
	}
}

// unicosDoWorker: os alvos de ON CONFLICT (sem o índice único COMPLETO, válido e imediato, o Postgres recusa o
// upsert; índice parcial, de expressão ou DEFERRABLE não vale).
var unicosDoWorker = []string{
	"daily_snapshots(account_id,captured_at)", "engagement_snapshots(account_id,captured_at,period_days)",
	"content_snapshots(account_id,captured_at,period_days)", "campaigns(campaign_id)", "ads(ad_id)", "campaign_adsets(adset_id)",
	"campaign_insights(campaign_id,account_id,captured_at,period_days)", "campaign_insights_hora(campaign_id,account_id,dia,hora)",
	"perfil_visitas_hora(account_id,dia,hora)", "ad_insights_hora(ad_id,account_id,dia,hora)",
	"conteudo_casamentos(peca_id,ig_media_id)", "conteudo_metricas(peca_id,capturado_em)",
	"chatwoot_eventos(conversation_id,tipo)", "contatos_sem_mensagem(telefone)", "shopify_pedidos(id)",
	"social_metas(account_id,periodo,indicador)", "campaign_filters(account_id)", // Plano 5.6
	"push_subs(endpoint)", "push_preferencias(user_id,tipo)", // Plano 5.1: inscrição de push e lote de preferências
	// Plano 5.7: alvos de ON CONFLICT (tela, RPC e robô sugerir-interesses)
	"gt_config_metricas(balde)", "gt_objetivo_interacao(alvo_id)", "gt_problemas_meta(ad_id,codigo)", "interesses_sugeridos(marca_id,objetivo)",
	"acessos_perfis(nome)",     // Plano 5.1: a tela regrava o perfil de mesmo nome pelo 409 deste único
	"patrimonio_config(chave)", // Plano 5.2: PUT /patrimonio/config/{chave} é upsert por este único
	// Plano 5.5: Tabela.Gravar (on conflict) nos dois caches; e o único (chave, ano, mês) das metas, que o salvamento do mês presume
	"bling_pedido_vendedor(pedido_id)", "bling_vendedores(vendor_id)",
	"bling_metas(loja_id,year,month)", "bling_vendedor_metas(vendor_id,year,month)",
}

// deduplicadoresDoWorker: `on conflict do nothing` sem alvo; é o índice único (parcial vale) que impede a
// duplicata. Sem ele o insert passa e o evento entra duas vezes, sem erro nenhum.
var deduplicadoresDoWorker = []string{"carrinho_eventos(evento_shopify_id)"}

// funcoesDoWorker: as funções SQL de produção que o código chama (assinatura de to_regprocedure).
var funcoesDoWorker = []string{
	"mover_abandonados_para_fila(integer,integer)", "pegar_para_mensagem(integer,integer,boolean,text[],integer)",
	"pegar_da_fila(text,integer,integer,boolean,text[])", "marcar_mensagem(text,text,text,bigint)",
	"marcar_da_fila(text,text,text,text,bigint)", "devolver_mensagem(text,boolean)", "devolver_da_fila(text,text,boolean)",
	"liberar_mensagens_travadas()", "liberar_travadas_da_fila()", "agendar_followups(integer,integer)",
	"avaliar_trava_cruzada(text,integer,text,text)", "conteudo_reivindicar_hora_h()", "vessel_rd_payload(bigint)",
	"pode_ver_conta(text)",               // Plano 5.6
	"gt_registrar_problemas(text,jsonb)", // Plano 5.7
	"conteudo_guarda_aprovacao()",        // Plano 5.9: a função do gatilho (as 6 RPCs, conferirRPC confere por web.FuncoesRPC)
	// Plano 5.1: os gatilhos que as escritas de perfis, grupos e times presumem
	"guard_profiles()", "impedir_autopromocao()", "espelhar_rename_do_grupo()", "espelhar_grupo_do_canal()", "equipes_toca_atualizado()",
	// Plano 5.2: os gatilhos do bem que as escritas do Patrimônio presumem (os 5 do carro, que a cadeia alcança, são do 5.3)
	"bem_de_veiculo_segue_a_frota()", "patrimonio_espelha_responsavel_no_veiculo()", "patrimonio_espelha_situacao_no_veiculo()",
}

// gatilhosDoWorker (nome, tabela): os gatilhos do 5.1 têm de existir NA tabela certa e não estar desabilitados
// (tgenabled = 'D'). Conferir só a função (acima) não pega um gatilho que o restore deixou de ligar.
var gatilhosDoWorker = [][2]string{
	{"equipes_atualizado", "equipes"}, {"trg_espelhar_grupo_do_canal", "bling_lojas"}, {"trg_espelhar_rename_do_grupo", "canais_grupos"},
	{"trg_guard_profiles", "profiles"}, {"trg_impedir_autopromocao", "profiles"},
	// Plano 5.2: a situação e o responsável do bem andam com o carro ligado a ele
	{"trg_bem_de_veiculo_segue_a_frota", "patrimonio_bens"}, {"trg_patrimonio_espelha_responsavel", "patrimonio_bens"},
	{"trg_patrimonio_espelha_situacao", "patrimonio_bens"},
	{"conteudo_pecas_guarda", "conteudo_pecas"}, // Plano 5.9: sem ele, quem não aprova aprova pelo PATCH
}

// funcoesPorNomeDoWorker: chamadas dos webhooks, que o levantamento não detalhou por assinatura (há
// sobrecargas, ex.: marcar_checkout_comprou(text) e (text,text,text)): basta UMA sobrecarga com os parâmetros.
var funcoesPorNomeDoWorker = []string{
	"registrar_checkout_abandono", "marcar_checkout_comprou", "marcar_checkout_pagamento_pendente", "reabrir_checkout_abandono",
	"registrar_pedido_para_mensagem", "cancelar_mensagem_pedido",
}

// parametrosDasFuncoes: os parâmetros NOMEADOS que o código passa (`p_x => $1`); nome diferente = erro de
// "função não existe" só na primeira execução.
var parametrosDasFuncoes = map[string][]string{
	"pegar_para_mensagem":                {"p_limite", "p_atraso_min", "p_reservar", "p_ultimos11", "p_max_horas"},
	"pegar_da_fila":                      {"p_tipo", "p_limite", "p_max_horas", "p_reservar", "p_ultimos11"},
	"marcar_mensagem":                    {"p_token", "p_status", "p_motivo", "p_conversa"},
	"marcar_da_fila":                     {"p_tipo", "p_chave", "p_status", "p_motivo", "p_conversa"},
	"devolver_mensagem":                  {"p_token", "p_contar"},
	"devolver_da_fila":                   {"p_tipo", "p_chave", "p_contar"},
	"agendar_followups":                  {"p_apos_horas", "p_teto_horas"},
	"avaliar_trava_cruzada":              {"p_telefone", "p_horas", "p_tipo", "p_chave"},
	"mover_abandonados_para_fila":        {"p_minutos"},
	"registrar_checkout_abandono":        {"p_token", "p_email", "p_telefone", "p_nome", "p_total", "p_moeda", "p_url"},
	"marcar_checkout_comprou":            {"p_token", "p_email", "p_telefone"},
	"marcar_checkout_pagamento_pendente": {"p_token"},
	"reabrir_checkout_abandono":          {"p_token"},
	"registrar_pedido_para_mensagem":     {"p_pedido_id", "p_numero", "p_nome", "p_telefone", "p_criado_em"},
	"cancelar_mensagem_pedido":           {"p_pedido_id"},
	"gt_registrar_problemas":             {"p_conta", "p_itens"}, // Plano 5.7
}

// retornoDasFuncoes: as colunas que o código LÊ do que a função devolve (`select token, ... from f(...)`).
var retornoDasFuncoes = map[string][]string{
	"pegar_para_mensagem":         {"token", "telefone", "nome", "url_de_recuperacao", "status", "iniciado_em"},
	"pegar_da_fila":               {"chave", "numero", "nome", "telefone", "url_de_recuperacao", "conversa_origem", "criado_em"},
	"conteudo_reivindicar_hora_h": {"id", "account_id", "titulo", "formato", "publicar_em", "responsavel", "avisado_em"},
}

// tipoConfere: "a|b" aceita qualquer; "text" aceita também varchar, "text[]" também varchar[].
func tipoConfere(esperado, achado string) bool {
	for _, e := range strings.Split(esperado, "|") {
		if e == achado || (e == "text" && achado == "character varying") || (e == "text[]" && achado == "character varying[]") {
			return true
		}
	}
	return false
}

func nomeDaFuncao(item string) string { n, _, _ := strings.Cut(item, "("); return n }

// conferirSchema devolve as premissas quebradas, em ordem (vazio = tudo certo). Só lê (transação somente
// leitura) e só olha o schema atual (current_schema); pg_attribute e pg_index, não information_schema, que
// esconde o que o papel não consegue acessar.
func conferirSchema(ctx context.Context, p *pgxpool.Pool) ([]string, error) {
	tx, err := p.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(context.WithoutCancel(ctx))
	var faltam []string

	// Migração: tabelas do `api migrar`.
	var semMigrar []string
	for _, t := range []string{"envios_feitos", "webhooks_recebidos", "sessoes", "usuarios"} {
		var existe bool
		if err := tx.QueryRow(ctx, `select to_regclass(current_schema() || '.' || $1::text) is not null`, t).Scan(&existe); err != nil {
			return nil, err
		}
		if !existe {
			semMigrar = append(semMigrar, t)
		}
	}
	if len(semMigrar) > 0 {
		faltam = append(faltam, "migrações: `api migrar` ainda não rodou neste banco (faltam "+strings.Join(semMigrar, ", ")+")")
	}

	// Colunas, tipos e nulabilidade: uma consulta só.
	tabelas := make([]string, 0, len(colunasDoWorker))
	for t := range colunasDoWorker {
		tabelas = append(tabelas, t)
	}
	sort.Strings(tabelas)
	linhas, err := tx.Query(ctx, `select c.relname::text, a.attname::text, a.atttypid::regtype::text, a.attnotnull
		from pg_attribute a join pg_class c on c.oid = a.attrelid
		where c.relnamespace = current_schema()::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
		  and a.attnum > 0 and not a.attisdropped and c.relname = any($1::text[])`, tabelas)
	if err != nil {
		return nil, err
	}
	type col struct {
		tipo    string
		naoNulo bool
	}
	achadas := map[string]col{}
	for linhas.Next() {
		var t, c, tipo string
		var nn bool
		if err := linhas.Scan(&t, &c, &tipo, &nn); err != nil {
			linhas.Close()
			return nil, err
		}
		achadas[t+"."+c] = col{tipo, nn}
	}
	linhas.Close()
	if err := linhas.Err(); err != nil {
		return nil, err
	}
	for _, t := range tabelas {
		for _, c := range strings.Split(colunasDoWorker[t], ",") {
			k := t + "." + c
			a, ok := achadas[k]
			switch {
			case !ok:
				faltam = append(faltam, "coluna "+k)
			case tiposDoWorker[k] != "" && !tipoConfere(tiposDoWorker[k], a.tipo):
				faltam = append(faltam, fmt.Sprintf("tipo %s: esperado %s, achado %s", k, tiposDoWorker[k], a.tipo))
			}
		}
	}
	for _, k := range anulaveisDoWorker {
		if a, ok := achadas[k]; ok && a.naoNulo {
			faltam = append(faltam, "coluna "+k+" deve aceitar nulo (NOT NULL achado)")
		}
	}

	// Índices únicos: o conjunto de colunas-CHAVE (sem as de INCLUDE) tem de ser exatamente o alvo.
	unico := func(u string, parcialOk bool) (bool, error) {
		tabela, cols, _ := strings.Cut(strings.TrimSuffix(u, ")"), "(")
		quer := strings.Split(cols, ",")
		sort.Strings(quer)
		var tem bool
		err := tx.QueryRow(ctx, `select exists (
			select 1 from pg_index x join pg_class t on t.oid = x.indrelid
			 where t.relname = $1::text and t.relnamespace = current_schema()::regnamespace
			   and x.indisunique and x.indisvalid and x.indimmediate and x.indexprs is null
			   and ($3::boolean or x.indpred is null)
			   and (select array_agg(a.attname::text order by a.attname)
			          from unnest(x.indkey) with ordinality as k(attnum, ord)
			          join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
			         where k.ord <= x.indnkeyatts) = $2::text[])`, tabela, quer, parcialOk).Scan(&tem)
		return tem, err
	}
	for _, u := range unicosDoWorker {
		tem, err := unico(u, false)
		if err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "único "+u)
		}
	}
	for _, u := range deduplicadoresDoWorker {
		tem, err := unico(u, true)
		if err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "único (dedupe do on conflict do nothing) "+u)
		}
	}

	// Funções: existe, tem os parâmetros nomeados e devolve as colunas que o código lê.
	itens := append(slices.Clone(funcoesDoWorker), funcoesPorNomeDoWorker...)
	for _, item := range itens {
		nome := nomeDaFuncao(item)
		sig := ""
		if strings.Contains(item, "(") {
			sig = item
		}
		linhas, err := tx.Query(ctx, `select coalesce(p.proargnames, '{}'::text[]), coalesce(p.proargmodes::text[], '{}'::text[]),
				coalesce(array(select a.attname::text from pg_attribute a
				        where a.attrelid = t.typrelid and a.attnum > 0 and not a.attisdropped order by a.attnum), '{}'::text[])
			  from pg_proc p join pg_type t on t.oid = p.prorettype
			 where p.pronamespace = current_schema()::regnamespace and p.proname = $1::text
			   and ($2::text = '' or p.oid = to_regprocedure(current_schema() || '.' || $2::text))`, nome, sig)
		if err != nil {
			return nil, err
		}
		var melhor []string
		achou := false
		for linhas.Next() {
			var nomes, modos, compostas []string
			if err := linhas.Scan(&nomes, &modos, &compostas); err != nil {
				linhas.Close()
				return nil, err
			}
			var entradas, saidas []string
			for i, n := range nomes {
				m := "i"
				if i < len(modos) {
					m = modos[i]
				}
				if m == "i" || m == "b" || m == "v" {
					entradas = append(entradas, n)
				}
				if m == "o" || m == "b" || m == "t" {
					saidas = append(saidas, n)
				}
			}
			if len(saidas) == 0 {
				saidas = compostas // setof tabela/tipo composto: as colunas são as do tipo
			}
			var sem []string
			for _, a := range parametrosDasFuncoes[nome] {
				if !slices.Contains(entradas, a) {
					sem = append(sem, "função "+item+" sem o parâmetro "+a)
				}
			}
			for _, c := range retornoDasFuncoes[nome] {
				if !slices.Contains(saidas, c) {
					sem = append(sem, "função "+item+" não devolve a coluna "+c)
				}
			}
			if !achou || len(sem) < len(melhor) { // com sobrecargas, vale a que mais se aproxima do que o código chama
				melhor, achou = sem, true
			}
		}
		linhas.Close()
		if err := linhas.Err(); err != nil {
			return nil, err
		}
		if !achou {
			faltam = append(faltam, "função "+item)
			continue
		}
		faltam = append(faltam, melhor...)
	}

	// Plano 5.1: gatilhos por nome e tabela (pg_trigger), ligados.
	for _, g := range gatilhosDoWorker {
		var tem bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
			 where not t.tgisinternal and t.tgname = $1::text and c.relname = $2::text
			   and c.relnamespace = current_schema()::regnamespace and t.tgenabled <> 'D')`, g[0], g[1]).Scan(&tem); err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "gatilho "+g[0]+" em "+g[1]+" (ausente ou desabilitado)")
		}
	}

	// Plano 5.0: ambiente da gramática de SQL, papel da API na auditoria do "entrar como" e as RPC declaradas.
	for _, conferir := range []func(context.Context, pgx.Tx) ([]string, error){
		conferirAmbiente, conferirAuditoria,
		func(ctx context.Context, tx pgx.Tx) ([]string, error) {
			return conferirLeituraDoCatalogo(ctx, tx, autz.Producao.Tabelas())
		},
		func(ctx context.Context, tx pgx.Tx) ([]string, error) { return conferirRPC(ctx, tx, web.FuncoesRPC) },
	} {
		mais, err := conferir(ctx, tx)
		if err != nil {
			return nil, err
		}
		faltam = append(faltam, mais...)
	}
	sort.Strings(faltam)
	return faltam, nil
}

// conferirComando é `api worker conferir`: SÓ as conferências de schema (sem aviso de VAPID, sem
// ValidarDesligadas, sem recusar por falta de tabela: faltar `api migrar` é um dos itens listados e o resto
// continua sendo conferido). Saída 0 = confere; 1 = lista o que falta. Nunca imprime URL nem credencial do
// banco: erro de conexão sai só com a classe.
func conferirComando(ctx context.Context, p *pgxpool.Pool, cfg config.Config) int {
	faltam, err := conferirSchema(ctx, p)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) {
			fmt.Fprintf(os.Stderr, "conferir: o banco recusou a consulta (%s %s)\n", pg.Code, pg.Message)
		} else {
			fmt.Fprintln(os.Stderr, "conferir: não consegui consultar o banco (conexão ou permissão)")
		}
		return 1
	}
	avisos, err := conferirAvisos(ctx, p)
	if err != nil {
		avisos = []string{"não consegui conferir o formato de profiles.permissions"}
	}
	for _, a := range avisos { // aviso não falha o conferir
		fmt.Println("AVISO: " + a)
	}
	faltam = append(faltam, conferirRotas(p, cfg)...) // a montagem das rotas de domínio contra as tabelas reais
	sort.Strings(faltam)
	for _, f := range faltam {
		fmt.Println(f)
	}
	if len(faltam) > 0 {
		fmt.Fprintf(os.Stderr, "%d premissa(s) do código quebrada(s) no schema\n", len(faltam))
		return 1
	}
	fmt.Println("schema confere com o que o worker presume")
	return 0
}
