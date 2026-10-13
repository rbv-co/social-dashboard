package testebanco

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
)

// A fatia 5.2: os gatilhos do bem e do carro, VERBATIM e com o UPDATE OF/WHEN das migrations, e as
// RPCs do cadastro rápido e da ligação carro ↔ bem rodando com a identidade da transação.
func TestFatiaDoPatrimonioComGatilhosVerbatim(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		pat     = "5e200000-0000-4000-a000-000000000001" // features {patrimonio}
		ninguem = "5e200000-0000-4000-a000-000000000002" // sem módulo
		p1      = "9e200000-0000-4000-a000-000000000001"
		p2      = "9e200000-0000-4000-a000-000000000002"
		e1      = "a1000000-0000-4000-a000-000000000001"
		l1      = "a2000000-0000-4000-a000-000000000001"
		catV    = "a4000000-0000-4000-a000-000000000001"
		catM    = "a4000000-0000-4000-a000-000000000002"
		b1      = "b0000000-0000-4000-a000-000000000001"
		bv      = "b0000000-0000-4000-a000-000000000005"
		v1      = "f0000000-0000-4000-a000-000000000001"
		u1      = "f1000000-0000-4000-a000-000000000001"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+pat+`', 'pat@x.com'), ('`+ninguem+`', 'ninguem@x.com');
		insert into profiles (id, email, role, features) values ('`+pat+`', 'pat@x.com', 'viewer', '{patrimonio}'),
		  ('`+ninguem+`', 'ninguem@x.com', 'viewer', '{}');
		insert into acessos_pessoas (id, nome) values ('`+p1+`', 'Pessoa Um'), ('`+p2+`', 'Pessoa Dois');
		insert into patrimonio_empresas (id, nome) values ('`+e1+`', 'Vessel');
		insert into patrimonio_locais (id, nome, empresa_id) values ('`+l1+`', 'Loja', '`+e1+`');
		insert into patrimonio_categorias (id, nome) values ('`+catV+`', 'Veículos'), ('`+catM+`', 'Móveis');
		insert into patrimonio_bens (id, numero, nome, local_id, categoria_id, pessoa_id, situacao) values
		  ('`+bv+`', 10, 'Kwid', '`+l1+`', '`+catV+`', '`+p1+`', 'em_estoque'),
		  ('`+b1+`', 1, 'Cadeira', '`+l1+`', '`+catM+`', null, 'em_uso');
		insert into frota_veiculos (id, placa, nome, situacao, pessoa_id) values ('`+v1+`', 'ABC1D23', 'Kwid', 'ativo', '`+p1+`');
		insert into frota_uso (id, veiculo_id, pessoa_id, tipo) values ('`+u1+`', '`+v1+`', '`+p1+`', 'posse');`); err != nil {
		t.Fatal(err)
	}
	como := func(id, sql string) error {
		return banco.ComUsuario(ctx, p, id, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql); return err })
	}
	um := func(sql string) string {
		var v *string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return "<nulo>"
		}
		return *v
	}
	// situação do bem | situação do carro | responsável do carro | posse do carro aberta?
	estado := func() string {
		return um(`select b.situacao || '|' || v.situacao || '|' || coalesce(v.pessoa_id::text, '-') || '|' ||
			(select (u.volta_em is null)::text from frota_uso u where u.id = '` + u1 + `')
			from patrimonio_bens b, frota_veiculos v where b.id = '` + bv + `' and v.id = '` + v1 + `'`)
	}
	for _, c := range []struct{ nome, sql, quer string }{
		{"ligar o carro ao bem leva a situação do carro ao bem",
			`update frota_veiculos set bem_id = '` + bv + `' where id = '` + v1 + `'`, "em_uso|ativo|" + p1 + "|true"},
		{"bem de veículo segue a frota: mudar a situação no Patrimônio não pega",
			`update patrimonio_bens set situacao = 'em_estoque' where id = '` + bv + `'`, "em_uso|ativo|" + p1 + "|true"},
		{"o responsável do bem espelha no carro e a posse do carro continua aberta (WHEN)",
			`update patrimonio_bens set pessoa_id = '` + p2 + `' where id = '` + bv + `'`, "em_uso|ativo|" + p2 + "|true"},
		{"a situação do carro espelha no bem",
			`update frota_veiculos set situacao = 'em_manutencao' where id = '` + v1 + `'`, "em_manutencao|em_manutencao|" + p2 + "|true"},
		{"bem sem responsável: o carro também, e a posse aberta do carro fecha",
			`update patrimonio_bens set pessoa_id = null where id = '` + bv + `'`, "em_manutencao|em_manutencao|-|false"},
	} {
		if err := como(pat, c.sql); err != nil {
			t.Fatalf("%s: %v", c.nome, err)
		}
		if v := estado(); v != c.quer {
			t.Errorf("%s: %s, esperava %s", c.nome, v, c.quer)
		}
	}
	if err := como(pat, `update patrimonio_bens set situacao = 'baixado' where id = '`+b1+`'`); err != nil {
		t.Fatal(err)
	}
	if v := um(`select situacao from patrimonio_bens where id = '` + b1 + `'`); v != "baixado" {
		t.Errorf("item comum (sem carro) = %s: a situação dele é decidida no Patrimônio", v)
	}

	// RPCs verbatim, com quem pede
	jaExistia := func(nome string) bool {
		var ja bool
		if err := banco.ComUsuario(ctx, p, pat, func(tx pgx.Tx) error {
			return tx.QueryRow(ctx, `select ja_existia from criar_pessoa_rapida($1::text)`, nome).Scan(&ja)
		}); err != nil {
			t.Fatalf("criar_pessoa_rapida(%q): %v", nome, err)
		}
		return ja
	}
	if jaExistia("Fulana de Tal") || !jaExistia("  fulana de tal ") {
		t.Error("criar_pessoa_rapida não achou a existente pelo nome sem caixa e sem espaços")
	}
	codigo := erroDoBanco
	if c := codigo(como(ninguem, `select * from criar_pessoa_rapida('Outra')`)); !strings.HasPrefix(c, "42501 Sem acesso para cadastrar colaborador") {
		t.Errorf("sem módulo: %q", c)
	}
	err := como(pat, `select sincronizar_carro_e_bem(p_bem_id => '`+b1+`', p_placa => 'XYZ9A88', p_nome => 'Carro')`)
	if c := codigo(err); !strings.HasPrefix(c, `23514 O nº de patrimônio 1 é "Cadeira", que não é um veículo`) {
		t.Errorf("trava de categoria: %q", c)
	}
	if v := um(`select count(*)::text from frota_veiculos`); v != "1" {
		t.Errorf("carros = %s: a função abortada não pode deixar o carro que criou", v)
	}
}

