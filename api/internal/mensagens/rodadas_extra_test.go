package mensagens

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// Testes da revisão da Task 9 e do Plano (Review Focus 1, 4 e 5): janela de envio, quem pediu para
// parar, ids zero, prazo no meio do lote (ambíguo x nunca saiu), configuração inválida, segredos e o
// redirecionamento que nunca é seguido.

// filaCom monta uma fila de mentira com uma linha pronta para enviar por chave, do tipo pedido.
func filaCom(tipo string, chaves ...string) *filaFalsa {
	f := &filaFalsa{porTipo: map[string][]LinhaFila{}}
	for _, k := range chaves {
		if tipo == "abandono" {
			f.abandono = append(f.abandono, linhaAbandono(k))
			continue
		}
		conv := int64(55)
		f.porTipo[tipo] = append(f.porTipo[tipo], LinhaFila{Chave: k, Numero: s("#1001"), Nome: s("MARIA SILVA"), Telefone: s("(11) 98765-4321"),
			URL: s(baseLink + "abc?key=1"), ConversaOrigem: &conv, CriadoEm: agoraDentro.Add(-time.Hour)})
	}
	return f
}

var todasAsPassadas = []string{"inicio", "pedido", "abandono", "followup"}

// A janela é 08:00 (entra) a 21:00 (não entra) em Brasília, e vale para as QUATRO passadas.
func TestJanelaDeEnvioNasQuatroPassadas(t *testing.T) {
	casos := []struct {
		agora time.Time
		envia bool
	}{
		{time.Date(2026, 10, 10, 10, 59, 0, 0, time.UTC), false}, // 07:59
		{time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC), true},   // 08:00
		{time.Date(2026, 10, 10, 23, 59, 0, 0, time.UTC), true},  // 20:59
		{time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC), false},   // 21:00
		{time.Date(2026, 10, 10, 5, 0, 0, 0, time.UTC), false},   // 02:00
	}
	for _, tipo := range todasAsPassadas {
		for _, c := range casos {
			f := filaCom(tipo, "k1")
			m, cw := robo(t, f, nil, tipo)
			m.Agora = func() time.Time { return c.agora }
			if err := m.Rodar(context.Background()); err != nil {
				t.Fatalf("%s %s: %v", tipo, c.agora, err)
			}
			enviou := f.tem("marcar "+tipo+" k1 enviada  conversa=77") == 1 && cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") == 1
			if enviou != c.envia {
				t.Errorf("%s às %s UTC: enviou=%v\n%s", tipo, c.agora.Format("15:04"), enviou, strings.Join(f.chamadas, "\n"))
			}
			if !c.envia && (f.tem("devolver "+tipo+" k1 contar=false") != 1 || f.tem("marcar") != 0 || cw.chamadas("") != 0) {
				t.Errorf("%s às %s UTC: fora da janela espera sem tocar o Chatwoot e sem gastar tentativa:\n%s", tipo, c.agora.Format("15:04"), strings.Join(f.chamadas, "\n"))
			}
		}
	}
}

// O relógio é lido a cada item: um lote que atravessa as 21 h não manda a mensagem das 21:01 só porque
// a rodada começou às 20:59.
func TestJanelaVaiSendoReavaliadaItemAItem(t *testing.T) {
	f := filaCom("abandono", "t1", "t2")
	m, cw := robo(t, f, nil, "abandono")
	m.Agora = func() time.Time {
		if f.tem("marcar abandono t1 enviada") > 0 {
			return time.Date(2026, 10, 11, 0, 1, 0, 0, time.UTC) // 21:01
		}
		return time.Date(2026, 10, 10, 23, 59, 0, 0, time.UTC) // 20:59
	}
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.tem("marcar abandono t1 enviada") != 1 || f.tem("devolver abandono t2 contar=false") != 1 || cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") != 1 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
}

