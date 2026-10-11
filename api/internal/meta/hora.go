package meta

import (
	"context"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/core"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// ColetaHora porta supabase/functions/coletar-dados-hora (jobs coletar-dados-hora e
// coletar-dados-hora-retentativa-00h; robôs 'meta-hora' e 'meta-hora-retentativa-00h'): por conta de
// anúncio, o gasto e as conversas DESTA hora (delta contra a última leitura do dia), seguidores da
// conta, visitas ao perfil e, nas campanhas "outro", gasto e clique por anúncio. A hora gravada é a
// hora de parede de São Paulo da rodada.
type ColetaHora struct {
	Pool  *pgxpool.Pool
	Core  *core.Cliente
	Agora func() time.Time // nil = time.Now
}

// Tarefas: a rodada de hora em hora (minuto 5) e a repescagem da hora 0 (00:30 em São Paulo). As
// duas gravam as mesmas linhas (upsert por dia+hora): dividem a trava.
func (ch *ColetaHora) Tarefas() []worker.Tarefa {
	return []worker.Tarefa{
		{Nome: "meta-hora", Agenda: "5 * * * *", Trava: "coletar-dados-hora", Limite: 10 * time.Minute, Executar: ch.Rodar},
		{Nome: "meta-hora-retentativa-00h", Agenda: "30 3 * * *", Trava: "coletar-dados-hora", Limite: 10 * time.Minute, Executar: ch.Rodar},
	}
}

// tipoDaCampanha (relatorio-por-hora.js): o prefixo EXATO do nome (maiúsculas importam).
func tipoDaCampanha(nome string) string {
	switch {
	case strings.HasPrefix(nome, "[CAMPANHA WPP]"):
		return "wpp"
	case strings.HasPrefix(nome, "[+ SEGUIDORES]"):
		return "seguidores"
	case strings.HasPrefix(nome, "[+ ENGAJAMENTO]"), strings.HasPrefix(nome, "[ENGAJAMENTO]"):
		return "engajamento"
	}
	return "outro"
}

func delta(atual, anterior float64) float64 { return max(0, atual-anterior) } // nunca negativo (a Meta corrige para baixo)

type contaHora struct{ id, nome, ad, ig string }

func (ch *ColetaHora) Rodar(ctx context.Context) error {
	agora := time.Now
	if ch.Agora != nil {
		agora = ch.Agora
	}
	t := agora().In(saoPaulo)
	dia, hora := t.Format("2006-01-02"), t.Hour()
	linhas, err := ch.Pool.Query(ctx, `select id::text, coalesce(name, ''), ad_account_id::text, coalesce(instagram_id::text, '')
		  from accounts where ad_account_id is not null order by name`)
	if err != nil {
		return err
	}
	contas, err := pgx.CollectRows(linhas, func(r pgx.CollectableRow) (c contaHora, err error) { return c, r.Scan(&c.id, &c.nome, &c.ad, &c.ig) })
	if err != nil {
		return err
	}
	var degradados []string
	campanhas := 0
	for _, c := range contas {
		campanhas += ch.campanhas(ctx, c, dia, hora, &degradados)
		ch.seguidores(ctx, c, &degradados)
		ch.visitas(ctx, c, dia, hora, agora(), &degradados)
		ch.anunciosOutro(ctx, c, dia, hora, &degradados)
	}
	// Havia conta e NADA foi coletado: erro (a edge devolvia 500 para a saúde enxergar). Na hora 0 isto
	// é o esperado às 00:05 (a Meta ainda não processou o dia); a repescagem das 00:30 cobre.
	if campanhas == 0 && len(contas) > 0 {
		return fmt.Errorf("nada coletado (dia %s, hora %d): %s", dia, hora, strings.Join(degradados, " · "))
	}
	// Coletou, mas alguma conta ou fonte falhou: o que deu certo já está gravado e a tarefa termina em
	// erro (a edge devolvia 200 com `degraded` dentro; aqui a falha é sempre visível em robos_execucoes).
	if len(degradados) > 0 {
		return fmt.Errorf("coletado com falhas (dia %s, hora %d): %s", dia, hora, strings.Join(degradados, " · "))
	}
	slog.Info("meta-hora", "dia", dia, "hora", hora, "contas", len(contas), "campanhas", campanhas)
	return nil
}

func timeRange(dia string) string { return fmt.Sprintf(`{"since":"%s","until":"%s"}`, dia, dia) }

// campanhas: o insight do dia (acumulado até agora) por campanha e o delta contra a última linha de
// HOJE antes desta hora (uma segunda rodada na mesma hora não se compara consigo mesma).
func (ch *ColetaHora) campanhas(ctx context.Context, c contaHora, dia string, hora int, degradados *[]string) int {
	itens, err := Paginas(ctx, ch.Core, "/act_"+c.ad+"/insights", obj{"fields": "campaign_id,spend,actions",
		"time_range": timeRange(dia), "level": "campaign"}, maxPaginas, false)
	if err != nil {
		*degradados = append(*degradados, c.nome+": "+err.Error())
		return 0
	}
	if len(itens) == 0 {
		return 0
	}
	type anterior struct{ gasto, conversas, cliques float64 }
	ant := map[string]anterior{}
	linhas, err := ch.Pool.Query(ctx, `select campaign_id, gasto_acumulado::float8, conversas_acumuladas::float8, cliques_acumulados::float8
		  from campaign_insights_hora where account_id = $1::uuid and dia = $2::date and hora < $3::int order by hora desc`, c.id, dia, hora)
	if err == nil {
		var id string
		var a anterior
		_, err = pgx.ForEachRow(linhas, []any{&id, &a.gasto, &a.conversas, &a.cliques}, func() error {
			if _, tem := ant[id]; !tem {
				ant[id] = a
			}
			return nil
		})
	}
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler leitura anterior ("+err.Error()+")")
		return 0
	}
	err = pgx.BeginFunc(ctx, ch.Pool, func(tx pgx.Tx) error {
		for _, x := range itens {
			r, _ := x.(obj)
			acoes, _ := r["actions"].([]any)
			id := textoDe(r["campaign_id"])
			gasto := gastoOuZero(r["spend"])
			conversas := float64(acao(acoes, "onsite_conversion.messaging_conversation_started_7d", "onsite_conversion.messaging_conversation_started"))
			// "cliques_*" por herança do schema: o conteúdo é visita ao perfil, que na prática cai no link_click.
			visitas := float64(acao(acoes, "profile_visits", "profile_views", "link_click"))
			a := ant[id]
			if _, err := tx.Exec(ctx, `insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_acumulado, conversas_acumuladas,
					cliques_acumulados, gasto_hora, conversas_hora, cliques_hora)
				values ($1::text, $2::uuid, $3::date, $4::int, $5::numeric, $6::int, $7::int, $8::numeric, $9::int, $10::int)
				on conflict (campaign_id, account_id, dia, hora) do update set gasto_acumulado = excluded.gasto_acumulado,
				  conversas_acumuladas = excluded.conversas_acumuladas, cliques_acumulados = excluded.cliques_acumulados,
				  gasto_hora = excluded.gasto_hora, conversas_hora = excluded.conversas_hora, cliques_hora = excluded.cliques_hora`,
				id, c.id, dia, hora, gasto, conversas, visitas, delta(gasto, a.gasto), delta(conversas, a.conversas), delta(visitas, a.cliques)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar ("+err.Error()+")")
		return 0
	}
	return len(itens)
}

// seguidores: uma leitura da contagem por rodada (o delta hora a hora quem calcula é a tela).
func (ch *ColetaHora) seguidores(ctx context.Context, c contaHora, degradados *[]string) {
	if c.ig == "" {
		return
	}
	j, err := GET(ctx, ch.Core, "/"+c.ig, obj{"fields": "followers_count"})
	if err != nil {
		*degradados = append(*degradados, c.nome+": seguidores ("+err.Error()+")")
		return
	}
	if _, err := ch.Pool.Exec(ctx, `insert into followers_leituras (account_id, followers_count, origem) values ($1::uuid, $2::numeric, 'hora')`,
		c.id, numero(j["followers_count"])); err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar seguidores ("+err.Error()+")")
	}
}

// visitas: profile_views só existe como ACUMULADO DO DIA (period=hour não existe na Graph): delta
// contra a hora anterior da mesma conta, mesmo dia.
func (ch *ColetaHora) visitas(ctx context.Context, c contaHora, dia string, hora int, agora time.Time, degradados *[]string) {
	if c.ig == "" {
		return
	}
	j, err := GET(ctx, ch.Core, "/"+c.ig+"/insights", obj{"metric": "profile_views", "metric_type": "total_value", "period": "day",
		"since": strconv.FormatInt(inicioDoDia(dia), 10), "until": strconv.FormatInt(agora.Unix(), 10)})
	if err != nil {
		*degradados = append(*degradados, c.nome+": visitas ao perfil ("+err.Error()+")")
		return
	}
	tv, _ := primeiro(j)["total_value"].(obj)
	acumulado := numero(tv["value"])
	var anterior float64
	err = ch.Pool.QueryRow(ctx, `select coalesce((select visitas_acumuladas from perfil_visitas_hora
		where account_id = $1::uuid and dia = $2::date and hora < $3::int order by hora desc limit 1), 0)::float8`, c.id, dia, hora).Scan(&anterior)
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler visitas ao perfil anteriores ("+err.Error()+")")
		return
	}
	if _, err := ch.Pool.Exec(ctx, `insert into perfil_visitas_hora (account_id, dia, hora, visitas_acumuladas, visitas_hora)
		values ($1::uuid, $2::date, $3::int, $4::numeric, $5::numeric)
		on conflict (account_id, dia, hora) do update set visitas_acumuladas = excluded.visitas_acumuladas, visitas_hora = excluded.visitas_hora`,
		c.id, dia, hora, acumulado, delta(acumulado, anterior)); err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar visitas ao perfil ("+err.Error()+")")
	}
}

