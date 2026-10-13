package trafego

import (
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// TestAnalises: as duas leituras do robô (orçamento e anúncio) na matriz de pessoas.
func TestAnalises(t *testing.T) {
	m := novoMundo(t, montarFila)
	todas := []string{"gestorTodas", "adminA1"}
	so1 := []string{"gestorA1", "impersonado"}
	nenhuma := []string{"gestorNenhuma", "superA1", "leitor", "semModulo"}
	for _, rota := range []struct{ caminho, de1, de2 string }{
		{"/gestao-trafego/analises-de-orcamento", `"campaign_id":"9001"`, `"campaign_id":"9002"`},
		{"/gestao-trafego/analises-de-anuncio", `"ad_id":"7001"`, `"ad_id":"7002"`},
	} {
		for _, q := range todas {
			st, corpo := m.Pedir(t, q, "GET", rota.caminho, "")
			if st != 200 || !strings.Contains(corpo, rota.de1) || !strings.Contains(corpo, rota.de2) {
				t.Errorf("%s %s: %d %s", rota.caminho, q, st, corpo)
			}
		}
		for _, q := range so1 {
			st, corpo := m.Pedir(t, q, "GET", rota.caminho, "")
			if st != 200 || !strings.Contains(corpo, rota.de1) || strings.Contains(corpo, rota.de2) {
				t.Errorf("%s %s: %d %s", rota.caminho, q, st, corpo)
			}
		}
		for _, q := range nenhuma {
			if st, corpo := m.Pedir(t, q, "GET", rota.caminho, ""); st != 200 || corpo != "[]" {
				t.Errorf("%s %s: %d %s, esperava []", rota.caminho, q, st, corpo)
			}
		}
		if st, _ := m.Pedir(t, "desativado", "GET", rota.caminho, ""); st != 401 {
			t.Errorf("%s desativado: %d", rota.caminho, st)
		}
		// IDOR: A2 pedida por quem só tem A1
		if st, corpo := m.Pedir(t, "gestorA1", "GET", rota.caminho+"?account_id="+A2, ""); st != 200 || corpo != "[]" {
			t.Errorf("%s ?account_id=A2 como gestorA1: %d %s", rota.caminho, st, corpo)
		}
		if st, _ := m.Pedir(t, "gestorTodas", "GET", rota.caminho+"?ordem=veredito", ""); st != 400 {
			t.Errorf("%s ?ordem=veredito: %d", rota.caminho, st)
		}
		if st, _ := m.Pedir(t, "gestorTodas", "GET", rota.caminho+"?limite=1001", ""); st != 400 {
			t.Errorf("%s ?limite=1001: %d", rota.caminho, st)
		}
	}
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "anúncio veredito=pausar", Quem: "gestorTodas", Metodo: "GET", Caminho: "/gestao-trafego/analises-de-anuncio?veredito=pausar", Status: 200, Tem: `"ad_id":"7002"`, NaoTem: `"ad_id":"7003"`},
		{Nome: "anúncio veredito=pausar tem a 7001", Quem: "gestorTodas", Metodo: "GET", Caminho: "/gestao-trafego/analises-de-anuncio?veredito=pausar", Status: 200, Tem: `"ad_id":"7001"`},
		{Nome: "orçamento: impactos preservados", Quem: "gestorTodas", Metodo: "GET", Caminho: "/gestao-trafego/analises-de-orcamento", Status: 200, Tem: `"impactos":{"conversas": 3}`},
		{Nome: "anúncio por campanha", Quem: "gestorTodas", Metodo: "GET", Caminho: "/gestao-trafego/analises-de-anuncio?campaign_id=9002", Status: 200, Tem: `"ad_id":"7002"`, NaoTem: `"ad_id":"7001"`},
	})
	// ordem padrão: 9002 (09h) antes de 9001 (08h)
	_, corpo := m.Pedir(t, "gestorTodas", "GET", "/gestao-trafego/analises-de-orcamento", "")
	if strings.Index(corpo, `"campaign_id":"9002"`) > strings.Index(corpo, `"campaign_id":"9001"`) {
		t.Errorf("ordem padrão das análises de orçamento: %s", corpo)
	}
	if st, corpo := m.Pedir(t, "gestorTodas", "GET", "/gestao-trafego/analises-de-orcamento?veredito=escalar", ""); st != 200 || strings.Contains(corpo, `"9002"`) {
		t.Errorf("veredito=escalar: %d %s", st, corpo)
	}
}

