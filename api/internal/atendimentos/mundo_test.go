package atendimentos

import (
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/rpc"
	"github.com/rbv-co/social-dashboard/api/internal/testebanco/mundoteste"
)

// O mundo dos atendimentos: uma pessoa por chave de permissions que vessel_pode lê (ver; ver+editar), mais as que
// têm de ser negadas em tudo: sem perfil, super desativado, papel admin sem permissions, permissions que não é
// objeto e a chave "editar" sem "ver" (vessel_pode exige os dois).
const (
	idSuper      = "a6110000-0000-4000-a000-000000000001"
	idDesativado = "a6110000-0000-4000-a000-000000000002"
	idAdmin      = "a6110000-0000-4000-a000-000000000003"
	idLeitor     = "a6110000-0000-4000-a000-000000000004"
	idSoEditar   = "a6110000-0000-4000-a000-000000000005"
	idLista      = "a6110000-0000-4000-a000-000000000006" // permissions = ["atendimentos"] (lista, não objeto)
	semPerfil    = "a6110000-0000-4000-a000-000000000099"
)

// ferramenta → (id da pessoa que só VÊ, id da que vê e EDITA)
var porFerramenta = map[string][2]string{
	atend:       {"a6110000-0000-4000-a000-0000000000a1", "a6110000-0000-4000-a000-0000000000a2"},
	beauty:      {"a6110000-0000-4000-a000-0000000000b1", "a6110000-0000-4000-a000-0000000000b2"},
	privateEdit: {"a6110000-0000-4000-a000-0000000000c1", "a6110000-0000-4000-a000-0000000000c2"},
	circle:      {"a6110000-0000-4000-a000-0000000000d1", "a6110000-0000-4000-a000-0000000000d2"},
	grafico:     {"a6110000-0000-4000-a000-0000000000e1", ""},
	pracas:      {"a6110000-0000-4000-a000-0000000000f1", "a6110000-0000-4000-a000-0000000000f2"},
	edicoes:     {"a6110000-0000-4000-a000-000000000011", "a6110000-0000-4000-a000-000000000012"},
}

var pessoas = func() []mundoteste.Pessoa {
	ps := []mundoteste.Pessoa{
		{Chave: "super", ID: idSuper, Email: "super@x.com", Papel: "viewer", Super: true},
		{Chave: "desativado", ID: idDesativado, Email: "fora@x.com", Papel: "viewer", Super: true, Desativado: true},
		{Chave: "admin", ID: idAdmin, Email: "admin@x.com", Papel: "admin", Modulos: []string{"meta", "sales"}},
		{Chave: "leitor", ID: idLeitor, Email: "leitor@x.com", Papel: "viewer", Modulos: []string{"meta"}},
		{Chave: "soeditar", ID: idSoEditar, Email: "soeditar@x.com", Papel: "viewer"},
		{Chave: "lista", ID: idLista, Email: "lista@x.com", Papel: "viewer"},
	}
	for f, ids := range porFerramenta {
		ps = append(ps, mundoteste.Pessoa{Chave: "ver:" + f, ID: ids[0], Email: "ver-" + f + "@x.com", Papel: "viewer"})
		if ids[1] != "" {
			ps = append(ps, mundoteste.Pessoa{Chave: "editar:" + f, ID: ids[1], Email: "editar-" + f + "@x.com", Papel: "viewer"})
		}
	}
	return ps
}()

// linhas: as permissions de cada pessoa e as linhas de configuração que a migração de produção semeia (o funil
// padrão da stylist e as praças).
func linhas() string {
	s := `
update profiles set permissions = '{"atendimentos.stylist-circle": ["editar"]}' where id = '` + idSoEditar + `';
update profiles set permissions = '["atendimentos"]' where id = '` + idLista + `';
`
	for f, ids := range porFerramenta {
		s += `update profiles set permissions = jsonb_build_object('` + f + `', '["ver"]'::jsonb) where id = '` + ids[0] + `';` + "\n"
		if ids[1] != "" {
			s += `update profiles set permissions = jsonb_build_object('` + f + `', '["ver","editar"]'::jsonb) where id = '` + ids[1] + `';` + "\n"
		}
	}
	return s + `
insert into vessel_stylist_etapas (nome, ordem, tipo, conta_como_prospectada, criado_por_nome, alterado_por_nome)
values ('Identificado', 1, 'funil', false, 'migration', 'migration'), ('Classificação', 2, 'funil', false, 'migration', 'migration'),
       ('Prospectado', 3, 'funil', true, 'migration', 'migration'), ('Convidado', 4, 'funil', false, 'migration', 'migration'),
       ('Confirmado', 5, 'funil', false, 'migration', 'migration'), ('Presença Confirmada', 6, 'funil', false, 'migration', 'migration'),
       ('Desclassificado', 7, 'saida', false, 'migration', 'migration');
insert into vessel_pracas (sigla, nome, loja_destino, ordem) values ('CPS', 'Campinas', 'iguatemi', 1), ('SAO', 'São Paulo', null, 2);
` + semente
}

// semente: uma stylist com contato e qualificação, numa etapa que libera Private Edit, e um encontro com uma convidada
// (as RPCs de leitura de dado pessoal devolvem lista cheia a quem pode ver). Feita PELAS funções, como o super, na
// mesma transação (app.usuario_id só vale até o fim dela).
const semente = `
select set_config('app.usuario_id', '` + idSuper + `', true);
-- a fase de testes acabou: o padrão da coluna teste mudou em produção por script fora das migrations
-- (coletor/limpar-testes-do-cartao.mjs --aprovar), e o esquema carrega só o DDL das migrations
alter table vessel_pessoas alter column teste set default false;
alter table vessel_atendimentos alter column teste set default false;
select vessel_stylist_etapa_liberar_private_edit(4, true);
select vessel_stylist_criar(p_nome => 'Ana Stylist', p_whatsapp => '11999990000', p_cidade => 'Campinas', p_praca => 'CPS',
  p_origem_contato => 'indicacao', p_loja => 'iguatemi');
select vessel_stylist_registrar_contato(p_codigo => 'STY-0001', p_canal => 'whatsapp', p_resultado => 'conversou', p_nota => 'oi');
select vessel_stylist_avaliar(p_codigo => 'STY-0001', p_carteira => 3, p_portfolio => 3, p_mobilizacao => 3, p_acesso => 3, p_confiabilidade => 3);
select vessel_stylist_mover_de_etapa(p_codigo => 'STY-0001', p_etapa_id => 4);
select vessel_criar_private_edit(p_stylist => 'STY-0001', p_quando => '2027-03-01T18:00:00Z', p_local => 'Casa da Ana',
  p_praca => 'CPS', p_loja => 'iguatemi', p_vagas => 10, p_teste => false);
select vessel_convidar_para_encontro(p_codigo => 'PE-20270301-CPS-01', p_nome => 'Bia Convidada', p_whatsapp => '11988887777',
  p_email => 'bia@x.com');
`

func montarRPCs(r chi.Router, p *pgxpool.Pool) {
	reg, err := rpc.Novo(p, FuncoesRPC...)
	if err != nil {
		panic(err)
	}
	r.Post("/rpc/{nome}", reg.ServeHTTP)
}

func novoMundo(t *testing.T) *mundoteste.Mundo {
	t.Helper()
	return mundoteste.Novo(t, mundoteste.Opcoes{Pessoas: pessoas, Linhas: linhas(),
		Impersonadas: map[string][2]string{"impersonado": {porFerramenta[circle][1], idSuper}}}, montarRPCs)
}
