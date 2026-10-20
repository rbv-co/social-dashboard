package arquivos

import "testing"

// ig-cache: as URLs de imagem das Notícias (noticias_concorrentes) apontam para ele; é público e SÓ de leitura
// (ninguém envia nem apaga pela API). fotos-modelo tem a mesma regra (plano 08), no teste logo abaixo.
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
}

// fotos-modelo (174 fotos que o mapa da Fábrica busca por URL): público e SÓ de leitura, como o ig-cache.
func TestFotosModeloSoLeitura(t *testing.T) {
	m := novoMundo(t)
	m.planta(t, "fotos-modelo", "LV1005-Palha.jpg", jpg)
	if st, _, h := m.publico(t, "/storage/v1/object/public/fotos-modelo/LV1005-Palha.jpg"); st != 200 || h.Get("Content-Type") != "image/jpeg" || h.Get("Cache-Control") != "public, max-age=3600" {
		t.Errorf("público = %d %q %q", st, h.Get("Content-Type"), h.Get("Cache-Control"))
	}
	for _, quem := range []string{"super", "admin", "robo-meta"} {
		if st, _ := m.envia(t, quem, "fotos-modelo", "novo.jpg", "image/jpeg", jpg); st != 403 || m.existe("fotos-modelo", "novo.jpg") {
			t.Errorf("%s: envio em fotos-modelo = %d, esperava 403", quem, st)
		}
		if st, _, _ := m.pede(t, quem, "DELETE", "/arquivos/fotos-modelo", `{"caminhos":["LV1005-Palha.jpg"]}`); st != 403 || !m.existe("fotos-modelo", "LV1005-Palha.jpg") {
			t.Errorf("%s: DELETE em fotos-modelo = %d, esperava 403 e o arquivo intacto", quem, st)
		}
		if st, _, _ := m.pede(t, quem, "POST", "/arquivos/fotos-modelo/copiar", `{"de":"LV1005-Palha.jpg","para":"copia.jpg"}`); st != 403 || m.existe("fotos-modelo", "copia.jpg") {
			t.Errorf("%s: copiar para fotos-modelo = %d, esperava 403", quem, st)
		}
	}
}