func TestDecisoesLer(t *testing.T) {
	m := novoMundo(t, montarFila)
	c := "/gestao-trafego/decisoes"
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "gestorA1 vê 9001 e 9003, não 9002", Quem: "gestorA1", Metodo: "GET", Caminho: c, Status: 200, Tem: `"campaign_id":"9003"`, NaoTem: `"campaign_id":"9002"`},
		{Nome: "gestorA1 vê 9001", Quem: "gestorA1", Metodo: "GET", Caminho: c, Status: 200, Tem: `"campaign_id":"9001"`},
		{Nome: "impersonado idem", Quem: "impersonado", Metodo: "GET", Caminho: c, Status: 200, Tem: `"campaign_id":"9003"`, NaoTem: `"campaign_id":"9002"`},
		{Nome: "gestorNenhuma só a sem conta", Quem: "gestorNenhuma", Metodo: "GET", Caminho: c, Status: 200, Tem: `"campaign_id":"9003"`, NaoTem: `"campaign_id":"9001"`},
		{Nome: "gestorNenhuma não vê 9002", Quem: "gestorNenhuma", Metodo: "GET", Caminho: c, Status: 200, NaoTem: `"campaign_id":"9002"`},
		{Nome: "adminA1 vê as três", Quem: "adminA1", Metodo: "GET", Caminho: c, Status: 200, Tem: `"campaign_id":"9002"`},
		{Nome: "superA1 não é gestor", Quem: "superA1", Metodo: "GET", Caminho: c, Status: 200, Tem: "[]"},
		{Nome: "leitor", Quem: "leitor", Metodo: "GET", Caminho: c, Status: 200, Tem: "[]"},
		{Nome: "semModulo", Quem: "semModulo", Metodo: "GET", Caminho: c, Status: 200, Tem: "[]"},
		{Nome: "desativado", Quem: "desativado", Metodo: "GET", Caminho: c, Status: 401},
		{Nome: "escopo=saude", Quem: "gestorTodas", Metodo: "GET", Caminho: c + "?escopo=saude&ordem=decidido_em.desc", Status: 200, Tem: `"campaign_id":"9002"`, NaoTem: `"campaign_id":"9001"`},
		{Nome: "escopo=criativos", Quem: "gestorTodas", Metodo: "GET", Caminho: c + "?escopo=criativos&ordem=decidido_em.desc", Status: 200, Tem: `"campaign_id":"9003"`, NaoTem: `"campaign_id":"9002"`},
		{Nome: "IDOR account_id=A2", Quem: "gestorA1", Metodo: "GET", Caminho: c + "?account_id=" + A2, Status: 200, Tem: "[]"},
		{Nome: "contar gestorA1", Quem: "gestorA1", Metodo: "GET", Caminho: c + "?contar=1&limite=1", Status: 200},
		{Nome: "ordem inválida", Quem: "gestorTodas", Metodo: "GET", Caminho: c + "?ordem=veredito", Status: 400},
		{Nome: "limite inválido", Quem: "gestorTodas", Metodo: "GET", Caminho: c + "?limite=1001", Status: 400},
		{Nome: "filtro fora da lista", Quem: "gestorTodas", Metodo: "GET", Caminho: c + "?decidido_em=hoje", Status: 400},
	})
	_, corpo := m.Pedir(t, "gestorTodas", "GET", c, "")
	i2, i1, i3 := strings.Index(corpo, `"9002"`), strings.Index(corpo, `"9001"`), strings.Index(corpo, `"9003"`)
	if !(i2 >= 0 && i2 < i1 && i1 < i3) {
		t.Errorf("ordem padrão das decisões (9002, 9001, 9003): %s", corpo)
	}
	for _, c := range []struct{ quem, total string }{{"gestorA1", "2"}, {"gestorTodas", "3"}} {
		w := m.Resposta(t, c.quem, "GET", "/gestao-trafego/decisoes?contar=1&limite=1", "")
		if got := w.Header().Get("X-Total-Count"); w.Code != 200 || got != c.total {
			t.Errorf("%s X-Total-Count = %q (%d), esperava %s", c.quem, got, w.Code, c.total)
		}
	}
	if strings.Contains(corpo, "decidido_por") {
		t.Errorf("decidido_por saiu na leitura: %s", corpo)
	}
}

