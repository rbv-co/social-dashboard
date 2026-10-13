package patrimonio

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

func lote(ids ...string) string { return `"ids":["` + strings.Join(ids, `","`) + `"]` }

func situacao(id string) string { return col("patrimonio_bens", "situacao", id) }

// abertas: quantas posses abertas o bem tem.
func abertas(bem string) string {
	return "select count(*)::text from patrimonio_posse where ate is null and bem_id = '" + bem + "'"
}

const hojeSP = "(now() at time zone 'America/Sao_Paulo')::date"

// TestBensEmMassa: alterar vários bens de uma vez, com a posse junto. Tudo ou nada: um bem que quem
// pede não pode editar (de outro time ou que não existe) derruba o lote inteiro, com a MESMA resposta
// para os dois (sem oráculo), e nada fica gravado (Ruling 5.2-4). Cada bem passa pelo mesmo
// Editar do PATCH unitário (PodeEditar por item), na transação única.
func TestBensEmMassa(t *testing.T) {
	m := novoMundo(t, montarMassa)
	const em = "/patrimonio/bens/em-massa"

	m.Rodar(t, []caso{
		{Nome: "dois bens do time", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1, BV2) + `,"alteracao":{"situacao":"em_manutencao"}}`,
			Status: http.StatusOK, Tem: `{"alterados":2}`, Efeito: situacao(BV2), Quer: "em_manutencao"},
		{Nome: "o outro também mudou", Efeito: situacao(B1), Quer: "em_manutencao"},
		// B1 vem antes de B2 na ordem: prova que o que já foi gravado volta
		{Nome: "bem do outro time no meio: 404 e o B1 não vira baixado", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1, B2) + `,"alteracao":{"situacao":"baixado"}}`,
			Status: http.StatusNotFound, Efeito: situacao(B1), Quer: "em_manutencao"},
		{Nome: "e o B2 também não", Efeito: situacao(B2), Quer: "em_uso"},
		{Nome: "mover para fora do time: 403, o B1 fica em L1", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1) + `,"alteracao":{"local_id":"` + L2 + `","comodo_id":null}}`,
			Status: http.StatusForbidden, Efeito: col("patrimonio_bens", "local_id", B1), Quer: L1},
		{Nome: "mover um e o outro negado: nada muda", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1, BV2) + `,"alteracao":{"local_id":"` + L2 + `"}}`,
			Status: http.StatusForbidden, Efeito: "select count(*)::text from patrimonio_bens where local_id = '" + L1 + "'", Quer: "3"},
		{Nome: "mover dentro do time (null limpa o ambiente)", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1, BV2) + `,"alteracao":{"comodo_id":"` + C1 + `"}}`,
			Status: http.StatusOK, Tem: `{"alterados":2}`, Efeito: col("patrimonio_bens", "comodo_id", BV2), Quer: C1},
		{Nome: "ids em maiúsculas valem (iguais aos minúsculos)", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(strings.ToUpper(B4)) + `,"alteracao":{"situacao":"em_uso","atualizado_em":"2026-10-13T10:00:00Z"}}`,
			Status: http.StatusOK, Efeito: situacao(B4), Quer: "em_uso"},
		{Nome: "sem sessão", Metodo: "POST", Caminho: em, Corpo: `{` + lote(B4) + `,"alteracao":{"situacao":"em_uso"}}`, Status: http.StatusUnauthorized},
	})

	// sem oráculo: o bem do outro time e o que não existe respondem o MESMO
	_, alheio := m.Pedir(t, "patT1", "POST", em, `{`+lote(B1, B2)+`,"alteracao":{"situacao":"baixado"}}`)
	_, nenhum := m.Pedir(t, "patT1", "POST", em, `{`+lote(B1, bemInexistente)+`,"alteracao":{"situacao":"baixado"}}`)
	if alheio != nenhum {
		t.Errorf("a recusa do bem alheio (%s) difere da do inexistente (%s)", alheio, nenhum)
	}
	foto := m.Um(t, fotoDoMundo)
	intacto := "select ((" + fotoDoMundo + ") = '" + foto + "')::text"

	// a posse acompanha o bem (a tela fazia em duas chamadas soltas; agora é uma transação só)
	m.Rodar(t, []caso{
		{Nome: "dono novo: fecha as abertas e abre a dele", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1, B2) + `,"alteracao":{"pessoa_id":"` + P1 + `","dono_texto":null}}`,
			Status: http.StatusOK, Tem: `{"alterados":2}`,
			Efeito: "select count(*)::text from patrimonio_posse where id in ('" + PO1 + "','" + PO2 + "') and ate = " + hojeSP, Quer: "2"},
		{Nome: "duas posses abertas novas, com o nome da pessoa e o motivo", Efeito: `select count(*)::text from patrimonio_posse
			where ate is null and bem_id in ('` + B1 + `','` + B2 + `') and pessoa_id = '` + P1 + `' and pessoa_nome = 'Pessoa da T1'
			  and motivo = 'alteração em massa' and de = ` + hojeSP, Quer: "2"},
		{Nome: "uma aberta por bem (sem duplicar)", Efeito: abertas(B1), Quer: "1"},
		{Nome: "o bem tem o dono novo", Efeito: col("patrimonio_bens", "pessoa_id", B2), Quer: P1},
		{Nome: "sem dono: só fecha", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1) + `,"alteracao":{"pessoa_id":null}}`,
			Status: http.StatusOK, Efeito: abertas(B1), Quer: "0"},
		{Nome: "e não abre posse nova", Efeito: "select count(*)::text from patrimonio_posse where bem_id = '" + B1 + "'", Quer: "2"},
		{Nome: "bem sem posse aberta recebe a do dono", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B4) + `,"alteracao":{"pessoa_id":"` + P2 + `"}}`,
			Status: http.StatusOK, Efeito: "select pessoa_nome from patrimonio_posse where ate is null and bem_id = '" + B4 + "'", Quer: "Motorista"},
		{Nome: "a trava dá o dono ao bem do time, com a posse", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo:  `{` + lote(B1) + `,"alteracao":{"pessoa_id":"` + P1 + `"}}`,
			Status: http.StatusOK, Efeito: abertas(B1), Quer: "1"},
	})
	foto = m.Um(t, fotoDoMundo)
	intacto = "select ((" + fotoDoMundo + ") = '" + foto + "')::text"
	m.Rodar(t, []caso{
		// o B2 ficou com a P1 (a patT1): ela o VÊ pela mão, mas não o edita (é do time T2): 403
		{Nome: "bem que ela vê mas não edita no lote do dono: nenhuma posse muda", Quem: "patT1", Metodo: "POST", Caminho: em,
			Corpo: `{` + lote(B1, B2) + `,"alteracao":{"pessoa_id":null}}`, Status: http.StatusForbidden, Efeito: intacto, Quer: "true"},
		{Nome: "pessoa que não existe: nada muda (a FK do bem)", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo: `{` + lote(B1, B2) + `,"alteracao":{"pessoa_id":"` + bemInexistente + `"}}`, Status: http.StatusConflict, Efeito: intacto, Quer: "true"},
		{Nome: "pessoa_id que não é uuid: 400", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo: `{` + lote(B1) + `,"alteracao":{"pessoa_id":"x"}}`, Status: http.StatusBadRequest, Efeito: intacto, Quer: "true"},
	})

	// os gatilhos do bem rodam em cada bem do lote
	m.Rodar(t, []caso{
		{Nome: "tirar o responsável do veículo: o gatilho limpa o carro e fecha o uso da frota", Quem: "patGeral", Metodo: "POST", Caminho: em,
			Corpo: `{` + lote(BV) + `,"alteracao":{"pessoa_id":null}}`, Status: http.StatusOK,
			Efeito: col("frota_veiculos", "pessoa_id", V1), Quer: "<nulo>"},
		{Nome: "e a posse U1 da frota fechou", Efeito: "select (volta_em is not null)::text from frota_uso where id = '" + U1 + "'", Quer: "true"},
	})
	foto = m.Um(t, fotoDoMundo)
	intacto = "select ((" + fotoDoMundo + ") = '" + foto + "')::text"

	// pedido inválido: 400 e nada muda
	mil := make([]string, 1001)
	for i := range mil {
		mil[i] = fmt.Sprintf("b9000000-0000-4000-a000-%012d", i)
	}
	alt := `"alteracao":{"situacao":"em_uso"}`
	for _, c := range []caso{
		{Nome: "ids vazio", Corpo: `{"ids":[],` + alt + `}`, Status: 400},
		{Nome: "sem ids", Corpo: `{` + alt + `}`, Status: 400},
		{Nome: "1001 ids", Corpo: `{` + lote(mil...) + `,` + alt + `}`, Status: 400},
		{Nome: "id repetido", Corpo: `{` + lote(B4, B4) + `,` + alt + `}`, Status: 400, Tem: "repetido"},
		{Nome: "repetido, não vizinho (a ordem antes da conferência)", Corpo: `{` + lote(B4, B1, B4) + `,` + alt + `}`, Status: 400, Tem: "repetido"},
		{Nome: "repetido só na caixa", Corpo: `{` + lote(B4, strings.ToUpper(B4)) + `,` + alt + `}`, Status: 400, Tem: "repetido"},
		{Nome: "id que é SQL", Corpo: `{"ids":["1 or 1=1"],` + alt + `}`, Status: 400},
		{Nome: "id nulo", Corpo: `{"ids":[null],` + alt + `}`, Status: 400},
		{Nome: "id que não é texto", Corpo: `{"ids":[1],` + alt + `}`, Status: 400},
		{Nome: "alteracao vazia", Corpo: `{` + lote(B4) + `,"alteracao":{}}`, Status: 400, Tem: "Nada para gravar"},
		{Nome: "sem alteracao", Corpo: `{` + lote(B4) + `}`, Status: 400, Tem: "Nada para gravar"},
		{Nome: "coluna que a rota não declara", Corpo: `{` + lote(B4) + `,"alteracao":{"nome":"x"}}`, Status: 400, Tem: "corpo_invalido"},
		{Nome: "id na alteracao", Corpo: `{` + lote(B4) + `,"alteracao":{"id":"` + B1 + `"}}`, Status: 400},
		{Nome: "campo fora do corpo", Corpo: `{` + lote(B4) + `,` + alt + `,"x":1}`, Status: 400},
		{Nome: "situação fora da lista (check do banco)", Corpo: `{` + lote(B4) + `,"alteracao":{"situacao":"perdido"}}`, Status: 400},
		{Nome: "situação inválida no fim do lote: o início não grava", Corpo: `{` + lote(B4, BV2) + `,"alteracao":{"situacao":"perdido"}}`, Status: 400},
		{Nome: "local que não existe", Corpo: `{` + lote(B4) + `,"alteracao":{"local_id":"` + bemInexistente + `"}}`, Status: 409},
		{Nome: "corpo que não é objeto", Corpo: `[]`, Status: 400},
		{Nome: "corpo nulo", Corpo: `null`, Status: 400},
	} {
		c.Quem, c.Metodo, c.Caminho = "patGeral", "POST", em
		c.Efeito, c.Quer = intacto, "true"
		m.Rodar(t, []caso{c})
	}
	if got := m.Um(t, situacao(B4)); got != "em_uso" {
		t.Errorf("B4 = %s: a situação inválida não pode ter mexido nele", got)
	}

	// o limite: 1000 é aceito (não existem: 404, e não 400)
	m.Rodar(t, []caso{{Nome: "1000 ids passam do limite", Quem: "patGeral", Metodo: "POST", Caminho: em,
		Corpo: `{` + lote(mil[:1000]...) + `,` + alt + `}`, Status: http.StatusNotFound, Efeito: intacto, Quer: "true"}})

	// quem não pode: nada muda
	for _, c := range []caso{
		{Nome: "frota não lê o bem: 404", Quem: "frota", Status: http.StatusNotFound},
		{Nome: "viewer: 404", Quem: "viewer", Status: http.StatusNotFound},
		{Nome: "super pela ficha sem o módulo: 404", Quem: "superFicha", Status: http.StatusNotFound},
		{Nome: "entrou como: 403 com a frase", Quem: "impersonado", Status: http.StatusForbidden, Tem: dados.FraseEntrarComo},
	} {
		c.Metodo, c.Caminho, c.Corpo = "POST", em, `{`+lote(B4)+`,"alteracao":{"situacao":"baixado"}}`
		c.Efeito, c.Quer = intacto, "true"
		m.Rodar(t, []caso{c})
	}
}

