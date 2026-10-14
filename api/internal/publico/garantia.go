package publico

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"regexp"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// LeitorDoBling lê o Bling pelo proxy do Core (internal/core.Cliente). Só GET: a página NUNCA escreve no Bling.
type LeitorDoBling interface {
	Bling(ctx context.Context, p core.PedidoBling) (*core.Resposta, error)
}

// Garantia é a edge vessel-registrar-garantia (supabase/functions/vessel-registrar-garantia/index.ts): a porta da
// garantia. A prova de que a bolsa é da pessoa é TER COMPRADO, e ela está no Bling.
//
// QUALQUER FALHA DAQUI PRA FRENTE DEIXA PENDENTE, NUNCA RECUSA: Bling fora do ar, resposta estranha, o pedido da cliente
// já está guardado e cai na fila de gente. NADA DO BLING VOLTA PARA A PÁGINA: a resposta diz "aprovado" ou "pendente".
// Três entradas: "É presente?" (`presente_de`), cliente logada (`token`) e o caminho antigo, sem token (a página no ar
// de hoje depende dele; é tratado como era, inclusive na resposta quando a aprovação não passa).
func (s *Servico) Garantia(b LeitorDoBling) Edge {
	return func(w http.ResponseWriter, r *http.Request, ip string, _ bool) {
		corpo := leCorpoDaEdge(w, r)
		if corpo == nil {
			responder(w, http.StatusBadRequest, map[string]any{"ok": false, "motivo": "dados_invalidos"})
			return
		}
		c := s.chamadas(r, ip)
		g := &garantia{c: c, b: b, ctx: r.Context()}
		falhou := map[string]any{"ok": false, "motivo": "falhou"}

		// "É PRESENTE?": a compra está no CPF de quem deu; só aprova com UM candidato cujo nome fecha.
		if corpo.verdadeiro("presente_de") {
			saida, err := c.chamar("vessel_conta_da_sessao", map[string]json.RawMessage{"p_token": corpo.bruto("token")})
			if err != nil {
				responder(w, http.StatusOK, falhou)
				return
			}
			if sessao := objeto(saida); sessao == nil || sessao["ok"] != true {
				responder(w, http.StatusUnauthorized, map[string]any{"ok": false, "motivo": "sem_sessao"})
				return
			}
			saida, err = c.chamar("vessel_registrar_como_cliente", map[string]json.RawMessage{
				"p_token": corpo.bruto("token"), "p_codigo": corpo.bruto("codigo"), "p_onde": corpo.ouNulo("onde"),
				"p_comprado_em": corpo.ouNulo("comprado_em"), "p_so_teste": lit(corpo.ehTrue("so_teste")),
				"p_presente_de_nome": corpo.bruto("presente_de"),
			})
			if err != nil {
				responder(w, http.StatusOK, falhou)
				return
			}
			aberto := objeto(saida)
			if aberto == nil || aberto["ok"] != true {
				if aberto == nil {
					aberto = map[string]any{"ok": false}
				}
				responder(w, http.StatusOK, aberto)
				return
			}
			// TETO DE TENTATIVAS no banco (3 por peça a cada 24h), ANTES de buscar candidatos: estourado, a resposta é
			// SEMPRE pendente e o casamento de nome nem roda (não calcular, para não haver como vazar o resultado).
			saida, err = c.chamar("vessel_tentativa_de_presente", map[string]json.RawMessage{"p_codigo": corpo.bruto("codigo")})
			if t := objeto(saida); err != nil || t == nil || t["permitido"] != true {
				responder(w, http.StatusOK, pendente(aberto))
				return
			}
			saida, err = c.chamar("vessel_candidatos_de_presente", map[string]json.RawMessage{"p_sku": lit(aberto["sku"])})
			if err != nil {
				responder(w, http.StatusOK, pendente(aberto))
				return
			}
			var candidatos []map[string]any
			json.Unmarshal(saida, &candidatos)
			digitado := corpo.texto("presente_de")
			var bons []map[string]any
			for _, cand := range candidatos {
				nome, _ := cand["contato_nome"].(string)
				// a regra frouxa só entra quando o PRÓPRIO pedido do Bling traz a marca "presente"
				if nomesBatem(digitado, nome) || (cand["tem_marca"] == true && nomesChegamPerto(digitado, nome)) {
					bons = append(bons, cand)
				}
			}
			if len(bons) != 1 { // MAIS DE UM CANDIDATO = FILA: nunca "o mais provável"
				responder(w, http.StatusOK, pendente(aberto))
				return
			}
			// `p_quem_decidiu` é 'bling' (a função só aceita 'bling' ou 'na_mao'); quem distingue o presente é a conferência
			conf := map[string]any{"pedido": bons[0]["bling_pedido"], "de": bons[0]["contato_nome"], "marca": bons[0]["tem_marca"] == true}
			responder(w, http.StatusOK, g.decidir(aberto, conf, pendente(aberto)))
			return
		}

		// REGISTRO NORMAL, ESTANDO LOGADA
		if corpo.verdadeiro("token") {
			saida, err := c.chamar("vessel_registrar_como_cliente", map[string]json.RawMessage{
				"p_token": corpo.bruto("token"), "p_codigo": corpo.bruto("codigo"), "p_onde": corpo.ouNulo("onde"),
				"p_comprado_em": corpo.ouNulo("comprado_em"), "p_so_teste": lit(corpo.ehTrue("so_teste")),
			})
			if err != nil {
				responder(w, http.StatusInternalServerError, falhou)
				return
			}
			aberto := objeto(saida)
			if aberto == nil || aberto["ok"] != true {
				if aberto == nil {
					aberto = map[string]any{"ok": false}
				}
				responder(w, http.StatusOK, aberto)
				return
			}
			// O CPF NÃO VEM NO CORPO: é o do PERFIL da sessão, lido direto da tabela (vessel_conta_da_sessao só devolve os
			// 2 últimos dígitos). Nunca volta para a página.
			var cpf string
			if err := s.Pool.QueryRow(r.Context(), `select cpf from vessel_clientes where id = $1::uuid`, fmt.Sprint(aberto["cliente_id"])).Scan(&cpf); err != nil || cpf == "" {
				responder(w, http.StatusOK, pendente(aberto))
				return
			}
			responder(w, http.StatusOK, g.decidirPeloBling(aberto, cpf, pendente(aberto)))
			return
		}

		// CAMINHO ANTIGO (sem token)
		saida, err := c.chamar("vessel_abrir_pedido_de_registro", map[string]json.RawMessage{
			"p_codigo": corpo.bruto("codigo"), "p_nome": corpo.bruto("nome"), "p_cpf": corpo.bruto("cpf"), "p_whatsapp": corpo.bruto("whatsapp"),
			"p_onde": corpo.ouNulo("onde"), "p_comprado_em": corpo.ouNulo("comprado_em"), "p_nascimento": corpo.ouNulo("nascimento"),
		})
		if err != nil {
			responder(w, http.StatusInternalServerError, map[string]any{"ok": false, "motivo": "falha_ao_guardar"})
			return
		}
		aberto := objeto(saida)
		if aberto == nil || aberto["ok"] != true {
			if saida == nil {
				saida = json.RawMessage("null")
			}
			responder(w, http.StatusOK, saida)
			return
		}
		// quando a aprovação não passa, este caminho sempre respondeu ja_tem_dono: true (paridade; o de cima usa o valor real)
		retorno := map[string]any{"ok": true, "estado": "pendente", "ja_tem_dono": true, "dono_curto": aberto["dono_curto"]}
		responder(w, http.StatusOK, g.decidirPeloBling(aberto, corpo.texto("cpf"), retorno))
	}
}

