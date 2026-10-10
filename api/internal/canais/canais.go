// Package canais decide de quais canais de venda (lojas do Bling) uma pessoa vê o faturamento.
// Porta ÚNICA de supabase/functions/_shared/canais-de-venda-permitidos.js: o bling-proxy
// recorta a resposta do Bling com isto e o front pergunta por GET /eu/canais, em vez de
// manter uma segunda cópia da regra.
//
// nil = vê TODOS os canais; []int64{} = não vê NENHUM. Confundir os dois é o defeito que
// faria uma vendedora sem time enxergar a empresa inteira.
package canais

import (
	"regexp"
	"strconv"
	"strings"
)

type Time struct {
	ID          string
	CanalLojaID *int64
}

type Membro struct{ EquipeID, ProfileID, Papel string }

type Canal struct {
	LojaID  int64
	Grupo   *string
	GrupoID *string
}

type MembroDeGrupo struct{ GrupoID, ProfileID, Papel string }

type Escopo struct {
	SuperAdmin     bool
	PorEquipe      bool
	MeuID          string
	Times          []Time
	Membros        []Membro
	Canais         []Canal
	MembrosDeGrupo []MembroDeGrupo
}

// normalizarGrupo: pontas fora, espaço repetido vira um, vazio vira "" (sem grupo).
func normalizarGrupo(g *string) string {
	if g == nil {
		return ""
	}
	return strings.Join(strings.Fields(*g), " ")
}

// DoEscopo é canaisDoEscopo do JS, regra por regra.
func DoEscopo(e Escopo) []int64 {
	if e.SuperAdmin || !e.PorEquipe {
		return nil
	}
	ids := []int64{}
	if e.MeuID == "" {
		return ids
	}
	// Os MEUS vínculos com o papel em cada time. Papel ausente = vendedora: falta de dado
	// nunca dá acesso a mais.
	meus := map[string]string{}
	for _, m := range e.Membros {
		if m.ProfileID != e.MeuID {
			continue
		}
		papel := m.Papel
		if papel == "" {
			papel = "vendedora"
		}
		meus[m.EquipeID] = papel
	}
	grupoDoCanal := map[int64]string{}
	for _, c := range e.Canais {
		if g := normalizarGrupo(c.Grupo); g != "" {
			grupoDoCanal[c.LojaID] = strings.ToLower(g)
		}
	}
	supervisiono := map[string]bool{}
	for _, t := range e.Times {
		papel, ok := meus[t.ID]
		if !ok || t.CanalLojaID == nil {
			continue // time sem canal não acrescenta nada (e não vira "vê tudo")
		}
		ids = append(ids, *t.CanalLojaID)
		// Supervisora vê todos os canais do GRUPO do canal do time (decisão de 20/08/2026).
		if g := grupoDoCanal[*t.CanalLojaID]; papel == "supervisora" && g != "" {
			supervisiono[g] = true
		}
	}
	if len(supervisiono) > 0 {
		for _, c := range e.Canais {
			if g := grupoDoCanal[c.LojaID]; g != "" && supervisiono[g] {
				ids = append(ids, c.LojaID)
			}
		}
	}
	// A supervisora que mora no GRUPO (canais_grupos_membros), casada por grupo_id como
	// public.pode_ver_canal faz no banco. Só 'supervisora' amplia.
	meusGrupos := map[string]bool{}
	for _, gm := range e.MembrosDeGrupo {
		if gm.ProfileID == e.MeuID && gm.Papel == "supervisora" && gm.GrupoID != "" {
			meusGrupos[gm.GrupoID] = true
		}
	}
	if len(meusGrupos) > 0 {
		for _, c := range e.Canais {
			if c.GrupoID != nil && *c.GrupoID != "" && meusGrupos[*c.GrupoID] {
				ids = append(ids, c.LojaID)
			}
		}
	}
	// Sem repetição, na ordem em que apareceram (o Set do JS).
	vistos := map[int64]bool{}
	out := []int64{}
	for _, id := range ids {
		if !vistos[id] {
			vistos[id] = true
			out = append(out, id)
		}
	}
	return out
}

var (
	negadosAQuemELimitado = regexp.MustCompile(`^nfc?e(/|$)`)
	umPedido              = regexp.MustCompile(`^pedidos/vendas/[A-Za-z0-9_-]+$`)
)

// lojaDoPedido devolve pedido.loja.id como texto ("" se não houver): número e texto casam.
func lojaDoPedido(p any) string {
	m, _ := p.(map[string]any)
	loja, _ := m["loja"].(map[string]any)
	switch v := loja["id"].(type) {
	case string:
		return v
	case interface{ String() string }: // json.Number
		return v.String()
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	}
	return ""
}

// Recortar é recortarRespostaDoBling: o que sai do bling-proxy para quem está limitado.
// canais nil devolve o corpo intacto. negado = responder 403, não uma lista vazia (lista
// vazia mentiria dizendo que não há venda). corpo é o JSON já decodificado.
func Recortar(endpoint string, corpo any, canais []int64) (any, bool) {
	if canais == nil {
		return corpo, false
	}
	if negadosAQuemELimitado.MatchString(endpoint) {
		return nil, true // nota fiscal não dá para recortar por canal
	}
	ok := map[string]bool{}
	for _, c := range canais {
		ok[strconv.FormatInt(c, 10)] = true
	}
	m, _ := corpo.(map[string]any)
	if endpoint == "pedidos/vendas" {
		lista, eLista := m["data"].([]any)
		if !eLista {
			return corpo, false // resposta de erro do Bling não é lista
		}
		filtrada := []any{}
		for _, p := range lista {
			if ok[lojaDoPedido(p)] {
				filtrada = append(filtrada, p)
			}
		}
		saida := map[string]any{}
		for k, v := range m {
			saida[k] = v
		}
		saida["data"] = filtrada
		return saida, false
	}
	if umPedido.MatchString(endpoint) {
		if m["data"] == nil {
			return corpo, false
		}
		if !ok[lojaDoPedido(m["data"])] {
			return nil, true
		}
	}
	return corpo, false
}
