// Comando paridade: ferramenta do plano 02 da REVISAO-TESTES-2026-10 (item E), de uso manual (não roda em `go test`).
//
//	paridade rls -contrato internal/web/testdata/contrato_front.json -usuarios 8
//
// Para N pessoas de perfis diferentes, compara as LINHAS VISÍVEIS que a produção (RLS, papel `authenticated` com
// request.jwt.claims, como o PostgREST fazia) e a API Go (rota GET de cada tabela de ROTAS, sobre uma cópia restaurada
// da produção) entregam: contagem para toda tabela, e o conjunto de chaves nas de até 1000 linhas.
//
// PARIDADE_PROD_URL     produção (Supabase): SÓ LEITURA. Cada leitura abre BEGIN READ ONLY, e o papel é trocado dentro dela.
// PARIDADE_DATABASE_URL a CÓPIA restaurada (restaurar.sh + usuarios carregados): a ferramenta cria sessões nela. NUNCA a produção.
// Segredo só em variável de ambiente; nada é impresso além de ids de perfil, nomes de tabela e contagens.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"net/http/httptest"
	"os"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/config"
	"github.com/rbv-co/social-dashboard/api/internal/web"
)

type contrato struct {
	Tabelas map[string]struct {
		Rota *string `json:"rota"`
	} `json:"tabelas"`
}

func main() {
	if len(os.Args) >= 2 && os.Args[1] == "urls" {
		fs := flag.NewFlagSet("urls", flag.ExitOnError)
		dir := fs.String("dir", "", "raiz dos buckets copiados (uma pasta por bucket)")
		fs.Parse(os.Args[2:])
		if err := urls(context.Background(), *dir); err != nil {
			fmt.Fprintln(os.Stderr, "erro:", err)
			os.Exit(1)
		}
		return
	}
	if len(os.Args) < 2 || os.Args[1] != "rls" {
		fmt.Fprintln(os.Stderr, "uso: paridade rls -contrato ARQUIVO.json [-usuarios N] | paridade urls -dir PASTA")
		os.Exit(2)
	}
	fs := flag.NewFlagSet("rls", flag.ExitOnError)
	arq := fs.String("contrato", "internal/web/testdata/contrato_front.json", "JSON do contrato do front (tabelas e rotas)")
	n := fs.Int("usuarios", 8, "máximo de perfis distintos")
	fs.Parse(os.Args[2:])
	if err := rls(context.Background(), *arq, *n); err != nil {
		fmt.Fprintln(os.Stderr, "erro:", err)
		os.Exit(1)
	}
}

