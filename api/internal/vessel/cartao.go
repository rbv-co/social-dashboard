package vessel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
	"github.com/rbv-co/social-dashboard/api/internal/zoho"
	"golang.org/x/text/unicode/norm"
)

// raizDasFotos: "Fotos por SKU (coletor)" no WorkDrive, a mesma raiz do robô de cartões (coletor/robo-de-cartoes.mjs:34).
// ZOHO_PASTA_FOTOS nunca foi definida nos segredos das edges (levantamento/segredos-nomes.txt): vale o padrão delas.
const raizDasFotos = "6kuqn469a1e0841ee49e0bd0d18cab60c9cd5"

var (
	reCodigoDaPeca = regexp.MustCompile(`^[A-Z0-9]{4,24}$`)
	reDia          = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)
)

// Cartao porta a edge vessel-baixar-cartao (supabase/functions/vessel-baixar-cartao/index.ts): entrega ao navegador o
// arquivo real de um cartão EAN que o robô já deixou no Zoho (frente ou verso, png ou pdf). Contrato = o da edge
// (corpo {codigo, face, formato}; erros {"erro": …} com os mesmos status), exceto o 401/403 de sessão, no formato
// do núcleo. Portão = is_vessel_admin() (autz.VesselAdmin), a regra de vessel_pedir_cartoes; o "entrar como" baixa
// (só lê). Caminho comum: o id que o robô gravou em vessel_cartao_arquivos; sem ele (ou recusado), a busca na árvore
// do robô, sem os caches de listagem da edge (Ruling 5.10-12). Monte DEPOIS de autz.ComEscopo.
type Cartao struct {
	Pool *pgxpool.Pool
	Zoho *zoho.Cliente
}

func erroDoCartao(w http.ResponseWriter, status int, corpo map[string]any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(corpo)
}

