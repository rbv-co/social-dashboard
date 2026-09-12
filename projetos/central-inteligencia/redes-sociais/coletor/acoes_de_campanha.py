#!/usr/bin/env python3
"""As QUATRO contagens que vêm de graça no `actions` que a Meta já devolve.

Gêmeo em Python de `supabase/functions/_shared/acoes-de-campanha.js`. A regra
mora em dois lugares porque são dois robôs, em duas linguagens, escrevendo na
MESMA tabela (`campaign_insights`) — e Python não importa JavaScript.

O vigia contra divergência é o teste `coletor/lib/acoes-python-e-nuvem-batem.test.mjs`,
que roda a cada push: ele lê os dois arquivos e exige listas idênticas, na mesma
ordem. Se você mexer aqui, mexa lá também — ou o teste acusa.

⚠️  O bloco `TIPOS` abaixo é lido por aquele teste como JSON. Mantenha aspas
    DUPLAS e nenhuma vírgula sobrando, ou o teste para de conseguir ler.

Cada contagem tenta uma LISTA de nomes, na ordem, e PARA na primeira que existir.
A Meta manda a mesma conversa com mais de um `action_type`; somar contaria duas
vezes a mesma pessoa.

PURO: sem rede, sem banco.
"""

TIPOS = {
    "conversas": ["onsite_conversion.total_messaging_connection", "onsite_conversion.messaging_conversation_started_7d"],
    "cadastros": ["lead", "onsite_conversion.lead_grouped"],
    "compras": ["purchase", "omni_purchase"],
    "visitas": ["landing_page_view"]
}
# VISITA é landing_page_view, e não link_click: clique não é visita — parte das
# pessoas sai antes de a página abrir. O rótulo errado inflaria o denominador.


def contagens_da_campanha(actions):
    """Recebe o `actions` de UMA campanha e devolve as quatro contagens.

    Ausência vira 0, não None: quem chama grava o dicionário inteiro, e a coluna
    nula tem outro significado no banco (= "nunca perguntei"), que é justamente o
    que o backfill usa para saber o que ainda falta.
    """
    lista = actions if isinstance(actions, list) else []
    saida = {}
    for chave, nomes in TIPOS.items():
        saida[chave] = 0
        for nome in nomes:
            achou = next((a for a in lista if isinstance(a, dict) and a.get("action_type") == nome), None)
            if achou is not None:
                try:
                    saida[chave] = int(float(achou.get("value", 0) or 0))
                except (TypeError, ValueError):
                    saida[chave] = 0
                break
    return saida


if __name__ == "__main__":
    # Conferência rápida: `python3 acoes_de_campanha.py`. Não há suíte de testes
    # Python neste repositório — a suíte é Node — então o que dá para provar aqui
    # fica aqui, e o que compara com a nuvem fica no teste Node.
    assert contagens_da_campanha(None) == {"conversas": 0, "cadastros": 0, "compras": 0, "visitas": 0}
    assert contagens_da_campanha([]) == {"conversas": 0, "cadastros": 0, "compras": 0, "visitas": 0}
    assert contagens_da_campanha([{"action_type": "purchase", "value": "3"}])["compras"] == 3
    # Para na PRIMEIRA que existir: com as duas presentes, vale a primeira da lista.
    assert contagens_da_campanha([
        {"action_type": "onsite_conversion.messaging_conversation_started_7d", "value": "9"},
        {"action_type": "onsite_conversion.total_messaging_connection", "value": "4"},
    ])["conversas"] == 4
    # A Meta manda número como texto, e às vezes com casa decimal.
    assert contagens_da_campanha([{"action_type": "lead", "value": "2.0"}])["cadastros"] == 2
    # Lixo não derruba nem inventa.
    assert contagens_da_campanha([{"action_type": "lead", "value": "abc"}])["cadastros"] == 0
    assert contagens_da_campanha(["nada a ver", None])["visitas"] == 0
    # clique NÃO é visita
    assert contagens_da_campanha([{"action_type": "link_click", "value": "50"}])["visitas"] == 0
    print("acoes_de_campanha.py: todas as conferências passaram.")
