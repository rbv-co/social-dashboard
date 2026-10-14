package frota

import (
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

func contarUso(tabela string) string { return "select count(*)::text from " + tabela }

func colUso(coluna, id string) string {
	return "select " + coluna + "::text from frota_uso where id = '" + id + "'"
}

// corridaDeDois dispara os dois pedidos ao mesmo tempo e devolve os status em ordem crescente.
func corridaDeDois(t *testing.T, m *mundoteste.Mundo, a, b, metodo, caminho, corpo string) [2]int {
	t.Helper()
	var st [2]int
	var wg sync.WaitGroup
	for i, quem := range []string{a, b} {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st[i] = m.Resposta(t, quem, metodo, caminho, corpo).Code
		}()
	}
	wg.Wait()
	if st[0] > st[1] {
		st[0], st[1] = st[1], st[0]
	}
	return st
}

// Duas pessoas pegando o mesmo carro: o índice parcial decide (um 201, um 409). Duas trocas fechando a
// mesma posse: o PodeEditar trava a linha e a conferência acusa a segunda (um 200, um 409).
func TestRetiradaETrocaConcorrentes(t *testing.T) {
	m := novoMundo(t, montarUsos)
	if st := corridaDeDois(t, m, "motorista", "motorista2", "POST", "/frota/usos", `{"veiculo_id":"`+V2+`","km_saida":150}`); st != [2]int{201, 409} {
		t.Errorf("retiradas simultâneas = %v, esperava [201 409]", st)
	}
	if v := m.Um(t, `select count(*)::text from frota_uso where veiculo_id = '`+V2+`' and volta_em is null`); v != "1" {
		t.Errorf("V2 com %s saídas abertas", v)
	}
	troca := `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"},` +
		`"abrir":{"pessoa_id":null,"pessoa_nome":"Fulano de Fora","saida_em":"2026-10-12T10:00:00Z"}}`
	if st := corridaDeDois(t, m, "motorista", "motorista2", "POST", "/frota/usos/trocar", troca); st != [2]int{200, 409} {
		t.Errorf("trocas simultâneas = %v, esperava [200 409]", st)
	}
	if v := m.Um(t, `select count(*) filter (where volta_em is null)::text || '/' ||
		(select volta_em::text from frota_uso where id = '`+U1+`') from frota_uso where veiculo_id = '`+V1+`'`); v != "1/2026-10-12 10:00:00+00" {
		t.Errorf("V1 depois da corrida = %s", v)
	}
}

