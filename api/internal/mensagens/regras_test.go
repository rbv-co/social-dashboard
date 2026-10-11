package mensagens

import (
	"encoding/json"
	"math"
	"slices"
	"testing"
	"time"
)

func s(v string) *string { return &v }

// Esperados gerados com o próprio _shared/mensagem-de-abandono.js (Node 22).
func TestNomesComoAEdge(t *testing.T) {
	for _, c := range []struct {
		entrada         string
		completo, curto string
	}{
		{"maysa priscila", "Maysa Priscila", "Maysa"},
		{"MARIA DA SILVA", "Maria da Silva", "Maria"},
		{"ana-clara d'avila", "Ana-Clara D'Avila", "Ana-Clara"},
		{"DeAndre mcKenzie", "DeAndre mcKenzie", "DeAndre"},
		{"  joão   E maria ", "João e Maria", "João"},
		{"ÉRICA DOS SANTOS", "Érica dos Santos", "Érica"},
		{"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx y", "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx Y", "Xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"},
	} {
		if got := formatarNomeCompleto(s(c.entrada)); got == nil || *got != c.completo {
			t.Errorf("formatarNomeCompleto(%q) = %v", c.entrada, got)
		}
		if got := primeiroNome(s(c.entrada)); got != c.curto {
			t.Errorf("primeiroNome(%q) = %q", c.entrada, got)
		}
	}
	for _, vazio := range []*string{nil, s(""), s("   ")} {
		if formatarNomeCompleto(vazio) != nil || primeiroNome(vazio) != "cliente" {
			t.Errorf("vazio %v: nome completo nulo e primeiro nome 'cliente'", vazio)
		}
	}
}

func TestNormalizarTelefone(t *testing.T) {
	for entrada, quer := range map[string]string{
		"(11) 98765-4321": "5511987654321", "5511987654321": "5511987654321", "+55 11 98765-4321": "5511987654321",
		"0055 11 98765-4321": "5511987654321", "1187654321": "", "551187654321": "", "11 8765-4321": "", "abc": "",
	} {
		if got := normalizarTelefone(s(entrada)); got != quer {
			t.Errorf("%q = %q, esperava %q", entrada, got, quer)
		}
	}
}

func TestTemplatesComoAEdge(t *testing.T) {
	b, _ := json.Marshal(templateMarketing("abandono_v2", "pt_BR", s("maria silva"), "abc?key=1"))
	if string(b) != `{"name":"abandono_v2","category":"MARKETING","language":"pt_BR","processed_params":{"body":{"1":"Maria"},"buttons":[{"type":"url","parameter":"abc?key=1"}]}}` {
		t.Fatalf("%s", b)
	}
	b, _ = json.Marshal(templatePedido("pedido_v1", "pt_BR", s("MARIA"), s("1001")))
	if string(b) != `{"name":"pedido_v1","category":"UTILITY","language":"pt_BR","processed_params":{"body":{"1":"Maria","2":"1001"}}}` {
		t.Fatalf("pedido sem botão: %s", b)
	}
}

func TestValidarConfigComoAEdge(t *testing.T) {
	ruim := Passada{Modo: "ligado", Limite: math.NaN(), LinkBase: "https://x"}
	quer := []string{"ENVIO_LIMITE_POR_RODADA inválido (inteiro de 1 a 100)", "LINK_BASE vazio ou sem a barra final", "TEMPLATE_NOME vazio",
		"CHATWOOT_URL vazio ou sem http(s)", "CHATWOOT_CONTA_ID vazio", "CHATWOOT_CAIXA_ID vazio ou inválido", "CHATWOOT_API_TOKEN vazio"}
	if got := validarConfig(ruim, ChatwootConfig{URL: "x", CaixaID: "0"}, true); !slices.Equal(got, quer) {
		t.Fatalf("%q", got)
	}
	lista := Passada{Modo: "lista", Limite: 10, LinkBase: "https://x/", TemplateNome: "t"}
	if got := validarConfig(lista, ChatwootConfig{URL: "https://c", ContaID: "1", CaixaID: "2", Token: "k"}, true); !slices.Equal(got, []string{"ENVIO_SO_PARA vazio"}) {
		t.Fatalf("%q", got)
	}
	if got := validarConfig(Passada{Modo: "seco", Limite: 200}, ChatwootConfig{}, false); !slices.Equal(got, quer[:1]) {
		t.Fatalf("seco só exige limite (e link quando o tipo exige): %q", got)
	}
}

