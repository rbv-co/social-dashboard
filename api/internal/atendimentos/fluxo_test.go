package atendimentos

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// passo chama a RPC como `quem` e devolve o json (objeto ou lista). Sempre HTTP 200 aqui: recusa de portão tem teste próprio.
func passo(t *testing.T, m *mundoteste.Mundo, quem, fn, corpo string) any {
	t.Helper()
	st, resp := m.Pedir(t, quem, "POST", "/rpc/"+fn, corpo)
	if st != 200 {
		t.Fatalf("%s %s = %d %.300s", fn, corpo, st, resp)
	}
	var v any
	if err := json.Unmarshal([]byte(resp), &v); err != nil {
		t.Fatalf("%s: %v (%.200s)", fn, err, resp)
	}
	return v
}

// deu: o passo respondeu {"ok": true, "situacao": quer} (quer "" = qualquer situação ok).
func deu(t *testing.T, m *mundoteste.Mundo, quem, fn, corpo, quer string) map[string]any {
	t.Helper()
	o, _ := passo(t, m, quem, fn, corpo).(map[string]any)
	if o["ok"] != true || (quer != "" && o["situacao"] != quer) {
		t.Fatalf("%s %s = %v, esperava ok %s", fn, corpo, o, quer)
	}
	return o
}

func asList(v any) []any {
	l, _ := v.([]any)
	return l
}

func lista(t *testing.T, m *mundoteste.Mundo, quem, fn, corpo string) []any {
	t.Helper()
	l, ok := passo(t, m, quem, fn, corpo).([]any)
	if !ok {
		t.Fatalf("%s %s: não é lista", fn, corpo)
	}
	return l
}

// O funil da stylist de ponta a ponta, pelo HTTP, como a pessoa que edita o Stylist Circle: cadastro, avaliação,
// contato, mudança de etapa (com o histórico que o gatilho grava), desativar e reativar; depois a configuração do funil
// (etapa e motivo de saída). Cada gravação é lida de volta.
func TestFunilDaStylist(t *testing.T) {
	m := novoMundo(t)
	const q = "editar:" + circle
	o := deu(t, m, q, "vessel_stylist_criar", `{"p_nome":"Carla Stylist","p_whatsapp":"19977770000","p_origem_contato":"evento","p_praca":"SAO"}`, "ok")
	cod, _ := o["codigo"].(string)
	if cod != "STY-0002" {
		t.Fatalf("código = %q, esperava STY-0002 (a semente fez a 0001)", cod)
	}
	deu(t, m, q, "vessel_stylist_mover_de_etapa", `{"p_codigo":"`+cod+`","p_etapa_id":3}`, "")
	deu(t, m, q, "vessel_stylist_registrar_contato", `{"p_codigo":"`+cod+`","p_canal":"ligacao","p_resultado":"interesse","p_nota":"gostou","p_proxima_acao":"mandar o catálogo","p_proxima_acao_em":"2027-01-10"}`, "")
	deu(t, m, q, "vessel_stylist_avaliar", `{"p_codigo":"`+cod+`","p_carteira":5,"p_portfolio":4,"p_mobilizacao":4,"p_acesso":5,"p_confiabilidade":5}`, "ok")
	if h := lista(t, m, q, "vessel_stylist_historico_de_etapas", `{"p_codigo":"`+cod+`"}`); len(h) != 2 {
		t.Errorf("histórico de etapas = %d linhas, esperava 2 (cadastro e a mudança)", len(h))
	}
	if c := lista(t, m, q, "vessel_stylist_contatos", `{"p_codigo":"`+cod+`"}`); len(c) != 1 {
		t.Errorf("contatos = %d, esperava 1", len(c))
	}
	if ql := lista(t, m, q, "vessel_stylist_qualificacoes", `{"p_codigo":"`+cod+`"}`); len(ql) != 1 {
		t.Errorf("qualificações = %d, esperava 1", len(ql))
	}
	deu(t, m, q, "vessel_stylist_editar", `{"p_codigo":"`+cod+`","p_cidade":"São Paulo"}`, "")
	deu(t, m, q, "vessel_stylist_desativar", `{"p_codigo":"`+cod+`"}`, "ok")
	if n := m.Um(t, `select ativa::text from vessel_stylists where codigo = $1`, cod); n != "false" {
		t.Errorf("ativa = %s depois de desativar", n)
	}
	if r := m.Um(t, `select count(*)::text from vessel_stylists where codigo = $1`, cod); r != "1" {
		t.Errorf("desativar apagou a stylist")
	}
	deu(t, m, q, "vessel_stylist_desativar", `{"p_codigo":"`+cod+`","p_ativa":true}`, "ok")

	// configuração do funil
	e := deu(t, m, q, "vessel_stylist_etapa_criar", `{"p_nome":"Pausa","p_posicao":3,"p_tipo":"funil"}`, "")
	id := fmt.Sprint(e["id"])
	deu(t, m, q, "vessel_stylist_etapa_renomear", `{"p_id":`+id+`,"p_nome":"Em pausa"}`, "")
	deu(t, m, q, "vessel_stylist_etapa_liberar_private_edit", `{"p_id":`+id+`,"p_libera":true}`, "")
	deu(t, m, q, "vessel_stylist_etapa_marcar_prospectada", `{"p_id":`+id+`}`, "")
	deu(t, m, q, "vessel_stylist_etapa_mover", `{"p_id":`+id+`,"p_direcao":"subir"}`, "")
	mo := deu(t, m, q, "vessel_stylist_motivo_criar", `{"p_etapa_id":7,"p_nome":"Sem interesse","p_exige_nota":false}`, "")
	mid := fmt.Sprint(mo["id"])
	deu(t, m, q, "vessel_stylist_motivo_renomear", `{"p_id":`+mid+`,"p_nome":"Não quis"}`, "")
	deu(t, m, q, "vessel_stylist_motivo_exigir_nota", `{"p_id":`+mid+`,"p_exige":true}`, "")
	deu(t, m, q, "vessel_stylist_motivo_criar", `{"p_etapa_id":7,"p_nome":"Voltou atrás","p_exige_nota":false}`, "")
	deu(t, m, q, "vessel_stylist_motivo_mover", `{"p_id":`+mid+`,"p_direcao":"descer"}`, "")
	deu(t, m, q, "vessel_stylist_motivo_ativar", `{"p_id":`+mid+`,"p_ativo":false}`, "")
	if et := lista(t, m, q, "vessel_stylist_etapas", `{}`); len(et) != 8 {
		t.Errorf("etapas = %d, esperava 8 (7 da semente + Em pausa)", len(et))
	}
	// o motivo não se apaga (gatilho de produção): nenhuma RPC apaga; o gatilho barra o delete direto
	if _, err := m.P.Exec(t.Context(), `delete from vessel_stylist_motivos_de_saida`); err == nil {
		t.Error("o gatilho vessel_stylist_motivos_de_saida_nao_se_apaga não barrou o delete")
	}
}