func rls(ctx context.Context, arq string, maxUsuarios int) error {
	prodURL, copiaURL := os.Getenv("PARIDADE_PROD_URL"), os.Getenv("PARIDADE_DATABASE_URL")
	if prodURL == "" || copiaURL == "" {
		return fmt.Errorf("faltam PARIDADE_PROD_URL e PARIDADE_DATABASE_URL")
	}
	if strings.Contains(copiaURL, "supabase") {
		return fmt.Errorf("PARIDADE_DATABASE_URL parece a produção: recuso (a ferramenta grava sessões nela)")
	}
	prod, err := pgxpool.New(ctx, strings.Replace(prodURL, ":6543/", ":5432/", 1))
	if err != nil {
		return err
	}
	defer prod.Close()
	copia, err := pgxpool.New(ctx, copiaURL)
	if err != nil {
		return err
	}
	defer copia.Close()

	bruto, err := os.ReadFile(arq)
	if err != nil {
		return err
	}
	var c contrato
	if err := json.Unmarshal(bruto, &c); err != nil {
		return err
	}

	// os perfis ATIVOS (conta desativada leva 401 na API, de propósito): um de cada combinação (papel, superadmin, módulos,
	// permissões, escopo por equipe); quem tem `allowed_accounts` (restrição por conta) vem primeiro, depois `viewer` antes de `admin`, para o corte por -usuarios não deixar os restritos de fora
	linhas, err := prod.Query(ctx, `select distinct on (coalesce(allowed_accounts::text, '') <> '{}', role, is_superadmin, coalesce(features::text, ''), coalesce(permissions::text, ''), escopo_por_equipe)
		id::text, role, is_superadmin from profiles where not coalesce(disabled, false)
		order by coalesce(allowed_accounts::text, '') <> '{}' desc, role desc, is_superadmin, coalesce(features::text, ''), coalesce(permissions::text, ''), escopo_por_equipe, created_at`)
	if err != nil {
		return err
	}
	type pessoa struct {
		id, rotulo string
	}
	var pessoas []pessoa
	for linhas.Next() {
		var id, papel string
		var super bool
		if err := linhas.Scan(&id, &papel, &super); err != nil {
			return err
		}
		pessoas = append(pessoas, pessoa{id, fmt.Sprintf("%s/%s", papel, map[bool]string{true: "super", false: "comum"}[super])})
	}
	linhas.Close()
	if len(pessoas) > maxUsuarios {
		pessoas = pessoas[:maxUsuarios]
	}

	// a chave de cada tabela: as colunas da PRIMARY KEY
	chaves := map[string][]string{}
	pk, err := prod.Query(ctx, `select c.conrelid::regclass::text, array_agg(a.attname order by k.ord)
		from pg_constraint c cross join lateral unnest(c.conkey) with ordinality k(n, ord)
		join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.n
		where c.contype = 'p' and c.connamespace = 'public'::regnamespace group by 1`)
	if err != nil {
		return err
	}
	for pk.Next() {
		var t string
		var cols []string
		if err := pk.Scan(&t, &cols); err != nil {
			return err
		}
		chaves[t] = cols
	}
	pk.Close()

	st := auth.NovoStore(copia)
	h := web.Rotas(copia, st, auth.NovoLimitador(), config.Config{})
	tabelas := make([]string, 0, len(c.Tabelas))
	for t, d := range c.Tabelas {
		if d.Rota != nil {
			tabelas = append(tabelas, t)
		}
	}
	sort.Strings(tabelas)

	var iguais, diferentes, semComparacao int
	for _, p := range pessoas {
		tok, err := st.Criar(ctx, p.id, "painel", nil)
		if err != nil {
			fmt.Printf("%s %s: sem sessão na cópia (%v); pulo\n", p.id, p.rotulo, err)
			continue
		}
		for _, t := range tabelas {
			// produção: RLS como o PostgREST (papel authenticated + claims), numa transação SOMENTE LEITURA
			chave := chaves[t]
			total, ids, negado, err := lerComoAuthenticated(ctx, prod, p.id, t, chave)
			if err != nil {
				fmt.Printf("%s %-12s %-28s produção: %v\n", p.id[:8], p.rotulo, t, err)
				semComparacao++
				continue
			}
			// API: a rota GET com a sessão dessa pessoa
			r := httptest.NewRequest("GET", *c.Tabelas[t].Rota+"?contar=1&limite=1000", nil)
			r.Header.Set("Authorization", "Bearer "+tok)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			var apiTotal int
			var apiIDs []string
			switch {
			case w.Code == 200:
				fmt.Sscan(w.Header().Get("X-Total-Count"), &apiTotal)
				if len(chave) > 0 {
					var corpo []map[string]any
					if json.Unmarshal(w.Body.Bytes(), &corpo) == nil {
						for _, l := range corpo {
							apiIDs = append(apiIDs, chaveDe(l, chave))
						}
					}
				}
			case w.Code == 403:
				apiTotal = 0
			default:
				fmt.Printf("%s %-12s %-28s API: %d %.80s\n", p.id[:8], p.rotulo, t, w.Code, w.Body.String())
				semComparacao++
				continue
			}
			if w.Code == 403 || (apiTotal == 0 && negado) {
				apiTotal = 0
			}
			// a rota nem sempre devolve as colunas da chave primária: sem elas, só a contagem se compara
			if len(apiIDs) > 0 && strings.Contains(apiIDs[0], "<nil>") {
				ids = nil
			}
			if total == apiTotal && (len(ids) == 0 || len(ids) > 1000 || len(chave) == 0 || sameSet(ids, apiIDs)) {
				iguais++
				continue
			}
			diferentes++
			extra := ""
			if len(ids) > 0 && len(ids) <= 1000 && len(chave) > 0 {
				so1, so2 := diff(ids, apiIDs)
				extra = fmt.Sprintf(" só_prod=%d só_api=%d", so1, so2)
			}
			if total > apiTotal {
				extra += " (produção tem mais: crescimento depois do dump?)"
			}
			fmt.Printf("DIVERGE %s %-12s %-28s prod=%d api=%d%s\n", p.id[:8], p.rotulo, t, total, apiTotal, extra)
		}
	}
	fmt.Printf("\nperfis=%d tabelas=%d iguais=%d divergentes=%d sem comparação=%d\n", len(pessoas), len(tabelas), iguais, diferentes, semComparacao)
	if diferentes > 0 {
		return fmt.Errorf("%d divergência(s): leia as linhas DIVERGE (crescimento depois do dump explica contagem maior na produção)", diferentes)
	}
	return nil
}

