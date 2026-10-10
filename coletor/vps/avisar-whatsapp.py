#!/usr/bin/env python3
"""Manda um aviso no MESMO grupo de WhatsApp do monitor da VPS (/root/monitor/verificar.py).

Uso:  avisar-whatsapp.py "texto"      envia
      avisar-whatsapp.py --verificar  só confere se a sessão do WhatsApp está aberta (não envia nada)

Lê /root/monitor/config.json (evolution_url, evolution_key, instancia, grupo) — a credencial mora só lá.
O rodar-robo.sh chama este script quando ALERT_COMANDO aponta para ele em /etc/robos.env.
Sai com 0 se enviou (ou se a sessão está aberta, no --verificar) e 1 se não deu.
"""
import json
import os
import sys
import urllib.request

CONFIG = os.environ.get('MONITOR_CONFIG', '/root/monitor/config.json')


def chamar(cfg, caminho, corpo=None):
    req = urllib.request.Request(
        cfg['evolution_url'] + caminho,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        headers={'apikey': cfg['evolution_key'], 'Content-Type': 'application/json'},
        method='POST' if corpo is not None else 'GET',
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read() or b'null')


def main():
    if len(sys.argv) != 2:
        print(__doc__, file=sys.stderr)
        return 64
    cfg = json.load(open(CONFIG, encoding='utf-8'))
    if sys.argv[1] == '--verificar':
        for item in chamar(cfg, '/instance/fetchInstances') or []:
            i = item.get('instance', item)
            if (i.get('instanceName') or i.get('name')) == cfg['instancia']:
                estado = i.get('connectionStatus') or i.get('status')
                print(f"instância {cfg['instancia']}: {estado}")
                return 0 if estado == 'open' else 1
        print('instância não encontrada', file=sys.stderr)
        return 1
    chamar(cfg, f"/message/sendText/{cfg['instancia']}", {'number': cfg['grupo'], 'text': sys.argv[1]})
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — o wrapper só precisa saber que falhou; sem credencial na mensagem
        print(f'avisar-whatsapp falhou: {type(e).__name__}', file=sys.stderr)
        sys.exit(1)
