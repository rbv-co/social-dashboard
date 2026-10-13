package main

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// servicoComando é o subcomando `api servico` (Plano 5.13), rodado na VPS; não existe rota HTTP equivalente:
//
//	api servico criar <nome> <email> [--modulos a,b]   cria o robô (se o e-mail for novo) e imprime o token UMA vez
//	api servico revogar <nome>                         derruba o token na próxima chamada
//	api servico listar                                 nome, e-mail, criado, último uso, revogado (nunca o token)
//
// O token sai sozinho no stdout (dá para capturar); as instruções vão para o stderr. Saída: 0 ok, 1 falha, 2 uso errado.
func servicoComando(ctx context.Context, st *auth.Store, args []string, out, errw io.Writer) int {
	uso := func() int {
		fmt.Fprintln(errw, "uso: api servico criar <nome> <email> [--modulos a,b] | revogar <nome> | listar")
		return 2
	}
	if len(args) == 0 {
		return uso()
	}
	switch args[0] {
	case "criar":
		if len(args) < 3 {
			return uso()
		}
		var modulos []string
		switch rest := args[3:]; {
		case len(rest) == 0:
		case len(rest) == 2 && rest[0] == "--modulos":
			modulos = strings.Split(rest[1], ",")
		default:
			return uso()
		}
		tok, err := st.CriarContaDeServico(ctx, args[1], args[2], modulos)
		if err != nil {
			fmt.Fprintln(errw, "erro:", err)
			return 1
		}
		fmt.Fprintln(errw, "token criado; guarde agora, ele não será mostrado de novo. O robô manda `Authorization: Bearer <token>`.")
		fmt.Fprintln(out, tok)
		return 0
	case "revogar":
		if len(args) != 2 {
			return uso()
		}
		ok, err := st.RevogarServico(ctx, args[1])
		switch {
		case err != nil:
			fmt.Fprintln(errw, "erro:", err)
			return 1
		case !ok:
			fmt.Fprintf(errw, "erro: %q não existe ou já está revogado\n", args[1])
			return 1
		}
		fmt.Fprintf(out, "%s revogado\n", args[1])
		return 0
	case "listar":
		if len(args) != 1 {
			return uso()
		}
		l, err := st.ListarServico(ctx)
		if err != nil {
			fmt.Fprintln(errw, "erro:", err)
			return 1
		}
		fmt.Fprintf(out, "%-32s %-36s %-17s %-17s %s\n", "NOME", "E-MAIL", "CRIADO", "ÚLTIMO USO", "REVOGADO")
		for _, t := range l {
			fmt.Fprintf(out, "%-32s %-36s %-17s %-17s %s\n", t.Nome, t.Email, quando(&t.CriadoEm), quando(t.UltimoUsoEm), quando(t.RevogadoEm))
		}
		return 0
	}
	return uso()
}

func quando(t *time.Time) string {
	if t == nil {
		return "-"
	}
	return t.UTC().Format("2006-01-02 15:04")
}
