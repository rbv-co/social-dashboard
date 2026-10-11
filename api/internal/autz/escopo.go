// Package autz decide, em Go, o que cada pessoa lê e grava nas tabelas que as policies RLS
// de produção protegiam (spec §5: sem RLS, autorização em código, as MESMAS permissões).
// O catálogo de produção (catalogo-policies-producao.json, embutido) é a especificação: cada
// policy é compilada num predicado deste pacote, e o teste de contrato compara o predicado
// com a própria RLS do Postgres rodando a policy verbatim.
package autz

import (
	"context"
	"encoding/json"
	"errors"
	"slices"

	"github.com/jackc/pgx/v5"
)

// Banco é o que CarregarEscopo e Conferir precisam: *pgxpool.Pool e pgx.Tx servem.
type Banco interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// SuperAdminsPorEmail é a lista cravada em public.is_superadmin() de produção (que confere
// e-mail, NÃO a coluna profiles.is_superadmin). O teste de contrato roda a função de produção:
// se a lista mudar lá, o teste falha aqui.
var SuperAdminsPorEmail = []string{"erick@rbvcompany.com", "gabriel.gertrudes@rbvcompany.com", "breno@rbvcompany.com"}

// Escopo é tudo o que as policies liam sobre quem pede, carregado uma vez por requisição.
// Os nomes seguem as funções SQL que eles substituem.
type Escopo struct {
	ID          string
	TemPerfil   bool                // existe linha em profiles
	Ativo       bool                // conta_ativa(): sem perfil conta como ativo (coalesce(..., true))
	Email       string              // profiles.email (is_superadmin() confere a lista)
	Papel       string              // profiles.role
	SuperFicha  bool                // profiles.is_superadmin (superadmin_pela_ficha)
	Modulos     []string            // profiles.features
	Chaves      map[string]bool     // chaves do objeto profiles.permissions (operador ? do jsonb)
	Acoes       map[string][]string // permissions[chave] quando é array: os textos dele
	SemTrava    bool                // tem perfil e escopo_por_equipe = false
	TodasContas bool                // allowed_accounts nulo
	Contas      []string            // allowed_accounts::text[]
	Vinculos    map[string][]string // meus_vinculos(): equipe -> papéis (inclui a supervisora de grupo)
	Diretos     map[string][]string // equipes_membros do próprio: equipe -> papéis
	Canais      []int64             // pode_ver_canal: canal das equipes dos vínculos + lojas dos grupos supervisionados
	Locais      []string            // pode_ver_bem: local_id das equipes dos vínculos
	Pessoas     []string            // pode_ver_bem: acessos_pessoas com profile_id = eu
	Depositos   []int64             // pode_ver_estoque
	Grupos      []string            // pode_ver_grupo: canais_grupos_membros (qualquer papel)
}

func (e *Escopo) Modulo(m string) bool { return slices.Contains(e.Modulos, m) }

func (e *Escopo) Equipes() []string {
	out := make([]string, 0, len(e.Vinculos))
	for id := range e.Vinculos {
		out = append(out, id)
	}
	slices.Sort(out)
	return out
}

func (e *Escopo) temPapel(equipe string, papeis ...string) bool {
	for _, p := range e.Vinculos[equipe] {
		if slices.Contains(papeis, p) {
			return true
		}
	}
	return false
}

