package frota

import (
	"strings"
	"testing"
)

// linha: o caso na forma posicional curta (Nome, Quem, Método, Caminho, Corpo, Status, Tem, NaoTem, Efeito, Quer).
type linha struct {
	Nome, Quem, Metodo, Caminho, Corpo string
	Status                             int
	Tem, NaoTem                        string
	Efeito, Quer                       string
}

func casos(ls []linha) []caso {
	out := make([]caso, len(ls))
	for i, l := range ls {
		out[i] = caso(l)
	}
	return out
}

func TestChecklistNumaGravacaoSo(t *testing.T) {
	m := novoMundo(t, montarChecklists)
	ficha := func(veiculo, dia, extra string) string {
		return `"ficha":{"veiculo_id":"` + veiculo + `","feita_em":"` + dia + `","cadencias":["diario","semanal"],"hodometro":5200,` +
			`"resultado":"com_ressalvas","anomalias":"farol","pessoa_id":"` + pMotorista + `","pessoa_nome":"Motorista"` + extra + `}`
	}
	const respostas = `"respostas":[{"item_id":"` + I1 + `","item_texto":"Pneus","cadencia":"diario","estado":"ok","observacao":null},` +
		`{"item_id":"` + I2 + `","item_texto":"Faróis","cadencia":"semanal","estado":"nao_ok","observacao":"queimado"}]`
	const assinatura = `"assinatura":{"aberta_em":"2026-10-12T09:58:00Z","assinada_em":"2026-10-12T10:00:00Z","assinatura_hash":"h-novo",` +
		`"assinatura_hash_anterior":"h-c1","assinatura_versao":2,"assinatura_rabisco":[[[0.1,0.2],[0.3,0.4]]]}`
	corpo := func(partes ...string) string { return "{" + strings.Join(partes, ",") + "}" }
	const fichas, todas = `select count(*)::text from frota_checklist`, `select count(*)::text from frota_checklist_respostas`
	daFicha := func(v, dia, expr string) string {
		return `select ` + expr + ` from frota_checklist c where c.veiculo_id = '` + v + `' and c.feita_em = '` + dia + `'`
	}
	muitas := `"respostas":[` + strings.TrimSuffix(strings.Repeat(`{"item_texto":"x","cadencia":"diario","estado":"ok"},`, 201), ",") + `]`
	m.Rodar(t, casos([]linha{
		{"assinada numa gravação só; autoria da sessão; respostas na ordem", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V2, "2026-10-12", ""), respostas, assinatura), 201, `"assinatura_hash":"h-novo"`, "",
			daFicha(V2, "2026-10-12", `c.assinada_por::text || '/' || c.criada_por::text || '/' || c.assinada_em::text || '/' ||
				(select string_agg(r.ordem || ':' || r.item_texto || ':' || r.estado, ',' order by r.ordem)
				   from frota_checklist_respostas r where r.checklist_id = c.id)`),
			idMotorista + "/" + idMotorista + "/2026-10-12 10:00:00+00/0:Pneus:ok,1:Faróis:nao_ok"},
		{"…e o gatilho a pôs na fila do PDF", "", "", "", "", 0, "", "",
			daFicha(V2, "2026-10-12", `(select p.situacao from frota_checklist_pdf p where p.checklist_id = c.id)`), "na_fila"},
		{"segunda ficha do carro no dia: 409 e nenhuma resposta solta", "motorista2", "POST", "/frota/checklists",
			corpo(ficha(V2, "2026-10-12", ""), respostas), 409, "conflito", "", todas, "3"},
		{"resposta inválida no meio: 400 e a ficha também não fica", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-12", ""), strings.Replace(respostas, `"nao_ok"`, `"talvez"`, 1)), 400, "pedido_invalido", "", fichas, "3"},
		{"sem assinatura (quem não tem login): grava com o motivo", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-13", `,"sem_assinatura_motivo":"sem_login"`), respostas), 201, `"sem_assinatura_motivo":"sem_login"`, "",
			daFicha(V1, "2026-10-13", `coalesce(c.assinada_em::text, '<nulo>') || '/' || coalesce(c.assinada_por::text, '<nulo>')`), "<nulo>/<nulo>"},
		{"assinatura e motivo de sem assinatura juntos: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", `,"sem_assinatura_motivo":"sem_login"`), respostas, assinatura), 400, "pedido_invalido", "", fichas, "4"},
		{"assinatura sem a impressão digital: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), respostas, strings.Replace(assinatura, `"assinatura_hash":"h-novo",`, "", 1)), 400, "pedido_invalido", "", fichas, "4"},
		{"assinada_por no corpo: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), respostas, strings.Replace(assinatura, `"aberta_em"`, `"assinada_por":"`+idAprovador+`","aberta_em"`, 1)),
			400, "corpo_invalido", "", fichas, "4"},
		{"criada_por na ficha: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", `,"criada_por":"`+idAprovador+`"`), respostas), 400, "corpo_invalido", "", fichas, "4"},
		{"checklist_id na resposta: 400", "motorista", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), strings.Replace(respostas, `"item_id"`, `"checklist_id":"`+C1+`","item_id"`, 1)), 400, "corpo_invalido", "", todas, "5"},
		{"201 respostas: 400", "motorista", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), muitas), 400, "200 itens", "", fichas, "4"},
		{"papel admin sem a Frota: 403 e nada gravado", "admin", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), respostas), 403, "sem_permissao", "", fichas, "4"},
		{"só frota.aprovar: 403", "soAprovar", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), respostas), 403, "sem_permissao", "", fichas, "4"},
		{"conta desativada: nem a sessão vale (401)", "desativado", "POST", "/frota/checklists", corpo(ficha(V1, "2026-10-14", ""), respostas), 401, "", "", fichas, "4"},
		{"entrar-como não assina no nome do alvo: 403", "impersonado", "POST", "/frota/checklists",
			corpo(ficha(V1, "2026-10-14", ""), respostas, assinatura), 403, "Quem entrou como outra pessoa", "", fichas, "4"},
	}))
}

