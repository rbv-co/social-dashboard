package meta

import (
	"bytes"
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/texto"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

// ZAPI manda texto pela Z-API. O token da INSTÂNCIA vai no caminho da URL: nenhum erro devolvido
// aqui contém a URL.
type ZAPI struct {
	InstanceID, InstanceToken, ClientToken string // ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN, ZAPI_TOKEN
	URL                                    string // vazio = https://api.z-api.io (o teste troca)
	HTTP                                   *http.Client
}

func (z *ZAPI) configurada() bool {
	return z != nil && z.InstanceID != "" && z.InstanceToken != "" && z.ClientToken != ""
}

// Enviar manda `mensagem` a `telefone` (um grupo é "<id>-group"). ambiguo=true: a mensagem PODE ter saído
// (sem resposta por prazo, queda ou conexão recusada; ou resposta 502/504 de gateway) — quem chama não repete.
func (z *ZAPI) Enviar(ctx context.Context, telefone, mensagem string) (ambiguo bool, err error) {
	base := z.URL
	if base == "" {
		base = "https://api.z-api.io"
	}
	corpo, _ := json.Marshal(map[string]string{"phone": telefone, "message": mensagem})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		base+"/instances/"+url.PathEscape(z.InstanceID)+"/token/"+url.PathEscape(z.InstanceToken)+"/send-text", bytes.NewReader(corpo))
	if err != nil {
		return false, errors.New("Z-API: pedido inválido")
	}
	req.Header.Set("Client-Token", z.ClientToken)
	req.Header.Set("Content-Type", "application/json")
	cli := &http.Client{Timeout: 20 * time.Second}
	if z.HTTP != nil {
		c := *z.HTTP
		cli = &c
	}
	// Nunca segue redirecionamento: o pedido levaria o Client-Token (e o Referer, com o token da instância no
	// caminho) a outro endereço, e a página 200 do destino contaria como enviada. 3xx é recusa clara.
	cli.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	r, err := cli.Do(req)
	if err != nil {
		var ue *url.Error
		if errors.As(err, &ue) {
			err = ue.Err
		}
		// Sem resposta (prazo, queda, conexão recusada): ambíguo. "Conexão recusada" provadamente não enviou
		// nada, mas fica reservada do mesmo jeito (aceito: nunca duplica; a próxima hora usa outra chave).
		return true, fmt.Errorf("Z-API send-text: %w", err)
	}
	defer r.Body.Close()
	b, _ := io.ReadAll(io.LimitReader(r.Body, 4<<10))
	if r.StatusCode < 200 || r.StatusCode > 299 {
		// Um serviço que ecoa o pedido na recusa devolveria o caminho (token da instância) e o Client-Token.
		corpo := strings.NewReplacer(z.InstanceToken, "***", z.ClientToken, "***", z.InstanceID, "***").Replace(string(b))
		// 502/504: o gateway pode ter repassado a mensagem antes de falhar. Fica reservada (mensagem a cliente
		// não é push). Qualquer outro não-2xx é recusa clara.
		ambiguo := r.StatusCode == http.StatusBadGateway || r.StatusCode == http.StatusGatewayTimeout
		return ambiguo, fmt.Errorf("Z-API send-text: %d %s", r.StatusCode, texto.CortarUTF16(corpo, 200))
	}
	return false, nil
}

// RelatorioHora porta supabase/functions/enviar-relatorio-hora (pg_cron 10 * * * *): manda ao grupo de
// WhatsApp, em DUAS mensagens, os relatórios da hora (Mensagem WPP e Seguidores, a MESMA regra da tela
// em relatorio-por-hora.js), só da conta Vessel. Sem dado: um aviso curto, nunca silêncio.
type RelatorioHora struct {
	Pool  *pgxpool.Pool
	ZAPI  *ZAPI
	Agora func() time.Time // nil = time.Now
}

// Os mesmos recortes fixos da edge (e da tela): a conta Vessel e o "Grupo de teste z-api".
const (
	contaVessel   = "b6883e82-07cb-4f21-9fd7-ea7626786174"
	grupoWhatsApp = "120363431546698175-group"
)

