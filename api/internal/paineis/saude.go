package paineis

import (
	"net/http"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// tabelasDaSaude: a visão robos_saude lê estas duas tabelas inteiras. Ela foi criada com
// security_invoker (db/migrations/2026-07-31-saude-dos-robos.sql:193-198): quem a lê passa pela RLS
// das duas. Aqui vale a mesma regra, do catálogo (Ruling 1 do 5.12).
var tabelasDaSaude = []string{"robos_esperados", "robos_execucoes"}

// SaudeDosRobos é GET /status-ia/saude-dos-robos: a visão robos_saude (fora do catálogo: Ruling 27
// do Plano 5) como está, ou [] para quem não lê as duas tabelas de baixo.
func SaudeDosRobos(b dados.Consultor, cat *autz.Catalogo) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		q, ok := dados.LerQuery(w, r) // r.URL.Query() descartaria o par malformado e responderia 200
		if !ok {
			return
		}
		if len(q) > 0 {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "esta leitura não aceita parâmetros")
			return
		}
		e := autz.EscopoDo(r.Context())
		for _, t := range tabelasDaSaude {
			f, err := cat.Filtro(e, t, autz.Ler, "x")
			if err != nil { // sem escopo ou tabela fora do catálogo: 500, nunca libera
				dados.ErroDoBanco(w, err)
				return
			}
			// Policies diferentes nas duas tabelas dariam "sem registro ainda" na visão com
			// security_invoker; aqui dão [] (mais restritivo e hoje inalcançável: as duas são iguais).
			// ponytail: a visão agrega as tabelas inteiras, então só cabe regra POR PESSOA (constante);
			// regra por linha (forma nova no catálogo) responde [] até a rota ser reescrita, e
			// TestRegraDaSaudeDosRobosEhPorPessoa acusa a mudança antes do deploy.
			if f.SQL != "true" {
				w.Header().Set("Content-Type", "application/json")
				w.Write([]byte("[]"))
				return
			}
		}
		dados.Lista(r.Context(), b, w, `select s.* from robos_saude s order by s.critico desc, s.robo limit 1000`, pgx.NamedArgs{})
	}
}
