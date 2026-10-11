package meta

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco"
	"github.com/rbv-co/social-dashboard/api/internal/worker"
)

const (
	zapiInstancia = "instancia-123"
	zapiToken     = "token-da-instancia-zapi-456"
	zapiCliente   = "client-token-zapi-789"
)

type zapiFalsa struct {
	mu        sync.Mutex
	mensagens []string
	caminhos  []string
	clientes  []string
	status    int           // 0 = 200
	derrubar  bool          // simula queda depois de receber (envio ambíguo)
	eco       bool          // a recusa devolve o caminho e o Client-Token recebidos (serviço que ecoa o pedido)
	atraso    time.Duration // responde depois disso (lentidão)
}

// atrasar faz a Z-API responder só depois de d.
func (z *zapiFalsa) atrasar(d time.Duration) {
	z.mu.Lock()
	defer z.mu.Unlock()
	z.atraso = d
}

// responder troca a resposta da Z-API (sob a trava: o servidor lê em outra goroutine).
func (z *zapiFalsa) responder(status int, derrubar bool) {
	z.mu.Lock()
	defer z.mu.Unlock()
	z.status, z.derrubar = status, derrubar
}

// lista: cópia das mensagens, caminhos e Client-Token recebidos.
func (z *zapiFalsa) lista() (mensagens, caminhos, clientes []string) {
	z.mu.Lock()
	defer z.mu.Unlock()
	return slices.Clone(z.mensagens), slices.Clone(z.caminhos), slices.Clone(z.clientes)
}

func ambienteRelatorio(t *testing.T) (*RelatorioHora, *zapiFalsa, *pgxpool.Pool) {
	t.Helper()
	p := testebanco.Novo(t)
	if _, err := p.Exec(context.Background(), tabelasColeta+tabelasAnuncios); err != nil {
		t.Fatal(err)
	}
	z := &zapiFalsa{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var corpo map[string]string
		b, _ := io.ReadAll(r.Body)
		json.Unmarshal(b, &corpo)
		z.mu.Lock()
		z.mensagens = append(z.mensagens, corpo["phone"]+"|"+corpo["message"])
		z.caminhos = append(z.caminhos, r.URL.Path)
		z.clientes = append(z.clientes, r.Header.Get("Client-Token"))
		st, derrubar, atraso, eco := z.status, z.derrubar, z.atraso, z.eco
		z.mu.Unlock()
		time.Sleep(atraso)
		if derrubar {
			c, _, _ := w.(http.Hijacker).Hijack()
			c.Close()
			return
		}
		if st != 0 {
			w.WriteHeader(st)
			if eco {
				io.WriteString(w, `{"error":"instance not connected","caminho":"`+r.URL.Path+`","client":"`+r.Header.Get("Client-Token")+`"}`)
				return
			}
			io.WriteString(w, `{"error":"instance not connected"}`)
			return
		}
		io.WriteString(w, `{"messageId":"1"}`)
	}))
	t.Cleanup(srv.Close)
	rh := &RelatorioHora{Pool: p, ZAPI: &ZAPI{InstanceID: zapiInstancia, InstanceToken: zapiToken, ClientToken: zapiCliente, URL: srv.URL},
		Agora: func() time.Time { return time.Date(2026, 10, 10, 17, 10, 0, 0, time.UTC) }} // 14:10 em São Paulo
	return rh, z, p
}

// dadosDoRelatorio: o mesmo cenário com que os textos esperados foram gerados pelo
// _shared/relatorio-por-hora.js (Node 22).
func dadosDoRelatorio(t *testing.T, p *pgxpool.Pool) {
	t.Helper()
	for _, sql := range []string{
		`insert into campaigns (campaign_id, name) values ('c-wpp', '[CAMPANHA WPP] Leads Vessel'), ('c-wpp2', '[CAMPANHA WPP] Remarketing'),
			('c-seg', '[+ SEGUIDORES] Perfil'), ('c-outro', 'AXIOM')`,
		`insert into campaign_insights_hora (campaign_id, account_id, dia, hora, gasto_hora, gasto_acumulado, conversas_hora) values
			('c-wpp', '` + contaDaEdge + `', '2026-10-10', 13, 12.5, 40.25, 3), ('c-wpp', '` + contaDaEdge + `', '2026-10-10', 14, 10, 50.25, 4),
			('c-wpp2', '` + contaDaEdge + `', '2026-10-10', 14, 5.333, 5.333, 1), ('c-seg', '` + contaDaEdge + `', '2026-10-10', 14, 7.2, 30, 0),
			('c-seg', '` + contaDaEdge + `', '2026-10-10', 13, 6, 22.8, 0), ('c-outro', '` + contaDaEdge + `', '2026-10-10', 14, 3, 3, 0)`,
		`insert into followers_leituras (account_id, followers_count, lido_em, origem) values
			('` + contaDaEdge + `', 24300, '2026-10-09T23:05:00Z', 'hora'), ('` + contaDaEdge + `', 24310, '2026-10-10T03:05:00Z', 'hora'),
			('` + contaDaEdge + `', 24311, '2026-10-10T16:05:00Z', 'hora'), ('` + contaDaEdge + `', 24330, '2026-10-10T17:05:00Z', 'hora'),
			('` + contaDaEdge + `', 24332, '2026-10-10T17:08:00Z', 'diario')`,
		`insert into perfil_visitas_hora (account_id, dia, hora, visitas_hora) values ('` + contaDaEdge + `', '2026-10-10', 13, 5),
			('` + contaDaEdge + `', '2026-10-10', 14, 8)`,
	} {
		if _, err := p.Exec(context.Background(), sql); err != nil {
			t.Fatal(err)
		}
	}
}

