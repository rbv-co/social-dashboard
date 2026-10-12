package main

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

// Premissas do Plano 5.0 (domínios e conta) conferidas no banco restaurado pelo `api worker conferir`:
// o ambiente da gramática de SQL (PostgreSQL 15+ e standard_conforming_strings = on), o papel da API na
// tabela de auditoria do "entrar como", cada função de web.FuncoesRPC contra o pg_proc e a montagem das
// rotas de domínio contra as tabelas reais. Cada função devolve as premissas quebradas (vazio = confere).

// conferirAmbiente: as premissas que a gramática de dados.Consulta supõe (as mesmas que a montagem de
// cada rota confere: dados.ConferirAmbiente).
func conferirAmbiente(ctx context.Context, tx pgx.Tx) ([]string, error) {
	err := dados.ConferirAmbiente(ctx, tx)
	switch {
	case err == nil:
		return nil, nil
	case errors.Is(err, dados.ErrAmbiente):
		return []string{"ambiente: " + err.Error()}, nil
	}
	return nil, err
}

// conferirAuditoria: `entradas_como_outro_usuario` recebe o INSERT da API. Em produção a tabela tem RLS
// ligada e só a policy de SELECT do super-admin: o papel de conexão da API só grava se for DONO da tabela
// (e a RLS não for FORCE), SUPERUSER ou BYPASSRLS. Senão todo "entrar como" falha fechado ("Não consegui
// registrar a auditoria.") sem nenhum aviso antes do corte. A API grava como dono/BYPASSRLS DE PROPÓSITO:
// a auditoria não depende de policy de usuário.
func conferirAuditoria(ctx context.Context, tx pgx.Tx) ([]string, error) {
	var rls, forca, super, bypass, dono, insere bool
	err := tx.QueryRow(ctx, `select c.relrowsecurity, c.relforcerowsecurity, r.rolsuper, r.rolbypassrls,
			pg_has_role(current_user, c.relowner, 'usage'), has_table_privilege(current_user, c.oid, 'insert')
		  from pg_class c, pg_roles r
		 where r.rolname = current_user and c.oid = to_regclass(current_schema() || '.entradas_como_outro_usuario')`).
		Scan(&rls, &forca, &super, &bypass, &dono, &insere)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil // a tabela não existe: a conferência de colunas já acusa
	}
	if err != nil {
		return nil, err
	}
	var faltam []string
	if !insere {
		faltam = append(faltam, "entradas_como_outro_usuario: o papel de conexão da API não tem INSERT (todo \"entrar como\" ficaria recusado: \"Não consegui registrar a auditoria.\")")
	}
	if rls && !(super || bypass || (dono && !forca)) {
		motivo := "não é dona da tabela nem BYPASSRLS"
		if dono && forca {
			motivo = "é dona, mas a RLS é FORCE e a API não é BYPASSRLS"
		}
		faltam = append(faltam, "entradas_como_outro_usuario: RLS ligada e o papel de conexão da API "+motivo+
			" (todo \"entrar como\" falharia fechado: \"Não consegui registrar a auditoria.\"): faça a API dona da tabela, dê BYPASSRLS ao papel ou tire a RLS")
	}
	return faltam, nil
}

// papelDasRPC: o papel do Supabase que chamava `.rpc` (var só para o teste do papel ausente).
var papelDasRPC = "authenticated"

// tiposDePg: o tipo da declaração de rpc.Param -> o que regtype::text devolve para ele.
var tiposDePg = map[string][]string{
	"text": {"text", "character varying"}, "uuid": {"uuid"}, "integer": {"integer"}, "bigint": {"bigint"},
	"numeric": {"numeric"}, "boolean": {"boolean"}, "date": {"date"}, "timestamptz": {"timestamp with time zone"}, "jsonb": {"jsonb"},
}

func tipoDeclaradoConfere(declarado, achado string) bool {
	base, lista := strings.CutSuffix(declarado, "[]")
	for _, t := range tiposDePg[base] {
		if lista {
			t += "[]"
		}
		if t == achado {
			return true
		}
	}
	return false
}

