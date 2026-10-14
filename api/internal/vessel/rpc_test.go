package vessel

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/banco"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// montarRPCs monta a lista como web.Rotas, no grupo de domínio.
func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	if err != nil {
		panic(err)
	}
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

var errDesfazer = errors.New("desfazer")

// intacto roda casos que NÃO podem mudar o selo: a foto das tabelas é a mesma antes e depois.
func intacto(t *testing.T, m *mundoteste.Mundo, casos []mundoteste.Caso) {
	t.Helper()
	antes := m.Um(t, fotoDoSelo)
	m.Rodar(t, casos)
	if m.Um(t, fotoDoSelo) != antes {
		t.Fatal("um caso que devia ser recusado mudou o selo")
	}
}

// O portão do Go = a primeira linha de cada função de produção, pessoa por pessoa: cada função roda como cada pessoa
// (e como um usuário sem perfil) numa transação desfeita; negada = {"ok":false,"motivo":"sem_permissao"}. As
// funções são SECURITY DEFINER e is_vessel_admin() chama conta_ativa(): o desativado é negado nelas e no Go.
func TestPortoesIguaisAsFuncoes(t *testing.T) {
	m := novoMundo(t)
	ctx := context.Background()
	const semPerfil = "a5a10000-0000-4000-a000-000000000099"
	if _, err := m.P.Exec(ctx, `insert into usuarios (id, email) values ($1::uuid, 'semperfil@x.com')`, semPerfil); err != nil {
		t.Fatal(err)
	}
	ids := map[string]string{"semPerfil": semPerfil}
	for _, p := range pessoas {
		ids[p.Chave] = p.ID
	}
	// argumentos válidos: quem passa no portão não esbarra noutra recusa antes dele
	chamadas := map[string]string{
		"vessel_alertas":                    `vessel_alertas()`,
		"vessel_fila_de_registros":          `vessel_fila_de_registros(null)`,
		"vessel_baixar_garantia":            `vessel_baixar_garantia('VBAAAA0003', 'pedido da cliente')`,
		"vessel_baixar_peca":                `vessel_baixar_peca('VBAAAA0002', 'extraviada')`,
		"vessel_decidir_pedido_de_registro": `vessel_decidir_pedido_de_registro('` + PR2 + `'::uuid, 'aprovado', 'na_mao', null, null)`,
		"vessel_definir_material_do_lote":   `vessel_definir_material_do_lote('` + L1 + `'::uuid, 'couro')`,
		"vessel_desfazer_baixa":             `vessel_desfazer_baixa('VBTTTT0002')`,
		"vessel_desmarcar_gravada":          `vessel_desmarcar_gravada('VBAAAA0001', null)`,
		"vessel_editar_lote":                `vessel_editar_lote('` + L1 + `'::uuid, 'Linear', 'Caramelo', 'SS0001HB.S1', null, 4, null)`,
		"vessel_excluir_lote":               `vessel_excluir_lote('` + L2 + `'::uuid)`,
		"vessel_excluir_peca":               `vessel_excluir_peca('VBAAAA0002')`,
		"vessel_gerar_lote":                 `vessel_gerar_lote('Linear', 'Caramelo', 'SS0001HB.S1', 2, null, null, null)`,
		"vessel_marcar_gravada":             `vessel_marcar_gravada('VBAAAA0002')`,
		"vessel_pedir_cartoes":              `vessel_pedir_cartoes(array['VBAAAA0002'])`,
		"vessel_sobrescrever_etiqueta":      `vessel_sobrescrever_etiqueta('VBAAAA0001', 'VBAAAA0002', 'fila', 'etiqueta rasgou')`,
		"vessel_trocar_dono":                `vessel_trocar_dono('VBAAAA0003', 'Bia', '11144477735', '11988887777', 'venda', 'VBAAAA0003')`,
	}
	if len(chamadas) != len(FuncoesRPC) {
		t.Fatalf("%d chamadas para %d funções", len(chamadas), len(FuncoesRPC))
	}
	for _, f := range FuncoesRPC {
		chamada, ok := chamadas[f.Nome]
		if !ok {
			t.Errorf("função sem chamada no teste: %s", f.Nome)
			continue
		}
		var permitidas, negadas int
		for quem, id := range ids {
			e, err := autz.CarregarEscopo(ctx, m.P, id)
			if err != nil {
				t.Fatal(err)
			}
			var motivo *string
			err = banco.ComUsuario(ctx, m.P, id, func(tx pgx.Tx) error {
				if err := tx.QueryRow(ctx, `select (`+chamada+`)->>'motivo'`).Scan(&motivo); err != nil {
					return err
				}
				return errDesfazer
			})
			if !errors.Is(err, errDesfazer) {
				t.Fatalf("%s como %s: %v", f.Nome, quem, err)
			}
			naFuncao := motivo == nil || *motivo != "sem_permissao"
			if naFuncao {
				permitidas++
			} else {
				negadas++
			}
			if no := f.Portao(e); no != naFuncao {
				t.Errorf("%s como %s: o portão do Go = %t, a função %t", f.Nome, quem, no, naFuncao)
			}
		}
		if permitidas < 2 || negadas < 5 {
			t.Errorf("%s: o mundo tem de mostrar os dois lados: %d permitidas, %d negadas", f.Nome, permitidas, negadas)
		}
	}
}

