package autz

import (
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
)

// Cópia de docs/migracao-go/catalogo-policies-producao.json (o go:embed não sai do pacote);
// TestCatalogoEmbutidoIgualAoDosDocs prende as duas cópias.
//
//go:embed catalogo-policies-producao.json
var catalogoProducao []byte

// CatalogoJSON devolve o catálogo de produção cru (o oráculo do teste cria as policies dele).
func CatalogoJSON() []byte { return catalogoProducao }

// Op é a operação pedida numa tabela, com a semântica do Postgres para RLS.
type Op int

const (
	Ler        Op = iota // USING das policies de select/all
	Criar                // WITH CHECK das de insert/all (ALL sem check usa o USING)
	Editar               // linha ANTIGA: Ler e USING das de update/all (o UPDATE com WHERE lê a linha)
	EditarNova           // linha NOVA: WITH CHECK das de update/all (sem check usa o USING)
	Apagar               // Ler e USING das de delete/all
)

func (o Op) String() string { return [...]string{"ler", "criar", "editar", "editar-nova", "apagar"}[o] }

var ErrRecursoDesconhecido = errors.New("autz: tabela fora do catálogo")

type policy struct {
	nome, comando string
	restritiva    bool
	using, check  pred // nil = cláusula ausente
}

type tabela struct{ policies []policy }

// Catalogo é o conjunto de policies compiladas, por tabela.
type Catalogo struct{ tabelas map[string]*tabela }

type policyJSON struct {
	Tabela, Nome, Tipo, Comando string
	Papeis                      []string
	Using, WithCheck            *string
}

// Producao é o catálogo de produção compilado. Falha de compilação derruba a API na subida
// (e o teste): policy com forma que este pacote não conhece nunca vira "liberado".
var Producao = func() *Catalogo {
	c, err := Compilar(catalogoProducao)
	if err != nil {
		panic(err)
	}
	return c
}()

// Compilar lê o JSON do catálogo. Policies que não valem para sessão de pessoa (só anon ou só
// service_role) ficam de fora: nunca liberam nada à API autenticada.
func Compilar(bruto []byte) (*Catalogo, error) {
	var lista []policyJSON
	if err := json.Unmarshal(bruto, &lista); err != nil {
		return nil, err
	}
	c := &Catalogo{tabelas: map[string]*tabela{}}
	for _, p := range lista {
		t := c.tabelas[p.Tabela]
		if t == nil {
			t = &tabela{}
			c.tabelas[p.Tabela] = t
		}
		if !slices.Contains(p.Papeis, "authenticated") && !slices.Contains(p.Papeis, "public") {
			continue
		}
		if !slices.Contains([]string{"select", "insert", "update", "delete", "all"}, p.Comando) || (p.Tipo != "permissive" && p.Tipo != "restrictive") {
			return nil, fmt.Errorf("%s.%s: comando/tipo desconhecido %q/%q", p.Tabela, p.Nome, p.Comando, p.Tipo)
		}
		pol := policy{nome: p.Nome, comando: p.Comando, restritiva: p.Tipo == "restrictive"}
		var err error
		if p.Using != nil {
			if pol.using, err = c.analisar(normalizar(*p.Using)); err != nil {
				return nil, fmt.Errorf("%s.%s (using): %w", p.Tabela, p.Nome, err)
			}
		}
		if p.WithCheck != nil {
			if pol.check, err = c.analisar(normalizar(*p.WithCheck)); err != nil {
				return nil, fmt.Errorf("%s.%s (with check): %w", p.Tabela, p.Nome, err)
			}
		}
		t.policies = append(t.policies, pol)
	}
	return c, nil
}

// Tabelas devolve os nomes do catálogo, em ordem.
func (c *Catalogo) Tabelas() []string {
	out := make([]string, 0, len(c.tabelas))
	for n := range c.tabelas {
		out = append(out, n)
	}
	slices.Sort(out)
	return out
}

func (c *Catalogo) Tem(tab string) bool { return c.tabelas[tab] != nil }