// conferirRPC: para cada função declarada em web.FuncoesRPC, no banco restaurado:
//   - existe no schema atual (public em produção) e NÃO existe em pg_catalog (o nome sem schema resolve pelo
//     search_path com pg_catalog na frente: uma função de mesmo nome lá esconderia a nossa);
//   - `authenticated` tem EXECUTE (conferência mecânica de "mesmas permissões": se a produção fechou o EXECUTE
//     para authenticated, a API não pode abrir);
//   - a declaração bate com o pg_proc: nomes e tipos dos parâmetros, quais têm DEFAULT (pronargdefaults ×
//     Opcional) e proretset/void × Retorno. Sobrecarga (mais de uma função com o nome) é acusada: a chamada
//     por nome pode resolver outra.
func conferirRPC(ctx context.Context, tx pgx.Tx, fs []rpc.Funcao) ([]string, error) {
	if len(fs) == 0 {
		return nil, nil
	}
	var faltam []string
	var temPapel bool
	if err := tx.QueryRow(ctx, `select to_regrole($1::text) is not null`, papelDasRPC).Scan(&temPapel); err != nil {
		return nil, err
	}
	if !temPapel {
		faltam = append(faltam, "papel "+papelDasRPC+" não existe neste banco (a camada de compatibilidade do Plano 2 o cria): impossível conferir o EXECUTE das RPC")
	}
	for _, f := range fs {
		var noCatalogo bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from pg_proc where pronamespace = 'pg_catalog'::regnamespace and proname = $1::text)`, f.Nome).Scan(&noCatalogo); err != nil {
			return nil, err
		}
		if noCatalogo {
			faltam = append(faltam, "rpc "+f.Nome+": existe também em pg_catalog, que vem antes no search_path e a esconderia")
		}
		linhas, err := tx.Query(ctx, `select p.pronargdefaults::int, p.proretset, p.prorettype = 'void'::regtype,
				case when $2::boolean then has_function_privilege($3::text, p.oid, 'execute') else true end,
				coalesce(p.proargnames, '{}'::text[]), coalesce(p.proargmodes::text[], '{}'::text[]),
				coalesce(array(select t::regtype::text from unnest(string_to_array(nullif(p.proargtypes::text, ''), ' ')::oid[]) with ordinality as x(t, i) order by i), '{}'::text[])
			  from pg_proc p where p.pronamespace = current_schema()::regnamespace and p.proname = $1::text`, f.Nome, temPapel, papelDasRPC)
		if err != nil {
			return nil, err
		}
		type candidata struct {
			defaults              int
			conjunto, vazio, exec bool
			nomes, modos, tipos   []string
		}
		var cands []candidata
		for linhas.Next() {
			var c candidata
			if err := linhas.Scan(&c.defaults, &c.conjunto, &c.vazio, &c.exec, &c.nomes, &c.modos, &c.tipos); err != nil {
				linhas.Close()
				return nil, err
			}
			cands = append(cands, c)
		}
		linhas.Close()
		if err := linhas.Err(); err != nil {
			return nil, err
		}
		if len(cands) == 0 {
			faltam = append(faltam, "rpc "+f.Nome+": não existe no schema atual (public em produção)")
			continue
		}
		var melhor []string // com sobrecargas, vale a que mais se aproxima da declaração
		for i, c := range cands {
			var entradas []string // nomes dos parâmetros de entrada, na ordem de proargtypes
			for j, n := range c.nomes {
				if len(c.modos) == 0 || c.modos[j] == "i" || c.modos[j] == "b" || c.modos[j] == "v" {
					entradas = append(entradas, n)
				}
			}
			var sem []string
			if len(entradas) != len(c.tipos) || slices.Contains(entradas, "") {
				sem = append(sem, "rpc "+f.Nome+": parâmetro sem nome (a chamada é por nome: `p => valor`)")
			} else {
				reais := map[string]int{}
				for j, n := range entradas {
					reais[n] = j
				}
				opcionais := 0
				for _, pr := range f.Params {
					j, ok := reais[pr.Nome]
					switch {
					case !ok:
						sem = append(sem, fmt.Sprintf("rpc %s: parâmetro %s não existe na função (tem: %s)", f.Nome, pr.Nome, strings.Join(entradas, ", ")))
						continue
					case !tipoDeclaradoConfere(pr.Tipo, c.tipos[j]):
						sem = append(sem, fmt.Sprintf("rpc %s: parâmetro %s é %s na função e foi declarado %s", f.Nome, pr.Nome, c.tipos[j], pr.Tipo))
					}
					temDefault := j >= len(entradas)-c.defaults
					if pr.Opcional {
						opcionais++
					}
					if pr.Opcional != temDefault {
						sem = append(sem, fmt.Sprintf("rpc %s: parâmetro %s %s DEFAULT na função mas %s Opcional na declaração", f.Nome, pr.Nome,
							map[bool]string{true: "tem", false: "não tem"}[temDefault], map[bool]string{true: "é", false: "não é"}[pr.Opcional]))
					}
				}
				for j, n := range entradas { // a função pede o que a declaração não tem
					if !slices.ContainsFunc(f.Params, func(pr rpc.Param) bool { return pr.Nome == n }) {
						sem = append(sem, fmt.Sprintf("rpc %s: a função tem o parâmetro %s (%s)%s que a declaração não tem", f.Nome, n, c.tipos[j],
							map[bool]string{true: " com DEFAULT", false: ", obrigatório,"}[j >= len(entradas)-c.defaults]))
					}
				}
				if opcionais != c.defaults {
					sem = append(sem, fmt.Sprintf("rpc %s: pronargdefaults = %d e a declaração tem %d Opcional", f.Nome, c.defaults, opcionais))
				}
			}
			switch {
			case f.Retorno == rpc.Nada && !c.vazio:
				sem = append(sem, "rpc "+f.Nome+": declarada sem retorno (Nada) e a função não é void")
			case f.Retorno != rpc.Nada && c.vazio:
				sem = append(sem, "rpc "+f.Nome+": a função é void e foi declarada com retorno")
			case f.Retorno == rpc.Conjunto && !c.conjunto:
				sem = append(sem, "rpc "+f.Nome+": declarada como Conjunto e a função não devolve setof/table")
			case f.Retorno == rpc.Valor && c.conjunto:
				sem = append(sem, "rpc "+f.Nome+": declarada como Valor e a função devolve setof/table (use Conjunto)")
			}
			if !c.exec {
				sem = append(sem, "rpc "+f.Nome+": o papel authenticated NÃO tem EXECUTE na função (a produção a fechou: a API não pode abrir)")
			}
			if i == 0 || len(sem) < len(melhor) {
				melhor = sem
			}
		}
		if len(cands) > 1 {
			melhor = append(melhor, fmt.Sprintf("rpc %s: %d sobrecargas no schema atual (a chamada por nome pode resolver outra)", f.Nome, len(cands)))
		}
		faltam = append(faltam, melhor...)
	}
	return faltam, nil
}

// conferirRotas monta as rotas de domínio (web.Rotas) contra o banco restaurado: a montagem de cada
// dados.Consulta olha as tabelas REAIS do schema (toda tabela citada tem de estar no catálogo de policies) e
// recusa declaração ruim com panic; o panic vira premissa quebrada em vez de derrubar o `conferir`.
// Montar não abre porta, não chama o core nem manda e-mail.
func conferirRotas(p *pgxpool.Pool, cfg config.Config) []string {
	return montarSemPanico(func() { web.Rotas(p, auth.NovoStore(p), auth.NovoLimitador(), cfg) })
}

func montarSemPanico(montar func()) (faltam []string) {
	defer func() {
		if r := recover(); r != nil {
			faltam = []string{fmt.Sprintf("rotas: a montagem das rotas de domínio falhou contra este banco: %v", r)}
		}
	}()
	montar()
	return nil
}
