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

// Passar o carro e trocar o dono fixo com as regras de posse.js: uma posse aberta por vez, empréstimo a terceiro
// não muda com a troca do dono, devolver volta ao dono, recolher fecha e para o carro.
func TestTrocarResponsavel(t *testing.T) {
	m := novoMundo(t)
	_, gestor, _ := m.acesso(t)
	m.q(t, `with x as (insert into acessos_pessoas (id, nome, status) values
		('e1a00000-0000-4000-a000-000000000001', 'Ana Souza', 'ativo'),
		('e1a00000-0000-4000-a000-000000000002', 'Bruno Lima', 'ativo') returning 1) select 'ok'`)
	troca := func(args, contem string, querErro bool) {
		t.Helper()
		txt, erro := m.ferramenta(t, gestor, "trocar_responsavel", `{"veiculo_id":"`+veiculoV1+`",`+args+`}`)
		if erro != querErro || !strings.Contains(txt, contem) {
			t.Fatalf("%s: erro=%v (queria %v), sem %q em %s", args, erro, querErro, contem, txt)
		}
	}
	// quem tem posse aberta (no máximo uma), o dono fixo e a situação
	quer := func(e string) {
		t.Helper()
		v := m.q(t, `select coalesce((select string_agg(pessoa_nome, ',') from frota_uso where veiculo_id = '`+veiculoV1+
			`' and tipo = 'posse' and volta_em is null), '-') || '/' || coalesce((select p.nome from frota_veiculos v
			join acessos_pessoas p on p.id = v.pessoa_id where v.id = '`+veiculoV1+`'), '-') || '/' ||
			(select situacao from frota_veiculos where id = '`+veiculoV1+`')`)
		if v != e {
			t.Fatalf("estado %s, queria %s", v, e)
		}
	}

	troca(`"acao":"sumir"`, "acao deve ser", true)
	troca(`"acao":"trocar_dono_fixo","pessoa_nome":"Ana Souza","de_fora":true`, "de_fora só vale", true)
	troca(`"acao":"devolver"`, "não está com ninguém", true)
	troca(`"acao":"tirar_dono_fixo"`, "não tem dono fixo", true)
	quer("-/-/ativo")

	troca(`"acao":"trocar_dono_fixo","pessoa_nome":"ana souza"`, "Ana Souza é o novo dono fixo", false)
	quer("Ana Souza/Ana Souza/ativo")
	troca(`"acao":"trocar_dono_fixo","pessoa_nome":"Ana Souza"`, "já é o dono fixo", true)
	troca(`"acao":"passar","pessoa_nome":"Ana Souza"`, "já está com Ana Souza", true)
	troca(`"acao":"passar","pessoa_nome":"Felipe Modelista","de_fora":true`, "agora está com Felipe Modelista", false)
	quer("Felipe Modelista/Ana Souza/ativo")

	// emprestado: o dono muda, a posse fica com quem está com o carro; devolver entrega ao dono novo
	troca(`"acao":"trocar_dono_fixo","pessoa_nome":"Bruno"`, "continua com Felipe Modelista", false)
	quer("Felipe Modelista/Bruno Lima/ativo")
	troca(`"acao":"devolver"`, "voltou para o dono fixo, Bruno Lima", false)
	quer("Bruno Lima/Bruno Lima/ativo")

	troca(`"acao":"recolher"`, "recolhido para o estoque", false)
	quer("-/Bruno Lima/inativo")
	troca(`"acao":"recolher"`, "já está no estoque", true)

	troca(`"acao":"passar","pessoa_nome":"Ana"`, "agora está com Ana Souza", false)
	troca(`"acao":"tirar_dono_fixo"`, "não tem mais dono fixo (era Bruno Lima)", false)
	quer("-/-/inativo")
	if n := m.q(t, `select count(*)::text from frota_uso where veiculo_id = '`+veiculoV1+`' and tipo = 'posse'`); n != "4" {
		t.Fatalf("posses gravadas: %s", n)
	}
}