const (
	msgWpp = "📊 Leads recebidos — 14h, 10/10\n\nINTERVALO\nLeads no período: 5\nCusto por lead: R$\U000000a03,07\nGasto no período: R$\U000000a015,33\n\n" +
		"TOTAL DESDOBRADO\n[CAMPANHA WPP] Leads Vessel — 4 leads · Gasto Dia: R$\U000000a050,25\n[CAMPANHA WPP] Remarketing — 1 lead · Gasto Dia: R$\U000000a05,33\n\n" +
		"Total de leads no dia: 8\nTotal de gasto no dia: R$\U000000a027,83"
	msgSeguidores = "📊 Seguidores e visitas ao perfil — 14h, 10/10\n\nINTERVALO\nNovos seguidores no período: +19\nVisitas ao perfil da conta: 8\n" +
		"Custo por visita ao perfil: R$\U000000a00,90\nCusto por seguidor: R$\U000000a00,38\nInvestimento: R$\U000000a07,20\n\nTOTAL\n" +
		"Total seguidores da conta: 24.330\nTotal seguidores do dia: +30\nTotal visitantes dia: 13\nCusto de seguidores dia: R$\U000000a00,44\n" +
		"Custo visitantes dia: R$\U000000a01,02\nInvestimento no dia: R$\U000000a013,20"
)

func TestRelatorioHoraComoAEdgeEUmaVezSo(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	ctx := context.Background()
	if err := rh.Rodar(ctx); err != nil {
		t.Fatal(err)
	}
	msgs, caminhos, clientes := z.lista()
	if len(msgs) != 2 || msgs[0] != grupoWhatsApp+"|"+msgWpp || msgs[1] != grupoWhatsApp+"|"+msgSeguidores {
		t.Fatalf("mensagens =\n%q", msgs)
	}
	if caminhos[0] != "/instances/"+zapiInstancia+"/token/"+zapiToken+"/send-text" || clientes[0] != zapiCliente {
		t.Fatalf("contrato da Z-API: %s %s", caminhos[0], clientes[0])
	}
	err := rh.Rodar(ctx)
	if msgs, _, _ = z.lista(); err != nil || len(msgs) != 2 {
		t.Fatalf("rodar de novo na mesma hora não reenvia: err=%v mensagens=%d", err, len(msgs))
	}
}

func TestRelatorioHoraSemDadoAvisa(t *testing.T) {
	rh, z, _ := ambienteRelatorio(t)
	if err := rh.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if msgs, _, _ := z.lista(); len(msgs) != 1 || msgs[0] != grupoWhatsApp+"|⚠️ Relatório das 14h, 10/10 não saiu — sem dado disponível pra essa hora." {
		t.Fatalf("%q", msgs)
	}
}

func TestRelatorioHoraLeituraQueFalhaAvisaEEErro(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	if _, err := p.Exec(context.Background(), `drop table followers_leituras`); err != nil {
		t.Fatal(err)
	}
	err := rh.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "não consegui ler os dados de seguidores") {
		t.Fatalf("a edge dava 200 aqui; agora é erro visível: %v", err)
	}
	// texto COMPLETO: nenhum detalhe do pgx (nome de tabela, SQL) chega ao grupo
	if msgs, _, _ := z.lista(); len(msgs) != 1 || msgs[0] != grupoDaEdge+"|⚠️ Relatório das 14h, 10/10 não saiu — não consegui ler os dados de seguidores." {
		t.Fatalf("%q", msgs)
	}
}

