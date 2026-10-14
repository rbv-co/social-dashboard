package publico

import (
	"fmt"
	"strings"
	"testing"
)

const idSuperDeTeste = "a6300000-0000-4000-a000-000000000001"

// semearOMundo cria o que as leituras públicas leem (uma stylist, um encontro com convidada, um lembrete, uma conta com
// registro) PELAS funções de produção, como o super, e devolve o que NÃO pode sair em nenhuma resposta pública.
func (m *mundo) semearOMundo(t *testing.T) (segredos []string, chaveDoEncontro, chaveDaConvidada string) {
	t.Helper()
	if _, err := m.P.Exec(t.Context(), `
		insert into usuarios (id, email) values ('`+idSuperDeTeste+`', 'super@x.com');
		insert into profiles (id, email, name, role, is_superadmin, escopo_por_equipe, features, disabled)
		  values ('`+idSuperDeTeste+`', 'super@x.com', 'super', 'viewer', true, false, '{}', false);`+selo); err != nil {
		t.Fatal(err)
	}
	if _, err := m.P.Exec(t.Context(), `
		select set_config('app.usuario_id', '`+idSuperDeTeste+`', true);
		alter table vessel_pessoas alter column teste set default false;
		alter table vessel_atendimentos alter column teste set default false;
		insert into vessel_stylist_etapas (nome, ordem, tipo, conta_como_prospectada, libera_private_edit, criado_por_nome, alterado_por_nome)
		  values ('Convidado', 1, 'funil', false, true, 'm', 'm');
		insert into vessel_pracas (sigla, nome, loja_destino, ordem) values ('CPS', 'Campinas', 'iguatemi', 1);
		select vessel_stylist_criar(p_nome => 'Ana Stylist', p_whatsapp => '11999990000', p_cidade => 'Campinas', p_origem_contato => 'indicacao');
		select vessel_criar_private_edit(p_stylist => 'STY-0001', p_quando => '2027-03-01T18:00:00Z', p_local => 'Casa da Ana',
		  p_praca => 'CPS', p_loja => 'iguatemi', p_vagas => 10, p_teste => false);
		select vessel_convidar_para_encontro(p_codigo => (select codigo from vessel_private_edits limit 1), p_nome => 'Bia Convidada',
		  p_whatsapp => '11988887777', p_email => 'bia@x.com');
		select vessel_chave_da_convidada((select id from vessel_atendimentos limit 1));`); err != nil {
		t.Logf("semente do Private Edit: %v (as leituras de stylist/encontro seguem sem dado)", err)
	}
	chaveDoEncontro = m.um(t, `select coalesce(chave, '') from vessel_private_edits limit 1`)
	chaveDaConvidada = m.um(t, `select coalesce(chave_convite, '') from vessel_atendimentos limit 1`)
	// uma conta com o CPF e a senha, e um lembrete com o hash do token
	m.P.Exec(t.Context(), `insert into vessel_lembretes (peca_codigo, email, consentimento_em, token_hash) values ('VBAAAA0002', 'duda@x.com', now(), 'HASH-SECRETO-DO-LEMBRETE')`)
	m.P.Exec(t.Context(), `insert into vessel_clientes (id, nome, cpf, email, senha_hash) values ('a6300000-0000-4000-a000-0000000000c1', 'Cora Cliente', '52998224725', 'cora@x.com', 'HASH-SECRETO-DA-SENHA')`)
	return []string{"52998224725", "HASH-SECRETO-DO-LEMBRETE", "HASH-SECRETO-DA-SENHA", "duda@x.com", "cora@x.com", "11988887777", "bia@x.com"}, chaveDoEncontro, chaveDaConvidada
}

