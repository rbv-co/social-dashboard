package publico

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"
)

// falsoEmail guarda o que "saiu" e pode falhar de propósito.
type falsoEmail struct {
	mu     sync.Mutex
	falha  bool
	saidos []saido
}

type saido struct{ Para, Assunto, HTML, Texto string }

func (f *falsoEmail) Mandar(_ context.Context, para, assunto, html, texto string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.falha {
		return errors.New("zeptomail: rede")
	}
	f.saidos = append(f.saidos, saido{para, assunto, html, texto})
	return nil
}

func (f *falsoEmail) ultimo(t *testing.T) saido {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.saidos) == 0 {
		t.Fatal("nenhum e-mail saiu")
	}
	return f.saidos[len(f.saidos)-1]
}

func mundoDaConta(t *testing.T) (*mundo, *falsoEmail) {
	t.Helper()
	email := &falsoEmail{}
	m := novoMundo(t, func(s *Servico) { s.Edges = map[string]Edge{"vessel-conta": s.Conta(email)} })
	return m, email
}

// edge chama a edge e devolve status, o texto e o objeto da resposta.
func (m *mundo) edge(t *testing.T, nome, corpo string, cab ...string) (int, string, map[string]any) {
	t.Helper()
	st, r, _ := m.pedido(t, "/functions/v1/"+nome, corpo, cab...)
	var o map[string]any
	json.Unmarshal([]byte(r), &o)
	return st, r, o
}

const (
	cpfAna  = "52998224725"
	cpfBeto = "11144477735"
)

func criarConta(nome, cpf, email string) string {
	return fmt.Sprintf(`{"acao":"criar","nome":%q,"cpf":%q,"email":%q,"whatsapp":"11999990000","nascimento":"1990-05-01"}`, nome, cpf, email)
}

// O caminho da conta: criar (a senha sai por e-mail E na resposta), entrar com e-mail e com CPF, "eu", editar, sair.
func TestContaDaCliente(t *testing.T) {
	m, mail := mundoDaConta(t)
	st, r, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	if st != 200 || o["ok"] != true || o["email_mascarado"] != "a•••@x.com" {
		t.Fatalf("criar = %d %s", st, r)
	}
	senha, _ := o["senha"].(string)
	if len(senha) != 12 {
		t.Fatalf("a senha da resposta de criar: %q", senha)
	}
	e := mail.ultimo(t)
	if e.Para != "ana@x.com" || !strings.Contains(e.Texto, senha) || !strings.Contains(e.HTML, senha) || e.Assunto != "Seu acesso VESSEL" {
		t.Errorf("e-mail do primeiro acesso: %+v", e)
	}
	if m.um(t, `select count(*)::text from vessel_clientes`) != "1" {
		t.Error("a conta não nasceu")
	}
	// entrar por e-mail e por CPF; senha errada é recusada
	_, r1, o1 := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q,"lembrar":true}`, senha), "User-Agent: Navegador de Teste")
	tok, _ := o1["token"].(string)
	if o1["ok"] != true || tok == "" {
		t.Fatalf("entrar por e-mail = %s", r1)
	}
	if _, r2, o2 := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":%q,"senha":%q}`, cpfAna, senha)); o2["ok"] != true {
		t.Errorf("entrar por CPF = %s", r2)
	}
	if _, r3, o3 := m.edge(t, "vessel-conta", `{"acao":"entrar","login":"ana@x.com","senha":"errada"}`); o3["ok"] == true {
		t.Errorf("senha errada entrou: %s", r3)
	}
	// o agente e o hash do IP chegam à sessão (e o IP puro nunca é gravado)
	if got := m.um(t, `select count(*)::text from vessel_sessoes where agente = 'Navegador de Teste' and length(ip_hash) = 32 and ip_hash !~ '127'`); got != "1" {
		t.Errorf("sessão com agente e ip_hash de 32 caracteres: %s", got)
	}
	if _, rEu, oEu := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"eu","token":%q}`, tok)); oEu["ok"] != true {
		t.Errorf("eu = %s", rEu)
	}
	if _, rEd, oEd := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"editar","token":%q,"nome":"Ana Maria Souza"}`, tok)); oEd["ok"] != true {
		t.Errorf("editar = %s", rEd)
	}
	if _, rS, oS := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"sair","token":%q}`, tok)); oS["ok"] != true {
		t.Errorf("sair = %s", rS)
	}
	if _, rEu2, oEu2 := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"eu","token":%q}`, tok)); oEu2["ok"] == true {
		t.Errorf("eu depois de sair = %s", rEu2)
	}
	if _, rm, om := m.edge(t, "vessel-conta", `{"acao":"minhas-pecas","token":"nao-existe"}`); om["ok"] == true || om["motivo"] != "sem_sessao" {
		t.Errorf("minhas peças sem sessão = %s", rm)
	}
}

