package acessos

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

var tabelasDrive = []struct{ rota, tabela, marca string }{
	{"/acessos/drive/marcas", "acessos_drive_marcas", "od-raiz-1"},
	{"/acessos/drive/setores", "acessos_drive_setores", "c_marketing_1234"},
	{"/acessos/drive/overrides", "acessos_drive_overrides", "od-pasta-1"},
}

// A matriz de produção (policy *_rw = is_acessos_admin) tem de separar as pessoas do mundo.
func TestDriveMatrizDeProducao(t *testing.T) {
	m := novoMundo(t, montarDrive)
	for _, d := range tabelasDrive {
		for _, op := range []autz.Op{autz.Ler, autz.Criar, autz.Apagar} {
			if q := quemPode(t, m, d.tabela, op); !slices.Equal(q, []string{"acessos", "admin"}) {
				t.Errorf("%s %s: podem %v, esperava acessos e admin", d.tabela, op, q)
			}
		}
	}
}

// VAZAMENTO: só quem a policy deixa ler enxerga a linha plantada; os outros recebem lista vazia.
func TestDriveLeitura(t *testing.T) {
	m := novoMundo(t, montarDrive)
	for _, d := range tabelasDrive {
		leem := quemPode(t, m, d.tabela, autz.Ler)
		for _, p := range pessoas {
			if p.Desativado {
				continue
			}
			st, corpo := m.Pedir(t, p.Chave, "GET", d.rota, "")
			if veem := strings.Contains(corpo, d.marca); st != http.StatusOK || veem != slices.Contains(leem, p.Chave) {
				t.Errorf("%s: %s status %d vê=%v, esperava vê=%v", d.rota, p.Chave, st, veem, slices.Contains(leem, p.Chave))
			}
		}
		m.Rodar(t, []caso{
			{Nome: d.rota + " sem sessão", Metodo: "GET", Caminho: d.rota, Status: http.StatusUnauthorized},
			{Nome: d.rota + " conta desativada", Quem: "desativado", Metodo: "GET", Caminho: d.rota, Status: http.StatusUnauthorized},
			{Nome: d.rota + " ordem fora da lista", Quem: "acessos", Metodo: "GET", Caminho: d.rota + "?ordem=segredo", Status: http.StatusBadRequest},
		})
	}
	// a ordem da tela: setores por ordem e depois label
	m.Rodar(t, []caso{
		{Nome: "setor novo com ordem 1 vem antes", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/setores",
			Corpo: `{"chave":"c_a","label":"Zeta","ordem":1}`, Status: http.StatusCreated},
	})
	_, c := m.Pedir(t, "acessos", "GET", "/acessos/drive/setores", "")
	if !(strings.Index(c, "Zeta") < strings.Index(c, "Marketing")) {
		t.Errorf("ordem dos setores do Drive errada (ordem, label): %s", c)
	}
}

func TestDriveMarcas(t *testing.T) {
	m := novoMundo(t, montarDrive)
	foto := m.Um(t, fotoDosAcessos)
	for _, q := range []string{"superFicha", "superEmail", "frota", "viewer"} {
		m.Rodar(t, []caso{
			{Nome: "criar marca sem poder (" + q + ")", Quem: q, Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"X","external_id":"x1"}`, Status: http.StatusForbidden},
		})
	}
	m.Rodar(t, []caso{
		{Nome: "sem sessão", Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"X","external_id":"x1"}`, Status: http.StatusUnauthorized},
		{Nome: "entrou como outra pessoa", Quem: "impersonado", Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"X","external_id":"x1"}`, Status: http.StatusForbidden, Tem: fraseEntrarComo},
		{Nome: "sem external_id", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"X"}`, Status: http.StatusBadRequest},
		{Nome: "coluna proibida", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"X","external_id":"x1","id":"a4000000-0000-4000-a000-0000000000ff"}`, Status: http.StatusBadRequest},
		{Nome: "external_id repetido", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"Y","external_id":"od-raiz-1"}`, Status: http.StatusConflict},
		{Nome: "apagar sem poder", Quem: "viewer", Metodo: "DELETE", Caminho: "/acessos/drive/marcas/a4000000-0000-4000-a000-0000000000ff", Status: http.StatusNotFound},
	})
	if m.Um(t, fotoDosAcessos) != foto {
		t.Fatal("uma recusa mexeu no banco")
	}
	m.Rodar(t, []caso{
		{Nome: "criar", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/marcas", Corpo: `{"nome":"Nova","external_id":"x1","ordem":4}`, Status: http.StatusCreated, Tem: `"x1"`,
			Efeito: "select ordem::text from acessos_drive_marcas where external_id = 'x1'", Quer: "4"},
	})
	id := m.Um(t, "select id::text from acessos_drive_marcas where external_id = 'x1'")
	m.Rodar(t, []caso{
		{Nome: "apagar", Quem: "admin", Metodo: "DELETE", Caminho: "/acessos/drive/marcas/" + id, Status: http.StatusNoContent,
			Efeito: contagem("acessos_drive_marcas"), Quer: "1"},
		{Nome: "apagar de novo", Quem: "admin", Metodo: "DELETE", Caminho: "/acessos/drive/marcas/" + id, Status: http.StatusNotFound},
	})
}

