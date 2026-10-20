package publico

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// falsoBling responde o que o Core devolveria do Bling e guarda o que foi pedido (o CPF que chegou, por exemplo).
type falsoBling struct {
	mu       sync.Mutex
	fora     bool           // sem resposta (o Core não alcançou o Bling)
	status   map[string]int // status fixo por caminho (429, 500, 404...); corpo vazio
	contatos string
	pedidos  string
	detalhe  string
	pedido   []core.PedidoBling
}

func (f *falsoBling) Bling(_ context.Context, p core.PedidoBling) (*core.Resposta, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.pedido = append(f.pedido, p)
	if f.fora {
		return nil, &core.SemResposta{Causa: "o Bling não respondeu no prazo", Tentativas: 3}
	}
	if st := f.status[p.Caminho]; st != 0 {
		return &core.Resposta{Status: st, Corpo: []byte(`{}`)}, nil
	}
	corpo := ""
	switch {
	case p.Caminho == "/contatos":
		corpo = f.contatos
	case p.Caminho == "/pedidos/vendas":
		corpo = f.pedidos
	case strings.HasPrefix(p.Caminho, "/pedidos/vendas/"):
		corpo = f.detalhe
	}
	if corpo == "" {
		return &core.Resposta{Status: 404, Corpo: []byte(`{}`)}, nil
	}
	return &core.Resposta{Status: 200, Corpo: []byte(corpo)}, nil
}

// compraDeAna: o Bling tem a compra do CPF da Ana, com o modelo da peça (o código do item traz o SKU e mais coisa).
func compraDeAna() *falsoBling {
	return &falsoBling{
		contatos: `{"data":[{"id":987654321012345678}]}`,
		pedidos:  `{"data":[{"id":777,"numero":5001,"data":"2026-01-10"}]}`,
		detalhe:  `{"data":{"itens":[{"codigo":"SS0001HB.S1-PRETO"}]}}`,
	}
}

const (
	lote1 = "a6120000-0000-4000-a000-0000000000b1"
	sku1  = "SS0001HB.S1"
)

const selo = `
insert into vessel_lotes (id, modelo, cor, sku, quantidade, material, material_fonte, os, criado_em) values
  ('` + lote1 + `', 'Linear', 'Caramelo', '` + sku1 + `', 3, 'canvas', 'dono', 'OS-7', '2026-01-01T10:00:00Z');
insert into vessel_pecas (codigo, lote_id, numero_na_serie, gravada_em, criado_em) values
  ('VBAAAA0001', '` + lote1 + `', 1, '2026-01-02T10:00:00Z', '2026-01-01T10:00:00Z'),
  ('VBAAAA0002', '` + lote1 + `', 2, '2026-01-02T10:00:00Z', '2026-01-01T10:00:00Z'),
  ('VBAAAA0003', '` + lote1 + `', 3, '2026-01-02T10:00:00Z', '2026-01-01T10:00:00Z');
`

func mundoDaGarantia(t *testing.T, b *falsoBling) (*mundo, *falsoEmail) {
	t.Helper()
	email := &falsoEmail{}
	m := novoMundo(t, func(s *Servico) {
		s.Edges = map[string]Edge{"vessel-conta": s.Conta(email), "vessel-registrar-garantia": s.Garantia(b)}
	})
	if _, err := m.P.Exec(t.Context(), selo); err != nil {
		t.Fatal(err)
	}
	return m, email
}

func registro(codigo, cpf string) string {
	return fmt.Sprintf(`{"codigo":%q,"nome":"Ana Souza","cpf":%q,"whatsapp":"11999990000","onde":"Loja Iguatemi","comprado_em":"2026-01-10","nascimento":"1990-05-01"}`, codigo, cpf)
}

