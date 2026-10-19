"""Testes do spool.py (plano 01 da virada). Rodar: python3 ops/virada/spool_test.py"""
import http.client, json, os, socket, subprocess, sys, tempfile, threading, time, unittest, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SPOOL = os.path.join(os.path.dirname(os.path.abspath(__file__)), "spool.py")
TOKEN = "segredo-de-teste-123"


def porta_livre():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def post(url, corpo, ct="application/json"):
    req = urllib.request.Request(url, data=corpo, method="POST", headers={"Content-Type": ct})
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def arquivos(d):
    return sorted(n for n in os.listdir(d) if n.endswith(".json") and not n.startswith("."))


class Receber(unittest.TestCase):
    def iniciar(self, *extra):
        self.dir = tempfile.mkdtemp()
        self.porta = porta_livre()
        self.log = tempfile.TemporaryFile()
        self.proc = subprocess.Popen([sys.executable, SPOOL, "receber", "--dir", self.dir, "--porta", str(self.porta), *extra],
                                     stderr=self.log)
        for _ in range(50):
            try:
                urllib.request.urlopen("http://127.0.0.1:%d/saude" % self.porta, timeout=1)
                return
            except OSError:
                time.sleep(0.1)
        self.fail("receptor não subiu")

    def tearDown(self):
        self.proc.terminate()
        self.proc.wait(5)
        self.log.seek(0)
        self.assertNotIn(TOKEN.encode(), self.log.read(), "a query (token) foi parar no log")

    def url(self, caminho="/receber-webhook-chatwoot"):
        return "http://127.0.0.1:%d%s?token=%s" % (self.porta, caminho, TOKEN)

    def test_grava_byte_a_byte_antes_do_200(self):
        self.iniciar()
        corpo = '{"tipo":"lead_novo","conversation_id":7,"nome":"Ação ç"}'.encode()
        c = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=5)
        c.request("POST", "/receber-webhook-chatwoot?token=" + TOKEN, corpo, {"Content-Type": "application/json"})
        r = c.getresponse()
        # Connection: close anunciado: cliente keep-alive não reusa a conexão que o spool fecha
        self.assertEqual((r.status, r.getheader("Connection"), json.loads(r.read())), (200, "close", {"ok": True, "spool": True}))
        c.close()
        nomes = arquivos(self.dir)  # já em disco quando o 200 chegou
        self.assertEqual(len(nomes), 1)
        self.assertEqual(oct(os.stat(os.path.join(self.dir, nomes[0])).st_mode & 0o777), "0o600")
        r = json.load(open(os.path.join(self.dir, nomes[0])))
        import base64
        self.assertEqual(base64.b64decode(r["corpo_b64"]), corpo)
        self.assertEqual((r["caminho"], r["query"]), ("/receber-webhook-chatwoot", "token=" + TOKEN))
        self.assertEqual(r["cabecalhos"]["content-type"], "application/json")

    def test_ordem_de_chegada(self):
        self.iniciar()
        for i in range(30):
            self.assertEqual(post(self.url("/receber-opt-out-chatwoot"), b'{"i":%d}' % i)[0], 200)
        import base64
        ordem = [json.loads(base64.b64decode(json.load(open(os.path.join(self.dir, n)))["corpo_b64"]))["i"] for n in arquivos(self.dir)]
        self.assertEqual(ordem, list(range(30)))

    def test_recusa_sem_gravar(self):
        self.iniciar()
        self.assertEqual(post(self.url("/outra-rota"), b"{}")[0], 404)
        with self.assertRaises(urllib.error.HTTPError) as c:  # GET na rota: 405 que se identifica (conferência do nginx)
            urllib.request.urlopen(self.url(), timeout=5)
        self.assertEqual((c.exception.code, json.loads(c.exception.read())), (405, {"ok": False, "spool": True}))
        c = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=5)  # só o cabeçalho: o 413 sai sem ler o corpo
        c.putrequest("POST", "/receber-webhook-chatwoot?token=" + TOKEN)
        c.putheader("Content-Length", str((1 << 20) + 1))
        c.endheaders()
        r = c.getresponse()
        self.assertEqual((r.status, r.getheader("Connection")), (413, "close"))
        c.close()
        self.assertEqual(arquivos(self.dir), [])

    def test_disco_cheio_da_503(self):
        self.iniciar("--min-livre-mb", str(1 << 40))  # exige mais espaço livre do que existe
        self.assertEqual(post(self.url(), b"{}")[0], 503)
        self.assertEqual(os.listdir(self.dir), [])

    @unittest.skipIf(os.geteuid() == 0, "root escreve mesmo sem permissão")
    def test_erro_de_escrita_da_503(self):
        self.iniciar()
        os.chmod(self.dir, 0o500)
        try:
            self.assertEqual(post(self.url(), b"{}")[0], 503)
        finally:
            os.chmod(self.dir, 0o700)
        self.assertEqual(os.listdir(self.dir), [])


class Destino(BaseHTTPRequestHandler):
    """Destino falso: responde com os status da fila (vazia = 200) e anota o que recebeu."""
    def log_message(self, *a):
        pass

    def do_POST(self):
        corpo = self.rfile.read(int(self.headers["Content-Length"]))
        srv = self.server
        status = srv.fila.pop(0) if srv.fila else 200
        if status == 200:
            srv.recebidos.append((self.path, self.headers["Content-Type"], corpo))
        self.send_response(status)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")