func TestRPCsDoSelo(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	rpcDe := func(nome string) string { return "/rpc/" + nome }
	// recusas: do portão (403), do "entrar como" (403 com a frase), da conferência do registro (403), da forma (400)
	// e das próprias funções (200 com ok:false) — nenhuma muda o selo
	intacto(t, m, []mundoteste.Caso{
		{Nome: "admin sem o módulo lê alertas", Quem: "admin", Metodo: "POST", Caminho: rpcDe("vessel_alertas"), Status: 403, Tem: "sem_permissao"},
		{Nome: "a chave só em permissions", Quem: "chave", Metodo: "POST", Caminho: rpcDe("vessel_fila_de_registros"), Corpo: `{}`, Status: 403},
		{Nome: "leitor baixa peça", Quem: "leitor", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`, Status: 403},
		{Nome: "admin troca a dona", Quem: "admin", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0003"}`, Status: 403},
		{Nome: "desativado", Quem: "desativado", Metodo: "POST", Caminho: rpcDe("vessel_alertas"), Status: 401},
		{Nome: "impersonado baixa a garantia", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("vessel_baixar_garantia"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":"pedido da cliente"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "impersonado decide registro", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao"}`, Status: 403, Tem: "Quem entrou como outra pessoa"},
		{Nome: "o painel dizendo 'bling'", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"bling","p_conferencia":{"pedido":"9","quando":"2026-02-01"}}`, Status: 403},
		{Nome: "na mão com uma conferência inventada", Quem: "super", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao","p_conferencia":{"pedido":"9","contato":"8"}}`, Status: 403},
		{Nome: "falta a confirmação", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda"}`, Status: 400, Tem: "falta o parâmetro p_confirmacao"},
		{Nome: "fotos que não são lista", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_gerar_lote"),
			Corpo: `{"p_modelo":"X","p_cor":null,"p_sku":null,"p_quantidade":1,"p_fabricado_em":null,"p_fotos":"a.jpg"}`, Status: 400, Tem: "deve ser uma lista"},
		{Nome: "peças que não são texto", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_pedir_cartoes"), Corpo: `{"p_pecas":[1]}`, Status: 400, Tem: "lista de textos"},
		{Nome: "parâmetro desconhecido", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_marcar_gravada"), Corpo: `{"p_codigo":"VBAAAA0002","p_quem":"x"}`, Status: 400, Tem: "parâmetro desconhecido"},
		// as recusas das próprias funções chegam como chegavam pelo PostgREST: 200 com ok:false e o motivo
		{Nome: "motivo de baixa fora da lista", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"roubada"}`, Status: 200, Tem: "motivo_invalido"},
		{Nome: "peça que não existe", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_marcar_gravada"), Corpo: `{"p_codigo":"XX"}`, Status: 200, Tem: "peca_nao_existe"},
		{Nome: "desmarcar peça com dona sem motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_desmarcar_gravada"), Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":null}`, Status: 200, Tem: "motivo_obrigatorio"},
		{Nome: "confirmação que não bate", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11144477735","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0001"}`, Status: 200, Tem: "confirmacao_nao_bate"},
		{Nome: "CPF inválido", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"11111111111","p_whatsapp":"11988887777","p_motivo":"venda","p_confirmacao":"VBAAAA0003"}`, Status: 200, Tem: "cpf_invalido"},
		{Nome: "excluir peça gravada", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_peca"), Corpo: `{"p_codigo":"VBAAAA0001"}`, Status: 200, Tem: "esta_gravada"},
		{Nome: "excluir lote com peça gravada", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_lote"), Corpo: `{"p_lote":"` + L1 + `"}`, Status: 200, Tem: "tem_gravada"},
		{Nome: "lote abaixo das presas", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_editar_lote"),
			Corpo: `{"p_lote":"` + L1 + `","p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_fabricado_em":null,"p_quantidade":1}`, Status: 200, Tem: "abaixo_do_gravado"},
		{Nome: "material fora da lista", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_definir_material_do_lote"), Corpo: `{"p_lote":"` + L1 + `","p_material":"seda"}`, Status: 200, Tem: "material_invalido"},
		{Nome: "baixar garantia sem motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_garantia"), Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":" "}`, Status: 200, Tem: "motivo_obrigatorio"},
		{Nome: "cartão de peça que não existe", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_pedir_cartoes"), Corpo: `{"p_pecas":["XX"]}`, Status: 200, Tem: "peca_nao_existe"},
		{Nome: "recusar sem motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"recusado","p_quem_decidiu":"na_mao","p_conferencia":null,"p_motivo":null}`, Status: 200, Tem: "motivo_obrigatorio"},
	})

	const trilha = `select coalesce(string_agg(acao || ':' || (feito_por = '` + idSelo + `')::text, ',' order by feito_em, acao), '') from vessel_edicoes where codigo = '`
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "alertas para o impersonado (só lê)", Quem: "impersonado", Metodo: "POST", Caminho: rpcDe("vessel_alertas"), Status: 200, Tem: `"total_leituras" : 2`},
		{Nome: "a fila com o CPF mascarado", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_fila_de_registros"), Corpo: `{}`, Status: 200, Tem: `***.982.247-**`, NaoTem: cpfDaDona},
		{Nome: "a fila de uma peça", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_fila_de_registros"), Corpo: `{"p_codigo":"vbtttt0001"}`, Status: 200, Tem: "Duda Teste", NaoTem: "Carla"},
		{Nome: "marcar gravada", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_marcar_gravada"), Corpo: `{"p_codigo":"vbaaaa0002"}`, Status: 200, Tem: `"ja_estava" : false`,
			Efeito: `select (gravada_em is not null)::text from vessel_pecas where codigo = 'VBAAAA0002'`, Quer: "true"},
		{Nome: "baixar peça", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: `select motivo || '|' || (baixada_por = '` + idSelo + `')::text from vessel_baixas where codigo = 'VBAAAA0002' and desfeita_em is null`, Quer: "extraviada|true"},
		{Nome: "baixar de novo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_peca"), Corpo: `{"p_codigo":"VBAAAA0002","p_motivo":"defeito"}`, Status: 200, Tem: "ja_baixada"},
		{Nome: "desfazer a baixa", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_desfazer_baixa"), Corpo: `{"p_codigo":"VBAAAA0002"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: `select count(*)::text from vessel_baixas where codigo = 'VBAAAA0002' and desfeita_em is null`, Quer: "0"},
		{Nome: "sobrescrever para a baixa", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_sobrescrever_etiqueta"),
			Corpo: `{"p_codigo_antigo":"VBAAAA0001","p_codigo_novo":"VBTTTT0001","p_destino":"baixa","p_motivo":"defeito"}`, Status: 200, Tem: `"destino" : "baixa"`,
			Efeito: `select (select (gravada_em is null)::text from vessel_pecas where codigo = 'VBAAAA0001') || '|' || (select (gravada_em is not null)::text from vessel_pecas where codigo = 'VBTTTT0001')
				|| '|' || (select motivo from vessel_baixas where codigo = 'VBAAAA0001' and desfeita_em is null)`, Quer: "true|true|defeito"},
		{Nome: "a trilha da sobrescrita", Efeito: trilha + `VBAAAA0001'`, Quer: "sobrescrever_para_baixa:true"},
		{Nome: "desmarcar a peça com dona, com motivo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_desmarcar_gravada"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":"etiqueta trocada"}`, Status: 200, Tem: `"tinha_garantia" : true`,
			Efeito: trilha + `VBAAAA0003'`, Quer: "desmarcar_gravada:true"},
		{Nome: "gerar lote: a série continua no produto e o material é herdado", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_gerar_lote"),
			Corpo: `{"p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_quantidade":2,"p_fabricado_em":null,"p_fotos":null,"p_os":""}`, Status: 200, Tem: `"primeiro_numero" : 4`,
			Efeito: `select l.material || '|' || l.material_fonte || '|' || (l.criado_por = '` + idSelo + `')::text || '|' || coalesce(l.os, 'nulo') || '|' || string_agg(p.numero_na_serie::text, ',' order by p.numero_na_serie)
				from vessel_lotes l join vessel_pecas p on p.lote_id = l.id where l.id <> '` + L1 + `' and l.sku = 'SS0001HB.S1' group by l.id`, Quer: "canvas|herdado|true|nulo|4,5"},
		{Nome: "gerar lote de teste", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_gerar_lote"),
			Corpo: `{"p_modelo":"Prova","p_cor":null,"p_sku":"TESTE-02","p_quantidade":1,"p_fabricado_em":"2026-10-01","p_fotos":null}`, Status: 200,
			Efeito: `select teste::text || '|' || fabricado_em::text from vessel_lotes where sku = 'TESTE-02'`, Quer: "true|2026-10-01"},
		{Nome: "editar o lote para 5: a série do produto continua sem número repetido", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_editar_lote"),
			Corpo: `{"p_lote":"` + L1 + `","p_modelo":"Linear","p_cor":"Caramelo","p_sku":"SS0001HB.S1","p_fabricado_em":null,"p_quantidade":5,"p_os":"OS-8"}`, Status: 200, Tem: `"quantidade" : 5`,
			Efeito: `select (count(*) = count(distinct p.numero_na_serie))::text || '|' || count(*)::text from vessel_pecas p join vessel_lotes l on l.id = p.lote_id where l.sku = 'SS0001HB.S1'`, Quer: "true|7"},
		{Nome: "o material do lote recalcula a garantia da dona", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_definir_material_do_lote"),
			Corpo: `{"p_lote":"` + L1 + `","p_material":"Couro"}`, Status: 200, Tem: `"registros_recalculados" : 1`,
			Efeito: `select garantia_ate::text from vessel_registros where codigo = 'VBAAAA0003'`, Quer: "2026-07-10"},
		{Nome: "pedir cartões (repetido e em minúscula vira um)", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_pedir_cartoes"),
			Corpo: `{"p_pecas":["vbaaaa0002","VBAAAA0002"," "]}`, Status: 200, Tem: `"pecas" : 1`,
			Efeito: `select pecas::text || '|' || situacao || '|' || (criado_por = '` + idSelo + `')::text from vessel_cartao_pedidos where situacao = 'na_fila'`, Quer: "{VBAAAA0002}|na_fila|true"},
		{Nome: "aprovar na mão: a dona nova com a garantia do material", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao","p_conferencia":null,"p_motivo":null}`, Status: 200, Tem: `"garantia_ate" : "2026-08-01"`,
			Efeito: `select r.nome || '|' || coalesce(r.bling_pedido, 'nulo') || '|' || p.estado || '|' || (p.decidido_quem = '` + idSelo + `')::text
				from vessel_registros r join vessel_pedidos_de_registro p on p.id = r.pedido_id where r.codigo = 'VBAAAA0002'`, Quer: "Carla Compradora|nulo|aprovado|true"},
		{Nome: "decidir de novo", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR2 + `","p_estado":"recusado","p_quem_decidiu":"na_mao","p_motivo":"x"}`, Status: 200, Tem: "ja_decidido"},
		{Nome: "aprovar em lote sem material: garantia nula (nunca chutar) e o lembrete morre", Quem: "super", Metodo: "POST", Caminho: rpcDe("vessel_decidir_pedido_de_registro"),
			Corpo: `{"p_pedido":"` + PR3 + `","p_estado":"aprovado","p_quem_decidiu":"na_mao"}`, Status: 200, Tem: `"garantia_ate" : null`,
			Efeito: `select cancelado_por from vessel_lembretes where peca_codigo = 'VBTTTT0001'`, Quer: "registro"},
		{Nome: "trocar a dona: o elo com o Bling sai e a trilha leva o CPF mascarado", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_trocar_dono"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_nome":"Bia","p_cpf":"111.444.777-35","p_whatsapp":"(11) 98888-7777","p_motivo":"venda","p_confirmacao":"vbaaaa-0003"}`, Status: 200, Tem: `"para" : "Bia"`,
			Efeito: `select r.nome || '|' || r.cpf || '|' || coalesce(r.bling_pedido, 'nulo') || '|' || coalesce(r.pedido_id::text, 'nulo') || '|' || r.garantia_ate::text || '|'
				|| (select e.detalhes -> 'para' ->> 'cpf' from vessel_edicoes e where e.codigo = r.codigo and e.acao = 'dono_trocado')
				from vessel_registros r where r.codigo = 'VBAAAA0003'`, Quer: "Bia|11144477735|nulo|nulo|2026-07-10|***.444.777-**"},
		{Nome: "baixar a garantia: guarda antes de apagar", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_baixar_garantia"),
			Corpo: `{"p_codigo":"VBAAAA0003","p_motivo":"pedido da cliente"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: `select (select count(*) from vessel_registros where codigo = 'VBAAAA0003')::text || '|' || g.nome || '|' || g.motivo || '|' || (g.baixada_por = '` + idSelo + `')::text
				from vessel_garantias_baixadas g where g.codigo = 'VBAAAA0003'`, Quer: "0|Bia|pedido da cliente|true"},
		{Nome: "a trilha da peça da dona", Efeito: `select string_agg(acao, ',' order by feito_em, acao) from vessel_edicoes where codigo = 'VBAAAA0003'`,
			Quer: "desmarcar_gravada,material_do_lote,dono_trocado,baixar_garantia"},
	})
	// excluir: a peça livre de maior número do lote e o lote gerado (2 peças livres)
	livre := m.Um(t, `select codigo from vessel_pecas where lote_id = '`+L1+`' and gravada_em is null and codigo not in (select codigo from vessel_registros)
		and codigo not in (select unnest(pecas) from vessel_cartao_pedidos) order by numero_na_serie desc limit 1`)
	gerado := m.Um(t, `select id::text from vessel_lotes where sku = 'SS0001HB.S1' and id <> '`+L1+`'`)
	m.Rodar(t, []mundoteste.Caso{
		{Nome: "excluir a peça livre", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_peca"), Corpo: `{"p_codigo":"` + livre + `"}`, Status: 200, Tem: `"ok" : true`,
			Efeito: trilha + livre + `'`, Quer: "peca_excluida:true"},
		{Nome: "excluir o lote livre", Quem: "selo", Metodo: "POST", Caminho: rpcDe("vessel_excluir_lote"), Corpo: `{"p_lote":"` + gerado + `"}`, Status: 200, Tem: `"excluidas" : 2`,
			Efeito: `select count(*)::text from vessel_edicoes where acao = 'lote_excluido' and detalhes ->> 'lote' = '` + gerado + `'`, Quer: "2"},
	})
}

// Duas baixas da mesma peça ao mesmo tempo: uma ganha; a outra recebe "ja_baixada" (a função conferiu depois) ou 409
// (as duas conferiram antes e o índice de uma baixa ativa por peça recusou a segunda) — o mesmo que o PostgREST dava.
// Nunca duas baixas ativas.
func TestBaixaSimultanea(t *testing.T) {
	m := novoMundo(t, montarRPCs)
	var wg sync.WaitGroup
	st := make([]int, 2)
	corpo := make([]string, 2)
	comeca := make(chan struct{})
	for i := range 2 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-comeca
			st[i], corpo[i] = m.Pedir(t, "selo", "POST", "/rpc/vessel_baixar_peca", `{"p_codigo":"VBAAAA0002","p_motivo":"extraviada"}`)
		}()
	}
	close(comeca)
	wg.Wait()
	ganhou := 0
	for i := range 2 {
		switch {
		case st[i] == http.StatusOK && strings.Contains(corpo[i], `"ok" : true`):
			ganhou++
		case st[i] == http.StatusOK && strings.Contains(corpo[i], "ja_baixada"), st[i] == http.StatusConflict:
		default:
			t.Errorf("resposta inesperada: %d %s", st[i], corpo[i])
		}
	}
	if ganhou != 1 {
		t.Errorf("baixas que ganharam = %d", ganhou)
	}
	if v := m.Um(t, `select count(*)::text from vessel_baixas where codigo = 'VBAAAA0002' and desfeita_em is null`); v != "1" {
		t.Errorf("baixas ativas = %s", v)
	}
}