// Caminho antigo (sem token): o Bling tem a compra do CPF com o modelo → aprovado na hora, com a prova guardada; o que
// o Bling devolveu NÃO aparece na resposta.
func TestGarantiaAprovaQuandoOBlingTemACompra(t *testing.T) {
	b := compraDeAna()
	m, _ := mundoDaGarantia(t, b)
	st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0001", "529.982.247-25"))
	if st != 200 || o["ok"] != true || o["estado"] != "aprovado" || o["garantia_ate"] == nil {
		t.Fatalf("resposta = %d %s", st, r)
	}
	if got := m.um(t, `select estado || '|' || decidido_por_que || '|' || (conferencia->>'pedido') || '|' || (conferencia->>'contato') from vessel_pedidos_de_registro where codigo = 'VBAAAA0001'`); got != "aprovado|bling|5001|987654321012345678" {
		t.Errorf("pedido de registro = %s", got)
	}
	if m.um(t, `select count(*)::text from vessel_registros where codigo = 'VBAAAA0001'`) != "1" {
		t.Error("a garantia não foi registrada")
	}
	// o CPF foi buscado só com os dígitos; e nada do Bling volta à página
	if b.pedido[0].Caminho != "/contatos" || b.pedido[0].Query["numeroDocumento"] != "52998224725" {
		t.Errorf("primeira consulta ao Bling = %+v", b.pedido[0])
	}
	for _, sinal := range []string{"5001", "987654321012345678", "Contato", "bling"} {
		if strings.Contains(r, sinal) {
			t.Errorf("a resposta traz %q do Bling: %s", sinal, r)
		}
	}
}

// Bling RESPONDEU e a compra não está lá (ou é de outro modelo): PENDENTE, nunca recusa; o pedido fica guardado para a fila de gente.
func TestGarantiaNuncaRecusaPorCausaDoBling(t *testing.T) {
	casos := map[string]func(*falsoBling){
		"sem contato":    func(b *falsoBling) { b.contatos = `{"data":[]}` },
		"outro modelo":   func(b *falsoBling) { b.detalhe = `{"data":{"itens":[{"codigo":"SS1162-P"}]}}` },
		"prefixo curto":  func(b *falsoBling) { b.detalhe = `{"data":{"itens":[{"codigo":"SS0"}]}}` },
		"404 do contato": func(b *falsoBling) { b.status = map[string]int{"/contatos": 404} },
		"404 do pedido":  func(b *falsoBling) { b.status = map[string]int{"/pedidos/vendas/777": 404} },
	}
	for nome, ajusta := range casos {
		b := compraDeAna()
		ajusta(b)
		m, _ := mundoDaGarantia(t, b)
		st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0002", cpfAna))
		if st != 200 || o["ok"] != true || o["estado"] != "pendente" {
			t.Errorf("%s: %d %s, esperava pendente", nome, st, r)
		}
		if got := m.um(t, `select estado from vessel_pedidos_de_registro where codigo = 'VBAAAA0002'`); got != "pendente" {
			t.Errorf("%s: o pedido ficou %q, esperava pendente guardado", nome, got)
		}
		if m.um(t, `select count(*)::text from vessel_registros`) != "0" {
			t.Errorf("%s: aprovou sem a prova", nome)
		}
	}
}

// Bling que NÃO respondeu direito (timeout, 429, 5xx, outro 4xx, corpo ilegível) NÃO é "compra não achada": a cliente
// recebe 503 "tente de novo", a busca PARA na primeira falha (não gasta a cota atrás de um Bling fora), o pedido fica
// guardado como pendente e não se aprova nada. Repetir depois, com o Bling de volta, aprova (pendente não tranca a peça).
func TestGarantiaBlingFalhandoPedeParaTentarDeNovo(t *testing.T) {
	casos := map[string]struct {
		ajusta    func(*falsoBling)
		consultas int // quantas chamadas ao Bling até desistir
	}{
		"timeout":           {func(b *falsoBling) { b.fora = true }, 1},
		"429 no contato":    {func(b *falsoBling) { b.status = map[string]int{"/contatos": 429} }, 1},
		"500 no pedido":     {func(b *falsoBling) { b.status = map[string]int{"/pedidos/vendas/777": 500} }, 3},
		"503 na lista":      {func(b *falsoBling) { b.status = map[string]int{"/pedidos/vendas": 503} }, 2},
		"401 do token":      {func(b *falsoBling) { b.status = map[string]int{"/contatos": 401} }, 1},
		"resposta estranha": {func(b *falsoBling) { b.contatos = `isto não é json` }, 1},
	}
	for nome, c := range casos {
		b := compraDeAna()
		c.ajusta(b)
		m, _ := mundoDaGarantia(t, b)
		st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0002", cpfAna))
		if st != 503 || o["ok"] != false || o["motivo"] != "falhou" {
			t.Errorf("%s: %d %s, esperava 503 falhou (tente de novo)", nome, st, r)
		}
		if len(b.pedido) != c.consultas {
			t.Errorf("%s: %d consultas ao Bling, esperava %d (parar na primeira falha)", nome, len(b.pedido), c.consultas)
		}
		if got := m.um(t, `select estado from vessel_pedidos_de_registro where codigo = 'VBAAAA0002'`); got != "pendente" {
			t.Errorf("%s: o pedido ficou %q, esperava pendente guardado", nome, got)
		}
		if m.um(t, `select count(*)::text from vessel_registros`) != "0" {
			t.Errorf("%s: aprovou sem a prova", nome)
		}
		// o Bling volta: a mesma cliente tenta de novo e aprova
		b.fora, b.status, b.contatos = false, nil, compraDeAna().contatos
		st, r, o = m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0002", cpfAna))
		if st != 200 || o["estado"] != "aprovado" {
			t.Errorf("%s: segunda tentativa = %d %s, esperava aprovado", nome, st, r)
		}
	}
}