// O que o teste acima não cobre: o UPDATE OF do gatilho da posse (só uma troca de responsável para nulo
// fecha a posse; mudar o nome do carro, não), um default lido por regra (frota_uso.tipo = 'viagem' não é
// posse: o fechamento filtra por tipo) e o caminho feliz das RPCs, que exercita as colunas MÍNIMAS
// das tabelas dos outros sub-planos (acessos_setores, frota_veiculos, acessos_pessoas ampliada).
func TestFatiaDoPatrimonioPosseDefaultsERPCsFelizes(t *testing.T) {
	p := ComEsquemaDeProducao(t)
	ctx := context.Background()
	const (
		pat  = "5e200000-0000-4000-a000-000000000011" // features {patrimonio}
		e1   = "a1000000-0000-4000-a000-000000000011"
		catV = "a4000000-0000-4000-a000-000000000011"
		v1   = "f0000000-0000-4000-a000-000000000011"
		pos  = "f1000000-0000-4000-a000-000000000011"
		via  = "f1000000-0000-4000-a000-000000000012"
	)
	if _, err := p.Exec(ctx, `
		insert into usuarios (id, email) values ('`+pat+`', 'pat@x.com');
		insert into profiles (id, email, role, features) values ('`+pat+`', 'pat@x.com', 'viewer', '{patrimonio}');
		insert into patrimonio_empresas (id, nome) values ('`+e1+`', 'Vessel');
		insert into patrimonio_categorias (id, nome) values ('`+catV+`', 'Veículos');
		insert into frota_veiculos (id, placa, nome, pessoa_id) values ('`+v1+`', 'ABC1D23', 'Kwid', null);
		-- carro sem responsável com uma posse aberta (combinação que o gatilho existe para desfazer) e uma
		-- viagem aberta, sem tipo: o default 'viagem' a deixa fora do fechamento
		insert into frota_uso (id, veiculo_id, tipo) values ('`+pos+`', '`+v1+`', 'posse');
		insert into frota_uso (id, veiculo_id) values ('`+via+`', '`+v1+`');`); err != nil {
		t.Fatal(err)
	}
	como := func(sql string, args ...any) error {
		return banco.ComUsuario(ctx, p, pat, func(tx pgx.Tx) error { _, err := tx.Exec(ctx, sql, args...); return err })
	}
	um := func(sql string) string {
		var v string
		if err := p.QueryRow(ctx, sql).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	abertas := func() string {
		return um(`select string_agg(tipo || ':' || (volta_em is null)::text, ',' order by tipo) from frota_uso`)
	}
	if err := como(`update frota_veiculos set nome = 'Kwid 2' where id = '` + v1 + `'`); err != nil {
		t.Fatal(err)
	}
	if v := abertas(); v != "posse:true,viagem:true" {
		t.Errorf("mudar o nome do carro mexeu nas posses (UPDATE OF pessoa_id): %s", v)
	}
	if err := como(`update frota_veiculos set pessoa_id = null where id = '` + v1 + `'`); err != nil {
		t.Fatal(err)
	}
	if v := abertas(); v != "posse:false,viagem:true" {
		t.Errorf("a posse fecha e a viagem (default do tipo) continua aberta: %s", v)
	}

	// cadastro rápido de setor e de pessoa, com as colunas mínimas que as RPCs leem
	rpc := func(sql string, args ...any) (res []string) {
		if err := banco.ComUsuario(ctx, p, pat, func(tx pgx.Tx) error {
			linhas, err := tx.Query(ctx, sql, args...)
			if err != nil {
				return err
			}
			res, err = pgx.CollectRows(linhas, pgx.RowTo[string])
			return err
		}); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return res
	}
	var setor string
	for i, nome := range []string{"Loja", "  loja ", "Estoque"} {
		r := rpc(`select id::text || '|' || ja_existia::text from criar_setor_rapido($1::text)`, nome)
		id, ja, _ := strings.Cut(r[0], "|")
		if want := i == 1; ja != fmt.Sprint(want) {
			t.Errorf("criar_setor_rapido(%q).ja_existia = %s", nome, ja)
		}
		if i == 0 {
			setor = id
		} else if i == 1 && id != setor {
			t.Errorf("criar_setor_rapido devolveu outro id para o mesmo nome")
		}
	}
	if v := rpc(`select string_agg(nome, ',' order by ordem, nome) from setores_para_escolher() s join acessos_setores a using (id, nome)`); v[0] != "Loja,Estoque" {
		t.Errorf("setores_para_escolher = %v (a ordem é a da criação)", v)
	}
	r := rpc(`select status || '|' || coalesce(cargo, '-') || '|' || ja_existia::text from criar_pessoa_rapida('Ana', 'Caixa', $1::uuid, $2::uuid)`, e1, setor)
	if r[0] != "ativo|Caixa|false" {
		t.Errorf("criar_pessoa_rapida = %s (status vem do default da tabela)", r[0])
	}
	if v := um(`select marca_id::text || '|' || setor_id::text from acessos_pessoas where nome = 'Ana'`); v != e1+"|"+setor {
		t.Errorf("marca e setor da pessoa nova = %s", v)
	}
	if v := rpc(`select nome from pessoas_para_escolher()`); len(v) != 1 || v[0] != "Ana" {
		t.Errorf("pessoas_para_escolher = %v", v)
	}

	// sincronizar_carro_e_bem: cria o carro e o bem, liga, e uma segunda chamada reconhece a ligação
	chamada := `select sincronizar_carro_e_bem(p_placa => 'qwe-1a23', p_etiqueta => 77, p_nome => 'Fiorino', p_marca => 'Fiat', p_valor_centavos => 9000000)->>'fez'`
	if r := rpc(chamada); r[0] != "criou_os_dois" {
		t.Errorf("1ª chamada fez %q", r[0])
	}
	if r := rpc(chamada); r[0] != "ja_ligados" {
		t.Errorf("2ª chamada fez %q", r[0])
	}
	if v := um(`select b.nome || '|' || b.situacao || '|' || b.categoria_id::text || '|' || v.situacao || '|' || v.placa
		from patrimonio_bens b join frota_veiculos v on v.bem_id = b.id where b.numero = 77`); v != "Fiorino|em_uso|"+catV+"|ativo|QWE1A23" {
		t.Errorf("carro e bem criados = %s", v)
	}
	// carro já ligado a outro item: a função desfaz
	err := como(`select sincronizar_carro_e_bem(p_placa => 'QWE1A23', p_etiqueta => 78, p_nome => 'Outro')`)
	if c := erroDoBanco(err); !strings.HasPrefix(c, "23514 ") {
		t.Errorf("etiqueta nova para carro ligado: %q", c)
	}
	if v := um(`select count(*)::text from patrimonio_bens where numero = 78`); v != "0" {
		t.Errorf("o item 78 criado pela chamada abortada ficou (%s item): a função inteira tem de desfazer", v)
	}
	// um carro por bem (acessos/048): a função confia no índice único para não ligar dois carros ao mesmo item
	err = como(`insert into frota_veiculos (placa, nome, bem_id) select 'ZZZ9Z99', 'Duplicado', bem_id from frota_veiculos where placa = 'QWE1A23'`)
	if c := erroDoBanco(err); !strings.HasPrefix(c, "23505 ") {
		t.Errorf("dois carros no mesmo bem: %q", c)
	}
}

// erroDoBanco devolve "SQLSTATE mensagem" do erro do Postgres ("" se não for um).
func erroDoBanco(err error) string {
	var pe *pgconn.PgError
	if errors.As(err, &pe) {
		return pe.Code + " " + pe.Message
	}
	return ""
}