func (rh *RelatorioHora) Tarefa() worker.Tarefa {
	return worker.Tarefa{Nome: "enviar-relatorio-hora", Agenda: "10 * * * *", Limite: 2 * time.Minute, Executar: rh.Rodar}
}

type campanhaDaHora struct {
	id, nome, tipo       string
	gastoHora, gastoAcum float64
	conversasHora        int64
}

type horaDoDia struct {
	hora      int
	campanhas []campanhaDaHora
}

type leituraSeg struct {
	total int64
	lido  time.Time
	hora  bool // origem = 'hora'
}

type deltaSeg struct {
	dia   string
	hora  int
	delta *int64
	total int64
}

func custoPorLead(gasto float64, n float64) *float64 {
	if n == 0 {
		return nil
	}
	c := gasto / n
	return &c
}

func comSinal(n int64) string {
	if n > 0 {
		return fmt.Sprintf("+%d", n)
	}
	return fmt.Sprint(n)
}

func cabecalho(titulo, dia string, hora int) string {
	return fmt.Sprintf("📊 %s — %02dh, %s/%s", titulo, hora, dia[8:10], dia[5:7])
}

// montarMensagemWpp (relatorio-por-hora.js): só campanhas [CAMPANHA WPP]; "" quando não há nenhuma.
func montarMensagemWpp(dia string, hora int, campanhas []campanhaDaHora, leadsHoje int64, gastoHoje float64) string {
	var wpp []campanhaDaHora
	for _, c := range campanhas {
		if c.tipo == "wpp" {
			wpp = append(wpp, c)
		}
	}
	if len(wpp) == 0 {
		return ""
	}
	var leads int64
	var gasto float64
	for _, c := range wpp {
		leads += c.conversasHora
		gasto += c.gastoHora
	}
	linhas := []string{cabecalho("Leads recebidos", dia, hora), "", "INTERVALO", fmt.Sprintf("Leads no período: %d", leads)}
	if cpl := custoPorLead(gasto, float64(leads)); cpl != nil {
		linhas = append(linhas, "Custo por lead: "+texto.Reais(*cpl))
	}
	linhas = append(linhas, "Gasto no período: "+texto.Reais(gasto), "", "TOTAL DESDOBRADO")
	for _, c := range wpp {
		plural := "s"
		if c.conversasHora == 1 {
			plural = ""
		}
		linhas = append(linhas, fmt.Sprintf("%s — %d lead%s · Gasto Dia: %s", c.nome, c.conversasHora, plural, texto.Reais(c.gastoAcum)))
	}
	linhas = append(linhas, "", fmt.Sprintf("Total de leads no dia: %d", leadsHoje), "Total de gasto no dia: "+texto.Reais(gastoHoje))
	return strings.Join(linhas, "\n")
}

// somaDoTipo soma a hora primeiro e depois as horas, como a edge (gastoWppNoDia/gastoSeguidoresNoDia): somar
// campanha por campanha direto no total do dia inverte um centavo por ordem de soma em ponto flutuante.
func somaDoTipo(horas []horaDoDia, tipo string, f func(campanhaDaHora) float64) float64 {
	s := 0.0
	for _, h := range horas {
		sh := 0.0
		for _, c := range h.campanhas {
			if c.tipo == tipo {
				sh += f(c)
			}
		}
		s += sh
	}
	return s
}

