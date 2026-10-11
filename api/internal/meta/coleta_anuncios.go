package meta

import (
	"context"
	"fmt"
	"log/slog"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
)

// anuncios é a parte de anúncios de coletar-dados: campanhas, anúncios (com o link de destino),
// conjuntos e os insights por campanha (5 recortes + o gasto de cada um dos 7 dias anteriores como
// period_days 0: a Meta re-atribui gasto por 1-2 dias). Erro da META segue o que a edge fazia (pula,
// ou vira degradado nos anúncios); erro do BANCO aborta a conta (linha ok=false em robos_execucoes).
func (c *ColetaDiaria) anuncios(ctx context.Context, conta contaColeta, hoje string, deg *degradados) error {
	act := "/act_" + conta.ad
	if itens, err := Paginas(ctx, c.Core, act+"/campaigns", obj{"fields": "id,name,objective,status", "limit": "500"}, maxPaginas, true); err == nil {
		err := pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
			for _, x := range itens {
				m, _ := x.(obj)
				if _, err := tx.Exec(ctx, `insert into campaigns (campaign_id, account_id, name, objective, status, synced_at)
					values ($1::text, $2::uuid, $3::text, $4::text, $5::text, $6::date)
					on conflict (campaign_id) do update set account_id = excluded.account_id, name = excluded.name,
					  objective = excluded.objective, status = excluded.status, synced_at = excluded.synced_at`,
					textoDe(m["id"]), conta.id, textoOuVazio(m["name"]), textoOuVazio(m["objective"]), textoOuVazio(m["status"]), hoje); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	} else {
		slog.Warn("coletar-dados: campanhas", "conta", conta.nome, "erro", err) // sem anúncio na conta: segue
	}

	// Página de 100: com o campo aninhado do criativo a Meta recusa 500 por página (medido em 18/09/2026).
	if itens, err := Paginas(ctx, c.Core, act+"/ads", obj{"fields": "id,name,campaign_id,status,creative{object_story_spec,asset_feed_spec,object_url}", "limit": "100"}, maxPaginas, true); err != nil {
		deg.graph = append(deg.graph, fmt.Sprintf("ads (%s): %s", conta.id, err.Error()))
	} else {
		err := pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
			for _, x := range itens {
				m, _ := x.(obj)
				criativo, _ := m["creative"].(obj)
				if _, err := tx.Exec(ctx, `insert into ads (ad_id, campaign_id, account_id, name, status, destino_link, synced_at)
					values ($1::text, $2::text, $3::uuid, $4::text, $5::text, $6::text, $7::date)
					on conflict (ad_id) do update set campaign_id = excluded.campaign_id, account_id = excluded.account_id, name = excluded.name,
					  status = excluded.status, destino_link = excluded.destino_link, synced_at = excluded.synced_at`,
					textoDe(m["id"]), textoDe(m["campaign_id"]), conta.id, textoOuVazio(m["name"]), textoOuVazio(m["status"]), linkDoCriativo(criativo), hoje); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	// O sinal do conjunto (destination_type, optimization_goal) decide o balde da campanha no painel.
	if itens, err := Paginas(ctx, c.Core, act+"/adsets", obj{"fields": "id,campaign_id,destination_type,optimization_goal", "limit": "500"}, maxPaginas, true); err != nil {
		slog.Warn("coletar-dados: conjuntos FALHOU", "conta", conta.nome, "erro", err)
	} else {
		err := pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
			for _, x := range itens {
				m, _ := x.(obj)
				campanha := textoOuVazio(m["campaign_id"])
				if campanha == "" {
					continue
				}
				if _, err := tx.Exec(ctx, `insert into campaign_adsets (adset_id, campaign_id, account_id, destination_type, optimization_goal, synced_at)
					values ($1::text, $2::text, $3::uuid, $4::text, $5::text, $6::date)
					on conflict (adset_id) do update set campaign_id = excluded.campaign_id, account_id = excluded.account_id,
					  destination_type = excluded.destination_type, optimization_goal = excluded.optimization_goal, synced_at = excluded.synced_at`,
					textoDe(m["id"]), campanha, conta.id, textoOuNulo(m["destination_type"]), textoOuNulo(m["optimization_goal"]), hoje); err != nil {
					return err
				}
			}
			return nil
		})
		if err != nil {
			return err
		}
	}

	// Erro da META numa janela: a edge pulava em silêncio; aqui vira UM recado por conta (degradado), com a
	// 1ª causa, e as outras janelas seguem. Erro do BANCO aborta a conta.
	janelas, falhas := 0, 0
	var primeiraFalha error
	coletar := func(de, ate, capturado string, dias int) error {
		janelas++
		erroMeta, err := c.insightsDeCampanha(ctx, conta, act, de, ate, capturado, dias)
		if erroMeta != nil {
			falhas++
			if primeiraFalha == nil {
				primeiraFalha = erroMeta
			}
		}
		return err
	}
	for _, dias := range periodos {
		de, ate := janelaDeAds(hoje, dias)
		if err := coletar(de, ate, hoje, dias); err != nil {
			return err
		}
	}
	for dd := 1; dd <= 7; dd++ { // o pd=0 de ontem até 7 dias atrás, pela atribuição tardia da Meta
		dia := menosDias(hoje, dd)
		if err := coletar(dia, dia, dia, 0); err != nil {
			return err
		}
	}
	if falhas > 0 {
		slog.Warn("coletar-dados: insights de campanha", "conta", conta.nome, "falhas", falhas, "janelas", janelas, "erro", primeiraFalha)
		deg.graph = append(deg.graph, fmt.Sprintf("%s: %d de %d janelas de insights de campanha falharam (%s)", conta.nome, falhas, janelas, primeiraFalha))
	}
	return nil
}

// janelaDeAds (janela-de-ads.js): 0 = o próprio dia; N = os últimos N dias COMPLETOS (até ontem).
func janelaDeAds(hoje string, dias int) (string, string) {
	if dias == 0 {
		return hoje, hoje
	}
	return menosDias(hoje, dias), menosDias(hoje, 1)
}

// insightsDeCampanha grava uma janela. Devolve (erro da Meta, erro do banco): só o segundo aborta a conta.
func (c *ColetaDiaria) insightsDeCampanha(ctx context.Context, conta contaColeta, act, de, ate, capturado string, dias int) (erroMeta, erroBanco error) {
	itens, err := Paginas(ctx, c.Core, act+"/insights", obj{"fields": "campaign_id,spend,impressions,clicks,reach,actions",
		"time_range": fmt.Sprintf(`{"since":"%s","until":"%s"}`, de, ate), "level": "campaign", "limit": "500"}, maxPaginas, true)
	if err != nil {
		return err, nil
	}
	return nil, pgx.BeginFunc(ctx, c.Pool, func(tx pgx.Tx) error {
		for _, x := range itens {
			r, _ := x.(obj)
			acoes, _ := r["actions"].([]any)
			ct := contagensDaCampanha(acoes)
			if _, err := tx.Exec(ctx, `insert into campaign_insights (campaign_id, account_id, captured_at, period_days, spend, impressions, clicks, reach,
					post_engagement, likes, comments, shares, saves, conversas, cadastros, compras, visitas)
				values ($1::text, $2::uuid, $3::date, $4::int, $5::numeric, $6::bigint, $7::bigint, $8::bigint, $9::int, $10::int, $11::int,
					$12::int, $13::int, $14::int, $15::int, $16::int, $17::int)
				on conflict (campaign_id, account_id, captured_at, period_days) do update set spend = excluded.spend,
				  impressions = excluded.impressions, clicks = excluded.clicks, reach = excluded.reach, post_engagement = excluded.post_engagement,
				  likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, saves = excluded.saves,
				  conversas = excluded.conversas, cadastros = excluded.cadastros, compras = excluded.compras, visitas = excluded.visitas`,
				textoDe(r["campaign_id"]), conta.id, capturado, dias, floatJS(r["spend"]), inteiroJS(r["impressions"]), inteiroJS(r["clicks"]),
				inteiroJS(r["reach"]), acao(acoes, "post_engagement"), acao(acoes, "post_reaction", "like"), acao(acoes, "comment"),
				acao(acoes, "post", "share"), acao(acoes, "onsite_conversion.post_save", "post_save"),
				ct["conversas"], ct["cadastros"], ct["compras"], ct["visitas"]); err != nil {
				return err
			}
		}
		return nil
	})
}

func textoOuVazio(v any) string {
	if v == nil {
		return ""
	}
	return textoDe(v)
}

func textoOuNulo(v any) *string {
	if v == nil {
		return nil
	}
	s := textoDe(v)
	return &s
}

var reInteiroJS = regexp.MustCompile(`^[\t\n\v\f\r \x{00a0}\x{feff}]*([+-]?\d+)`)

// inteiroJS = parseInt(v ?? '0') do JS: o inteiro do começo do texto; sem número = nulo (NaN vira null).
func inteiroJS(v any) *int64 {
	s := "0"
	if v != nil {
		s = textoDe(v)
	}
	m := reInteiroJS.FindStringSubmatch(s)
	if m == nil {
		return nil
	}
	n, err := strconv.ParseInt(m[1], 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

// floatJS = parseFloat(v ?? '0'): o número do começo do texto; sem número = nulo.
func floatJS(v any) *float64 {
	s := "0"
	if v != nil {
		s = strings.TrimSpace(textoDe(v))
	}
	for fim := len(s); fim > 0; fim-- {
		if f, err := strconv.ParseFloat(s[:fim], 64); err == nil {
			return &f
		}
	}
	return nil
}

// acao (actVal de coletar-dados): o 1º tipo da lista que existir em `actions`; parseInt(...) || 0.
func acao(acoes []any, tipos ...string) int64 {
	for _, t := range tipos {
		for _, x := range acoes {
			a, _ := x.(obj)
			if a["action_type"] != t {
				continue
			}
			v := a["value"]
			if v == nil {
				v = "0"
			}
			if n := inteiroJS(v); n != nil {
				return *n
			}
			return 0
		}
	}
	return 0
}

// contagensDaCampanha (acoes-de-campanha.js): para na PRIMEIRA forma que existir (a Meta manda a
// mesma conversa com mais de um action_type; somar contaria duas vezes).
func contagensDaCampanha(acoes []any) map[string]int64 {
	tipos := map[string][]string{
		"conversas": {"onsite_conversion.total_messaging_connection", "onsite_conversion.messaging_conversation_started_7d"},
		"cadastros": {"lead", "onsite_conversion.lead_grouped"},
		"compras":   {"purchase", "omni_purchase"},
		"visitas":   {"landing_page_view"}, // visita é landing_page_view, não link_click
	}
	out := map[string]int64{}
	for chave, lista := range tipos {
		out[chave] = acao(acoes, lista...)
	}
	return out
}

// linkDoCriativo (delta-de-hora.js): o destino do anúncio nos 4 formatos reais; nulo sem link (ex.:
// clique para o WhatsApp).
func linkDoCriativo(cr obj) *string {
	if cr == nil {
		return nil
	}
	osp, _ := cr["object_story_spec"].(obj)
	if ld, _ := osp["link_data"].(obj); ld["link"] != nil && textoDe(ld["link"]) != "" {
		return textoOuNulo(ld["link"])
	}
	if vd, _ := osp["video_data"].(obj); vd != nil {
		cta, _ := vd["call_to_action"].(obj)
		val, _ := cta["value"].(obj)
		if val["link"] != nil && textoDe(val["link"]) != "" {
			return textoOuNulo(val["link"])
		}
	}
	afs, _ := cr["asset_feed_spec"].(obj)
	if urls, _ := afs["link_urls"].([]any); len(urls) > 0 {
		partes := make([]string, len(urls))
		for i, u := range urls {
			m, _ := u.(obj)
			partes[i] = textoOuVazio(m["website_url"]) // undefined vira "" no join do JS
		}
		s := strings.Join(partes, " | ")
		return &s
	}
	if cr["object_url"] != nil && textoDe(cr["object_url"]) != "" {
		return textoOuNulo(cr["object_url"])
	}
	return nil
}
