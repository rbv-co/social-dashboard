package arquivos

import "testing"

// ig-cache: as URLs de imagem das Notícias (noticias_concorrentes) apontam para ele; é público e SÓ de leitura
// (ninguém envia nem apaga pela API). fotos-modelo segue fora (nada no banco aponta para ele).
func TestIgCacheSoLeitura(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "ig-cache", "perfil_x/123.jpg", jpg)
	if st, _, h := m.publico(t, "/storage/v1/object/public/ig-cache/perfil_x/123.jpg"); st != 200 || h.Get("Content-Type") != "image/jpeg" || h.Get("Cache-Control") != "public, max-age=3600" {
		t.Errorf("público = %d %q %q", st, h.Get("Content-Type"), h.Get("Cache-Control"))
	}
	for _, quem := range []string{"super", "admin", "robo-meta"} {
		if st, _ := m.envia(t, quem, "ig-cache", "perfil_x/novo.jpg", "image/jpeg", jpg); st != 403 || m.existe("ig-cache", "perfil_x/novo.jpg") {
			t.Errorf("%s: envio em ig-cache = %d, esperava 403", quem, st)
		}
		if st, _, _ := m.pede(t, quem, "DELETE", "/arquivos/ig-cache", `{"caminhos":["perfil_x/123.jpg"]}`); st != 403 || !m.existe("ig-cache", "perfil_x/123.jpg") {
			t.Errorf("%s: DELETE em ig-cache = %d, esperava 403 e o arquivo intacto", quem, st)
		}
	}
	if st, _, _ := m.publico(t, "/storage/v1/object/public/fotos-modelo/x.jpg"); st != 404 {
		t.Errorf("fotos-modelo público = %d, esperava 404", st)
	}
}
