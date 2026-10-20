package dados

import (
	"maps"
	"slices"
	"sync"
)

// Declaracao: o que as rotas de domínio de uma tabela leem e gravam, anotado quando cada rota é montada
// (Consulta.Handler, RotaCriar, RotaEditar, RotaApagar). Quem descreve a API a terceiros (o MCP da Central,
// api/internal/mcp) lê daqui em vez de repetir à mão: rota nova de domínio aparece sozinha.
type Declaracao struct {
	Ler     bool              // há uma dados.Consulta (aceita limite e ordem)
	Filtros map[string]string // parâmetro → Tipo do Filtro
	Ordens  []string
	Criar   []string // campos do corpo
	Editar  []string
	Apagar  bool
}

var (
	muDeclaradas sync.Mutex
	declaradas   = map[string]*Declaracao{}
)

// anotar junta (não substitui): a mesma tabela pode ter mais de uma rota, e a montagem roda mais de uma vez
// (o roteador da API e o do MCP).
func anotar(tabela string, f func(*Declaracao)) {
	muDeclaradas.Lock()
	defer muDeclaradas.Unlock()
	d := declaradas[tabela]
	if d == nil {
		d = &Declaracao{Filtros: map[string]string{}}
		declaradas[tabela] = d
	}
	f(d)
}

func unir(a, b []string) []string {
	r := slices.Concat(a, b)
	slices.Sort(r)
	return slices.Compact(r)
}

// Declaradas devolve uma cópia do que já foi montado.
func Declaradas() map[string]Declaracao {
	muDeclaradas.Lock()
	defer muDeclaradas.Unlock()
	r := make(map[string]Declaracao, len(declaradas))
	for t, d := range declaradas {
		c := *d
		c.Filtros = maps.Clone(d.Filtros)
		c.Ordens, c.Criar, c.Editar = slices.Clone(d.Ordens), slices.Clone(d.Criar), slices.Clone(d.Editar)
		r[t] = c
	}
	return r
}
