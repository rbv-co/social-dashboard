package arquivos

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"
)

type amostra struct {
	bucket, caminho, tipo string
	corpo                 []byte
	// quem pode, em cada operação (a regra do bucket, escrita independente da implementação)
	ler, escrever, apagar []string
}

var todasAsPessoas = []string{"super", "admin", "acessos", "conteudo", "banco-ver", "banco-criar", "banco-excluir", "gestor", "leitor",
	"robo-meta", "robo-fabrica", "fabricante", "robo-triagem"}

var daAcessos = []string{"admin", "acessos"}

var amostras = []amostra{
	{"acessos-avatars", "a.png", "image/png", png, todasAsPessoas, daAcessos, daAcessos},
	{"acessos-termos", "t.pdf", "application/pdf", pdf, daAcessos, daAcessos, daAcessos},
	{"arquivos", "relatorio.pdf", "application/pdf", pdf, []string{"super", "banco-ver", "banco-criar", "banco-excluir"},
		[]string{"super", "banco-criar"}, []string{"super", "banco-excluir"}},
	{"avatars", "u.png", "image/png", png, todasAsPessoas, []string{"super", "admin"}, []string{"super", "admin"}},
	{"conteudo", "c.jpg", "image/jpeg", jpg, []string{"super", "admin", "conteudo"}, []string{"super", "admin", "conteudo"}, []string{"super", "admin", "conteudo"}},
	{"fabrica-criativos", "gestor-envios/x.png", "image/png", png, todasAsPessoas, []string{"super", "admin", "gestor"}, []string{"super", "admin", "gestor"}},
	{"fabrica-criativos", "estudio/x.png", "image/png", png, todasAsPessoas, []string{"super", "admin", "robo-fabrica", "fabricante"}, []string{"super", "admin", "robo-fabrica", "fabricante"}},
	// o robô da Fábrica também tem o módulo meta (5.13): qualquer SERVIÇO com meta escreve as fotos de perfil
	{"profile-pics", "p.jpg", "image/jpeg", jpg, todasAsPessoas, []string{"super", "robo-meta", "robo-fabrica"}, []string{"super", "robo-meta", "robo-fabrica"}},
	{"publico", "p.png", "image/png", png, todasAsPessoas, []string{"super"}, []string{"super"}},
}

// A matriz bucket × pessoa × operação: a regra de cada bucket (policies de produção onde existem, as telas onde não)
// provada pelo HTTP. Recusa = 403 e o disco intacto; permissão = 200 e o efeito no disco.
func TestMatrizBucketPorPessoa(t *testing.T) {
	m := novoMundo(t)
	for _, a := range amostras {
		for _, quem := range todasAsPessoas {
			rotulo := fmt.Sprintf("%s/%s como %s", a.bucket, a.caminho, quem)
			// escrever
			m.apaga(a.bucket, a.caminho)
			st, r := m.envia(t, quem, a.bucket, a.caminho, a.tipo, a.corpo)
			if quer := slices.Contains(a.escrever, quem); (st == 200) != quer || (!quer && (st != 403 || m.existe(a.bucket, a.caminho))) || (quer && !bytes.Equal(m.lê(t, a.bucket, a.caminho), a.corpo)) {
				t.Errorf("%s: PUT = %d %.80s, esperava permitido=%t", rotulo, st, r, quer)
			}
			// ler (objeto e lista)
			m.planta(t, a.bucket, a.caminho, a.corpo)
			stL, _, h := m.pede(t, quem, "GET", "/arquivos/"+a.bucket+"/"+a.caminho, "")
			if quer := slices.Contains(a.ler, quem); (stL == 200) != quer || (!quer && stL != 403) {
				t.Errorf("%s: GET = %d, esperava permitido=%t", rotulo, stL, quer)
			} else if quer && h.Get("X-Content-Type-Options") != "nosniff" {
				t.Errorf("%s: GET sem nosniff", rotulo)
			}
			prefixo := ""
			if i := strings.LastIndex(a.caminho, "/"); i >= 0 {
				prefixo = a.caminho[:i]
			}
			stLista, _, _ := m.pede(t, quem, "GET", "/arquivos/"+a.bucket+"?prefixo="+prefixo, "")
			if quer := slices.Contains(a.ler, quem); (stLista == 200) != quer {
				t.Errorf("%s: lista = %d, esperava permitido=%t", rotulo, stLista, quer)
			}
			// apagar
			corpo, _ := json.Marshal(map[string]any{"caminhos": []string{a.caminho}})
			stA, _, _ := m.pede(t, quem, "DELETE", "/arquivos/"+a.bucket, string(corpo))
			if quer := slices.Contains(a.apagar, quem); (stA == 200) != quer || (quer == m.existe(a.bucket, a.caminho)) || (!quer && stA != 403) {
				t.Errorf("%s: DELETE = %d (arquivo existe=%t), esperava permitido=%t", rotulo, stA, m.existe(a.bucket, a.caminho), quer)
			}
		}
	}
	// conta desativada: a sessão nem passa; sem sessão, 401; bucket que não existe, 404 para quem está logado
	if st, _, _ := m.pede(t, "desativado", "GET", "/arquivos/conteudo", ""); st != 401 {
		t.Errorf("desativado = %d, esperava 401", st)
	}
	if st, _, _ := m.pede(t, "", "GET", "/arquivos/conteudo", ""); st != 401 {
		t.Errorf("sem sessão = %d, esperava 401", st)
	}
	if st, _, _ := m.pede(t, "super", "GET", "/arquivos/ig-cache", ""); st != 404 {
		t.Errorf("bucket de fora (ig-cache) = %d, esperava 404", st)
	}
	// vessel-curriculos: só o serviço (e o super) lê e apaga; ninguém envia por sessão (só a rota de currículo)
	m.planta(t, "vessel-curriculos", "consultor-tivoli/cv.pdf", pdf)
	for quem, quer := range map[string]bool{"super": true, "robo-triagem": true, "robo-meta": true, "admin": false, "acessos": false, "leitor": false} {
		if st, _, _ := m.pede(t, quem, "GET", "/arquivos/vessel-curriculos/consultor-tivoli/cv.pdf", ""); (st == 200) != quer {
			t.Errorf("currículo como %s = %d, esperava permitido=%t", quem, st, quer)
		}
	}
	for _, quem := range []string{"super", "robo-triagem", "admin"} {
		if st, _ := m.envia(t, quem, "vessel-curriculos", "consultor-tivoli/novo.pdf", "application/pdf", pdf); st != 403 {
			t.Errorf("envio de currículo por sessão como %s = %d, esperava 403 (só a rota de currículo envia)", quem, st)
		}
	}
}

