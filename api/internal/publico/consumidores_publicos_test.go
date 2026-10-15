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

// O que o CORE (vessel-cor-x/services/core/internal/cadastro/cadastro.go, `acoes`) chama na base, lido em 15/10/2026: as 14
// funções de escrita em `rest/v1/rpc/<nome>` e a edge `vessel-conta`. A virada troca só a base e a chave no `core.env`
// (CADASTRO_SUPABASE_URL/_CHAVE); nome que o Core chama e esta API não serve é 404 em produção (o visitante vê erro de
// cadastro). `{}` basta: o que se prova é que o nome existe (parâmetro faltando é 400, nunca 404).
var chamadasDoCore = []string{
	"vessel_entrar_na_lista", "vessel_marcar_objetivo_e_motivo", "vessel_detalhar_visita", "vessel_interesse_da_beauty_session",
	"vessel_solicitar_atendimento", "vessel_pedido_de_personal_atelier", "vessel_rsvp_da_private_edit", "vessel_rsvp_da_convidada",
	"vessel_pedido_do_stylist", "vessel_candidatar_vaga", "vessel_registrar_cartao", "vessel_identificar_client_advisor",
	"vessel_ligar_vendedor", "vessel_marcar_presenca",
}

func TestCoreChamaSoOQueACentralServe(t *testing.T) {
	m := novoMundo(t, func(s *Servico) { s.SoCore = true; s.Edges = map[string]Edge{"vessel-conta": s.Conta(&falsoEmail{})} })
	for _, nome := range chamadasDoCore {
		if st, resp, _ := m.pedido(t, "/rest/v1/rpc/"+nome, `{}`, comCore, "apikey: "+segredoDoCore); st == 404 {
			t.Errorf("o Core chama %s e a Central não serve (404 %s)", nome, resp)
		}
	}
	if st, resp, _ := m.pedido(t, "/functions/v1/vessel-conta", `{}`, comCore); st == 404 {
		t.Errorf("o Core chama a edge vessel-conta e a Central não serve (404 %s)", resp)
	}
}
