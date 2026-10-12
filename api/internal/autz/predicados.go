package autz

import (
	"fmt"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
)

// pred é uma condição de policy traduzida. sql devolve a condição sobre a linha `alias`;
// quando não depende da linha, devolve a constante "true" ou "false" (decidida em Go). Os
// valores do ator entram como parâmetros nomeados (@autz_<alias>_<op>_N) com cast explícito.
type pred interface {
	sql(e *Escopo, alias string, a *argumentos) string
}

type argumentos struct {
	prefixo string // autz_<alias>_<op>_: dois filtros na mesma consulta nunca colidem
	n       int
	v       pgx.NamedArgs
}

func (a *argumentos) novo(valor any, tipo string) string {
	a.n++
	nome := fmt.Sprintf("%s%d", a.prefixo, a.n)
	a.v[nome] = valor
	return "@" + nome + "::" + tipo
}

func constante(b bool) string {
	if b {
		return "true"
	}
	return "false"
}

// predAtor: condição que só depende de quem pede.
type predAtor func(e *Escopo) bool

func (p predAtor) sql(e *Escopo, _ string, _ *argumentos) string { return constante(p(e)) }

// predLinha: condição sobre colunas da linha.
type predLinha func(e *Escopo, alias string, a *argumentos) string

func (p predLinha) sql(e *Escopo, alias string, a *argumentos) string { return p(e, alias, a) }

type ou []pred
type e_ []pred

func (l ou) sql(e *Escopo, alias string, a *argumentos) string {
	var partes []string
	for _, p := range l {
		switch s := p.sql(e, alias, a); s {
		case "true":
			return "true"
		case "false":
		default:
			partes = append(partes, s)
		}
	}
	return juntar(partes, " or ", "false")
}

func (l e_) sql(e *Escopo, alias string, a *argumentos) string {
	var partes []string
	for _, p := range l {
		switch s := p.sql(e, alias, a); s {
		case "false":
			return "false"
		case "true":
		default:
			partes = append(partes, s)
		}
	}
	return juntar(partes, " and ", "true")
}

func juntar(partes []string, op, vazio string) string {
	switch len(partes) {
	case 0:
		return vazio
	case 1:
		return partes[0]
	}
	return "(" + strings.Join(partes, op) + ")"
}

func col(alias, c string) string { return pgx.Identifier{alias, c}.Sanitize() }

// ---- os átomos: um por função/forma que as policies de produção usam ----

var (
	sempre = predAtor(func(*Escopo) bool { return true })
	nunca  = predAtor(func(*Escopo) bool { return false })

	// is_frota_admin(): conta_ativa() and ('frota' = any(features) or is_superadmin)
	frotaAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && (e.Modulo("frota") || e.SuperFicha) })
	// is_acessos_admin(): conta_ativa() and exists(perfil com role admin ou 'acessos' em features)
	acessosAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && e.TemPerfil && (e.Papel == "admin" || e.Modulo("acessos")) })
	// is_patrimonio_admin(): idem com 'patrimonio'
	patrimonioAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && e.TemPerfil && (e.Papel == "admin" || e.Modulo("patrimonio")) })
	// is_vessel_admin(): conta_ativa() and ('autenticidade' em features or is_superadmin)
	vesselAdmin = predAtor(func(e *Escopo) bool { return e.Ativo && (e.Modulo("autenticidade") || e.SuperFicha) })
	// is_vessel_leads(): SEM conta_ativa ('meta.leads' em features or is_superadmin)
	vesselLeads = predAtor(func(e *Escopo) bool { return e.Modulo("meta.leads") || e.SuperFicha })
	// pode_ver_vendas(): conta_ativa() and (role admin or is_superadmin or 'sales' em features)
	podeVerVendas = predAtor(func(e *Escopo) bool { return e.Ativo && (e.Papel == "admin" || e.SuperFicha || e.Modulo("sales")) })
	// superadmin_pela_ficha() (security definer): SEM conta_ativa
	superFicha = predAtor(func(e *Escopo) bool { return e.SuperFicha })
	// COALESCE((select is_superadmin from profiles ...), false): a subconsulta passa pela RLS
	// de profiles, então a conta desativada lê NULL (= false)
	superFichaVisivel = predAtor(func(e *Escopo) bool { return e.SuperFicha && e.Ativo })
	// is_superadmin(): conta_ativa() and e-mail na lista cravada
	superEmail = predAtor(func(e *Escopo) bool { return e.Ativo && slices.Contains(SuperAdminsPorEmail, e.Email) })
	// conta_ativa()
	contaAtiva = predAtor(func(e *Escopo) bool { return e.Ativo })
)

