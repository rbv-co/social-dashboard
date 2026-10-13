// Package acessos: rotas de domínio de Colaboradores e Acessos (sub-plano 5.4) — o CADASTRO de
// colaboradores (acessos_pessoas), da estrutura (organizações, setores), das pastas e vínculos e a
// trilha. Não confundir com o pacote acesso (5.1: contas de login, perfis de acesso, equipes). A regra
// de toda tabela é a do catálogo de produção (autz.Producao: is_acessos_admin() nas 13); o Zoho, a
// Microsoft, o OAuth, os segredos de acessos_conexoes e os arquivos são do Plano 6, que se monta aqui.
package acessos

import (
	"encoding/json"
	"strings"

	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// soSessaoPropria recusa as escritas a quem entrou como outra pessoa (Ruling 5.4-5): a trilha
// (acessos_log.quem) e o elo ficha↔login sairiam no nome do ALVO. Em TODA escrita do pacote.
var soSessaoPropria = dados.SoSessaoPropria("Quem entrou como outra pessoa não grava em Colaboradores e Acessos.")

// deve: declaração de rota errada (Consulta ou Tabela fora do catálogo) faz a API não subir.
func deve(err error) {
	if err != nil {
		panic(err)
	}
}

// emBranco: ausente, null, não-texto ou só espaços. nome é a única coluna obrigatória sem default do
// cadastro (001_base.sql:4, 004_v2.sql:3, 005_organizacoes.sql:3); a tela já recusa ("Nome é obrigatório").
func emBranco(v json.RawMessage) bool {
	var s string
	return json.Unmarshal(v, &s) != nil || strings.TrimSpace(s) == ""
}