// montarMensagemSeguidores (relatorio-por-hora.js): INTERVALO (resultado da hora) e TOTAL (do dia e da
// conta); cada linha só entra com o próprio valor; "" quando não há nada em nenhuma das partes.
func montarMensagemSeguidores(dia string, hora int, seguidoresDelta, visitasDelta, seguidoresTotal, seguidoresHoje *int64,
	gastoSeguidores, gastoSeguidoresHoje float64, visitasHoje int64) string {
	if seguidoresTotal == nil && seguidoresHoje == nil && visitasDelta == nil {
		return ""
	}
	var periodo, totais []string
	if seguidoresDelta != nil {
		periodo = append(periodo, "Novos seguidores no período: "+comSinal(*seguidoresDelta))
	}
	if visitasDelta != nil {
		periodo = append(periodo, fmt.Sprintf("Visitas ao perfil da conta: %d", *visitasDelta))
	}
	if gastoSeguidores > 0 {
		if visitasDelta != nil {
			if c := custoPorLead(gastoSeguidores, float64(*visitasDelta)); c != nil {
				periodo = append(periodo, "Custo por visita ao perfil: "+texto.Reais(*c))
			}
		}
		if seguidoresDelta != nil && *seguidoresDelta > 0 {
			periodo = append(periodo, "Custo por seguidor: "+texto.Reais(gastoSeguidores/float64(*seguidoresDelta)))
		}
		periodo = append(periodo, "Investimento: "+texto.Reais(gastoSeguidores))
	}
	if seguidoresTotal != nil {
		totais = append(totais, "Total seguidores da conta: "+texto.Milhar(*seguidoresTotal))
	}
	if seguidoresHoje != nil {
		totais = append(totais, "Total seguidores do dia: "+comSinal(*seguidoresHoje))
	}
	totais = append(totais, fmt.Sprintf("Total visitantes dia: %d", visitasHoje))
	if gastoSeguidoresHoje > 0 {
		if seguidoresHoje != nil && *seguidoresHoje > 0 {
			totais = append(totais, "Custo de seguidores dia: "+texto.Reais(gastoSeguidoresHoje/float64(*seguidoresHoje)))
		}
		if visitasHoje > 0 {
			totais = append(totais, "Custo visitantes dia: "+texto.Reais(gastoSeguidoresHoje/float64(visitasHoje)))
		}
		totais = append(totais, "Investimento no dia: "+texto.Reais(gastoSeguidoresHoje))
	}
	corpo := []string{cabecalho("Seguidores e visitas ao perfil", dia, hora), ""}
	if len(periodo) > 0 {
		corpo = append(append(corpo, "INTERVALO"), periodo...)
	}
	if len(periodo) > 0 && len(totais) > 0 {
		corpo = append(corpo, "")
	}
	if len(totais) > 0 {
		corpo = append(append(corpo, "TOTAL"), totais...)
	}
	return strings.Join(corpo, "\n")
}

// deltaDeSeguidoresPorHora (relatorio-por-hora.js): uma leitura por balde dia+hora de São Paulo (a de
// origem 'hora' vence; entre iguais, a mais recente) e o delta contra o balde anterior (atravessa a
// meia-noite: seguidor é estoque). A primeira da série tem total e não tem delta.
func deltaDeSeguidoresPorHora(ls []leituraSeg) []deltaSeg {
	type balde struct {
		dia  string
		hora int
		l    leituraSeg
	}
	porBalde := map[string]*balde{}
	var ordem []*balde
	for _, l := range ls {
		t := l.lido.In(saoPaulo)
		chave := t.Format("2006-01-02|15")
		atual, tem := porBalde[chave]
		switch {
		case !tem:
			b := &balde{t.Format("2006-01-02"), t.Hour(), l}
			porBalde[chave] = b
			ordem = append(ordem, b)
		case l.hora && !atual.l.hora, l.hora == atual.l.hora && l.lido.After(atual.l.lido):
			atual.l = l
		}
	}
	slices.SortStableFunc(ordem, func(a, b *balde) int { return a.l.lido.Compare(b.l.lido) })
	out := make([]deltaSeg, len(ordem))
	for i, b := range ordem {
		out[i] = deltaSeg{dia: b.dia, hora: b.hora, total: b.l.total}
		if i > 0 {
			d := b.l.total - ordem[i-1].l.total
			out[i].delta = &d
		}
	}
	return out
}