func (c *Cartao) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	if e := autz.EscopoDo(ctx); e == nil || !autz.VesselAdmin(e) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	var pedido struct {
		Codigo  any `json:"codigo"`
		Face    any `json:"face"`
		Formato any `json:"formato"`
	}
	bruto, _ := io.ReadAll(http.MaxBytesReader(w, r.Body, 4<<10))
	json.Unmarshal(bruto, &pedido) // corpo ilegível = campos vazios = codigo_invalido, como a edge
	cod, _ := pedido.Codigo.(string)
	codigo := strings.ToUpper(strings.TrimSpace(cod))
	if !reCodigoDaPeca.MatchString(codigo) {
		erroDoCartao(w, http.StatusBadRequest, map[string]any{"erro": "codigo_invalido"})
		return
	}
	var numero int
	var gerado *time.Time
	var sku *string
	err := c.Pool.QueryRow(ctx, `select p.numero_na_serie, p.cartao_gerado_em, l.sku from vessel_pecas p
		  left join vessel_lotes l on l.id = p.lote_id where p.codigo = $1::text`, codigo).Scan(&numero, &gerado, &sku)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		erroDoCartao(w, http.StatusNotFound, map[string]any{"erro": "peca_nao_existe"})
		return
	case err != nil:
		slog.Error("vessel-baixar-cartao: leitura da peça", "erro", err.Error())
		erroDoCartao(w, http.StatusInternalServerError, map[string]any{"erro": "banco_indisponivel"})
		return
	case gerado == nil: // só o que o robô entregou: peça sem cartão não tem arquivo (a tela manda gerar primeiro)
		erroDoCartao(w, http.StatusConflict, map[string]any{"erro": "sem_cartao"})
		return
	}
	face, _ := pedido.Face.(string)
	formato, _ := pedido.Formato.(string)
	nome := nomeDoArquivo(textoOuVazio(sku), numero, face, formato)
	if nome == "" {
		erroDoCartao(w, http.StatusBadRequest, map[string]any{"erro": "pedido_invalido"})
		return
	}
	con, err := c.Zoho.Conexao(ctx)
	if errors.Is(err, zoho.ErrDesconectado) {
		erroDoCartao(w, http.StatusServiceUnavailable, map[string]any{"erro": "zoho_desconectado"})
		return
	}
	if err != nil {
		slog.Error("vessel-baixar-cartao: leitura da conexão", "erro", err.Error())
		erroDoCartao(w, http.StatusInternalServerError, map[string]any{"erro": "banco_indisponivel"})
		return
	}
	// o id que o robô gravou: baixa direto. Sem linha (erro de leitura conta como sem linha, como a edge) ou com
	// id que o Zoho recusa (arquivo trocado ou apagado): a busca na árvore.
	var gravado string
	c.Pool.QueryRow(ctx, `select zoho_id from vessel_cartao_arquivos where codigo = $1::text and nome = $2::text`, codigo, nome).Scan(&gravado)
	var resp *http.Response
	if gravado != "" {
		if r2, err := c.Zoho.Baixar(ctx, con, gravado); err == nil {
			resp = r2
		}
	}
	if resp == nil {
		// o dia do último pedido que entregou a peça: só a dica de onde olhar primeiro
		var pasta *string
		c.Pool.QueryRow(ctx, `select pasta from vessel_cartao_pedidos where pecas @> array[$1::text]
			  and situacao in ('pronto', 'falhou') and pasta is not null order by terminou_em desc limit 1`, codigo).Scan(&pasta)
		id, err := c.acharOArquivo(ctx, con, textoOuVazio(sku), nome, diaDaPasta(textoOuVazio(pasta)))
		if err != nil {
			slog.Error("vessel-baixar-cartao: busca no Zoho", "erro", err.Error())
			erroDoCartao(w, http.StatusBadGateway, map[string]any{"erro": "zoho_indisponivel"})
			return
		}
		if id == "" {
			erroDoCartao(w, http.StatusNotFound, map[string]any{"erro": "arquivo_nao_achado", "arquivo": nome})
			return
		}
		resp, err = c.Zoho.Baixar(ctx, con, id)
		var e *zoho.ErroHTTP
		if errors.As(err, &e) {
			slog.Error("vessel-baixar-cartao: download", "arquivo", nome, "status", e.Status)
			erroDoCartao(w, http.StatusBadGateway, map[string]any{"erro": "zoho_recusou", "status": e.Status})
			return
		}
		if err != nil {
			erroDoCartao(w, http.StatusBadGateway, map[string]any{"erro": "zoho_indisponivel"})
			return
		}
	}
	defer resp.Body.Close()
	// octet-stream de propósito (a tela lê como Blob); o nome vai escapado (o SKU é texto livre do lote)
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": nome}))
	w.Header().Set("Cache-Control", "no-store")
	io.Copy(w, resp.Body)
}

// acharOArquivo: o id do arquivo no dia mais novo que o tem (o dia-dica primeiro); "" se nenhum dia tem. A árvore é a
// do robô: <raiz>/Vessel Brasil/Cartões com EAN/<AAAA-MM-DD>/<SKU - Nome>/<arquivo>.
func (c *Cartao) acharOArquivo(ctx context.Context, con zoho.Conexao, sku, nome, dica string) (string, error) {
	descer := func(pasta string, achar func(zoho.Item) bool) (string, error) {
		itens, err := c.Zoho.Listar(ctx, con, pasta)
		if err != nil {
			return "", err
		}
		for _, i := range itens {
			if achar(i) {
				return i.ID, nil
			}
		}
		return "", nil
	}
	vb, err := descer(raizDasFotos, func(i zoho.Item) bool { return i.Pasta && norm.NFC.String(i.Nome) == "Vessel Brasil" })
	if err != nil || vb == "" {
		return "", err
	}
	cartoes, err := descer(vb, func(i zoho.Item) bool { return i.Pasta && ehPastaDosCartoes(i.Nome) })
	if err != nil || cartoes == "" {
		return "", err
	}
	itens, err := c.Zoho.Listar(ctx, con, cartoes)
	if err != nil {
		return "", err
	}
	for _, dia := range diasComDicaPrimeiro(diasEmOrdem(itens), dica) {
		doDia, err := c.Zoho.Listar(ctx, con, dia.ID)
		if err != nil {
			return "", err
		}
		pasta := pastaDoSku(doDia, sku)
		if pasta == nil {
			continue
		}
		id, err := descer(pasta.ID, func(i zoho.Item) bool { return !i.Pasta && i.Nome == nome })
		if err != nil || id != "" {
			return id, err
		}
	}
	return "", nil
}

