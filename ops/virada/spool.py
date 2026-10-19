#!/usr/bin/env python3
"""Spool dos webhooks do Chatwoot na janela da virada (plano 01, VIRADA-2026-10). Só stdlib.

Por quê: o Chatwoot posta UMA vez (HTTParty, timeout 5 s, sem retry). Com o Supabase congelado a edge
responde 200 e o evento some; com o Go ainda vazio não dá para entregar. Na janela o nginx manda as duas
rotas para cá: o evento vai a disco (fsync do arquivo e do diretório) e SÓ ENTÃO sai o 200. Erro de disco
ou pouco espaço = 503 (nada é confirmado sem estar gravado). A Shopify não passa aqui: vai pelo Core, que
guarda em webhook_entregas e reenvia (roteiro, linha do Core).

  receber   --dir D --porta P [--min-livre-mb 256]
            POST /receber-webhook-chatwoot e /receber-opt-out-chatwoot (até 1 MiB, como no nginx).
            Grava D/<ns>-<seq>.json: horário de chegada, caminho, query crua (tem o ?token=), alguns
            cabeçalhos e o corpo byte a byte (base64). O log NUNCA leva a query.
  reenviar  --dir D --destino go|edge|URL [--ritmo 5] [--tentativas 8]
            Reenvia em ordem de chegada, com a query e o corpo originais. 2xx -> D/entregue/;
            evento ruim (400/413/422) -> D/rejeitado/ e relatório; destino errado ou segredo diferente do
            Chatwoot (401/403/404/405) -> PARA na hora; 408/429/5xx/rede -> espera e tenta de novo e, se não
            passar, PARA. Parar deixa o resto na fila, em ordem, e sai 1; rodar de novo continua de onde parou.
            Reenviar o mesmo evento é inofensivo: o Go faz "on conflict do nothing" nas duas rotas, e o
            created_at do evento vai no corpo (o dia_br sai do horário original).
Saída do reenviar: 0 = nada pendente; 1 = sobrou pendente ou houve rejeitado nesta rodada; 2 = uso/trava.
"""
import argparse, base64, fcntl, http.client, json, os, signal, sys, threading, time, urllib.error, urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROTAS = {"/receber-webhook-chatwoot", "/receber-opt-out-chatwoot"}
LIMITE = 1 << 20  # = client_max_body_size 1m das rotas do Chatwoot no nginx
CABECALHOS = ("content-type", "user-agent")
DESTINOS = {"go": "http://127.0.0.1:8080", "edge": "https://kounqtdoioootxqegkij.supabase.co/functions/v1"}
DEFINITIVOS = {400, 413, 422}  # o evento é ruim: separa e segue
CONFIG = {401, 403, 404, 405}  # o destino é que está errado: 401 em um = 401 em todos; nada sai da fila


def gravar(d, nome, dados):
    """Grava d/nome de forma atômica e durável: tmp + fsync + rename + fsync do diretório."""
    tmp = os.path.join(d, "." + nome + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(dados)
            f.flush()
            os.fsync(f.fileno())
        os.rename(tmp, os.path.join(d, nome))
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    dfd = os.open(d, os.O_RDONLY)
    try:
        os.fsync(dfd)
    finally:
        os.close(dfd)


class Receptor(BaseHTTPRequestHandler):
    server_version = "virada-spool"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # o padrão loga a linha da requisição, que tem o ?token=
        pass

    def responder(self, status, corpo):
        b = json.dumps(corpo).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Connection", "close")  # sem isto, cliente keep-alive (Go) reusa a conexão já fechada e perde o POST
        self.end_headers()
        self.wfile.write(b)
        sys.stderr.write("%s %s %d\n" % (self.command, self.path.split("?", 1)[0], status))

    def do_GET(self):  # /saude; nas rotas, 405 com "spool" (spool-nginx.sh confere por aí quem atende a central)
        self.close_connection = True
        caminho = self.path.split("?", 1)[0]
        status = 200 if caminho == "/saude" else 405 if caminho in ROTAS else 404
        self.responder(status, {"ok": status == 200, "spool": True})

    def do_POST(self):
        self.close_connection = True
        caminho, _, query = self.path.partition("?")
        if caminho not in ROTAS:
            return self.responder(404, {"error": "rota"})
        try:
            n = int(self.headers.get("Content-Length", ""))
        except ValueError:
            return self.responder(411, {"error": "sem_tamanho"})
        if n < 0 or n > LIMITE:
            return self.responder(413, {"error": "grande_demais"})
        corpo = self.rfile.read(n)
        if len(corpo) != n:
            return self.responder(400, {"error": "corpo_incompleto"})
        srv = self.server
        try:
            st = os.statvfs(srv.dir)
            if st.f_bavail * st.f_frsize < srv.min_livre + n * 2:
                return self.responder(503, {"error": "disco_cheio"})
            with srv.trava:
                srv.seq += 1
                nome = "%019d-%06d.json" % (time.time_ns(), srv.seq)
            registro = {
                "recebido_em": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
                "metodo": "POST", "caminho": caminho, "query": query,
                "cabecalhos": {h: self.headers[h] for h in CABECALHOS if self.headers.get(h) is not None},
                "corpo_b64": base64.b64encode(corpo).decode(),
            }
            gravar(srv.dir, nome, json.dumps(registro).encode())
        except OSError as e:
            sys.stderr.write("ERRO ao gravar: %s\n" % e.strerror)
            return self.responder(503, {"error": "spool_indisponivel"})
        self.responder(200, {"ok": True, "spool": True})


def receber(a):
    os.makedirs(a.dir, mode=0o700, exist_ok=True)
    srv = ThreadingHTTPServer(("127.0.0.1", a.porta), Receptor)
    srv.daemon_threads = False  # no SIGTERM, server_close espera quem está gravando
    srv.dir, srv.min_livre, srv.trava, srv.seq = a.dir, a.min_livre_mb << 20, threading.Lock(), 0
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=srv.shutdown).start())
    sys.stderr.write("spool ouvindo 127.0.0.1:%d em %s\n" % (a.porta, a.dir))
    sys.stderr.flush()
    try:
        srv.serve_forever()
    finally:
        srv.server_close()
    sys.stderr.write("spool parado\n")


