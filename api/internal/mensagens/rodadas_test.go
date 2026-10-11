package mensagens

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

// filaFalsa é o banco de mentira das rodadas (como o `sb` falso dos testes da edge): guarda as linhas
// e anota cada chamada.
type filaFalsa struct {
	mu                     sync.Mutex
	abandono               []LinhaAbandono
	porTipo                map[string][]LinhaFila
	chamadas               []string
	status                 map[string]string // status do checkout por token; ausente = fila_envio
	trava                  string            // resposta da trava cruzada; "" = liberar
	bloq                   map[string]bool
	erroPegar, erroBloq    error
	erroStatus, erroGravar error  // erroGravar: só o marcar 'enviada'
	aoGravar               func() // chamado depois de marcar 'enviada'
	reservas               []bool
	ultimos                [][]string
}

func (f *filaFalsa) anotar(s string, a ...any) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.chamadas = append(f.chamadas, fmt.Sprintf(s, a...))
}

func (f *filaFalsa) tem(prefixo string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, c := range f.chamadas {
		if strings.HasPrefix(c, prefixo) {
			n++
		}
	}
	return n
}

func (f *filaFalsa) liberarMensagensTravadas(context.Context) error {
	f.anotar("liberar_mensagens")
	return nil
}
func (f *filaFalsa) liberarTravadasDaFila(context.Context) error {
	f.anotar("liberar_fila")
	return nil
}
func (f *filaFalsa) pegarParaMensagem(_ context.Context, limite, atraso int, reservar bool, u11 []string, maxHoras int) ([]LinhaAbandono, error) {
	f.anotar("pegar abandono limite=%d atraso=%d max=%d", limite, atraso, maxHoras)
	f.reservas, f.ultimos = append(f.reservas, reservar), append(f.ultimos, u11)
	return f.abandono, f.erroPegar
}
func (f *filaFalsa) pegarDaFila(_ context.Context, tipo string, limite, maxHoras int, reservar bool, u11 []string) ([]LinhaFila, error) {
	f.anotar("pegar %s limite=%d max=%d", tipo, limite, maxHoras)
	f.reservas, f.ultimos = append(f.reservas, reservar), append(f.ultimos, u11)
	return f.porTipo[tipo], f.erroPegar
}
func (f *filaFalsa) marcarMensagem(_ context.Context, token, status, motivo string, conversa *int64) error {
	return f.marcar("abandono", token, status, motivo, conversa)
}
func (f *filaFalsa) marcarDaFila(_ context.Context, tipo, chave, status, motivo string, conversa *int64) error {
	return f.marcar(tipo, chave, status, motivo, conversa)
}
func (f *filaFalsa) marcar(tipo, chave, status, motivo string, conversa *int64) error {
	c := ""
	if conversa != nil {
		c = fmt.Sprintf(" conversa=%d", *conversa)
	}
	f.anotar("marcar %s %s %s %s%s", tipo, chave, status, motivo, c)
	if status == "enviada" {
		if f.aoGravar != nil {
			f.aoGravar()
		}
		return f.erroGravar
	}
	return nil
}
func (f *filaFalsa) devolverMensagem(_ context.Context, token string, contar bool) error {
	f.anotar("devolver abandono %s contar=%v", token, contar)
	return nil
}
func (f *filaFalsa) devolverDaFila(_ context.Context, tipo, chave string, contar bool) error {
	f.anotar("devolver %s %s contar=%v", tipo, chave, contar)
	return nil
}
func (f *filaFalsa) agendarFollowups(_ context.Context, apos, teto int) error {
	f.anotar("agendar_followups %d %d", apos, teto)
	return nil
}
func (f *filaFalsa) bloqueados(_ context.Context, ts []string) (map[string]bool, error) {
	f.anotar("bloqueados %s", strings.Join(ts, ","))
	return f.bloq, f.erroBloq
}
func (f *filaFalsa) statusDoCheckout(_ context.Context, token string) (string, error) {
	f.anotar("status %s", token)
	if st, ok := f.status[token]; ok {
		return st, f.erroStatus
	}
	return "fila_envio", f.erroStatus
}
func (f *filaFalsa) travaCruzada(_ context.Context, tel, tipo, chave string) string {
	f.anotar("trava %s %s %s", tel, tipo, chave)
	if f.trava == "" {
		return "liberar"
	}
	return f.trava
}

