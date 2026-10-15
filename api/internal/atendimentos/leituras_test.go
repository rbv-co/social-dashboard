package atendimentos

import (
	"net/http"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// O mundo das 7 leituras (Plano 12): uma pessoa por porta de entrada das policies de produção. As policies são
// OU entre si, tabela a tabela: vessel_pode('atendimentos','ver') OU is_vessel_leads() ('meta.leads' em features
// ou super) nas da Vessel; o módulo 'carrinho' / 'abandono-carrinho' ou papel admin ou super nas de checkout.
const (
	lSuper     = "a6120000-0000-4000-a000-000000000001"
	lAtend     = "a6120000-0000-4000-a000-000000000002" // permissions {"atendimentos": ["ver"]}
	lLeads     = "a6120000-0000-4000-a000-000000000003" // features {meta.leads}
	lCarrinho  = "a6120000-0000-4000-a000-000000000004" // features {carrinho}
	lAbandono  = "a6120000-0000-4000-a000-000000000005" // features {abandono-carrinho}
	lAdmin     = "a6120000-0000-4000-a000-000000000006" // papel admin, sem permissions
	lViewer    = "a6120000-0000-4000-a000-000000000007" // nada
	lSoEditar  = "a6120000-0000-4000-a000-000000000008" // permissions {"atendimentos": ["editar"]}: vessel_pode exige ver
	lDesativ   = "a6120000-0000-4000-a000-000000000009"
	lMetaOutro = "a6120000-0000-4000-a000-00000000000a" // features {meta}: o módulo vizinho, não o 'meta.leads'
)

var pessoasDasLeituras = []mundoteste.Pessoa{
	{Chave: "super", ID: lSuper, Email: "super@x.com", Papel: "viewer", Super: true},
	{Chave: "atend", ID: lAtend, Email: "atend@x.com", Papel: "viewer"},
	{Chave: "leads", ID: lLeads, Email: "leads@x.com", Papel: "viewer", Modulos: []string{"meta.leads"}},
	{Chave: "carrinho", ID: lCarrinho, Email: "carrinho@x.com", Papel: "viewer", Modulos: []string{"carrinho"}},
	{Chave: "abandono", ID: lAbandono, Email: "abandono@x.com", Papel: "viewer", Modulos: []string{"abandono-carrinho"}},
	{Chave: "admin", ID: lAdmin, Email: "admin@x.com", Papel: "admin"},
	{Chave: "viewer", ID: lViewer, Email: "viewer@x.com", Papel: "viewer"},
	{Chave: "soeditar", ID: lSoEditar, Email: "soeditar@x.com", Papel: "viewer"},
	{Chave: "desativado", ID: lDesativ, Email: "fora@x.com", Papel: "viewer", Super: true, Desativado: true, Modulos: []string{"meta.leads"}},
	{Chave: "metaoutro", ID: lMetaOutro, Email: "meta@x.com", Papel: "viewer", Modulos: []string{"meta"}},
}

// Valores que NUNCA podem sair: colunas que as telas não leem.
const (
	segredoIP      = "HASH-DE-IP-SECRETO"
	segredoSenha   = "HASH-DE-SENHA-SECRETA"
	segredoOrigem  = "ORIGEM-INTERNA-DO-REGISTRO"
	segredoIPCrua  = "10.99.88.77"
	segredoUrl     = "https://loja.exemplo/recuperar/SEGREDO-DA-URL"
	segredoChatwoo = "987654321"
)

const linhasDasLeituras = `
update profiles set permissions = '{"atendimentos": ["ver"]}' where id = '` + lAtend + `';
update profiles set permissions = '{"atendimentos": ["editar"]}' where id = '` + lSoEditar + `';
alter table vessel_pessoas alter column teste set default false;
alter table vessel_atendimentos alter column teste set default false;
insert into vessel_pessoas (id, nome, telefone, email) values
  (101, 'Ana Cliente', '5511911110001', 'ana@x.com'), (102, 'Bia Cliente', '5511911110002', null);
insert into vessel_atendimentos (id, pessoa_id, loja, client_advisor, quando, status, convite_codigo, criado_em, origem_registro, ip_hash) values
  (1, 101, 'iguatemi', 'CA-01', '2026-10-10T15:00:00Z', 'confirmado', 'CV-1', '2026-10-01T10:00:00Z', '` + segredoOrigem + `', '` + segredoIP + `'),
  (2, 102, 'iguatemi', null,    null,                    'solicitado', null,   '2026-10-12T10:00:00Z', 'site', null),
  (3, 101, 'tivoli',  null,    '2026-09-01T15:00:00Z', 'realizado',       null,   '2026-09-01T10:00:00Z', 'site', null);
insert into vessel_pedidos (id, bling_pedido_id, numero, pessoa_id, data_do_pedido, data_da_venda, receita_liquida, total_corrigido, situacao_id) values
  (1, 9001, '5001', 101, '2026-10-11', '2026-10-11', 900.00, 950.00, 9),
  (2, 9002, '5002', 101, '2026-10-12', null, null, null, 12),
  (3, 9003, '5003', 102, '2026-08-01', '2026-08-01', 100.00, null, 9);
insert into vessel_origens (id, pessoa_id, momento, canal, utm_source, utm_medium, utm_campaign, clique_meta, navegador_meta) values
  (1, 101, '2026-10-01T09:00:00Z', 'meta', 'facebook', 'cpc', 'lancamento', 'fb.1.111', 'NAVEGADOR-META-INTERNO'),
  (2, 102, '2026-10-12T09:00:00Z', 'site', null, null, null, null, null);
insert into vessel_lista_espera (id, nome, email, whatsapp, aceite_versao, ip_hash, criado_em, utm_source, clique_meta) values
  (1, 'Carla Lista', 'carla@x.com', '11900000003', 'v1', '` + segredoIP + `', '2026-10-05T10:00:00Z', 'google', null),
  (2, 'Dani Lista', 'dani@x.com', '11900000004', 'v1', null, '2026-08-05T10:00:00Z', null, null);
insert into carrinho_eventos (tipo, cart_token, session_id, ip, criado_em, utm_source, gclid, fbp, fbc) values
  ('checkout_iniciado', 'c1', 'SESSAO-RECENTE', '` + segredoIPCrua + `', '2026-10-06T10:00:00Z', 'google', 'GCLID-1', 'fbp-1', 'fbc-1'),
  ('checkout_iniciado', 'c2', 'SESSAO-ANTIGA', null, '2026-08-06T10:00:00Z', null, null, null, null),
  ('produto_adicionado', 'c3', 'SESSAO-OUTRO-TIPO', null, '2026-10-07T10:00:00Z', null, null, null, null);
insert into checkout_abandono (token, nome, email, telefone, total, moeda, url_de_recuperacao, status, iniciado_em, ultimo_evento_em,
    mensagem_status, chatwoot_conversation_id) values
  ('TOKEN-RECENTE', 'Eva Checkout', 'eva@x.com', '5511911110005', 1200.50, 'BRL', '` + segredoUrl + `', 'fila_envio', '2026-10-13T10:00:00Z', '2026-10-13T10:30:00Z', 'enviada', ` + segredoChatwoo + `),
  ('TOKEN-ANTIGO', 'Fabi Checkout', null, null, 10, 'BRL', null, 'aguardando', '2026-09-01T10:00:00Z', '2026-09-01T10:30:00Z', null, null);
`

func novoMundoDasLeituras(t *testing.T) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoasDasLeituras, Linhas: linhasDasLeituras,
		Impersonadas: map[string][2]string{"impersonado": {lAtend, lSuper}}}, montarLeituras)
}

