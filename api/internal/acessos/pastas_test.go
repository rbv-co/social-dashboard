package acessos

import (
	"strings"
	"testing"
)

func TestPastasVinculosETermos(t *testing.T) {
	m := novoMundo(t, montarPastas)
	novo := `{"recurso_id":"` + R1 + `","pessoa_id":"` + P3 + `","papel":"edicao","estado":"pendente"}`
	var foto string
	nada := func(nome, quem, corpo string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "POST", Caminho: "/acessos/vinculos", Corpo: corpo, Status: status, Tem: tem,
			Efeito: fotoDosAcessos, Quer: foto}
	}
	get := func(nome, quem, caminho string, status int, tem, naoTem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: "GET", Caminho: caminho, Status: status, Tem: tem, NaoTem: naoTem}
	}
	m.Rodar(t, []caso{
		{Nome: "vínculo novo", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/vinculos", Corpo: novo, Status: 201, Tem: `"papel":"edicao"`,
			Efeito: "select count(*)::text from acessos_vinculos where pessoa_id = '" + P3 + "'", Quer: "1"},
	})
	foto = m.Um(t, fotoDosAcessos)
	casos := []caso{
		get("sem sessão", "", "/acessos/recursos", 401, "", ""),
		get("iCloud sem arquivadas, por nome", "acessos", "/acessos/recursos?tipo=icloud&arquivado=false&ordem=nome", 200, "Fotos da loja", "Antiga"),
		get("sem filtro: WorkDrive com caminho", "acessos", "/acessos/recursos", 200, `"caminho":"/RBV/Contratos"`, ""),
		get("sem filtro: as arquivadas também", "acessos", "/acessos/recursos", 200, "Antiga", ""),
		get("arquivado inválido", "acessos", "/acessos/recursos?arquivado=talvez", 400, "", ""),
		get("vínculos da pasta com o embutido", "acessos", "/acessos/vinculos?recurso_id="+R1, 200,
			`"acessos_recursos":{"nome" : "Fotos da loja", "tipo" : "icloud", "arquivado_em" : null}`, V2),
		get("vínculos da pessoa", "acessos", "/acessos/vinculos?pessoa_id="+P2, 200, `"tipo" : "workdrive"`, V1),
		get("pessoa_id inválido", "acessos", "/acessos/vinculos?pessoa_id=x", 400, "", ""),
		get("termos da Ana", "acessos", "/acessos/termos?pessoa_id="+P1, 200, `"arquivo_path":"`+P1+`/1760000000000-termo.pdf"`, ""),
		nada("papel fora da lista", "acessos", `{"recurso_id":"`+R1+`","pessoa_id":"`+P3+`","papel":"admin"}`, 400, ""),
		nada("recurso inexistente", "acessos", `{"recurso_id":"a4500000-0000-4000-a000-0000000000ff","pessoa_id":"`+P3+`"}`, 409, ""),
		nada("criado_em é do banco", "acessos", `{"recurso_id":"`+R1+`","pessoa_id":"`+P3+`","criado_em":"2020-01-01T00:00:00Z"}`, 400, "corpo_invalido"),
		nada("entrar como", "impersonado", novo, 403, "Quem entrou como outra pessoa"),
	}
	m.Rodar(t, casos)
	for _, quem := range semAcessos {
		for _, r := range []string{"/acessos/recursos", "/acessos/vinculos", "/acessos/termos"} {
			if st, corpo := m.Pedir(t, quem, "GET", r, ""); st != 200 || strings.TrimSpace(corpo) != "[]" {
				t.Errorf("%s vê %s (%d): %s", quem, r, st, corpo)
			}
		}
		m.Rodar(t, []caso{nada("sem Acessos: "+quem, quem, novo, 403, "")})
	}
	for _, c := range []struct{ rota, total string }{
		{"/acessos/recursos?tipo=workdrive&arquivado=false&contar=1&limite=1", "1"},
		{"/acessos/termos?pessoa_id=" + P3 + "&contar=1&limite=1", "0"},
	} {
		if w := m.Resposta(t, "acessos", "GET", c.rota, ""); w.Code != 200 || w.Header().Get("X-Total-Count") != c.total {
			t.Errorf("%s: %d total=%q", c.rota, w.Code, w.Header().Get("X-Total-Count"))
		}
	}
	if w := m.Resposta(t, "viewer", "GET", "/acessos/recursos?contar=1&limite=1", ""); w.Header().Get("X-Total-Count") != "0" {
		t.Errorf("o total vazou para quem não lê: %q", w.Header().Get("X-Total-Count"))
	}
}

