package publico

import (
	"encoding/json"
	"testing"
)

// O que o site (repositório vessel-brasil) chama DIRETO na base, com a chave anônima do navegador, lido das 9 páginas em
// 15/10/2026 (`rest/v1/rpc/<nome>`; todo o resto do site passa pelo Core). Na virada a página troca só o host (script
// `ferramentas/trocar-base-da-central.mjs` do site), então cada chamada tem de ser atendida aqui, com o corpo que a página
// manda, MESMO com VESSEL_SO_CORE ligado (o site nunca mais escreve direto). A lista espelha `chamadas-da-central.test.mjs`
// do site: página nova que chame a base e não entre nas duas listas reprova lá.
var chamadasDoSite = []struct{ pagina, funcao, corpo string }{
	{"geradorprivateeditcard", "vessel_card_da_stylist", `{"p_quem":"sty-0001"}`},
	{"private-appointment", "vessel_visita_do_stylist", `{"p_codigo":"sty-0001","p_via":"qr"}`},
	{"private-appointment", "vessel_visita_da_sessao", `{"p_codigo":"EV-0001","p_peca":"cartao","p_via":"qr"}`},
	{"verify", "vessel_verificar", `{"p_codigo":"ABXCKN5PZA"}`},
	{"private-edit", "vessel_convite_da_private_edit", `{"p_chave":"chave-inexistente"}`},
	{"private-edit", "vessel_convite_da_convidada", `{"p_chave":"chave-inexistente","p_convidada":"conv-1"}`},
	{"prevenda", "vessel_pre_venda_restantes", `{}`},
	{"geradorappointmentcard", "vessel_horarios_ocupados", `{"p_loja":"tivoli","p_data":"2026-10-20"}`},
	{"confirmar-presenca", "vessel_leitura_do_card", `{"p_chave":"chave-inexistente"}`},
	{"beauty-sessions", "vessel_visita_da_sessao", `{"p_codigo":"EV-0001","p_peca":"mesa","p_via":"qr"}`},
	{"sua-visita", "vessel_abrir_convite", `{"p_codigo":"CV-0001","p_praca":"tivoli","p_client_advisor":"ca-1","p_via":"qr"}`},
}

func TestSiteVesselBrasilFuncionaNaCentral(t *testing.T) {
	m := novoMundo(t, func(s *Servico) { s.SoCore = true })
	const origem = "https://vesselbrasil.com.br"
	for _, c := range chamadasDoSite {
		st, resp, h := m.pedido(t, "/rest/v1/rpc/"+c.funcao, c.corpo,
			"Origin: "+origem, "apikey: anon-do-navegador", "Authorization: Bearer anon-do-navegador")
		if st != 200 {
			t.Errorf("%s (%s) = %d %s, esperava 200", c.funcao, c.pagina, st, resp)
			continue
		}
		if !json.Valid([]byte(resp)) {
			t.Errorf("%s (%s): corpo não é JSON: %.80s", c.funcao, c.pagina, resp)
		}
		if h.Get("Access-Control-Allow-Origin") != origem {
			t.Errorf("%s (%s): sem CORS para %s: %q", c.funcao, c.pagina, origem, h.Get("Access-Control-Allow-Origin"))
		}
	}
}
