package vessel

import (
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Montar registra as rotas de tabela do painel de Autenticidade no grupo de DOMÍNIO de web.Rotas (depois de
// auth.Exigir, do prazo de 30 s e de autz.ComEscopo): as 6 leituras. As 16 RPCs entram por FuncoesRPC
// (web.FuncoesRPC); POST /vessel-baixar-cartao (Cartao) tem prazo próprio e web.Rotas o monta fora do grupo de
// domínio. Nenhuma escrita de tabela: em produção as 11 tabelas do selo só têm policy de SELECT.
func Montar(r chi.Router, p *pgxpool.Pool) { montarLeituras(r, p) }
