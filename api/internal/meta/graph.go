package meta

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/rbv-co/social-dashboard/api/internal/core"
)

// GET é a Graph pelo core para as tarefas do worker (o `apiGet`/`graph` das edges de cron): devolve o
// JSON da Graph; resposta com "error" (da Graph, ou do core já no formato da Graph por comoGraph)
// vira erro com a mensagem da Meta. Nunca leva token: a API não tem token da Meta e o core mascara o
// dele (`access_token=***`). 429 do core repete até 3 vezes; o ritmo é o RitmoMeta do cliente.
func GET(ctx context.Context, c *core.Cliente, caminho string, params map[string]any) (map[string]any, error) {
	j, err := (&AoVivo{Core: c}).graph(ctx, caminho, params)
	if err != nil {
		return nil, err
	}
	if e, ok := j["error"].(map[string]any); ok {
		msg, _ := e["message"].(string)
		if msg == "" {
			msg = "erro na Meta"
		}
		return nil, fmt.Errorf("Meta API %s: %s", caminho, msg)
	}
	return j, nil
}

// Paginas segue paging.next juntando `data`, até `max` páginas (teto de segurança). A 1ª página
// falhar é erro. Falha numa página seguinte: tolerante = devolve o que já leu (o `if (!r.ok) break`
// de coletar-dados); senão = erro (coletar-dados-hora lança).
func Paginas(ctx context.Context, c *core.Cliente, caminho string, params map[string]any, max int, tolerante bool) ([]any, error) {
	j, err := GET(ctx, c, caminho, params)
	if err != nil {
		return nil, err
	}
	todos, ok := j["data"].([]any)
	if !ok { // coleção da Graph sempre traz `data` em lista: sem ela não é "vazio", é resposta quebrada
		return nil, fmt.Errorf("Meta API %s: resposta sem lista data", caminho)
	}
	for n := 1; n < max; n++ {
		paging, _ := j["paging"].(map[string]any)
		next, _ := paging["next"].(string)
		if next == "" {
			return todos, nil
		}
		cam, ps, ok := traduzirURL(next)
		if !ok {
			return todos, nil
		}
		if j, err = GET(ctx, c, cam, ps); err != nil {
			if tolerante {
				slog.Warn("meta: página seguinte falhou; fico com o que já li", "caminho", caminho, "erro", err)
				return todos, nil
			}
			return nil, err
		}
		pagina, ok := j["data"].([]any)
		if !ok {
			if tolerante {
				slog.Warn("meta: página seguinte sem lista data; fico com o que já li", "caminho", caminho)
				return todos, nil
			}
			return nil, fmt.Errorf("Meta API %s: resposta sem lista data", cam)
		}
		todos = append(todos, pagina...)
	}
	return todos, nil
}