func (m *mundo) apaga(bucket, caminho string) {
	os.Remove(filepath.Join(m.Dir, bucket, filepath.FromSlash(caminho)))
}

// "Entrar como" não grava (envio, apagar, copiar), mas lê como a pessoa vê.
func TestEntrarComoNaoGravaArquivo(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "conteudo", "c.jpg", jpg)
	if st, _ := m.envia(t, "impersonado", "conteudo", "novo.jpg", "image/jpeg", jpg); st != 403 || m.existe("conteudo", "novo.jpg") {
		t.Errorf("envio como entrar-como = %d (existe=%t)", st, m.existe("conteudo", "novo.jpg"))
	}
	if st, _, _ := m.pede(t, "impersonado", "DELETE", "/arquivos/conteudo", `{"caminhos":["c.jpg"]}`); st != 403 || !m.existe("conteudo", "c.jpg") {
		t.Errorf("apagar como entrar-como = %d", st)
	}
	if st, _, _ := m.pede(t, "impersonado", "POST", "/arquivos/conteudo/copiar", `{"de":"c.jpg","para":"d.jpg"}`); st != 403 || m.existe("conteudo", "d.jpg") {
		t.Errorf("copiar como entrar-como = %d", st)
	}
	if st, _, _ := m.pede(t, "impersonado", "GET", "/arquivos/conteudo/c.jpg", ""); st != 200 {
		t.Errorf("ler como entrar-como = %d, esperava 200", st)
	}
}

// Apagar é tudo ou nada: um caminho sem permissão derruba o pedido inteiro ANTES de apagar qualquer um.
func TestApagarTudoOuNada(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "fabrica-criativos", "gestor-envios/a.png", png)
	m.planta(t, "fabrica-criativos", "estudio/b.png", png)
	st, _, _ := m.pede(t, "gestor", "DELETE", "/arquivos/fabrica-criativos", `{"caminhos":["gestor-envios/a.png","estudio/b.png"]}`)
	if st != 403 || !m.existe("fabrica-criativos", "gestor-envios/a.png") || !m.existe("fabrica-criativos", "estudio/b.png") {
		t.Errorf("pedido misto = %d (a.png existe=%t, b.png existe=%t)", st, m.existe("fabrica-criativos", "gestor-envios/a.png"), m.existe("fabrica-criativos", "estudio/b.png"))
	}
	for corpo, quer := range map[string]int{`{"caminhos":[]}`: 400, `{}`: 400, `{"caminhos":["../x"]}`: 400, `{"caminhos":["a"],"extra":1}`: 400} {
		if st, _, _ := m.pede(t, "super", "DELETE", "/arquivos/publico", corpo); st != quer {
			t.Errorf("DELETE %s = %d, esperava %d", corpo, st, quer)
		}
	}
	// apagar o que não existe não é erro (como o Storage): devolve só o que apagou
	st, r, _ := m.pede(t, "super", "DELETE", "/arquivos/publico", `{"caminhos":["nao-existe.png"]}`)
	if st != 200 || strings.TrimSpace(r) != "[]" {
		t.Errorf("apagar o que não existe = %d %s", st, r)
	}
}

