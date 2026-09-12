"""A JANELA DE DATAS DO RECORTE DE N DIAS — cópia vigiada do lado da nuvem.

O original é supabase/functions/_shared/janela-de-ads.js. Python não importa
JavaScript, então isto é uma CÓPIA — e cópia sem vigia diverge. O guarda é
coletor/lib/janela-python-e-nuvem-batem.test.mjs, que roda os DOIS e exige a
mesma resposta. Mexeu aqui, mexe lá.

POR QUE OS DOIS PRECISAM CONCORDAR: os dois robôs gravam `campaign_insights` e
`account_insights` com a MESMA chave (account_id, captured_at, period_days). Quem
roda por último vence. Consertar a janela em um só seria o outro desfazendo o
conserto várias vezes por dia — este coletor roda 5x ao dia pelo launchd.

O DEFEITO (medido em 20/08/2026): pedia-se `{since: hoje - N, until: hoje}`, e o
`time_range` da Meta é INCLUSIVO nas duas pontas. "7 dias" virava OITO, e o
oitavo era o dia de hoje, que ainda não acabou. Todo custo por resultado da
seção 02 do painel saía barato demais, e o alcance nunca fechava com a Meta.
"""

from datetime import date, timedelta


def janela_de_ads(hoje, dias):
    """Espelho de `janelaDeAds` do lado da nuvem.

    hoje: 'AAAA-MM-DD' (BRT). dias: 0 = o próprio dia; N > 0 = os últimos N dias
    COMPLETOS, terminando ONTEM. Devolve (since, until) ou None para entrada
    inválida — nunca uma janela chutada, que preencheria o período errado.
    """
    if not isinstance(hoje, str) or not hoje:
        return None
    # `bool` é subclasse de `int` em Python: True viraria 1 e responderia outra
    # pergunta com confiança.
    if isinstance(dias, bool) or not isinstance(dias, int) or dias < 0:
        return None
    try:
        d = date.fromisoformat(hoje)
    except ValueError:
        return None
    if dias == 0:
        return (hoje, hoje)
    # `until` é ONTEM: o dia de hoje ainda está correndo, e meio dia contado como
    # dia inteiro é exatamente o que fazia o custo sair barato.
    return ((d - timedelta(days=dias)).isoformat(), (d - timedelta(days=1)).isoformat())


def janela_do_mes_corrente(hoje, dias_mtd):
    """O recorte 99 (MÊS / ATÉ AGORA): do 1º do mês ATÉ HOJE, inclusive.

    Este INCLUI o dia corrente de propósito, e não é o mesmo caso acima: o painel
    chama esse período de "até agora" e mostra o mês corrente com o dia de hoje
    dentro. Tirar hoje daqui mudaria o que o botão promete — e no dia 1º do mês
    `dias_mtd` é 0, então a janela viraria de trás para frente.
    """
    if not isinstance(hoje, str) or not hoje:
        return None
    if isinstance(dias_mtd, bool) or not isinstance(dias_mtd, int) or dias_mtd < 0:
        return None
    try:
        d = date.fromisoformat(hoje)
    except ValueError:
        return None
    return ((d - timedelta(days=dias_mtd)).isoformat(), hoje)