// Quem pediu para não receber (contatos_sem_mensagem) nunca recebe inicio, abandono nem follow-up; o
// pedido é transacional e não consulta a lista.
func TestPediuParaNaoReceberNasPassadasDeMarketing(t *testing.T) {
	for _, tipo := range []string{"inicio", "abandono", "followup"} {
		f := filaCom(tipo, "k1")
		f.bloq = map[string]bool{"5511987654321": true}
		m, cw := robo(t, f, nil, tipo)
		if err := m.Rodar(context.Background()); err != nil {
			t.Fatalf("%s: %v", tipo, err)
		}
		if f.tem("bloqueados 5511987654321") != 1 || f.tem("marcar "+tipo+" k1 ignorada pediu_para_nao_receber") != 1 || f.tem("trava") != 0 || cw.chamadas("") != 0 {
			t.Errorf("%s:\n%s (chatwoot=%d)", tipo, strings.Join(f.chamadas, "\n"), cw.chamadas(""))
		}
		// A lista não pode ser lida: nada sai e tudo volta sem gastar tentativa.
		f2 := filaCom(tipo, "k1", "k2")
		f2.erroBloq = fmt.Errorf("banco fora")
		m2, cw2 := robo(t, f2, nil, tipo)
		if err := m2.Rodar(context.Background()); err == nil || err.Error() != tipo+": falha_bloqueados" {
			t.Fatalf("%s: err=%v", tipo, err)
		}
		if f2.tem("devolver "+tipo+" k1 contar=false") != 1 || f2.tem("devolver "+tipo+" k2 contar=false") != 1 || f2.tem("marcar") != 0 || cw2.chamadas("") != 0 {
			t.Errorf("%s sem ler a lista:\n%s", tipo, strings.Join(f2.chamadas, "\n"))
		}
	}
	f := filaCom("pedido", "k1")
	f.bloq = map[string]bool{"5511987654321": true}
	m, _ := robo(t, f, nil, "pedido")
	m.Rodar(context.Background())
	if f.tem("bloqueados") != 0 || f.tem("marcar pedido k1 enviada  conversa=77") != 1 {
		t.Fatalf("pedido:\n%s", strings.Join(f.chamadas, "\n"))
	}
}

// Contato ou conversa com id 0 (resposta 2xx sem id utilizável) é erro do passo, nunca um envio para
// /conversations/0/messages: o item vira `falhou` (visível) e nada sai.
func TestIdZeroDeContatoOuConversaNaoEnvia(t *testing.T) {
	casos := map[string]struct {
		resp  func(string, string, map[string]any) (int, string)
		quer  string
		passo string
	}{
		"contato achado com id 0": {func(m, c string, _ map[string]any) (int, string) {
			if strings.Contains(c, "contacts/search") {
				return 200, `{"payload":[{"id":0,"name":"x","phone_number":"+5511987654321"}]}`
			}
			return 0, ""
		}, "falhou buscar_contato:200", "buscar_contato"},
		"conversa com id 0": {func(m, c string, _ map[string]any) (int, string) {
			if m == "POST" && strings.HasSuffix(c, "/conversations") {
				return 200, `{"id":0}`
			}
			return 0, ""
		}, "falhou abrir_conversa:200", "abrir_conversa"},
	}
	for _, tipo := range []string{"abandono", "inicio", "followup"} {
		for nome, c := range casos {
			f := filaCom(tipo, "k1")
			m, cw := robo(t, f, c.resp, tipo)
			if err := m.Rodar(context.Background()); err != nil {
				t.Fatalf("%s %s: %v", tipo, nome, err)
			}
			if f.tem("marcar "+tipo+" k1 "+c.quer) != 1 || f.tem("devolver") != 0 || cw.chamadas("POST /api/v1/accounts/3/conversations/0") != 0 {
				t.Errorf("%s %s:\n%s", tipo, nome, strings.Join(f.chamadas, "\n"))
			}
			for _, p := range func() []string { p, _ := cw.lista(); return p }() {
				if strings.HasSuffix(strings.SplitN(p, " ", 3)[1], "/messages") && strings.HasPrefix(p, "POST") {
					t.Errorf("%s %s: enviou: %s", tipo, nome, p)
				}
			}
		}
	}
}

// gancho do transporte: depois de a resposta de `quando` ser lida por inteiro, cancela o contexto da
// rodada (o prazo acaba EXATAMENTE entre dois passos, sem corrida com a leitura do corpo).
type cancelaDepois struct {
	quando  func(*http.Request) bool
	cancela context.CancelFunc
}