// perfilCom: EXISTS(select 1 from profiles p where p.id = auth.uid() and (<termos em OU>)).
// A subconsulta da policy roda COM a RLS de profiles (auth_read_profiles: autenticado e
// conta_ativa()): a conta desativada não enxerga o próprio perfil, então nada passa.
func perfilCom(termos ...predAtor) pred {
	return predAtor(func(e *Escopo) bool {
		if !e.TemPerfil || !e.Ativo {
			return false
		}
		for _, t := range termos {
			if t(e) {
				return true
			}
		}
		return false
	})
}

func termoPapel(p string) predAtor  { return func(e *Escopo) bool { return e.Papel == p } }
func termoModulo(m string) predAtor { return func(e *Escopo) bool { return e.Modulo(m) } }
func termoChave(k string) predAtor  { return func(e *Escopo) bool { return e.Chaves[k] } }
func termoSuper() predAtor          { return func(e *Escopo) bool { return e.SuperFicha } }
func papelAtivo(p string) pred {
	return predAtor(func(e *Escopo) bool { return e.Ativo && e.Papel == p })
}
func papelDiretoEmAlguma(p string) pred {
	return predAtor(func(e *Escopo) bool {
		for _, ps := range e.Diretos {
			if slices.Contains(ps, p) {
				return true
			}
		}
		return false
	})
}

// FerramentasVessel é a lista fechada de public.vessel_pode (nome desconhecido lá é exceção).
var FerramentasVessel = []string{"atendimentos", "atendimentos.beauty-sessions", "atendimentos.private-edit",
	"atendimentos.stylist-circle", "atendimentos.material-grafico", "atendimentos.pracas", "atendimentos.edicoes"}

// vesselPode(f, n): conta_ativa() and (is_superadmin or permissions[f] é array com 'ver' e,
// se n = 'editar', também 'editar').
func vesselPode(f, n string) (pred, error) {
	if !slices.Contains(FerramentasVessel, f) || (n != "ver" && n != "editar") || (f == "atendimentos.material-grafico" && n != "ver") {
		return nil, fmt.Errorf("vessel_pode(%q, %q) fora da lista fechada", f, n)
	}
	return predAtor(func(e *Escopo) bool {
		if !e.Ativo {
			return false
		}
		if e.SuperFicha {
			return true
		}
		acoes, ok := e.Acoes[f]
		return ok && slices.Contains(acoes, "ver") && (n == "ver" || slices.Contains(acoes, n))
	}), nil
}

// dono(c): auth.uid() = <c> (coluna nula nunca casa).
func dono(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		return "(" + col(alias, c) + " = " + a.novo(e.ID, "uuid") + ")"
	})
}

// podeVerConta(c): conta_ativa() and exists(perfil com role admin, is_superadmin,
// allowed_accounts nulo, conta nula ou conta em allowed_accounts::text[]).
func podeVerConta(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo || !e.TemPerfil {
			return "false"
		}
		if e.Papel == "admin" || e.SuperFicha || e.TodasContas {
			return "true"
		}
		x := col(alias, c)
		return "(" + x + " is null or " + x + "::text = any(" + a.novo(nn(e.Contas), "text[]") + "))"
	})
}

// semTravaOuSuper: o começo comum de pode_ver_canal/bem/equipe/estoque/grupo.
func semTravaOuSuper(e *Escopo) bool { return e.SuperFicha || e.SemTrava }

func podeVerCanal(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + " = any(" + a.novo(nn(e.Canais), "bigint[]") + "))"
	})
}

func podeVerBem(cLocal, cPessoa string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, cLocal) + "::text = any(" + a.novo(nn(e.Locais), "text[]") + ") or " +
			col(alias, cPessoa) + "::text = any(" + a.novo(nn(e.Pessoas), "text[]") + "))"
	})
}

// podeVerBemPeloID(c): exists(patrimonio_bens b where b.id = <c> and pode_ver_bem(b.local_id, b.pessoa_id)).
// (A subconsulta da policy passa também pela RLS de patrimonio_bens; hoje isso não muda nada,
// porque ver patrimonio_posse já exige is_patrimonio_admin, que é o Ler de patrimonio_bens.
// Se o catálogo mudar, o teste de contrato contra a RLS acusa.)
func podeVerBemPeloID(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		cond := podeVerBem("local_id", "pessoa_id").sql(e, "autz_b", a)
		if cond == "false" {
			return "false"
		}
		return "exists (select 1 from patrimonio_bens autz_b where autz_b.id = " + col(alias, c) + " and " + cond + ")"
	})
}