func TestLerConfigNasceDesligadoEComOsPadroes(t *testing.T) {
	env := map[string]string{"ENVIO_MODO": "seco", "ENVIO_SO_PARA": "(11) 98765-4321, ,5521999990000", "RESERVAR_AVISO_CHATWOOT": "true",
		"ENVIO_LIMITE_POR_RODADA": "abc", "ABANDONO_TRAVA_CRUZADA": "Não"}
	c := LerConfig(func(k string) string { return env[k] })
	if c.Inicio.Modo != "desligado" || c.Pedido.Modo != "desligado" || c.Followup.Modo != "desligado" || c.Abandono.Modo != "seco" {
		t.Fatalf("modos: %+v", c)
	}
	if c.Inicio.MaxHoras != 1 || c.Pedido.MaxHoras != 2 || c.Abandono.MaxHoras != 24 || c.Followup.MaxHoras != 24 || c.FollowupAposHoras != 48 {
		t.Fatalf("padrões de horas: %+v", c)
	}
	if !math.IsNaN(c.Abandono.Limite) || !c.Pedido.ReservarAviso || c.Abandono.ReservarAviso || c.Abandono.TravaCruzada || c.Abandono.Idioma != "pt_BR" {
		t.Fatalf("%+v", c.Abandono)
	}
	if !slices.Equal(c.Abandono.SoPara, []string{"11987654321", "5521999990000"}) {
		t.Fatalf("soPara: %q", c.Abandono.SoPara)
	}
	if !travaCruzadaLigada("") || !travaCruzadaLigada("sim") || travaCruzadaLigada(" OFF ") {
		t.Fatal("trava cruzada padrão LIGADA")
	}
}

func TestDecidir(t *testing.T) {
	dentro := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC) // 12:00 em SP
	fora := time.Date(2026, 10, 11, 0, 30, 0, 0, time.UTC)   // 21:30 em SP
	base := "https://loja.com/checkouts/"
	l := LinhaAbandono{Token: "t", Telefone: s("11 98765-4321"), Status: "fila_envio", URL: s(base + "abc?key=1")}
	if d := decidirEnvio(l, nil, dentro, base); d.Acao != "enviar" || d.Telefone != "5511987654321" || d.Sufixo != "abc?key=1" {
		t.Fatalf("%+v", d)
	}
	for nome, c := range map[string]struct {
		l      LinhaAbandono
		agora  time.Time
		bloq   map[string]bool
		motivo string
	}{
		"saiu da fila": {LinhaAbandono{Status: "comprou", Telefone: l.Telefone, URL: l.URL}, dentro, nil, "nao_esta_mais_na_fila"},
		"sem telefone": {LinhaAbandono{Status: "fila_envio", Telefone: s(" "), URL: l.URL}, dentro, nil, "sem_telefone"},
		"fixo":         {LinhaAbandono{Status: "fila_envio", Telefone: s("1132654321"), URL: l.URL}, dentro, nil, "telefone_invalido"},
		"pediu parar":  {l, dentro, map[string]bool{"5511987654321": true}, "pediu_para_nao_receber"},
		"outra base":   {LinhaAbandono{Status: "fila_envio", Telefone: l.Telefone, URL: s("https://outra/x")}, dentro, nil, "sem_link"},
		"fora janela":  {l, fora, nil, "fora_da_janela"},
	} {
		if d := decidirEnvio(c.l, c.bloq, c.agora, base); d.Motivo != c.motivo {
			t.Errorf("%s: %+v", nome, d)
		}
	}
	f := LinhaFila{Chave: "k", Telefone: l.Telefone}
	if d := decidirLinha("pedido", f, map[string]bool{"5511987654321": true}, dentro, ""); d.Acao != "enviar" {
		t.Fatalf("pedido é transacional: ignora bloqueados e link: %+v", d)
	}
	if d := decidirLinha("inicio", f, nil, dentro, base); d.Acao != "esperar" || d.Motivo != "sem_link_ainda" {
		t.Fatalf("inicio sem link ainda espera: %+v", d)
	}
	if d := decidirLinha("followup", f, nil, dentro, base); d.Motivo != "sem_link" {
		t.Fatalf("followup sem link é ignorado: %+v", d)
	}
	if amostraDoSufixo("abc?KEY=segredo&x=1") != "abc?KEY=…&x=1" {
		t.Fatal("a chave de recuperação não vai para o log")
	}
}