func (c cancelaDepois) RoundTrip(r *http.Request) (*http.Response, error) {
	resp, err := http.DefaultTransport.RoundTrip(r)
	if err != nil || !c.quando(r) {
		return resp, err
	}
	b, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	resp.Body = io.NopCloser(bytes.NewReader(b))
	c.cancela()
	return resp, nil
}

// O prazo vence ENTRE a última leitura e o envio: o template nem foi tentado (nao_enviado). O item volta à
// fila SEM gastar tentativa (e sem virar `falhou`), o resto do lote também, e a rodada termina com erro.
func TestPrazoAntesDoEnvioNaoGastaTentativa(t *testing.T) {
	gatilhos := map[string]func(*http.Request) bool{
		"abandono": func(r *http.Request) bool { return r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/messages") },
		"inicio": func(r *http.Request) bool {
			return r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/conversations")
		},
		"pedido": func(r *http.Request) bool {
			return r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/conversations")
		},
		"followup": func(r *http.Request) bool {
			return r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/conversations")
		},
	}
	for tipo, quando := range gatilhos {
		ctx, cancela := context.WithCancel(context.Background())
		f := filaCom(tipo, "k1", "k2", "k3")
		m, cw := robo(t, f, nil, tipo)
		m.HTTP = &http.Client{Transport: cancelaDepois{quando, cancela}}
		err := m.Rodar(ctx)
		cancela()
		if err == nil || err.Error() != tipo+": limite_de_tempo" {
			t.Fatalf("%s: err=%v", tipo, err)
		}
		for _, k := range []string{"k1", "k2", "k3"} {
			if f.tem("devolver "+tipo+" "+k+" contar=false") != 1 {
				t.Errorf("%s: %s devia voltar sem contar:\n%s", tipo, k, strings.Join(f.chamadas, "\n"))
			}
		}
		if f.tem("marcar") != 0 || f.tem("devolver "+tipo+" k1 contar=true") != 0 || cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") != 0 {
			t.Errorf("%s: nada saiu, nada foi marcado:\n%s", tipo, strings.Join(f.chamadas, "\n"))
		}
	}
}

// O prazo vence ENQUANTO o Chatwoot atende um passo ANTES do envio (a conexão cai por causa do prazo, não
// da rede): nada saiu, então volta sem contar tentativa (rede de verdade gasta uma) e a rodada termina com
// `limite_de_tempo`.
func TestPrazoNoMeioDeUmPassoAnteriorAoEnvio(t *testing.T) {
	for _, tipo := range todasAsPassadas {
		f := filaCom(tipo, "k1", "k2")
		ctx, cancela := context.WithTimeout(context.Background(), 200*time.Millisecond)
		m, cw := robo(t, f, func(met, c string, _ map[string]any) (int, string) {
			if strings.Contains(c, "contacts/search") || strings.HasSuffix(c, "/avisos/reservar") {
				time.Sleep(500 * time.Millisecond) // pendura até o prazo
			}
			return 0, ""
		}, tipo)
		m.Cfg.Pedido.ReservarAviso = true
		err := m.Rodar(ctx)
		cancela()
		if err == nil || err.Error() != tipo+": limite_de_tempo" {
			t.Fatalf("%s: err=%v", tipo, err)
		}
		if f.tem("devolver "+tipo+" k1 contar=false") != 1 || f.tem("devolver "+tipo+" k2 contar=false") != 1 || f.tem("marcar") != 0 ||
			f.tem("devolver "+tipo+" k1 contar=true") != 0 || cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") != 0 {
			t.Errorf("%s:\n%s", tipo, strings.Join(f.chamadas, "\n"))
		}
		if tipo == "pedido" && cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar") != 1 {
			t.Errorf("a reserva sem resposta é liberada (best-effort): %d", cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar"))
		}
	}
}