// marca: um pedaço que só aparece quando a linha de verdade é legível; quem: as pessoas que a policy de produção deixa ler.
var esperadoDasLeituras = map[string]struct {
	marca string
	quem  []string
}{
	"/vessel/atendimentos":      {`"loja":"iguatemi"`, []string{"super", "atend", "leads", "impersonado"}},
	"/vessel/pedidos":           {`"numero":"5001"`, []string{"super", "atend", "impersonado"}},
	"/vessel/pessoas":           {`"Ana Cliente"`, []string{"super", "atend", "leads", "impersonado"}},
	"/vessel/origens":           {`"utm_campaign":"lancamento"`, []string{"super", "leads"}},
	"/vessel/lista-espera":      {`"Carla Lista"`, []string{"super", "leads"}},
	"/vessel/carrinho-eventos":  {`"session_id":"SESSAO-RECENTE"`, []string{"super", "leads", "carrinho", "admin"}},
	"/vessel/checkout-abandono": {`"nome":"Eva Checkout"`, []string{"super", "abandono", "admin"}},
}

// TestLeiturasPorPolicy: cada rota contra a policy da SUA tabela, pessoa a pessoa, pela cadeia real
// (auth.Exigir → autz.ComEscopo). Quem não passa: 200 [] e total 0. Sem sessão e conta desativada: 401.
func TestLeiturasPorPolicy(t *testing.T) {
	m := novoMundoDasLeituras(t)
	if len(esperadoDasLeituras) != len(leituras) {
		t.Fatalf("leitura sem caso: %d rotas, %d casos", len(leituras), len(esperadoDasLeituras))
	}
	todos := []string{"super", "atend", "leads", "carrinho", "abandono", "admin", "viewer", "soeditar", "metaoutro", "impersonado"}
	for rota, e := range esperadoDasLeituras {
		if _, ok := leituras[rota]; !ok {
			t.Fatalf("rota %s fora de `leituras`", rota)
		}
		for _, quem := range todos {
			w := m.Resposta(t, quem, "GET", rota+"?contar=1", "")
			deve := false
			for _, q := range e.quem {
				deve = deve || q == quem
			}
			if deve {
				if w.Code != 200 || !strings.Contains(w.Body.String(), e.marca) || w.Header().Get("X-Total-Count") == "0" {
					t.Errorf("%s GET %s = %d %s (total %q), devia ler", quem, rota, w.Code, w.Body, w.Header().Get("X-Total-Count"))
				}
				continue
			}
			if w.Code != 200 || strings.TrimSpace(w.Body.String()) != "[]" || w.Header().Get("X-Total-Count") != "0" {
				t.Errorf("%s GET %s = %d %s (total %q), esperava 200 [] e 0", quem, rota, w.Code, w.Body, w.Header().Get("X-Total-Count"))
			}
		}
		for _, quem := range []string{"desativado", ""} {
			if st, _ := m.Pedir(t, quem, "GET", rota, ""); st != http.StatusUnauthorized {
				t.Errorf("%q GET %s = %d, esperava 401", quem, rota, st)
			}
		}
		for _, outro := range []string{"POST", "PATCH", "DELETE"} {
			if st, _ := m.Pedir(t, "super", outro, rota, `{}`); st != http.StatusMethodNotAllowed {
				t.Errorf("%s %s = %d, esperava 405 (só leitura)", outro, rota, st)
			}
		}
		if st, _ := m.Pedir(t, "super", "GET", rota+"?inventado=1", ""); st != http.StatusBadRequest {
			t.Errorf("GET %s?inventado=1 = %d, esperava 400", rota, st)
		}
	}
}