// regra devolve o predicado combinado de tab×op: (OU das permissivas) E (todas as restritivas).
// Sem permissiva aplicável = nega (RLS ligado sem policy).
func (c *Catalogo) regra(tab string, op Op) (pred, error) {
	t := c.tabelas[tab]
	if t == nil {
		return nil, fmt.Errorf("%w: %q", ErrRecursoDesconhecido, tab)
	}
	combinar := func(comandos []string, clausula func(policy) pred) pred {
		var perm ou
		var restr e_
		for _, p := range t.policies {
			if !slices.Contains(comandos, p.comando) {
				continue
			}
			x := clausula(p)
			if x == nil {
				continue
			}
			if p.restritiva {
				restr = append(restr, x)
			} else {
				perm = append(perm, x)
			}
		}
		if len(perm) == 0 {
			return nunca
		}
		return append(e_{perm}, restr...)
	}
	usingDe := func(p policy) pred { return p.using }
	checkDe := func(p policy) pred {
		if p.check != nil || p.comando == "insert" {
			return p.check
		}
		return p.using
	}
	ler := combinar([]string{"select", "all"}, usingDe)
	switch op {
	case Ler:
		return ler, nil
	case Criar:
		return combinar([]string{"insert", "all"}, checkDe), nil
	case Editar:
		return e_{ler, combinar([]string{"update", "all"}, usingDe)}, nil
	case EditarNova:
		return combinar([]string{"update", "all"}, checkDe), nil
	case Apagar:
		return e_{ler, combinar([]string{"delete", "all"}, usingDe)}, nil
	}
	return nil, fmt.Errorf("autz: op desconhecida %d", op)
}

// ---- análise das expressões (texto de pg_policies, verbatim) ----

func normalizar(s string) string {
	s = strings.Join(strings.Fields(s), " ")
	return strings.NewReplacer("( ", "(", " )", ")").Replace(s)
}

// tirarParenteses remove parênteses que embrulham a expressão INTEIRA.
func tirarParenteses(s string) string {
	for strings.HasPrefix(s, "(") && strings.HasSuffix(s, ")") {
		nivel, fecha := 0, -1
		for i, emAspas := 0, false; i < len(s); i++ {
			switch {
			case s[i] == '\'':
				emAspas = !emAspas
			case emAspas:
			case s[i] == '(':
				nivel++
			case s[i] == ')':
				nivel--
				if nivel == 0 {
					fecha = i
					i = len(s)
				}
			}
		}
		if fecha != len(s)-1 {
			return s
		}
		s = s[1 : len(s)-1]
	}
	return s
}

// dividir corta s em `sep` só no nível zero de parênteses e fora de aspas.
func dividir(s, sep string) []string {
	var partes []string
	nivel, inicio, emAspas := 0, 0, false
	for i := 0; i < len(s); i++ {
		switch {
		case s[i] == '\'':
			emAspas = !emAspas
		case emAspas:
		case s[i] == '(':
			nivel++
		case s[i] == ')':
			nivel--
		case nivel == 0 && strings.HasPrefix(s[i:], sep):
			partes = append(partes, s[inicio:i])
			inicio = i + len(sep)
			i += len(sep) - 1
		}
	}
	return append(partes, s[inicio:])
}

func (c *Catalogo) analisar(s string) (pred, error) {
	s = tirarParenteses(s)
	for _, sep := range []string{" OR ", " AND "} {
		if partes := dividir(s, sep); len(partes) > 1 {
			var l []pred
			for _, p := range partes {
				x, err := c.analisar(p)
				if err != nil {
					return nil, err
				}
				l = append(l, x)
			}
			if sep == " OR " {
				return ou(l), nil
			}
			return e_(l), nil
		}
	}
	return c.atomo(s)
}