// Tipo, extensão e conteúdo: HTML disfarçado de imagem, extensão que não combina, tipo fora da lista, arquivo vazio,
// e o que o DetectContentType não conhece (docx, heic, mov) passa pelo tipo declarado + extensão.
func TestTipoDoEnvio(t *testing.T) {
	m := novoMundo(t)
	heic := append([]byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"), bytes.Repeat([]byte{0}, 40)...)
	for _, c := range []struct {
		nome, bucket, caminho, tipo string
		corpo                       []byte
		quer                        int
	}{
		{"html como png", "conteudo", "a.png", "image/png", html, 415},
		{"html com nome .html declarado imagem", "conteudo", "a.html", "image/png", png, 415},
		{"png com nome .jpg", "conteudo", "a.jpg", "image/png", png, 415},
		{"jpeg declarado png", "conteudo", "a.png", "image/png", jpg, 415},
		{"tipo fora da lista", "conteudo", "a.gif", "image/gif", png, 415},
		{"octet-stream no bucket restrito", "conteudo", "a.png", "application/octet-stream", png, 415},
		{"svg no avatar", "avatars", "a.svg", "image/svg+xml", []byte("<svg onload=alert(1)/>"), 415},
		{"vazio", "conteudo", "a.png", "image/png", nil, 415},
		{"png certo", "conteudo", "ok.png", "image/png", png, 200},
		{"mp4 certo", "conteudo", "v.mp4", "video/mp4", mp4, 200},
		{"mp4 com charset no tipo", "conteudo", "v2.mp4", "video/mp4; foo=bar", mp4, 200},
		{"docx (zip) nos termos", "acessos-termos", "t.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip_, 200},
		{"docx com HTML dentro", "acessos-termos", "t2.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", html, 415},
		{"banco de arquivos aceita html (vira download)", "arquivos", "pagina.html", "text/html", html, 200},
		{"banco de arquivos aceita executável", "arquivos", "instalar.sh", "application/x-sh", []byte("#!/bin/sh\necho oi\n"), 200},
		{"banco recusa o que não está na lista", "arquivos", "x.flac", "audio/flac", []byte("fLaC"), 415},
	} {
		quem := "super"
		if c.bucket == "acessos-termos" {
			quem = "admin" // is_acessos_admin: papel admin ou módulo acessos (super de papel viewer não é)
		}
		st, r := m.envia(t, quem, c.bucket, c.caminho, c.tipo, c.corpo)
		if st != c.quer {
			t.Errorf("%s: PUT = %d %.80s, esperava %d", c.nome, st, r, c.quer)
		}
		if c.quer != 200 && m.existe(c.bucket, c.caminho) {
			t.Errorf("%s: o arquivo recusado ficou no disco", c.nome)
		}
	}
	_ = heic
	if s := m.sobras(t); len(s) != 0 {
		t.Errorf("envio recusado deixou temporário: %v", s)
	}
}

// Tamanho: o teto do bucket vale com e sem Content-Length (corpo em pedaços), e o arquivo recusado não fica.
func TestTamanhoDoEnvio(t *testing.T) {
	m := novoMundo(t)
	grande := append(append([]byte{}, png...), bytes.Repeat([]byte{1}, int(2*MiB))...) // avatars: teto de 2 MiB
	if st, _ := m.envia(t, "super", "avatars", "g.png", "image/png", grande); st != 413 || m.existe("avatars", "g.png") {
		t.Errorf("acima do teto = %d (existe=%t), esperava 413", st, m.existe("avatars", "g.png"))
	}
	// sem Content-Length (chunked): o MaxBytesReader corta do mesmo jeito
	r := httptest.NewRequest("PUT", "/arquivos/avatars/h.png", io_reader(grande))
	r.ContentLength = -1
	r.Header.Set("Content-Type", "image/png")
	r.Header.Set("Authorization", "Bearer "+m.Tok["super"])
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	if w.Code != 413 || m.existe("avatars", "h.png") {
		t.Errorf("sem Content-Length = %d (existe=%t), esperava 413", w.Code, m.existe("avatars", "h.png"))
	}
	// exatamente no teto passa
	exato := append(append([]byte{}, png...), bytes.Repeat([]byte{1}, int(2*MiB)-len(png))...)
	if st, r := m.envia(t, "super", "avatars", "e.png", "image/png", exato); st != 200 {
		t.Errorf("exatamente no teto = %d %s", st, r)
	}
	if s := m.sobras(t); len(s) != 0 {
		t.Errorf("temporários: %v", s)
	}
}

func io_reader(b []byte) *bytes.Reader { return bytes.NewReader(b) }

// Caminho: ".." , absoluto, barra invertida, NUL, segmento vazio, longo demais e codificações: nada sai da pasta do bucket.
func TestCaminhoMaliciosoNaoSaiDoBucket(t *testing.T) {
	m := novoMundo(t)
	fora := filepath.Join(m.Dir, "fora.png")
	os.WriteFile(fora, png, 0o640)
	m.planta(t, "publico", "ok.png", png)
	for _, c := range []string{"../fora.png", "..%2Ffora.png", "a/../../fora.png", "%2e%2e/fora.png", "a//b.png", "a%5Cb.png", "a%00.png", "./x.png",
		strings.Repeat("a", 300) + ".png", strings.Repeat("d/", 300) + "x.png", "%FF%FE.png", "x%0A.png"} {
		for _, metodo := range []string{"PUT", "GET"} {
			r := httptest.NewRequest(metodo, "/arquivos/publico/"+c, bytes.NewReader(png))
			r.Header.Set("Content-Type", "image/png")
			r.Header.Set("Authorization", "Bearer "+m.Tok["super"])
			w := httptest.NewRecorder()
			m.H.ServeHTTP(w, r)
			if w.Code == 200 {
				t.Errorf("%s %q = 200: caminho malicioso aceito", metodo, c)
			}
		}
		// pela rota pública também
		if st, _, _ := m.publico(t, "/storage/v1/object/public/publico/"+c); st == 200 {
			t.Errorf("GET público %q = 200", c)
		}
	}
	if b, _ := os.ReadFile(fora); !bytes.Equal(b, png) {
		t.Error("um arquivo fora do bucket foi alterado")
	}
	entradas, _ := os.ReadDir(m.Dir)
	for _, e := range entradas {
		if e.Name() != "publico" && e.Name() != "fora.png" {
			t.Errorf("surgiu %q na raiz do disco", e.Name())
		}
	}
}

// Link simbólico DENTRO do bucket apontando para fora (alguém com acesso ao disco, ou um bug futuro): nem ler, nem
// sobrescrever, nem apagar o alvo.
func TestLinkSimbolicoNaoLeva_ParaFora(t *testing.T) {
	m := novoMundo(t)
	alvo := filepath.Join(m.Dir, "segredo-fora.txt")
	os.WriteFile(alvo, []byte("SEGREDO-DO-SERVIDOR"), 0o640)
	os.MkdirAll(filepath.Join(m.Dir, "publico"), 0o750)
	if err := os.Symlink(alvo, filepath.Join(m.Dir, "publico", "atalho.png")); err != nil {
		t.Skip("sem symlink neste ambiente")
	}
	os.Symlink(m.Dir, filepath.Join(m.Dir, "publico", "pasta-fora"))
	st, r, _ := m.pede(t, "super", "GET", "/arquivos/publico/atalho.png", "")
	if st == 200 || strings.Contains(r, "SEGREDO") {
		t.Errorf("ler pelo link = %d %s", st, r)
	}
	if st, r, _ := m.pede(t, "super", "GET", "/arquivos/publico/pasta-fora/segredo-fora.txt", ""); st == 200 || strings.Contains(r, "SEGREDO") {
		t.Errorf("ler pela pasta-link = %d", st)
	}
	m.envia(t, "super", "publico", "atalho.png", "image/png", png, "x-upsert: true")
	m.envia(t, "super", "publico", "pasta-fora/novo.png", "image/png", png)
	m.pede(t, "super", "DELETE", "/arquivos/publico", `{"caminhos":["atalho.png","pasta-fora/segredo-fora.txt"]}`)
	if b, _ := os.ReadFile(alvo); string(b) != "SEGREDO-DO-SERVIDOR" {
		t.Errorf("o alvo do link foi alterado ou apagado: %q", b)
	}
	if m.existeFora("novo.png") {
		t.Error("escreveu pela pasta-link")
	}
}

func (m *mundo) existeFora(nome string) bool {
	_, err := os.Stat(filepath.Join(m.Dir, nome))
	return err == nil
}

// Duas gravações do mesmo caminho: sem upsert = 409 (o arquivo antigo fica); com upsert troca inteiro.
func TestMesmoArquivoDuasVezes(t *testing.T) {
	m := novoMundo(t)
	a, b := append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("A"), 200)...), append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte("B"), 300)...)
	if st, _ := m.envia(t, "super", "publico", "doc.pdf", "application/pdf", a); st != 200 {
		t.Fatalf("primeiro envio = %d", st)
	}
	if st, _ := m.envia(t, "super", "publico", "doc.pdf", "application/pdf", b); st != 409 || !bytes.Equal(m.lê(t, "publico", "doc.pdf"), a) {
		t.Errorf("segundo sem upsert = %d (o antigo deve ficar)", st)
	}
	if st, _ := m.envia(t, "super", "publico", "doc.pdf", "application/pdf", b, "x-upsert: true"); st != 200 || !bytes.Equal(m.lê(t, "publico", "doc.pdf"), b) {
		t.Errorf("com upsert = %d (o novo deve entrar)", st)
	}
	// 12 envios ao mesmo tempo: sem upsert, exatamente um entra; com upsert todos dão 200 e o arquivo é UM dos corpos, inteiro
	var wg sync.WaitGroup
	var mu sync.Mutex
	codigos := map[int]int{}
	corpos := make([][]byte, 12)
	for i := range corpos {
		corpos[i] = append([]byte("%PDF-1.4\n"), bytes.Repeat([]byte{byte('a' + i)}, 5000+i)...)
	}
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _ := m.envia(t, "super", "publico", "corrida.pdf", "application/pdf", corpos[i])
			mu.Lock()
			codigos[st]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	if codigos[200] != 1 || codigos[409] != 11 {
		t.Errorf("12 envios simultâneos sem upsert: %v, esperava um 200 e onze 409", codigos)
	}
	codigos = map[int]int{}
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			st, _ := m.envia(t, "super", "publico", "troca.pdf", "application/pdf", corpos[i], "x-upsert: true")
			mu.Lock()
			codigos[st]++
			mu.Unlock()
		}()
	}
	wg.Wait()
	final := m.lê(t, "publico", "troca.pdf")
	inteiro := false
	for _, c := range corpos {
		inteiro = inteiro || bytes.Equal(final, c)
	}
	if codigos[200] != 12 || !inteiro {
		t.Errorf("12 envios simultâneos com upsert: %v, arquivo inteiro de um deles = %t", codigos, inteiro)
	}
	if s := m.sobras(t); len(s) != 0 {
		t.Errorf("temporários que sobraram: %v", s)
	}
}

