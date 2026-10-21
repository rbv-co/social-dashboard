package publico

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// falsoEspelho responde `pedidos` e `pedido_itens` do espelho do core e guarda as consultas.
type falsoEspelho struct {
	mu       sync.Mutex
	pedidos  []map[string]any
	itens    []map[string]any
	err      map[string]error // por tabela
	consulta []string         // "tabela?query"
}

func (f *falsoEspelho) EspelhoTodas(_ context.Context, tabela string, q url.Values) (*core.Leitura, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.consulta = append(f.consulta, tabela+"?"+q.Encode())
	if e := f.err[tabela]; e != nil {
		return nil, e
	}
	if tabela == "pedidos" {
		return &core.Leitura{Linhas: f.pedidos}, nil
	}
	return &core.Leitura{Linhas: f.itens}, nil
}

func compraDeAnaNoEspelho() *falsoEspelho {
	return &falsoEspelho{
		pedidos: []map[string]any{
			{"pedido_id_bling": "700", "numero": 4000, "data": "2025-06-01", "contato_id": "55"},
			{"pedido_id_bling": "777", "numero": 5001, "data": "2026-01-10", "contato_id": "987654321012345678"},
		},
		itens: []map[string]any{
			{"pedido_id_bling": "700", "codigo": "SS1162-P"},
			{"pedido_id_bling": "777", "codigo": "SS0001HB.S1-PRETO"},
		},
	}
}

func mundoDaGarantiaNoEspelho(t *testing.T, bling *falsoBling, e *falsoEspelho) *mundo {
	t.Helper()
	email := &falsoEmail{}
	m := novoMundo(t, func(s *Servico) {
		s.Espelho = e
		s.Edges = map[string]Edge{"vessel-conta": s.Conta(email), "vessel-registrar-garantia": s.Garantia(bling)}
	})
	if _, err := m.P.Exec(t.Context(), selo); err != nil {
		t.Fatal(err)
	}
	return m
}

// Com o espelho ligado a garantia acha a compra pelo CPF SEM chamar o Bling, e nada do que o espelho devolveu volta à página.
func TestGarantiaNoEspelhoAprovaSemTocarNoBling(t *testing.T) {
	bling, e := &falsoBling{fora: true}, compraDeAnaNoEspelho() // Bling fora do ar: tem de aprovar mesmo assim
	m := mundoDaGarantiaNoEspelho(t, bling, e)
	st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0001", "529.982.247-25"))
	if st != 200 || o["estado"] != "aprovado" || o["garantia_ate"] == nil {
		t.Fatalf("resposta = %d %s", st, r)
	}
	if len(bling.pedido) != 0 {
		t.Fatalf("chamou o Bling %d vez(es): %+v", len(bling.pedido), bling.pedido)
	}
	if !strings.HasPrefix(e.consulta[0], "pedidos?") || !strings.Contains(e.consulta[0], "numero_documento=52998224725") {
		t.Errorf("consulta de pedidos = %s", e.consulta[0])
	}
	if got := m.um(t, `select (conferencia->>'pedido') || '|' || (conferencia->>'contato') from vessel_pedidos_de_registro where codigo = 'VBAAAA0001'`); got != "5001|987654321012345678" {
		t.Errorf("prova guardada = %s", got)
	}
	for _, sinal := range []string{"5001", "987654321012345678", "contato", "espelho"} {
		if strings.Contains(r, sinal) {
			t.Errorf("a resposta traz %q: %s", sinal, r)
		}
	}
}

func TestGarantiaNoEspelhoNuncaRecusa(t *testing.T) {
	casos := map[string]func(*falsoEspelho){
		"CPF sem pedido": func(e *falsoEspelho) { e.pedidos = nil },
		"outro modelo":   func(e *falsoEspelho) { e.itens = []map[string]any{{"pedido_id_bling": "777", "codigo": "SS1162-P"}} },
		"prefixo curto":  func(e *falsoEspelho) { e.itens = []map[string]any{{"pedido_id_bling": "777", "codigo": "SS0"}} },
		"item de outro pedido": func(e *falsoEspelho) {
			e.itens = []map[string]any{{"pedido_id_bling": "700", "codigo": "SS0001HB.S1-PRETO"}} // o do pedido 700 aprovaria o 700...
			e.pedidos = e.pedidos[1:]                                                             // ...que aqui nem foi devolvido
		},
	}
	for nome, ajusta := range casos {
		e := compraDeAnaNoEspelho()
		ajusta(e)
		m := mundoDaGarantiaNoEspelho(t, &falsoBling{}, e)
		st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0002", cpfAna))
		if st != 200 || o["estado"] != "pendente" {
			t.Errorf("%s: %d %s, esperava pendente", nome, st, r)
		}
		if m.um(t, `select count(*)::text from vessel_registros`) != "0" {
			t.Errorf("%s: aprovou sem a prova", nome)
		}
	}
}