func TestLeiturasDasFichas(t *testing.T) {
	m := novoMundo(t, montarChecklists)
	// C2 (02/10) antes de C1 (01/10): feita_em decrescente
	if st, corpo := m.Pedir(t, "motorista", "GET", "/frota/checklists?feita_de=2026-10-01", ""); st != 200 ||
		strings.Index(corpo, C2) < 0 || strings.Index(corpo, C1) < strings.Index(corpo, C2) {
		t.Errorf("fichas desde 01/10 = %d %s, esperava C2 antes de C1", st, corpo)
	}
	m.Rodar(t, []caso{
		{Nome: "hash anterior", Quem: "motorista", Metodo: "GET", Caminho: "/frota/checklists?veiculo_id=" + V1 + "&assinada=true&ordem=feita_em.desc&limite=1",
			Status: 200, Tem: `"assinatura_hash":"h-c1"`, NaoTem: C2},
		{Nome: "data fora do formato", Quem: "motorista", Metodo: "GET", Caminho: "/frota/checklists?feita_de=01/10/2026", Status: 400},
		{Nome: "respostas das fichas", Quem: "motorista", Metodo: "GET", Caminho: "/frota/checklists/respostas?checklist_id=" + C1 + "," + C2,
			Status: 200, Tem: Q1},
		{Nome: "checklist_id malformado", Quem: "motorista", Metodo: "GET", Caminho: "/frota/checklists/respostas?checklist_id=x", Status: 400},
		{Nome: "cópias pendentes", Quem: "motorista", Metodo: "GET", Caminho: "/frota/checklists/copias?pendente=true", Status: 200,
			Tem: `"checklist_id":"` + C1 + `"`},
		{Nome: "sem sessão", Metodo: "GET", Caminho: "/frota/checklists", Status: 401},
	})
	if w := m.Resposta(t, "motorista", "GET", "/frota/checklists/copias?situacao=enviado&contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "0" {
		t.Errorf("X-Total-Count das enviadas = %q, esperava 0", w.Header().Get("X-Total-Count"))
	}
	if _, corpo := m.Pedir(t, "motorista", "GET", "/frota/checklists/copias?pendente=true", ""); !strings.Contains(corpo, `"situacao":"na_fila"`) {
		t.Errorf("a cópia da C1 não está na_fila: %s", corpo)
	}
	for _, quem := range semFrota {
		for _, rota := range []string{"/frota/checklists", "/frota/checklists/respostas", "/frota/checklists/copias"} {
			if st, corpo := m.Pedir(t, quem, "GET", rota, ""); st != 200 || corpo != "[]" {
				t.Errorf("VAZAMENTO: %s (sem a Frota) lê %s = %d %s", quem, rota, st, corpo)
			}
		}
	}
}