// A Z-API desconectada (QR) é a causa provável dos 47% de falha de hoje: continua falha VISÍVEL, sem o
// token da instância no erro nem na linha de robos_execucoes; a recusa libera a reserva (a próxima tenta).
func TestRelatorioHoraZAPIRecusaEhErroSemToken(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	z.responder(401, false)
	z.mu.Lock()
	z.eco = true // a Z-API devolve o caminho (com o token da instância) e o Client-Token no corpo da recusa
	z.mu.Unlock()
	ag := worker.Novo(p)
	ag.Segredos = []string{zapiToken, zapiCliente}
	ex, err := ag.Rodar(context.Background(), rh.Tarefa())
	if !ex || err == nil {
		t.Fatalf("ex=%v err=%v", ex, err)
	}
	var resp, linha string
	if err := p.QueryRow(context.Background(), `select resposta, r::text from robos_execucoes r where robo = 'enviar-relatorio-hora'`).Scan(&resp, &linha); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(linha, zapiToken) || strings.Contains(linha, zapiCliente) {
		t.Fatalf("segredo na linha de robos_execucoes: %s", linha)
	}
	if !strings.Contains(resp, "wpp: Z-API send-text: 401") || strings.Contains(resp, zapiToken) || strings.Contains(err.Error(), zapiToken) {
		t.Fatalf("resp=%q err=%v", resp, err)
	}
	z.responder(0, false)
	err = rh.Rodar(context.Background())
	if msgs, _, _ := z.lista(); err != nil || len(msgs) != 4 {
		t.Fatalf("recusada não ficou reservada: err=%v mensagens=%d", err, len(msgs))
	}
}

func TestRelatorioHoraEnvioAmbiguoNaoRepete(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	z.responder(0, true)
	if err := rh.Rodar(context.Background()); err == nil || strings.Contains(err.Error(), zapiToken) {
		t.Fatalf("err=%v", err)
	}
	z.responder(0, false)
	err := rh.Rodar(context.Background())
	if msgs, _, _ := z.lista(); err != nil || len(msgs) != 2 {
		t.Fatalf("a mensagem pode ter saído: não manda de novo (mensagens=%d err=%v)", len(msgs), err)
	}
}

func TestRelatorioHoraSemZAPINemTenta(t *testing.T) {
	rh, z, _ := ambienteRelatorio(t)
	rh.ZAPI.ClientToken = ""
	err := rh.Rodar(context.Background())
	if msgs, _, _ := z.lista(); err == nil || len(msgs) != 0 {
		t.Fatalf("err=%v mensagens=%d", err, len(msgs))
	}
	if tf := rh.Tarefa(); tf.Nome != "enviar-relatorio-hora" || tf.Agenda != "10 * * * *" {
		t.Fatalf("%+v", tf)
	}
}

// 429 é recusa clara (libera a reserva: a próxima rodada da hora manda); Z-API lenta além do prazo é
// envio AMBÍGUO (a mensagem pode ter saído): fica reservada e nunca é repetida.
func TestRelatorioHoraZAPI429LiberaELentaNaoRepete(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	rh.ZAPI.HTTP = &http.Client{Timeout: 100 * time.Millisecond}
	z.responder(429, false)
	if err := rh.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), "Z-API send-text: 429") {
		t.Fatalf("429: %v", err)
	}
	z.responder(0, false)
	z.atrasar(300 * time.Millisecond)
	err := rh.Rodar(context.Background())
	if err == nil || strings.Contains(err.Error(), zapiToken) {
		t.Fatalf("lenta: %v", err)
	}
	z.atrasar(0)
	if err := rh.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if msgs, _, _ := z.lista(); len(msgs) != 4 {
		t.Fatalf("2 recusadas (429) + 2 ambíguas (lentas), nenhuma repetida depois: %d", len(msgs))
	}
}

// A chave do livro leva o dia E a hora: a mesma tarefa em outra hora manda de novo.
func TestRelatorioHoraEmDuasHorasMandaAsDuas(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	ctx := context.Background()
	for _, utc := range []int{17, 16} { // 14h10 e depois 13h10 em São Paulo
		rh.Agora = func() time.Time { return time.Date(2026, 10, 10, utc, 10, 0, 0, time.UTC) }
		if err := rh.Rodar(ctx); err != nil {
			t.Fatal(err)
		}
	}
	msgs, _, _ := z.lista()
	if len(msgs) != 4 || !strings.Contains(msgs[0], "14h, 10/10") || !strings.Contains(msgs[2], "13h, 10/10") {
		t.Fatalf("%q", msgs)
	}
	var chaves []string
	linhas, err := p.Query(ctx, `select chave from envios_feitos order by chave`)
	if err != nil {
		t.Fatal(err)
	}
	for linhas.Next() {
		var c string
		linhas.Scan(&c)
		chaves = append(chaves, c)
	}
	linhas.Close()
	want := []string{"enviar-relatorio-hora:2026-10-10:13:seguidores", "enviar-relatorio-hora:2026-10-10:13:wpp",
		"enviar-relatorio-hora:2026-10-10:14:seguidores", "enviar-relatorio-hora:2026-10-10:14:wpp"}
	if !slices.Equal(chaves, want) {
		t.Fatalf("chaves = %q", chaves)
	}
}