var (
	semArgs = map[string]pred{
		"true": sempre, "is_frota_admin()": frotaAdmin, "is_acessos_admin()": acessosAdmin,
		"is_patrimonio_admin()": patrimonioAdmin, "is_vessel_admin()": vesselAdmin, "is_vessel_leads()": vesselLeads,
		"pode_ver_vendas()": podeVerVendas, "superadmin_pela_ficha()": superFicha, "is_superadmin()": superEmail,
		"conta_ativa()": contaAtiva,
		"COALESCE((SELECT profiles.is_superadmin FROM profiles WHERE (profiles.id = auth.uid())), false)": superFichaVisivel,
	}
	reRole       = regexp.MustCompile(`^auth\.role\(\) = '([a-z_]+)'::text$`)
	reGetMyRole  = regexp.MustCompile(`^get_my_role\(\) = '([a-z_]+)'::text$`)
	reDono       = regexp.MustCompile(`^(?:auth\.uid\(\) = ([a-z_]+)|([a-z_]+) = auth\.uid\(\))$`)
	reUmaColuna  = regexp.MustCompile(`^(pode_ver_conta|pode_ver_canal|pode_ver_equipe|pode_ver_estoque|pode_ver_grupo|sou_gestor_da_equipe)\(\(?([a-z_]+)\)?(::text)?\)$`)
	reBem        = regexp.MustCompile(`^pode_ver_bem\(([a-z_]+), ([a-z_]+)\)$`)
	reBemPeloID  = regexp.MustCompile(`^EXISTS \(SELECT 1 FROM patrimonio_bens b WHERE \(\(b\.id = [a-z_]+\.([a-z_]+)\) AND pode_ver_bem\(b\.local_id, b\.pessoa_id\)\)\)$`)
	reVesselPode = regexp.MustCompile(`^vessel_pode\('([a-z.-]+)'::text, '([a-z]+)'::text\)$`)
	rePapelEm    = regexp.MustCompile(`^tenho_papel_na_equipe\(([a-z_]+), ARRAY\[(.+)\]\)$`)
	reLiteral    = regexp.MustCompile(`^'([a-z_.-]+)'::text$`)
	rePerfil     = regexp.MustCompile(`^EXISTS \(SELECT 1 FROM profiles (?:p )?WHERE \(\((?:p|profiles)\.id = auth\.uid\(\)\) AND (.+)\)\)$`)
	reMembro     = regexp.MustCompile(`^EXISTS \(SELECT 1 FROM equipes_membros m WHERE \(\(m\.profile_id = auth\.uid\(\)\) AND \(m\.papel = '([a-z_]+)'::text\)\)\)$`)
	reTermo      = map[string]*regexp.Regexp{
		"papel": regexp.MustCompile(`^p\.role = '([a-z_]+)'::text$`), "modulo": regexp.MustCompile(`^'([a-z_.-]+)'::text = ANY \(p\.features\)$`),
		"chave": regexp.MustCompile(`^p\.permissions \? '([a-z_.-]+)'::text$`),
	}
)

func (c *Catalogo) atomo(s string) (pred, error) {
	if p, ok := semArgs[s]; ok {
		return p, nil
	}
	if m := reRole.FindStringSubmatch(s); m != nil {
		switch m[1] {
		case "authenticated":
			return sempre, nil
		case "service_role":
			return nunca, nil // só a chave de serviço do Supabase; nenhuma sessão da API é isso
		}
	}
	if m := reGetMyRole.FindStringSubmatch(s); m != nil {
		return papelAtivo(m[1]), nil
	}
	if m := reDono.FindStringSubmatch(s); m != nil {
		return dono(m[1] + m[2]), nil
	}
	if m := reUmaColuna.FindStringSubmatch(s); m != nil {
		return map[string]func(string) pred{"pode_ver_conta": podeVerConta, "pode_ver_canal": podeVerCanal,
			"pode_ver_equipe": podeVerEquipe, "pode_ver_estoque": podeVerEstoque, "pode_ver_grupo": podeVerGrupo,
			"sou_gestor_da_equipe": gestorDaEquipe}[m[1]](m[2]), nil
	}
	if m := reBem.FindStringSubmatch(s); m != nil {
		return podeVerBem(m[1], m[2]), nil
	}
	if m := reBemPeloID.FindStringSubmatch(s); m != nil {
		return podeVerBemPeloID(m[1]), nil
	}
	if m := reVesselPode.FindStringSubmatch(s); m != nil {
		return vesselPode(m[1], m[2])
	}
	if m := reMembro.FindStringSubmatch(s); m != nil {
		return papelDiretoEmAlguma(m[1]), nil
	}
	if m := rePapelEm.FindStringSubmatch(s); m != nil {
		var papeis []string
		for _, lit := range strings.Split(m[2], ", ") {
			l := reLiteral.FindStringSubmatch(lit)
			if l == nil {
				return nil, fmt.Errorf("papel desconhecido em %q", s)
			}
			papeis = append(papeis, l[1])
		}
		return papelNaEquipe(m[1], papeis...), nil
	}
	if m := rePerfil.FindStringSubmatch(s); m != nil {
		var termos []predAtor
		for _, t := range dividir(tirarParenteses(strings.ReplaceAll(m[1], "profiles.", "p.")), " OR ") {
			t = tirarParenteses(t)
			switch {
			case t == "p.is_superadmin" || t == "p.is_superadmin = true":
				termos = append(termos, termoSuper())
			case reTermo["papel"].MatchString(t):
				termos = append(termos, termoPapel(reTermo["papel"].FindStringSubmatch(t)[1]))
			case reTermo["modulo"].MatchString(t):
				termos = append(termos, termoModulo(reTermo["modulo"].FindStringSubmatch(t)[1]))
			case reTermo["chave"].MatchString(t):
				termos = append(termos, termoChave(reTermo["chave"].FindStringSubmatch(t)[1]))
			default:
				return nil, fmt.Errorf("termo de perfil desconhecido %q", t)
			}
		}
		return perfilCom(termos...), nil
	}
	return nil, fmt.Errorf("forma desconhecida: %q", s)
}