// agoraDentro: sábado 12:00 em São Paulo (dentro da janela 08-21).
var agoraDentro = time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)

const baseLink = "https://loja.com/checkouts/"

func configLigada(cw *Chatwoot) Config {
	chat := ChatwootConfig{URL: cw.URL, ContaID: cw.ContaID, CaixaID: "9", Token: cw.Token, BotSecret: cw.BotSecret}
	p := func(template, texto string, maxHoras float64) Passada {
		return Passada{Modo: "ligado", Limite: 10, MaxHoras: maxHoras, LinkBase: baseLink, Idioma: "pt_BR",
			TemplateNome: template, TemplateTexto: texto, TravaCruzada: true}
	}
	return Config{Chatwoot: chat, Inicio: p("inicio_v1", "Oi {{1}}, reservamos!", 1), Pedido: p("pedido_v1", "{{1}}, pedido {{2}} recebido", 2),
		Abandono: p("abandono_v2", "Oi {{1}}, seu carrinho {{1}}", 24), Followup: p("followup_v1", "{{1}}, ainda dá tempo", 24), FollowupAposHoras: 48}
}

func desligar(c *Config, menos ...string) {
	for nome, p := range map[string]*Passada{"inicio": &c.Inicio, "pedido": &c.Pedido, "abandono": &c.Abandono, "followup": &c.Followup} {
		if !slices.Contains(menos, nome) {
			p.Modo = "desligado"
		}
	}
}

func linhaAbandono(token string) LinhaAbandono {
	return LinhaAbandono{Token: token, Telefone: s("(11) 98765-4321"), Nome: s("MARIA SILVA"), URL: s(baseLink + "abc?key=1"),
		Status: "fila_envio", IniciadoEm: agoraDentro.Add(-time.Hour)}
}

func robo(t *testing.T, f *filaFalsa, resp func(string, string, map[string]any) (int, string), passadas ...string) (*Mensagens, *chatwootFalso) {
	t.Helper()
	cw, falso := novoChatwoot(t, resp)
	cfg := configLigada(cw)
	desligar(&cfg, passadas...)
	return &Mensagens{Cfg: cfg, Agora: func() time.Time { return agoraDentro }, fila: f}, falso
}

func TestAbandonoCaminhoFeliz(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("tok-aaaaaaaaaa")}}
	m, cw := robo(t, f, nil, "abandono")
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	quer := []string{"liberar_mensagens", "pegar abandono limite=10 atraso=0 max=24", "bloqueados 5511987654321",
		"trava 5511987654321 abandono tok-aaaaaaaaaa", "status tok-aaaaaaaaaa", "marcar abandono tok-aaaaaaaaaa enviada  conversa=77"}
	if !slices.Equal(f.chamadas, quer) || !f.reservas[0] || f.ultimos[0] != nil {
		t.Fatalf("chamadas =\n%s", strings.Join(f.chamadas, "\n"))
	}
	pedidos, _ := cw.lista()
	envio := pedidos[len(pedidos)-1]
	if !strings.Contains(envio, `"content":"Oi Maria, seu carrinho {{1}}"`) ||
		!strings.Contains(envio, `"template_params":{"name":"abandono_v2","category":"MARKETING","language":"pt_BR","processed_params":{"body":{"1":"Maria"},"buttons":[{"type":"url","parameter":"abc?key=1"}]}}`) {
		t.Fatalf("envio = %s", envio)
	}
	if cw.chamadas("PUT /api/v1/accounts/3/contacts/51") != 1 || !strings.Contains(pedidos[1], `"name":"Maria Silva"`) {
		t.Fatalf("contato com o telefone como nome ganha o nome formatado: %q", pedidos)
	}
}