// O pedido seguiria o 3xx levando Client-Token (e o Referer com o token da instância) ao outro endereço, e a
// página 200 do destino contaria como enviada. 3xx é recusa clara: nada vai ao outro host e a hora NÃO fica
// marcada como enviada (libera a reserva).
func TestRelatorioHoraRedirecionamentoEhRecusaClara(t *testing.T) {
	for _, status := range []int{301, 302, 307} {
		t.Run(fmt.Sprint(status), func(t *testing.T) {
			rh, _, p := ambienteRelatorio(t)
			dadosDoRelatorio(t, p)
			var tocou atomic.Int32
			destino := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				tocou.Add(1)
				io.WriteString(w, "<html>200</html>")
			}))
			defer destino.Close()
			origem := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				http.Redirect(w, r, destino.URL+"/outro", status)
			}))
			defer origem.Close()
			rh.ZAPI.URL, rh.ZAPI.HTTP = origem.URL, nil // o cliente PADRÃO
			err := rh.Rodar(context.Background())
			if err == nil || !strings.Contains(err.Error(), fmt.Sprintf("Z-API send-text: %d", status)) || strings.Contains(err.Error(), zapiToken) {
				t.Fatalf("err=%v", err)
			}
			if tocou.Load() != 0 {
				t.Fatalf("o segundo host recebeu %d pedidos", tocou.Load())
			}
			var n int
			p.QueryRow(context.Background(), `select count(*) from envios_feitos`).Scan(&n)
			if n != 0 {
				t.Fatalf("a hora ficou marcada como enviada (%d chaves)", n)
			}
		})
	}
}

// O caminho da URL leva o token da instância: um serviço que ecoa o pedido na recusa não o faz chegar ao erro
// (nem direto, sem o worker).
func TestRelatorioHoraRecusaQueEcoaOPedidoNaoVazaSegredo(t *testing.T) {
	rh, z, p := ambienteRelatorio(t)
	dadosDoRelatorio(t, p)
	z.responder(401, false)
	z.mu.Lock()
	z.eco = true
	z.mu.Unlock()
	err := rh.Rodar(context.Background())
	if err == nil || !strings.Contains(err.Error(), "Z-API send-text: 401") || strings.Contains(err.Error(), zapiToken) || strings.Contains(err.Error(), zapiCliente) {
		t.Fatalf("err=%v", err)
	}
}

// 502/504: o gateway pode ter repassado a mensagem à Z-API antes de falhar: fica reservada (mensagem a
// cliente não é push); 500 e 503 são recusa do servidor: libera, a próxima rodada da hora manda.
func TestRelatorioHoraStatusDeGateway(t *testing.T) {
	for _, c := range []struct {
		status int
		manda  int // mensagens depois da segunda rodada, com a Z-API já boa
	}{{502, 2}, {504, 2}, {500, 4}, {503, 4}} {
		t.Run(fmt.Sprint(c.status), func(t *testing.T) {
			rh, z, p := ambienteRelatorio(t)
			dadosDoRelatorio(t, p)
			z.responder(c.status, false)
			if err := rh.Rodar(context.Background()); err == nil || !strings.Contains(err.Error(), fmt.Sprintf("Z-API send-text: %d", c.status)) {
				t.Fatalf("err=%v", err)
			}
			z.responder(0, false)
			if err := rh.Rodar(context.Background()); err != nil {
				t.Fatal(err)
			}
			if msgs, _, _ := z.lista(); len(msgs) != c.manda {
				t.Fatalf("mensagens = %d, esperava %d", len(msgs), c.manda)
			}
		})
	}
}

// O prazo de 2 min da tarefa acabou durante a leitura do banco: o aviso ao grupo sai mesmo assim (contexto
// próprio, curto), e a tarefa termina em erro.
func TestRelatorioHoraAvisoSaiComOPrazoDaTarefaVencido(t *testing.T) {
	rh, z, _ := ambienteRelatorio(t)
	ctx, cancela := context.WithCancel(context.Background())
	cancela()
	err := rh.Rodar(ctx)
	if err == nil || !strings.Contains(err.Error(), "não consegui ler os dados de campanha") {
		t.Fatalf("err=%v", err)
	}
	if msgs, _, _ := z.lista(); len(msgs) != 1 || msgs[0] != grupoDaEdge+"|⚠️ Relatório das 14h, 10/10 não saiu — não consegui ler os dados de campanha." {
		t.Fatalf("%q", msgs)
	}
}