// Ruling 32: ENVIO_ATRASO_MINUTOS que não é número nasce NaN (a rodada o reprova: inteiro a partir de 0).
func TestAtrasoQueNaoENumeroNasceNaN(t *testing.T) {
	for entrada, ok := range map[string]bool{"": true, "0": true, "5": true, " 7 ": true, "abc": false, "5min": false, "-1": true, "2.5": true} {
		env := map[string]string{"ENVIO_ATRASO_MINUTOS": entrada}
		got := LerConfig(func(k string) string { return env[k] }).Abandono.AtrasoMin
		if math.IsNaN(got) == ok {
			t.Errorf("%q = %v", entrada, got)
		}
	}
	if inteiro(math.NaN()) || inteiro(2.5) || !inteiro(0) {
		t.Fatal("inteiro: NaN e fração reprovam")
	}
}

// ---- Fix round 1 ----

// Importante 2 (M8, M22): a janela é 08:00 <= hora < 21:00 em Brasília, e vale para TODOS os tipos
// (inicio, followup, pedido, abandono). Os instantes estão em UTC de propósito: 23:30Z já é 20:30 em SP
// (dentro) e 08:00Z é 05:00 em SP (fora); olhar a hora do UTC erraria os dois.
func TestJanelaDeEnvioEmSaoPaulo(t *testing.T) {
	base := "https://loja.com/checkouts/"
	l := LinhaAbandono{Token: "t", Telefone: s("11 98765-4321"), Status: "fila_envio", URL: s(base + "abc?key=1")}
	f := LinhaFila{Chave: "k", Telefone: l.Telefone, URL: s(base + "abc?key=1")}
	for _, c := range []struct {
		quando  time.Time
		dentro  bool
		descric string
	}{
		{time.Date(2026, 10, 10, 7, 59, 59, 0, saoPaulo), false, "07:59:59 SP"},
		{time.Date(2026, 10, 10, 8, 0, 0, 0, saoPaulo), true, "08:00:00 SP"},
		{time.Date(2026, 10, 10, 20, 59, 59, 0, saoPaulo), true, "20:59:59 SP"},
		{time.Date(2026, 10, 10, 21, 0, 0, 0, saoPaulo), false, "21:00:00 SP"},
		{time.Date(2026, 10, 10, 10, 59, 0, 0, time.UTC), false, "10:59Z = 07:59 SP"},
		{time.Date(2026, 10, 10, 11, 0, 0, 0, time.UTC), true, "11:00Z = 08:00 SP"},
		{time.Date(2026, 10, 10, 23, 30, 0, 0, time.UTC), true, "23:30Z = 20:30 SP (a hora do UTC diria fora)"},
		{time.Date(2026, 10, 11, 0, 0, 0, 0, time.UTC), false, "00:00Z = 21:00 SP"},
		{time.Date(2026, 10, 10, 8, 0, 0, 0, time.UTC), false, "08:00Z = 05:00 SP (a hora do UTC diria dentro)"},
		{time.Date(2026, 10, 10, 3, 0, 0, 0, saoPaulo), false, "madrugada"},
	} {
		quer := "esperar"
		if c.dentro {
			quer = "enviar"
		}
		if d := decidirEnvio(l, nil, c.quando, base); d.Acao != quer || (!c.dentro && d.Motivo != "fora_da_janela") {
			t.Errorf("abandono %s: %+v", c.descric, d)
		}
		for _, tipo := range []string{"inicio", "followup", "pedido"} {
			if d := decidirLinha(tipo, f, nil, c.quando, base); d.Acao != quer || (!c.dentro && d.Motivo != "fora_da_janela") {
				t.Errorf("%s %s: %+v", tipo, c.descric, d)
			}
		}
	}
}

// Importante 2 (M7): quem pediu para parar não recebe marketing (inicio e followup), em qualquer
// horário; o pedido é transacional e ignora a lista. O telefone do bloqueio é o normalizado.
func TestPediuParaNaoReceber(t *testing.T) {
	base := "https://loja.com/checkouts/"
	dentro := time.Date(2026, 10, 10, 15, 0, 0, 0, time.UTC)
	f := LinhaFila{Chave: "k", Telefone: s("(11) 98765-4321"), URL: s(base + "abc?key=1")}
	bloq := map[string]bool{"5511987654321": true}
	outro := map[string]bool{"5511911112222": true}
	for _, tipo := range []string{"inicio", "followup"} {
		if d := decidirLinha(tipo, f, bloq, dentro, base); d.Acao != "ignorar" || d.Motivo != "pediu_para_nao_receber" {
			t.Errorf("%s bloqueado: %+v", tipo, d)
		}
		if d := decidirLinha(tipo, f, outro, dentro, base); d.Acao != "enviar" {
			t.Errorf("%s: bloqueio de OUTRO telefone não vale: %+v", tipo, d)
		}
		// o bloqueio vence a janela e o link: ignorar (definitivo), não esperar.
		fora := time.Date(2026, 10, 11, 1, 0, 0, 0, time.UTC)
		if d := decidirLinha(tipo, f, bloq, fora, base); d.Motivo != "pediu_para_nao_receber" {
			t.Errorf("%s bloqueado fora da janela: %+v", tipo, d)
		}
	}
	if d := decidirLinha("pedido", f, bloq, dentro, base); d.Acao != "enviar" {
		t.Errorf("pedido é transacional: %+v", d)
	}
}

