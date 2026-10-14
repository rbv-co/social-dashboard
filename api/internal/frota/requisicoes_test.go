package frota

import (
	"strings"
	"testing"
)

func colReq(coluna, id string) string {
	return "select " + coluna + "::text from frota_requisicoes where id = '" + id + "'"
}

const (
	histReq = "select count(*)::text from frota_requisicoes_historico"
	totReq  = "select count(*)::text from frota_requisicoes"
)

func TestReservasLerECriar(t *testing.T) {
	m := novoMundo(t, montarRequisicoes)
	st, corpo := m.Pedir(t, "motorista", "GET", "/frota/requisicoes", "")
	if i, j := strings.Index(corpo, R1), strings.Index(corpo, R2); st != 200 || i < 0 || j < i {
		t.Errorf("agenda = %d %s, esperava R1 antes de R2", st, corpo)
	}
	for _, quem := range semFrota {
		if st, corpo := m.Pedir(t, quem, "GET", "/frota/requisicoes", ""); st != 200 || corpo != "[]" {
			t.Errorf("VAZAMENTO: %s (sem a Frota) lê %d %s", quem, st, corpo)
		}
	}
	m.Rodar(t, []caso{{Nome: "sem sessão", Metodo: "GET", Caminho: "/frota/requisicoes", Status: 401}})

	const url = "/frota/requisicoes"
	foto := m.Um(t, fotoDaFrota)
	for _, c := range []caso{
		{Nome: "criada_por no corpo", Quem: "motorista", Corpo: `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-10-25T12:00:00Z","criada_por":"` + idAprovador + `"}`, Status: 400},
		{Nome: "não nasce aprovada", Quem: "motorista", Corpo: `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-10-25T12:00:00Z","situacao":"aprovada"}`, Status: 400},
		{Nome: "devolução antes da retirada", Quem: "motorista", Corpo: `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-10-25T12:00:00Z","devolucao_prevista":"2026-10-24T12:00:00Z"}`, Status: 400},
		{Nome: "entrar como", Quem: "impersonado", Corpo: `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-10-25T12:00:00Z"}`, Status: 403},
	} {
		m.Rodar(t, []caso{{Nome: c.Nome, Quem: c.Quem, Metodo: "POST", Caminho: url, Corpo: c.Corpo, Status: c.Status, Efeito: fotoDaFrota, Quer: foto}})
	}
	for _, quem := range semFrota {
		m.Rodar(t, []caso{{Nome: "sem a Frota não pede: " + quem, Quem: quem, Metodo: "POST", Caminho: url, Status: 403,
			Corpo: `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-10-25T12:00:00Z"}`, Efeito: fotoDaFrota, Quer: foto}})
	}
	m.Rodar(t, []caso{{Nome: "criar", Quem: "motorista", Metodo: "POST", Caminho: url, Status: 201,
		Corpo: `{"veiculo_id":"` + V2 + `","retirada_prevista":"2026-10-25T12:00:00Z","destino":"Campinas"}`,
		Tem:   `"criada_por":"` + idMotorista + `"`, Efeito: totReq, Quer: "3"}})
	if v := m.Um(t, `select count(*)::text from frota_requisicoes where destino = 'Campinas' and situacao = 'pendente'`); v != "1" {
		t.Errorf("a reserva nova não nasceu pendente (%s)", v)
	}
}

