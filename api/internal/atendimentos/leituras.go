package atendimentos

import (
	"maps"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// leituras (Plano 12): as 7 leituras de tabela das telas Atendimentos, Base de Leads (Meta Ads) e Abandono de
// carrinho, que na Supabase eram `.from(tabela)` e não tinham rota (as 62 RPCs do 5.11 não as cobrem). Regra =
// catálogo de produção, tabela a tabela (vessel_pode('atendimentos','ver') ou is_vessel_leads() nas da Vessel;
// o módulo 'carrinho' / 'abandono-carrinho' ou papel admin nas duas de checkout): quem não passa recebe 200 []
// e X-Total-Count 0, como em toda leitura de domínio (Ruling 9 do mestre). Só as colunas que as telas usam:
// ip_hash, origem_registro, senha_hash, ip e os ids do Chatwoot ficam de fora. `limite` vai a 1000 (a Base de
// Leads pede 2000: com X-Total-Count a tela vê o corte).
var leituras = map[string]dados.Consulta{
	// Atendimentos (tela-de-atendimentos.vue: carregar) e Base de Leads (?criado_desde). A janela é a da tela: pelo
	// dia marcado, e quem ainda não tem dia entra pela data de criação (senão some quem mais precisa de atenção);
	// os dois filtros juntos equivalem a or(and(quando entre), and(quando nulo, criado_em entre)).
	"/vessel/atendimentos": {Tabela: "vessel_atendimentos", Alias: "a",
		SQL: `select a.id, a.pessoa_id, a.loja, a.client_advisor, a.quando, a.status, a.convite_codigo, a.presenca_em, a.teste,
		  a.criado_em,
		  (select json_build_object('id', p.id, 'nome', p.nome, 'telefone', p.telefone) from vessel_pessoas p
		    where p.id = a.pessoa_id and {ler:vessel_pessoas:p}) as pessoa
		from vessel_atendimentos a`,
		Filtros: []dados.Filtro{
			{Param: "criado_desde", SQL: "a.criado_em >= @criado_desde::timestamptz", Tipo: "instante"},
			{Param: "janela_de", SQL: "(a.quando >= @janela_de::timestamptz or (a.quando is null and a.criado_em >= @janela_de::timestamptz))", Tipo: "instante"},
			{Param: "janela_ate", SQL: "(a.quando <= @janela_ate::timestamptz or (a.quando is null and a.criado_em <= @janela_ate::timestamptz))", Tipo: "instante"},
		},
		OrdemPadrao: "a.quando desc nulls last", Desempate: "a.id"},
	// as compras que a tela de Atendimentos cruza com a agenda: ?situacao_id=9 (atendido: a única situação que é
	// venda, não pedido cancelado) &pessoa_id=1,2,3 &pedido_de=&pedido_ate= (data do pedido, AAAA-MM-DD)
	"/vessel/pedidos": {Tabela: "vessel_pedidos", Alias: "d",
		SQL: `select d.pessoa_id, d.numero, d.data_da_venda, d.data_do_pedido, d.receita_liquida, d.total_corrigido
		  from vessel_pedidos d`,
		Filtros: []dados.Filtro{
			{Param: "situacao_id", SQL: "d.situacao_id = @situacao_id::bigint", Tipo: "inteiro"},
			{Param: "pessoa_id", SQL: "d.pessoa_id = any(@pessoa_id::bigint[])", Tipo: "inteiro[]"},
			{Param: "pedido_de", SQL: "d.data_do_pedido >= @pedido_de::date", Tipo: "data"},
			{Param: "pedido_ate", SQL: "d.data_do_pedido <= @pedido_ate::date", Tipo: "data"},
		},
		OrdemPadrao: "d.data_do_pedido desc", Desempate: "d.id"},
	// Base de Leads: ?id=1,2,3 (as pessoas dos atendimentos lidos)
	"/vessel/pessoas": {Tabela: "vessel_pessoas", Alias: "p",
		SQL:         `select p.id, p.nome, p.telefone, p.email from vessel_pessoas p`,
		Filtros:     []dados.Filtro{{Param: "id", SQL: "p.id = any(@id::bigint[])", Tipo: "inteiro[]"}},
		OrdemPadrao: "p.id", Desempate: "p.id"},
	"/vessel/origens": {Tabela: "vessel_origens", Alias: "o",
		SQL: `select o.pessoa_id, o.momento, o.utm_source, o.utm_medium, o.utm_campaign, o.clique_meta from vessel_origens o`,
		Filtros: []dados.Filtro{
			{Param: "pessoa_id", SQL: "o.pessoa_id = any(@pessoa_id::bigint[])", Tipo: "inteiro[]"},
		},
		OrdemPadrao: "o.momento", Desempate: "o.id"},
	"/vessel/lista-espera": {Tabela: "vessel_lista_espera", Alias: "e",
		SQL: `select e.criado_em, e.nome, e.email, e.whatsapp, e.utm_source, e.utm_medium, e.utm_campaign, e.clique_meta
		  from vessel_lista_espera e`,
		Filtros:     []dados.Filtro{{Param: "criado_desde", SQL: "e.criado_em >= @criado_desde::timestamptz", Tipo: "instante"}},
		OrdemPadrao: "e.criado_em desc", Desempate: "e.id"},
	// ?tipo=checkout_iniciado &criado_desde=
	"/vessel/carrinho-eventos": {Tabela: "carrinho_eventos", Alias: "c",
		SQL: `select c.criado_em, c.session_id, c.utm_source, c.utm_medium, c.utm_campaign, c.gclid, c.referrer, c.fbp, c.fbc
		  from carrinho_eventos c`,
		Filtros: []dados.Filtro{
			{Param: "tipo", SQL: "c.tipo = @tipo::text", Tipo: "texto"},
			{Param: "criado_desde", SQL: "c.criado_em >= @criado_desde::timestamptz", Tipo: "instante"},
		},
		OrdemPadrao: "c.criado_em desc", Desempate: "c.id"},
	// Abandono de carrinho: ?iniciado_desde= (a tela olha os últimos 7 dias; a ordem é a da fila)
	"/vessel/checkout-abandono": {Tabela: "checkout_abandono", Alias: "k",
		SQL: `select k.token, k.nome, k.email, k.telefone, k.total, k.moeda, k.status, k.iniciado_em, k.ultimo_evento_em,
		  k.fila_envio_em, k.comprou_em, k.comprou_depois, k.pedido_criado_em, k.mensagem_status, k.mensagem_enviada_em,
		  k.mensagem_motivo from checkout_abandono k`,
		Filtros:     []dados.Filtro{{Param: "iniciado_desde", SQL: "k.iniciado_em >= @iniciado_desde::timestamptz", Tipo: "instante"}},
		OrdemPadrao: "k.ultimo_evento_em desc", Desempate: "k.token"},
}

// Montar registra as 7 GETs no grupo de DOMÍNIO de web.Rotas (depois de auth.Exigir e de autz.ComEscopo).
// Declaração inválida = panic na montagem: a API não sobe (deve).
func Montar(r chi.Router, p *pgxpool.Pool) { montarLeituras(r, p) }

func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	for _, caminho := range slices.Sorted(maps.Keys(leituras)) {
		r.Get(caminho, leituras[caminho].Handler(p, autz.Producao))
	}
}