// TestBensEmMassaDesfazTudo: a posse é da MESMA transação dos bens. Uma posse que falha (aqui, um
// gatilho que recusa a abertura) desfaz os bens já alterados e as posses já fechadas.
func TestBensEmMassaDesfazTudo(t *testing.T) {
	m := novoMundo(t, montarMassa)
	if _, err := m.P.Exec(t.Context(), `create function recusa_posse() returns trigger language plpgsql as
	  $$ begin raise exception 'posse recusada' using errcode = '23514'; end $$;
	  create trigger recusa_posse before insert on patrimonio_posse for each row execute function recusa_posse();`); err != nil {
		t.Fatal(err)
	}
	foto := m.Um(t, fotoDoMundo)
	m.Rodar(t, []caso{{Nome: "a posse nova falha: bens, posses e tudo voltam", Quem: "patGeral", Metodo: "POST", Caminho: "/patrimonio/bens/em-massa",
		Corpo:  `{` + lote(B1, B2) + `,"alteracao":{"pessoa_id":"` + P1 + `","situacao":"em_manutencao"}}`,
		Status: http.StatusBadRequest, Efeito: "select ((" + fotoDoMundo + ") = '" + foto + "')::text", Quer: "true"}})
	if got := m.Um(t, situacao(B1)); got != "em_uso" {
		t.Errorf("B1 = %s: ficou alterado apesar da posse recusada", got)
	}
}

