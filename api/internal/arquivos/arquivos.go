package arquivos

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/rbv-co/social-dashboard/api/internal/auth"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
	"github.com/rbv-co/social-dashboard/api/internal/dados"
)

// Servico é o Storage. Raiz = ARQUIVOS_DIR; Segredo = ARQUIVOS_SEGREDO (HMAC das URLs assinadas; vazio = assinar
// responde 503). Caminho e nome de arquivo NUNCA vão para o log nem para a mensagem de erro.
type Servico struct {
	Raiz    string
	Segredo string
	Agora   func() time.Time
	// Quem diz de onde vem o pedido: o IP do cliente e se quem chama é o Core (chave dele). nil = (auth.IPDe, false).
	Quem func(r *http.Request) (ip string, core bool)

	buckets map[string]*bucket
	once    sync.Once

	limIPCurriculo, limGlobalCurriculo, limCoreCurriculo *auth.Limitador
}

// prazoDeTransferencia: o ReadTimeout (30 s) e o WriteTimeout (150 s) do servidor cortariam um vídeo de 300 MiB; cada
// transferência estende o prazo da PRÓPRIA conexão (o resto da API segue com os prazos curtos).
const prazoDeTransferencia = 10 * time.Minute

func estender(w http.ResponseWriter) {
	rc := http.NewResponseController(w)
	rc.SetReadDeadline(time.Now().Add(prazoDeTransferencia)) // httptest não suporta: sem erro que importe
	rc.SetWriteDeadline(time.Now().Add(prazoDeTransferencia))
}

func (s *Servico) iniciar() { s.once.Do(func() { s.buckets = padrao() }) }

func (s *Servico) agora() time.Time {
	if s.Agora != nil {
		return s.Agora()
	}
	return time.Now()
}

var (
	errCaminho   = errors.New("caminho inválido")
	errTipo      = errors.New("tipo de arquivo não permitido")
	errTamanho   = errors.New("arquivo grande demais")
	errExiste    = errors.New("já existe")
	errNaoAchado = errors.New("não achado")
)

// caminhoValido: relativo, ≤ 512 bytes, UTF-8, sem NUL, controle, barra invertida, "." nem ".." e sem segmento vazio.
func caminhoValido(c string) bool {
	if c == "" || len(c) > 512 || !utf8.ValidString(c) || strings.HasPrefix(c, "/") || strings.HasSuffix(c, "/") {
		return false
	}
	for _, r := range c {
		if r < 0x20 || r == 0x7f || r == '\\' {
			return false
		}
	}
	for _, seg := range strings.Split(c, "/") {
		if seg == "" || seg == "." || seg == ".." || len(seg) > 255 {
			return false
		}
	}
	return true
}

// raiz abre a pasta do bucket como os.Root: nenhum caminho, nem link simbólico, sai dela.
func (s *Servico) raiz(b *bucket) (*os.Root, error) {
	dir := filepath.Join(s.Raiz, b.Nome)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return nil, err
	}
	return os.OpenRoot(dir)
}

// Montar: as rotas de SESSÃO (dentro do grupo auth.Exigir + autz.ComEscopo).
func (s *Servico) Montar(r chi.Router) {
	s.iniciar()
	r.Get("/arquivos/{bucket}", s.listar)
	r.Get("/arquivos/{bucket}/*", s.baixarComSessao)
	r.Put("/arquivos/{bucket}/*", s.enviar)
	r.Delete("/arquivos/{bucket}", s.apagar)
	r.Post("/arquivos/{bucket}/copiar", s.copiar)
	r.Post("/arquivos/{bucket}/assinar", s.assinar)
}

// MontarPublicas: o que não tem sessão: a URL pública de bucket público, a URL assinada e o envio de currículo.
func (s *Servico) MontarPublicas(r chi.Router) {
	s.iniciar()
	r.Get("/storage/v1/object/public/{bucket}/*", s.baixarPublico)
	r.Get("/storage/v1/object/sign/{bucket}/*", s.baixarAssinado)
	r.With(s.limitesDoCurriculo()).Post("/storage/v1/object/"+nomeCurriculos+"/{pasta}/{arquivo}", s.enviarCurriculo)
}

func (s *Servico) quem(r *http.Request) (string, bool) {
	if s.Quem != nil {
		return s.Quem(r)
	}
	return auth.IPDe(r), false
}