func TestAbandonoNaoEnviaQuemRespondeuOuSaiuDaFila(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("respondeu"), linhaAbandono("comprou")}, status: map[string]string{"comprou": "pagamento_pendente"}}
	inicio := float64(agoraDentro.Add(-time.Hour).Unix())
	m, cw := robo(t, f, func(met, cam string, _ map[string]any) (int, string) {
		if met == "GET" && strings.HasSuffix(cam, "/messages") {
			return 200, fmt.Sprintf(`{"payload":[{"message_type":0,"created_at":%d}]}`, int64(inicio)+60)
		}
		return 0, ""
	}, "abandono")
	m.Rodar(context.Background())
	if f.tem("marcar abandono respondeu ignorada respondeu") != 1 || f.tem("marcar abandono comprou ignorada nao_esta_mais_na_fila") != 1 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	if cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") != 0 {
		t.Fatal("nada podia ser enviado")
	}
}

func TestAbandonoFalhasNuncaDuplicam(t *testing.T) {
	casos := []struct {
		nome    string
		resp    func(string, string, map[string]any) (int, string)
		gravar  error
		esperar string
	}{
		{"template recusado (422)", func(m, c string, _ map[string]any) (int, string) {
			if m == "POST" && strings.HasSuffix(c, "/messages") {
				return 422, `{"error":"Template não aprovado"}`
			}
			return 0, ""
		}, nil, `marcar abandono t1 falhou enviar_template:422 {"error":"Template não aprovado"}`},
		{"rede NO envio: pode ter saído", func(m, c string, _ map[string]any) (int, string) {
			if m == "POST" && strings.HasSuffix(c, "/messages") {
				return -1, ""
			}
			return 0, ""
		}, nil, "marcar abandono t1 falhou enviar_template:0 "},
		{"rede ANTES do envio", func(m, c string, _ map[string]any) (int, string) {
			if strings.HasSuffix(c, "/conversations") {
				return -1, ""
			}
			return 0, ""
		}, nil, "devolver abandono t1 contar=true"},
		{"gravar 'enviada' falha", nil, fmt.Errorf("banco fora"), "marcar abandono t1 enviada  conversa=77"},
	}
	for _, c := range casos {
		f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}, erroGravar: c.gravar}
		m, _ := robo(t, f, c.resp, "abandono")
		m.Rodar(context.Background())
		if f.tem(c.esperar) != 1 {
			t.Errorf("%s:\n%s", c.nome, strings.Join(f.chamadas, "\n"))
		}
		if c.nome != "rede ANTES do envio" && f.tem("devolver") != 0 {
			t.Errorf("%s: devolver reenviaria: %v", c.nome, f.chamadas)
		}
	}
}

func TestCredencialRecusadaParaARodada(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1"), linhaAbandono("t2")}}
	m, _ := robo(t, f, func(_, c string, _ map[string]any) (int, string) {
		if strings.Contains(c, "search") {
			return 401, `{"error":"Invalid token"}`
		}
		return 0, ""
	}, "abandono")
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "abandono: credencial_recusada" {
		t.Fatalf("err=%v", err)
	}
	if f.tem("devolver abandono t1 contar=false") != 1 || f.tem("devolver abandono t2 contar=false") != 1 || f.tem("marcar") != 0 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	if strings.Contains(err.Error(), tokenChatwoot) {
		t.Fatal("token no erro")
	}
}

