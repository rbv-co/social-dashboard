package acesso

import (
	"encoding/json"
	"slices"
	"testing"
)

const (
	semEquipe = "e1000000-0000-4000-a000-00000000ffff" // id válido que não existe
	semMembro = "3e000000-0000-4000-a000-00000000ffff"
	semLibera = "3d000000-0000-4000-a000-00000000ffff"
)

// quais: os ids da lista devolvida pela rota, ordenados.
func quais(t *testing.T, m *mundo, quem, caminho string) []string {
	t.Helper()
	st, corpo := m.pedir(t, quem, "GET", caminho, "")
	if st != 200 {
		t.Fatalf("GET %s como %s = %d %s", caminho, quem, st, corpo)
	}
	var linhas []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal([]byte(corpo), &linhas); err != nil {
		t.Fatalf("GET %s: %v: %s", caminho, err, corpo)
	}
	ids := []string{}
	for _, l := range linhas {
		ids = append(ids, l.ID)
	}
	slices.Sort(ids)
	return ids
}

func conferirIds(t *testing.T, m *mundo, nome, quem, caminho string, quer ...string) {
	t.Helper()
	quer = append([]string{}, quer...)
	slices.Sort(quer)
	if got := quais(t, m, quem, caminho); !slices.Equal(got, quer) {
		t.Errorf("%s: GET %s como %s devolveu %v, esperava %v", nome, caminho, quem, got, quer)
	}
}

func contar(tabela string) string { return `select count(*)::text from ` + tabela }

