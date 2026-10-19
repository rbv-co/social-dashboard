#!/bin/sh
# Troca de banco dos robôs da VPS no corte: liga SAIU_DO_SUPABASE e grava, em /etc/robos.env, a URL de CADA papel do api-db
# (ops/vps/api-db/LEIA-ME.md, "Robôs da VPS"). Reversível: o env de antes fica em DIR e `reverter` o devolve byte a byte.
# Roda NA VPS, como root, SÓ no passo do corte do roteiro. Não é executado antes disso.
# Uso: sh ops/virada/robos-troca-env.sh <aplicar|reverter> DIR [ENV=/etc/robos.env] [SEGREDOS=/root/secrets]
#   aplicar   exige TODA senha em SEGREDOS (falha antes de mexer em qualquer coisa), guarda DIR/robos.env.antes (nunca
#             sobrescreve) e troca de forma atômica. Remove só as chaves que ele mesmo grava e acrescenta as novas.
#             SUPABASE_SERVICE_KEY vira STORAGE_SUPABASE_SERVICE_KEY (guardada para a fase 2 do Storage; nenhum robô a recebe: opr-diario e faxina-storage ficam recusados até o plano 03).
#             O DATABASE_URL global (Supabase) fica: com SAIU_DO_SUPABASE ligada o rodar-robo.sh RECUSA o robô que ainda
#             aponta para lá (falha alta), e robô fora do contrato não perde a conexão em silêncio.
#   reverter  devolve DIR/robos.env.antes ao ENV (some a flag e as URLs novas) e confere por sha256.
# Senha nunca vai à tela, ao log nem à linha de comando (só entra no arquivo, modo 600). Saída: 0 ok; 1 falhou; 2 uso.
set -eu
ACAO=${1:-}; DIR=${2:-}; ENV=${3:-/etc/robos.env}; SEG=${4:-/root/secrets}
BANCO=${BANCO:-api}   # só o ensaio troca (api_corte, o clone); na virada é sempre `api`
[ -n "$DIR" ] && { [ "$ACAO" = aplicar ] || [ "$ACAO" = reverter ]; } || { sed -n '5,6p' "$0" >&2; exit 2; }
umask 077; mkdir -p "$DIR"
# variável de URL | arquivo da senha (em SEGREDOS) | papel
TABELA='REPORTAR_DATABASE_URL robo-reporte robo_reporte
ROBO_FOTOS_DO_SELO_DATABASE_URL robo-selo robo_selo
ROBO_PEDIDOS_DA_VESSEL_DATABASE_URL robo-pedidos-vessel robo_pedidos_vessel
ROBO_PEDIDOS_DA_SHOPIFY_DATABASE_URL robo-shopify robo_shopify
ROBO_META_ADS_NO_ZOHO_DATABASE_URL robo-metaads-zoho robo_metaads_zoho
VIGIA_DATABASE_URL robo-vigia-meta robo_vigia_meta
ROBO_NOTAS_DOS_PEDIDOS_DATABASE_URL robo-notas robo_notas
ROBO_RELATORIOS_COMERCIAIS_DATABASE_URL robo-relatorios robo_relatorios
ROBO_CARDS_COMERCIAL_DIARIO_DATABASE_URL robo-cards robo_cards
ROBO_GESTOR_COMERCIAL_DATABASE_URL robo-gestor robo_gestor
ROBO_SUGERIR_INTERESSES_DATABASE_URL robo-interesses robo_interesses
ROBO_OPR_DIARIO_DATABASE_URL robo-opr robo_opr
ROBO_BUDGET_IA_DATABASE_URL robo-budget robo_budget
ROBO_COLETOR_NOTICIAS_DATABASE_URL robo-noticias robo_noticias
ROBO_FAXINA_STORAGE_DATABASE_URL robo-faxina robo_faxina'
# variável | arquivo da senha: serviços que montam a URL sozinhos (copia-do-banco.sh, conteudo-vigia.sh) leem só a senha
EXTRAS='COPIA_DB_SENHA copia
CONTEUDO_DB_SENHA conteudo'
ANTES="$DIR/robos.env.antes"
soma() { sha256sum "$1" | cut -d' ' -f1; }