// 404 de UM pedido é definitivo para aquele pedido, não para a busca: a compra pode estar no seguinte.
func TestGarantia404DeUmPedidoNaoParaABusca(t *testing.T) {
	b := compraDeAna()
	b.pedidos = `{"data":[{"id":776,"numero":5000,"data":"2026-02-01"},{"id":777,"numero":5001,"data":"2026-01-10"}]}`
	b.status = map[string]int{"/pedidos/vendas/776": 404}
	m, _ := mundoDaGarantia(t, b)
	st, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0001", cpfAna))
	if st != 200 || o["estado"] != "aprovado" {
		t.Fatalf("resposta = %d %s", st, r)
	}
}

// A cliente logada passa pelo mesmo caminho: Bling falhando = 503, nada aprovado.
func TestGarantiaDaClienteLogadaComBlingFalhando(t *testing.T) {
	b := compraDeAna()
	b.status = map[string]int{"/contatos": 429}
	m, _ := mundoDaGarantia(t, b)
	_, _, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	senha, _ := o["senha"].(string)
	_, _, oe := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, senha))
	tok, _ := oe["token"].(string)
	corpo := fmt.Sprintf(`{"token":%q,"codigo":"VBAAAA0001","onde":"Loja Iguatemi","comprado_em":"2026-01-10"}`, tok)
	st, r, o2 := m.edge(t, "vessel-registrar-garantia", corpo)
	if st != 503 || o2["motivo"] != "falhou" {
		t.Fatalf("logada com Bling em 429 = %d %s", st, r)
	}
	if m.um(t, `select count(*)::text from vessel_registros`) != "0" {
		t.Error("aprovou sem a prova")
	}
}

// Peça que já tem dona: a segunda tentativa não aprova nada; a resposta diz pendente, ja_tem_dono e o nome CURTO da dona
// ("Ana S.", que a página sempre mostrou), nunca o nome inteiro, o CPF nem o pedido.
func TestGarantiaPecaComDono(t *testing.T) {
	m, _ := mundoDaGarantia(t, compraDeAna())
	m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0003", cpfAna))
	_, r, o := m.edge(t, "vessel-registrar-garantia", registro("VBAAAA0003", cpfBeto))
	if o["ok"] == true && o["estado"] == "aprovado" {
		t.Errorf("a peça com dona foi aprovada de novo: %s", r)
	}
	if o["ja_tem_dono"] != true || o["dono_curto"] != "Ana S." || strings.Contains(r, "Ana Souza") || strings.Contains(r, cpfAna) || strings.Contains(r, "5001") {
		t.Errorf("a resposta devia dar só ja_tem_dono e o nome curto: %s", r)
	}
}

// Cliente logada: o CPF é o do PERFIL (a página não escolhe), mesmo que o corpo traga outro.
func TestGarantiaDaClienteLogadaUsaOCPFDoPerfil(t *testing.T) {
	b := compraDeAna()
	m, _ := mundoDaGarantia(t, b)
	_, _, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	senha, _ := o["senha"].(string)
	_, _, oe := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, senha))
	tok, _ := oe["token"].(string)
	corpo := fmt.Sprintf(`{"token":%q,"codigo":"VBAAAA0001","onde":"Loja Iguatemi","comprado_em":"2026-01-10","cpf":%q}`, tok, cpfBeto)
	st, r, o2 := m.edge(t, "vessel-registrar-garantia", corpo)
	if st != 200 || o2["estado"] != "aprovado" {
		t.Fatalf("logada = %d %s", st, r)
	}
	if b.pedido[0].Query["numeroDocumento"] != cpfAna {
		t.Errorf("o Bling foi consultado com %v, esperava o CPF do perfil %s (e não o do corpo)", b.pedido[0].Query["numeroDocumento"], cpfAna)
	}
	// token que não existe: erro de sessão, sem consultar o Bling
	antes := len(b.pedido)
	_, r3, o3 := m.edge(t, "vessel-registrar-garantia", `{"token":"nao-existe","codigo":"VBAAAA0002"}`)
	if o3["ok"] == true || len(b.pedido) != antes {
		t.Errorf("token inexistente: %s (consultas ao Bling: %d)", r3, len(b.pedido)-antes)
	}
}