// cenario: bucket, caminho e (da sessão) escopo e ator; false = já respondeu.
func (s *Servico) cenario(w http.ResponseWriter, r *http.Request, comCaminho bool) (*bucket, string, *autz.Escopo, *auth.Ator, bool) {
	e, a := autz.EscopoDo(r.Context()), auth.AtorDoContexto(r.Context())
	if e == nil || a == nil || e.ID != a.ID {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return nil, "", nil, nil, false
	}
	if a.Tipo != "painel" && a.Tipo != "servico" { // sessão de cliente nunca, e antes de dizer se o bucket existe
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return nil, "", nil, nil, false
	}
	b, ok := s.buckets[chi.URLParam(r, "bucket")]
	if !ok {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return nil, "", nil, nil, false
	}
	caminho := ""
	if comCaminho {
		var err error
		if caminho, err = url.PathUnescape(chi.URLParam(r, "*")); err != nil || !caminhoValido(caminho) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Caminho de arquivo inválido.")
			return nil, "", nil, nil, false
		}
	}
	return b, caminho, e, a, true
}

// recusaDeEscrita: quem entrou como outra pessoa não grava (como as RPCs de gravar) e quem não tem a regra recebe 403.
func recusaDeEscrita(w http.ResponseWriter, a *auth.Ator) bool {
	if a.ImpersonadorID != nil {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", dados.FraseEntrarComo)
		return true
	}
	return false
}

// ---- download ----------------------------------------------------------------------------------------------

func (s *Servico) baixarComSessao(w http.ResponseWriter, r *http.Request) {
	b, c, e, a, ok := s.cenario(w, r, true)
	if !ok {
		return
	}
	if !b.Ler(e, a, c) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	s.servir(w, r, b, c, r.URL.Query().Get("baixar"))
}

