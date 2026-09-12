#!/usr/bin/env python3
"""
Coletor de dados do Instagram para o Dashboard KPI.
Executa diariamente e armazena os dados no Supabase.
"""

import json
import os
import re
import requests
from datetime import date, datetime, timedelta
from supabase import create_client, Client
from dotenv import load_dotenv

from acoes_de_campanha import contagens_da_campanha
# A janela de datas do recorte de N dias. Cópia vigiada da que a Edge Function usa
# (supabase/functions/_shared/janela-de-ads.js): os dois robôs gravam as MESMAS
# linhas, e quem roda por último vence.
from janela_de_ads import janela_de_ads, janela_do_mes_corrente

load_dotenv()

SUPABASE_URL = "https://kounqtdoioootxqegkij.supabase.co"
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ["SUPABASE_KEY"]

TOKENS = {
    "17841401847160442": os.environ.get("TOKEN_RAISSA", ""),
    "17841401284454639": os.environ.get("TOKEN_BRENO", ""),
    "17841406451230767": os.environ.get("TOKEN_MANTOVA", ""),
    "17841462952561833": os.environ.get("TOKEN_VESSEL", ""),
    "17841464138609037": os.environ.get("TOKEN_MOTOEASY", ""),
    "17841401243622922": os.environ.get("TOKEN_HUMBERTO", ""),
    "17841400576243780": os.environ.get("TOKEN_MANTOVA", ""),  # Gustavo Guerra (@gumguerra) — usa token Mantova (mesmo BM)
}

# Ad Account IDs por ig_id (sem o prefixo "act_")
AD_ACCOUNTS = {
    "17841401847160442": "591630990582441",   # Raíssa
    "17841401284454639": "1523458001735386",  # Breno
    "17841406451230767": "1449585576442706",   # Mantova
    "17841462952561833": "1197997517858139",  # La Vessel
    "17841464138609037": "803642218253857",   # Motoeasy
}

PERIODS = [0, 1, 7, 14, 30]  # 0=hoje, 1=ontem (exato)
MTD_PERIOD = 99  # sentinel: mês corrente (1º do mês até hoje). Dashboard lê isso no "MÊS".
GRAPH = "https://graph.facebook.com/v21.0"