class Reenviar(unittest.TestCase):
    def setUp(self):
        self.dest = ThreadingHTTPServer(("127.0.0.1", 0), Destino)
        self.dest.fila, self.dest.recebidos = [], []
        threading.Thread(target=self.dest.serve_forever, daemon=True).start()
        self.dir = tempfile.mkdtemp()
        # enche o spool pelo próprio receptor
        porta = porta_livre()
        rec = subprocess.Popen([sys.executable, SPOOL, "receber", "--dir", self.dir, "--porta", str(porta)], stderr=subprocess.DEVNULL)
        try:
            for _ in range(50):
                try:
                    urllib.request.urlopen("http://127.0.0.1:%d/saude" % porta, timeout=1)
                    break
                except OSError:
                    time.sleep(0.1)
            self.enviados = []
            for i in range(10):
                caminho = "/receber-webhook-chatwoot" if i % 2 else "/receber-opt-out-chatwoot"
                corpo = b'{"i":%d,"txt":"\xc3\xa7"}' % i
                self.assertEqual(post("http://127.0.0.1:%d%s?token=%s" % (porta, caminho, TOKEN), corpo)[0], 200)
                self.enviados.append(("%s?token=%s" % (caminho, TOKEN), "application/json", corpo))
        finally:
            rec.terminate()
            rec.wait(5)

    def tearDown(self):
        self.dest.shutdown()

    def reenviar(self, *extra):
        p = subprocess.run([sys.executable, SPOOL, "reenviar", "--dir", self.dir, "--ritmo", "1000",
                            "--destino", "http://127.0.0.1:%d" % self.dest.server_address[1], *extra],
                           capture_output=True, timeout=60)
        self.assertNotIn(TOKEN.encode(), p.stderr)
        return p.returncode, json.loads(p.stdout.decode().strip().splitlines()[-1]), p.stderr.decode()

    def test_n_igual_a_n_em_ordem_e_replay_repetido_nao_reenvia(self):
        rc, rel, _ = self.reenviar()
        self.assertEqual((rc, rel["entregue"], rel["rejeitado"], rel["pendentes"]), (0, 10, 0, 0))
        self.assertEqual(self.dest.recebidos, self.enviados)  # ordem, query, cabeçalho e corpo originais
        rc, rel, _ = self.reenviar()
        self.assertEqual((rc, rel["lidos"]), (0, 0))
        self.assertEqual(len(self.dest.recebidos), 10)

    def test_destino_instavel_tenta_de_novo(self):
        self.dest.fila = [503, 429, 502]
        rc, rel, err = self.reenviar()
        self.assertEqual((rc, rel["entregue"]), (0, 10))
        self.assertEqual(self.dest.recebidos, self.enviados)
        self.assertIn("nova tentativa", err)

    def test_destino_fora_para_e_guarda_o_resto(self):
        self.dest.shutdown()
        self.dest.server_close()
        rc, rel, err = self.reenviar("--tentativas", "2")
        self.assertEqual((rc, rel["entregue"], rel["pendentes"]), (1, 0, 10))
        self.assertIn("PAROU", err)
        # volta o destino na mesma porta e o replay continua de onde parou
        porta = self.dest.server_address[1]
        self.dest = ThreadingHTTPServer(("127.0.0.1", porta), Destino)
        self.dest.fila, self.dest.recebidos = [], []
        threading.Thread(target=self.dest.serve_forever, daemon=True).start()
        rc, rel, _ = self.reenviar()
        self.assertEqual((rc, rel["entregue"]), (0, 10))
        self.assertEqual(self.dest.recebidos, self.enviados)

    def test_rejeitado_vai_para_o_relatorio_e_segue(self):
        self.dest.fila = [400]
        rc, rel, err = self.reenviar()
        self.assertEqual((rc, rel["entregue"], rel["rejeitado"], rel["pendentes"]), (1, 9, 1, 0))  # 1: conferir antes de seguir
        self.assertEqual(len(os.listdir(os.path.join(self.dir, "rejeitado"))), 1)
        self.assertIn("REJEITADO", err)
        self.assertEqual(self.reenviar()[:2], (0, {**rel, "lidos": 0, "entregue": 0, "rejeitado": 0, "por_rota": {}}))

    def test_segredo_ou_rota_errados_param_na_hora_sem_tirar_da_fila(self):
        for status in (401, 404):
            self.dest.fila = [status]
            ini = time.time()
            rc, rel, err = self.reenviar()
            self.assertEqual((rc, rel["entregue"], rel["rejeitado"], rel["pendentes"]), (1, 0, 0, 10))
            self.assertLess(time.time() - ini, 5)  # sem as 8 tentativas com espera
            self.assertIn("PAROU", err)
        self.assertEqual(self.reenviar()[:2], (0, {**rel, "lidos": 10, "entregue": 10, "pendentes": 0,
                                                   "por_rota": {"/receber-opt-out-chatwoot": {"entregue": 5, "rejeitado": 0},
                                                                "/receber-webhook-chatwoot": {"entregue": 5, "rejeitado": 0}}}))


if __name__ == "__main__":
    unittest.main(verbosity=1)
