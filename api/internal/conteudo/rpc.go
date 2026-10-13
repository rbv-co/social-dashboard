package conteudo

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
)

// FuncoesRPC: as 6 RPCs do Conteúdo na lista branca de POST /rpc/{nome} (web.FuncoesRPC as junta). Todas
// gravam (SoSessaoPropria: "entrar como" recebe 403 sem a função rodar). O portão é a checagem de dentro de
// cada função (TestPortoesIguaisAsFuncoes); a conferência prende a peça/casamento/ideia/conta do parâmetro à
// restritiva pode_ver_conta, que as funções SECURITY DEFINER ignoravam (Ruling 5.9-10). O ParamConta do 5.7
// não serve: ele é para parâmetro text, e p_account é uuid. Os parâmetros e os DEFAULTs são os de
// 02-funções.csv:178-474.
var FuncoesRPC = []rpc.Funcao{
	{Nome: "conteudo_aprovar_e_agendar", Retorno: rpc.Valor, Portao: Aprovador, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}}, Conferir: pecaDoParametro("p_peca")},
	{Nome: "conteudo_casar_na_mao", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params:   []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}, {Nome: "p_media", Tipo: "text"}},
		Conferir: pecaDoParametro("p_peca")},
	{Nome: "conteudo_decidir", Retorno: rpc.Valor, Portao: Aprovador, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}, {Nome: "p_decisao", Tipo: "text"},
			{Nome: "p_motivo", Tipo: "text", Opcional: true}},
		Conferir: pecaDoParametro("p_peca")},
	{Nome: "conteudo_decidir_casamento", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params:   []rpc.Param{{Nome: "p_casamento", Tipo: "uuid"}, {Nome: "p_confirma", Tipo: "boolean"}},
		Conferir: pecaDoCasamento},
	{Nome: "conteudo_ideia_virar_peca", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_ideia", Tipo: "uuid"}, {Nome: "p_account", Tipo: "uuid"},
			{Nome: "p_publicar_em", Tipo: "timestamptz", Opcional: true}},
		Conferir: ideiaEContaVisiveis},
	{Nome: "conteudo_reavisar", Retorno: rpc.Valor, Portao: Conteudista, SoSessaoPropria: true,
		Params: []rpc.Param{{Nome: "p_peca", Tipo: "uuid"}}, Conferir: pecaDoParametro("p_peca")},
}

// contaVisivel: a conta (texto; vazio = a linha não existe) é uma que quem pede vê? Inexistente e de outra
// conta respondem igual (403): o parâmetro não confirma que a linha existe.
func contaVisivel(e *autz.Escopo, conta string, err error) error {
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return autz.ErrNegado
	case err != nil:
		return err
	case !autz.PodeVerConta(e, conta):
		return autz.ErrNegado
	}
	return nil
}

// pecaDoParametro: a peça do parâmetro tem de ser de uma conta que quem pede vê. Só a CONTA: o módulo
// 'conteudo' a função não pedia (quem só tem 'conteudo.aprovar' continua decidindo, como hoje); o portão já
// decidiu a pessoa. Nulo, id inválido e inexistente = 403, como a de outra conta.
func pecaDoParametro(nome string) func(context.Context, pgx.Tx, *autz.Escopo, map[string]json.RawMessage) error {
	return func(ctx context.Context, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error {
		peca, _ := comoTexto(args[nome])
		if !reUUID.MatchString(peca) {
			return autz.ErrNegado
		}
		var conta string
		err := tx.QueryRow(ctx, `select account_id::text from conteudo_pecas where id = $1::uuid`, peca).Scan(&conta)
		return contaVisivel(e, conta, err)
	}
}

// pecaDoCasamento: a peça da sugestão de casamento tem de ser de uma conta que quem pede vê.
func pecaDoCasamento(ctx context.Context, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error {
	casamento, _ := comoTexto(args["p_casamento"])
	if !reUUID.MatchString(casamento) {
		return autz.ErrNegado
	}
	var conta string
	err := tx.QueryRow(ctx, `select pc.account_id::text from conteudo_casamentos c
		join conteudo_pecas pc on pc.id = c.peca_id where c.id = $1::uuid`, casamento).Scan(&conta)
	return contaVisivel(e, conta, err)
}

// ideiaEContaVisiveis: a ideia (conta nula = de todas as marcas) e a conta da peça nova (p_account) têm de ser
// de contas que quem pede vê — a função criaria a peça na conta do parâmetro sem olhar pode_ver_conta.
func ideiaEContaVisiveis(ctx context.Context, tx pgx.Tx, e *autz.Escopo, args map[string]json.RawMessage) error {
	ideia, _ := comoTexto(args["p_ideia"])
	conta, _ := comoTexto(args["p_account"])
	if !reUUID.MatchString(ideia) || !reUUID.MatchString(conta) || !autz.PodeVerConta(e, conta) {
		return autz.ErrNegado
	}
	var daIdeia *string
	err := tx.QueryRow(ctx, `select account_id::text from conteudo_ideias where id = $1::uuid`, ideia).Scan(&daIdeia)
	if err == nil && daIdeia == nil {
		return nil // de todas as marcas
	}
	var c string
	if daIdeia != nil {
		c = *daIdeia
	}
	return contaVisivel(e, c, err)
}