// Duas pessoas cadastrando stylists ao mesmo tempo: nenhum 5xx, códigos todos diferentes (sem pular nem repetir).
func TestCadastroSimultaneoDeStylists(t *testing.T) {
	m := novoMundo(t)
	const n = 8
	var wg sync.WaitGroup
	codigos := make([]string, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, resp := m.Pedir(t, "editar:"+circle, "POST", "/rpc/vessel_stylist_criar",
				fmt.Sprintf(`{"p_nome":"Stylist %d","p_whatsapp":"1999000000%d","p_origem_contato":"inbound"}`, i, i))
			var o map[string]any
			json.Unmarshal([]byte(resp), &o)
			if st != 200 || o["ok"] != true {
				t.Errorf("cadastro %d = %d %.200s", i, st, resp)
				return
			}
			codigos[i], _ = o["codigo"].(string)
		}()
	}
	wg.Wait()
	vistos := map[string]bool{}
	for _, c := range codigos {
		if c == "" || vistos[c] {
			t.Errorf("código vazio ou repetido: %v", codigos)
		}
		vistos[c] = true
	}
	if got := m.Um(t, `select count(*)::text from vessel_stylists`); got != fmt.Sprint(n+1) {
		t.Errorf("stylists = %s, esperava %d", got, n+1)
	}
}