// Quem decide, cancela, revoga, arquiva e edita o conteúdo é o gatilho de produção (frase dele); o que
// ele carimba (decidida_por, encerrada_por, arquivada_por, histórico) é auth.uid() = quem pediu.
func TestReservas(t *testing.T) {
	m := novoMundo(t, montarRequisicoes)
	url := func(id string) string { return "/frota/requisicoes/" + id }
	// intacta: coluna e contagem do histórico iguais
	intacta := func(nome, quem, id, corpo string, status int, frase string) {
		t.Helper()
		antes := m.Um(t, fotoDaFrota)
		m.Rodar(t, []caso{{Nome: nome, Quem: quem, Metodo: "PATCH", Caminho: url(id), Corpo: corpo, Status: status, Tem: frase,
			Efeito: fotoDaFrota, Quer: antes}})
	}

	intacta("sem aprovar não aprova", "motorista", R1, `{"situacao":"aprovada"}`, 400, "Você não tem permissão para aprovar requisições de veículo.")
	intacta("só a feature, sem a Frota: invisível", "soAprovar", R1, `{"situacao":"aprovada"}`, 404, "")
	intacta("admin sem Frota: invisível", "admin", R1, `{"situacao":"aprovada"}`, 404, "")
	intacta("entrar como", "impersonado", R1, `{"situacao":"aprovada"}`, 403, "")
	intacta("conteúdo sem aprovar", "motorista", R1, `{"destino":"Sorocaba"}`, 400, "Você não pode alterar reserva de veículo. Peça a quem aprova.")
	intacta("arquivar pendente", "aprovador", R1, `{"arquivada_em":"2026-10-12T00:00:00Z"}`, 400, "Só reserva encerrada ou vencida pode ser arquivada")
	intacta("pendente não volta", "aprovador", R1, `{"situacao":"pendente"}`, 400, "")
	intacta("decidida_por no corpo", "aprovador", R1, `{"decidida_por":"`+idAprovador+`"}`, 400, "")
	intacta("id inexistente", "aprovador", "f3f00000-0000-4000-a000-0000000000ff", `{"situacao":"aprovada"}`, 404, "")

	// aprovar: decidida_por = a sessão e uma linha de histórico
	m.Rodar(t, []caso{{Nome: "aprovar", Quem: "aprovador", Metodo: "PATCH", Caminho: url(R1), Status: 200,
		Corpo: `{"situacao":"aprovada","motivo_decisao":null}`, Tem: `"decidida_por":"` + idAprovador + `"`,
		Efeito: `select count(*)::text || '/' || max(de) || '>' || max(para) || '/' || max(quem::text) from frota_requisicoes_historico
			where requisicao_id = '` + R1 + `' and campo = 'situação'`, Quer: "1/pendente>aprovada/" + idAprovador}})
	m.Rodar(t, []caso{{Nome: "super pela ficha recusa", Quem: "superFicha", Metodo: "PATCH", Caminho: url(R1), Status: 200,
		Corpo: `{"situacao":"recusada","motivo_decisao":"Sem carro"}`, Efeito: colReq("decidida_por", R1), Quer: idSuperFicha}})

	// encerrar R2 (aprovada)
	intacta("motorista revoga", "motorista", R2, `{"situacao":"revogada","encerrada_motivo":"x"}`, 400, "Você não pode cancelar nem revogar")
	intacta("cancelar sem motivo", "aprovador", R2, `{"situacao":"cancelada"}`, 400, "Escreva o motivo do cancelamento ou da revogação.")
	m.Rodar(t, []caso{{Nome: "cancelar com motivo", Quem: "aprovador", Metodo: "PATCH", Caminho: url(R2), Status: 200,
		Corpo: `{"situacao":"cancelada","encerrada_motivo":"Carro na oficina"}`, Efeito: colReq("encerrada_por", R2), Quer: idAprovador}})
	intacta("encerrada não se edita", "aprovador", R2, `{"destino":"X"}`, 400, "Esta reserva já está cancelada")

	// arquivar a encerrada
	intacta("motorista arquiva", "motorista", R2, `{"arquivada_em":"2026-10-12T00:00:00Z"}`, 400, "Você não pode arquivar reserva de veículo")
	m.Rodar(t, []caso{{Nome: "aprovador arquiva", Quem: "aprovador", Metodo: "PATCH", Caminho: url(R2), Status: 200,
		Corpo: `{"arquivada_em":"2026-10-12T00:00:00Z"}`, Efeito: colReq("arquivada_por", R2), Quer: idAprovador}})

	// elo com a viagem (sem gatilho de permissão: paridade com a produção)
	m.Rodar(t, []caso{{Nome: "uso_id e usada", Quem: "motorista", Metodo: "PATCH", Caminho: url(R1), Status: 200,
		Corpo: `{"uso_id":"` + U2 + `","situacao":"usada"}`, Efeito: colReq("uso_id", R1), Quer: U2}})
}