func podeVerEquipe(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + "::text = any(" + a.novo(nn(e.Equipes()), "text[]") + "))"
	})
}

func podeVerEstoque(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + " = any(" + a.novo(nn(e.Depositos), "bigint[]") + "))"
	})
}

func podeVerGrupo(c string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		if !e.Ativo {
			return "false"
		}
		if semTravaOuSuper(e) {
			return "true"
		}
		return "(" + col(alias, c) + "::text = any(" + a.novo(nn(e.Grupos), "text[]") + "))"
	})
}

// papelNaEquipe(c, papeis): tenho_papel_na_equipe(<c>, papeis), pelos vínculos (sem conta_ativa).
func papelNaEquipe(c string, papeis ...string) pred {
	return predLinha(func(e *Escopo, alias string, a *argumentos) string {
		var ids []string
		for _, id := range e.Equipes() {
			if e.temPapel(id, papeis...) {
				ids = append(ids, id)
			}
		}
		if len(ids) == 0 {
			return "false"
		}
		return "(" + col(alias, c) + "::text = any(" + a.novo(ids, "text[]") + "))"
	})
}

// gestorDaEquipe(c): sou_gestor_da_equipe = is_superadmin (ficha) or tenho_papel(c, gestor).
func gestorDaEquipe(c string) pred { return ou{superFicha, papelNaEquipe(c, "gestor")} }

// nn: nunca mandar NULL no lugar de lista (any(NULL) dá NULL, e NULL num OR esconderia erro).
func nn[T any](l []T) []T {
	if l == nil {
		return []T{}
	}
	return l
}

// ---- portões de RPC (sub-planos): as checagens que as funções de produção fazem no começo ----

// Regra decide só por quem pede (portão de rota/RPC).
type Regra func(e *Escopo) bool

var (
	FrotaAdmin      = Regra(frotaAdmin)
	AcessosAdmin    = Regra(acessosAdmin)
	PatrimonioAdmin = Regra(patrimonioAdmin)
	VesselAdmin     = Regra(vesselAdmin)
	VesselLeads     = Regra(vesselLeads)
	PodeVerVendas   = Regra(podeVerVendas)
	SuperFicha      = Regra(superFicha)
	SuperEmail      = Regra(superEmail)
	// pode_aprovar_frota(): conta_ativa() and ('frota.aprovar' em features or is_superadmin)
	PodeAprovarFrota = Regra(func(e *Escopo) bool { return e.Ativo && (e.Modulo("frota.aprovar") || e.SuperFicha) })
	// pode_cadastrar_pessoa_rapida(): is_acessos_admin() or is_patrimonio_admin() or is_frota_admin()
	PodeCadastrarPessoaRapida = Regra(func(e *Escopo) bool { return acessosAdmin(e) || patrimonioAdmin(e) || frotaAdmin(e) })
	// is_vessel_atendimentos(): conta_ativa() and (is_superadmin or algum módulo 'atendimentos' ou 'atendimentos.*')
	VesselAtendimentos = Regra(func(e *Escopo) bool {
		return e.Ativo && (e.SuperFicha || slices.ContainsFunc(e.Modulos, ehAtendimentos))
	})
	// is_vessel_atendimentos_editar(): o de cima e (is_superadmin or alguma chave 'atendimentos'
	// ou 'atendimentos.*' de permissions-objeto cujo array tem 'editar')
	VesselAtendimentosEditar = Regra(func(e *Escopo) bool {
		if !VesselAtendimentos(e) {
			return false
		}
		if e.SuperFicha {
			return true
		}
		for k, acoes := range e.Acoes {
			if ehAtendimentos(k) && slices.Contains(acoes, "editar") {
				return true
			}
		}
		return false
	})
)

func ehAtendimentos(s string) bool {
	return s == "atendimentos" || strings.HasPrefix(s, "atendimentos.")
}

// VesselPode é vessel_pode(f, n) como portão; nome fora da lista fechada = erro (a função de
// produção levanta exceção).
func VesselPode(f, n string) (Regra, error) {
	p, err := vesselPode(f, n)
	if err != nil {
		return nil, err
	}
	return Regra(p.(predAtor)), nil
}