func TestTimesMembrosELiberacoes(t *testing.T) {
	t.Run("times", func(t *testing.T) {
		m := novoMundo(t, montarTimes)
		conferirIds(t, m, "leitura é true para toda sessão", "vendT1", "/equipes/times", T1, T2, T3)
		conferirIds(t, m, "mesmo quem não está em time", "viewer", "/equipes/times", T1, T2, T3)
		nome := func(id string) string { return `select nome from equipes where id = '` + id + `'` }
		m.rodar(t, []caso{
			{nome: "super cria", quem: "super", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Time 4"}`, status: 201, tem: `"nome":"Time 4"`, efeito: contar("equipes"), quer: "4"},
			{nome: "gestor direto cria", quem: "gestorT1", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Time 5"}`, status: 201, efeito: contar("equipes"), quer: "5"},
			{nome: "supervisora não cria", quem: "supervT1", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Time 6"}`, status: 403, efeito: contar("equipes"), quer: "5"},
			{nome: "papel admin não cria time", quem: "admin", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Time 6"}`, status: 403, efeito: contar("equipes"), quer: "5"},
			{nome: "vendedora não cria", quem: "vendT1", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Time 6"}`, status: 403, efeito: contar("equipes"), quer: "5"},
			{nome: "gestor edita o próprio time", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"nome":"Time Um"}`, status: 200, tem: `"nome":"Time Um"`,
				efeito: `select (nome = 'Time Um' and atualizado_em > criado_em)::text from equipes where id = '` + T1 + `'`, quer: "true"},
			{nome: "gestor não edita time alheio (visível)", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T2, corpo: `{"nome":"Invadido"}`, status: 403, efeito: nome(T2), quer: "Time 2"},
			{nome: "supervisora (de grupo) não é gestora", quem: "supervG1", metodo: "PATCH", caminho: "/equipes/times/" + T3, corpo: `{"nome":"Invadido"}`, status: 403, efeito: nome(T3), quer: "Time 3"},
			{nome: "vendedora não edita", quem: "vendT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"nome":"Invadido"}`, status: 403, efeito: nome(T1), quer: "Time Um"},
			{nome: "super pela ficha edita (sou_gestor_da_equipe aceita a ficha)", quem: "superFicha", metodo: "PATCH", caminho: "/equipes/times/" + T2, corpo: `{"nome":"Time Dois"}`, status: 200, efeito: nome(T2), quer: "Time Dois"},
			{nome: "canal já é de outro time", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"canal_loja_id":2}`, status: 409, efeito: `select canal_loja_id::text from equipes where id = '` + T1 + `'`, quer: "1"},
			{nome: "tipo fora da lista", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"tipo":"bar"}`, status: 400, efeito: `select tipo from equipes where id = '` + T1 + `'`, quer: "loja"},
			{nome: "coluna que a rota não declara", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"ativo":false}`, status: 400, efeito: `select ativo::text from equipes where id = '` + T1 + `'`, quer: "true"},
			{nome: "id do corpo", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"id":"` + T2 + `"}`, status: 400, efeito: `select id::text from equipes where nome = 'Time Um'`, quer: T1},
			{nome: "time que não existe", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + semEquipe, corpo: `{"nome":"x"}`, status: 404},
			{nome: "sem sessão", quem: "", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"x"}`, status: 401, efeito: contar("equipes"), quer: "5"},
			// o corpo que as telas mandam de verdade (tela-de-admin.vue:1735-1738, time-de-vendas.vue:178): tirar
			// `tipo` ou `canal_loja_id` das structs quebraria as telas com 400
			{nome: "corpo real da tela: PATCH com nome, tipo e canal", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/times/" + T1, corpo: `{"nome":"Time Um","tipo":"canal","canal_loja_id":1}`, status: 200, tem: `"tipo":"canal"`,
				efeito: `select tipo from equipes where id = '` + T1 + `'`, quer: "canal"},
			{nome: "corpo real da tela: POST com tipo e canal nulo", quem: "gestorT1", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Nova","tipo":"loja","canal_loja_id":null}`, status: 201, tem: `"canal_loja_id":null`,
				efeito: contar("equipes"), quer: "6"},
		})
	})

	t.Run("membros leitura", func(t *testing.T) {
		m := novoMundo(t, montarTimes)
		m.rodar(t, []caso{
			{nome: "vendedora vê o próprio time", quem: "vendT1", metodo: "GET", caminho: "/equipes/membros", status: 200, tem: mGestorT1, naoTem: mVendT2},
			{nome: "e o vínculo do T1 inteiro", quem: "vendT1", metodo: "GET", caminho: "/equipes/membros", status: 200, tem: mSupervT1},
		})
		conferirIds(t, m, "vendedora do T1", "vendT1", "/equipes/membros", mGestorT1, mSupervT1, mVendT1)
		conferirIds(t, m, "T2 é invisível para a vendedora do T1", "vendT1", "/equipes/membros?equipe_id="+T2)
		conferirIds(t, m, "sem trava vê tudo", "semTrava", "/equipes/membros", mGestorT1, mSupervT1, mVendT1, mVendT2, mVendT2emT3)
		conferirIds(t, m, "supervisora do grupo vê o T3 (pelo grupo) e não o T2", "supervG1", "/equipes/membros?equipe_id="+T3, mVendT2emT3)
		conferirIds(t, m, "a vendedora do T2 vê o próprio vínculo no T3 e o do T2 (os dois são dela)", "vendT2", "/equipes/membros", mVendT2, mVendT2emT3)
		conferirIds(t, m, "filtros e limite", "gestorT1", "/equipes/membros?profile_id="+idGestorT1+"&papel=gestor,supervisora&limite=1", mGestorT1)
		conferirIds(t, m, "papel como lista", "gestorT1", "/equipes/membros?papel=gestor,supervisora", mGestorT1, mSupervT1)
		// quem não tem time nem vê o vínculo de ninguém, com ou sem filtro
		conferirIds(t, m, "viewer sem time", "viewer", "/equipes/membros")
		conferirIds(t, m, "viewer sem time, filtrando o T1", "viewer", "/equipes/membros?equipe_id="+T1)
		conferirIds(t, m, "admin com trava e sem time", "adminRestrito", "/equipes/membros")
		m.rodar(t, []caso{
			{nome: "uuid inválido no filtro", quem: "vendT1", metodo: "GET", caminho: "/equipes/membros?equipe_id=abc", status: 400},
			{nome: "filtro que a rota não declara", quem: "vendT1", metodo: "GET", caminho: "/equipes/membros?criado_por=" + idSuper, status: 400},
			{nome: "sem sessão", quem: "", metodo: "GET", caminho: "/equipes/membros", status: 401},
		})
	})

	t.Run("membros escrita", func(t *testing.T) {
		m := novoMundo(t, montarTimes)
		papel := func(id string) string { return `select papel from equipes_membros where id = '` + id + `'` }
		existe := func(id string) string { return `select count(*)::text from equipes_membros where id = '` + id + `'` }
		m.rodar(t, []caso{
			{nome: "gestor adiciona ao próprio time", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idViewer + `"}`, status: 201,
				tem: `"criado_por":"` + idGestorT1 + `"`, efeito: `select criado_por::text from equipes_membros where profile_id = '` + idViewer + `'`, quer: idGestorT1},
			{nome: "gestor não adiciona ao time alheio", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T2 + `","profile_id":"` + idAdmin + `"}`, status: 403, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "supervisora não adiciona", quem: "supervT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idAdmin + `"}`, status: 403, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "vendedora não adiciona", quem: "vendT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idAdmin + `"}`, status: 403, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "pessoa já está no time", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idVendT1 + `"}`, status: 409, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "papel fora da lista na criação", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idAdmin + `","papel":"dona"}`, status: 400, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "autoria no corpo", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idAdmin + `","criado_por":"` + idSuper + `"}`, status: 400, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "sem o time no corpo", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"profile_id":"` + idAdmin + `"}`, status: 400, efeito: contar("equipes_membros"), quer: "6"},
			{nome: "gestor muda o papel", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT1, corpo: `{"papel":"supervisora"}`, status: 200, tem: `"papel":"supervisora"`, efeito: papel(mVendT1), quer: "supervisora"},
			{nome: "vínculo de time invisível (trava) é 404", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT2, corpo: `{"papel":"gestor"}`, status: 404, efeito: papel(mVendT2), quer: "vendedora"},
			{nome: "vínculo visível, mas sem ser gestora: 403", quem: "semTrava", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT2, corpo: `{"papel":"gestor"}`, status: 403, efeito: papel(mVendT2), quer: "vendedora"},
			{nome: "supervisora não muda papel", quem: "supervT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT1, corpo: `{"papel":"gestor"}`, status: 403, efeito: papel(mVendT1), quer: "supervisora"},
			{nome: "papel fora da lista", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT1, corpo: `{"papel":"dona"}`, status: 400, efeito: papel(mVendT1), quer: "supervisora"},
			{nome: "trocar de time não existe", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT1, corpo: `{"equipe_id":"` + T2 + `"}`, status: 400, tem: "corpo_invalido",
				efeito: `select equipe_id::text from equipes_membros where id = '` + mVendT1 + `'`, quer: T1},
			{nome: "trocar a pessoa não existe", quem: "gestorT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT1, corpo: `{"profile_id":"` + idAdmin + `"}`, status: 400,
				efeito: `select profile_id::text from equipes_membros where id = '` + mVendT1 + `'`, quer: idVendT1},
			{nome: "vendedora não apaga o gestor", quem: "vendT1", metodo: "DELETE", caminho: "/equipes/membros/" + mGestorT1, status: 403, efeito: existe(mGestorT1), quer: "1"},
			{nome: "gestor não apaga vínculo invisível", quem: "gestorT1", metodo: "DELETE", caminho: "/equipes/membros/" + mVendT2, status: 404, efeito: existe(mVendT2), quer: "1"},
			{nome: "sem ser gestora, vínculo visível: 403", quem: "semTrava", metodo: "DELETE", caminho: "/equipes/membros/" + mVendT2, status: 403, efeito: existe(mVendT2), quer: "1"},
			{nome: "gestor apaga do próprio time", quem: "gestorT1", metodo: "DELETE", caminho: "/equipes/membros/" + mVendT1, status: 204, efeito: existe(mVendT1), quer: "0"},
			{nome: "super apaga de qualquer time", quem: "super", metodo: "DELETE", caminho: "/equipes/membros/" + mVendT2, status: 204, efeito: existe(mVendT2), quer: "0"},
			{nome: "o vínculo do T3 segue", efeito: existe(mVendT2emT3), quer: "1"},
			// o corpo que as telas mandam (tela-de-admin.vue:762, :1548): com `papel`; tirá-lo da struct quebraria com 400
			{nome: "corpo real da tela: gestor adiciona com papel", quem: "gestorT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idSuperFicha + `","papel":"vendedora"}`, status: 201,
				tem: `"papel":"vendedora"`, efeito: `select papel from equipes_membros where profile_id = '` + idSuperFicha + `' and equipe_id = '` + T1 + `'`, quer: "vendedora"},
		})
		// DELETE é de uma TABELA só: apagar o id de um time por esta rota não apaga o time
		m.rodar(t, []caso{
			{nome: "id de time na rota de membros", quem: "super", metodo: "DELETE", caminho: "/equipes/membros/" + T3, status: 404, efeito: contar("equipes"), quer: "3"},
		})
	})

	t.Run("sem autopromoção e sem oráculo", func(t *testing.T) {
		m := novoMundo(t, montarTimes)
		papel := `select papel from equipes_membros where id = '` + mVendT1 + `'`
		m.rodar(t, []caso{
			{nome: "vendedora não se promove pelo próprio vínculo (que ela lê)", quem: "vendT1", metodo: "PATCH", caminho: "/equipes/membros/" + mVendT1, corpo: `{"papel":"gestor"}`, status: 403, efeito: papel, quer: "vendedora"},
			// quem não é gestora recebe 403 mesmo quando o vínculo/liberação já existe em time alheio (não 409): sem oráculo
			{nome: "não-gestor, vínculo que já existe em time alheio: 403, não 409", quem: "supervT1", metodo: "POST", caminho: "/equipes/membros", corpo: `{"equipe_id":"` + T2 + `","profile_id":"` + idVendT2 + `"}`, status: 403, efeito: contar("equipes_membros"), quer: "5"},
			{nome: "não-supervisora, liberação que já existe em time alheio: 403, não 409", quem: "vendT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: `{"equipe_id":"` + T2 + `","profile_id":"` + idVendT2 + `","chave":"estoque"}`, status: 403, efeito: contar("equipes_permissoes"), quer: "2"},
		})
	})

	t.Run("liberações", func(t *testing.T) {
		m := novoMundo(t, montarTimes)
		conferirIds(t, m, "vendedora vê a própria", "vendT1", "/equipes/permissoes", epVendT1)
		conferirIds(t, m, "T2 invisível filtrando", "vendT1", "/equipes/permissoes?equipe_id="+T2)
		conferirIds(t, m, "sem trava vê todas", "semTrava", "/equipes/permissoes", epVendT1, epVendT2)
		conferirIds(t, m, "filtro por pessoa", "semTrava", "/equipes/permissoes?profile_id="+idVendT2, epVendT2)
		conferirIds(t, m, "viewer sem time", "viewer", "/equipes/permissoes")
		conferirIds(t, m, "admin com trava e sem time", "adminRestrito", "/equipes/permissoes")
		existe := func(id string) string { return `select count(*)::text from equipes_permissoes where id = '` + id + `'` }
		novo := func(eq, pessoa, chave string) string {
			return `{"equipe_id":"` + eq + `","profile_id":"` + pessoa + `","chave":"` + chave + `"}`
		}
		m.rodar(t, []caso{
			{nome: "vendedora vê a dela e não a do T2", quem: "vendT1", metodo: "GET", caminho: "/equipes/permissoes", status: 200, tem: epVendT1, naoTem: epVendT2},
			{nome: "supervisora concede no próprio time", quem: "supervT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T1, idGestorT1, "estoque"), status: 201,
				tem: `"concedido_por":"` + idSupervT1 + `"`, efeito: `select concedido_por::text from equipes_permissoes where profile_id = '` + idGestorT1 + `'`, quer: idSupervT1},
			{nome: "supervisora do grupo concede no T3", quem: "supervG1", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T3, idVendT2, "estoque"), status: 201, efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "vendedora não concede", quem: "vendT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T1, idSupervT1, "estoque"), status: 403, efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "supervisora não concede no time alheio", quem: "supervT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T2, idSupervT1, "estoque"), status: 403, efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "papel admin sem time não concede", quem: "admin", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T1, idSupervT1, "estoque"), status: 403, efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "chave fora da lista", quem: "supervT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T1, idSupervT1, "vendas"), status: 400, efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "autoria no corpo", quem: "supervT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idSupervT1 + `","chave":"estoque","concedido_por":"` + idSuper + `"}`, status: 400, tem: "corpo_invalido", efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "mesma liberação duas vezes", quem: "supervT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: novo(T1, idGestorT1, "estoque"), status: 409, efeito: contar("equipes_permissoes"), quer: "4"},
			{nome: "supervisora não apaga a do time alheio (invisível)", quem: "supervT1", metodo: "DELETE", caminho: "/equipes/permissoes/" + epVendT2, status: 404, efeito: existe(epVendT2), quer: "1"},
			{nome: "visível sem ser supervisora: 403", quem: "semTrava", metodo: "DELETE", caminho: "/equipes/permissoes/" + epVendT2, status: 403, efeito: existe(epVendT2), quer: "1"},
			{nome: "a própria vendedora não apaga a dela", quem: "vendT1", metodo: "DELETE", caminho: "/equipes/permissoes/" + epVendT1, status: 403, efeito: existe(epVendT1), quer: "1"},
			{nome: "supervisora apaga a do próprio time", quem: "supervT1", metodo: "DELETE", caminho: "/equipes/permissoes/" + epVendT1, status: 204, efeito: existe(epVendT1), quer: "0"},
			{nome: "super pela ficha apaga de qualquer time", quem: "superFicha", metodo: "DELETE", caminho: "/equipes/permissoes/" + epVendT2, status: 204, efeito: existe(epVendT2), quer: "0"},
			{nome: "liberação não se edita", quem: "super", metodo: "PATCH", caminho: "/equipes/permissoes/" + epVendT1, corpo: `{"chave":"estoque"}`, status: 405, efeito: contar("equipes_permissoes"), quer: "2"},
		})
	})
}