func (s *Servico) baixarPublico(w http.ResponseWriter, r *http.Request) {
	b, ok := s.buckets[chi.URLParam(r, "bucket")]
	if !ok || !b.Publico { // bucket privado: 404 (não revela que existe)
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	c, err := url.PathUnescape(chi.URLParam(r, "*"))
	if err != nil || !caminhoValido(c) {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	s.servir(w, r, b, c, r.URL.Query().Get("baixar"))
}

func (s *Servico) assinatura(bucket, caminho string, exp int64, baixar string) string {
	m := hmac.New(sha256.New, []byte(s.Segredo))
	m.Write([]byte(bucket + "\n" + caminho + "\n" + strconv.FormatInt(exp, 10) + "\n" + baixar))
	return hex.EncodeToString(m.Sum(nil))
}

func (s *Servico) baixarAssinado(w http.ResponseWriter, r *http.Request) {
	b, ok := s.buckets[chi.URLParam(r, "bucket")]
	if s.Segredo == "" {
		dados.Erro(w, http.StatusServiceUnavailable, "indisponivel", "")
		return
	}
	c, err := url.PathUnescape(chi.URLParam(r, "*"))
	exp, errExp := strconv.ParseInt(r.URL.Query().Get("exp"), 10, 64)
	sig := r.URL.Query().Get("sig")
	baixar := r.URL.Query().Get("baixar")
	// assinatura primeiro: quem não a tem não descobre se o bucket ou o arquivo existe
	quer := s.assinatura(chi.URLParam(r, "bucket"), c, exp, baixar)
	if !ok || err != nil || errExp != nil || !caminhoValido(c) || !hmac.Equal([]byte(quer), []byte(sig)) {
		dados.Erro(w, http.StatusForbidden, "link_invalido", "")
		return
	}
	if s.agora().Unix() >= exp {
		dados.Erro(w, http.StatusForbidden, "link_vencido", "")
		return
	}
	s.servir(w, r, b, c, baixar)
}

// servir abre o objeto pela raiz do bucket e o entrega. O tipo é o da EXTENSÃO (o que o cliente mandou no envio não é
// guardado); só imagem raster, vídeo e PDF saem inline: todo o resto vai como attachment, octet-stream, com `nosniff` e
// `Content-Security-Policy: sandbox` (um .html ou .svg do banco de arquivos nunca renderiza na origem da API).
func (s *Servico) servir(w http.ResponseWriter, r *http.Request, b *bucket, c, baixar string) {
	raiz, err := s.raiz(b)
	if err != nil {
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
		return
	}
	defer raiz.Close()
	f, err := raiz.Open(c)
	if err != nil {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	tipo := tipoPelaExtensao[strings.ToLower(path.Ext(c))]
	if tipo == "" {
		tipo = octetStream
	}
	estender(w)
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	if b.Publico {
		h.Set("Cache-Control", "public, max-age=3600")
	} else {
		h.Set("Cache-Control", "private, no-store")
	}
	if semRisco[tipo] && baixar == "" {
		if tipo != "application/pdf" { // o visualizador de PDF do navegador não abre sob `sandbox`
			h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
		}
		h.Set("Content-Type", tipo)
	} else {
		h.Set("Content-Security-Policy", "default-src 'none'; sandbox")
		if !semRisco[tipo] {
			tipo = octetStream
			if t := tipoPelaExtensao[strings.ToLower(path.Ext(c))]; t == "image/svg+xml" {
				tipo = t // <img> embute SVG sem executar nada; o attachment impede abrir direto
			}
		}
		h.Set("Content-Type", tipo)
		nome := baixar
		if nome == "" || nome == "true" {
			nome = path.Base(c)
		}
		h.Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": nome}))
	}
	http.ServeContent(w, r, "", st.ModTime(), f)
}

// ---- envio -------------------------------------------------------------------------------------------------

// conferirTipo: o tipo declarado tem de estar na lista do bucket; sem octet-stream na lista, a extensão tem de
// combinar com o tipo; e o conteúdo não pode ser o que o tipo diz que não é (HTML ou XML em "imagem"). O que o
// DetectContentType não conhece (HEIC, MOV, DOCX, DOC) não é barrado por ele: só o HTML/XML disfarçado.
func conferirTipo(b *bucket, caminho, declarado string, comeco []byte) error {
	declarado, _, err := mime.ParseMediaType(declarado)
	if err != nil {
		declarado = octetStream
	}
	if !b.Tipos[declarado] {
		return errTipo
	}
	if !b.Tipos[octetStream] {
		if !slices.Contains(extensoesDe[declarado], strings.ToLower(path.Ext(caminho))) {
			return errTipo
		}
	}
	farejado, _, _ := mime.ParseMediaType(http.DetectContentType(comeco))
	switch declarado {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf":
		if farejado != declarado {
			return errTipo
		}
	case "text/html", "text/xml", "application/xml", "image/svg+xml", "text/plain", "text/csv", "text/markdown", "application/json",
		"application/javascript", "text/javascript", "text/css", octetStream:
		// o banco de arquivos aceita texto e executável de propósito (download sempre como attachment)
	default:
		if farejado == "text/html" || farejado == "text/xml" {
			return errTipo
		}
	}
	return nil
}

func nomeTemporario() string {
	var b [8]byte
	rand.Read(b[:])
	return ".envio-" + hex.EncodeToString(b[:])
}

// gravar escreve o corpo (≤ b.Max) num temporário na MESMA pasta e o coloca no lugar: `link` (falha se existe: 409) ou
// `rename` (upsert). Quem lê nunca vê meio arquivo.
func (s *Servico) gravar(b *bucket, caminho, declarado string, corpo io.Reader, upsert bool) error {
	raiz, err := s.raiz(b)
	if err != nil {
		return err
	}
	defer raiz.Close()
	comeco := make([]byte, 512)
	n, err := io.ReadFull(corpo, comeco)
	if err != nil && !errors.Is(err, io.ErrUnexpectedEOF) && !errors.Is(err, io.EOF) {
		return err
	}
	comeco = comeco[:n]
	if n == 0 {
		return errTipo // arquivo vazio
	}
	if err := conferirTipo(b, caminho, declarado, comeco); err != nil {
		return err
	}
	if dir := path.Dir(caminho); dir != "." {
		if err := raiz.MkdirAll(dir, 0o750); err != nil {
			return err
		}
	}
	tmp := path.Join(path.Dir(caminho), nomeTemporario())
	f, err := raiz.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o640)
	if err != nil {
		return err
	}
	pronto := false
	defer func() {
		f.Close()
		if !pronto {
			raiz.Remove(tmp)
		}
	}()
	lim := &io.LimitedReader{R: corpo, N: b.Max - int64(n) + 1}
	if _, err := f.Write(comeco); err != nil {
		return err
	}
	if _, err := io.Copy(f, lim); err != nil {
		return err
	}
	if lim.N <= 0 { // passou do teto
		return errTamanho
	}
	if err := f.Close(); err != nil {
		return err
	}
	if upsert {
		if err := raiz.Rename(tmp, caminho); err != nil {
			return err
		}
	} else {
		if err := raiz.Link(tmp, caminho); err != nil {
			if errors.Is(err, fs.ErrExist) {
				return errExiste
			}
			return err
		}
		raiz.Remove(tmp)
	}
	pronto = true
	return nil
}

func respostaDeErro(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, errTipo):
		dados.Erro(w, http.StatusUnsupportedMediaType, "tipo_nao_permitido", "Este tipo de arquivo não é aceito aqui.")
	case errors.Is(err, errTamanho):
		dados.Erro(w, http.StatusRequestEntityTooLarge, "arquivo_grande_demais", "O arquivo passa do tamanho permitido.")
	case errors.Is(err, errExiste):
		dados.Erro(w, http.StatusConflict, "conflito", "Já existe um arquivo com esse nome.")
	case errors.Is(err, errCaminho):
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Caminho de arquivo inválido.")
	case errors.Is(err, errNaoAchado):
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
	default:
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			dados.Erro(w, http.StatusRequestEntityTooLarge, "arquivo_grande_demais", "O arquivo passa do tamanho permitido.")
			return
		}
		slog.Error("arquivos", "erro", "falha no disco") // o texto do erro do sistema leva o caminho: não vai ao log
		dados.Erro(w, http.StatusInternalServerError, "erro_interno", "")
	}
}

