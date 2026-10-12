package acesso

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

const impersonaMsg = "Quem entrou como outra pessoa"

func TestPerfisDeAcesso(t *testing.T) {
	m := novoMundo(t, montarPerfis)
	// sessão de "entrar como" cujo ALVO é super-admin por e-mail: só a recusa do impersonado a barra
	// (a do `impersonado` do mundo, alvo admin, já cairia na regra de super)
	alvoSuper := idSuper
	tok, err := auth.NovoStore(m.p).Criar(context.Background(), idSuper, "painel", &alvoSuper)
	if err != nil {
		t.Fatal(err)
	}
	m.tok["superImpersonado"] = tok

	n := `select count(*)::text from acessos_perfis`
	perm := func(id string) string {
		return `select permissions::text from acessos_perfis where id = '` + id + `'`
	}
	porNome := func(c, nome string) string {
		return `select coalesce(` + c + `::text, '<nulo>') from acessos_perfis where nome = '` + nome + `'`
	}
	u := func(id string) string { return "/acesso/perfis/" + id }
	const livre = "3a000000-0000-4000-a000-000000000099"
	vend := `{"frota": ["ver"]}`

	m.rodar(t, []caso{
		// leitura: regra `true` (toda sessão autenticada)
		{"vendedora lê os perfis", "vendT1", "GET", "/acesso/perfis", "", 200, perfilVendedora, "", "", ""},
		{"admin restrito lê os perfis (regra true)", "adminRestrito", "GET", "/acesso/perfis", "", 200, "Vendedora", "", "", ""},
		{"sessão sem perfil também lê (regra true)", "semPerfil", "GET", "/acesso/perfis", "", 200, "Vendedora", "", "", ""},
		{"sem sessão", "", "GET", "/acesso/perfis", "", 401, "", "", "", ""},
		{"filtro nome", "vendT1", "GET", "/acesso/perfis?nome=Vendedora", "", 200, perfilVendedora, "", "", ""},
		{"filtro nome sem acerto", "vendT1", "GET", "/acesso/perfis?nome=x", "", 200, "[]", "Vendedora", "", ""},
		// igualdade EXATA (sem caixa, sem prefixo): a tela procura o nome único antes de regravar
		{"nome é igualdade exata (caixa)", "vendT1", "GET", "/acesso/perfis?nome=vendedora", "", 200, "", "Vendedora", "", ""},
		{"nome é igualdade exata (prefixo)", "vendT1", "GET", "/acesso/perfis?nome=Vend", "", 200, "", "Vendedora", "", ""},
		{"parâmetro desconhecido não vira filtro silencioso", "vendT1", "GET", "/acesso/perfis?permissions=x", "", 400, "", "", "", ""},

		// criar: is_superadmin() = a LISTA DE E-MAILS, não a ficha
		{"super (e-mail da lista) cria, com autoria da sessão", "super", "POST", "/acesso/perfis", `{"nome":"Estoquista","permissions":{"estoque":["ver"]}}`, 201, `"criado_por":"` + idSuper + `"`, "", porNome("criado_por", "Estoquista"), idSuper},
		{"…e o perfil novo aparece na leitura", "vendT1", "GET", "/acesso/perfis?nome=Estoquista", "", 200, "estoque", "", n, "2"},
		{"super SÓ por e-mail (ficha falsa) também cria", "superSoPorEmail", "POST", "/acesso/perfis", `{"nome":"PorEmail"}`, 201, `"criado_por":"` + idSuperSoPorEmail + `"`, "", porNome("permissions", "PorEmail"), "{}"},
		{"super só pela ficha NÃO cria", "superFicha", "POST", "/acesso/perfis", `{"nome":"Ficha","permissions":{}}`, 403, "sem_permissao", "", n, "3"},
		{"admin não cria", "admin", "POST", "/acesso/perfis", `{"nome":"Admin","permissions":{}}`, 403, "sem_permissao", "", n, "3"},
		{"admin restrito não cria", "adminRestrito", "POST", "/acesso/perfis", `{"nome":"Restrito","permissions":{}}`, 403, "", "", n, "3"},
		{"viewer não cria", "viewer", "POST", "/acesso/perfis", `{"nome":"Viewer","permissions":{}}`, 403, "", "", n, "3"},
		{"sessão sem perfil não cria", "semPerfil", "POST", "/acesso/perfis", `{"nome":"SemPerfil","permissions":{}}`, 403, "", "", n, "3"},
		{"sem sessão não cria", "", "POST", "/acesso/perfis", `{"nome":"Anon"}`, 401, "", "", n, "3"},
		{"entrar-como (alvo super) não cria", "superImpersonado", "POST", "/acesso/perfis", `{"nome":"Entrou","permissions":{}}`, 403, impersonaMsg, "", n, "3"},
		{"nome repetido = 409 (a tela oferece regravar)", "super", "POST", "/acesso/perfis", `{"nome":"Vendedora","permissions":{}}`, 409, "conflito", "", perm(perfilVendedora), vend},
		{"permissions tem de ser objeto (array)", "super", "POST", "/acesso/perfis", `{"nome":"A","permissions":[]}`, 400, "objeto", "", n, "3"},
		{"permissions tem de ser objeto (texto)", "super", "POST", "/acesso/perfis", `{"nome":"A","permissions":"x"}`, 400, "objeto", "", n, "3"},
		{"permissions tem de ser objeto (null)", "super", "POST", "/acesso/perfis", `{"nome":"A","permissions":null}`, 400, "objeto", "", n, "3"},
		{"autoria no corpo = 400", "super", "POST", "/acesso/perfis", `{"nome":"A","permissions":{},"criado_por":"` + idAdmin + `"}`, 400, "corpo_invalido", "", n, "3"},
		{"id no corpo = 400", "super", "POST", "/acesso/perfis", `{"id":"` + livre + `","nome":"A","permissions":{}}`, 400, "corpo_invalido", "", n, "3"},
		{"sem nome = 400", "super", "POST", "/acesso/perfis", `{"permissions":{}}`, 400, "", "", n, "3"},
		{"corpo vazio = 400", "super", "POST", "/acesso/perfis", `{}`, 400, "corpo_invalido", "", n, "3"},

		// editar permissions
		{"super edita as permissões", "super", "PATCH", u(perfilVendedora), `{"permissions":{"frota":["ver","editar"]}}`, 200, "editar", "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"…sem tocar nome nem autoria", "", "", "", "", 0, "", "", porNome("nome || '|' || coalesce(criado_por::text, '-')", "Vendedora"), "Vendedora|-"},
		{"super só pela ficha NÃO edita", "superFicha", "PATCH", u(perfilVendedora), `{"permissions":{"tudo":["ver"]}}`, 403, "sem_permissao", "tudo", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"admin não edita", "admin", "PATCH", u(perfilVendedora), `{"permissions":{"tudo":["ver"]}}`, 403, "", "tudo", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"admin restrito não edita", "adminRestrito", "PATCH", u(perfilVendedora), `{"permissions":{"tudo":["ver"]}}`, 403, "", "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"vendedora não edita", "vendT1", "PATCH", u(perfilVendedora), `{"permissions":{"tudo":["ver"]}}`, 403, "", "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"sem sessão não edita", "", "PATCH", u(perfilVendedora), `{"permissions":{}}`, 401, "", "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"entrar-como (alvo super) não edita", "superImpersonado", "PATCH", u(perfilVendedora), `{"permissions":{"tudo":["ver"]}}`, 403, impersonaMsg, "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"entrar-como (alvo admin) não edita", "impersonado", "PATCH", u(perfilVendedora), `{"permissions":{"tudo":["ver"]}}`, 403, impersonaMsg, "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"nome não se edita", "super", "PATCH", u(perfilVendedora), `{"nome":"y"}`, 400, "corpo_invalido", "", porNome("id::text", "Vendedora"), perfilVendedora},
		{"autoria não se edita", "super", "PATCH", u(perfilVendedora), `{"criado_por":"` + idAdmin + `"}`, 400, "corpo_invalido", "", porNome("criado_por", "Vendedora"), "<nulo>"},
		{"corpo vazio", "super", "PATCH", u(perfilVendedora), `{}`, 400, "corpo_invalido", "", "", ""},
		{"permissions tem de ser objeto", "super", "PATCH", u(perfilVendedora), `{"permissions":["frota"]}`, 400, "objeto", "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"permissions null", "super", "PATCH", u(perfilVendedora), `{"permissions":null}`, 400, "objeto", "", perm(perfilVendedora), `{"frota": ["ver", "editar"]}`},
		{"id que não existe", "super", "PATCH", u(livre), `{"permissions":{}}`, 404, "nao_encontrado", "", n, "3"},
		{"id malformado", "super", "PATCH", u("nao-e-uuid"), `{"permissions":{}}`, 404, "nao_encontrado", "", n, "3"},
	})

	// Perfis de acesso são legíveis por TODA sessão (regra `true`): o 404 do id inexistente para quem não
	// escreve (o 403 vem depois de achar a linha) não revela nada que o GET não mostre. Fixa o contrato.
	for _, quem := range []string{"admin", "superFicha", "viewer"} {
		if st, corpo := m.pedir(t, quem, "PATCH", u(livre), `{"permissions":{}}`); st != 404 || !strings.Contains(corpo, "nao_encontrado") {
			t.Errorf("%s em id inexistente = %d %s", quem, st, corpo)
		}
	}

	// a resposta da escrita é a linha inteira, do jeito da leitura
	_, corpo := m.pedir(t, "super", "PATCH", u(perfilVendedora), `{"permissions":{"frota":["ver"]}}`)
	var l map[string]any
	if json.Unmarshal([]byte(corpo), &l) != nil || len(l) != 5 || l["nome"] != "Vendedora" || l["id"] != perfilVendedora {
		t.Errorf("resposta do PATCH = %s", corpo)
	}
	if !strings.Contains(m.um(t, perm(perfilVendedora)), "ver") {
		t.Error("a edição não gravou")
	}
}

// Quem não é super-admin por e-mail não escreve nem por um caminho que passe pelo handler real,
// qualquer que seja o papel ou a trava: nada muda em nenhuma tabela do 5.1.
func TestPerfisNegadoNaoGravaNada(t *testing.T) {
	m := novoMundo(t, montarPerfis)
	antes := m.um(t, fotoDoMundo)
	for _, quem := range []string{"admin", "adminRestrito", "superFicha", "viewer", "vendT1", "gestorT1", "supervG1", "semPerfil", "impersonado"} {
		for _, c := range []struct{ metodo, caminho, corpo string }{
			{"POST", "/acesso/perfis", `{"nome":"Invasor","permissions":{"tudo":["ver","editar"]}}`},
			{"PATCH", "/acesso/perfis/" + perfilVendedora, `{"permissions":{"tudo":["ver","editar"]}}`},
		} {
			if st, corpo := m.pedir(t, quem, c.metodo, c.caminho, c.corpo); st != 403 || strings.Contains(corpo, "Invasor") || strings.Contains(corpo, "tudo") {
				t.Errorf("%s %s %s = %d %s", quem, c.metodo, c.caminho, st, corpo)
			}
		}
	}
	if m.um(t, fotoDoMundo) != antes {
		t.Error("um pedido negado mexeu no banco")
	}
}
