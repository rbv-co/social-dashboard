package mcp

import (
	"testing"
	"time"
)

// Os mesmos casos que supabase/functions/_shared/mcp-frota.test.mjs conferiu contra as funções da tela
// (estadoDoVeiculo + seloDoVeiculo + reservaSegurando + quemEstaComOCarro) em 19/10.
func TestEstadoDoCarro(t *testing.T) {
	agora := time.Date(2026, 10, 19, 15, 0, 0, 0, time.UTC)
	const v, outro = "v1", "v2"
	s := func(x string) *string { return &x }
	pessoas := []pessoa{{ID: "p-ana", Nome: "Ana Souza"}, {ID: "p-joao", Nome: "João Pereira"}}
	viagem := usoAberto{VeiculoID: v, Tipo: s("viagem"), PessoaNome: s("Ana Souza")}
	posse := usoAberto{VeiculoID: v, Tipo: s("posse"), PessoaID: s("p-joao")}
	reserva := func(ini, fim string) reservaAprovada {
		r := reservaAprovada{VeiculoID: v, PessoaNome: s("Ana Lima"), RetiradaPrevista: s(ini)}
		if fim != "" {
			r.DevolucaoPrevista = s(fim)
		}
		return r
	}
	casos := []struct {
		nome, situacao, pessoaID string
		usos                     []usoAberto
		reservas                 []reservaAprovada
		quer                     string
	}{
		{"livre", "ativo", "", nil, nil, "livre"},
		{"dono fixo", "ativo", "p-ana", nil, nil, "fixo"},
		{"posse sem dono fixo", "ativo", "", []usoAberto{posse}, nil, "fixo"},
		{"viagem com dono fixo", "ativo", "p-ana", []usoAberto{viagem}, nil, "na_rua"},
		{"viagem sem tipo (antiga)", "ativo", "", []usoAberto{{VeiculoID: v}}, nil, "na_rua"},
		{"viagem de outro carro", "ativo", "", []usoAberto{{VeiculoID: outro, Tipo: s("viagem")}}, nil, "livre"},
		{"reserva valendo agora", "ativo", "", nil, []reservaAprovada{reserva("2026-10-19T12:00:00Z", "2026-10-19T20:00:00Z")}, "reservado"},
		{"reserva sem devolução, no dia", "ativo", "", nil, []reservaAprovada{reserva("2026-10-19T08:00:00Z", "")}, "reservado"},
		{"reserva de amanhã", "ativo", "", nil, []reservaAprovada{reserva("2026-10-20T12:00:00Z", "2026-10-20T20:00:00Z")}, "livre"},
		{"reserva vencida", "ativo", "", nil, []reservaAprovada{reserva("2026-10-15T12:00:00Z", "2026-10-15T20:00:00Z")}, "livre"},
		{"oficina com viagem", "em_manutencao", "", []usoAberto{viagem}, nil, "oficina"},
		{"inativo com dono", "inativo", "p-ana", nil, nil, "parado"},
		{"alienado", "alienado", "", nil, nil, "fora_da_frota"},
	}
	for _, c := range casos {
		if e := estadoDoCarro(v, c.situacao, c.pessoaID, c.usos, c.reservas, pessoas, agora); e["estado"] != c.quer {
			t.Errorf("%s: %v, queria %s", c.nome, e, c.quer)
		}
	}
	if e := estadoDoCarro(v, "ativo", "p-ana", nil, nil, pessoas, agora); e["com_quem"] != "Ana Souza" {
		t.Errorf("fixo sem o nome do dono: %v", e)
	}
	if e := estadoDoCarro(v, "ativo", "", []usoAberto{posse}, nil, pessoas, agora); e["com_quem"] != "João Pereira" || e["por_posse"] != true {
		t.Errorf("posse sem o nome do cadastro: %v", e)
	}
}

func TestNormalizar(t *testing.T) {
	if n := normalizar("  JOÃO   Pereira "); n != "joao pereira" {
		t.Errorf("normalizar: %q", n)
	}
	if p := soLetrasENumeros("abc-1d2(3)"); p != "ABC1D23" {
		t.Errorf("placa: %q", p)
	}
}