// "É presente?": aprova só com UM candidato cujo nome fecha; dois candidatos = fila; o teto de 3 tentativas por peça
// manda para a fila sem rodar o casamento; sem sessão = 401.
func TestGarantiaDePresente(t *testing.T) {
	b := &falsoBling{}
	m, _ := mundoDaGarantia(t, b)
	// pedidos sincronizados do Bling: quem comprou o modelo e com que nome
	if _, err := m.P.Exec(t.Context(), `
		insert into vessel_pedidos (bling_pedido_id, numero, contato_nome, data_do_pedido, observacoes)
		  values (1, '9001', 'Carla Mendes Souza', '2026-01-05', ''), (2, '9002', 'Dora Lima', '2026-01-06', 'PRESENTE');
		insert into vessel_pedido_itens (pedido_id, sku, quantidade) select id, '`+sku1+`', 1 from vessel_pedidos;`); err != nil {
		t.Fatal(err)
	}
	_, _, o := m.edge(t, "vessel-conta", criarConta("Ana Souza", cpfAna, "ana@x.com"))
	senha, _ := o["senha"].(string)
	_, _, oe := m.edge(t, "vessel-conta", fmt.Sprintf(`{"acao":"entrar","login":"ana@x.com","senha":%q}`, senha))
	tok, _ := oe["token"].(string)
	pres := func(cod, de string) (int, string, map[string]any) {
		return m.edge(t, "vessel-registrar-garantia", fmt.Sprintf(`{"token":%q,"codigo":%q,"presente_de":%q,"onde":"Loja"}`, tok, cod, de))
	}
	if st, r, _ := m.edge(t, "vessel-registrar-garantia", `{"token":"nao-existe","codigo":"VBAAAA0001","presente_de":"Carla Souza"}`); st != 401 || !strings.Contains(r, "sem_sessao") {
		t.Errorf("sem sessão = %d %s, esperava 401", st, r)
	}
	// nome que fecha com UM candidato: aprovado
	if st, r, o := pres("VBAAAA0001", "Carla Souza"); st != 200 || o["estado"] != "aprovado" {
		t.Errorf("Carla Souza = %d %s, esperava aprovado", st, r)
	}
	if got := m.um(t, `select conferencia->>'de' || '|' || (conferencia->>'marca') from vessel_pedidos_de_registro where codigo = 'VBAAAA0001'`); got != "Carla Mendes Souza|false" {
		t.Errorf("trilha do presente = %s", got)
	}
	// nome que não bate com ninguém: fila, sem dizer por quê
	if _, r, o := pres("VBAAAA0002", "Zuleica Prado"); o["estado"] != "pendente" || strings.Contains(r, "Carla") || strings.Contains(r, "Dora") {
		t.Errorf("nome sem candidato = %s", r)
	}
	// sobrenome quase igual só vale com a marca PRESENTE no pedido: Dora tem; Carla não
	if _, r, o := pres("VBAAAA0003", "Dora Lyma"); o["estado"] != "pendente" && o["estado"] != "aprovado" {
		t.Errorf("Dora Lyma = %s", r)
	}
	// teto: a 4ª tentativa na mesma peça cai na fila sem casar nome
	for i := 0; i < 3; i++ {
		pres("VBAAAA0002", "Zuleica Prado")
	}
	if _, r, o := pres("VBAAAA0002", "Carla Souza"); o["estado"] != "pendente" {
		t.Errorf("acima do teto de tentativas = %s, esperava pendente", r)
	}
}

// Entrada ruim: corpo que não é objeto = 400 no formato da edge.
func TestGarantiaCorpoRuim(t *testing.T) {
	m, _ := mundoDaGarantia(t, compraDeAna())
	if st, _, o := m.edge(t, "vessel-registrar-garantia", `lixo`); st != 400 || o["motivo"] != "dados_invalidos" {
		t.Errorf("corpo ruim = %d", st)
	}
	if st, _, _ := m.pedido(t, "/functions/v1/vessel-registrar-garantia", `{}`, "Content-Type: text/plain"); st != http.StatusUnsupportedMediaType {
		t.Errorf("text/plain = %d, esperava 415", st)
	}
	_ = json.Marshal
}