// anunciosOutro: gasto e clique no link POR ANÚNCIO, só nas campanhas "outro" (Sales/Leads por link).
func (ch *ColetaHora) anunciosOutro(ctx context.Context, c contaHora, dia string, hora int, degradados *[]string) {
	linhas, err := ch.Pool.Query(ctx, `select a.ad_id, a.campaign_id, coalesce(k.name, '') from ads a join campaigns k on k.campaign_id = a.campaign_id
		where a.account_id = $1::uuid and k.account_id = $1::uuid and a.destino_link is not null`, c.id)
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler catálogo de ads ("+err.Error()+")")
		return
	}
	escopo := map[string]bool{}
	var ad, campanha, nome string
	if _, err := pgx.ForEachRow(linhas, []any{&ad, &campanha, &nome}, func() error {
		if tipoDaCampanha(nome) == "outro" {
			escopo[ad] = true
		}
		return nil
	}); err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler catálogo de ads ("+err.Error()+")")
		return
	}
	if len(escopo) == 0 {
		return
	}
	itens, err := Paginas(ctx, ch.Core, "/act_"+c.ad+"/insights", obj{"fields": "ad_id,campaign_id,spend,actions",
		"time_range": timeRange(dia), "level": "ad"}, maxPaginas, false)
	if err != nil {
		*degradados = append(*degradados, c.nome+": ads outro ("+err.Error()+")")
		return
	}
	type anterior struct{ gasto, cliques float64 }
	ant := map[string]anterior{}
	linhas, err = ch.Pool.Query(ctx, `select ad_id, gasto_acumulado::float8, cliques_acumulados::float8 from ad_insights_hora
		where account_id = $1::uuid and dia = $2::date and hora < $3::int order by hora desc`, c.id, dia, hora)
	if err == nil {
		var id string
		var a anterior
		_, err = pgx.ForEachRow(linhas, []any{&id, &a.gasto, &a.cliques}, func() error {
			if _, tem := ant[id]; !tem {
				ant[id] = a
			}
			return nil
		})
	}
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao ler ad_insights_hora anterior ("+err.Error()+")")
		return
	}
	err = pgx.BeginFunc(ctx, ch.Pool, func(tx pgx.Tx) error {
		for _, x := range itens {
			r, _ := x.(obj)
			id := textoDe(r["ad_id"])
			if !escopo[id] {
				continue
			}
			acoes, _ := r["actions"].([]any)
			gasto := gastoOuZero(r["spend"])
			cliques := float64(acao(acoes, "link_click"))
			a := ant[id]
			if _, err := tx.Exec(ctx, `insert into ad_insights_hora (ad_id, campaign_id, account_id, dia, hora, gasto_acumulado, cliques_acumulados, gasto_hora, cliques_hora)
				values ($1::text, $2::text, $3::uuid, $4::date, $5::int, $6::numeric, $7::int, $8::numeric, $9::int)
				on conflict (ad_id, account_id, dia, hora) do update set campaign_id = excluded.campaign_id, gasto_acumulado = excluded.gasto_acumulado,
				  cliques_acumulados = excluded.cliques_acumulados, gasto_hora = excluded.gasto_hora, cliques_hora = excluded.cliques_hora`,
				id, textoDe(r["campaign_id"]), c.id, dia, hora, gasto, cliques, delta(gasto, a.gasto), delta(cliques, a.cliques)); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		*degradados = append(*degradados, c.nome+": falha ao gravar ad_insights_hora ("+err.Error()+")")
	}
}

// gastoOuZero = parseFloat(spend ?? '0'). Desvio deliberado da edge: com um spend sem número (NaN) a edge
// mandava null para uma coluna NOT NULL e o upsert INTEIRO da conta falhava; aqui o gasto vira 0 e o resto
// da conta é gravado.
func gastoOuZero(v any) float64 {
	if g := floatJS(v); g != nil {
		return *g
	}
	return 0
}
