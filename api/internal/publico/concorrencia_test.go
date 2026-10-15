package publico

import (
	"fmt"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

const cpfCaio = "39053344705"

// donaEDuasCompradoras: três contas (a dona e duas que querem a peça), com sessão, e `n` peças registradas
// no nome da dona. Devolve os tokens e os ids.
func donaEDuasCompradoras(t *testing.T, m *mundo, n int) (tokens [3]string, ids [3]string) {
	t.Helper()
	logins := []struct{ nome, cpf, email string }{{"Ana Dona", cpfAna, "ana@x.com"}, {"Beto Comprador", cpfBeto, "beto@x.com"}, {"Caio Comprador", cpfCaio, "caio@x.com"}}
	for i, l := range logins {
		_, r, o := m.edge(t, "vessel-conta", criarConta(l.nome, l.cpf, l.email))
		senha, _ := o["senha"].(string)
		if senha == "" {
			t.Fatalf("criar %s = %s", l.email, r)
		}
		_, r, o = m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":%q,"senha":%q}`, l.email, senha))
		if tokens[i], _ = o["token"].(string); tokens[i] == "" {
			t.Fatalf("entrar %s = %s", l.email, r)
		}
		ids[i] = m.um(t, `select id::text from vessel_clientes where email = $1`, l.email)
	}
	if _, err := m.P.Exec(t.Context(), `insert into vessel_lotes (id, modelo, cor, quantidade, material, material_fonte)
		values ('b1000000-0000-4000-a000-000000000001', 'Linear', 'Caramelo', 50, 'canvas', 'dono')`); err != nil {
		t.Fatal(err)
	}
	for i := range n {
		if _, err := m.P.Exec(t.Context(), `insert into vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em)
			values ($1, 'b1000000-0000-4000-a000-000000000001', $2, now())`, codigoDaPeca(i), i+1); err != nil {
			t.Fatal(err)
		}
		if _, err := m.P.Exec(t.Context(), `insert into vessel_registros (codigo, nome, whatsapp, cpf, cliente_id, garantia_ate)
			values ($1, 'Ana Dona', '11999990000', $2, $3::uuid, current_date + 300)`, codigoDaPeca(i), cpfAna, ids[0]); err != nil {
			t.Fatal(err)
		}
	}
	return tokens, ids
}

// deuOk: as funções devolvem json do Postgres, com espaço antes e depois dos dois pontos.
func deuOk(r string) bool { return strings.Contains(r, `"ok" : true`) || strings.Contains(r, `"ok":true`) }

func codigoDaPeca(i int) string { return fmt.Sprintf("VBTR%04d", i) }

// Plano 03-A: duas compradoras aceitam a MESMA transferência (mesmo código de 6 dígitos) ao mesmo tempo,
// em 4 peças. Uma só leva: a peça fica no nome de quem recebeu ok:true, o convite sai como usado por ela
// e a trilha tem UMA transferência. A trava é o for no key update no registro da peça (com o gatilho de
// atraso de 50 ms no update do registro, sem ela as duas passam e a última a gravar vence).
func TestDuasAceitamAMesmaTransferenciaUmaSoLeva(t *testing.T) {
	m, _ := mundoDaConta(t)
	tokens, ids := donaEDuasCompradoras(t, m, 4)
	mundoteste.AtrasarEm(t, m.P, "vessel_registros", "update", 50)
	for i := range 4 {
		cod := codigoDaPeca(i)
		_, r, o := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"transferir-gerar","token":%q,"codigo":%q}`, tokens[0], cod))
		seis, _ := o["codigo_transferencia"].(string)
		if len(seis) != 6 {
			t.Fatalf("transferir-gerar %s = %s", cod, r)
		}
		resp := make([]string, 2)
		mundoteste.EmParalelo(2, func(l int) {
			_, resp[l], _ = m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"transferir-aceitar","token":%q,"codigo":%q,"codigo_transferencia":%q}`, tokens[1+l], cod, seis))
		})
		ganhou := -1
		for l, r := range resp {
			if deuOk(r) {
				if ganhou != -1 {
					t.Fatalf("peça %s: as duas aceitaram: %v", cod, resp)
				}
				ganhou = l
			}
		}
		if ganhou == -1 {
			t.Fatalf("peça %s: nenhuma aceitou: %v", cod, resp)
		}
		if v := m.um(t, `select cliente_id::text from vessel_registros where codigo = $1`, cod); v != ids[1+ganhou] {
			t.Errorf("peça %s: dona final %s, esperava quem recebeu ok (%s)", cod, v, ids[1+ganhou])
		}
		if v := m.um(t, `select cliente_para::text from vessel_transferencias where peca_codigo = $1 and usado_em is not null`, cod); v != ids[1+ganhou] {
			t.Errorf("peça %s: convite usado por %s, esperava %s", cod, v, ids[1+ganhou])
		}
		if v := m.um(t, `select count(*)::text from vessel_edicoes where codigo = $1 and acao = 'transferida_pela_dona'`, cod); v != "1" {
			t.Errorf("peça %s: %s linhas de trilha, esperava 1", cod, v)
		}
	}
}

// Plano 03-A: a dona gera o código de transferência 8 vezes ao mesmo tempo: todas respondem ok e existe
// UM convite vivo só (cada geração cancela o anterior). Trava: for no key update no registro (o índice
// parcial vessel_transferencias_um_aberto_idx é a rede; sem a trava, sete gerações dão erro de índice).
func TestOitoGeracoesDeTransferenciaDeixamUmConviteVivo(t *testing.T) {
	m, _ := mundoDaConta(t)
	_, ids := donaEDuasCompradoras(t, m, 1)
	mundoteste.AtrasarEm(t, m.P, "vessel_transferencias", "insert", 50)
	// uma sessão por pedido: com o mesmo token, o update de ultimo_uso_em da sessão já enfileiraria os oito
	var tokens [8]string
	for i := range tokens {
		tokens[i] = fmt.Sprintf("sessao-da-dona-%d", i)
		if _, err := m.P.Exec(t.Context(), `insert into vessel_sessoes (cliente_id, token_hash, expira_em)
			values ($1::uuid, encode(extensions.digest($2::text, 'sha256'), 'hex'), now() + interval '1 day')`, ids[0], tokens[i]); err != nil {
			t.Fatal(err)
		}
	}
	resp := make([]string, 8)
	mundoteste.EmParalelo(len(resp), func(i int) {
		_, resp[i], _ = m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"transferir-gerar","token":%q,"codigo":%q}`, tokens[i], codigoDaPeca(0)))
	})
	for i, r := range resp {
		if !deuOk(r) {
			t.Errorf("geração %d = %s, esperava ok (sem erro de índice)", i, r)
		}
	}
	if v := m.um(t, `select count(*)::text from vessel_transferencias where peca_codigo = $1 and usado_em is null and cancelado_em is null`, codigoDaPeca(0)); v != "1" {
		t.Errorf("%s convites vivos, esperava 1", v)
	}
}