func TestDriveSetoresEOverrides(t *testing.T) {
	m := novoMundo(t, montarDrive)
	foto := m.Um(t, fotoDosAcessos)
	m.Rodar(t, []caso{
		{Nome: "setor sem label", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/setores", Corpo: `{"chave":"c_x"}`, Status: http.StatusBadRequest},
		{Nome: "setor sem poder", Quem: "viewer", Metodo: "POST", Caminho: "/acessos/drive/setores", Corpo: `{"chave":"c_x","label":"X"}`, Status: http.StatusForbidden},
		{Nome: "setor repetido", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/setores", Corpo: `{"chave":"c_marketing_1234","label":"Outro"}`, Status: http.StatusConflict},
		{Nome: "override sem setor_chave", Quem: "acessos", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"nome":"P"}`, Status: http.StatusBadRequest},
		{Nome: "override sem poder", Quem: "viewer", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"setor_chave":"c_marketing_1234"}`, Status: http.StatusForbidden},
		{Nome: "override sem sessão", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"setor_chave":"c_marketing_1234"}`, Status: http.StatusUnauthorized},
		{Nome: "override entrando como outra pessoa", Quem: "impersonado", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"setor_chave":"c_marketing_1234"}`, Status: http.StatusForbidden, Tem: fraseEntrarComo},
		{Nome: "override coluna proibida", Quem: "acessos", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"setor_chave":"c_marketing_1234","external_id":"outro"}`, Status: http.StatusBadRequest},
		{Nome: "apagar overrides sem poder", Quem: "viewer", Metodo: "DELETE", Caminho: "/acessos/drive/setores/c_marketing_1234/overrides", Status: http.StatusNotFound},
	})
	if m.Um(t, fotoDosAcessos) != foto {
		t.Fatal("uma recusa mexeu no banco")
	}

	m.Rodar(t, []caso{
		{Nome: "criar setor", Quem: "acessos", Metodo: "POST", Caminho: "/acessos/drive/setores", Corpo: `{"chave":"c_vendas","label":"Vendas","ordem":7}`, Status: http.StatusCreated},
		// upsert: o mesmo external_id duas vezes continua sendo UMA linha; a segunda muda o setor
		{Nome: "override cria", Quem: "acessos", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"setor_chave":"c_vendas","nome":"Pasta 1"}`, Status: http.StatusOK,
			Efeito: contagem("acessos_drive_overrides"), Quer: "2"},
		{Nome: "override repetido muda o setor", Quem: "admin", Metodo: "PUT", Caminho: "/acessos/drive/overrides/od-1", Corpo: `{"setor_chave":"c_marketing_1234","nome":"Pasta 1"}`, Status: http.StatusOK,
			Efeito: "select setor_chave from acessos_drive_overrides where external_id = 'od-1'", Quer: "c_marketing_1234"},
		{Nome: "contagem segue 2", Efeito: contagem("acessos_drive_overrides"), Quer: "2"},
		// apagar overrides do setor: só os dele; repetir é seguro
		{Nome: "apagar overrides do setor", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/drive/setores/c_marketing_1234/overrides", Status: http.StatusNoContent,
			Efeito: contagem("acessos_drive_overrides"), Quer: "0"},
		{Nome: "apagar overrides de novo", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/drive/setores/c_marketing_1234/overrides", Status: http.StatusNoContent},
		{Nome: "apagar setor", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/drive/setores/c_vendas", Status: http.StatusNoContent,
			Efeito: contagem("acessos_drive_setores"), Quer: "1"},
		{Nome: "apagar setor inexistente", Quem: "acessos", Metodo: "DELETE", Caminho: "/acessos/drive/setores/c_vendas", Status: http.StatusNotFound},
	})
}