func TestBloqueadosIlegiveisAbortamEConfigInvalidaNaoTocaNada(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}, erroBloq: fmt.Errorf("timeout")}
	m, cw := robo(t, f, nil, "abandono")
	if err := m.Rodar(context.Background()); err == nil || err.Error() != "abandono: falha_bloqueados" {
		t.Fatalf("err=%v", err)
	}
	if f.tem("devolver abandono t1 contar=false") != 1 || cw.chamadas("") != 0 {
		t.Fatalf("%v / chatwoot=%d", f.chamadas, cw.chamadas(""))
	}
	f2 := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}}
	m2, _ := robo(t, f2, nil, "abandono")
	m2.Cfg.Chatwoot.Token = ""
	if err := m2.Rodar(context.Background()); err == nil || err.Error() != "abandono: config_invalida" || len(f2.chamadas) != 0 {
		t.Fatalf("config inválida: err=%v chamadas=%v", err, f2.chamadas)
	}
}

func TestSecoSoLeEListaFiltra(t *testing.T) {
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1")}}
	m, cw := robo(t, f, nil, "abandono")
	m.Cfg.Abandono.Modo = "seco"
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	if f.reservas[0] || f.tem("marcar") != 0 || f.tem("devolver") != 0 || f.tem("liberar") != 0 || cw.chamadas("") != 0 {
		t.Fatalf("seco: %v chatwoot=%d", f.chamadas, cw.chamadas(""))
	}
	f2 := &filaFalsa{}
	m2, _ := robo(t, f2, nil, "abandono")
	m2.Cfg.Abandono.Modo, m2.Cfg.Abandono.SoPara = "lista", []string{"5511987654321", "21999990000"}
	m2.Rodar(context.Background())
	if !slices.Equal(f2.ultimos[0], []string{"11987654321", "21999990000"}) || !f2.reservas[0] {
		t.Fatalf("lista: %v", f2.ultimos)
	}
}

