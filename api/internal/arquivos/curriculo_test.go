package arquivos

import (
	"bytes"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/rbv-co/social-dashboard/api/internal/auth"
)

// quemDeTeste: "X-Core: 1" é o Core (chave certa); o resto vale pelo X-Real-IP do nginx.
func quemDeTeste(r *http.Request) (string, bool) {
	if r.Header.Get("X-Core") == "1" {
		return "203.0.113.50", true
	}
	return auth.IPDe(r), false
}

func (m *mundo) curriculo(t testing.TB, caminho, tipo string, corpo []byte, cab ...string) (int, string) {
	t.Helper()
	r := httptest.NewRequest("POST", "/storage/v1/object/vessel-curriculos/"+caminho, bytes.NewReader(corpo))
	r.RemoteAddr = "127.0.0.1:4444"
	r.Header.Set("Content-Type", tipo)
	for _, c := range cab {
		k, v, _ := strings.Cut(c, ": ")
		r.Header.Set(k, v)
	}
	w := httptest.NewRecorder()
	m.Pub.ServeHTTP(w, r)
	return w.Code, w.Body.String()
}

// O envio de currículo (a policy vessel_curriculos_anon_so_envia): só nas duas pastas consultor-*, nome simples, nunca
// sobrescreve, tipo e tamanho do bucket, e o arquivo enviado não é legível por quem enviou nem pela URL pública.
func TestEnvioDeCurriculo(t *testing.T) {
	m := novoMundo(t, func(s *Servico) { s.Quem = quemDeTeste })
	heic := append([]byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"), bytes.Repeat([]byte{0}, 40)...)
	if st, r := m.curriculo(t, "consultor-tivoli/cv-ana.pdf", "application/pdf", pdf, "X-Real-IP: 198.51.100.1"); st != 200 || !strings.Contains(r, "vessel-curriculos/consultor-tivoli/cv-ana.pdf") {
		t.Fatalf("envio = %d %s", st, r)
	}
	if !bytes.Equal(m.lê(t, "vessel-curriculos", "consultor-tivoli/cv-ana.pdf"), pdf) {
		t.Error("o arquivo não foi gravado")
	}
	for _, c := range []struct {
		nome, caminho, tipo string
		corpo               []byte
		quer                int
	}{
		{"mesmo nome de novo", "consultor-tivoli/cv-ana.pdf", "application/pdf", pdf, 409},
		{"outra pasta de vaga", "consultor-brasilia/cv-bia.pdf", "application/pdf", pdf, 200},
		{"pasta fora da lista", "outra-vaga/cv.pdf", "application/pdf", pdf, 403},
		{"pasta do robô", "consultor-tivoli-x/cv.pdf", "application/pdf", pdf, 403},
		{"nome com ..", "consultor-tivoli/..%2Fcv.pdf", "application/pdf", pdf, 403},
		{"nome com barra", "consultor-tivoli/a%2Fb.pdf", "application/pdf", pdf, 403},
		{"nome escondido", "consultor-tivoli/.envio-x.pdf", "application/pdf", pdf, 403},
		{"nome com espaço", "consultor-tivoli/cv%20ana.pdf", "application/pdf", pdf, 403},
		{"nome longo demais", "consultor-tivoli/" + strings.Repeat("a", 130) + ".pdf", "application/pdf", pdf, 403},
		{"html como pdf", "consultor-tivoli/falso.pdf", "application/pdf", html, 415},
		{"extensão que não combina", "consultor-tivoli/x.exe", "application/pdf", pdf, 415},
		{"tipo fora da lista", "consultor-tivoli/x.zip", "application/zip", zip_, 415},
		{"docx", "consultor-tivoli/cv.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", zip_, 200},
		{"heic do celular", "consultor-brasilia/foto.heic", "image/heic", heic, 200},
		{"imagem", "consultor-brasilia/foto.jpg", "image/jpeg", jpg, 200},
		{"vazio", "consultor-tivoli/vazio.pdf", "application/pdf", nil, 415},
	} {
		st, r := m.curriculo(t, c.caminho, c.tipo, c.corpo, "X-Real-IP: 198.51.100."+fmt.Sprint(10+len(c.nome)))
		if st != c.quer {
			t.Errorf("%s: %d %.80s, esperava %d", c.nome, st, r, c.quer)
		}
	}
	// acima de 5 MiB
	grande := append(append([]byte{}, pdf...), bytes.Repeat([]byte("x"), 5*MiB)...)
	if st, _ := m.curriculo(t, "consultor-tivoli/grande.pdf", "application/pdf", grande, "X-Real-IP: 198.51.100.200"); st != 413 || m.existe("vessel-curriculos", "consultor-tivoli/grande.pdf") {
		t.Errorf("acima do teto = %d (existe=%t)", st, m.existe("vessel-curriculos", "consultor-tivoli/grande.pdf"))
	}
	if s := m.sobras(t); len(s) != 0 {
		t.Errorf("temporários: %v", s)
	}
	// ninguém lê pela URL pública; só o robô da triagem assina
	if st, _, _ := m.publico(t, "/storage/v1/object/public/vessel-curriculos/consultor-tivoli/cv-ana.pdf"); st != 404 {
		t.Errorf("URL pública do currículo = %d, esperava 404", st)
	}
	if st, _, _ := m.pede(t, "admin", "POST", "/arquivos/vessel-curriculos/assinar", `{"caminhos":["consultor-tivoli/cv-ana.pdf"]}`); st != 403 {
		t.Errorf("admin assinando currículo = %d, esperava 403", st)
	}
	if st, _, _ := m.pede(t, "robo-triagem", "POST", "/arquivos/vessel-curriculos/assinar", `{"caminhos":["consultor-tivoli/cv-ana.pdf"]}`); st != 200 {
		t.Errorf("robô da triagem assinando = %d, esperava 200", st)
	}
}

// Limite do currículo: 10 por IP por hora para o anônimo (o 11º toma 429; outro IP segue) e global de 200; o Core é UM
// chamador só (envia por todas as candidatas): não conta por IP, só o disjuntor dele.
func TestLimiteDoCurriculo(t *testing.T) {
	m := novoMundo(t, func(s *Servico) { s.Quem = quemDeTeste })
	for i := 0; i < 10; i++ {
		if st, r := m.curriculo(t, fmt.Sprintf("consultor-tivoli/a%d.pdf", i), "application/pdf", pdf, "X-Real-IP: 198.51.100.1"); st != 200 {
			t.Fatalf("envio %d = %d %s", i+1, st, r)
		}
	}
	if st, _ := m.curriculo(t, "consultor-tivoli/a10.pdf", "application/pdf", pdf, "X-Real-IP: 198.51.100.1"); st != 429 {
		t.Errorf("11º do mesmo IP = %d, esperava 429", st)
	}
	if st, _ := m.curriculo(t, "consultor-tivoli/b0.pdf", "application/pdf", pdf, "X-Real-IP: 198.51.100.2"); st != 200 {
		t.Errorf("outro IP = %d, esperava 200", st)
	}
	for i := 0; i < 30; i++ { // o Core manda de um IP só e não toma o teto por IP
		if st, r := m.curriculo(t, fmt.Sprintf("consultor-brasilia/c%d.pdf", i), "application/pdf", pdf, "X-Core: 1"); st != 200 {
			t.Fatalf("Core %d = %d %s", i+1, st, r)
		}
	}
}