// O envio pendurado até o prazo é ambíguo (pode ter saído): `falhou` e NUNCA reenviado, em qualquer passada,
// mesmo sendo o único item do lote; o resto volta sem contar e a rodada termina com `limite_de_tempo`.
func TestPrazoNoEnvioPendurado(t *testing.T) {
	for _, tipo := range todasAsPassadas {
		for _, lote := range [][]string{{"k1"}, {"k1", "k2"}} {
			f := filaCom(tipo, lote...)
			ctx, cancela := context.WithTimeout(context.Background(), 300*time.Millisecond)
			m, cw := robo(t, f, func(met, c string, _ map[string]any) (int, string) {
				if met == "POST" && strings.HasSuffix(c, "/messages") {
					time.Sleep(600 * time.Millisecond)
				}
				return 0, ""
			}, tipo)
			m.Cfg.Pedido.ReservarAviso = true
			err := m.Rodar(ctx)
			cancela()
			if err == nil || err.Error() != tipo+": limite_de_tempo" {
				t.Fatalf("%s %v: err=%v", tipo, lote, err)
			}
			quer := "marcar " + tipo + " k1 falhou enviar_template:0"
			if tipo == "pedido" {
				quer = "marcar pedido k1 falhou envio_incerto_conferir_no_chatwoot: enviar_template:0"
			}
			if f.tem(quer) != 1 || f.tem("devolver "+tipo+" k1") != 0 || cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar") != 0 {
				t.Errorf("%s %v:\n%s", tipo, lote, strings.Join(f.chamadas, "\n"))
			}
			if len(lote) == 2 && f.tem("devolver "+tipo+" k2 contar=false") != 1 {
				t.Errorf("%s: o resto volta sem contar:\n%s", tipo, strings.Join(f.chamadas, "\n"))
			}
		}
	}
}

// Rede que cai NO envio (sem prazo vencido) continua ambígua: falhou, e a rodada segue para o próximo.
func TestRedeNoEnvioSemPrazoSegueOLote(t *testing.T) {
	f := filaCom("inicio", "k1", "k2")
	m, cw := robo(t, f, func(met, c string, _ map[string]any) (int, string) {
		if met == "POST" && strings.HasSuffix(c, "/messages") {
			return -1, ""
		}
		return 0, ""
	}, "inicio")
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.tem("marcar inicio k1 falhou enviar_template:0") != 1 || f.tem("marcar inicio k2 falhou enviar_template:0") != 1 ||
		f.tem("devolver") != 0 || cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") != 2 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
}

// Config inválida de FOLLOWUP_APOS_HORAS e ENVIO_ATRASO_MINUTOS (NaN, infinito, negativo, fração) rejeita a
// passada INTEIRA antes de tocar em qualquer coisa (nem agenda, nem reserva, nem Chatwoot); as outras passadas
// seguem.
func TestConfigInvalidaDeFollowupEAtrasoNaoTocaNada(t *testing.T) {
	for _, v := range []string{"abc", "NaN", "Infinity", "-Infinity", "-5", "1.5", "0x", "1e999"} {
		f := filaCom("followup", "k1")
		m, cw := robo(t, f, nil, "followup")
		m.Cfg.FollowupAposHoras = numeroJS(v, 48)
		if err := m.Rodar(context.Background()); err == nil || err.Error() != "followup: config_invalida" || len(f.chamadas) != 0 || cw.chamadas("") != 0 {
			t.Errorf("FOLLOWUP_APOS_HORAS=%q: err=%v chamadas=%v", v, err, f.chamadas)
		}
		f2 := filaCom("abandono", "k1")
		m2, cw2 := robo(t, f2, nil, "abandono")
		m2.Cfg.Abandono.AtrasoMin = numeroJS(v, 0)
		if err := m2.Rodar(context.Background()); err == nil || err.Error() != "abandono: config_invalida" || len(f2.chamadas) != 0 || cw2.chamadas("") != 0 {
			t.Errorf("ENVIO_ATRASO_MINUTOS=%q: err=%v chamadas=%v", v, err, f2.chamadas)
		}
	}
	for _, v := range []float64{math.NaN(), math.Inf(1), -1, 2.5} { // mesmo valor direto na struct
		f := filaCom("followup", "k1")
		m, _ := robo(t, f, nil, "followup")
		m.Cfg.FollowupAposHoras = v
		if err := m.Rodar(context.Background()); err == nil || len(f.chamadas) != 0 {
			t.Errorf("%v: err=%v chamadas=%v", v, err, f.chamadas)
		}
	}
	// 0 é válido (é o padrão do atraso): agenda e roda.
	f := filaCom("followup", "k1")
	m, _ := robo(t, f, nil, "followup")
	m.Cfg.FollowupAposHoras = 0
	if err := m.Rodar(context.Background()); err != nil || f.tem("agendar_followups 0 24") != 1 {
		t.Fatalf("err=%v\n%s", err, strings.Join(f.chamadas, "\n"))
	}
	f3 := filaCom("abandono", "k1")
	m3, _ := robo(t, f3, nil, "abandono")
	m3.Cfg.Abandono.AtrasoMin = numeroJS("", 0)
	if err := m3.Rodar(context.Background()); err != nil || f3.tem("pegar abandono limite=10 atraso=0") != 1 {
		t.Fatalf("err=%v", err)
	}
	// Followup inválido não derruba o pedido.
	f4 := filaCom("pedido", "k1")
	m4, _ := robo(t, f4, nil, "pedido", "followup")
	m4.Cfg.FollowupAposHoras = math.NaN()
	if err := m4.Rodar(context.Background()); err == nil || err.Error() != "followup: config_invalida" || f4.tem("marcar pedido k1 enviada") != 1 || f4.tem("agendar") != 0 {
		t.Fatalf("err=%v\n%s", err, strings.Join(f4.chamadas, "\n"))
	}
	// Followup com a configuração do Chatwoot inválida também não agenda nada (config inválida não toca nada).
	f5 := filaCom("followup", "k1")
	m5, _ := robo(t, f5, nil, "followup")
	m5.Cfg.Chatwoot.Token = ""
	if err := m5.Rodar(context.Background()); err == nil || f5.tem("agendar") != 0 || len(f5.chamadas) != 0 {
		t.Fatalf("err=%v chamadas=%v", err, f5.chamadas)
	}
}