func TestPedidoComReservaDoAviso(t *testing.T) {
	linha := LinhaFila{Chave: "pedido-123456789", Numero: s("#1001"), Nome: s("maria"), Telefone: s("11987654321"), CriadoEm: agoraDentro.Add(-30 * time.Second)}
	reservaCom := func(st int, corpo string, envio int) func(string, string, map[string]any) (int, string) {
		return func(m, c string, _ map[string]any) (int, string) {
			if strings.HasSuffix(c, "/avisos/reservar") {
				return st, corpo
			}
			if envio != 0 && m == "POST" && strings.HasSuffix(c, "/messages") {
				return envio, `{"error":"x"}`
			}
			return 0, ""
		}
	}
	casos := []struct {
		nome                   string
		resp                   func(string, string, map[string]any) (int, string)
		querFila               []string
		enviou, liberou, adiou bool
	}{
		{"reservado envia", reservaCom(200, `{"ok":true,"resultado":"reservado"}`, 0), []string{"marcar pedido pedido-123456789 enviada  conversa=77"}, true, false, false},
		{"adiado devolve sem contar", reservaCom(200, `{"ok":true,"resultado":"adiado"}`, 0), []string{"devolver pedido pedido-123456789 contar=false"}, false, false, true},
		{"duplicado ignora", reservaCom(200, `{"ok":true,"resultado":"duplicado"}`, 0), []string{"marcar pedido pedido-123456789 ignorada aviso_chatwoot_duplicado"}, false, false, false},
		{"5xx na reserva libera e espera", reservaCom(503, `{}`, 0), []string{"devolver pedido pedido-123456789 contar=false"}, false, true, false},
		{"envio ambíguo NÃO libera nem devolve", reservaCom(200, `{"ok":true,"resultado":"reservado"}`, -1),
			[]string{"marcar pedido pedido-123456789 falhou envio_incerto_conferir_no_chatwoot: enviar_template:0 "}, false, false, false},
		{"4xx no envio libera e marca falhou", reservaCom(200, `{"ok":true,"resultado":"reservado"}`, 422), []string{`marcar pedido pedido-123456789 falhou enviar_template:422 {"error":"x"}`}, false, true, false},
	}
	for _, c := range casos {
		f := &filaFalsa{porTipo: map[string][]LinhaFila{"pedido": {linha}}}
		m, cw := robo(t, f, c.resp, "pedido")
		m.Cfg.Pedido.ReservarAviso = true
		m.Rodar(context.Background())
		for _, q := range c.querFila {
			if f.tem(q) != 1 {
				t.Errorf("%s: falta %q em\n%s", c.nome, q, strings.Join(f.chamadas, "\n"))
			}
		}
		enviou := cw.chamadas("POST /api/v1/accounts/3/conversations/77/messages") == 1 && f.tem("marcar pedido pedido-123456789 enviada") == 1
		if enviou != c.enviou || (cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar") == 1) != c.liberou {
			t.Errorf("%s: enviou=%v liberou=%d", c.nome, enviou, cw.chamadas("POST /custom_api/v1/accounts/3/avisos/liberar"))
		}
		if f.tem("trava") != 0 || f.tem("bloqueados") != 0 {
			t.Errorf("%s: o pedido é transacional (sem trava cruzada nem bloqueados)", c.nome)
		}
		if c.nome == "reservado envia" {
			pedidos, _ := cw.lista()
			res, envio := pedidos[0], pedidos[len(pedidos)-1]
			if !strings.Contains(res, `"chave":"1001"`) || !strings.Contains(res, `"idade_s":30`) || !strings.Contains(res, `"tipo":"pedido_recebido"`) ||
				!strings.Contains(envio, `"content":"Maria, pedido #1001 recebido"`) ||
				!strings.Contains(envio, `"processed_params":{"body":{"1":"Maria","2":"#1001"}}`) || strings.Contains(envio, "buttons") {
				t.Errorf("reserva=%s\nenvio=%s", res, envio)
			}
		}
	}
	// Reserva com 401: para a rodada e devolve o que sobrou, sem vazar o segredo do bot.
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"pedido": {linha, {Chave: "outro", Telefone: s("11912345678"), CriadoEm: agoraDentro}}}}
	m, _ := robo(t, f, reservaCom(401, `{}`, 0), "pedido")
	m.Cfg.Pedido.ReservarAviso = true
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "pedido: reserva_recusada" || f.tem("devolver pedido outro contar=false") != 1 || strings.Contains(err.Error(), segredoDoBot) {
		t.Fatalf("err=%v\n%s", err, strings.Join(f.chamadas, "\n"))
	}
	m.Cfg.Chatwoot.BotSecret = ""
	if err := m.Rodar(context.Background()); err == nil || err.Error() != "pedido: config_invalida" {
		t.Fatalf("reserva ligada sem o segredo falha fechada: %v", err)
	}
}

func TestFollowup(t *testing.T) {
	conv := int64(55)
	linhas := []LinhaFila{
		{Chave: "sem-conversa", Telefone: s("11987654321"), URL: s(baseLink + "a")},
		{Chave: "comprou", Telefone: s("11987654322"), URL: s(baseLink + "b"), ConversaOrigem: &conv},
		{Chave: "feliz", Nome: s("ana"), Telefone: s("11987654323"), URL: s(baseLink + "c"), ConversaOrigem: &conv},
	}
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"followup": linhas}, status: map[string]string{"comprou": "comprou"}}
	m, cw := robo(t, f, nil, "followup")
	if err := m.Rodar(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, q := range []string{"agendar_followups 48 24", "marcar followup sem-conversa ignorada sem_conversa_de_origem",
		"marcar followup comprou ignorada nao_esta_mais_na_fila", "marcar followup feliz enviada  conversa=77"} {
		if f.tem(q) != 1 {
			t.Errorf("falta %q em\n%s", q, strings.Join(f.chamadas, "\n"))
		}
	}
	if cw.chamadas("GET /api/v1/accounts/3/conversations/55/messages") != 1 {
		t.Fatal("o follow-up pergunta se a cliente respondeu na conversa de origem")
	}
	f2 := &filaFalsa{}
	m2, _ := robo(t, f2, nil, "followup")
	m2.Cfg.Followup.Modo = "seco"
	m2.Rodar(context.Background())
	if f2.tem("agendar_followups") != 0 {
		t.Fatal("o seco não agenda")
	}
}