// pendente: a resposta de "estamos conferindo": o pedido está guardado e uma pessoa decide.
func pendente(aberto map[string]any) map[string]any {
	return map[string]any{"ok": true, "estado": "pendente", "ja_tem_dono": aberto["ja_tem_dono"] == true, "dono_curto": aberto["dono_curto"]}
}

type garantia struct {
	c   *chamadasDoBanco
	b   LeitorDoBling
	ctx context.Context
}

// decidir aprova (palavra do Bling: só o servidor diz 'bling') guardando a prova junto; se a função errar ou recusar,
// devolve `senao`.
func (g *garantia) decidir(aberto map[string]any, conferencia any, senao any) any {
	saida, err := g.c.chamar("vessel_decidir_pedido_de_registro", map[string]json.RawMessage{
		"p_pedido": lit(aberto["pedido"]), "p_estado": lit("aprovado"), "p_quem_decidiu": lit("bling"),
		"p_conferencia": lit(conferencia), "p_motivo": json.RawMessage("null"),
	})
	decidido := objeto(saida)
	if err != nil || decidido == nil || decidido["ok"] != true {
		return senao
	}
	return map[string]any{"ok": true, "estado": "aprovado", "garantia_ate": decidido["garantia_ate"]}
}

// decidirPeloBling: procura a compra daquele CPF com o modelo da peça; achou = aprova, não achou = `senao`.
func (g *garantia) decidirPeloBling(aberto map[string]any, cpf string, senao any) any {
	a := g.procurarACompra(onlyDigits(cpf), fmt.Sprint(valorOu(aberto["sku"], "")))
	if a == nil {
		return pendente(aberto)
	}
	return g.decidir(aberto, a, senao)
}