// Falha ao agendar follow-ups é visível (erro da tarefa), mas a fila já agendada ainda é processada.
func TestFalhaAoAgendarFollowupsFicaVisivel(t *testing.T) {
	f := filaCom("followup", "k1")
	m, _ := robo(t, f, nil, "followup")
	m.fila = &agendaQuebrada{f}
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "followup: falha_ao_agendar" || f.tem("marcar followup k1 enviada  conversa=77") != 1 {
		t.Fatalf("err=%v\n%s", err, strings.Join(f.chamadas, "\n"))
	}
}

type agendaQuebrada struct{ *filaFalsa }

func (agendaQuebrada) agendarFollowups(context.Context, int, int) error {
	return fmt.Errorf("banco fora")
}

// A passada seguinte não começa se o prazo já acabou: nada é reservado para ser devolvido.
func TestPassadaNaoComecaComOPrazoVencido(t *testing.T) {
	f := filaCom("pedido", "k1")
	m, _ := robo(t, f, nil, "pedido", "abandono")
	ctx, cancela := context.WithCancel(context.Background())
	cancela()
	err := m.Rodar(ctx)
	if err == nil || err.Error() != "pedido: limite_de_tempo; abandono: limite_de_tempo" || len(f.chamadas) != 0 {
		t.Fatalf("err=%v chamadas=%v", err, f.chamadas)
	}
}

// Segredos (token do Chatwoot e segredo do bot) nunca vão para o erro da rodada, o log nem o `detalhe` gravado
// na fila — mesmo quando o Chatwoot os devolve no corpo do erro ou a rede cai.
func TestSegredosNaoVazamDaRodada(t *testing.T) {
	log := &bufferLog{}
	antigo := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(log, nil)))
	defer slog.SetDefault(antigo)
	eco := fmt.Sprintf(`{"error":"credencial %s e segredo %s recusados"}`, tokenChatwoot, segredoDoBot)
	var saidas []string
	for _, tipo := range todasAsPassadas {
		for _, st := range []int{422, 500, 401, -1} {
			f := filaCom(tipo, "k1", "k2")
			m, _ := robo(t, f, func(met, c string, _ map[string]any) (int, string) {
				if strings.Contains(c, "contacts/search") || (met == "POST" && strings.HasSuffix(c, "/messages")) || strings.HasSuffix(c, "/avisos/reservar") {
					return st, eco
				}
				return 0, ""
			}, tipo)
			m.Cfg.Pedido.ReservarAviso = true
			err := m.Rodar(context.Background())
			saidas = append(saidas, strings.Join(f.chamadas, "\n"))
			if err != nil {
				saidas = append(saidas, err.Error())
			}
		}
	}
	saidas = append(saidas, log.String())
	for _, x := range saidas {
		if strings.Contains(x, tokenChatwoot) || strings.Contains(x, segredoDoBot) {
			t.Fatalf("segredo na saída:\n%s", x)
		}
	}
	if !strings.Contains(strings.Join(saidas, "\n"), "***") {
		t.Fatal("o corpo com o segredo devia aparecer mascarado (***), e não faltar")
	}
}