// CarregarEscopo lê o escopo de usuarioID. Falta de dado nunca amplia: sem perfil = nenhum
// papel, nenhum módulo, nenhuma conta; vínculos sempre filtrados por profile_id = usuarioID.
func CarregarEscopo(ctx context.Context, b Banco, usuarioID string) (*Escopo, error) {
	e := &Escopo{ID: usuarioID, Ativo: true, Chaves: map[string]bool{}, Acoes: map[string][]string{},
		Vinculos: map[string][]string{}, Diretos: map[string][]string{}}
	var perm []byte
	var desativado, porEquipe bool
	var contas []string
	err := b.QueryRow(ctx, `select coalesce(email, ''), coalesce(role::text, ''), coalesce(is_superadmin, false),
	        coalesce(disabled, false), coalesce(escopo_por_equipe, false),
	        coalesce(array_remove(features, null), '{}'::text[]), coalesce(permissions, '{}'::jsonb),
	        allowed_accounts::text[]
	   from profiles where id = $1::uuid`, usuarioID).
		Scan(&e.Email, &e.Papel, &e.SuperFicha, &desativado, &porEquipe, &e.Modulos, &perm, &contas)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		// sem perfil: Ativo (coalesce true), nada mais
	case err != nil:
		return nil, err
	default:
		e.TemPerfil, e.Ativo, e.SemTrava = true, !desativado, !porEquipe
		e.TodasContas, e.Contas = contas == nil, contas
		lerPermissoes(perm, e)
	}

	// meus_vinculos(): os vínculos diretos + 'supervisora' em toda equipe cujo canal é loja de
	// um grupo em que sou supervisora (canais_grupos_membros).
	linhas, err := b.Query(ctx, `select m.equipe_id::text, coalesce(m.papel, ''), true
	     from equipes_membros m where m.profile_id = $1::uuid
	   union
	   select e.id::text, 'supervisora', false
	     from canais_grupos_membros gm
	     join bling_lojas bl on bl.grupo_id = gm.grupo_id
	     join equipes e on e.canal_loja_id = bl.loja_id
	    where gm.profile_id = $1::uuid and gm.papel = 'supervisora'`, usuarioID)
	if err != nil {
		return nil, err
	}
	var equipe, papel string
	var direto bool
	if _, err := pgx.ForEachRow(linhas, []any{&equipe, &papel, &direto}, func() error {
		e.Vinculos[equipe] = acrescentar(e.Vinculos[equipe], papel)
		if direto {
			e.Diretos[equipe] = acrescentar(e.Diretos[equipe], papel)
		}
		return nil
	}); err != nil {
		return nil, err
	}

	if err := b.QueryRow(ctx, `select
	    coalesce((select array_agg(distinct x) from (
	        select e.canal_loja_id as x from equipes e where e.id::text = any($2::text[]) and e.canal_loja_id is not null
	        union
	        select bl.loja_id from canais_grupos_membros gm join bling_lojas bl on bl.grupo_id = gm.grupo_id
	         where gm.profile_id = $1::uuid and gm.papel = 'supervisora') c), '{}'::bigint[]),
	    coalesce((select array_agg(distinct e.local_id::text) from equipes e
	               where e.id::text = any($2::text[]) and e.local_id is not null), '{}'::text[]),
	    coalesce((select array_agg(ap.id::text) from acessos_pessoas ap where ap.profile_id = $1::uuid), '{}'::text[]),
	    coalesce((select array_agg(distinct gm.grupo_id::text) from canais_grupos_membros gm
	               where gm.profile_id = $1::uuid and gm.grupo_id is not null), '{}'::text[])`,
		usuarioID, e.Equipes()).Scan(&e.Canais, &e.Locais, &e.Pessoas, &e.Grupos); err != nil {
		return nil, err
	}

	// pode_ver_estoque: depósito de equipe em que sou supervisora/gestor (pelos vínculos) OU
	// em que tenho a chave 'estoque' em equipes_permissoes E sou membro direto.
	var comEstoque []string
	if err := b.QueryRow(ctx, `select coalesce(array_agg(distinct p.equipe_id::text), '{}'::text[]) from equipes_permissoes p
	   where p.profile_id = $1::uuid and p.chave = 'estoque'`, usuarioID).Scan(&comEstoque); err != nil {
		return nil, err
	}
	linhas, err = b.Query(ctx, `select e.id::text, e.deposito_id from equipes e where e.deposito_id is not null`)
	if err != nil {
		return nil, err
	}
	var dep int64
	vistos := map[int64]bool{}
	if _, err := pgx.ForEachRow(linhas, []any{&equipe, &dep}, func() error {
		ok := e.temPapel(equipe, "supervisora", "gestor") || (slices.Contains(comEstoque, equipe) && len(e.Diretos[equipe]) > 0)
		if ok && !vistos[dep] {
			vistos[dep] = true
			e.Depositos = append(e.Depositos, dep)
		}
		return nil
	}); err != nil {
		return nil, err
	}
	slices.Sort(e.Depositos)
	return e, nil
}

func acrescentar(l []string, v string) []string {
	if slices.Contains(l, v) {
		return l
	}
	return append(l, v)
}

// lerPermissoes é tolerante como o banco: permissions array só serve ao operador ? (casa
// os elementos texto) e escalar não dá chave nenhuma (o vessel_pode exige objeto); valor que não é array conta para o operador ? mas não tem
// ações; dentro do array só textos contam (o ? do jsonb só casa elemento texto).
func lerPermissoes(bruto []byte, e *Escopo) {
	var obj map[string]json.RawMessage
	if json.Unmarshal(bruto, &obj) != nil {
		// array: o ? do jsonb casa os elementos texto (nenhuma ação: vessel_pode exige objeto)
		var lista []any
		json.Unmarshal(bruto, &lista)
		for _, x := range lista {
			if s, ok := x.(string); ok {
				e.Chaves[s] = true
			}
		}
		return
	}
	for k, v := range obj {
		e.Chaves[k] = true
		var lista []any
		if json.Unmarshal(v, &lista) != nil {
			continue
		}
		acoes := []string{}
		for _, x := range lista {
			if s, ok := x.(string); ok {
				acoes = append(acoes, s)
			}
		}
		e.Acoes[k] = acoes
	}
}