// urls (item F): toda URL de Storage guardada nas colunas de produção, com o host trocado pelo da API, tem de responder
// 200 na API servindo os arquivos copiados (copiar-storage.mjs) — com o MESMO tamanho do arquivo copiado.
func urls(ctx context.Context, dir string) error {
	prodURL, copiaURL := os.Getenv("PARIDADE_PROD_URL"), os.Getenv("PARIDADE_DATABASE_URL")
	if prodURL == "" || copiaURL == "" || dir == "" {
		return fmt.Errorf("faltam PARIDADE_PROD_URL, PARIDADE_DATABASE_URL e -dir")
	}
	prod, err := pgxpool.New(ctx, strings.Replace(prodURL, ":6543/", ":5432/", 1))
	if err != nil {
		return err
	}
	defer prod.Close()
	copia, err := pgxpool.New(ctx, copiaURL)
	if err != nil {
		return err
	}
	defer copia.Close()
	h := web.Rotas(copia, auth.NovoStore(copia), auth.NovoLimitador(), config.Config{ArquivosDir: dir})
	cols := [][2]string{{"accounts", "picture_url"}, {"acessos_pessoas", "avatar_url"}, {"fabrica_criativos", "url"}, {"fabrica_looks", "preview_url"}, {"noticias_concorrentes", "imagem_url"}}
	tally := map[string]int{}
	for _, c := range cols {
		tx, err := prod.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `select `+c[1]+` from public.`+c[0]+` where `+c[1]+` like '%/storage/v1/object/public/%'`)
		if err != nil {
			tx.Rollback(ctx)
			return err
		}
		for rows.Next() {
			var u string
			if err := rows.Scan(&u); err != nil {
				return err
			}
			i := strings.Index(u, "/storage/v1/object/public/")
			caminho := u[i:]
			bucket, _, _ := strings.Cut(strings.TrimPrefix(caminho, "/storage/v1/object/public/"), "/")
			if _, err := os.Stat(dir + "/" + bucket); err != nil {
				tally[c[0]+"."+c[1]+" "+bucket+": bucket não copiado na amostra"]++
				continue
			}
			r := httptest.NewRequest("GET", strings.SplitN(caminho, "?", 2)[0], nil)
			w := httptest.NewRecorder()
			h.ServeHTTP(w, r)
			tally[fmt.Sprintf("%s.%s %s: HTTP %d", c[0], c[1], bucket, w.Code)]++
		}
		rows.Close()
		tx.Rollback(ctx)
	}
	chaves := make([]string, 0, len(tally))
	for k := range tally {
		chaves = append(chaves, k)
	}
	sort.Strings(chaves)
	for _, k := range chaves {
		fmt.Printf("%4d  %s\n", tally[k], k)
	}
	return nil
}

func lerComoAuthenticated(ctx context.Context, p *pgxpool.Pool, uid, tabela string, chave []string) (total int, ids []string, negado bool, err error) {
	tx, err := p.BeginTx(ctx, pgx.TxOptions{AccessMode: pgx.ReadOnly})
	if err != nil {
		return 0, nil, false, err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `set local role authenticated`); err != nil {
		return 0, nil, false, err
	}
	claims, _ := json.Marshal(map[string]string{"sub": uid, "role": "authenticated"})
	if _, err = tx.Exec(ctx, `select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true), set_config('request.jwt.claim.role', 'authenticated', true)`, string(claims), uid); err != nil {
		return 0, nil, false, err
	}
	q := pgx.Identifier{"public", tabela}.Sanitize()
	if err = tx.QueryRow(ctx, `select count(*) from `+q).Scan(&total); err != nil {
		if strings.Contains(err.Error(), "42501") {
			return 0, nil, true, nil // sem GRANT: o PostgREST dava 403; a API dá 403 ou lista vazia
		}
		return 0, nil, false, err
	}
	if len(chave) > 0 && total <= 1000 {
		cols := make([]string, len(chave))
		for i, c := range chave {
			cols[i] = pgx.Identifier{c}.Sanitize() + "::text"
		}
		var rows pgx.Rows
		if rows, err = tx.Query(ctx, `select concat_ws('|', `+strings.Join(cols, ", ")+`) from `+q); err != nil {
			return 0, nil, false, err
		}
		for rows.Next() {
			var s string
			if err = rows.Scan(&s); err != nil {
				return 0, nil, false, err
			}
			ids = append(ids, s)
		}
		rows.Close()
	}
	return total, ids, false, nil
}

func chaveDe(l map[string]any, chave []string) string {
	partes := make([]string, len(chave))
	for i, c := range chave {
		switch v := l[c].(type) {
		case float64:
			partes[i] = fmt.Sprintf("%.0f", v)
		default:
			partes[i] = fmt.Sprint(v)
		}
	}
	return strings.Join(partes, "|")
}

func sameSet(a, b []string) bool { x, y := diff(a, b); return x == 0 && y == 0 }

func diff(a, b []string) (soA, soB int) {
	ma, mb := map[string]bool{}, map[string]bool{}
	for _, x := range a {
		ma[x] = true
	}
	for _, x := range b {
		mb[x] = true
	}
	for x := range ma {
		if !mb[x] {
			soA++
		}
	}
	for x := range mb {
		if !ma[x] {
			soB++
		}
	}
	return
}