// Private Edit e convites: criar (só com stylist liberada), sobreposição de agenda avisada, convidar duas vezes é
// idempotente, marcar o convite, mudar a situação, arquivar e apagar.
func TestPrivateEditEConvites(t *testing.T) {
	m := novoMundo(t)
	const q = "editar:" + privateEdit
	// stylist da semente (STY-0001) está liberada; outra, em "Identificado", não
	deu(t, m, "editar:"+circle, "vessel_stylist_criar", `{"p_nome":"Dani","p_whatsapp":"19966660000","p_origem_contato":"pesquisa"}`, "ok")
	r, _ := passo(t, m, q, "vessel_criar_private_edit", `{"p_stylist":"STY-0002","p_quando":"2027-04-01T18:00:00Z","p_local":"Casa","p_praca":"CPS","p_loja":"iguatemi","p_vagas":8,"p_teste":false}`).(map[string]any)
	if r["ok"] != false || r["situacao"] != "stylist_nao_liberada" {
		t.Errorf("stylist fora de etapa liberada = %v, esperava recusa stylist_nao_liberada", r)
	}
	// o mesmo horário e lugar da semente: pede confirmação
	// o mesmo horário e loja do encontro da semente: a leitura aponta o encontro que sobrepõe
	if so, _ := passo(t, m, q, "vessel_private_edit_sobreposicoes", `{"p_quando":"2027-03-01T18:00:00Z","p_loja":"iguatemi"}`).(map[string]any); so["ok"] != true || len(asList(so["sobrepoe"])) != 1 {
		t.Errorf("sobreposições = %v, esperava o encontro da semente", so)
	}
	c := deu(t, m, q, "vessel_criar_private_edit", `{"p_stylist":"STY-0001","p_quando":"2027-05-01T18:00:00Z","p_local":"Sítio","p_praca":"CPS","p_loja":"iguatemi","p_vagas":8,"p_teste":false}`, "")
	cod, _ := c["codigo"].(string)
	deu(t, m, q, "vessel_private_edit_editar", `{"p_codigo":"`+cod+`","p_vagas":8,"p_local":"Sítio novo"}`, "")
	g1 := deu(t, m, q, "vessel_convidar_para_encontro", `{"p_codigo":"`+cod+`","p_nome":"Edu","p_whatsapp":"19955550000"}`, "")
	g2 := deu(t, m, q, "vessel_convidar_para_encontro", `{"p_codigo":"`+cod+`","p_nome":"Edu","p_whatsapp":"19955550000"}`, "ja_estava")
	if g1["id"] != g2["id"] {
		t.Errorf("convidar duas vezes criou dois convites: %v e %v", g1["id"], g2["id"])
	}
	if n := m.Um(t, `select count(*)::text from vessel_atendimentos where evento_codigo = $1`, cod); n != "1" {
		t.Errorf("convites do encontro = %s, esperava 1", n)
	}
	id := fmt.Sprint(g1["id"])
	deu(t, m, q, "vessel_convite_marcar", `{"p_id":`+id+`,"p_marca":"enviado"}`, "")
	if cv := lista(t, m, q, "vessel_convidadas_do_encontro", `{"p_codigo":"`+cod+`"}`); len(cv) != 1 {
		t.Errorf("convidadas = %d, esperava 1", len(cv))
	}
	deu(t, m, q, "vessel_situacao_do_atendimento", `{"p_id":`+id+`,"p_situacao":"realizado"}`, "")
	if ch, _ := passo(t, m, q, "vessel_chave_da_convidada", `{"p_id":`+id+`}`).(map[string]any); ch["ok"] != true || fmt.Sprint(ch["chave"]) == "" || ch["chave"] == nil {
		t.Errorf("chave da convidada = %v", ch)
	}
	deu(t, m, q, "vessel_private_edit_situacao", `{"p_codigo":"`+cod+`","p_status":"cancelado","p_motivo":"chuva","p_observacoes":"remarcar"}`, "")
	deu(t, m, q, "vessel_private_edit_encerrar", `{"p_codigo":"`+cod+`","p_ativa":false}`, "")
	deu(t, m, q, "vessel_private_edit_arquivar", `{"p_codigo":"`+cod+`","p_arquivada":true}`, "")
	if a := lista(t, m, q, "vessel_stylists_para_escolher", `{}`); len(a) == 0 {
		t.Error("stylists para escolher vazio")
	}
	// com convidada não se apaga; sem ninguém, apaga
	if r, _ := passo(t, m, q, "vessel_private_edit_apagar", `{"p_codigo":"`+cod+`"}`).(map[string]any); r["situacao"] != "tem_gente" {
		t.Errorf("apagar com convidada = %v, esperava tem_gente", r)
	}
	vazio := deu(t, m, q, "vessel_criar_private_edit", `{"p_stylist":"STY-0001","p_quando":"2027-06-01T18:00:00Z","p_local":"Sala","p_praca":"CPS","p_loja":"iguatemi","p_vagas":8,"p_teste":false}`, "")
	vcod, _ := vazio["codigo"].(string)
	deu(t, m, q, "vessel_private_edit_apagar", `{"p_codigo":"`+vcod+`"}`, "")
	if n := m.Um(t, `select count(*)::text from vessel_private_edits where codigo in ($1, $2)`, cod, vcod); n != "1" {
		t.Errorf("apagar: sobraram %s dos dois encontros, esperava só o que tem convidada", n)
	}
}

