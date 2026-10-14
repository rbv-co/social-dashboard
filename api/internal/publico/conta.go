package publico

import (
	"encoding/json"
	"net/http"
)

// Conta é a edge vessel-conta (supabase/functions/vessel-conta/index.ts): a porta das contas da cliente (Registered
// Pieces). As funções vessel_conta_* não são da anon: só esta rota as chama, com a chave de serviço.
//
// A SENHA GERADA SAI POR E-MAIL SEMPRE, e na tela SÓ NA CRIAÇÃO QUE DEU CERTO (pedido do dono, 18/09/2026). "esqueci"
// continua SÓ por e-mail: o e-mail é a prova de quem é. Teste: nenhuma outra resposta traz a senha.
func (s *Servico) Conta(m Mailer) Edge {
	return func(w http.ResponseWriter, r *http.Request, ip string, _ bool) {
		corpo := leCorpoDaEdge(w, r)
		acao := corpo.texto("acao")
		if corpo == nil || acao == "" {
			responder(w, http.StatusBadRequest, map[string]any{"ok": false, "motivo": "dados_invalidos"})
			return
		}
		c := s.chamadas(r, ip)
		ipHash := s.hashDoIP(ip)
		falhou := map[string]any{"ok": false, "motivo": "falhou"}
		// repassa: a resposta da função como veio; erro de infraestrutura ou null = a resposta padrão da ação
		repassa := func(nome string, args map[string]json.RawMessage, padrao any) {
			saida, err := c.chamar(nome, args)
			switch {
			case err != nil:
				responder(w, http.StatusOK, falhou)
			case saida == nil:
				responder(w, http.StatusOK, padrao)
			default:
				responder(w, http.StatusOK, saida)
			}
		}

		switch acao {
		case "criar":
			// TETO ANTES DE TUDO e antes de gastar um e-mail: 20/hora por IP e 500/hora no total (disjuntor)
			if !c.dentroDoTeto("teto:criar:ip:"+ipHash, 20, 3600) || !c.dentroDoTeto("teto:criar:global", 500, 3600) {
				responder(w, http.StatusOK, map[string]any{"ok": false, "motivo": "muitas_tentativas"})
				return
			}
			senha := gerarSenha()
			saida, err := c.chamar("vessel_conta_criar", map[string]json.RawMessage{
				"p_nome": corpo.bruto("nome"), "p_cpf": corpo.bruto("cpf"), "p_email": corpo.bruto("email"),
				"p_whatsapp": corpo.ouNulo("whatsapp"), "p_nascimento": corpo.ouNulo("nascimento"), "p_senha": lit(senha),
			})
			if err != nil {
				responder(w, http.StatusOK, falhou)
				return
			}
			data := objeto(saida)
			if data == nil {
				responder(w, http.StatusOK, falhou)
				return
			}
			if data["ok"] != true {
				responder(w, http.StatusOK, saida)
				return
			}
			email, _ := data["email"].(string)
			txt := textoDoPrimeiroAcesso(corpo.texto("nome"), senha)
			if m.Mandar(r.Context(), email, txt.Assunto, txt.HTML, txt.Texto) != nil {
				// E-MAIL QUE NÃO SAI deixaria a cliente com perfil e sem senha: a conta é apagada e ela tenta de novo
				if _, err := c.chamar("vessel_conta_apagar_recem_criada", map[string]json.RawMessage{"p_cliente_id": lit(data["cliente_id"])}); err != nil {
					// o erro já foi logado por chamar
					_ = err
				}
				responder(w, http.StatusOK, map[string]any{"ok": false, "motivo": "email_nao_saiu"})
				return
			}
			// A ÚNICA resposta com a senha: conta criada E e-mail entregue ao ZeptoMail
			responder(w, http.StatusOK, map[string]any{"ok": true, "email_mascarado": mascararEmail(email), "senha": senha})

		case "entrar":
			if !c.dentroDoTeto("teto:entrar:ip:"+ipHash, 60, 3600) {
				responder(w, http.StatusOK, map[string]any{"ok": false, "motivo": "muitas_tentativas"})
				return
			}
			repassa("vessel_conta_entrar", map[string]json.RawMessage{
				"p_login": corpo.bruto("login"), "p_senha": corpo.bruto("senha"), "p_lembrar": lit(corpo.ehTrue("lembrar")),
				"p_agente": lit(r.UserAgent()), "p_ip_hash": lit(ipHash),
			}, falhou)

		case "eu":
			repassa("vessel_conta_da_sessao", map[string]json.RawMessage{"p_token": corpo.bruto("token")}, map[string]any{"ok": false})

		case "sair":
			repassa("vessel_conta_sair", map[string]json.RawMessage{"p_token": corpo.bruto("token"), "p_todas": lit(corpo.ehTrue("todas"))}, map[string]any{"ok": true})

		case "esqueci":
			// ORDEM INVERTIDA (achado C4): primeiro só se PERGUNTA para onde mandar (e o banco confere o teto de 3/hora);
			// a senha só é trocada DEPOIS que o e-mail sai. A resposta é {ok:true} IGUAL existindo ou não o perfil e
			// estourando ou não o teto: nenhum sinal diferente na tela.
			if !c.dentroDoTeto("teto:esqueci:ip:"+ipHash, 10, 3600) {
				responder(w, http.StatusOK, map[string]any{"ok": true})
				return
			}
			saida, err := c.chamar("vessel_conta_pedido_de_nova_senha", map[string]json.RawMessage{"p_login": corpo.bruto("login")})
			if err != nil {
				responder(w, http.StatusOK, falhou)
				return
			}
			if data := objeto(saida); data != nil && data["ok"] == true && data["cliente_id"] != nil && data["cliente_id"] != "" {
				senha := gerarSenha()
				email, _ := data["email"].(string)
				txt := textoDaSenhaNova(senha)
				// SÓ EFETIVA SE O E-MAIL SAIU: a senha antiga continua valendo e ela pode tentar de novo
				if m.Mandar(r.Context(), email, txt.Assunto, txt.HTML, txt.Texto) == nil {
					c.chamar("vessel_conta_efetivar_nova_senha", map[string]json.RawMessage{"p_cliente_id": lit(data["cliente_id"]), "p_senha": lit(senha)})
				}
			}
			responder(w, http.StatusOK, map[string]any{"ok": true})

		case "editar":
			repassa("vessel_conta_editar", map[string]json.RawMessage{
				"p_token": corpo.bruto("token"), "p_nome": corpo.ouNulo("nome"), "p_whatsapp": corpo.ouNulo("whatsapp"),
				"p_senha_atual": corpo.ouNulo("senha_atual"), "p_senha_nova": corpo.ouNulo("senha_nova"),
			}, falhou)

		case "minhas-pecas":
			repassa("vessel_minhas_pecas", map[string]json.RawMessage{"p_token": corpo.bruto("token")}, falhou)

		// TRANSFERÊNCIA DE PROPRIEDADE: a edge não decide nada; o código de 6 dígitos nunca vai para log e sai numa
		// resposta só (a de sucesso de transferir-gerar).
		case "transferir-gerar":
			repassa("vessel_transferencia_gerar", map[string]json.RawMessage{"p_token": corpo.bruto("token"), "p_codigo": corpo.bruto("codigo")}, falhou)
		case "transferir-aberta":
			repassa("vessel_transferencia_aberta", map[string]json.RawMessage{"p_token": corpo.bruto("token"), "p_codigo": corpo.bruto("codigo")}, falhou)
		case "transferir-cancelar":
			repassa("vessel_transferencia_cancelar", map[string]json.RawMessage{"p_token": corpo.bruto("token"), "p_codigo": corpo.bruto("codigo")}, falhou)
		case "transferir-aceitar":
			repassa("vessel_transferencia_aceitar", map[string]json.RawMessage{
				"p_token": corpo.bruto("token"), "p_codigo": corpo.bruto("codigo"), "p_codigo_transferencia": corpo.bruto("codigo_transferencia")}, falhou)

		// DEIXAR PARA DEPOIS: funciona SEM sessão (o token é opcional); a edge não inventa motivo nenhum.
		case "lembrete-criar":
			repassa("vessel_lembrete_criar", map[string]json.RawMessage{
				"p_codigo": corpo.bruto("codigo"), "p_email": corpo.bruto("email"), "p_token_opcional": corpo.ouNulo("token"),
				"p_consentimento": lit(corpo.ehTrue("consentimento")),
			}, falhou)

		// PARAR DE RECEBER: a única ação sem sessão; o campo é `token_lembrete` (nunca `token`, que é o de sessão);
		// a resposta é a mesma com token certo, errado ou vazio.
		case "lembrete-parar":
			repassa("vessel_lembrete_cancelar_por_token", map[string]json.RawMessage{"p_token": corpo.ouNulo("token_lembrete")}, map[string]any{"ok": true})

		default:
			responder(w, http.StatusBadRequest, map[string]any{"ok": false, "motivo": "acao_desconhecida"})
		}
	}
}