// Copiar passa pelas MESMAS regras do envio (destino com tipo coerente, sem sobrescrever) e das duas permissões.
func TestCopiar(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "conteudo", "a.jpg", jpg)
	if st, r, _ := m.pede(t, "conteudo", "POST", "/arquivos/conteudo/copiar", `{"de":"a.jpg","para":"pasta/b.jpg"}`); st != 200 || !bytes.Equal(m.lê(t, "conteudo", "pasta/b.jpg"), jpg) {
		t.Errorf("copiar = %d %s", st, r)
	}
	for corpo, quer := range map[string]int{
		`{"de":"a.jpg","para":"pasta/b.jpg"}`:    409, // já existe
		`{"de":"a.jpg","para":"a.html"}`:         415, // destino com extensão que não é do bucket
		`{"de":"nao-existe.jpg","para":"c.jpg"}`: 404,
		`{"de":"../x","para":"c.jpg"}`:           400,
	} {
		if st, _, _ := m.pede(t, "conteudo", "POST", "/arquivos/conteudo/copiar", corpo); st != quer {
			t.Errorf("copiar %s = %d, esperava %d", corpo, st, quer)
		}
	}
	if st, _, _ := m.pede(t, "leitor", "POST", "/arquivos/conteudo/copiar", `{"de":"a.jpg","para":"z.jpg"}`); st != 403 || m.existe("conteudo", "z.jpg") {
		t.Errorf("copiar sem permissão = %d", st)
	}
}