// TestLeiturasSemColunaEscondida: nenhuma coluna que a tela não usa sai, nem para quem pode tudo.
func TestLeiturasSemColunaEscondida(t *testing.T) {
	m := novoMundoDasLeituras(t)
	for rota := range leituras {
		_, corpo := m.Pedir(t, "super", "GET", rota, "")
		for _, s := range []string{segredoIP, segredoSenha, segredoOrigem, segredoIPCrua, segredoUrl, segredoChatwoo, "NAVEGADOR-META-INTERNO", "origem_registro", "ip_hash", "url_de_recuperacao", "chatwoot", `"ip"`} {
			if strings.Contains(corpo, s) {
				t.Errorf("GET %s devolveu %q: %s", rota, s, corpo)
			}
		}
	}
}

// TestLeiturasFiltrosEOrdem: os filtros e a ordem que as telas usam, com o que tem de entrar e o que não.
func TestLeiturasFiltrosEOrdem(t *testing.T) {
	m := novoMundoDasLeituras(t)
	casos := []mundoteste.Caso{
		// Atendimentos: a janela da tela (quando; sem quando, criado_em) — o A2 (sem dia) entra, o A3 (setembro) não
		{Nome: "janela: com dia e sem dia", Quem: "atend", Metodo: "GET", Caminho: "/vessel/atendimentos?janela_de=2026-10-01T00:00:00-03:00&janela_ate=2026-10-31T23:59:59-03:00",
			Status: 200, Tem: `"convite_codigo":"CV-1"`, NaoTem: `"tivoli"`},
		{Nome: "janela: o sem dia entra pela criação", Quem: "atend", Metodo: "GET", Caminho: "/vessel/atendimentos?janela_de=2026-10-11T00:00:00-03:00&janela_ate=2026-10-31T23:59:59-03:00",
			Status: 200, Tem: `"status":"solicitado"`, NaoTem: `"confirmado"`},
		{Nome: "pessoa embutida com as 3 colunas", Quem: "atend", Metodo: "GET", Caminho: "/vessel/atendimentos?criado_desde=2026-10-01T00:00:00Z",
			Status: 200, Tem: `"pessoa":{"id" : 101, "nome" : "Ana Cliente", "telefone" : "5511911110001"}`, NaoTem: `ana@x.com`},
		{Nome: "a mais próxima primeiro, sem dia por último", Quem: "atend", Metodo: "GET", Caminho: "/vessel/atendimentos?limite=1",
			Status: 200, Tem: `"loja":"iguatemi"`, NaoTem: `"status":"solicitado"`},
		{Nome: "criado_desde", Quem: "leads", Metodo: "GET", Caminho: "/vessel/atendimentos?criado_desde=2026-10-02T00:00:00Z",
			Status: 200, Tem: `"status":"solicitado"`, NaoTem: `"confirmado"`},
		{Nome: "janela inválida", Quem: "atend", Metodo: "GET", Caminho: "/vessel/atendimentos?janela_de=ontem", Status: 400},
		// Pedidos: só o atendido (9), das pessoas pedidas, na janela de datas
		{Nome: "pedido atendido da pessoa", Quem: "atend", Metodo: "GET", Caminho: "/vessel/pedidos?situacao_id=9&pessoa_id=101,102&pedido_de=2026-10-01&pedido_ate=2026-10-31",
			Status: 200, Tem: `"numero":"5001"`, NaoTem: `"5002"`},
		{Nome: "pedido: pessoa fora da lista", Quem: "atend", Metodo: "GET", Caminho: "/vessel/pedidos?situacao_id=9&pessoa_id=102", Status: 200, Tem: `"5003"`, NaoTem: `"5001"`},
		{Nome: "pedido: valores como número", Quem: "atend", Metodo: "GET", Caminho: "/vessel/pedidos?situacao_id=9&pessoa_id=101", Status: 200, Tem: `"receita_liquida":900.00,"total_corrigido":950.00`},
		{Nome: "pedido: id não numérico", Quem: "atend", Metodo: "GET", Caminho: "/vessel/pedidos?pessoa_id=1,x", Status: 400},
		{Nome: "pedido: data inválida", Quem: "atend", Metodo: "GET", Caminho: "/vessel/pedidos?pedido_de=2026-13-45", Status: 400},
		// Pessoas e origens por lista de ids
		{Nome: "pessoas pelos ids", Quem: "leads", Metodo: "GET", Caminho: "/vessel/pessoas?id=102", Status: 200, Tem: `"Bia Cliente"`, NaoTem: `Ana Cliente`},
		{Nome: "origens pelos ids", Quem: "leads", Metodo: "GET", Caminho: "/vessel/origens?pessoa_id=101", Status: 200, Tem: `"clique_meta":"fb.1.111"`, NaoTem: `"pessoa_id":102`},
		// Lista de espera e carrinho
		{Nome: "lista de espera desde", Quem: "leads", Metodo: "GET", Caminho: "/vessel/lista-espera?criado_desde=2026-10-01T00:00:00-03:00", Status: 200, Tem: `Carla Lista`, NaoTem: `Dani Lista`},
		{Nome: "carrinho: só checkout iniciado, desde", Quem: "carrinho", Metodo: "GET", Caminho: "/vessel/carrinho-eventos?tipo=checkout_iniciado&criado_desde=2026-10-01T00:00:00-03:00",
			Status: 200, Tem: `SESSAO-RECENTE`, NaoTem: `SESSAO-ANTIGA`},
		{Nome: "carrinho: o tipo filtra", Quem: "carrinho", Metodo: "GET", Caminho: "/vessel/carrinho-eventos?tipo=checkout_iniciado", Status: 200, NaoTem: `SESSAO-OUTRO-TIPO`},
		// Abandono: a ordem é a da fila (último evento primeiro) e a janela é a de início
		{Nome: "abandono desde", Quem: "abandono", Metodo: "GET", Caminho: "/vessel/checkout-abandono?iniciado_desde=2026-10-07T00:00:00-03:00", Status: 200, Tem: `TOKEN-RECENTE`, NaoTem: `TOKEN-ANTIGO`},
		{Nome: "abandono: total como número, moeda e status", Quem: "abandono", Metodo: "GET", Caminho: "/vessel/checkout-abandono", Status: 200, Tem: `"total":1200.50,"moeda":"BRL","status":"fila_envio"`},
		{Nome: "abandono: a ordem da fila", Quem: "abandono", Metodo: "GET", Caminho: "/vessel/checkout-abandono?limite=1", Status: 200, Tem: `TOKEN-RECENTE`, NaoTem: `TOKEN-ANTIGO`},
	}
	m.Rodar(t, casos)
	// teto de limite: o do Supabase (1000); acima disso é 400, não corte silencioso
	if st, _ := m.Pedir(t, "super", "GET", "/vessel/lista-espera?limite=2000", ""); st != http.StatusBadRequest {
		t.Errorf("limite=2000 = %d, esperava 400", st)
	}
	if w := m.Resposta(t, "super", "GET", "/vessel/lista-espera?contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "2" {
		t.Errorf("X-Total-Count = %q, esperava 2", w.Header().Get("X-Total-Count"))
	}
}

