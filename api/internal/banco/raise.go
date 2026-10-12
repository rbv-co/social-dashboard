package banco

import (
	"errors"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
)

// codigosDeRaise são os SQLSTATE que as funções e gatilhos de produção levantam de propósito
// (`raise exception '...' using errcode = ...`) com frase escrita para a pessoa ler.
var codigosDeRaise = []string{"P0001", "42501", "22023", "P0002", "23514"}

// RaiseNosso diz se o erro é um RAISE escrito por nós numa função ou gatilho do banco, e não
// um erro nativo do Postgres. É a regra ÚNICA (dados.ErroDoBanco e o invite-user a usam; vive
// aqui porque banco não importa nada da API e os dois a importam sem ciclo). O servidor monta
// Where de baixo para cima e a PRIMEIRA linha é onde o erro nasceu: num RAISE é
// `PL/pgSQL function f() line N at RAISE` (mesmo aninhado); um erro nativo mostra
// `... at RETURN`, `SQL expression ...`, `during inlining` etc. O código tem de estar na lista:
// um `raise;` que re-lança unique_violation (23505) também termina em "at RAISE", mas leva o
// texto nativo (nome de constraint).
func RaiseNosso(pe *pgconn.PgError) bool {
	if pe.Code == "P0001" { // raise_exception: o Postgres nativo nunca usa este código
		return true
	}
	primeira, _, _ := strings.Cut(pe.Where, "\n")
	return strings.HasSuffix(primeira, " at RAISE") && slices.Contains(codigosDeRaise, pe.Code)
}

// FraseDoRaise devolve a frase de um RAISE nosso (err pode vir embrulhado). Erro nativo
// (constraint, permissão) NÃO passa: leva nome de tabela, coluna ou valor do pedido.
func FraseDoRaise(err error) (string, bool) {
	var pe *pgconn.PgError
	if errors.As(err, &pe) && RaiseNosso(pe) {
		return pe.Message, true
	}
	return "", false
}