// M10: DDD com zero (01, 10, 50...) não é celular; o 9 é obrigatório.
func TestTelefoneDDDComZero(t *testing.T) {
	for _, ruim := range []string{"(01) 98765-4321", "(10) 98765-4321", "5501987654321", "5510987654321", "(11) 88765-4321", "(11) 8765-4321 5", "551198765432", "55119876543210"} {
		if got := normalizarTelefone(s(ruim)); got != "" {
			t.Errorf("%q = %q, esperava inválido", ruim, got)
		}
	}
	for entrada, quer := range map[string]string{"(11) 91234-5678": "5511912345678", "(99) 99999-9999": "5599999999999", "(19) 98765-4321": "5519987654321"} {
		if got := normalizarTelefone(s(entrada)); got != quer {
			t.Errorf("%q = %q", entrada, got)
		}
	}
	if normalizarTelefone(nil) != "" {
		t.Error("nil")
	}
}

// numeroJS = Number() do JS: vazio é o padrão ("" é falsy no `v || padrao`); "  " é 0; "1_0", "inf",
// "nan" e "5min" são NaN; "Infinity" (caixa exata) é infinito; 0x/0b/0o valem.
func TestNumeroJS(t *testing.T) {
	nan, inf := math.NaN(), math.Inf(1)
	for entrada, quer := range map[string]float64{
		"": 7, "0": 0, " 5 ": 5, "  ": 0, "\u00a05\ufeff": 5, "+3": 3, "-2": -2, "2.5": 2.5, ".5": 0.5, "5.": 5, "1e2": 100, "1E-1": 0.1,
		"Infinity": inf, "+Infinity": inf, "-Infinity": math.Inf(-1), "1e999": inf,
		"0x10": 16, "0b11": 3, "0o17": 15,
		"1_0": nan, "inf": nan, "INF": nan, "infinity": nan, "INFINITY": nan, "nan": nan, "NaN": nan, "abc": nan, "5min": nan, "1,5": nan,
		"0x": nan, "-0x10": nan, "1e": nan, "--1": nan, "1 2": nan, "٣": nan, "0x1p3": nan, "1.2.3": nan,
	} {
		got := numeroJS(entrada, 7)
		if math.IsNaN(quer) != math.IsNaN(got) || (!math.IsNaN(quer) && got != quer) {
			t.Errorf("numeroJS(%q) = %v, esperava %v", entrada, got, quer)
		}
	}
	if got := numeroJS("", math.NaN()); !math.IsNaN(got) {
		t.Error("padrão NaN (CHATWOOT_CAIXA_ID vazio)")
	}
}

// FOLLOWUP_APOS_HORAS vai para agendar_followups(int, int): infinito, NaN, fração e negativo reprovam.
func TestFollowupAposHorasInvalidoReprova(t *testing.T) {
	cfg := func(v string) Config {
		env := map[string]string{"FOLLOWUP_APOS_HORAS": v}
		return LerConfig(func(k string) string { return env[k] })
	}
	for _, ruim := range []string{"Infinity", "-Infinity", "1e999", "abc", "inf", "1_0", "2.5", "-1"} {
		if p := cfg(ruim).ProblemasDoFollowup(); !slices.Equal(p, []string{"FOLLOWUP_APOS_HORAS inválido (inteiro a partir de 0)"}) {
			t.Errorf("%q: %q", ruim, p)
		}
	}
	for _, bom := range []string{"", "0", "48", " 72 "} {
		if p := cfg(bom).ProblemasDoFollowup(); len(p) != 0 {
			t.Errorf("%q: %q", bom, p)
		}
	}
	// ENVIO_ATRASO_MINUTOS e os limites também não podem virar "sem limite" com Infinity: o validador recusa.
	if p := validarConfig(Passada{Modo: "seco", Limite: math.Inf(1)}, ChatwootConfig{}, false); len(p) != 1 {
		t.Errorf("limite infinito: %q", p)
	}
	if inteiro(math.Inf(1)) || inteiro(math.Inf(-1)) {
		t.Error("inteiro(Inf)")
	}
}
