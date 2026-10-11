# Postgres 17 da API (`api-db`)

Contêiner `api-db` (Postgres 17, imagem `postgres:17-trixie`), rede `api_net`, **sem porta
publicada**. Quem fala com ele: a API e o worker (na rede `api_net`) e `docker exec` para
administração. Memória: teto de 1 GB, `shared_buffers=256MB`, `shm_size=256mb` (a VPS é compartilhada).

## Como o Mac chega ao banco

Não há porta publicada, então só por túnel SSH até o IP do contêiner na rede `api_net`:

```sh
IP=$(ssh op "docker inspect -f '{{(index .NetworkSettings.Networks \"api_net\").IPAddress}}' api-db")
ssh -N -L 55470:"$IP":5432 op     # em outro terminal: psql -h 127.0.0.1 -p 55470 -U api api
```

A senha vem de `/root/secrets/api-db.env`; nunca no chat.
Ao carregar dumps SQL em texto puro no `psql` (linhas `\restrict`), o `psql` do Mac precisa ser
**≥ 16.10 / 17.6**; senão use `sh ops/migracao/pg17.sh psql ...`.

## Primeira subida (só com ok do dono)

Um comando por linha (colar com quebra de linha quebra o `&&`). O `scp -r` é só da primeira vez;
nas próximas implantações copie os arquivos alterados um a um.

```sh
scp -r ops/vps/api-db op:/root/api-db
ssh op
mkdir -p /root/secrets && chmod 700 /root/secrets
[ -e /root/secrets/api-db.env ] || ( umask 077; printf 'POSTGRES_USER=api\nPOSTGRES_PASSWORD=%s\nPOSTGRES_DB=api\n' "$(openssl rand -hex 24)" > /root/secrets/api-db.env )
docker compose -f /root/api-db/docker-compose.yml up -d
docker inspect -f '{{.State.Health.Status}}' api-db
```

O teste do segredo (`[ -e ... ]`) importa: `POSTGRES_PASSWORD` só vale na primeira inicialização
do volume; regerar o arquivo depois desalinharia senha e banco. Esperar o health virar `healthy`.

## Depois que o esquema e os dados estiverem carregados (só com ok do dono)

Backup, teste de restauração e cron só entram **depois** da carga: o backup recusa banco vazio
(< 1 KB) e o teste de restauração exige tabelas e `public.usuarios` com linhas.

```sh
sh /root/api-db/backup-api-db.sh
sh /root/api-db/testar-restauracao.sh
```

Só com a restauração passando, agendar (`crontab -e` como root):

```
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
40 3 * * * flock -n /run/backup-api-db.lock sh /root/api-db/backup-api-db.sh >> /var/log/backup-api-db.log 2>&1
```

## Backup e restauração

- `backup-api-db.sh`: `pg_dump -Fc` para `/root/backups-api/api-db-AAAA-MM-DD-HHMM.dump` + `.sha256`
  (modo 600), retenção de 14 dias. Lê o dump inteiro com `pg_restore -f /dev/null` (pega truncamento)
  e recusa arquivo ilegível, menor que 1 KB ou cujo índice não liste nenhuma `TABLE public` (apaga o parcial).
- `testar-restauracao.sh [arquivo]`: confere o `.sha256`, restaura o mais recente num contêiner
  temporário `api-db-teste` (sem rede, 1 GB, volume removido ao fim) e compara a lista de tabelas (`pg_class` r/p do `public`) com a do
  índice do dump e a contagem de `public.usuarios`. Nunca toca o banco de verdade.
- Para ensaiar fora da VPS: `BACKUP_DIR`, `BACKUP_RETENCAO_DIAS`, `API_DB_CONTAINER`, e
  `TESTE_CONTAINER` (o nome deve terminar em `-teste`).

## Cópia de segurança para o Zoho: papel `copia` (no corte, só com ok do dono)

Até o corte, a cópia diária para o Zoho WorkDrive (`coletor/vps/robos.cron` → `coletor/vps/copia-do-banco.sh` →
`coletor/guardar-copia-do-banco.mjs`, 06h12 UTC) lê o Supabase. No corte ela passa a ler ESTE banco com o papel
`copia`: SELECT em todas as tabelas do `public` (menos `sessoes`) e INSERT só em `robos_execucoes` (a linha da
rodada, que o painel cobra como crítica). Continua sem porta publicada: o `copia-do-banco.sh` lê o IP do `api-db`
na `api_net` a cada rodada e monta `COPIA_DATABASE_URL` sozinho quando `COPIA_DB_SENHA` existe em `/etc/robos.env`.

Um comando por linha. A senha nunca vai para a linha de comando (o `ps` do host mostra argumentos): entra pelo
ambiente, e o `papel-copia.sql` a lê com `\getenv`.

```sh
scp ops/vps/api-db/papel-copia.sql op:/root/api-db/papel-copia.sql
ssh op
[ -e /root/secrets/copia.senha ] || ( umask 077; openssl rand -hex 24 > /root/secrets/copia.senha )
SENHA_COPIA="$(cat /root/secrets/copia.senha)" docker exec -i -e SENHA_COPIA api-db psql -U api -d api < /root/api-db/papel-copia.sql
grep -q '^COPIA_DB_SENHA=' /etc/robos.env || echo "COPIA_DB_SENHA=$(cat /root/secrets/copia.senha)" >> /etc/robos.env
/opt/robos/social-dashboard/coletor/vps/rodar-robo.sh copia-do-banco 60 -- bash coletor/vps/copia-do-banco.sh --ensaio
tail -30 /var/log/robos/copia-do-banco.log
```

O ensaio lista as tabelas e as contagens sem enviar nada. Como o papel `copia` não enxerga `sessoes`, o ensaio conta uma tabela a menos que o banco tem. A senha é hex de propósito: vai na URL sem escapar.
Reaplicar o `papel-copia.sql` é seguro (troca a senha e refaz os GRANTs; tabela nova criada pelo `api` também
entra, por `ALTER DEFAULT PRIVILEGES`). Para voltar ao Supabase antes do corte: apagar a linha `COPIA_DB_SENHA`
do `/etc/robos.env`. No corte, ligar também `gh variable set SAIU_DO_SUPABASE --body sim`: a retaguarda manual
do GitHub (`.github/workflows/copia-do-banco.yml`) passa a recusar, porque copiaria o Supabase velho por cima da
cópia boa do dia.

## Regras do projeto

- **Nunca recriar o contêiner com operação em andamento** (migração, restauração, backup rodando).
  Para aplicar mudança no compose: `docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`.
- **Nunca `docker compose down -v`**: apaga o volume com os dados.
- A futura composição da API deve declarar `api_net` como `external: true`, e o `api-db` precisa
  estar de pé antes (é ele quem cria a rede).
- Atualização de versão menor (17.x): `docker compose -f /root/api-db/docker-compose.yml pull && docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`,
  em janela sem operação em andamento.