// E-mail que não sai: a conta é apagada, a resposta NÃO traz a senha e a cliente pode tentar de novo.
func TestEmailQueFalhaApagaAConta(t *testing.T) {
	m, mail := mundoDaConta(t)
	mail.falha = true
	_, r, o := m.edge(t, "vessel-conta", criarConta("Beto Lima", cpfBeto, "beto@x.com"))
	if o["ok"] != false || o["motivo"] != "email_nao_saiu" || strings.Contains(r, "senha") {
		t.Fatalf("criar com e-mail fora = %s", r)
	}
	if got := m.um(t, `select count(*)::text from vessel_clientes`); got != "0" {
		t.Errorf("a conta sem e-mail ficou: %s clientes", got)
	}
	mail.falha = false
	if _, r2, o2 := m.edge(t, "vessel-conta", criarConta("Beto Lima", cpfBeto, "beto@x.com")); o2["ok"] != true {
		t.Errorf("segunda tentativa = %s", r2)
	}
}

// Teto de "criar" por IP: 20/hora; o 21º vira muitas_tentativas SEM gastar e-mail; outro IP segue.
func TestTetoDeCriarPorIP(t *testing.T) {
	m, mail := mundoDaConta(t)
	for i := 0; i < 20; i++ {
		_, r, o := m.edge(t, "vessel-conta", criarConta("Pessoa Teste", "00000000000", fmt.Sprintf("p%d@x.com", i)), "X-Real-IP: 198.51.100.1")
		if o["motivo"] == "muitas_tentativas" {
			t.Fatalf("tentativa %d já estourou: %s", i+1, r)
		}
	}
	enviados := len(mail.saidos)
	if _, r, o := m.edge(t, "vessel-conta", criarConta("Pessoa Teste", cpfAna, "x@x.com"), "X-Real-IP: 198.51.100.1"); o["motivo"] != "muitas_tentativas" {
		t.Errorf("21ª tentativa = %s, esperava muitas_tentativas", r)
	}
	if len(mail.saidos) != enviados {
		t.Error("o teto estourado gastou um e-mail")
	}
	if _, r, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"), "X-Real-IP: 198.51.100.2"); o["ok"] != true {
		t.Errorf("outro IP = %s", r)
	}
}

// "esqueci": a resposta é {"ok":true} IGUAL com perfil, sem perfil e com o teto estourado; só o perfil recebe e-mail; a
// senha nova só vale depois que o e-mail saiu e nunca aparece na resposta.
func TestEsqueciNaoDizNada(t *testing.T) {
	m, mail := mundoDaConta(t)
	_, _, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	senhaAntiga, _ := o["senha"].(string)
	enviadosAntes := len(mail.saidos)

	_, rExiste, _ := m.edge(t, "vessel-conta", `{"acao":"esqueci","login":"ana@x.com"}`)
	novaSenha := ""
	if len(mail.saidos) != enviadosAntes+1 {
		t.Fatal("o e-mail da senha nova não saiu")
	}
	novaSenha = strings.TrimSpace(strings.TrimPrefix(mail.ultimo(t).Texto[strings.Index(mail.ultimo(t).Texto, "Sua senha: "):], "Sua senha: "))[:12]
	_, rNaoExiste, _ := m.edge(t, "vessel-conta", `{"acao":"esqueci","login":"ninguem@x.com"}`)
	if rExiste != `{"ok":true}` || rNaoExiste != rExiste {
		t.Errorf("respostas diferentes: com perfil %q, sem perfil %q", rExiste, rNaoExiste)
	}
	if len(mail.saidos) != enviadosAntes+1 {
		t.Error("login sem perfil mandou e-mail")
	}
	if _, r, o := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, senhaAntiga)); o["ok"] == true {
		t.Errorf("a senha antiga ainda vale depois do esqueci: %s", r)
	}
	if _, r, o := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, novaSenha)); o["ok"] != true {
		t.Errorf("a senha nova do e-mail não entra: %s", r)
	}
	// e-mail que falha: nada muda (a senha atual continua valendo) e a resposta é a mesma
	mail.falha = true
	if _, r, _ := m.edge(t, "vessel-conta", `{"acao":"esqueci","login":"ana@x.com"}`); r != `{"ok":true}` {
		t.Errorf("esqueci com e-mail fora = %s", r)
	}
	mail.falha = false
	if _, r, o := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, novaSenha)); o["ok"] != true {
		t.Errorf("a senha trocou apesar de o e-mail não ter saído: %s", r)
	}
}