if [ "$ACAO" = reverter ]; then
  [ -f "$ANTES" ] || { echo "sem $ANTES: nada a reverter" >&2; exit 1; }
  cp -p "$ANTES" "$ENV.novo" && mv "$ENV.novo" "$ENV"
  [ "$(soma "$ENV")" = "$(soma "$ANTES")" ] || { echo "FALHOU: $ENV difere do backup" >&2; exit 1; }
  echo "revertido: $ENV = $ANTES"; exit 0
fi

[ -f "$ENV" ] || { echo "sem $ENV" >&2; exit 1; }
[ ! -e "$ANTES" ] || { echo "$ANTES já existe (corte já iniciado?): reverta ou mova antes" >&2; exit 1; }
echo "$TABELA" | while read -r v arq papel; do
  [ -s "$SEG/$arq.senha" ] || { echo "falta a senha $SEG/$arq.senha ($papel): aplique o papel antes" >&2; exit 1; }
  case "$(cat "$SEG/$arq.senha")" in *[!A-Za-z0-9._~-]*) echo "senha de $papel com caractere fora de [A-Za-z0-9._~-] (quebraria a URL): gere com openssl rand -hex 24" >&2; exit 1 ;; esac
done
echo "$EXTRAS" | while read -r v arq; do
  [ -s "$SEG/$arq.senha" ] || { echo "falta a senha $SEG/$arq.senha ($v): aplique o papel antes" >&2; exit 1; }
  case "$(cat "$SEG/$arq.senha")" in *[!A-Za-z0-9._~-]*) echo "senha de $v com caractere fora de [A-Za-z0-9._~-]: gere com openssl rand -hex 24" >&2; exit 1 ;; esac
done
cp -p "$ENV" "$ANTES"
NOVO="$ENV.novo"
# tira as chaves que este script grava (e SAIU_DO_SUPABASE), mantém o resto intacto, e acrescenta as novas
grep -Ev '^(export[[:space:]]+)?(SAIU_DO_SUPABASE|STORAGE_SUPABASE_SERVICE_KEY|SUPABASE_SERVICE_KEY|COPIA_DB_SENHA|CONTEUDO_DB_SENHA|REPORTAR_DATABASE_URL|VIGIA_DATABASE_URL|ROBO_[A-Z0-9_]*_DATABASE_URL)=' "$ANTES" > "$NOVO" || true
{
  echo 'SAIU_DO_SUPABASE=1'
  # Storage (fase 2): a chave do Supabase muda de nome, guardada, não entregue (opr-diario e faxina-storage recusados; ver rodar-robo.sh)
  sed -n 's/^\(export[[:space:]]\{1,\}\)\{0,1\}SUPABASE_SERVICE_KEY=/STORAGE_SUPABASE_SERVICE_KEY=/p' "$ANTES" | tail -1
  echo "$EXTRAS" | while read -r v arq; do printf '%s=%s\n' "$v" "$(cat "$SEG/$arq.senha")"; done
  echo "$TABELA" | while read -r v arq papel; do
    printf '%s=postgres://%s:%s@api-db:5432/%s?sslmode=disable\n' "$v" "$papel" "$(cat "$SEG/$arq.senha")" "$BANCO"
  done
} >> "$NOVO"
chmod --reference="$ANTES" "$NOVO" 2>/dev/null || chmod 600 "$NOVO"
n=$(grep -c '_DATABASE_URL=postgres://robo_' "$NOVO" || true)
grep -q '^SAIU_DO_SUPABASE=1$' "$NOVO" && [ "$n" -eq 15 ] && ! grep -q '^SUPABASE_SERVICE_KEY=' "$NOVO" || { rm -f "$NOVO" "$ANTES"; echo "FALHOU: env novo sem a flag, sem as 15 URLs ou com a chave antiga; $ENV não foi tocado" >&2; exit 1; }
mv "$NOVO" "$ENV"
echo "aplicado: flag ligada e $n URLs gravadas em $ENV; env de antes em $ANTES (reverter: sh $0 reverter $DIR $ENV)"