// TestBensApagarEmMassa: tudo ou nada, pelo mesmo Apagar do DELETE unitário.
func TestBensApagarEmMassa(t *testing.T) {
	m := novoMundo(t, montarMassa)
	const ap = "/patrimonio/bens/apagar-em-massa"
	bens := contar("patrimonio_bens")
	foto := m.Um(t, fotoDoMundo)
	intacto := "select ((" + fotoDoMundo + ") = '" + foto + "')::text"

	// B1 vem antes do B2: o que já foi apagado volta
	m.Rodar(t, []caso{
		{Nome: "bem do outro time no meio: 404 e os dois ficam", Quem: "patT1", Metodo: "POST", Caminho: ap,
			Corpo: `{` + lote(B1, B2) + `}`, Status: http.StatusNotFound, Efeito: intacto, Quer: "true"},
		{Nome: "bem que não existe no meio: igual", Quem: "patT1", Metodo: "POST", Caminho: ap,
			Corpo: `{` + lote(B1, bemInexistente) + `}`, Status: http.StatusNotFound, Efeito: intacto, Quer: "true"},
		{Nome: "viewer: 404", Quem: "viewer", Metodo: "POST", Caminho: ap, Corpo: `{` + lote(B4) + `}`, Status: http.StatusNotFound, Efeito: intacto, Quer: "true"},
		{Nome: "frota: 404", Quem: "frota", Metodo: "POST", Caminho: ap, Corpo: `{` + lote(B4) + `}`, Status: http.StatusNotFound, Efeito: intacto, Quer: "true"},
		{Nome: "entrou como: 403 com a frase", Quem: "impersonado", Metodo: "POST", Caminho: ap, Corpo: `{` + lote(B4) + `}`,
			Status: http.StatusForbidden, Tem: dados.FraseEntrarComo, Efeito: intacto, Quer: "true"},
		{Nome: "sem sessão", Metodo: "POST", Caminho: ap, Corpo: `{` + lote(B4) + `}`, Status: http.StatusUnauthorized, Efeito: intacto, Quer: "true"},
	})
	_, alheio := m.Pedir(t, "patT1", "POST", ap, `{`+lote(B1, B2)+`}`)
	_, nenhum := m.Pedir(t, "patT1", "POST", ap, `{`+lote(B1, bemInexistente)+`}`)
	if alheio != nenhum {
		t.Errorf("a recusa do bem alheio (%s) difere da do inexistente (%s)", alheio, nenhum)
	}
	mil := make([]string, 1001)
	for i := range mil {
		mil[i] = fmt.Sprintf("b9000000-0000-4000-a000-%012d", i)
	}
	for _, c := range []caso{
		{Nome: "ids vazio", Corpo: `{"ids":[]}`}, {Nome: "sem ids", Corpo: `{}`},
		{Nome: "1001 ids", Corpo: `{` + lote(mil...) + `}`},
		{Nome: "repetido", Corpo: `{` + lote(B4, B4) + `}`, Tem: "repetido"},
		{Nome: "SQL", Corpo: `{"ids":["1 or 1=1"]}`},
		{Nome: "coluna estranha", Corpo: `{` + lote(B4) + `,"alteracao":{}}`},
	} {
		c.Quem, c.Metodo, c.Caminho, c.Status = "patGeral", "POST", ap, 400
		c.Efeito, c.Quer = intacto, "true"
		m.Rodar(t, []caso{c})
	}

	m.Rodar(t, []caso{
		{Nome: "bens do time: 204 e as posses somem junto", Quem: "patT1", Metodo: "POST", Caminho: ap,
			Corpo: `{` + lote(B1, BV2) + `}`, Status: http.StatusNoContent,
			Efeito: "select count(*)::text from patrimonio_bens where id in ('" + B1 + "','" + BV2 + "')", Quer: "0"},
		{Nome: "a posse do B1 foi", Efeito: "select count(*)::text from patrimonio_posse where id = '" + PO1 + "'", Quer: "0"},
		{Nome: "as outras ficam", Efeito: bens, Quer: "4"},
		{Nome: "a posse do outro time fica", Efeito: "select count(*)::text from patrimonio_posse where id = '" + PO2 + "'", Quer: "1"},
		{Nome: "sem trava", Quem: "patGeral", Metodo: "POST", Caminho: ap, Corpo: `{` + lote(B4) + `}`, Status: http.StatusNoContent,
			Efeito: "select count(*)::text from patrimonio_bens where id = '" + B4 + "'", Quer: "0"},
	})
}