def enviar(base, r, timeout):
    url = base + r["caminho"] + ("?" + r["query"] if r["query"] else "")
    req = urllib.request.Request(url, data=base64.b64decode(r["corpo_b64"]), method="POST")
    for h, v in r["cabecalhos"].items():
        req.add_header(h, v)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(300)
    except urllib.error.HTTPError as e:
        return e.code, e.read(300)
    except (urllib.error.URLError, OSError, http.client.HTTPException) as e:  # rede/timeout: a URL (com token) não vai para a mensagem
        return None, type(getattr(e, "reason", e)).__name__.encode()


def reenviar(a):
    base = DESTINOS.get(a.destino, a.destino)
    if not base.startswith(("http://", "https://")):
        print("destino: go, edge ou uma URL base", file=sys.stderr)
        return 2
    os.makedirs(os.path.join(a.dir, "entregue"), mode=0o700, exist_ok=True)
    os.makedirs(os.path.join(a.dir, "rejeitado"), mode=0o700, exist_ok=True)
    trava = open(os.path.join(a.dir, ".reenviar.trava"), "w")
    try:
        fcntl.flock(trava, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("outro reenviar está rodando", file=sys.stderr)
        return 2
    cont = {"entregue": 0, "rejeitado": 0}
    por_rota = {}
    pendentes = sorted(n for n in os.listdir(a.dir) if n.endswith(".json") and not n.startswith("."))
    for nome in pendentes:
        caminho = os.path.join(a.dir, nome)
        with open(caminho, "rb") as f:
            r = json.load(f)
        for tentativa in range(a.tentativas):
            status, resp = enviar(base, r, a.timeout)
            if status is not None and (200 <= status < 300 or status in DEFINITIVOS or status in CONFIG):
                break
            if tentativa + 1 < a.tentativas:
                espera = min(2 ** tentativa, 30)
                print("%s %s -> %s; nova tentativa em %ds" % (nome, r["caminho"], status or resp.decode(), espera), file=sys.stderr)
                time.sleep(espera)
        else:
            print("PAROU em %s %s -> %s depois de %d tentativas" % (nome, r["caminho"], status or resp.decode(), a.tentativas), file=sys.stderr)
            break
        if status in CONFIG:
            print("PAROU em %s %s -> %d: destino errado ou segredo diferente do Chatwoot" % (nome, r["caminho"], status), file=sys.stderr)
            break
        pasta = "entregue" if 200 <= status < 300 else "rejeitado"
        if pasta == "rejeitado":
            print("REJEITADO %s %s -> %d %s" % (nome, r["caminho"], status, resp.decode("utf-8", "replace")), file=sys.stderr)
        os.rename(caminho, os.path.join(a.dir, pasta, nome))
        cont[pasta] += 1
        por_rota.setdefault(r["caminho"], {"entregue": 0, "rejeitado": 0})[pasta] += 1
        time.sleep(1 / a.ritmo)
    resto = sum(1 for n in os.listdir(a.dir) if n.endswith(".json") and not n.startswith("."))
    print(json.dumps({"destino": a.destino, "lidos": len(pendentes), **cont, "pendentes": resto, "por_rota": por_rota}))
    # rejeitado também sai 1: conferir o relatório antes de virar o nginx
    return 0 if resto == 0 and cont["rejeitado"] == 0 else 1


def main():
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    s = p.add_subparsers(dest="cmd", required=True)
    r = s.add_parser("receber")
    r.add_argument("--dir", required=True)
    r.add_argument("--porta", type=int, required=True)
    r.add_argument("--min-livre-mb", type=int, default=256)
    e = s.add_parser("reenviar")
    e.add_argument("--dir", required=True)
    e.add_argument("--destino", required=True, help="go, edge ou URL base (ensaio)")
    e.add_argument("--ritmo", type=float, default=5, help="envios por segundo (o Go limita 600/min por IP)")
    e.add_argument("--tentativas", type=int, default=8)
    e.add_argument("--timeout", type=float, default=15)
    a = p.parse_args()
    if a.cmd == "receber":
        receber(a)
        return 0
    return reenviar(a)


if __name__ == "__main__":
    sys.exit(main())