// Termo (Plano 12): POST e DELETE só na linha; o arquivo vai pelo Storage. Negado/inválido = a foto das 14 tabelas não muda.
func TestTermosEscrita(t *testing.T) {
	m := novoMundo(t, montarPastas)
	foto := m.Um(t, fotoDosAcessos)
	caminho := func(pessoa, resto string) string { return pessoa + "/" + resto }
	novo := `{"pessoa_id":"` + P3 + `","titulo":"Termo do celular","arquivo_path":"` + caminho(P3, "1760000000001-termo.pdf") + `"}`
	nada := func(nome, quem, metodo, rota, corpo string, status int, tem string) caso {
		return caso{Nome: nome, Quem: quem, Metodo: metodo, Caminho: rota, Corpo: corpo, Status: status, Tem: tem, Efeito: fotoDosAcessos, Quer: foto}
	}
	casos := []caso{
		nada("sem sessão", "", "POST", "/acessos/termos", novo, 401, ""),
		nada("entrar como não envia", "impersonado", "POST", "/acessos/termos", novo, 403, "Quem entrou como outra pessoa"),
		nada("entrar como não apaga", "impersonado", "DELETE", "/acessos/termos/"+T1, "", 403, "Quem entrou como outra pessoa"),
		nada("a conta desativada nem tem sessão", "desativado", "POST", "/acessos/termos", novo, 401, ""),
		nada("sem arquivo", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","titulo":"x"}`, 400, "pasta da pessoa"),
		nada("sem pessoa", "acessos", "POST", "/acessos/termos", `{"titulo":"x","arquivo_path":"`+caminho(P3, "a.pdf")+`"}`, 400, "pasta da pessoa"),
		nada("arquivo da pasta de OUTRA pessoa", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P1, "a.pdf")+`"}`, 400, "pasta da pessoa"),
		nada("arquivo fora da pasta", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"a.pdf"}`, 400, "pasta da pessoa"),
		nada("só a pasta, sem nome", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+P3+`/"}`, 400, "pasta da pessoa"),
		nada("subindo pasta", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, "../"+P1+"/a.pdf")+`"}`, 400, "pasta da pessoa"),
		nada("segmento vazio", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, "/a.pdf")+`"}`, 400, "pasta da pessoa"),
		nada("segmento ponto", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, "./a.pdf")+`"}`, 400, "pasta da pessoa"),
		nada("caractere de controle", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, `a\u0001.pdf`)+`"}`, 400, "pasta da pessoa"),
		nada("barra invertida", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, `a\\b.pdf`)+`"}`, 400, "pasta da pessoa"),
		nada("enviado_em é do banco", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, "a.pdf")+`","enviado_em":"2020-01-01T00:00:00Z"}`, 400, "corpo_invalido"),
		nada("id vem do banco", "acessos", "POST", "/acessos/termos", `{"pessoa_id":"`+P3+`","arquivo_path":"`+caminho(P3, "a.pdf")+`","id":"`+T1+`"}`, 400, "corpo_invalido"),
		nada("pessoa que não existe", "acessos", "POST", "/acessos/termos",
			`{"pessoa_id":"a4400000-0000-4000-a000-000000000099","arquivo_path":"a4400000-0000-4000-a000-000000000099/a.pdf"}`, 409, ""),
		nada("apagar termo inexistente", "acessos", "DELETE", "/acessos/termos/a4700000-0000-4000-a000-000000000099", "", 404, ""),
		nada("apagar com id malformado", "acessos", "DELETE", "/acessos/termos/nao-e-uuid", "", 404, ""),
	}
	for _, q := range semAcessos {
		casos = append(casos,
			nada("sem Acessos não envia: "+q, q, "POST", "/acessos/termos", novo, 403, ""),
			nada("sem Acessos não apaga (IDOR): "+q, q, "DELETE", "/acessos/termos/"+T1, "", 404, ""))
	}
	m.Rodar(t, casos)
	m.Rodar(t, []caso{
		{Nome: "envia", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/termos", Corpo: novo, Status: 201, Tem: `"titulo":"Termo do celular"`,
			Efeito: "select count(*)::text from acessos_termos where pessoa_id = '" + P3 + "'", Quer: "1"},
		{Nome: "a pessoa em maiúsculas no caminho (o uuid é o mesmo)", Quem: "admin", Metodo: "POST", Caminho: "/acessos/termos",
			Corpo: `{"pessoa_id":"` + P3 + `","observacao":"assinado","arquivo_path":"` + strings.ToUpper(P3) + `/2.pdf"}`, Status: 201, Tem: `"observacao":"assinado"`,
			Efeito: "select count(*)::text from acessos_termos where pessoa_id = '" + P3 + "'", Quer: "2"},
		{Nome: "pontos dentro do nome (o saneador da tela os mantém)", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/termos",
			Corpo: `{"pessoa_id":"` + P3 + `","arquivo_path":"` + caminho(P3, "1760000000002-termo...pdf") + `"}`, Status: 201, Tem: `termo...pdf`,
			Efeito: "select count(*)::text from acessos_termos where pessoa_id = '" + P3 + "'", Quer: "3"},
		{Nome: "o termo pelo id (baixar e excluir leem o arquivo_path assim)", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/termos?id=" + T1, Status: 200,
			Tem: P1 + `/1760000000000-termo.pdf`},
		{Nome: "o termo pelo id, sem Acessos: nada", Quem: "viewer", Metodo: "GET", Caminho: "/acessos/termos?id=" + T1, Status: 200, NaoTem: "termo.pdf"},
		{Nome: "id de termo malformado", Quem: "acessos", Metodo: "GET", Caminho: "/acessos/termos?id=x", Status: 400},
		{Nome: "apaga só a linha pedida", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/termos/" + T1, Status: 204,
			Efeito: "select count(*)::text from acessos_termos", Quer: "3"},
		{Nome: "apagar de novo = 404", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/termos/" + T1, Status: 404},
	})
}