func (rh *RelatorioHora) Rodar(ctx context.Context) error {
	if !rh.ZAPI.configurada() {
		return errors.New("zapi_nao_configurada: ZAPI_INSTANCE_ID, ZAPI_INSTANCE_TOKEN e ZAPI_TOKEN são obrigatórios")
	}
	agora := time.Now
	if rh.Agora != nil {
		agora = rh.Agora
	}
	t := agora().In(saoPaulo)
	dia, hora := t.Format("2006-01-02"), t.Hour()

	horas, err := rh.lerCampanhas(ctx, dia)
	if err != nil {
		return rh.semDados(ctx, dia, hora, "não consegui ler os dados de campanha", err)
	}
	leituras, err := rh.lerSeguidores(ctx, t)
	if err != nil {
		return rh.semDados(ctx, dia, hora, "não consegui ler os dados de seguidores", err)
	}
	visitas := map[int]int64{}
	var visitasHoje int64
	linhas, err := rh.Pool.Query(ctx, `select hora, coalesce(visitas_hora, 0) from perfil_visitas_hora where account_id = $1::uuid and dia = $2::date`, contaVessel, dia)
	if err == nil {
		var h int
		var v int64
		_, err = pgx.ForEachRow(linhas, []any{&h, &v}, func() error { visitas[h] = v; visitasHoje += v; return nil })
	}
	if err != nil {
		return rh.semDados(ctx, dia, hora, "não consegui ler os dados de visita ao perfil", err)
	}

	var daHora []campanhaDaHora
	for _, h := range horas {
		if h.hora == hora {
			daHora = h.campanhas
		}
	}
	leadsHoje := int64(somaDoTipo(horas, "wpp", func(c campanhaDaHora) float64 { return float64(c.conversasHora) }))
	gastoWppHoje := somaDoTipo(horas, "wpp", func(c campanhaDaHora) float64 { return c.gastoHora })
	deltas := deltaDeSeguidoresPorHora(leituras)
	var segDelta, segTotal, segHoje *int64
	var somaHoje int64
	temHoje := false
	for _, d := range deltas {
		if d.dia == dia && d.hora == hora {
			segDelta, segTotal = d.delta, &d.total
		}
		if d.dia == dia {
			temHoje = true
			if d.delta != nil {
				somaHoje += *d.delta
			}
		}
	}
	if temHoje {
		segHoje = &somaHoje
	}
	var visitasDelta *int64
	if v, tem := visitas[hora]; tem {
		visitasDelta = &v
	}
	gastoSeg := 0.0
	for _, c := range daHora {
		if c.tipo == "seguidores" {
			gastoSeg += c.gastoHora
		}
	}
	gastoSegHoje := somaDoTipo(horas, "seguidores", func(c campanhaDaHora) float64 { return c.gastoHora })
	mensagens := []struct{ nome, texto string }{
		{"wpp", montarMensagemWpp(dia, hora, daHora, leadsHoje, gastoWppHoje)},
		{"seguidores", montarMensagemSeguidores(dia, hora, segDelta, visitasDelta, segTotal, segHoje, gastoSeg, gastoSegHoje, visitasHoje)},
	}
	// As DUAS, separadas e nesta ordem; uma falhando não impede a outra.
	enviadas := 0
	var falhas []string
	for _, m := range mensagens {
		if m.texto == "" {
			continue
		}
		if err := rh.enviar(ctx, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:%s", dia, hora, m.nome), m.texto); err != nil {
			falhas = append(falhas, m.nome+": "+err.Error())
			continue
		}
		enviadas++
	}
	if enviadas == 0 && len(falhas) == 0 {
		if err := rh.enviar(ctx, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:aviso", dia, hora), aviso(dia, hora, "sem dado disponível pra essa hora")); err != nil {
			falhas = append(falhas, "aviso: "+err.Error())
		}
	}
	if len(falhas) > 0 {
		return errors.New(strings.Join(falhas, " · "))
	}
	slog.Info("enviar-relatorio-hora", "dia", dia, "hora", hora, "enviadas", enviadas)
	return nil
}

func aviso(dia string, hora int, motivo string) string {
	return fmt.Sprintf("⚠️ Relatório das %02dh, %s/%s não saiu — %s.", hora, dia[8:10], dia[5:7], motivo)
}