// A lista: forma do Supabase (name, id, updated_at, metadata.size), pasta sem metadata, ordem, limite, sem temporários.
func TestLista(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "publico", "b.png", png)
	m.planta(t, "publico", "a.pdf", pdf)
	m.planta(t, "publico", "pasta/c.png", png)
	m.planta(t, "publico", ".envio-temporario", png)
	_, r, _ := m.pede(t, "super", "GET", "/arquivos/publico?ordem=asc", "")
	var itens []struct {
		Name     string
		ID       *string
		Metadata map[string]any
	}
	if err := json.Unmarshal([]byte(r), &itens); err != nil || len(itens) != 3 {
		t.Fatalf("lista = %s (%v)", r, err)
	}
	if itens[0].Name != "a.pdf" || itens[0].Metadata["size"] != float64(len(pdf)) || itens[0].Metadata["mimetype"] != "application/pdf" ||
		itens[1].Name != "b.png" || itens[2].Name != "pasta" || itens[2].ID != nil || itens[2].Metadata != nil {
		t.Errorf("itens = %+v", itens)
	}
	_, r2, _ := m.pede(t, "super", "GET", "/arquivos/publico?ordem=desc&limite=1", "")
	if !strings.Contains(r2, `"pasta"`) || strings.Contains(r2, "a.pdf") {
		t.Errorf("desc com limite 1 = %s", r2)
	}
	_, r3, _ := m.pede(t, "super", "GET", "/arquivos/publico?prefixo=pasta", "")
	if !strings.Contains(r3, "c.png") {
		t.Errorf("lista da pasta = %s", r3)
	}
	if st, r4, _ := m.pede(t, "super", "GET", "/arquivos/publico?prefixo=nao/existe", ""); st != 200 || strings.TrimSpace(r4) != "[]" {
		t.Errorf("pasta que não existe = %d %s", st, r4)
	}
}

