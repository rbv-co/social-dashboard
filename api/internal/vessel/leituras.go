package vessel

import (
	"maps"
	"slices"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// leituras: as 6 leituras da tela de Autenticidade (tela-de-autenticidade.vue: carregar, carregarLembretes,
// carregarAFilaDeCartoes, atualizarAsPecas, recarregarAsPecas). Regra = catálogo: is_vessel_admin() nas 6 tabelas
// (o módulo 'autenticidade' em features ou is_superadmin da ficha, conta ativa); quem não passa recebe 200 [] e
// X-Total-Count 0 (Ruling 9 do mestre). O selo é um só para a casa: nenhum recorte por conta, loja ou dono. As
// tabelas que a tela não lê direto (clientes, leituras, garantias baixadas, pedidos de registro, trilha) não têm
// rota: as funções as leem (Ruling 5.10-6).
var leituras = map[string]dados.Consulta{
	// TODAS as colunas: a tela lia select('*') e a busca universal varre o lote inteiro (busca-e-arquivamento.js:73-85)
	"/autenticidade/lotes": {Tabela: "vessel_lotes", Alias: "l",
		SQL: `select l.id, l.modelo, l.cor, l.sku, l.quantidade, l.fabricado_em, l.criado_por, l.criado_em, l.fotos, l.os,
		  l.teste, l.material, l.material_fonte from vessel_lotes l`,
		OrdemPadrao: "l.criado_em desc", Desempate: "l.id"},
	// ?codigo=A,B relê só as peças de um pedido de cartão que terminou (atualizarAsPecas, em blocos de 100)
	"/autenticidade/pecas": {Tabela: "vessel_pecas", Alias: "p",
		SQL:         `select p.codigo, p.lote_id, p.numero_na_serie, p.gravada_em, p.cartao_gerado_em from vessel_pecas p`,
		Filtros:     []dados.Filtro{{Param: "codigo", SQL: "p.codigo = any(@codigo::text[])", Tipo: "texto[]"}},
		OrdemPadrao: "p.criado_em", Desempate: "p.codigo"},
	// as colunas que a tela usa (lista, busca, planilha, aviso da fila): SEM cpf, nascimento e os vínculos (Ruling 5.10-7)
	"/autenticidade/registros": {Tabela: "vessel_registros", Alias: "r",
		SQL: `select r.codigo, r.nome, r.whatsapp, r.onde_comprou, r.comprado_em, r.garantia_ate, r.registrado_em, r.bling_pedido
		  from vessel_registros r`,
		OrdemPadrao: "r.registrado_em desc", Desempate: "r.codigo"},
	// só a baixa ATIVA (a tela lia .is('desfeita_em', null))
	"/autenticidade/baixas": {Tabela: "vessel_baixas", Alias: "b",
		SQL: `select b.codigo, b.motivo, b.baixada_em from vessel_baixas b`, Onde: "b.desfeita_em is null",
		OrdemPadrao: "b.baixada_em desc", Desempate: "b.id"},
	// a fila de cartões: a tela pede as 20 mais recentes (?limite=20)
	"/autenticidade/cartao-pedidos": {Tabela: "vessel_cartao_pedidos", Alias: "q",
		SQL: `select q.id, q.pecas, q.situacao, q.pasta, q.erro, q.criado_por, q.criado_em, q.comecou_em, q.terminou_em
		  from vessel_cartao_pedidos q`,
		OrdemPadrao: "q.criado_em desc", Desempate: "q.id"},
	// COLUNAS_DO_LEMBRETE (lembretes-do-selo.js:29-30): o token_hash do link de cancelar NÃO sai
	"/autenticidade/lembretes": {Tabela: "vessel_lembretes", Alias: "m",
		SQL: `select m.id, m.peca_codigo, m.email, m.criado_em, m.enviado_7_em, m.enviado_30_em, m.cancelado_em, m.cancelado_por
		  from vessel_lembretes m`,
		OrdemPadrao: "m.criado_em desc", Desempate: "m.id"},
}

// montarLeituras registra as 6 GETs (declaração inválida = panic na montagem: a API não sobe).
func montarLeituras(r chi.Router, p *pgxpool.Pool) {
	for _, caminho := range slices.Sorted(maps.Keys(leituras)) {
		r.Get(caminho, leituras[caminho].Handler(p, autz.Producao))
	}
}