func TestInicioETravaCruzada(t *testing.T) {
	linhas := []LinhaFila{{Chave: "sem-link", Telefone: s("11987654321")}, {Chave: "barrado", Telefone: s("11987654322"), URL: s(baseLink + "x")}}
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"inicio": linhas}, trava: "barrar"}
	m, cw := robo(t, f, nil, "inicio")
	m.Rodar(context.Background())
	if f.tem("devolver inicio sem-link contar=false") != 1 || f.tem("marcar inicio barrado ignorada ignorada_trava_cruzada") != 1 || cw.chamadas("") != 0 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	for trava, quer := range map[string]string{"esperar": "devolver inicio barrado contar=false", "erro": "devolver inicio barrado contar=true"} {
		f := &filaFalsa{porTipo: map[string][]LinhaFila{"inicio": linhas[1:]}, trava: trava}
		m, _ := robo(t, f, nil, "inicio")
		m.Rodar(context.Background())
		if f.tem(quer) != 1 {
			t.Errorf("trava %s: %v", trava, f.chamadas)
		}
	}
}

func TestModoInvalidoSoNaquelaPassada(t *testing.T) {
	f := &filaFalsa{porTipo: map[string][]LinhaFila{"pedido": {{Chave: "p1", Numero: s("1"), Telefone: s("11987654321"), CriadoEm: agoraDentro}}}}
	m, _ := robo(t, f, nil, "pedido", "abandono")
	m.Cfg.Abandono.Modo = "talvez"
	err := m.Rodar(context.Background())
	if err == nil || err.Error() != "abandono: modo_invalido" || f.tem("marcar pedido p1 enviada") != 1 {
		t.Fatalf("err=%v chamadas=%v", err, f.chamadas)
	}
}

// O prazo da tarefa acaba no meio: a linha em envio termina (gravada mesmo com o contexto cancelado) e
// as seguintes voltam à fila SEM gastar tentativa; um envio pendurado até o prazo vira 'falhou' (nunca
// é reenviado).
func TestPrazoAcabaNoMeio(t *testing.T) {
	ctx, cancela := context.WithCancel(context.Background())
	defer cancela()
	f := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1"), linhaAbandono("t2")}, aoGravar: cancela} // o prazo vence logo depois da 1ª
	m, _ := robo(t, f, nil, "abandono")
	err := m.Rodar(ctx)
	if err == nil || err.Error() != "abandono: limite_de_tempo" {
		t.Fatalf("err=%v", err)
	}
	if f.tem("marcar abandono t1 enviada  conversa=77") != 1 || f.tem("devolver abandono t2 contar=false") != 1 {
		t.Fatalf("%s", strings.Join(f.chamadas, "\n"))
	}
	ctx2, cancela2 := context.WithTimeout(context.Background(), 300*time.Millisecond)
	defer cancela2()
	f2 := &filaFalsa{abandono: []LinhaAbandono{linhaAbandono("t1"), linhaAbandono("t2")}}
	m2, _ := robo(t, f2, func(met, c string, _ map[string]any) (int, string) {
		if met == "POST" && strings.HasSuffix(c, "/messages") {
			time.Sleep(500 * time.Millisecond) // pendura até o prazo
		}
		return 0, ""
	}, "abandono")
	m2.Rodar(ctx2)
	if f2.tem("marcar abandono t1 falhou enviar_template:0") != 1 || f2.tem("devolver abandono t1") != 0 || f2.tem("devolver abandono t2 contar=false") != 1 {
		t.Fatalf("%s", strings.Join(f2.chamadas, "\n"))
	}
}

func TestTarefaDasMensagens(t *testing.T) {
	tf := (&Mensagens{}).Tarefa()
	if tf.Nome != "enviar-mensagem-abandono" || tf.Agenda != "* * * * *" || tf.Limite != 4*time.Minute {
		t.Fatalf("%+v", tf)
	}
}