// O IDOR não distingue "não é seu" de "não existe": a resposta do vínculo/liberação que a pessoa não
// enxerga é IGUAL à do id que não existe (status e corpo).
func TestTimesIDORIgualAoInexistente(t *testing.T) {
	m := novoMundo(t, montarTimes)
	igual := func(nome, quem, metodo, alvo, inexistente, corpo string) {
		t.Helper()
		st1, c1 := m.pedir(t, quem, metodo, alvo, corpo)
		st2, c2 := m.pedir(t, quem, metodo, inexistente, corpo)
		if st1 != 404 || st1 != st2 || c1 != c2 {
			t.Errorf("%s: invisível = %d %s; inexistente = %d %s (iguais e 404)", nome, st1, c1, st2, c2)
		}
	}
	igual("PATCH membro", "gestorT1", "PATCH", "/equipes/membros/"+mVendT2, "/equipes/membros/"+semMembro, `{"papel":"gestor"}`)
	igual("DELETE membro", "gestorT1", "DELETE", "/equipes/membros/"+mVendT2, "/equipes/membros/"+semMembro, "")
	igual("DELETE liberação", "supervT1", "DELETE", "/equipes/permissoes/"+epVendT2, "/equipes/permissoes/"+semLibera, "")
	igual("id que nem é uuid", "gestorT1", "DELETE", "/equipes/membros/abc", "/equipes/membros/"+semMembro, "")
}

