package testebanco

import (
	"context"
	"errors"
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
	codigo := func(err error) string {
		var pe *pgconn.PgError
		if errors.As(err, &pe) {
			return pe.Code + " " + pe.Message
		}
		return ""
	}
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