// Cabeçalhos do download: o que o navegador pode abrir fica inline; o resto sai como attachment octet-stream, com nosniff
// e CSP sandbox. O tipo é o da EXTENSÃO, não o que o cliente declarou no envio.
func TestDownloadNuncaRenderizaOQueNaoDeve(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "arquivos", "pagina.html", html)
	m.planta(t, "arquivos", "desenho.svg", []byte("<svg xmlns='http://www.w3.org/2000/svg' onload='alert(1)'/>"))
	m.planta(t, "arquivos", "foto.png", png)
	m.planta(t, "arquivos", "contrato.pdf", pdf)
	m.planta(t, "arquivos", "script.js", []byte("alert(1)"))
	m.planta(t, "arquivos", "sem-extensao", []byte("abc"))
	for _, c := range []struct {
		arquivo, tipo string
		anexo         bool
		sandbox       bool
	}{
		{"pagina.html", "application/octet-stream", true, true},
		{"desenho.svg", "image/svg+xml", true, true},
		{"foto.png", "image/png", false, true},
		{"contrato.pdf", "application/pdf", false, false},
		{"script.js", "application/octet-stream", true, true},
		{"sem-extensao", "application/octet-stream", true, true},
	} {
		st, _, h := m.pede(t, "super", "GET", "/arquivos/arquivos/"+c.arquivo, "")
		if st != 200 || h.Get("Content-Type") != c.tipo || h.Get("X-Content-Type-Options") != "nosniff" ||
			(strings.HasPrefix(h.Get("Content-Disposition"), "attachment") != c.anexo) || (strings.Contains(h.Get("Content-Security-Policy"), "sandbox") != c.sandbox) {
			t.Errorf("%s: %d tipo %q disposição %q csp %q", c.arquivo, st, h.Get("Content-Type"), h.Get("Content-Disposition"), h.Get("Content-Security-Policy"))
		}
		if h.Get("Cache-Control") != "private, no-store" {
			t.Errorf("%s: arquivo de bucket privado com Cache-Control %q", c.arquivo, h.Get("Cache-Control"))
		}
	}
	// ?baixar força attachment com o nome pedido, até numa imagem
	_, _, h := m.pede(t, "super", "GET", "/arquivos/arquivos/foto.png?baixar=minha%20foto.png", "")
	if !strings.HasPrefix(h.Get("Content-Disposition"), "attachment") || !strings.Contains(h.Get("Content-Disposition"), "minha foto.png") {
		t.Errorf("baixar = %q", h.Get("Content-Disposition"))
	}
	// Range (vídeo): 206 com o pedaço
	m.planta(t, "conteudo", "v.mp4", mp4)
	r := httptest.NewRequest("GET", "/arquivos/conteudo/v.mp4", nil)
	r.Header.Set("Range", "bytes=0-9")
	r.Header.Set("Authorization", "Bearer "+m.Tok["super"])
	w := httptest.NewRecorder()
	m.H.ServeHTTP(w, r)
	if w.Code != http.StatusPartialContent || w.Body.Len() != 10 {
		t.Errorf("Range = %d com %d bytes", w.Code, w.Body.Len())
	}
}

