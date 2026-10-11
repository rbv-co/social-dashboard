package main

import (
	"context"
	"slices"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// O que as tarefas do worker presumem do schema de PRODUÇÃO restaurado (várias tabelas são anteriores
// às migrations e não têm DDL no repositório). `api worker conferir` roda isto no ensaio do Plano 2,
// depois do restore: cada item listado é uma premissa quebrada (coluna, índice único usado em
// ON CONFLICT ou função SQL que o worker chama).
var colunasDoWorker = map[string]string{
	"accounts":               "id,name,instagram_id,ad_account_id,access_token",
	"daily_snapshots":        "account_id,captured_at,followers_count,gained,lost",
	"followers_leituras":     "account_id,followers_count,origem,lido_em",
	"engagement_snapshots":   "account_id,captured_at,period_days,likes,comments,saves,shares,reach,views,total_interactions,accounts_engaged,profile_views",
	"content_snapshots":      "account_id,captured_at,period_days,posts_count,reels_count,stories_count,story_shares,story_replies,story_reach,story_interactions,story_navigation,story_profile_visits,story_follows,story_nav_forward,story_nav_back,story_nav_exit,story_nav_next",
	"data_integrity_checks":  "checked_date,account_id,check_name,status,detail",
	"campaigns":              "campaign_id,account_id,name,objective,status,synced_at",
	"ads":                    "ad_id,campaign_id,account_id,name,status,destino_link,synced_at",
	"campaign_adsets":        "adset_id,campaign_id,account_id,destination_type,optimization_goal,synced_at",
	"campaign_insights":      "campaign_id,account_id,captured_at,period_days,spend,impressions,clicks,reach,post_engagement,likes,comments,shares,saves,conversas,cadastros,compras,visitas",
	"campaign_insights_hora": "campaign_id,account_id,dia,hora,gasto_acumulado,conversas_acumuladas,cliques_acumulados,gasto_hora,conversas_hora,cliques_hora",
	"perfil_visitas_hora":    "account_id,dia,hora,visitas_acumuladas,visitas_hora",
	"ad_insights_hora":       "ad_id,campaign_id,account_id,dia,hora,gasto_acumulado,cliques_acumulados,gasto_hora,cliques_hora",
	"push_subs":              "endpoint,p256dh,auth,user_id",
	"push_preferencias":      "user_id,tipo,ativo",
	"profiles":               "id,email,role,is_superadmin,features,permissions",
	"acessos_pessoas":        "id,nome,profile_id,email_corporativo",
	"frota_veiculos":         "id,nome,pessoa_id,situacao",
	"frota_checklist_itens":  "cadencia,ordem,ativo",
	"frota_checklist_config": "dia_semanal,semana_mensal,dia_mensal",
	"frota_checklist":        "veiculo_id,feita_em,cadencias",
	"frota_uso":              "veiculo_id,pessoa_id,tipo,volta_em",
	"frota_requisicoes":      "id,veiculo_id,situacao,retirada_prevista,destino,motivo_decisao,encerrada_motivo,pessoa_id,pessoa_nome,criada_por",
	"conteudo_pecas":         "id,account_id,titulo,formato,status,legenda,hashtags,publicar_em,publicado_em,avisado_em,ig_media_id,ig_permalink,responsavel",
	"conteudo_eventos":       "peca_id,acao,detalhe",
	"conteudo_casamentos":    "peca_id,ig_media_id,ig_permalink,ig_timestamp,ig_caption,ig_thumb,pontuacao,situacao,motivo",
	"conteudo_metricas":      "peca_id,capturado_em,curtidas,comentarios,alcance,salvamentos,compartilhamentos,visualizacoes,bruto",
	"checkout_abandono":      "token,status",
	"contatos_sem_mensagem":  "telefone",
	"vessel_rd_envios":       "id,origem_id,pessoa_id,status,tentativas,http_status,resposta,atualizado_em",
	"vessel_pessoas":         "id,email",
	"fabrica_campanhas":      "id,created_at,fechada_em,purgado_em",
	"fabrica_criativos":      "campanha_id,storage_path,purgado_em",
	"robos_execucoes":        "robo,disparado_em,status_code,ok,resposta,conferido_em",
}

// unicosDoWorker: os alvos de ON CONFLICT (sem o índice único o Postgres recusa o upsert).
var unicosDoWorker = []string{
	"daily_snapshots(account_id,captured_at)", "engagement_snapshots(account_id,captured_at,period_days)",
	"content_snapshots(account_id,captured_at,period_days)", "campaigns(campaign_id)", "ads(ad_id)", "campaign_adsets(adset_id)",
	"campaign_insights(campaign_id,account_id,captured_at,period_days)", "campaign_insights_hora(campaign_id,account_id,dia,hora)",
	"perfil_visitas_hora(account_id,dia,hora)", "ad_insights_hora(ad_id,account_id,dia,hora)",
	"conteudo_casamentos(peca_id,ig_media_id)", "conteudo_metricas(peca_id,capturado_em)",
}

// funcoesDoWorker: as funções SQL de produção que o worker chama (assinatura de to_regprocedure).
var funcoesDoWorker = []string{
	"mover_abandonados_para_fila(integer,integer)", "pegar_para_mensagem(integer,integer,boolean,text[],integer)",
	"pegar_da_fila(text,integer,integer,boolean,text[])", "marcar_mensagem(text,text,text,bigint)",
	"marcar_da_fila(text,text,text,text,bigint)", "devolver_mensagem(text,boolean)", "devolver_da_fila(text,text,boolean)",
	"liberar_mensagens_travadas()", "liberar_travadas_da_fila()", "agendar_followups(integer,integer)",
	"avaliar_trava_cruzada(text,integer,text,text)", "conteudo_reivindicar_hora_h()", "vessel_rd_payload(bigint)",
}

// conferirSchema devolve as premissas quebradas, em ordem (vazio = tudo certo).
func conferirSchema(ctx context.Context, p *pgxpool.Pool) ([]string, error) {
	var faltam []string
	for tabela, cols := range colunasDoWorker {
		var existentes []string
		linhas, err := p.Query(ctx, `select column_name::text from information_schema.columns
			where table_schema = current_schema() and table_name = $1::text`, tabela)
		if err != nil {
			return nil, err
		}
		for linhas.Next() {
			var c string
			if err := linhas.Scan(&c); err != nil {
				linhas.Close()
				return nil, err
			}
			existentes = append(existentes, c)
		}
		linhas.Close()
		for _, c := range strings.Split(cols, ",") {
			if !slices.Contains(existentes, c) {
				faltam = append(faltam, "coluna "+tabela+"."+c)
			}
		}
	}
	for _, u := range unicosDoWorker {
		tabela, cols, _ := strings.Cut(strings.TrimSuffix(u, ")"), "(")
		quer := strings.Split(cols, ",")
		sort.Strings(quer)
		var tem bool
		if err := p.QueryRow(ctx, `select exists (
			select 1 from pg_index x join pg_class t on t.oid = x.indrelid
			 where t.relname = $1::text and t.relnamespace = current_schema()::regnamespace and x.indisunique
				   and x.indpred is null and x.indexprs is null -- ON CONFLICT (colunas) não infere índice parcial nem de expressão
			   and (select array_agg(a.attname::text order by a.attname) from unnest(x.indkey) k
			          join pg_attribute a on a.attrelid = t.oid and a.attnum = k) = $2::text[])`, tabela, quer).Scan(&tem); err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "único "+u)
		}
	}
	for _, f := range funcoesDoWorker {
		var tem bool
		if err := p.QueryRow(ctx, `select to_regprocedure(current_schema() || '.' || $1::text) is not null`, f).Scan(&tem); err != nil {
			return nil, err
		}
		if !tem {
			faltam = append(faltam, "função "+f)
		}
	}
	sort.Strings(faltam)
	return faltam, nil
}
