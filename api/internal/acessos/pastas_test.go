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