func TestDecisoesCriar(t *testing.T) {
	m := novoMundo(t, montarFila)
	const rota = "/gestao-trafego/decisoes"
	corpo := func(campo string) string {
		return `{"campaign_id":"9001","account_id":"` + A1 + `","veredito":"escalar","decisao":"recusada","escopo":"orcamento"` + campo + `}`
	}
	foto := m.Um(t, fotoDoTrafego)
	intacto := mundoteste.Caso{Efeito: fotoDoTrafego, Quer: foto}

	negados := []mundoteste.Caso{
		{Nome: "gestorA1 com A2 (conta que não vê)", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 403,
			Corpo: `{"campaign_id":"9002","account_id":"` + A2 + `","veredito":"reduzir","decisao":"aprovada"}`},
		{Nome: "gestorA1 com A3 (não existe)", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 403,
			Corpo: `{"campaign_id":"9002","account_id":"` + A3 + `","veredito":"reduzir","decisao":"aprovada"}`},
		{Nome: "gestorNenhuma com A1", Quem: "gestorNenhuma", Metodo: "POST", Caminho: rota, Status: 403, Corpo: corpo("")},
		{Nome: "leitor", Quem: "leitor", Metodo: "POST", Caminho: rota, Status: 403, Corpo: corpo("")},
		{Nome: "superA1", Quem: "superA1", Metodo: "POST", Caminho: rota, Status: 403, Corpo: corpo("")},
		{Nome: "semModulo", Quem: "semModulo", Metodo: "POST", Caminho: rota, Status: 403, Corpo: corpo("")},
		{Nome: "impersonado", Quem: "impersonado", Metodo: "POST", Caminho: rota, Status: 403, Tem: "Quem entrou como outra pessoa", Corpo: corpo("")},
		{Nome: "sem sessão", Quem: "", Metodo: "POST", Caminho: rota, Status: 401, Corpo: corpo("")},
		{Nome: "decidido_por no corpo", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Tem: "corpo_invalido", Corpo: corpo(`,"decidido_por":"` + idGestorTodas + `"`)},
		{Nome: "silenciar_ate no corpo", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Tem: "corpo_invalido", Corpo: corpo(`,"silenciar_ate":"2099-01-01T00:00:00Z"`)},
		{Nome: "id no corpo", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: corpo(`,"id":1`)},
		{Nome: "decisao talvez", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), `"recusada"`, `"talvez"`, 1)},
		{Nome: "decisao ausente", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), `,"decisao":"recusada"`, ``, 1)},
		{Nome: "campaign_id abc", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), `"9001"`, `"abc"`, 1)},
		{Nome: "sem campaign_id", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), `"campaign_id":"9001",`, ``, 1)},
		{Nome: "veredito vazio", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), `"escalar"`, `""`, 1)},
		{Nome: "account_id x", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), A1, "x", 1)},
		{Nome: "escopo inválido", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 400, Corpo: strings.Replace(corpo(""), `"orcamento"`, `"tudo"`, 1)},
	}
	for _, c := range negados {
		m.Rodar(t, []mundoteste.Caso{c, {Nome: c.Nome + ": intacto", Efeito: intacto.Efeito, Quer: intacto.Quer}})
	}

	// I-1: a conta é a da CAMPANHA (campaigns), não a do corpo
	for _, c := range []mundoteste.Caso{
		{Nome: "campanha de A2, conta nula", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 403,
			Corpo: `{"campaign_id":"9002","account_id":null,"veredito":"reduzir","decisao":"recusada"}`},
		{Nome: "campanha de A2, conta omitida", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 403,
			Corpo: `{"campaign_id":"9002","veredito":"reduzir","decisao":"recusada"}`},
		{Nome: "campanha de A2, conta A1", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 403,
			Corpo: `{"campaign_id":"9002","account_id":"` + A1 + `","veredito":"reduzir","decisao":"recusada"}`},
		{Nome: "adminA1: campanha de A1 com conta A2 (divergente, mesmo vendo as duas)", Quem: "adminA1", Metodo: "POST", Caminho: rota, Status: 403,
			Corpo: `{"campaign_id":"9001","account_id":"` + A2 + `","veredito":"reduzir","decisao":"recusada"}`},
	} {
		m.Rodar(t, []mundoteste.Caso{c, {Nome: c.Nome + ": intacto", Efeito: intacto.Efeito, Quer: intacto.Quer}})
	}

	// permitido: gestorA1 recusa na A1
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "gestorA1 recusa em A1", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 201, Tem: `"decisao":"recusada"`, NaoTem: "decidido_por", Corpo: corpo(`,"aplicado":[]`)},
		{Nome: "decidido_por da sessão", Efeito: `select decidido_por::text from gt_fila_decisoes where decisao = 'recusada' and campaign_id = '9001'`, Quer: idGestorA1},
		{Nome: "silêncio de 7 dias", Efeito: `select (silenciar_ate between now() + interval '7 days' - interval '1 minute' and now() + interval '7 days' + interval '1 minute')::text from gt_fila_decisoes where decidido_por = '` + idGestorA1 + `'`, Quer: "true"},
		{Nome: "aprovada: sem silêncio", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 201, Tem: `"decisao":"aprovada"`,
			Corpo: strings.Replace(corpo(""), `"recusada"`, `"aprovada"`, 1)},
		{Nome: "aprovada grava silenciar_ate nulo", Efeito: `select count(*)::text from gt_fila_decisoes where decidido_por = '` + idGestorA1 + `' and decisao = 'aprovada' and silenciar_ate is null`, Quer: "1"},
		{Nome: "sem conta, escopo padrão", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 201,
			Corpo: `{"campaign_id":"9004","account_id":null,"veredito":"pausar","decisao":"aprovada"}`},
		{Nome: "escopo padrão do banco", Efeito: `select escopo from gt_fila_decisoes where campaign_id = '9004'`, Quer: "orcamento"},
		{Nome: "sem conta fica nula", Efeito: `select coalesce(account_id, 'nula') from gt_fila_decisoes where campaign_id = '9004'`, Quer: "nula"},
		{Nome: "adminA1 com A2", Quem: "adminA1", Metodo: "POST", Caminho: rota, Status: 201,
			Corpo: `{"campaign_id":"9002","account_id":"` + A2 + `","veredito":"reduzir","decisao":"aprovada"}`},
		{Nome: "conta omitida também é sem conta", Quem: "gestorTodas", Metodo: "POST", Caminho: rota, Status: 201,
			Corpo: `{"campaign_id":"9005","veredito":"pausar","decisao":"aprovada"}`},
		{Nome: "total de linhas", Efeito: `select count(*)::text from gt_fila_decisoes`, Quer: "8"},
	})
	// I-1: campanha de A1 sem conta no corpo → o servidor grava A1; campanha desconhecida sem conta → nula
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "campanha de A1, conta nula", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 201,
			Corpo: `{"campaign_id":"9001","account_id":null,"veredito":"pausar","decisao":"aprovada","escopo":"saude"}`},
		{Nome: "conta preenchida com a da campanha", Efeito: `select account_id::text from gt_fila_decisoes where campaign_id = '9001' and escopo = 'saude'`, Quer: A1},
		{Nome: "campanha de A1, conta omitida", Quem: "gestorTodas", Metodo: "POST", Caminho: rota, Status: 201,
			Corpo: `{"campaign_id":"9001","veredito":"pausar","decisao":"aprovada","escopo":"criativos"}`},
		{Nome: "omitida também preenchida", Efeito: `select account_id::text from gt_fila_decisoes where campaign_id = '9001' and escopo = 'criativos' and decidido_por = '` + idGestorTodas + `' and decidido_em > now() - interval '1 minute'`, Quer: A1},
		{Nome: "campanha desconhecida, conta nula", Quem: "gestorA1", Metodo: "POST", Caminho: rota, Status: 201,
			Corpo: `{"campaign_id":"9099","account_id":null,"veredito":"pausar","decisao":"aprovada"}`},
		{Nome: "desconhecida fica nula", Efeito: `select coalesce(account_id, 'nula') from gt_fila_decisoes where campaign_id = '9099'`, Quer: "nula"},
	})
	if st, c := m.Pedir(t, "gestorA1", "POST", rota, "lixo"); st != http.StatusBadRequest {
		t.Errorf("corpo lixo: %d %s", st, c)
	}
}