// URL pública: só de bucket público (privado = 404, sem dizer que existe); cache público.
func TestUrlPublica(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "avatars", "u.png", png)
	m.planta(t, "conteudo", "c.jpg", jpg)
	if st, _, h := m.publico(t, "/storage/v1/object/public/avatars/u.png"); st != 200 || h.Get("Cache-Control") != "public, max-age=3600" || h.Get("Content-Type") != "image/png" {
		t.Errorf("público = %d %q %q", st, h.Get("Cache-Control"), h.Get("Content-Type"))
	}
	for _, c := range []string{"/storage/v1/object/public/conteudo/c.jpg", "/storage/v1/object/public/vessel-curriculos/x", "/storage/v1/object/public/ig-cache/x.png",
		"/storage/v1/object/public/avatars/nao-existe.png", "/storage/v1/object/public/nao-existe/x"} {
		if st, _, _ := m.publico(t, c); st != 404 {
			t.Errorf("%s = %d, esperava 404", c, st)
		}
	}
}

// URL assinada: quem lê assina; vale sem sessão até vencer; qualquer mudança na URL a invalida; o segredo ausente = 503;
// quem não pode ler não consegue assinar (a URL só repete uma permissão que a pessoa já tinha).
func TestUrlAssinada(t *testing.T) {
	agora := time.Date(2026, 10, 14, 12, 0, 0, 0, time.UTC)
	relogio := &agora
	m := novoMundo(t, func(s *Servico) { s.Agora = func() time.Time { return *relogio } })
	m.planta(t, "conteudo", "pasta/a b.jpg", jpg)
	m.planta(t, "conteudo", "outro.jpg", jpg)
	assina := func(quem, corpo string) (int, []map[string]any) {
		st, r, _ := m.pede(t, quem, "POST", "/arquivos/conteudo/assinar", corpo)
		var l []map[string]any
		json.Unmarshal([]byte(r), &l)
		return st, l
	}
	st, l := assina("conteudo", `{"caminhos":["pasta/a b.jpg","outro.jpg","nao-existe.jpg"],"segundos":120}`)
	if st != 200 || len(l) != 3 || l[0]["url"] == nil || l[1]["url"] == nil || l[2]["url"] != nil || l[2]["erro"] == nil {
		t.Fatalf("assinar = %d %v", st, l)
	}
	u := l[0]["url"].(string)
	if st, _, h := m.publico(t, u); st != 200 || h.Get("Cache-Control") != "private, no-store" {
		t.Errorf("a URL assinada sem sessão = %d %q", st, h.Get("Cache-Control"))
	}
	pu, _ := url.Parse(u)
	q := pu.Query()
	mexe := func(f func(url.Values, *url.URL)) string {
		qq, uu := url.Values{}, *pu
		for k, v := range q {
			qq[k] = slices.Clone(v)
		}
		f(qq, &uu)
		uu.RawQuery = qq.Encode()
		return uu.String()
	}
	for nome, ruim := range map[string]string{
		"outro arquivo":    strings.Replace(u, "pasta/a%20b.jpg", "outro.jpg", 1),
		"outro bucket":     strings.Replace(u, "/sign/conteudo/", "/sign/avatars/", 1),
		"exp maior":        mexe(func(q url.Values, _ *url.URL) { q.Set("exp", fmt.Sprint(agora.Unix()+99999)) }),
		"sig trocada":      mexe(func(q url.Values, _ *url.URL) { q.Set("sig", strings.Repeat("0", 64)) }),
		"sem sig":          mexe(func(q url.Values, _ *url.URL) { q.Del("sig") }),
		"baixar acrescido": mexe(func(q url.Values, _ *url.URL) { q.Set("baixar", "x.jpg") }),
		"exp lixo":         mexe(func(q url.Values, _ *url.URL) { q.Set("exp", "abc") }),
	} {
		if st, _, _ := m.publico(t, ruim); st != 403 {
			t.Errorf("URL adulterada (%s) = %d, esperava 403", nome, st)
		}
	}
	// vencida
	depois := agora.Add(121 * time.Second)
	relogio = &depois
	if st, r, _ := m.publico(t, u); st != 403 || !strings.Contains(r, "vencido") {
		t.Errorf("URL vencida = %d %s", st, r)
	}
	relogio = &agora
	// com `baixar`: attachment com o nome, e a assinatura inclui o nome
	_, lb := assina("conteudo", `{"caminhos":["outro.jpg"],"segundos":60,"baixar":"meu-arquivo.jpg"}`)
	if st, _, h := m.publico(t, lb[0]["url"].(string)); st != 200 || !strings.Contains(h.Get("Content-Disposition"), "meu-arquivo.jpg") {
		t.Errorf("assinada com baixar = %d %q", st, h.Get("Content-Disposition"))
	}
	// segundos: padrão 60, teto 3600
	_, lteto := assina("conteudo", `{"caminhos":["outro.jpg"],"segundos":999999}`)
	pt, _ := url.Parse(lteto[0]["url"].(string))
	if exp := pt.Query().Get("exp"); exp != fmt.Sprint(agora.Unix()+3600) {
		t.Errorf("exp com segundos enormes = %s, esperava o teto de 3600 s", exp)
	}
	// quem não lê não assina; o pedido todo cai
	if st, _ := assina("leitor", `{"caminhos":["outro.jpg"]}`); st != 403 {
		t.Errorf("assinar sem permissão = %d, esperava 403", st)
	}
	if st, _ := assina("conteudo", `{"caminhos":["../x"]}`); st != 400 {
		t.Errorf("assinar caminho malicioso = %d, esperava 400", st)
	}
	// sem segredo configurado nada é assinado nem aceito
	sem := novoMundo(t, func(s *Servico) { s.Segredo = "" })
	sem.planta(t, "conteudo", "a.jpg", jpg)
	if st, _, _ := sem.pede(t, "conteudo", "POST", "/arquivos/conteudo/assinar", `{"caminhos":["a.jpg"]}`); st != 503 {
		t.Errorf("assinar sem segredo = %d, esperava 503", st)
	}
	if st, _, _ := sem.publico(t, "/storage/v1/object/sign/conteudo/a.jpg?exp=9999999999&sig="+strings.Repeat("0", 64)); st != 503 {
		t.Errorf("assinada sem segredo = %d, esperava 503", st)
	}
}