type bufferLog struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *bufferLog) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}
func (b *bufferLog) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

// Em produção Mensagens.HTTP fica nil: o cliente padrão NUNCA segue redirecionamento. Um 307 no envio
// seria repetido pelo Go (o corpo do POST é reenviado), e o envio sairia duas vezes.
func TestRedirecionamentoNoEnvioNaoEhSeguido(t *testing.T) {
	var mu sync.Mutex
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/messages") {
			mu.Lock()
			posts++
			mu.Unlock()
			w.Header().Set("Location", r.URL.Path+"?de=novo")
			w.WriteHeader(http.StatusTemporaryRedirect)
			return
		}
		st, txt := caminhoFeliz(r.Method, r.URL.Path)
		w.WriteHeader(st)
		io.WriteString(w, txt)
	}))
	defer srv.Close()
	f := filaCom("inicio", "k1")
	cfg := configLigada(&Chatwoot{URL: srv.URL, ContaID: "3", Token: tokenChatwoot, BotSecret: segredoDoBot})
	desligar(&cfg, "inicio")
	m := &Mensagens{Cfg: cfg, Agora: func() time.Time { return agoraDentro }, fila: f}
	if m.HTTP != nil {
		t.Fatal("em produção HTTP é nil")
	}
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if posts != 1 || f.tem("marcar inicio k1 falhou enviar_template:307") != 1 || f.tem("marcar inicio k1 enviada") != 0 {
		t.Fatalf("posts=%d\n%s", posts, strings.Join(f.chamadas, "\n"))
	}
}

// O texto sai como o String.replace do JS: `$&`, `$$`, “ $` “ e `$'` no nome da cliente têm significado
// próprio na substituição (vetores gerados no Node 22).
func TestSubstituirComoOReplaceDoJS(t *testing.T) {
	casos := [][4]string{
		{"Oi {{1}}, tchau", "{{1}}", "Ana$&", "Oi Ana{{1}}, tchau"},
		{"Oi {{1}}!", "{{1}}", "A$$B", "Oi A$B!"},
		{"Oi {{1}}!", "{{1}}", "A$`B", "Oi AOi B!"},
		{"Oi {{1}}!", "{{1}}", "A$'B", "Oi A!B!"},
		{"Oi {{1}}!", "{{1}}", "A$1B", "Oi A$1B!"},
		{"Oi {{1}}!", "{{1}}", "A$<n>B", "Oi A$<n>B!"},
		{"Oi {{1}}!", "{{1}}", "R$ 10", "Oi R$ 10!"},
		{"Oi {{1}}!", "{{1}}", "x$", "Oi x$!"},
		{"{{1}} e {{1}}", "{{1}}", "B", "B e {{1}}"},
		{"sem alvo", "{{1}}", "B", "sem alvo"},
		{"{{2}}", "{{2}}", "$&$&", "{{2}}{{2}}"},
	}
	for _, c := range casos {
		if got := substituirJS(c[0], c[1], c[2]); got != c[3] {
			t.Errorf("%q.replace(%q, %q) = %q, o JS dá %q", c[0], c[1], c[2], got, c[3])
		}
	}
	// Ponta a ponta: o texto que vai ao Chatwoot.
	f := filaCom("abandono", "t1")
	f.abandono[0].Nome = s("Ana$&")
	m, cw := robo(t, f, nil, "abandono")
	m.Cfg.Abandono.TemplateTexto = "Oi {{1}}, volte"
	m.Rodar(context.Background())
	pedidos, _ := cw.lista()
	if envio := pedidos[len(pedidos)-1]; !strings.Contains(envio, `"content":"Oi Ana{{1}}, volte"`) {
		t.Fatalf("envio=%s", envio)
	}
}