// Teto de "esqueci" por IP (10/hora): estourado, a resposta continua {"ok":true} e o banco nem é tocado.
func TestEsqueciComTetoEstouradoRespondeIgual(t *testing.T) {
	m, mail := mundoDaConta(t)
	m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	base := len(mail.saidos)
	for i := 0; i < 12; i++ {
		if _, r, _ := m.edge(t, "vessel-conta", `{"acao":"esqueci","login":"ana@x.com"}`, "X-Real-IP: 198.51.100.9"); r != `{"ok":true}` {
			t.Fatalf("esqueci %d = %s", i+1, r)
		}
	}
	// o teto do banco (3/hora por perfil) e o do IP (10/hora) limitam os e-mails: nunca 12
	if got := len(mail.saidos) - base; got > 3 {
		t.Errorf("%d e-mails de senha nova numa hora: o teto não segurou", got)
	}
}

// Varredura de vazamento: a senha só aparece na resposta do `criar` que deu certo; nenhuma outra ação, em caso nenhum,
// devolve senha, hash ou token alheio, e nem CPF inteiro.
func TestSenhaSoNoCriar(t *testing.T) {
	m, _ := mundoDaConta(t)
	_, _, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	senha, _ := o["senha"].(string)
	_, _, oe := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, senha))
	tok, _ := oe["token"].(string)
	hashDaSenha := m.um(t, `select senha_hash from vessel_clientes limit 1`)
	hashDoToken := m.um(t, `select coalesce((select token_hash from vessel_sessoes limit 1), 'sem-hash')`)
	for _, c := range []string{
		fmt.Sprintf(`{"acao":"eu","token":%q}`, tok), fmt.Sprintf(`{"acao":"minhas-pecas","token":%q}`, tok),
		fmt.Sprintf(`{"acao":"editar","token":%q,"nome":"Ana S."}`, tok), `{"acao":"esqueci","login":"ana@x.com"}`,
		fmt.Sprintf(`{"acao":"entrar","login":%q,"senha":%q}`, cpfAna, senha),
		fmt.Sprintf(`{"acao":"lembrete-criar","codigo":"X","email":"ana@x.com","token":%q,"consentimento":true}`, tok),
		`{"acao":"lembrete-parar","token_lembrete":"qualquer"}`, `{"acao":"transferir-aberta","token":"x","codigo":"X"}`,
	} {
		_, r, _ := m.edge(t, "vessel-conta", c)
		for _, segredo := range []string{senha, hashDaSenha, hashDoToken, cpfAna} {
			if segredo != "" && strings.Contains(r, segredo) {
				t.Errorf("%s devolveu um segredo (%.12s…): %s", c[:20], segredo, r)
			}
		}
		if strings.Contains(r, `"senha"`) && !strings.Contains(c, `"entrar"`) {
			t.Errorf("a resposta de %s traz o campo senha: %s", c[:20], r)
		}
	}
	// "criar" que falha por dado ruim (CPF inválido) não traz senha
	if _, r, _ := m.edge(t, "vessel-conta", criarConta("Zé", "123", "ze@x.com")); strings.Contains(r, `"senha"`) {
		t.Errorf("criar recusado devolveu senha: %s", r)
	}
}

// Lembrete: a resposta de "parar" é a mesma com token certo, errado ou vazio; e sem token também.
func TestLembretePararNaoTestaToken(t *testing.T) {
	m, _ := mundoDaConta(t)
	var vistas = map[string]bool{}
	for _, c := range []string{`{"acao":"lembrete-parar","token_lembrete":"errado"}`, `{"acao":"lembrete-parar","token_lembrete":""}`,
		`{"acao":"lembrete-parar"}`, `{"acao":"lembrete-parar","token_lembrete":null}`} {
		_, r, _ := m.edge(t, "vessel-conta", c)
		vistas[r] = true
	}
	if len(vistas) != 1 {
		t.Errorf("respostas diferentes para token errado/vazio/ausente: %v", vistas)
	}
}

// Entrada ruim: sem ação / ação desconhecida / não-JSON = 400 no formato da edge.
func TestContaEntradaRuim(t *testing.T) {
	m, _ := mundoDaConta(t)
	for corpo, motivo := range map[string]string{`{}`: "dados_invalidos", `{"acao":""}`: "dados_invalidos", `[1]`: "dados_invalidos", `{"acao":"voar"}`: "acao_desconhecida"} {
		if st, r, o := m.edge(t, "vessel-conta", corpo); st != 400 || o["motivo"] != motivo {
			t.Errorf("%s = %d %s, esperava 400 %s", corpo, st, r, motivo)
		}
	}
	if st, _, _ := m.pedido(t, "/functions/v1/outra-edge", `{}`); st != 404 {
		t.Errorf("edge fora da lista = %d, esperava 404", st)
	}
}