// Varredura de vazamento nas 10 leituras públicas: com argumentos de verdade e com lixo, nenhuma resposta traz CPF, hash,
// e-mail ou telefone alheio; e o detector enxerga (ele acha o telefone da convidada na função que o entrega a quem tem a
// chave dela, `vessel_convite_da_convidada`: a varredura provada não está cega).
func TestLeiturasPublicasNaoVazam(t *testing.T) {
	m := novoMundo(t)
	segredos, chaveEnc, chaveConv := m.semearOMundo(t)
	vaza := func(corpo string, ignora ...string) []string {
		var l []string
		for _, s := range segredos {
			if strings.Contains(corpo, s) && !contem(ignora, s) {
				l = append(l, s)
			}
		}
		return l
	}
	chamadas := []struct{ fn, corpo string }{
		{"vessel_visita_da_sessao", `{"p_codigo":"VBAAAA0001"}`}, {"vessel_visita_da_sessao", `{"p_codigo":"lixo"}`},
		{"vessel_pre_venda_restantes", `{}`},
		{"vessel_horarios_ocupados", `{"p_loja":"iguatemi","p_data":"2027-03-01"}`},
		{"vessel_abrir_convite", `{"p_codigo":"PE-20270301-CPS-01"}`}, {"vessel_abrir_convite", `{"p_codigo":"lixo","p_teste":true}`},
		{"vessel_leitura_do_card", fmt.Sprintf(`{"p_chave":%q}`, chaveConv)}, {"vessel_leitura_do_card", `{"p_chave":"lixo"}`},
		{"vessel_card_da_stylist", `{"p_quem":"STY-0001"}`}, {"vessel_card_da_stylist", `{"p_quem":"lixo"}`},
		{"vessel_visita_do_stylist", `{"p_codigo":"STY-0001"}`},
		{"vessel_convite_da_private_edit", fmt.Sprintf(`{"p_chave":%q}`, chaveEnc)}, {"vessel_convite_da_private_edit", `{"p_chave":"lixo"}`},
		{"vessel_convite_da_convidada", fmt.Sprintf(`{"p_chave":%q,"p_convidada":%q}`, chaveEnc, chaveConv)},
		{"vessel_convite_da_convidada", `{"p_chave":"lixo","p_convidada":"lixo"}`},
		{"vessel_verificar", `{"p_codigo":"VBAAAA0001"}`}, {"vessel_verificar", `{"p_codigo":"VBAAAA0002"}`}, {"vessel_verificar", `{"p_codigo":"lixo"}`},
	}
	for _, c := range chamadas {
		st, r, _ := m.pedido(t, "/rest/v1/rpc/"+c.fn, c.corpo)
		if st >= 500 {
			t.Errorf("%s %s = %d %.100s", c.fn, c.corpo, st, r)
		}
		// só `vessel_convite_da_convidada` (chave + convidada = prova) devolve os dados de contato de quem convidou
		if v := vaza(r); len(v) > 0 && c.fn != "vessel_convite_da_convidada" {
			t.Errorf("%s %s devolveu %v: %.200s", c.fn, c.corpo, v, r)
		}
	}
	// CONTROLE POSITIVO: a função do PAINEL que entrega o contato da convidada, chamada como o super, é pega pelo detector
	// (a semente existe de verdade e a varredura enxerga o que procura; sem isto "não achou nada" não provaria nada)
	tx, err := m.P.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(t.Context())
	var painel string
	if _, err := tx.Exec(t.Context(), `select set_config('app.usuario_id', '`+idSuperDeTeste+`', true)`); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(t.Context(), `select vessel_convidadas_do_encontro(p_codigo => (select codigo from vessel_private_edits limit 1))::text`).Scan(&painel); err != nil {
		t.Fatal(err)
	}
	if v := vaza(painel); len(v) < 2 {
		t.Fatalf("o detector não acha o contato da convidada na função do painel (%v): a varredura está cega. %.200s", v, painel)
	}
	// a chave do encontro NÃO abre o contato de convidada alheia: sem a chave da convidada, o endereço dela não sai
	_, r, _ := m.pedido(t, "/rest/v1/rpc/vessel_convite_da_private_edit", fmt.Sprintf(`{"p_chave":%q}`, chaveEnc))
	if v := vaza(r); len(v) > 0 {
		t.Errorf("a leitura do convite do encontro entrega dado de convidada: %v", v)
	}
}

func contem(l []string, s string) bool {
	for _, x := range l {
		if x == s {
			return true
		}
	}
	return false
}