// Beauty Sessions, praças e edições pelo HTTP: cada gravação lida de volta; quem só vê uma ferramenta não grava na outra.
func TestBeautyPracasEEdicoes(t *testing.T) {
	m := novoMundo(t)
	b := "editar:" + beauty
	deu(t, m, b, "vessel_beauty_session_criar", `{"p_codigo":"BS-20270201-CPS-01","p_quando":"2027-02-01","p_praca":"CPS","p_loja":"iguatemi","p_parceiro":"Studio X"}`, "")
	deu(t, m, b, "vessel_beauty_session_editar", `{"p_codigo":"BS-20270201-CPS-01","p_loja":"tivoli"}`, "")
	deu(t, m, b, "vessel_beauty_session_cadastrar_lead", `{"p_codigo":"BS-20270201-CPS-01","p_nome":"Fê","p_whatsapp":"19944440000","p_instagram":"@fe","p_interesse":"rever-uma-peca","p_email":"fe@x.com"}`, "")
	if l := lista(t, m, b, "vessel_leads_da_beauty_session", `{"p_codigo":"BS-20270201-CPS-01"}`); len(l) != 1 {
		t.Errorf("leads = %d, esperava 1", len(l))
	}
	deu(t, m, b, "vessel_beauty_session_encerrar", `{"p_codigo":"BS-20270201-CPS-01","p_ativa":false}`, "")
	deu(t, m, b, "vessel_beauty_session_arquivar", `{"p_codigo":"BS-20270201-CPS-01","p_arquivada":true}`, "")
	if st, _ := m.Pedir(t, "ver:"+beauty, "POST", "/rpc/vessel_beauty_session_apagar", `{"p_codigo":"BS-20270201-CPS-01"}`); st != 403 {
		t.Errorf("apagar como quem só vê = %d, esperava 403", st)
	}
	// com lead, não se apaga (a função recusa e o lead fica); sem lead, apaga
	if r, _ := passo(t, m, b, "vessel_beauty_session_apagar", `{"p_codigo":"BS-20270201-CPS-01"}`).(map[string]any); r["situacao"] != "tem_leads" {
		t.Errorf("apagar com lead = %v, esperava tem_leads", r)
	}
	deu(t, m, b, "vessel_beauty_session_criar", `{"p_codigo":"BS-20270202-CPS-01","p_quando":"2027-02-02","p_praca":"CPS","p_loja":"iguatemi","p_parceiro":"Studio Y"}`, "")
	deu(t, m, b, "vessel_beauty_session_apagar", `{"p_codigo":"BS-20270202-CPS-01"}`, "")
	if n := m.Um(t, `select count(*)::text from vessel_beauty_sessions`); n != "1" {
		t.Errorf("sessões = %s, esperava 1 (a com lead ficou, a sem lead foi)", n)
	}

	p := "editar:" + pracas
	pr := deu(t, m, p, "vessel_praca_criar", `{"p_sigla":"RIB","p_nome":"Ribeirão","p_loja_destino":"parkshopping"}`, "")
	pid := fmt.Sprint(pr["id"])
	deu(t, m, p, "vessel_praca_editar", `{"p_id":`+pid+`,"p_nome":"Ribeirão Preto","p_loja_destino":"parkshopping","p_ativa":true}`, "")
	deu(t, m, p, "vessel_praca_cidade_vincular", `{"p_praca_id":`+pid+`,"p_cidade":"Ribeirão Preto"}`, "")
	if ps := lista(t, m, p, "vessel_pracas_listar", `{}`); len(ps) != 3 {
		t.Errorf("praças = %d, esperava 3", len(ps))
	}
	cid := m.Um(t, `select id::text from vessel_praca_cidades limit 1`)
	deu(t, m, p, "vessel_praca_cidade_desvincular", `{"p_id":`+cid+`}`, "")

	e := "editar:" + edicoes
	ed := deu(t, m, e, "vessel_edicao_criar", `{"p_praca_id":`+pid+`,"p_nome":"Edição 1","p_comeca_em":"2027-01-01","p_termina_em":"2027-06-30"}`, "")
	eid := fmt.Sprint(ed["id"])
	deu(t, m, e, "vessel_edicao_incluir_stylist", `{"p_codigo":"STY-0001","p_edicao_id":`+eid+`}`, "")
	if tu := lista(t, m, e, "vessel_edicao_turma", `{"p_edicao_id":`+eid+`}`); len(tu) != 1 {
		t.Errorf("turma = %d, esperava 1", len(tu))
	}
	if pl, _ := passo(t, m, "ver:"+circle, "vessel_placar_da_edicao", `{"p_edicao_id":`+eid+`}`).(map[string]any); len(pl) == 0 {
		t.Errorf("placar = %v, esperava um objeto", pl)
	}
	deu(t, m, e, "vessel_edicao_tirar_stylist", `{"p_codigo":"STY-0001","p_edicao_id":`+eid+`}`, "")
	deu(t, m, e, "vessel_edicao_encerrar", `{"p_id":`+eid+`,"p_levar_para":null}`, "")
	// edição encerrada não reabre pela RPC; uma nova abre
	if r, _ := passo(t, m, e, "vessel_edicao_abrir", `{"p_id":`+eid+`}`).(map[string]any); r["situacao"] != "edicao_encerrada" {
		t.Errorf("abrir edição encerrada = %v, esperava edicao_encerrada", r)
	}
	ed2 := deu(t, m, e, "vessel_edicao_criar", `{"p_praca_id":`+pid+`,"p_nome":"Edição 2","p_comeca_em":"2027-07-01","p_termina_em":"2027-12-31"}`, "")
	deu(t, m, e, "vessel_edicao_abrir", `{"p_id":`+fmt.Sprint(ed2["id"])+`}`, "")
	if ls := lista(t, m, e, "vessel_edicoes_listar", `{"p_praca_id":`+pid+`}`); len(ls) != 2 {
		t.Errorf("edições = %d, esperava 2", len(ls))
	}
	// leituras restantes, como o super: formato (objeto ou lista) e nenhuma quebra
	for _, c := range []struct{ fn, corpo string }{
		{"vessel_agenda_das_lojas", `{"p_de":"2027-01-01","p_ate":"2027-01-31"}`},
		{"vessel_conta_das_beauty_sessions", `{}`}, {"vessel_conta_das_private_edits", `{}`},
		{"vessel_qualificacoes_vigentes", `{}`}, {"vessel_rastreio_dos_stylists", `{}`},
		{"vessel_scorecard_da_stylist", `{"p_codigo":"STY-0001"}`},
	} {
		passo(t, m, "super", c.fn, c.corpo)
	}
	if ev := lista(t, m, "super", "vessel_eventos_de_origem", `{}`); ev == nil {
		t.Error("eventos de origem: nem lista")
	}
	_ = strings.TrimSpace
}