func textoOuVazio(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// ── As regras de NOME do robô (supabase/functions/_shared/cartao-no-zoho.js, que repete coletor/lib/cartoes-da-fila.js).
// Se mudarem no robô, mudam aqui: TestRegrasDoCartao confere os exemplos reais de cartao-no-zoho.test.mjs.

// nomeDoArquivo: "<SKU>_cartao_<NN>_<frente|verso>.<png|pdf>"; "" se a face, o formato ou a peça não fazem sentido.
// Lista fechada: o pedido nunca escolhe caminho (../ não passa).
func nomeDoArquivo(sku string, numero int, face, formato string) string {
	if sku == "" || numero < 1 || !slices.Contains([]string{"frente", "verso"}, face) || !slices.Contains([]string{"png", "pdf"}, formato) {
		return ""
	}
	return fmt.Sprintf("%s_cartao_%02d_%s.%s", sku, numero, face, formato)
}

// diasEmOrdem: só as pastas de dia de verdade ("2026-10-06"), da mais nova para a mais velha ("… - BKP …" fica fora).
func diasEmOrdem(itens []zoho.Item) []zoho.Item {
	var dias []zoho.Item
	for _, i := range itens {
		if i.Pasta && reDia.MatchString(strings.TrimSpace(i.Nome)) {
			dias = append(dias, i)
		}
	}
	slices.SortStableFunc(dias, func(a, b zoho.Item) int { return strings.Compare(strings.TrimSpace(b.Nome), strings.TrimSpace(a.Nome)) })
	return dias
}

// diaDaPasta: o dia ("2026-10-06") de uma pasta de pedido do robô ("Cartões com EAN/2026-10-06"); "" se não for isso.
// Serve de dica, nunca de verdade.
func diaDaPasta(pasta string) string {
	partes := strings.Split(pasta, "/")
	if dia := strings.TrimSpace(partes[len(partes)-1]); reDia.MatchString(dia) {
		return dia
	}
	return ""
}

// diasComDicaPrimeiro: a mesma lista com o dia-dica na frente (os outros na ordem de antes); sem dica, a lista como veio.
func diasComDicaPrimeiro(dias []zoho.Item, dica string) []zoho.Item {
	if dica == "" {
		return dias
	}
	var frente, resto []zoho.Item
	for _, d := range dias {
		if strings.TrimSpace(d.Nome) == dica {
			frente = append(frente, d)
		} else {
			resto = append(resto, d)
		}
	}
	return append(frente, resto...)
}

// pastaDoSku: a subpasta "SKU - Nome do modelo" de um dia, pelo prefixo "SKU - " (NFC dos dois lados: "Média" pode
// vir com o acento solto, conforme quem criou a pasta). nil se não houver.
func pastaDoSku(itens []zoho.Item, sku string) *zoho.Item {
	prefixo := norm.NFC.String(sku + " - ")
	for i := range itens {
		if itens[i].Pasta && strings.HasPrefix(norm.NFC.String(itens[i].Nome), prefixo) {
			return &itens[i]
		}
	}
	return nil
}

// ehPastaDosCartoes: "Cartões com EAN", comparada sem depender de como o acento foi gravado.
func ehPastaDosCartoes(nome string) bool {
	return strings.TrimSpace(norm.NFC.String(nome)) == "Cartões com EAN"
}
