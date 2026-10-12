package auth

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Ator é quem está fazendo a requisição, já com o que pode.
type Ator struct {
	ID             string
	Tipo           string // painel | cliente | servico
	Papel          string
	SuperAdmin     bool
	Permissoes     map[string][]string // recurso -> ações ("ver","criar","editar","excluir")
	ImpersonadorID *string
	Modulos        []string // profiles.features: o portão que as edges usavam (ver PodeModulo)
}

func CarregarAtor(ctx context.Context, p *pgxpool.Pool, s *Sessao) (*Ator, error) {
	a := &Ator{ID: s.UsuarioID, Tipo: s.Tipo, ImpersonadorID: s.ImpersonadorID, Permissoes: map[string][]string{}}
	var perm []byte
	err := p.QueryRow(ctx,
		`select coalesce(role::text, ''), coalesce(is_superadmin, false), coalesce(permissions, '{}'::jsonb),
		        coalesce(array_remove(features, null), '{}'::text[])
		   from profiles where id = $1`, s.UsuarioID).Scan(&a.Papel, &a.SuperAdmin, &perm, &a.Modulos)
	if errors.Is(err, pgx.ErrNoRows) {
		return a, nil // sem perfil = sem permissão (cliente da Vessel não tem profile)
	}
	if err != nil {
		return nil, err
	}
	_, a.Permissoes = LerPermissoes(perm)
	return a, nil
}

// LerPermissoes lê profiles.permissions (jsonb livre) tolerante como o banco: nada disso vira erro,
// porque CarregarAtor roda em TODA requisição autenticada e um 500 trancaria a pessoa fora de tudo.
// Só valor que é array vira ações, e só os elementos texto dele; o resto (array no topo, escalar, null,
// valor que não é array, JSON inválido) não dá ação nenhuma. As chaves são as que o operador ? do
// jsonb casa: as do objeto (qualquer valor) ou os elementos texto de um array no topo. Fonte única
// do Ator (acoes) e do Escopo de autz (chaves e acoes).
func LerPermissoes(bruto []byte) (chaves map[string]bool, acoes map[string][]string) {
	chaves, acoes = map[string]bool{}, map[string][]string{}
	var obj map[string]json.RawMessage
	if json.Unmarshal(bruto, &obj) != nil {
		var lista []any // array no topo: o ? casa os elementos texto (nenhuma ação: vessel_pode exige objeto)
		json.Unmarshal(bruto, &lista)
		for _, x := range lista {
			if s, ok := x.(string); ok {
				chaves[s] = true
			}
		}
		return chaves, acoes
	}
	for k, v := range obj {
		chaves[k] = true
		var lista []any
		if json.Unmarshal(v, &lista) != nil {
			continue
		}
		textos := []string{}
		for _, x := range lista {
			if s, ok := x.(string); ok {
				textos = append(textos, s)
			}
		}
		acoes[k] = textos
	}
	return chaves, acoes
}