func valorOu(v any, padrao string) any {
	if v == nil {
		return padrao
	}
	return v
}

var reNaoDigito = regexp.MustCompile(`\D`)

func onlyDigits(s string) string { return reNaoDigito.ReplaceAllString(s, "") }

type compra struct {
	Pedido  string  `json:"pedido"`
	Contato string  `json:"contato"`
	Quando  *string `json:"quando"`
}

// lerBling: GET no Bling pelo Core; qualquer coisa fora de 2xx (ou sem resposta) = nil, e quem chama segue ou desiste.
func (g *garantia) lerBling(caminho string, query map[string]any) map[string]any {
	r, err := g.b.Bling(g.ctx, core.PedidoBling{Metodo: http.MethodGet, Caminho: caminho, Query: query})
	if err != nil || r == nil || r.Status < 200 || r.Status > 299 {
		return nil
	}
	var m map[string]any
	dec := json.NewDecoder(bytes.NewReader(r.Corpo))
	dec.UseNumber() // ids do Bling passam de 2^53 em alguns cadastros: nunca float64
	if dec.Decode(&m) != nil {
		return nil
	}
	return m
}

func texto(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case json.Number:
		return x.String()
	}
	return fmt.Sprint(v)
}

// procurarACompra: contato pelo CPF (até 5: o mesmo CPF duplicado no ERP), seus pedidos do mais novo ao mais antigo (até
// 20, para a página não ficar pendurada em cliente de cinquenta pedidos) e, no pedido, um item do modelo da bolsa.
func (g *garantia) procurarACompra(cpf, sku string) *compra {
	contatos, _ := g.lerBling("/contatos", map[string]any{"numeroDocumento": cpf})["data"].([]any)
	for i, c := range contatos {
		if i >= 5 {
			break
		}
		contato, _ := c.(map[string]any)
		idContato := texto(contato["id"])
		pedidos, _ := g.lerBling("/pedidos/vendas", map[string]any{"idContato": idContato, "limite": 50})["data"].([]any)
		for j, p := range pedidos {
			if j >= 20 {
				break
			}
			ped, _ := p.(map[string]any)
			det, _ := g.lerBling("/pedidos/vendas/"+url.PathEscape(texto(ped["id"])), nil)["data"].(map[string]any)
			itens, _ := det["itens"].([]any)
			for _, it := range itens {
				item, _ := it.(map[string]any)
				if casaComOSku(texto(item["codigo"]), sku) {
					numero := texto(ped["numero"])
					if numero == "" {
						numero = texto(ped["id"])
					}
					var quando *string
					if q, ok := ped["data"].(string); ok {
						quando = &q
					}
					return &compra{Pedido: numero, Contato: idContato, Quando: quando}
				}
			}
		}
	}
	return nil
}
