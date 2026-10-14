package vendas

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// fotoDosCaches: um hash dos dois caches; igual antes e depois = nada foi gravado.
const fotoDosCaches = `select md5(coalesce((select string_agg(t::text, '|' order by vendor_id) from bling_vendedores t), '') ||
	coalesce((select string_agg(t::text, '|' order by pedido_id) from bling_pedido_vendedor t), ''))`

func TestCachesLeitura(t *testing.T) {
	m := novoMundo(t, montarCaches)
	pedir := func(quem, caminho string) (int, string) { return m.Pedir(t, quem, http.MethodGet, caminho, "") }
	if st, c := pedir("viewer", "/comercial/vendedoras?ordem=nome"); st != 200 || chaves(t, c, "vendor_id") != "7,8" || !strings.HasPrefix(c, `[{"vendor_id":7`) {
		t.Errorf("vendedoras = %d %s", st, c)
	}
	// paridade: a policy de produção é `true` (achado 2 do plano: a vendedora lê o cache de outra loja)
	if st, c := pedir("vendT1", "/comercial/pedidos-vendedor?pedido_id=101,102"); st != 200 || chaves(t, c, "pedido_id") != "101,102" {
		t.Errorf("cache por pedido = %d %s", st, c)
	}
	if st, c := pedir("vendT1", "/comercial/pedidos-vendedor?ordem=pedido_data.desc&limite=1"); st != 200 || chaves(t, c, "pedido_id") != "102" {
		t.Errorf("cache mais novo = %d %s", st, c)
	}
	if st, _ := pedir("vendT1", "/comercial/pedidos-vendedor?pedido_id=abc"); st != http.StatusBadRequest {
		t.Errorf("pedido_id inválido = %d", st)
	}
}

func TestGravarCaches(t *testing.T) {
	m := novoMundo(t, montarCaches)
	const (
		cache = "/comercial/pedidos-vendedor/gravar"
		vend  = "/comercial/vendedoras/gravar"
	)
	linha := func(id int) string {
		return fmt.Sprintf(`select coalesce(vendor_id::text, '-') || '/' || coalesce(qtd_itens::text, '-') from bling_pedido_vendedor where pedido_id = %d`, id)
	}
	existe := func(id int) string {
		return fmt.Sprintf(`select count(*)::text from bling_pedido_vendedor where pedido_id = %d`, id)
	}
	foto := m.Um(t, fotoDosCaches)
	recusa := func(nome, quem, caminho, corpo string, status int, tem string) {
		t.Helper()
		st, c := m.Pedir(t, quem, http.MethodPost, caminho, corpo)
		if st != status || !strings.Contains(c, tem) {
			t.Errorf("%s: %d %s; esperava %d com %q", nome, st, c, status, tem)
		}
		if v := m.Um(t, fotoDosCaches); v != foto {
			t.Errorf("%s: gravou alguma coisa", nome)
		}
	}

	// 1. quem vê vendas cria e edita; coluna ausente não muda o que havia
	m.Rodar(t, []caso{
		{Nome: "cria 105 e edita 101", Quem: "vendT1", Metodo: "POST", Caminho: cache, Status: 200, Tem: `{"gravadas":2}`,
			Corpo:  `{"linhas":[{"pedido_id":105,"vendor_id":7,"pedido_data":"2026-10-06","qtd_itens":1,"loja_id":1},{"pedido_id":101,"qtd_itens":5}]}`,
			Efeito: linha(105), Quer: "7/1"},
		{Nome: "101: qtd_itens 5 e vendor_id ainda 7", Efeito: linha(101), Quer: "7/5"},
		// 3. o lote repetido na mesma requisição: a última vence
		{Nome: "a última do lote vence", Quem: "vendT1", Metodo: "POST", Caminho: cache, Status: 200,
			Corpo:  `{"linhas":[{"pedido_id":106,"vendor_id":7},{"pedido_id":106,"vendor_id":8}]}`,
			Efeito: linha(106), Quer: "8/1"},
	})
	foto = m.Um(t, fotoDosCaches)

	// 2. o banco exige vendor_id (NOT NULL no pg_dump do ensaio): `null` explícito é recusado, nada muda
	recusa("vendor_id nulo", "admin", cache, `{"linhas":[{"pedido_id":102,"vendor_id":null}]}`, 400, "")
	// linha nova só com a quantidade também esbarra no NOT NULL (como no PostgREST)
	recusa("linha nova sem vendedor", "vendT1", cache, `{"linhas":[{"pedido_id":120,"qtd_itens":1}]}`, 400, "")

	// 4. quem não pode (403, foto igual)
	um := `{"linhas":[{"pedido_id":101,"qtd_itens":9}]}`
	recusa("viewer", "viewer", cache, um, 403, "")
	recusa("sem trava, sem sales", "semTrava", cache, um, 403, "")
	recusa("entrar como", "impersonado", cache, um, 403, dados.FraseEntrarComo)
	recusa("vendedoras: viewer", "viewer", vend, `{"linhas":[{"vendor_id":7,"nome":"X"}]}`, 403, "")

	// 5. tudo ou nada
	recusa("tudo ou nada", "vendT1", cache, `{"linhas":[{"pedido_id":107,"vendor_id":7,"qtd_itens":1},{"pedido_id":108,"vendor_id":7,"qtd_itens":"muitos"}]}`, 400, "")
	if v := m.Um(t, existe(107)); v != "0" {
		t.Errorf("107 ficou gravado: %s", v)
	}

	// 6. pedido inválido
	var mil []string
	for i := range 1001 {
		mil = append(mil, fmt.Sprintf(`{"pedido_id":%d,"vendor_id":7}`, 1000+i))
	}
	for nome, corpo := range map[string]string{
		"lista vazia":    `{"linhas":[]}`,
		"1001 linhas":    `{"linhas":[` + strings.Join(mil, ",") + `]}`,
		"chave em texto": `{"linhas":[{"pedido_id":"101","qtd_itens":1}]}`,
		"chave zero":     `{"linhas":[{"pedido_id":0,"qtd_itens":1}]}`,
		"só a chave":     `{"linhas":[{"pedido_id":109}]}`,
	} {
		recusa(nome, "vendT1", cache, corpo, 400, "pedido_invalido")
	}
	recusa("coluna desconhecida", "vendT1", cache, `{"linhas":[{"pedido_id":110,"vendedor":7}]}`, 400, "corpo_invalido")
	recusa("sem o envelope", "vendT1", cache, `{"pedido_id":110,"qtd_itens":1}`, 400, "corpo_invalido")

	// 7. vendedoras
	m.Rodar(t, []caso{
		{Nome: "vendedoras", Quem: "vendT1", Metodo: "POST", Caminho: vend, Status: 200, Tem: `{"gravadas":2}`,
			Corpo:  `{"linhas":[{"vendor_id":9,"nome":"Carla","updated_at":"2026-10-12T10:00:00Z"},{"vendor_id":7,"nome":"Ana Paula"}]}`,
			Efeito: `select string_agg(vendor_id || ':' || nome, ',' order by vendor_id) from bling_vendedores`, Quer: "7:Ana Paula,8:Bia,9:Carla"},
	})
	foto = m.Um(t, fotoDosCaches)
	recusa("nome com 201 letras", "vendT1", vend, `{"linhas":[{"vendor_id":7,"nome":"`+strings.Repeat("a", 201)+`"}]}`, 400, "pedido_invalido")
	recusa("vendedora 0", "vendT1", vend, `{"linhas":[{"vendor_id":0,"nome":"x"}]}`, 400, "pedido_invalido")
}