// Vazamento: nenhuma resposta de erro (nem de sucesso fora da lista) carrega o nome do arquivo, o diretório do disco ou o
// segredo das URLs.
func TestErrosNaoVazamNomeNemDiretorio(t *testing.T) {
	m := novoMundo(t)
	nome := "contrato-secreto-da-cliente-123"
	segredos := []string{nome, m.Dir, segredoDasUrls}
	chama := func(quem, metodo, caminho, corpo string) {
		st, r, _ := m.pede(t, quem, metodo, caminho, corpo)
		for _, s := range segredos {
			// o que a PESSOA mandou volta nas respostas de sucesso (apagar e assinar devolvem a lista pedida, como o
			// Storage); o que não pode voltar é o nome na recusa e o diretório do disco ou o segredo em qualquer uma
			if strings.Contains(r, s) && (st >= 400 || s != nome) {
				t.Errorf("%s %s como %s vazou %q: %s", metodo, caminho, quem, s, r)
			}
		}
	}
	m.planta(t, "conteudo", nome+".jpg", jpg)
	for _, quem := range []string{"leitor", "super", "conteudo"} {
		chama(quem, "GET", "/arquivos/conteudo/"+nome+"-nao-existe.jpg", "")
		chama(quem, "GET", "/arquivos/conteudo/"+nome+".jpg", "")
		chama(quem, "DELETE", "/arquivos/conteudo", `{"caminhos":["`+nome+`.jpg"]}`)
		chama(quem, "POST", "/arquivos/conteudo/copiar", `{"de":"`+nome+`.jpg","para":"`+nome+`.jpg"}`)
		chama(quem, "POST", "/arquivos/conteudo/assinar", `{"caminhos":["`+nome+`-nao-existe.jpg"]}`)
		chama(quem, "GET", "/arquivos/conteudo?prefixo="+nome+"/..", "")
		_, r := m.envia(t, quem, "conteudo", nome+".jpg", "image/png", png)
		for _, s := range segredos {
			if strings.Contains(r, s) {
				t.Errorf("PUT recusado como %s vazou %q: %s", quem, s, r)
			}
		}
	}
	if st, r, _ := m.publico(t, "/storage/v1/object/sign/conteudo/"+nome+".jpg?exp=1&sig=x"); strings.Contains(r, nome) || st == 200 {
		t.Errorf("URL assinada inválida = %d %s", st, r)
	}
}
