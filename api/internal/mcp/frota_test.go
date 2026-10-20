package mcp_test

import (
	"strings"
	"testing"
)

// Carro livre com a regra da tela e pedido sempre no nome de alguém (os dois defeitos vistos no ChatGPT em 19/10).
func TestFrotaLivreEPedidoComPessoa(t *testing.T) {
	m := novoMundo(t)
	_, gestor, _ := m.acesso(t)
	m.q(t, `with x as (insert into acessos_pessoas (id, nome, status) values
		('e1a00000-0000-4000-a000-000000000001', 'Ana Souza', 'ativo'),
		('e1a00000-0000-4000-a000-000000000002', 'Ana Lima', 'ativo'),
		('e1a00000-0000-4000-a000-000000000003', 'Caio Ramos', 'desligado') returning 1) select 'ok'`)

	deve := func(nome, args, contem string, querErro bool) string {
		t.Helper()
		txt, erro := m.ferramenta(t, gestor, nome, args)
		if erro != querErro || !strings.Contains(txt, contem) {
			t.Fatalf("%s %s: erro=%v (queria %v), sem %q em %s", nome, args, erro, querErro, contem, txt)
		}
		return txt
	}

	// o Gol está livre; com dono fixo deixa de estar e diz com quem
	deve("listar_veiculos", `{"estado":"livre"}`, `"estado":"livre"`, false)
	deve("listar_veiculos", `{"busca":"aaa-1a11"}`, "AAA1A11", false)
	if txt := deve("listar_veiculos", `{"busca":"fusca"}`, "[]", false); txt != "[]" {
		t.Fatalf("busca sem carro: %s", txt)
	}
	m.q(t, `update frota_veiculos set pessoa_id = 'e1a00000-0000-4000-a000-000000000001' returning 'ok'`)
	if txt := deve("listar_veiculos", `{"estado":"livre"}`, "[]", false); txt != "[]" {
		t.Fatalf("carro com dono fixo saiu como livre: %s", txt)
	}
	deve("listar_veiculos", `{"estado":"fixo"}`, `"com_quem":"Ana Souza"`, false)
	deve("listar_veiculos", `{"estado":"quebrado"}`, "estado deve ser", true)

	// pedido: sem pessoa não grava; ambíguo, desligado e desconhecido pedem para perguntar; achado vai com o id
	pedido := func(extra string) string {
		return `{"veiculo_id":"` + veiculoV1 + `","retirada_prevista":"2026-11-03T08:00:00-03:00"` + extra + `}`
	}
	antes := m.q(t, `select count(*)::text from frota_requisicoes`)
	deve("pedir_carro", pedido(``), "Falta para quem", true)
	deve("pedir_carro", pedido(`,"pessoa_nome":"ana"`), "Mais de um colaborador", true)
	deve("pedir_carro", pedido(`,"pessoa_nome":"Caio Ramos"`), "de_fora=true", true)
	deve("pedir_carro", pedido(`,"pessoa_nome":"Lu","de_fora":true`), "curto demais", true)
	deve("pedir_carro", pedido(`,"pessoa_nome":"Ana","pessoa_id":"x"`), "argumento desconhecido", true)
	if n := m.q(t, `select count(*)::text from frota_requisicoes`); n != antes {
		t.Fatalf("recusa gravou: %s → %s", antes, n)
	}
	deve("pedir_carro", pedido(`,"pessoa_nome":"  ana   SOUZA "`), `"pessoa_nome":"Ana Souza"`, false)
	deve("pedir_carro", pedido(`,"pessoa_nome":"Felipe Modelista","de_fora":true`), `"pessoa_nome":"Felipe Modelista"`, false)
	if v := m.q(t, `select string_agg(coalesce(pessoa_id::text, '-') || '/' || pessoa_nome || '/' || criada_por, ',' order by pessoa_nome)
		from frota_requisicoes where pessoa_nome is not null`); v != "e1a00000-0000-4000-a000-000000000001/Ana Souza/"+idGestor+",-/Felipe Modelista/"+idGestor {
		t.Fatalf("pedidos: %s", v)
	}

	// usos: viagem e posse separadas
	deve("listar_usos", `{"tipo":"viagem"}`, "Fulano", false)
	if txt := deve("listar_usos", `{"tipo":"posse"}`, "[", false); strings.Contains(txt, "Fulano") {
		t.Fatalf("viagem na lista de posse: %s", txt)
	}
}