// TestLeiturasMutacoes: o que a gramática e o catálogo têm de reprovar numa declaração adulterada (a API não sobe).
func TestLeiturasMutacoes(t *testing.T) {
	// 1) o embutido sem a regra da tabela dele
	c := leituras["/vessel/atendimentos"]
	if !strings.Contains(c.SQL, "{ler:vessel_pessoas:p}") {
		t.Fatal("a consulta perdeu o marcador do embutido")
	}
	c.SQL = strings.Replace(c.SQL, "{ler:vessel_pessoas:p}", "true", 1)
	if err := c.Validar(autz.Producao); err == nil {
		t.Error("a gramática aceitou o embutido sem {ler:vessel_pessoas:p}")
	}
	// 2) outra tabela lida por join sem o marcador
	c = leituras["/vessel/pedidos"]
	c.SQL = strings.Replace(c.SQL, "from vessel_pedidos d", "from vessel_pedidos d join vessel_pessoas p on p.id = d.pessoa_id", 1)
	if err := c.Validar(autz.Producao); err == nil {
		t.Error("a gramática aceitou o join com vessel_pessoas sem a regra")
	}
	// 3) tabela fora do catálogo
	c = leituras["/vessel/origens"]
	c.Tabela = "vessel_segredo_que_nao_existe"
	if err := c.Validar(autz.Producao); err == nil {
		t.Error("tabela fora do catálogo foi aceita")
	}
	// 4) toda tabela das 7 rotas está no catálogo, com a regra de leitura e SEM escrita (só leitura em produção)
	for rota, c := range leituras {
		if err := c.Validar(autz.Producao); err != nil {
			t.Errorf("%s: %v", rota, err)
		}
		for _, op := range []autz.Op{autz.Criar, autz.Editar, autz.Apagar} {
			if f, err := autz.Producao.Filtro(&autz.Escopo{Papel: "admin", SuperFicha: true}, c.Tabela, op, c.Alias); err == nil && !f.Nega() {
				t.Errorf("%s: o catálogo deixa %s em %s (a tela só lê)", rota, op, c.Tabela)
			}
		}
	}
}

// TestLeiturasMontamNoRoteador: as 7 rotas aparecem em chi.Walk, só GET.
func TestLeiturasMontamNoRoteador(t *testing.T) {
	m := novoMundoDasLeituras(t)
	var vistos []string
	err := chi.Walk(m.H.(chi.Routes), func(metodo, rota string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if metodo != http.MethodGet {
			t.Errorf("rota de escrita inesperada: %s %s", metodo, rota)
		}
		vistos = append(vistos, rota)
		return nil
	})
	if err != nil || len(vistos) != len(leituras) {
		t.Fatalf("rotas montadas = %v (%v), esperava %d", vistos, err, len(leituras))
	}
}
