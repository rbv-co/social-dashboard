// Package patrimonio: as rotas do sub-plano 5.2 — bens (com o escopo por time de pode_ver_bem), a
// posse (que segue o bem), a árvore Marca › Local › Ambiente, categorias e tipos, a configuração e o
// log do Patrimônio, e as RPCs do cadastro rápido e da ligação carro ↔ bem. Toda regra é a do
// catálogo de produção (autz.Producao); toda escrita roda em banco.ComUsuario (os gatilhos do bem e do
// carro rodam com quem pede); sessão de "entrar como" só lê (Ruling 5.2-3).
package patrimonio

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria vai em TODA escrita de tabela do 5.2 (TestEscritasRecusamImpersonado confere).
var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// texto confere um campo de texto obrigatório-quando-presente: ausente passa (a não ser que seja
// obrigatório); presente (inclusive null) tem de ser string com 1 a max caracteres sem os espaços das pontas.
func texto(campo string, v json.RawMessage, max int, obrigatorio bool) error {
	if v == nil {
		if obrigatorio {
			return fmt.Errorf("Falta %s.", campo)
		}
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) != nil || strings.TrimSpace(s) == "" || utf8.RuneCountInString(s) > max {
		return fmt.Errorf("Confira %s: texto de 1 a %d caracteres.", campo, max)
	}
	return nil
}

// textoOuNulo: ausente ou null passa; senão, string de até max caracteres.
func textoOuNulo(campo string, v json.RawMessage, max int) error {
	if v == nil || string(v) == "null" {
		return nil
	}
	var s string
	if json.Unmarshal(v, &s) != nil || utf8.RuneCountInString(s) > max {
		return fmt.Errorf("Confira %s: texto de até %d caracteres.", campo, max)
	}
	return nil
}
