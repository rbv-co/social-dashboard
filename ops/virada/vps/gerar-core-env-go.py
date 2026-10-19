#!/usr/bin/env python3
"""core.env da janela de volta (plano 08, VIRADA-2026-10): do core.env ATUAL, o que muda no T+14.

Uso: gerar-core-env-go.py ENTRADA SAIDA   (na VPS; lê o segredo do destino novo e a chave interna dos arquivos abaixo)
  CORE_SHOPIFY_DESTINOS: supabase_checkout e supabase_abandono -> a API Go (mesmo nome e mesmo segredo: o Core
    reenvia por nome, com a URL do momento) e destino novo `central_pedidos` (orders/create|paid|updated ->
    /api/receber-webhook-pedido-shopify; o webhook de pedidos já passa pelo Core e nenhum destino o entregava ao Go).
  META_HOSTS_MIDIA: ganha o host da central (quem baixa a imagem do Storage novo é o Core).
  CADASTRO_SUPABASE_URL/_CHAVE: a central; CADASTRO_ACEITA_P_TESTE=false (roteiro, seção 3).
O resto do arquivo passa byte a byte. Gera a partir do arquivo de agora (não de uma cópia velha): mudança feita no
core.env depois do preparo não se perde. Saída: modo 600; nunca imprime valor.
"""
import json, os, sys

BASE = os.environ.get("CENTRAL_BASE", "https://central.rbvcompany.com")
HOST = BASE.split("://", 1)[1]
SEGREDO_PEDIDOS = os.environ.get("SEGREDO_PEDIDOS_ARQ", "/root/virada/segredo-central-pedidos")
API_ENV = os.environ.get("API_ENV", "/root/secrets/api.env")
URLS = {"supabase_checkout": "/api/receber-webhook-checkout", "supabase_abandono": "/api/receber-webhook-abandono"}
PEDIDOS = {"nome": "central_pedidos", "topicos": ["orders/create", "orders/paid", "orders/updated"], "ativo": True}


def valor(arq, chave):
    for l in open(arq):
        if l.startswith(chave + "="):
            return l.rstrip("\n").split("=", 1)[1].strip().strip("'\"")
    sys.exit(f"{chave} ausente em {arq}")


def destinos(texto):
    l = json.loads(texto)
    for d in l:
        if d["nome"] in URLS:
            d["url"] = BASE + URLS[d["nome"]]
    if not any(d["nome"] == "central_pedidos" for d in l):
        l.append(dict(PEDIDOS, url=BASE + "/api/receber-webhook-pedido-shopify", segredo=open(SEGREDO_PEDIDOS).read().strip()))
    else:
        for d in l:
            if d["nome"] == "central_pedidos":
                d["url"] = BASE + "/api/receber-webhook-pedido-shopify"
    for n in URLS:
        assert any(d["nome"] == n for d in l), f"destino {n} sumiu do CORE_SHOPIFY_DESTINOS"
    return json.dumps(l, separators=(",", ":"), ensure_ascii=False)


def main(entrada, saida):
    troca = {
        "CADASTRO_SUPABASE_URL": BASE,
        "CADASTRO_SUPABASE_CHAVE": valor(API_ENV, "VESSEL_INTERNO_SEGREDO"),
        "CADASTRO_ACEITA_P_TESTE": "false",
    }
    out, vistos = [], set()
    for l in open(entrada).read().splitlines():
        k = l.split("=", 1)[0]
        v = l.split("=", 1)[1] if "=" in l else ""
        if k == "CORE_SHOPIFY_DESTINOS":
            novo = destinos(v.strip().strip("'"))
            assert "'" not in novo
            l = f"{k}='{novo}'"
        elif k == "META_HOSTS_MIDIA":
            hs = [h for h in v.strip().strip("'\"").split(",") if h]
            l = f"{k}=" + ",".join(hs if HOST in hs else hs + [HOST])
        elif k in troca:
            l = f"{k}={troca[k]}"
        if k in troca or k in ("CORE_SHOPIFY_DESTINOS", "META_HOSTS_MIDIA"):
            vistos.add(k)
        out.append(l)
    for k in list(troca) + ["CORE_SHOPIFY_DESTINOS", "META_HOSTS_MIDIA"]:
        if k not in vistos:
            if k in ("CORE_SHOPIFY_DESTINOS",):
                sys.exit("CORE_SHOPIFY_DESTINOS ausente no core.env")
            out.append(f"{k}={troca.get(k, HOST)}")
    fd = os.open(saida, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write("\n".join(out) + "\n")
    os.chmod(saida, 0o600)


if len(sys.argv) != 3:
    sys.exit(__doc__)
main(sys.argv[1], sys.argv[2])