// Duas TVs gravando o mesmo pedido ao mesmo tempo: as duas 200 e uma linha; em ordens opostas, sem deadlock.
func TestCachesSemCorrida(t *testing.T) {
	m := novoMundo(t, montarCaches)
	grava := func(lado int, corpo string) {
		quem := []string{"vendT1", "admin"}[lado]
		if st, c := m.Pedir(t, quem, http.MethodPost, "/comercial/pedidos-vendedor/gravar", corpo); st != 200 {
			t.Errorf("lado %d (%s) = %d %s", lado, quem, st, c)
		}
	}
	for i := range 20 {
		pedido := 200 + i
		aoMesmoTempo(func(lado int) {
			grava(lado, fmt.Sprintf(`{"linhas":[{"pedido_id":%d,"vendor_id":7,"qtd_itens":%d}]}`, pedido, 1+lado))
		})
		if v := m.Um(t, fmt.Sprintf(`select count(*)::text from bling_pedido_vendedor where pedido_id = %d`, pedido)); v != "1" {
			t.Fatalf("pedido %d: %s linhas", pedido, v)
		}
	}
	for i := range 20 {
		a, b := 300+2*i, 301+2*i
		if _, err := m.P.Exec(t.Context(), `insert into bling_pedido_vendedor (pedido_id, vendor_id) values ($1::bigint, 7), ($2::bigint, 7)`, a, b); err != nil {
			t.Fatal(err)
		}
		aoMesmoTempo(func(lado int) {
			p, q := a, b
			if lado == 1 {
				p, q = b, a
			}
			grava(lado, fmt.Sprintf(`{"linhas":[{"pedido_id":%d,"qtd_itens":%d},{"pedido_id":%d,"qtd_itens":%d}]}`, p, 5+lado, q, 5+lado))
		})
	}
}