def api_get(path, params):
    r = requests.get(f"{GRAPH}/{path}", params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def coletar_seguidores(ig_id, token):
    data = api_get(ig_id, {"fields": "followers_count", "access_token": token})
    return data.get("followers_count", 0)


def coletar_follows_dia(ig_id, token, dia):
    """Follows/unfollows BRUTOS de um dia (métrica follows_and_unfollows).
    Retorna (gained, lost) — FOLLOWER e NON_FOLLOWER — ou (None, None) se indisponível.
    Requer conta com 100+ seguidores."""
    start = int(datetime.combine(dia, datetime.min.time()).timestamp())
    end = int(datetime.combine(dia, datetime.max.time()).timestamp())
    try:
        data = api_get(f"{ig_id}/insights", {
            "metric": "follows_and_unfollows", "period": "day",
            "metric_type": "total_value", "breakdown": "follow_type",
            "since": start, "until": end, "access_token": token,
        })
        rows = data.get("data") or []
        if not rows:
            return None, None
        bd = (rows[0].get("total_value") or {}).get("breakdowns") or []
        results = (bd[0].get("results") if bd else []) or []
        gained = lost = 0
        for r in results:
            dv = (r.get("dimension_values") or [None])[0]
            v = r.get("value", 0) or 0
            if dv == "FOLLOWER":
                gained = v
            elif dv == "NON_FOLLOWER":
                lost = v
        return gained, lost
    except Exception:
        return None, None


def coletar_stories_hoje(ig_id, token):
    """Conta apenas stories postados no dia calendário de hoje (fuso local)."""
    try:
        data = api_get(f"{ig_id}/stories", {
            "fields": "id,timestamp",
            "access_token": token,
            "limit": 100
        })
        all_stories = data.get("data", [])
        hoje_str = date.today().isoformat()  # "2026-05-21"
        # Filtra só os postados hoje no fuso local
        stories = []
        for s in all_stories:
            ts = s.get("timestamp", "")
            if ts:
                ts_norm = ts.replace("+0000", "+00:00").replace("Z", "+00:00")
                pub_local = datetime.fromisoformat(ts_norm).astimezone()
                if pub_local.date().isoformat() == hoje_str:
                    stories.append(s)
        shares = replies = 0
        for story in stories:
            try:
                ins = api_get(f"{story['id']}/insights", {
                    "metric": "replies,shares",
                    "access_token": token
                })
                for item in ins.get("data", []):
                    v = item.get("value") or (item.get("values") or [{}])[0].get("value", 0) or 0
                    if item["name"] == "shares":
                        shares += v
                    elif item["name"] == "replies":
                        replies += v
            except Exception:
                pass
        return {"count": len(stories), "shares": shares, "replies": replies}
    except Exception:
        return {"count": 0, "shares": 0, "replies": 0}


def coletar_midias(ig_id, token, dias):
    hoje = date.today()
    if dias == 0:
        from_date = hoje          # somente hoje
        to_date = hoje
    elif dias == 1:
        from_date = hoje - timedelta(days=1)  # somente ontem (exato)
        to_date = from_date
    else:
        from_date = hoje - timedelta(days=dias)
        to_date = None  # sem limite superior

    likes = saves = shares = 0
    posts = reels = 0

    # Paginação: /media volta no máx. 100 itens por página. Sem isso, contas
    # com >100 publicações na janela subcontavam likes/posts/saves/shares (ex.: 30D).
    # Como /media vem do mais novo p/ o mais antigo, paramos assim que passamos
    # do início da janela (early stop) — evita varrer o feed inteiro.
    url = f"{GRAPH}/{ig_id}/media"
    params = {
        "fields": "id,media_type,media_product_type,timestamp,like_count,owner",
        "access_token": token,
        "limit": 100,
    }
    stop = False
    while url and not stop:
        resp = requests.get(url, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()
        params = None  # a URL de 'next' já carrega cursor + token

        items = data.get("data", [])
        if not items:
            break

        for midia in items:
            produto = midia.get("media_product_type", "")
            ts = midia.get("timestamp", "")

            if ts:
                ts_norm = ts.replace("+0000", "+00:00").replace("Z", "+00:00")
                pub_local = datetime.fromisoformat(ts_norm).astimezone()  # UTC → fuso local
                # Passou do início da janela: nada mais à frente interessa → para tudo
                if pub_local.date() < from_date:
                    stop = True
                    break
                if to_date is not None and pub_local.date() > to_date:
                    continue

            # Ignora collabs onde a conta não é a criadora original
            owner_id = (midia.get("owner") or {}).get("id", ig_id)
            if owner_id != ig_id:
                continue

            # Stories não aparecem em /media — tratados separadamente
            if produto == "STORY":
                continue

            likes += midia.get("like_count", 0)

            if produto == "REELS":
                reels += 1
            else:
                posts += 1

            try:
                insights = api_get(f"{midia['id']}/insights", {
                    "metric": "saved,shares",
                    "access_token": token
                })
                for item in insights.get("data", []):
                    v = item.get("value") or (item.get("values") or [{}])[0].get("value", 0)
                    if item["name"] == "saved":
                        saves += v
                    elif item["name"] == "shares":
                        shares += v
            except Exception:
                pass

        if not stop:
            url = (data.get("paging") or {}).get("next")

    return {"likes": likes, "saves": saves, "shares": shares,
            "posts": posts, "reels": reels}


def sincronizar_campanhas(supabase, account_id, ad_account_id, token):
    """Busca todas as campanhas da conta e salva no banco (atualiza diariamente)."""
    try:
        data = api_get(f"act_{ad_account_id}/campaigns", {
            "fields": "id,name,objective,status",
            "limit": 200,
            "access_token": token,
        })
        campanhas = data.get("data", [])
        if not campanhas:
            return
        rows = [
            {"campaign_id": c["id"], "account_id": account_id,
             "name": c.get("name",""), "objective": c.get("objective",""),
             "status": c.get("status",""), "synced_at": date.today().isoformat()}
            for c in campanhas
        ]
        supabase.table("campaigns").upsert(rows, on_conflict="campaign_id").execute()
        ativos = sum(1 for c in campanhas if c.get("status") == "ACTIVE")
        print(f"   📋 {len(campanhas)} campanhas sincronizadas ({ativos} ativas)")
    except Exception as e:
        print(f"   ⚠️  Sync campanhas: {e}")


def obter_filtro_campanhas(supabase, account_id):
    """Retorna lista de campaign_ids selecionados pelo usuário, ou None se sem filtro."""
    try:
        r = supabase.table("campaign_filters").select("selected_ids").eq("account_id", account_id).execute()
        if r.data:
            ids = r.data[0].get("selected_ids") or []
            return ids if ids else None
    except Exception:
        pass
    return None


def coletar_ads_por_campanha(supabase, ad_account_id, account_id, token, dias, hoje, store_as=None):
    """Busca gasto por campanha individual e salva em campaign_insights.
    store_as: grava sob esse period_days (ex.: 99=mês-corrente) usando a janela de `dias`."""
    pdays = store_as if store_as is not None else dias
    # `store_as` só é usado pelo recorte 99 (mês corrente), que vai do 1º do mês
    # ATÉ HOJE de propósito — é o que o botão "MÊS / ATÉ AGORA" do painel promete.
    # Os recortes rolantes (0, 1, 7, 14, 30) passam pela janela comum: N dias
    # COMPLETOS, terminando ontem. Até 20/08/2026 eles pediam `until = hoje` e,
    # como o time_range da Meta conta as duas pontas, cobriam N+1 dias com o dia
    # de hoje (incompleto) dentro.
    janela = janela_do_mes_corrente(hoje, dias) if store_as is not None else janela_de_ads(hoje, dias)
    if janela is None:
        print(f"   ⚠️  janela inválida ({dias}D, {hoje}) — recorte pulado")
        return
    since, until = janela
    params = {
        # `actions` vem na MESMA resposta: não é chamada nova à Meta, não gasta
        # limite de taxa. É de dentro dele que saem conversas/cadastros/compras/visitas.
        "fields": "campaign_id,spend,impressions,clicks,reach,actions",
        "time_range": json.dumps({"since": since, "until": until}),
        "level": "campaign",
        "access_token": token,
    }
    try:
        data = api_get(f"act_{ad_account_id}/insights", params)
        rows = data.get("data", [])
        if not rows:
            return
        camp_rows = [
            {
                "campaign_id": r["campaign_id"],
                "account_id": account_id,
                "captured_at": hoje,
                "period_days": pdays,
                "spend": float(r.get("spend", 0) or 0),
                "impressions": int(r.get("impressions", 0) or 0),
                "clicks": int(r.get("clicks", 0) or 0),
                "reach": int(r.get("reach", 0) or 0),
                # As quatro contagens novas. Sem elas, o recorte MÊS/ATÉ AGORA do
                # painel de Redes mostrava "—" no custo por conversa, por cadastro,
                # por venda e por visita — porque quem escreve essa fatia é ESTE
                # robô, e ele não pedia `actions`. A regra de quais nomes valem é a
                # mesma da nuvem; ver acoes_de_campanha.py.
                **contagens_da_campanha(r.get("actions")),
            }
            for r in rows
        ]
        supabase.table("campaign_insights").upsert(
            camp_rows, on_conflict="campaign_id,account_id,captured_at,period_days"
        ).execute()
        print(f"   📊 {len(camp_rows)} campanhas salvas em campaign_insights ({pdays}{'=mês' if store_as else 'D'})")
    except Exception as e:
        print(f"   ⚠️  campaign_insights ({ad_account_id}, {dias}D): {e}")


def coletar_ads_conta(supabase, ad_account_id, account_id, token, dias, hoje, store_as=None):
    """Insights NÍVEL CONTA (sem time_increment) → account_insights.
    reach aqui é DEDUPLICADO pela Meta no período. Somar reach por campanha
    (campaign_insights) ou por dia conta a mesma pessoa várias vezes.
    store_as: grava sob esse period_days (ex.: 99=mês-corrente)."""
    pdays = store_as if store_as is not None else dias
    # `store_as` só é usado pelo recorte 99 (mês corrente), que vai do 1º do mês
    # ATÉ HOJE de propósito — é o que o botão "MÊS / ATÉ AGORA" do painel promete.
    # Os recortes rolantes (0, 1, 7, 14, 30) passam pela janela comum: N dias
    # COMPLETOS, terminando ontem. Até 20/08/2026 eles pediam `until = hoje` e,
    # como o time_range da Meta conta as duas pontas, cobriam N+1 dias com o dia
    # de hoje (incompleto) dentro.
    janela = janela_do_mes_corrente(hoje, dias) if store_as is not None else janela_de_ads(hoje, dias)
    if janela is None:
        print(f"   ⚠️  janela inválida ({dias}D, {hoje}) — recorte pulado")
        return
    since, until = janela
    params = {
        "fields": "spend,impressions,clicks,reach,frequency",
        "time_range": json.dumps({"since": since, "until": until}),
        "level": "account",
        "access_token": token,
    }
    try:
        data = api_get(f"act_{ad_account_id}/insights", params)
        rows = data.get("data", [])
        if not rows:
            return
        r = rows[0]
        supabase.table("account_insights").upsert({
            "account_id": account_id,
            "captured_at": hoje,
            "period_days": pdays,
            "spend": float(r.get("spend", 0) or 0),
            "impressions": int(r.get("impressions", 0) or 0),
            "clicks": int(r.get("clicks", 0) or 0),
            "reach": int(r.get("reach", 0) or 0),
            "frequency": float(r.get("frequency", 0) or 0),
        }, on_conflict="account_id,captured_at,period_days").execute()
        print(f"   📡 account_insights ({pdays}{'=mês' if store_as else 'D'}): reach {int(r.get('reach', 0) or 0):,} (dedup)")
    except Exception as e:
        print(f"   ⚠️  account_insights ({ad_account_id}, {dias}D): {e}")


def processar_conta(supabase, account_id, ig_id, token, nome):
    hoje = date.today().isoformat()
    print(f"\n📊 Coletando: {nome} ({ig_id})")

    seguidores = coletar_seguidores(ig_id, token)
    supabase.table("daily_snapshots").upsert(
        {"account_id": account_id, "captured_at": hoje, "followers_count": seguidores},
        on_conflict="account_id,captured_at"
    ).execute()
    # gained/lost: a métrica follows_and_unfollows finaliza com atraso (1-2 dias),
    # então re-coletamos os últimos 3 dias a cada run (auto-corrige os mais recentes).
    g0 = l0 = None
    for dd in range(0, 3):
        dia = date.today() - timedelta(days=dd)
        gg, ll = coletar_follows_dia(ig_id, token, dia)
        if gg is None:
            continue
        supabase.table("daily_snapshots").update({"gained": gg, "lost": ll}) \
            .eq("account_id", account_id).eq("captured_at", dia.isoformat()).execute()
        if dd == 0:
            g0, l0 = gg, ll
    extra = f" | ▲{g0} novos / ▼{l0} saíram (hoje)" if g0 is not None else ""
    print(f"   Seguidores: {seguidores:,}{extra}")

    # Stories só ficam disponíveis via API por 24h — coletamos uma vez por dia
    stories_data = coletar_stories_hoje(ig_id, token)
    stories_hoje = stories_data["count"]
    print(f"   Stories ativos: {stories_hoje} | ↗️ {stories_data['shares']:,} encaminh. | 💬 {stories_data['replies']:,} DMs")

    for dias in PERIODS:
        m = coletar_midias(ig_id, token, dias)
        # Para período 1D usamos stories_hoje; para períodos maiores acumulamos o histórico do BD
        stories_val = stories_hoje if dias <= 1 else None
        supabase.table("engagement_snapshots").upsert(
            {"account_id": account_id, "captured_at": hoje, "period_days": dias,
             "likes": m["likes"], "saves": m["saves"], "shares": m["shares"]},
            on_conflict="account_id,captured_at,period_days"
        ).execute()
        row = {"account_id": account_id, "captured_at": hoje, "period_days": dias,
               "posts_count": m["posts"], "reels_count": m["reels"]}
        if stories_val is not None:
            row["stories_count"] = stories_val
            row["story_shares"] = stories_data["shares"]
            row["story_replies"] = stories_data["replies"]
        supabase.table("content_snapshots").upsert(row, on_conflict="account_id,captured_at,period_days").execute()
        s_label = str(stories_val) if stories_val is not None else "—"
        print(f"   {dias:2d}D → ❤️ {m['likes']:,} | 🔖 {m['saves']:,} | ↗️ {m['shares']:,} | "
              f"Posts:{m['posts']} Stories:{s_label} Reels:{m['reels']}")

    # ── Mês corrente (1º do mês até hoje) → period_days=99 (MÊS real no dashboard) ──
    dias_mtd = max(date.today().day - 1, 0)  # dia 1 do mês → 0 (só hoje)
    m_mtd = coletar_midias(ig_id, token, dias_mtd)
    supabase.table("engagement_snapshots").upsert(
        {"account_id": account_id, "captured_at": hoje, "period_days": MTD_PERIOD,
         "likes": m_mtd["likes"], "saves": m_mtd["saves"], "shares": m_mtd["shares"]},
        on_conflict="account_id,captured_at,period_days"
    ).execute()
    supabase.table("content_snapshots").upsert(
        {"account_id": account_id, "captured_at": hoje, "period_days": MTD_PERIOD,
         "posts_count": m_mtd["posts"], "reels_count": m_mtd["reels"]},
        on_conflict="account_id,captured_at,period_days"
    ).execute()
    print(f"   MÊS → ❤️ {m_mtd['likes']:,} | 🔖 {m_mtd['saves']:,} | ↗️ {m_mtd['shares']:,} | "
          f"Posts:{m_mtd['posts']} Reels:{m_mtd['reels']}")

    # Ads
    ad_account_id = AD_ACCOUNTS.get(ig_id, "")
    if ad_account_id:
        sincronizar_campanhas(supabase, account_id, ad_account_id, token)
        for dias in PERIODS:
            # Salva dados individuais por campanha (para filtro funcionar em tempo real no dashboard)
            coletar_ads_por_campanha(supabase, ad_account_id, account_id, token, dias, hoje)
            # Salva totais nível-conta (reach deduplicado) → account_insights
            coletar_ads_conta(supabase, ad_account_id, account_id, token, dias, hoje)
        # Mês corrente (period_days=99): janela do 1º do mês até hoje
        coletar_ads_por_campanha(supabase, ad_account_id, account_id, token, dias_mtd, hoje, store_as=MTD_PERIOD)
        coletar_ads_conta(supabase, ad_account_id, account_id, token, dias_mtd, hoje, store_as=MTD_PERIOD)


NOMES_TOKENS = {
    "17841401847160442": "TOKEN_RAISSA",
    "17841401284454639": "TOKEN_BRENO",
    "17841406451230767": "TOKEN_MANTOVA",
    "17841462952561833": "TOKEN_VESSEL",
    "17841464138609037": "TOKEN_MOTOEASY",
    "17841401243622922": "TOKEN_HUMBERTO",
}


def renovar_token(nome_env, token):
    app_id = os.environ.get("APP_ID", "")
    app_secret = os.environ.get("APP_SECRET", "")
    if not app_id or not app_secret:
        return token
    try:
        r = requests.get(f"{GRAPH}/oauth/access_token", params={
            "grant_type": "fb_exchange_token",
            "client_id": app_id,
            "client_secret": app_secret,
            "fb_exchange_token": token,
        }, timeout=30)
        r.raise_for_status()
        novo = r.json().get("access_token", "")
        if novo:
            print(f"   ✅ {nome_env} renovado")
            return novo
    except Exception as e:
        print(f"   ⚠️  Erro ao renovar {nome_env}: {e}")
    return token


def renovar_todos_tokens():
    print("\n🔄 Renovando tokens do Instagram...")
    env_path = os.path.join(os.path.dirname(__file__), ".env")
    try:
        with open(env_path, "r") as f:
            conteudo = f.read()
    except Exception as e:
        print(f"   ⚠️  Não foi possível ler .env: {e}")
        return

    for ig_id, nome_env in NOMES_TOKENS.items():
        token_atual = TOKENS.get(ig_id, "")
        if not token_atual:
            continue
        novo = renovar_token(nome_env, token_atual)
        TOKENS[ig_id] = novo
        conteudo = re.sub(rf"^{nome_env}=.*$", f"{nome_env}={novo}", conteudo, flags=re.MULTILINE)

    try:
        with open(env_path, "w") as f:
            f.write(conteudo)
        print("   📝 .env atualizado com tokens renovados")
    except Exception as e:
        print(f"   ⚠️  Não foi possível salvar .env: {e}")


def main():
    print("=" * 60)
    print("🚀 Iniciando coleta | Data:", date.today().isoformat())
    print("=" * 60)
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
    contas = supabase.table("accounts").select("id, name, instagram_id, access_token").execute()
    for conta in contas.data:
        ig_id = conta["instagram_id"]
        token = conta.get("access_token") or TOKENS.get(ig_id, "")
        if not token:
            print(f"\n⚠️  Sem token para {conta['name']}")
            continue
        try:
            processar_conta(supabase, conta["id"], ig_id, token, conta["name"])
        except Exception as e:
            print(f"\n❌ Erro em {conta['name']}: {e}")
    # Renovação desativada: usamos token de System User (não expira). O
    # fb_exchange_token não perpetua token e só gerava erros 400 ruidosos —
    # rode gerar_tokens.py se algum dia precisar trocar o token.
    # renovar_todos_tokens()
    print("\n✅ Concluído!")


if __name__ == "__main__":
    main()
