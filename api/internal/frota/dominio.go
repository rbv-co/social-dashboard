package frota

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Rotas de domínio da Frota (sub-plano 5.3). A regra de toda tabela é a do catálogo de produção
// (autz.Producao: is_frota_admin() nas 14); aprovar, cancelar, revogar, arquivar e editar reserva,
// aceite de retirada e ficha assinada são os gatilhos verbatim, que leem auth.uid() — por isso toda
// escrita roda em banco.ComUsuario, com o PodeX na MESMA transação que grava (dados.Tabela).

// soSessaoPropria vai em TODA escrita da Frota (Ruling 5.3-5): os gatilhos carimbam auth.uid() — o
// ALVO de quem entrou como outra pessoa — em aceite_por, decidida_por, encerrada_por, arquivada_por e no
// histórico, e a assinatura do checklist sairia no nome dele. 403 (frase de dados.FraseEntrarComo).
var soSessaoPropria = dados.SoSessaoPropria(dados.FraseEntrarComo)

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// naLinha fixa o {id} de uma rota que não o leva na URL (a configuração do checklist é a linha única
// id = true), para reusar dados.RotaEditar sem SQL próprio.
func naLinha(id string, h http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		chi.RouteContext(r.Context()).URLParams.Add("id", id)
		h(w, r)
	}
}

// idDaLinha lê o id da linha que dados.Tabela.Criar devolveu (a linha inteira, ou só {"id"} quando quem
// grava não a lê depois).
func idDaLinha(linha []byte) (string, error) {
	var x struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(linha, &x); err != nil || x.ID == "" {
		return "", errors.New("frota: linha gravada sem id")
	}
	return x.ID, nil
}

// vazio: chave ausente ou null explícito (validação dos corpos compostos das Tasks 4 e 6).
func vazio(v json.RawMessage) bool { return len(v) == 0 || string(v) == "null" }