// Paridade com produção, documentada: DUAS funções que gravam usam portão de "ver" do Private Edit
// (vessel_convite_marcar e vessel_chave_da_convidada; o comentário da primeira diz "a mesma trava de
// vessel_situacao_do_atendimento", que exige editar). Quem só VÊ marca o convite e faz nascer a chave. Se o dono
// apertar a regra (portão e função), este teste é o que muda.
func TestPortaoDeVerQueGrava(t *testing.T) {
	m := novoMundo(t)
	const soVe = "ver:" + privateEdit
	id := m.Um(t, `select id::text from vessel_atendimentos where evento_codigo = 'PE-20270301-CPS-01'`)
	m.P.Exec(t.Context(), `update vessel_atendimentos set chave_convite = null where id = $1::bigint`, id)
	deu(t, m, soVe, "vessel_chave_da_convidada", `{"p_id":`+id+`}`, "ok")
	if m.Um(t, `select (coalesce(chave_convite, '') <> '')::text from vessel_atendimentos where id = $1::bigint`, id) != "true" {
		t.Error("quem só vê não fez a chave nascer: o portão de vessel_chave_da_convidada mudou")
	}
	deu(t, m, soVe, "vessel_convite_marcar", `{"p_id":`+id+`,"p_marca":"enviado"}`, "ok")
	if m.Um(t, `select (convite_enviado_em is not null)::text from vessel_atendimentos where id = $1::bigint`, id) != "true" {
		t.Error("quem só vê não marcou o convite: o portão de vessel_convite_marcar mudou")
	}
	// e as que exigem editar continuam fechadas para quem só vê
	if st, _ := m.Pedir(t, soVe, "POST", "/rpc/vessel_situacao_do_atendimento", `{"p_id":`+id+`,"p_situacao":"realizado"}`); st != 403 {
		t.Errorf("situacao do atendimento como quem só vê = %d, esperava 403", st)
	}
}