func TestUsos(t *testing.T) {
	m := novoMundo(t, montarUsos)
	for _, quem := range []string{"motorista", "aprovador", "superFicha", "impersonado"} {
		m.Rodar(t, []caso{
			{Nome: "abertas: " + quem, Quem: quem, Metodo: "GET", Caminho: "/frota/usos?aberta=true", Status: 200, Tem: U1, NaoTem: U2},
		})
	}
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/frota/usos", Status: 401},
		{Nome: "fechadas", Quem: "motorista", Metodo: "GET", Caminho: "/frota/usos?aberta=false&limite=400", Status: 200, Tem: U2, NaoTem: U1},
		{Nome: "janela de saída", Quem: "motorista", Metodo: "GET", Caminho: "/frota/usos?saida_de=2026-10-02&saida_ate=2026-10-03",
			Status: 200, Tem: U2, NaoTem: U1},
		{Nome: "por veículo", Quem: "motorista", Metodo: "GET", Caminho: "/frota/usos?veiculo_id=" + V2, Status: 200, Tem: U2, NaoTem: U1},
		{Nome: "aberta malformado", Quem: "motorista", Metodo: "GET", Caminho: "/frota/usos?aberta=talvez", Status: 400},
		{Nome: "ordem fora da lista", Quem: "motorista", Metodo: "GET", Caminho: "/frota/usos?ordem=km_saida", Status: 400},
	})
	for _, quem := range semFrota {
		if st, corpo := m.Pedir(t, quem, "GET", "/frota/usos", ""); st != 200 || corpo != "[]" {
			t.Errorf("VAZAMENTO: %s (sem a Frota) lê %d %s", quem, st, corpo)
		}
	}

	foto := m.Um(t, fotoDaFrota)
	for _, quem := range semFrota {
		m.Rodar(t, []caso{
			{Nome: "sem a Frota não retira: " + quem, Quem: quem, Metodo: "POST", Caminho: "/frota/usos",
				Corpo: `{"veiculo_id":"` + V2 + `","km_saida":150}`, Status: 403, Efeito: fotoDaFrota, Quer: foto},
			{Nome: "sem a Frota não devolve (linha invisível = 404): " + quem, Quem: quem, Metodo: "PATCH", Caminho: "/frota/usos/" + U1,
				Corpo: `{"volta_em":"2026-10-12T18:00:00Z"}`, Status: 404, Efeito: fotoDaFrota, Quer: foto},
		})
	}
	m.Rodar(t, []caso{
		{Nome: "entrar como: retirada", Quem: "impersonado", Metodo: "POST", Caminho: "/frota/usos",
			Corpo: `{"veiculo_id":"` + V2 + `","km_saida":150}`, Status: 403, Efeito: fotoDaFrota, Quer: foto},
		{Nome: "entrar como: devolução", Quem: "impersonado", Metodo: "PATCH", Caminho: "/frota/usos/" + U1,
			Corpo: `{"volta_em":"2026-10-12T18:00:00Z"}`, Status: 403, Efeito: fotoDaFrota, Quer: foto},
		{Nome: "carro já fora (posse aberta) = 409", Quem: "motorista", Metodo: "POST", Caminho: "/frota/usos",
			Corpo: `{"veiculo_id":"` + V1 + `","km_saida":150}`, Status: 409, Efeito: contarUso("frota_uso"), Quer: "2"},
		{Nome: "aceite_por no corpo", Quem: "motorista", Metodo: "POST", Caminho: "/frota/usos",
			Corpo: `{"veiculo_id":"` + V2 + `","aceite_por":"` + idAprovador + `"}`, Status: 400, Efeito: contarUso("frota_uso"), Quer: "2"},
		{Nome: "tipo no corpo", Quem: "motorista", Metodo: "POST", Caminho: "/frota/usos",
			Corpo: `{"veiculo_id":"` + V2 + `","tipo":"posse"}`, Status: 400, Efeito: contarUso("frota_uso"), Quer: "2"},
		{Nome: "tanque fora de 0 a 4", Quem: "motorista", Metodo: "POST", Caminho: "/frota/usos",
			Corpo: `{"veiculo_id":"` + V2 + `","tanque_quartos":5}`, Status: 400, Efeito: contarUso("frota_uso"), Quer: "2"},
		{Nome: "devolver o que é de outro (invisível) como admin", Quem: "admin", Metodo: "PATCH", Caminho: "/frota/usos/" + U1,
			Corpo: `{"volta_em":"2026-10-12T18:00:00Z"}`, Status: 404, Efeito: colUso("volta_em", U1), Quer: "<nulo>"},
	})

	// Retirada com aceite: o gatilho carimba aceite_por (a sessão) e aceite_em (agora); +1 na fila do PDF.
	pdfAntes := m.Um(t, contarUso("frota_uso_pdf"))
	w := m.Resposta(t, "motorista", "POST", "/frota/usos", `{"veiculo_id":"`+V2+`","saida_em":"2026-10-12T08:00:00Z","km_saida":150,"tanque_quartos":3,"destino":"Campinas",`+
		`"aceite_em":"2020-01-01T00:00:00Z","aceite_nome":"Motorista","aceite_rabisco":[[[0,0],[1,1]]],`+
		`"aceite_checklist_id":"`+C2+`","aceite_checklist_hash":null}`)
	if w.Code != 201 {
		t.Fatalf("retirada com aceite = %d %s", w.Code, w.Body)
	}
	id := strings.Split(strings.Split(w.Body.String(), `"id":"`)[1], `"`)[0]
	if v := m.Um(t, `select (aceite_por = '`+idMotorista+`' and aceite_em > '2026-01-01' and tipo = 'viagem')::text from frota_uso where id = '`+id+`'`); v != "true" {
		t.Errorf("aceite da retirada: aceite_por/aceite_em/tipo errados (%s) em %s", v, w.Body)
	}
	if v := m.Um(t, contarUso("frota_uso_pdf")); v == pdfAntes {
		t.Errorf("retirada com aceite não entrou na fila do PDF (%s)", v)
	}

	// Devolução da viagem criada.
	m.Rodar(t, []caso{
		{Nome: "devolução", Quem: "motorista", Metodo: "PATCH", Caminho: "/frota/usos/" + id,
			Corpo: `{"volta_em":"2026-10-12T18:00:00Z","km_volta":180,"tanque_quartos":2}`, Status: 200,
			Efeito: colUso("km_volta", id), Quer: "180"},
	})
	m.Rodar(t, []caso{
		{Nome: "km menor que a saída", Quem: "motorista", Metodo: "PATCH", Caminho: "/frota/usos/" + U2,
			Corpo: `{"km_volta":10}`, Status: 400, Efeito: colUso("km_volta", U2), Quer: "150"},
	})
}