func TestGarantiaNoEspelhoPegaOMaisNovoEOLimiteDe20(t *testing.T) {
	e := &falsoEspelho{}
	for i := 1; i <= 25; i++ { // 25 pedidos; só o mais antigo (data 2020) tem o modelo: fora dos 20 mais novos
		e.pedidos = append(e.pedidos, map[string]any{"pedido_id_bling": fmt.Sprint(1000 + i), "numero": 100 + i, "data": fmt.Sprintf("2026-02-%02d", i), "contato_id": "9"})
		e.itens = append(e.itens, map[string]any{"pedido_id_bling": fmt.Sprint(1000 + i), "codigo": "OUTRO-1"})
	}
	e.pedidos = append(e.pedidos, map[string]any{"pedido_id_bling": "1", "numero": 1, "data": "2020-01-01"})
	e.itens = append(e.itens, map[string]any{"pedido_id_bling": "1", "codigo": "SS0001HB.S1"})
	m := mundoDaGarantiaNoEspelho(t, &falsoBling{}, e)
	_, _, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0003", cpfAna))
	if o["estado"] != "pendente" {
		t.Fatalf("o pedido de 2020 está além dos 20 mais novos: %v", o)
	}
	if got := strings.Count(e.consulta[1], "pedido_id_bling%5B%5D="); got != 20 {
		t.Errorf("itens pedidos de %d pedidos, esperava 20 (%s)", got, e.consulta[1])
	}
}

// Espelho que não respondeu (ErrIndisponivel) = "tente de novo" (503), nada aprovado. Recusa 4xx do Core = nosso: pendente.
func TestGarantiaNoEspelhoFalhando(t *testing.T) {
	e := compraDeAnaNoEspelho()
	e.err = map[string]error{"pedidos": fmt.Errorf("%w: sem resposta", core.ErrIndisponivel)}
	m := mundoDaGarantiaNoEspelho(t, &falsoBling{}, e)
	st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0002", cpfAna))
	if st != 503 || o["motivo"] != "falhou" {
		t.Fatalf("espelho fora: %d %s", st, r)
	}
	e2 := compraDeAnaNoEspelho()
	e2.err = map[string]error{"pedido_itens": fmt.Errorf("core: espelho respondeu 422")}
	m2 := mundoDaGarantiaNoEspelho(t, &falsoBling{}, e2)
	st, r, o = m2.edge(t, "vessel-registrar-garantia", registro("VBAAAA0002", cpfAna))
	if st != 200 || o["estado"] != "pendente" {
		t.Fatalf("4xx do core: %d %s", st, r)
	}
	if m.um(t, `select count(*)::text from vessel_registros`) != "0" || m2.um(t, `select count(*)::text from vessel_registros`) != "0" {
		t.Error("aprovou sem a prova")
	}
}

func TestGarantiaNoEspelhoDocumentoTortoNaoConsultaNada(t *testing.T) {
	e := compraDeAnaNoEspelho()
	g := &garantia{e: e, ctx: context.Background()}
	if c, err := g.procurarACompraNoEspelho("123", "SS0001HB.S1"); c != nil || err != nil || len(e.consulta) != 0 {
		t.Fatalf("compra=%v err=%v consultas=%v", c, err, e.consulta)
	}
}

// Falha que repetir não resolve (resposta grande demais, sem token) é permanente: pendente, não "tente de novo".
func TestFalhouEspelhoClassifica(t *testing.T) {
	g := &garantia{ctx: context.Background()}
	for erro, permanente := range map[error]bool{
		core.ErrRespostaGrande: true, core.ErrSemToken: true, core.ErrIndisponivel: false,
	} {
		e, ok := g.falhouEspelho("pedidos", erro).(*erroDoBling)
		if !ok || e.permanente != permanente {
			t.Errorf("%v: %+v", erro, e)
		}
	}
}