// semDados: leitura do banco falhou. Avisa o grupo (melhor um aviso curto que silêncio) e a tarefa
// termina com ERRO (a edge respondia 200 aqui, e a saúde dos robôs ficava verde).
func (rh *RelatorioHora) semDados(ctx context.Context, dia string, hora int, motivo string, causa error) error {
	// O prazo da tarefa pode ter acabado justamente na leitura que falhou: o aviso tem contexto próprio e curto.
	ctx, cancela := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancela()
	if err := rh.enviar(ctx, fmt.Sprintf("enviar-relatorio-hora:%s:%02d:aviso", dia, hora), aviso(dia, hora, motivo)); err != nil {
		return fmt.Errorf("%s: %w (e o aviso falhou: %v)", motivo, causa, err)
	}
	return fmt.Errorf("%s: %w", motivo, causa)
}

// enviar reserva a mensagem no livro de envios ANTES de mandar: rodar de novo na mesma hora não repete
// o que já saiu (conta como enviada). Recusa da Z-API desfaz a reserva; envio ambíguo, não.
func (rh *RelatorioHora) enviar(ctx context.Context, chave, msg string) error {
	ok, err := banco.ReservarEnvio(ctx, rh.Pool, chave)
	if err != nil || !ok {
		return err
	}
	ambiguo, err := rh.ZAPI.Enviar(ctx, grupoWhatsApp, msg)
	if err != nil && !ambiguo {
		c, cancela := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancela()
		if e := banco.LiberarEnvio(c, rh.Pool, chave); e != nil {
			return errors.Join(err, e)
		}
	}
	return err
}

// lerCampanhas: campaign_insights_hora da conta no DIA inteiro (o total do dia soma as horas),
// agrupado por hora (crescente) e, na hora, por gasto (maior primeiro), como agruparPorDiaEHora. O desempate
// por campaign_id é escolha deliberada e determinística (a edge lia sem ORDER BY): só muda a ordem de linhas
// de gasto igual, que não altera nenhuma soma nem texto.
func (rh *RelatorioHora) lerCampanhas(ctx context.Context, dia string) ([]horaDoDia, error) {
	linhas, err := rh.Pool.Query(ctx, `select h.hora, h.campaign_id, coalesce(nullif(c.name, ''), h.campaign_id), coalesce(h.gasto_hora, 0)::float8,
			coalesce(h.gasto_acumulado, 0)::float8, coalesce(h.conversas_hora, 0)
		  from campaign_insights_hora h left join campaigns c on c.campaign_id = h.campaign_id
		 where h.account_id = $1::uuid and h.dia = $2::date order by h.hora, h.campaign_id`, contaVessel, dia)
	if err != nil {
		return nil, err
	}
	porHora := map[int]*horaDoDia{}
	var horas []*horaDoDia
	var hr int
	var c campanhaDaHora
	if _, err := pgx.ForEachRow(linhas, []any{&hr, &c.id, &c.nome, &c.gastoHora, &c.gastoAcum, &c.conversasHora}, func() error {
		c.tipo = tipoDaCampanha(c.nome)
		h := porHora[hr]
		if h == nil {
			h = &horaDoDia{hora: hr}
			porHora[hr] = h
			horas = append(horas, h)
		}
		h.campanhas = append(h.campanhas, c)
		return nil
	}); err != nil {
		return nil, err
	}
	out := make([]horaDoDia, len(horas))
	for i, h := range horas {
		slices.SortStableFunc(h.campanhas, func(a, b campanhaDaHora) int { return cmp.Compare(b.gastoHora, a.gastoHora) })
		out[i] = *h
	}
	return out, nil
}

// lerSeguidores: as leituras da conta nas últimas 25 h (o delta atravessa a virada do dia).
func (rh *RelatorioHora) lerSeguidores(ctx context.Context, agora time.Time) ([]leituraSeg, error) {
	linhas, err := rh.Pool.Query(ctx, `select followers_count, lido_em, coalesce(origem, '') = 'hora' from followers_leituras
		where account_id = $1::uuid and lido_em >= $2::timestamptz order by lido_em`, contaVessel, agora.Add(-25*time.Hour))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(linhas, func(r pgx.CollectableRow) (l leituraSeg, err error) { return l, r.Scan(&l.total, &l.lido, &l.hora) })
}