func (s *Servico) enviar(w http.ResponseWriter, r *http.Request) {
	b, c, e, a, ok := s.cenario(w, r, true)
	if !ok {
		return
	}
	if !b.Escrever(e, a, c) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	if recusaDeEscrita(w, a) {
		return
	}
	if r.ContentLength > b.Max {
		dados.Erro(w, http.StatusRequestEntityTooLarge, "arquivo_grande_demais", "O arquivo passa do tamanho permitido.")
		return
	}
	estender(w)
	upsert := strings.EqualFold(r.Header.Get("x-upsert"), "true")
	if err := s.gravar(b, c, r.Header.Get("Content-Type"), http.MaxBytesReader(w, r.Body, b.Max+1), upsert); err != nil {
		respostaDeErro(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"Key": b.Nome + "/" + c})
}

// ---- apagar, copiar, listar, assinar -----------------------------------------------------------------------

type pedidoDeCaminhos struct {
	Caminhos []string `json:"caminhos"`
	Segundos int      `json:"segundos"`
	Baixar   string   `json:"baixar"`
}

func (s *Servico) apagar(w http.ResponseWriter, r *http.Request) {
	b, _, e, a, ok := s.cenario(w, r, false)
	if !ok {
		return
	}
	var in pedidoDeCaminhos
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	if len(in.Caminhos) == 0 || len(in.Caminhos) > 1000 {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 1000 caminhos.")
		return
	}
	for _, c := range in.Caminhos { // tudo ou nada: um caminho sem permissão derruba o pedido inteiro, antes de apagar qualquer um
		if !caminhoValido(c) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Caminho de arquivo inválido.")
			return
		}
		if !b.Apagar(e, a, c) {
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
	}
	if recusaDeEscrita(w, a) {
		return
	}
	raiz, err := s.raiz(b)
	if err != nil {
		respostaDeErro(w, err)
		return
	}
	defer raiz.Close()
	apagados := []map[string]string{}
	for _, c := range in.Caminhos {
		if st, err := raiz.Lstat(c); err != nil || !st.Mode().IsRegular() {
			continue // não existe (ou é pasta): como o Storage, não é erro
		}
		if err := raiz.Remove(c); err == nil {
			apagados = append(apagados, map[string]string{"name": c})
		}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(apagados)
}

func (s *Servico) copiar(w http.ResponseWriter, r *http.Request) {
	b, _, e, a, ok := s.cenario(w, r, false)
	if !ok {
		return
	}
	var in struct{ De, Para string }
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	if !caminhoValido(in.De) || !caminhoValido(in.Para) {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Caminho de arquivo inválido.")
		return
	}
	if !b.Ler(e, a, in.De) || !b.Escrever(e, a, in.Para) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	if recusaDeEscrita(w, a) {
		return
	}
	raiz, err := s.raiz(b)
	if err != nil {
		respostaDeErro(w, err)
		return
	}
	origem, err := raiz.Open(in.De)
	if err != nil {
		dados.Erro(w, http.StatusNotFound, "nao_encontrado", "")
		return
	}
	defer origem.Close()
	raiz.Close()
	// o destino passa pelas MESMAS conferências do envio (tipo pela extensão, tamanho, sem sobrescrever)
	tipo := tipoPelaExtensao[strings.ToLower(path.Ext(in.Para))]
	if tipo == "" {
		tipo = octetStream
	}
	if err := s.gravar(b, in.Para, tipo, origem, false); err != nil {
		respostaDeErro(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"Key": b.Nome + "/" + in.Para})
}

func (s *Servico) listar(w http.ResponseWriter, r *http.Request) {
	b, _, e, a, ok := s.cenario(w, r, false)
	if !ok {
		return
	}
	prefixo := strings.Trim(r.URL.Query().Get("prefixo"), "/")
	if prefixo != "" && !caminhoValido(prefixo) {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Caminho de arquivo inválido.")
		return
	}
	if !b.Ler(e, a, prefixo) {
		dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
		return
	}
	limite := 100
	if v, err := strconv.Atoi(r.URL.Query().Get("limite")); err == nil && v > 0 {
		limite = min(v, 1000)
	}
	raiz, err := s.raiz(b)
	if err != nil {
		respostaDeErro(w, err)
		return
	}
	defer raiz.Close()
	dir := prefixo
	if dir == "" {
		dir = "."
	}
	pasta, err := raiz.Open(dir)
	if err != nil {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("[]"))
		return
	}
	defer pasta.Close()
	entradas, err := pasta.ReadDir(-1)
	if err != nil {
		respostaDeErro(w, err)
		return
	}
	type item struct {
		Name      string         `json:"name"`
		ID        *string        `json:"id"`
		UpdatedAt *time.Time     `json:"updated_at"`
		CreatedAt *time.Time     `json:"created_at"`
		Metadata  map[string]any `json:"metadata"`
	}
	var itens []item
	for _, en := range entradas {
		if strings.HasPrefix(en.Name(), ".envio-") {
			continue
		}
		it := item{Name: en.Name()}
		if en.Type().IsRegular() {
			if st, err := en.Info(); err == nil {
				t := st.ModTime().UTC()
				id := b.Nome + "/" + path.Join(prefixo, en.Name())
				tipo := tipoPelaExtensao[strings.ToLower(path.Ext(en.Name()))]
				if tipo == "" {
					tipo = octetStream
				}
				it.ID, it.UpdatedAt, it.CreatedAt = &id, &t, &t
				it.Metadata = map[string]any{"size": st.Size(), "mimetype": tipo}
			}
		} else if !en.IsDir() {
			continue // link simbólico e especiais não são objetos
		}
		itens = append(itens, it)
	}
	desc := r.URL.Query().Get("ordem") == "desc"
	slices.SortFunc(itens, func(x, y item) int {
		if desc {
			return strings.Compare(y.Name, x.Name)
		}
		return strings.Compare(x.Name, y.Name)
	})
	if len(itens) > limite {
		itens = itens[:limite]
	}
	if itens == nil {
		itens = []item{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(itens)
}

func (s *Servico) assinar(w http.ResponseWriter, r *http.Request) {
	b, _, e, a, ok := s.cenario(w, r, false)
	if !ok {
		return
	}
	if s.Segredo == "" {
		dados.Erro(w, http.StatusServiceUnavailable, "indisponivel", "")
		return
	}
	var in pedidoDeCaminhos
	if !dados.LerCorpo(w, r, &in) {
		return
	}
	if len(in.Caminhos) == 0 || len(in.Caminhos) > 200 || len(in.Baixar) > 200 {
		dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Mande de 1 a 200 caminhos.")
		return
	}
	if in.Segundos <= 0 {
		in.Segundos = 60
	}
	in.Segundos = min(in.Segundos, 3600)
	for _, c := range in.Caminhos {
		if !caminhoValido(c) {
			dados.Erro(w, http.StatusBadRequest, "pedido_invalido", "Caminho de arquivo inválido.")
			return
		}
		if !b.Ler(e, a, c) { // quem não pode ler não assina: o link só repete uma permissão que a pessoa já tinha
			dados.Erro(w, http.StatusForbidden, "sem_permissao", "")
			return
		}
	}
	raiz, err := s.raiz(b)
	if err != nil {
		respostaDeErro(w, err)
		return
	}
	defer raiz.Close()
	exp := s.agora().Add(time.Duration(in.Segundos) * time.Second).Unix()
	type par struct {
		Caminho string  `json:"caminho"`
		URL     *string `json:"url"`
		Erro    *string `json:"erro"`
	}
	saida := make([]par, 0, len(in.Caminhos))
	for _, c := range in.Caminhos {
		if st, err := raiz.Stat(c); err != nil || !st.Mode().IsRegular() {
			msg := "Objeto não encontrado"
			saida = append(saida, par{Caminho: c, Erro: &msg})
			continue
		}
		q := url.Values{"exp": {strconv.FormatInt(exp, 10)}, "sig": {s.assinatura(b.Nome, c, exp, in.Baixar)}}
		if in.Baixar != "" {
			q.Set("baixar", in.Baixar)
		}
		u := "/storage/v1/object/sign/" + b.Nome + "/" + escaparCaminho(c) + "?" + q.Encode()
		saida = append(saida, par{Caminho: c, URL: &u})
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(saida)
}

func escaparCaminho(c string) string {
	partes := strings.Split(c, "/")
	for i, p := range partes {
		partes[i] = url.PathEscape(p)
	}
	return strings.Join(partes, "/")
}
