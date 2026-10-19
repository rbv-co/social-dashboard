package acessos

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Tradução da resposta do WorkDrive (JSON:API) em linhas de acessos_recursos. Porte de
// supabase/functions/acessos-proxy/normalizar-pastas-do-workdrive.js (a edge segue no ar; o teste de lá segue valendo).

type pastaWD struct{ externalID, nome string }

type linhaRecurso struct {
	Nome, ExternalID, DriveID, Caminho string
}

func texto0(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case nil:
		return ""
	case json.Number:
		return x.String()
	case float64:
		return fmt.Sprint(x)
	}
	return fmt.Sprint(v)
}

func ehPastaWD(item map[string]any) bool {
	attrs, _ := item["attributes"].(map[string]any)
	if b, ok := attrs["is_folder"].(bool); ok && b {
		return true
	}
	if t, ok := attrs["type"].(string); ok && strings.EqualFold(t, "folder") {
		return true
	}
	t, _ := item["type"].(string)
	return strings.EqualFold(t, "teamfolders")
}

// ativaWD: status ausente = ativa (sem informação não descarta); status 1 = ativa; o resto (lixeira) não.
func ativaWD(item map[string]any) bool {
	attrs, _ := item["attributes"].(map[string]any)
	s, ok := attrs["status"]
	if !ok || s == nil {
		return true
	}
	switch x := s.(type) {
	case json.Number:
		return x.String() == "1"
	case float64:
		return x == 1
	case string:
		return strings.TrimSpace(x) == "1"
	}
	return false
}

func nomeWD(item map[string]any) string {
	attrs, _ := item["attributes"].(map[string]any)
	var nome any // o primeiro que existir, como o `??` do JS (vazio não cai para o próximo)
	for _, k := range []string{"name", "display_name", "folder_name"} {
		if v, ok := attrs[k]; ok && v != nil {
			nome = v
			break
		}
	}
	if s, ok := nome.(string); ok && strings.TrimSpace(s) != "" {
		return strings.TrimSpace(s)
	}
	return "(sem nome)"
}

// pastasDoWorkdrive: só as pastas ativas e com id de uma listagem `{data: [...]}`.
func pastasDoWorkdrive(resposta map[string]any) []pastaWD {
	dados, _ := resposta["data"].([]any)
	var out []pastaWD
	for _, d := range dados {
		item, _ := d.(map[string]any)
		if item == nil || !ehPastaWD(item) || !ativaWD(item) {
			continue
		}
		id := texto0(item["id"])
		if id == "" {
			continue // sem id não dá para deduplicar nem compartilhar depois
		}
		out = append(out, pastaWD{externalID: id, nome: nomeWD(item)})
	}
	return out
}

// linhasDeRecursos: driveID = a pasta de equipe que contém a pasta; prefixo vira o começo do caminho.
func linhasDeRecursos(pastas []pastaWD, driveID, prefixo string) []linhaRecurso {
	prefixo = strings.TrimSpace(prefixo)
	out := make([]linhaRecurso, 0, len(pastas))
	for _, p := range pastas {
		caminho := p.nome
		if prefixo != "" {
			caminho = prefixo + "/" + p.nome
		}
		out = append(out, linhaRecurso{Nome: p.nome, ExternalID: p.externalID, DriveID: driveID, Caminho: caminho})
	}
	return out
}

// separarNovas: idempotência por external_id; a própria resposta do Zoho pode repetir e não duplica dentro da rodada.
func separarNovas(linhas []linhaRecurso, existentes []string) (novas, ja []linhaRecurso) {
	tem := make(map[string]bool, len(existentes))
	for _, id := range existentes {
		tem[id] = true
	}
	for _, l := range linhas {
		if tem[l.ExternalID] {
			ja = append(ja, l)
			continue
		}
		tem[l.ExternalID] = true
		novas = append(novas, l)
	}
	return novas, ja
}
