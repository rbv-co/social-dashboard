package meta

import (
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

const escritaCampanha = `{"accountId":"conta-1","path":"/act_1/campaigns","method":"POST","params":{"name":"x"}}`

// Escrita que acabou sem resposta clara (core/rede caiu) pode ter gravado na Meta: a mesma escrita não repete.
func TestMetaEscritaIncertaNaoRepete(t *testing.T) {
	a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) {
		return 502, `{"erro":"falha ao falar com a Meta"}`, nil
	})
	if w := a.post("/meta-proxy", a.tokens[uMeta], escritaCampanha); w.Code != http.StatusInternalServerError {
		t.Fatalf("1ª: %d %s", w.Code, w.Body)
	}
	w := a.post("/meta-proxy", a.tokens[uMeta], escritaCampanha)
	if w.Code != http.StatusInternalServerError || !strings.Contains(w.Body.String(), "confira na Meta") {
		t.Fatalf("repetição deveria ser travada com 500: %d %s", w.Code, w.Body)
	}
	if a.core.n() != 1 {
		t.Fatalf("a repetição não pode chegar ao core: %d chamadas", a.core.n())
	}
	// outro corpo e outro ator não são "a mesma escrita"
	a.post("/meta-proxy", a.tokens[uMeta], strings.Replace(escritaCampanha, `"x"`, `"y"`, 1))
	a.post("/meta-proxy", a.tokens[uAdmin], escritaCampanha)
	if a.core.n() != 3 {
		t.Fatalf("escrita diferente deve passar: %d chamadas", a.core.n())
	}
}

// Desfecho conhecido (sucesso ou recusa definitiva) libera a repetição; leitura nunca é travada.
func TestMetaEscritaComDesfechoConhecidoLibera(t *testing.T) {
	for nome, st := range map[string]int{"sucesso": 200, "recusa da Graph": 400, "recuo 429": 429} {
		a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) { return st, `{}`, nil })
		a.post("/meta-proxy", a.tokens[uMeta], escritaCampanha)
		a.post("/meta-proxy", a.tokens[uMeta], escritaCampanha)
		if a.core.n() != 2 {
			t.Errorf("%s: a repetição deveria passar (%d chamadas)", nome, a.core.n())
		}
	}
	a := montarMeta(t, func(core.PedidoMeta) (int, string, map[string]string) { return 502, `{}`, nil })
	leitura := `{"accountId":"conta-1","path":"/act_1/campaigns"}`
	a.post("/meta-proxy", a.tokens[uMeta], leitura)
	a.post("/meta-proxy", a.tokens[uMeta], leitura)
	if a.core.n() != 2 {
		t.Errorf("leitura nunca é travada (%d chamadas)", a.core.n())
	}
}

func TestReservarExpira(t *testing.T) {
	p := &Proxy{}
	a, ok := p.reservar("k", time.Second)
	if _, outra := p.reservar("k", time.Second); !ok || outra {
		t.Fatal("a segunda reserva da mesma chave deve falhar")
	}
	p.escritas["k"] = time.Now().Add(-time.Second)
	b, ok := p.reservar("k", time.Second)
	if !ok {
		t.Fatal("reserva expirada deve liberar")
	}
	// a primeira escrita termina depois de a reserva dela vencer: não pode apagar a da segunda
	p.concluir("k", a, false)
	if _, outra := p.reservar("k", time.Second); outra {
		t.Fatal("concluir de reserva vencida não pode liberar a reserva de outra escrita")
	}
	p.concluir("k", b, false)
	if _, ok := p.reservar("k", time.Second); !ok {
		t.Fatal("concluir sem incerteza libera")
	}
}