func TestTrocarPosse(t *testing.T) {
	m := novoMundo(t, montarUsos)
	const url = "/frota/usos/trocar"
	posseAberta := `select coalesce((select id::text from frota_uso where veiculo_id = '` + V1 + `' and volta_em is null), 'nenhuma')`
	foto := m.Um(t, fotoDaFrota)

	// negados e inválidos: nada muda
	for _, c := range []caso{
		{Nome: "admin com fechar: linha invisível", Quem: "admin", Corpo: `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"}}`, Status: 404},
		{Nome: "admin só abrir", Quem: "admin", Corpo: `{"veiculo_id":"` + V2 + `","abrir":{"pessoa_nome":"X","saida_em":"2026-10-12T10:00:00Z"}}`, Status: 403},
		{Nome: "entrar como", Quem: "impersonado", Corpo: `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"}}`, Status: 403},
		{Nome: "vazio", Quem: "motorista", Corpo: `{}`, Status: 400},
		{Nome: "sem fazer nada", Quem: "motorista", Corpo: `{"veiculo_id":"` + V1 + `"}`, Status: 400},
		{Nome: "estoque com abrir", Quem: "motorista", Corpo: `{"veiculo_id":"` + V1 + `","para_estoque":true,"abrir":{"pessoa_nome":"X","saida_em":"2026-10-12T10:00:00Z"}}`, Status: 400},
		{Nome: "fechar sem volta_em", Quem: "motorista", Corpo: `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `"}}`, Status: 400},
		{Nome: "fechar sem id", Quem: "motorista", Corpo: `{"veiculo_id":"` + V1 + `","fechar":{"volta_em":"2026-10-12T10:00:00Z"}}`, Status: 400},
		{Nome: "abrir com tipo", Quem: "motorista", Corpo: `{"veiculo_id":"` + V1 + `","abrir":{"tipo":"viagem","pessoa_nome":"X"}}`, Status: 400},
		{Nome: "abrir com veiculo_id", Quem: "motorista", Corpo: `{"veiculo_id":"` + V1 + `","abrir":{"veiculo_id":"` + V2 + `","pessoa_nome":"X"}}`, Status: 400},
		{Nome: "posse do V1 fechada pelo V2: 409", Quem: "motorista", Corpo: `{"veiculo_id":"` + V2 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"}}`, Status: 409},
		{Nome: "viagem não é posse: 409", Quem: "motorista", Corpo: `{"veiculo_id":"` + V2 + `","fechar":{"id":"` + U2 + `","volta_em":"2026-10-12T10:00:00Z"}}`, Status: 409},
		{Nome: "abrir inválido: a posse que ia fechar continua aberta (uma transação só)", Quem: "motorista",
			Corpo: `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T10:00:00Z"},"abrir":{"pessoa_nome":"X","saida_em":"ontem"}}`, Status: 400},
	} {
		m.Rodar(t, []caso{{Nome: c.Nome, Quem: c.Quem, Metodo: "POST", Caminho: url, Corpo: c.Corpo, Status: c.Status,
			Efeito: fotoDaFrota, Quer: foto}})
	}
	if v := m.Um(t, posseAberta); v != U1 {
		t.Fatalf("a posse do V1 mudou nos casos negados: %s", v)
	}

	// passar a uma pessoa de fora
	w := m.Resposta(t, "motorista", "POST", url, `{"veiculo_id":"`+V1+`","fechar":{"id":"`+U1+`","volta_em":"2026-10-12T10:00:00Z"},`+
		`"abrir":{"pessoa_id":null,"pessoa_nome":"Fulano de Fora","saida_em":"2026-10-12T10:00:00Z"}}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"fechado":"`+U1+`"`) {
		t.Fatalf("passar o carro = %d %s", w.Code, w.Body)
	}
	if v := m.Um(t, colUso("volta_em", U1)); v != "2026-10-12 10:00:00+00" {
		t.Errorf("U1 fechada em %s", v)
	}
	nova := m.Um(t, posseAberta)
	if v := m.Um(t, `select (tipo = 'posse' and pessoa_nome = 'Fulano de Fora')::text from frota_uso where id = '`+nova+`'`); v != "true" {
		t.Errorf("a posse nova não é a de Fulano (%s)", v)
	}

	// fechar de novo a posse já fechada: 409 e nada muda
	f2 := m.Um(t, fotoDaFrota)
	m.Rodar(t, []caso{{Nome: "posse já fechada", Quem: "motorista", Metodo: "POST", Caminho: url, Status: 409, Tem: "Alguém mexeu neste carro",
		Corpo: `{"veiculo_id":"` + V1 + `","fechar":{"id":"` + U1 + `","volta_em":"2026-10-12T11:00:00Z"}}`, Efeito: fotoDaFrota, Quer: f2}})

	// devolver ao dono fixo
	w = m.Resposta(t, "motorista", "POST", url, `{"veiculo_id":"`+V1+`","fechar":{"id":"`+nova+`","volta_em":"2026-10-12T12:00:00Z"},`+
		`"abrir":{"pessoa_id":"`+pMotorista+`","pessoa_nome":"Motorista","saida_em":"2026-10-12T12:00:00Z"}}`)
	if w.Code != 200 {
		t.Fatalf("devolver ao dono = %d %s", w.Code, w.Body)
	}
	dono := m.Um(t, posseAberta)
	if v := m.Um(t, `select pessoa_id::text from frota_uso where id = '`+dono+`'`); v != pMotorista {
		t.Errorf("posse aberta de %s, esperava o dono fixo", v)
	}

	// recolher para o estoque
	w = m.Resposta(t, "motorista", "POST", url, `{"veiculo_id":"`+V1+`","fechar":{"id":"`+dono+`","volta_em":"2026-10-12T13:00:00Z"},"para_estoque":true}`)
	if w.Code != 200 {
		t.Fatalf("recolher = %d %s", w.Code, w.Body)
	}
	if v := m.Um(t, posseAberta); v != "nenhuma" {
		t.Errorf("sobrou posse aberta no V1: %s", v)
	}
	if v := m.Um(t, `select (select situacao from frota_veiculos where id = '`+V1+`') || '/' || (select situacao from patrimonio_bens where id = '`+bemCarro+`')`); v != "inativo/em_estoque" {
		t.Errorf("V1/bem depois do estoque = %s, esperava inativo/em_estoque (gatilho)", v)
	}
}