// A sessão de "entrar como" só lê (Ruling 5.1-4): mesmo quando o ALVO poderia escrever (gestor do T1,
// supervisora do T1), nenhuma das escritas passa e nada muda. A rota de leitura segue valendo.
func TestTimesImpersonadoSoLe(t *testing.T) {
	m := novoMundo(t, montarTimes)
	m.entrarComo(t, "gestorImp", idGestorT1, idSuper)
	m.entrarComo(t, "supervImp", idSupervT1, idSuper)
	antes := m.um(t, fotoDoMundo)
	imp := func(nome, quem, metodo, caminho, corpo string) caso {
		return caso{nome: nome, quem: quem, metodo: metodo, caminho: caminho, corpo: corpo, status: 403, tem: "Quem entrou como outra pessoa", efeito: fotoDoMundo, quer: antes}
	}
	m.rodar(t, []caso{
		// as mesmas requisições, sem o "entrar como", passariam: o 403 é do portão, não da regra do alvo
		imp("cria time", "gestorImp", "POST", "/equipes/times", `{"nome":"Time 4"}`),
		imp("edita time", "gestorImp", "PATCH", "/equipes/times/"+T1, `{"nome":"Outro"}`),
		imp("adiciona membro", "gestorImp", "POST", "/equipes/membros", `{"equipe_id":"`+T1+`","profile_id":"`+idViewer+`"}`),
		imp("muda papel", "gestorImp", "PATCH", "/equipes/membros/"+mVendT1, `{"papel":"supervisora"}`),
		imp("apaga membro", "gestorImp", "DELETE", "/equipes/membros/"+mVendT1, ""),
		imp("concede liberação", "supervImp", "POST", "/equipes/permissoes", `{"equipe_id":"`+T1+`","profile_id":"`+idGestorT1+`","chave":"estoque"}`),
		imp("apaga liberação", "supervImp", "DELETE", "/equipes/permissoes/"+epVendT1, ""),
		imp("o admin impersonado também", "impersonado", "POST", "/equipes/membros", `{"equipe_id":"`+T1+`","profile_id":"`+idViewer+`"}`),
		{nome: "leitura segue", quem: "gestorImp", metodo: "GET", caminho: "/equipes/membros", status: 200, tem: mGestorT1},
	})
	// a prova de que o portão é que barra: as mesmas escritas sem "entrar como" passam
	m.rodar(t, []caso{
		{nome: "gestor de verdade cria", quem: "gestorT1", metodo: "POST", caminho: "/equipes/times", corpo: `{"nome":"Time 4"}`, status: 201},
		{nome: "supervisora de verdade concede", quem: "supervT1", metodo: "POST", caminho: "/equipes/permissoes", corpo: `{"equipe_id":"` + T1 + `","profile_id":"` + idGestorT1 + `","chave":"estoque"}`, status: 201},
	})
}
