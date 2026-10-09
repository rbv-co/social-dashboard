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
  e recusa arquivo ilegível ou menor que 1 KB (apaga o parcial).
- `testar-restauracao.sh [arquivo]`: confere o `.sha256`, restaura o mais recente num contêiner
  temporário `api-db-teste` (sem rede, 1 GB, volume removido ao fim) e compara as tabelas com o
  índice do dump e a contagem de `public.usuarios`. Nunca toca o banco de verdade.
- Para ensaiar fora da VPS: `BACKUP_DIR`, `BACKUP_RETENCAO_DIAS`, `API_DB_CONTAINER`, e
  `TESTE_CONTAINER` (o nome deve terminar em `-teste`).

## Regras do projeto

- **Nunca recriar o contêiner com operação em andamento** (migração, restauração, backup rodando).
  Para aplicar mudança no compose: `docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`.
- **Nunca `docker compose down -v`**: apaga o volume com os dados.
- A futura composição da API deve declarar `api_net` como `external: true`, e o `api-db` precisa
  estar de pé antes (é ele quem cria a rede).
- Atualização de versão menor (17.x): `docker compose -f /root/api-db/docker-compose.yml pull && docker compose -f /root/api-db/docker-compose.yml up -d --no-deps api-db`,
  em janela sem operação em andamento.
