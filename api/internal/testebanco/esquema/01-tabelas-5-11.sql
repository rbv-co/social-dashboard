-- FATIA 5.11 do esquema de produção para os testes (GERADO por fatia511.mjs: create/alter table e índices das
-- migrations em db/migrations, em ordem de nome, das tabelas que as 62 RPCs de atendimentos da Vessel tocam).
-- Sem RLS, policy nem gatilho (os gatilhos vivos vão em 03-funcoes-5-11.sql). Tabelas: vessel_agenda_da_loja, vessel_atendimentos, vessel_beauty_session_cadastros, vessel_beauty_sessions, vessel_candidaturas, vessel_card_consultas, vessel_client_advisors, vessel_consentimentos, vessel_convite_aberturas, vessel_lista_espera, vessel_origens, vessel_pedido_itens, vessel_pedidos, vessel_pessoas, vessel_praca_cidades, vessel_pracas, vessel_private_edit_card_leituras, vessel_private_edits, vessel_rd_envios, vessel_rsvp_tentativas, vessel_sessao_aberturas, vessel_sessoes, vessel_stylist_aberturas, vessel_stylist_circle_edicoes, vessel_stylist_contatos, vessel_stylist_etapas, vessel_stylist_etapas_historico, vessel_stylist_etapas_trilha, vessel_stylist_motivos_de_saida, vessel_stylist_na_edicao, vessel_stylist_qualificacoes, vessel_stylists, vessel_tentativas_de_login, vessel_tentativas_de_presente, vessel_tentativas_de_transferencia, vessel_transferencias, vessel_vendedores_bling

-- funções que o DDL usa (CHECK/default), verbatim do levantamento
set check_function_bodies = off;
CREATE OR REPLACE FUNCTION public.vessel_faixa_da_nota(p_nota integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select case
    when p_nota is null then null
    when p_nota >= 75 then 'A'
    when p_nota >= 55 then 'B'
    else 'C'
  end
$function$;

-- 2026-08-28-vessel-lista-de-espera.sql
create table if not exists public.vessel_lista_espera (
  id             bigserial primary key,
  nome           text not null,
  email          text not null,
  whatsapp       text not null,
  origem         text not null default 'lp-vesselbrasil',
  ip_hash        text,
  aceite_em      timestamptz not null default now(),
  aceite_versao  text not null,
  criado_em      timestamptz not null default now(),
  -- estado de cada espelho, preenchido pelo robô (NUNCA pela página)
  bling_id       text,
  bling_em       timestamptz,
  planilha_em    timestamptz,
  ultimo_erro    text
);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create table if not exists public.vessel_pessoas (
  id             bigserial primary key,
  nome           text not null,
  telefone       text not null,              -- canônico: 55 + DDD + número
  email          text,
  cidade         text,
  consultora     text,                       -- CA-xx responsável, quando houver
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create table if not exists public.vessel_origens (
  id              bigserial primary key,
  pessoa_id       bigint not null references public.vessel_pessoas(id) on delete cascade,
  momento         timestamptz not null default now(),
  canal           text not null,
  campanha_id     text,
  evento_id       text,
  parceiro_id     text,
  stylist_id      text,
  criativo_id     text,
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  clique_meta     text,      -- o _fbc: a etiqueta do clique no anuncio
  navegador_meta  text       -- o _fbp
);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create table if not exists public.vessel_atendimentos (
  id               bigserial primary key,
  pessoa_id        bigint not null references public.vessel_pessoas(id) on delete cascade,
  loja             text not null,
  client_advisor   text,
  quando           timestamptz,
  status           text not null default 'solicitado',
  convite_codigo   text,
  origem_registro  text not null,
  presenca_em      timestamptz,
  ip_hash          text,          -- so hash, nunca o endereco cru
  criado_em        timestamptz not null default now(),
  atualizado_em    timestamptz not null default now()
);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create table if not exists public.vessel_convite_aberturas (
  id              bigserial primary key,
  momento         timestamptz not null default now(),
  convite_codigo  text,
  praca           text,
  client_advisor  text,
  via             text,
  ip_hash         text
);

-- 2026-09-17-vessel-client-advisor-e-o-vendedor.sql
create table if not exists public.vessel_vendedores_bling (
  bling_vendedor_id bigint primary key,
  nome              text not null,
  chave             text not null,          -- o nome sem acento e sem maiúscula
  loja_id           bigint,
  situacao          text,                   -- A ativo | I inativo | E excluído
  atualizado_em     timestamptz not null default now()
);

-- 2026-09-17-vessel-client-advisors.sql
create table if not exists public.vessel_client_advisors (
  id         bigserial primary key,
  codigo     text not null,
  nome       text not null,
  chave      text not null,           -- o nome sem acento e sem maiúscula
  loja       text,
  criado_em  timestamptz not null default now()
);

-- 2026-09-17-vessel-contas-base.sql
create table if not exists public.vessel_sessoes (
  id            uuid primary key default gen_random_uuid(),
  cliente_id    uuid not null references public.vessel_clientes(id) on delete cascade,
  token_hash    text not null unique,
  criada_em     timestamptz not null default now(),
  expira_em     timestamptz not null,
  ultimo_uso_em timestamptz,
  agente        text,
  ip_hash       text,
  encerrada_em  timestamptz
);

-- 2026-09-17-vessel-contas-base.sql
create table if not exists public.vessel_tentativas_de_login (
  id      bigserial primary key,
  chave   text not null,          -- login normalizado
  quando  timestamptz not null default now(),
  acertou boolean not null
);

-- 2026-09-17-vessel-pedidos.sql
create table if not exists public.vessel_pedidos (
  id                 bigserial primary key,
  bling_pedido_id    bigint not null,
  numero             text,
  bling_contato_id   bigint,
  contato_nome       text,
  pessoa_id          bigint references public.vessel_pessoas(id) on delete set null,
  casou_por          text,              -- bling_contato | telefone | (nulo: orfa)
  loja_id            bigint,
  vendedor_id        bigint,
  -- ⚠️ DUAS DATAS, DE PROPOSITO. A casa conta a venda pela DATA DO PEDIDO; a
  -- nota sai depois (no Atacado, no dia seguinte) e e ela que congela o valor.
  -- Guardar so uma obrigaria a escolher aqui uma decisao que e de quem le.
  data_do_pedido     date not null,
  data_da_nota       date,
  total_produtos     numeric(12,2),
  desconto           numeric(12,2),
  outras_despesas    numeric(12,2),
  total_do_bling     numeric(12,2),
  -- O valor que realmente entrou, quando o Bling congelou o pedido errado.
  -- Mesma regra das telas (`_shared/valor-corrigido.js`).
  total_corrigido    numeric(12,2),
  situacao_id        int,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);

-- 2026-09-17-vessel-pedidos.sql
create table if not exists public.vessel_pedido_itens (
  id               bigserial primary key,
  pedido_id        bigint not null references public.vessel_pedidos(id) on delete cascade,
  sku              text,
  descricao        text,
  quantidade       numeric(12,3),
  valor_unitario   numeric(12,2),
  desconto         numeric(12,2)
);

-- 2026-09-17-vessel-registro-com-conta.sql
create table if not exists public.vessel_tentativas_de_presente (
  codigo text not null,
  quando timestamptz not null default now()
);

-- 2026-09-17-vessel-um-horario-uma-visita.sql
create table if not exists public.vessel_agenda_da_loja (
  loja               text primary key,
  ao_mesmo_tempo     int  not null default 1,
  minutos_por_visita int  not null default 60,
  atualizado_em      timestamptz not null default now()
);

-- 2026-09-18-vessel-beauty-sessions.sql
create table if not exists public.vessel_beauty_sessions (
  codigo     text primary key,          -- BS-20260925-CPS-01
  quando     date,
  praca      text,                      -- CPS | SBO | BSB | SAO
  loja       text not null,             -- para qual loja o interesse vai
  parceiro   text,                      -- o nome do salão/espaço
  ativa      boolean not null default true,
  criado_em  timestamptz not null default now()
);

-- 2026-09-18-vessel-contar-as-beauty-sessions.sql
create table if not exists public.vessel_sessao_aberturas (
  id       bigserial primary key,
  momento  timestamptz not null default now(),
  codigo   text not null,
  peca     text,                       -- mesa | cartao
  via      text,                       -- qr | texto
  ip_hash  text
);

-- 2026-09-18-vessel-pedido-de-atendimento.sql
create table if not exists public.vessel_consentimentos (
  id          bigserial primary key,
  pessoa_id   bigint not null references public.vessel_pessoas(id) on delete cascade,
  finalidade  text not null,              -- atendimento | marketing | imagem
  canal       text,                       -- whatsapp | email
  versao      text,                       -- a versão do texto que ela leu
  fonte       text,                       -- de qual página veio
  situacao    text not null default 'ativo',   -- ativo | revogado
  momento     timestamptz not null default now(),
  revogado_em timestamptz,
  teste       boolean not null default false
);

-- 2026-09-18-vessel-rastreio-por-stylist.sql
create table if not exists public.vessel_stylist_aberturas (
  id         bigserial primary key,
  momento    timestamptz not null default now(),
  codigo     text not null,
  via        text,                      -- qr | texto
  ip_hash    text
);

-- 2026-09-18-vessel-stylist-circle.sql
create table if not exists public.vessel_stylists (
  id            bigserial primary key,
  -- ⚠️ O CÓDIGO É O QUE VAI PARA O LINK DE RASTREIO (T07), e o módulo 10 é
  -- explícito: "gerado internamente SEM NOME no URL". Um link com o nome da
  -- stylist dentro é o nome dela circulando em toda parte onde o link for
  -- colado.
  codigo        text not null,
  nome          text not null,
  whatsapp      text not null,            -- canônico: 55 + DDD + número
  cidade        text,
  instagram     text,
  atuacao       text,                     -- stylist | personal-shopper | consultoria | outra
  quer_sessao   text,                     -- sim | entender
  convidadas    text,                     -- ate-4 | 5-8 | mais-de-8
  praca_preview text,                     -- CPS | SAO | SBO | BSB
  estagio       text not null default 'prospect',
  -- ⚠️ A ORIGEM DELA MORA AQUI, e NAO em `vessel_origens`. Aquela tabela e "de
  -- onde a PESSOA chegou" — e o `stylist_id` dela significa outra coisa: "esta
  -- cliente veio POR uma stylist". Guardar o toque da stylist ali misturaria
  -- quem indica com quem foi indicada, e a conta de atribuicao passaria a somar
  -- o canal duas vezes.
  -- ⚠️ E SO E PREENCHIDA NA CRIACAO: a primeira origem e o first touch, e o
  -- modulo 10 proibe sobrescrever.
  origem_canal    text,
  origem_campanha text,
  origem_utm      jsonb,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  teste         boolean not null default false
);

-- 2026-09-18-vessel-private-edit.sql
create table if not exists public.vessel_private_edits (
  id          bigserial primary key,
  -- O identificador do CRM, do módulo 10: PE-AAAAMMDD-PRACA-SEQ.
  codigo      text not null,
  -- ⚠️ A CHAVE DO LINK É OUTRA COISA, E É SORTEADA. O `codigo` se adivinha
  -- trocando a data e a sequência, e esta página PRECISA dizer o nome da
  -- anfitriã — é o "Hosted by" do convite. As duas juntas entregariam a agenda
  -- de encontros da marca e quais stylists hospedam cada um, que é justamente a
  -- lista que a operação passa semanas montando (SC01).
  -- ⚠️ NÃO É SENHA: quem tem o link entra, e convite repassado funciona. Ela só
  -- impede a VARREDURA.
  chave       text not null,
  stylist_id  bigint not null references public.vessel_stylists(id) on delete restrict,
  quando      timestamptz not null,
  local       text,                      -- "Loja do Iguatemi Campinas"
  praca       text,                      -- CPS | SAO | SBO | BSB
  loja        text,                      -- iguatemi | tivoli | parkshopping
  -- Quantas convidadas o formato prevê. O plano diz 5 a 8; fica no dado para a
  -- conta de ocupação, nunca para barrar alguém na porta da página.
  vagas       int,
  ativa       boolean not null default true,
  criado_em   timestamptz not null default now(),
  teste       boolean not null default false
);

-- 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
create table if not exists public.vessel_transferencias (
  id           uuid primary key default gen_random_uuid(),
  peca_codigo  text not null,
  cliente_de   uuid not null references public.vessel_clientes(id),
  -- ⚠️ SÓ O HASH. O código de 6 dígitos não é guardado em lugar nenhum: ele
  -- aparece UMA vez, na resposta da geração, e depois só existe na mão da
  -- dona. Quem tiver o banco na frente não consegue transferir a peça de
  -- ninguém — mesma regra da senha (bcrypt, custo 10).
  codigo_hash  text not null,
  criado_em    timestamptz not null default now(),
  vale_ate     timestamptz not null,
  usado_em     timestamptz,
  cliente_para uuid references public.vessel_clientes(id),
  cancelado_em timestamptz,

  -- O prazo nasce para a frente. Convite que já nasce vencido seria um convite
  -- que nunca funciona, e a tela não teria como explicar por quê.
  constraint vessel_transferencias_prazo_check
    check (vale_ate > criado_em),
  -- Usado e "para quem" são a MESMA informação: um sem o outro é uma linha que
  -- ninguém sabe ler depois — ou uma transferência sem destino, ou um destino
  -- sem transferência.
  constraint vessel_transferencias_uso_check
    check ((usado_em is null) = (cliente_para is null)),
  -- Um convite acaba de UM jeito só. Usado e cancelado ao mesmo tempo seria a
  -- trilha dizendo duas coisas contrárias sobre o mesmo papel.
  constraint vessel_transferencias_fim_unico_check
    check (usado_em is null or cancelado_em is null),
  -- ⚠️ O CÓDIGO DA PEÇA TEM DE ESTAR NORMALIZADO, e isto não é capricho: o
  -- índice único de "um convite aberto por peça" é sobre esta coluna. Um
  -- "tbnwxas28a" e um "TBNWXAS-28A" gravados crus seriam DUAS peças para o
  -- índice e UMA peça para a cliente — dois convites abertos para a mesma
  -- bolsa, que é o que o índice existe para impedir. É a mesma normalização
  -- de todas as irmãs do selo.
  constraint vessel_transferencias_codigo_normalizado_check
    check (peca_codigo = upper(regexp_replace(peca_codigo, '[\s.\-_]', '', 'g'))),
  -- Ninguém transfere para si mesma. A recusa acontece antes, na função
  -- (`sua_ja`); isto é a trava de baixo, para o caso de alguém um dia gravar
  -- nesta tabela por outro caminho.
  constraint vessel_transferencias_nao_para_si_check
    check (cliente_para is null or cliente_para <> cliente_de)
);

-- 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
create table if not exists public.vessel_tentativas_de_transferencia (
  codigo text not null,
  quando timestamptz not null default now()
);

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
create table if not exists public.vessel_stylist_contatos (
  id              bigserial primary key,
  stylist_id      bigint not null references public.vessel_stylists(id) on delete cascade,
  canal           text not null,
  resultado       text not null,
  nota            text,
  criado_em       timestamptz not null default now(),
  criado_por      uuid,
  criado_por_nome text,
  teste           boolean not null default false,
  constraint vessel_stylist_contatos_canal_valido
    check (canal in ('whatsapp', 'ligacao', 'instagram', 'email', 'presencial')),
  constraint vessel_stylist_contatos_resultado_valido
    check (resultado in ('sem_resposta', 'conversou', 'interesse', 'proposta', 'marcou_encontro', 'recusou')),
  constraint vessel_stylist_contatos_nota_curta check (nota is null or length(nota) <= 500)
);

-- 2026-09-24-beauty-session-cadastro-pela-equipe.sql
create table if not exists public.vessel_beauty_session_cadastros (
  id                  bigserial primary key,
  -- ⚠️ SEM `on delete cascade`: apagar a sessão com lead dentro é recusado
  -- por `vessel_beauty_session_apagar` (`tem_leads`), e a chave estrangeira é a
  -- segunda trava caso alguém apague por fora.
  codigo              text not null references public.vessel_beauty_sessions(codigo),
  -- ⚠️ COM cascade: a pessoa que pede para sair da base some daqui junto — é
  -- o que a Política de Privacidade promete.
  pessoa_id           bigint not null references public.vessel_pessoas(id) on delete cascade,
  atendimento_id      bigint references public.vessel_atendimentos(id) on delete set null,
  cadastrado_por      uuid,
  cadastrado_por_nome text,
  criado_em           timestamptz not null default now(),
  constraint vessel_beauty_session_cadastros_uma_vez unique (codigo, pessoa_id)
);

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create table public.vessel_stylist_etapas (
  id                     bigserial primary key,
  nome                   text not null,
  ordem                  int  not null,
  tipo                   text not null default 'funil',
  conta_como_prospectada boolean not null default false,
  -- ⚠️ EXCLUIR NÃO APAGA A LINHA: o histórico de etapas aponta para ela. A
  -- etapa excluída sai da tela e das listas, e o nome volta a ficar livre.
  ativa                  boolean not null default true,
  criado_por             uuid,
  criado_por_nome        text,
  criado_em              timestamptz not null default now(),
  alterado_por           uuid,
  alterado_por_nome      text,
  alterado_em            timestamptz not null default now(),
  excluida_em            timestamptz,
  constraint vessel_stylist_etapas_tipo_valido check (tipo in ('funil', 'saida')),
  constraint vessel_stylist_etapas_nome_curto check (length(btrim(nome)) between 1 and 60),
  constraint vessel_stylist_etapas_marca_no_funil check (not conta_como_prospectada or (tipo = 'funil' and ativa))
);

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
create table public.vessel_stylist_motivos_de_saida (
  id                bigserial primary key,
  etapa_id          bigint not null references public.vessel_stylist_etapas(id),
  nome              text not null,
  ordem             int  not null,
  exige_nota        boolean not null default false,
  -- ⚠️ DESATIVAR, NUNCA APAGAR: o histórico de etapas aponta para a linha.
  ativo             boolean not null default true,
  criado_por        uuid,
  criado_por_nome   text,
  criado_em         timestamptz not null default now(),
  alterado_por      uuid,
  alterado_por_nome text,
  alterado_em       timestamptz not null default now(),
  constraint vessel_stylist_motivos_de_saida_nome_curto check (length(btrim(nome)) between 1 and 80)
);

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create table public.vessel_stylist_etapas_trilha (
  id        bigserial primary key,
  etapa_id  bigint not null references public.vessel_stylist_etapas(id),
  acao      text not null,
  antes     jsonb,
  depois    jsonb,
  por       uuid,
  por_nome  text,
  em        timestamptz not null default now(),
  constraint vessel_stylist_etapas_trilha_acao_valida check (acao in
    ('criar', 'renomear', 'reordenar', 'tipo', 'marcar_prospectada', 'excluir'))
);

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create table public.vessel_stylist_etapas_historico (
  id            bigserial primary key,
  stylist_id    bigint not null references public.vessel_stylists(id),
  de_etapa_id   bigint references public.vessel_stylist_etapas(id),
  para_etapa_id bigint not null references public.vessel_stylist_etapas(id),
  motivo        text not null,
  por           uuid,
  por_nome      text,
  em            timestamptz not null default now(),
  teste         boolean not null default false,
  constraint vessel_stylist_etapas_historico_motivo_valido check (motivo in ('cadastro', 'mudanca', 'etapa_excluida'))
);

-- 2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql
create table if not exists public.vessel_stylist_qualificacoes (
  id                bigserial primary key,
  stylist_id        bigint not null references public.vessel_stylists(id) on delete restrict,
  carteira          smallint not null,
  portfolio         smallint not null,
  mobilizacao       smallint not null,
  acesso            smallint not null,
  confiabilidade    smallint not null,
  nota              smallint generated always as
                      (6 * carteira + 5 * portfolio + 4 * mobilizacao + 3 * acesso + 2 * confiabilidade) stored,
  faixa             text generated always as
                      (public.vessel_faixa_da_nota(6 * carteira + 5 * portfolio + 4 * mobilizacao
                                                   + 3 * acesso + 2 * confiabilidade)) stored,
  observacao        text,
  avaliado_em       timestamptz not null default now(),
  avaliado_por      uuid,
  avaliado_por_nome text,
  teste             boolean not null default false,
  constraint vessel_stylist_qualificacoes_niveis check (
    carteira between 1 and 5 and portfolio between 1 and 5 and mobilizacao between 1 and 5
    and acesso between 1 and 5 and confiabilidade between 1 and 5),
  constraint vessel_stylist_qualificacoes_observacao_curta
    check (observacao is null or length(observacao) <= 280)
);

-- 2026-09-25-vessel-candidaturas-da-vaga.sql
create table if not exists public.vessel_candidaturas (
  id              uuid primary key default gen_random_uuid(),
  criado_em       timestamptz not null default now(),
  vaga            text not null,
  nome            text not null,
  whatsapp        text not null,
  cidade          text not null,
  experiencia     text not null check (experiencia in ('luxo', 'varejo', 'nao')),
  fim_de_semana   boolean not null,
  curriculo       text,
  origem          jsonb not null default '{}'::jsonb,
  ip_hash         text,
  teste           boolean not null default false
);

-- 2026-09-25-vessel-convite-da-convidada-teto-e-abertura-da-equipe.sql
create table if not exists public.vessel_rsvp_tentativas (
  id             bigserial primary key,
  atendimento_id bigint not null references public.vessel_atendimentos(id) on delete cascade,
  ip_hash        text,
  momento        timestamptz not null default now(),
  teste          boolean not null default false
);

-- 2026-09-25-vessel-praca-e-edicao.sql
create table if not exists public.vessel_pracas (
  id           bigserial primary key,
  sigla        text not null unique,
  nome         text not null,
  loja_destino text,                       -- NULA de propósito: pendência do dono
  ordem        integer not null default 0,
  ativa        boolean not null default true,
  criado_em    timestamptz not null default now()
);

-- 2026-09-25-vessel-praca-e-edicao.sql
create table if not exists public.vessel_praca_cidades (
  id           bigserial primary key,
  praca_id     bigint not null references public.vessel_pracas(id) on delete cascade,
  cidade       text not null,
  cidade_chave text not null unique,       -- sem acento, minúscula: a mesma conta do front
  criado_em    timestamptz not null default now()
);

-- 2026-09-25-vessel-praca-e-edicao.sql
create table if not exists public.vessel_stylist_circle_edicoes (
  id         bigserial primary key,
  praca_id   bigint not null references public.vessel_pracas(id),
  numero     integer not null,
  nome       text,
  comeca_em  date not null,
  termina_em date,
  situacao   text not null default 'planejada'
             check (situacao in ('planejada', 'aberta', 'encerrada')),
  criado_em  timestamptz not null default now(),
  unique (praca_id, numero),
  check (termina_em is null or termina_em >= comeca_em)
);

-- 2026-09-25-vessel-praca-e-edicao.sql
create table if not exists public.vessel_stylist_na_edicao (
  id            bigserial primary key,
  stylist_id    bigint not null references public.vessel_stylists(id) on delete cascade,
  edicao_id     bigint not null references public.vessel_stylist_circle_edicoes(id) on delete cascade,
  entrou_em     timestamptz not null default now(),
  saiu_em       timestamptz,
  etapa_ao_sair bigint references public.vessel_stylist_etapas(id),
  unique (stylist_id, edicao_id)
);

-- 2026-09-28-vessel-beauty-session-no-rd-station.sql
create table if not exists public.vessel_rd_envios (
  id            bigint generated always as identity primary key,
  origem_id     bigint not null unique references public.vessel_origens(id) on delete cascade,
  pessoa_id     bigint not null,
  codigo        text,
  status        text not null default 'pendente'
                check (status in ('pendente', 'enviado', 'ok', 'falhou')),
  tentativas    int not null default 0,
  request_id    bigint,
  http_status   int,
  resposta      text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- 2026-09-29-vessel-card-da-stylist.sql
create table if not exists public.vessel_card_consultas (
  id       bigserial primary key,
  ip_hash  text not null,
  momento  timestamptz not null default now()
);

-- 2026-09-29-vessel-card-da-stylist.sql
create table if not exists public.vessel_private_edit_card_leituras (
  id               bigserial primary key,
  private_edit_id  bigint not null references public.vessel_private_edits(id) on delete cascade,
  momento          timestamptz not null default now(),
  ip_hash          text not null
);

-- 2026-09-11-vessel-lista-objetivo-e-loja.sql
alter table public.vessel_lista_espera
  add column if not exists objetivo   text,
  add column if not exists loja       text,
  add column if not exists senha_hash text,
  add column if not exists senha_em   timestamptz;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
alter table public.vessel_atendimentos
  drop constraint if exists vessel_atendimentos_status_valido;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
alter table public.vessel_atendimentos
  add constraint vessel_atendimentos_status_valido check (
    status in ('solicitado', 'confirmado', 'realizado', 'remarcado', 'cancelado', 'no_show'));

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
alter table public.vessel_atendimentos
  drop constraint if exists vessel_atendimentos_loja_valida;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
alter table public.vessel_atendimentos
  add constraint vessel_atendimentos_loja_valida check (
    loja in ('iguatemi', 'tivoli', 'parkshopping'));

-- 2026-09-17-vessel-client-advisor-e-o-vendedor.sql
alter table public.vessel_client_advisors
  add column if not exists bling_vendedor_id  bigint,
  add column if not exists vendedor_ligado_em timestamptz,
  -- Quem olhou a lista e não se achou nela. Sem esta marca, a pergunta
  -- voltaria a cada aparelho novo, para sempre.
  add column if not exists vendedor_dispensado_em timestamptz;

-- 2026-09-17-vessel-fase-de-testes.sql
alter table public.vessel_pessoas
  add column if not exists teste boolean not null default true;

-- 2026-09-17-vessel-fase-de-testes.sql
alter table public.vessel_atendimentos
  add column if not exists teste boolean not null default true;

-- 2026-09-17-vessel-fase-de-testes.sql
alter table public.vessel_convite_aberturas
  add column if not exists teste boolean not null default true;

-- 2026-09-17-vessel-fase-de-testes.sql
alter table public.vessel_client_advisors
  add column if not exists teste boolean not null default true;

-- 2026-09-17-vessel-item-desconto-e-porcentagem.sql
alter table public.vessel_pedido_itens
  rename column desconto to desconto_percentual;

-- 2026-09-17-vessel-item-desconto-e-porcentagem.sql
alter table public.vessel_pedido_itens
  add column if not exists total_do_item numeric(12,2);

-- 2026-09-17-vessel-pedido-receita-liquida.sql
alter table public.vessel_pedidos
  add column if not exists receita_liquida numeric(12,2);

-- 2026-09-17-vessel-pedidos-usa-a-data-da-casa.sql
alter table public.vessel_pedidos
  add column if not exists data_da_venda date,
  add column if not exists origem_da_data text;

-- 2026-09-17-vessel-pedidos.sql
alter table public.vessel_pessoas
  add column if not exists bling_contato_id bigint;

-- 2026-09-17-vessel-pedidos.sql
alter table public.vessel_pedidos
  drop constraint if exists vessel_pedidos_casou_por_valido;

-- 2026-09-17-vessel-pedidos.sql
alter table public.vessel_pedidos
  add constraint vessel_pedidos_casou_por_valido check (
    casou_por is null or casou_por in ('bling_contato', 'telefone'));

-- 2026-09-17-vessel-preferencias-da-visita.sql
alter table public.vessel_lista_espera
  add column if not exists visita_data          date,
  add column if not exists visita_hora          text,
  add column if not exists visita_bolsa         text,
  add column if not exists visita_ocasiao       text,
  add column if not exists visita_atelier       boolean,
  add column if not exists visita_acompanhantes int,
  add column if not exists visita_pedido        text,
  add column if not exists visita_detalhes_em   timestamptz;

-- 2026-09-17-vessel-registro-com-conta.sql
alter table public.vessel_pedidos
  add column if not exists observacoes text,
  add column if not exists observacoes_internas text;

-- 2026-09-18-vessel-beauty-sessions.sql
alter table public.vessel_atendimentos
  add column if not exists interesse text;

-- 2026-09-18-vessel-pedido-de-atendimento.sql
alter table public.vessel_atendimentos
  add column if not exists momento_de_uso    text,
  add column if not exists periodo_preferido text,
  add column if not exists recado            text;

-- 2026-09-18-vessel-personal-atelier.sql
alter table public.vessel_atendimentos
  add column if not exists modelo_de_interesse text,
  add column if not exists atelier_tecido      text,
  add column if not exists atelier_ferragem    text;

-- 2026-09-18-vessel-por-que-nao-respondeu.sql
alter table public.vessel_lista_espera
  add column if not exists objetivo_motivo text;

-- 2026-09-18-vessel-private-edit.sql
alter table public.vessel_atendimentos
  add column if not exists evento_codigo text,
  add column if not exists rsvp          text;

-- 2026-09-18-vessel-stylist-circle.sql
alter table public.vessel_consentimentos
  alter column pessoa_id drop not null,
  add column if not exists stylist_id bigint references public.vessel_stylists(id) on delete cascade;

-- 2026-09-18-vessel-stylist-circle.sql
alter table public.vessel_consentimentos
  drop constraint if exists vessel_consentimentos_de_alguem;

-- 2026-09-18-vessel-stylist-circle.sql
alter table public.vessel_consentimentos
  add constraint vessel_consentimentos_de_alguem check (
    (pessoa_id is not null and stylist_id is null)
    or (pessoa_id is null and stylist_id is not null));

-- 2026-09-19-vessel-arquivar.sql
alter table public.vessel_private_edits
  add column if not exists arquivada boolean not null default false;

-- 2026-09-19-vessel-arquivar.sql
alter table public.vessel_beauty_sessions
  add column if not exists arquivada boolean not null default false;

-- 2026-09-19-vessel-stylist-mexer.sql
alter table public.vessel_stylists
  add column if not exists ativa boolean not null default true;

-- 2026-09-21-pedido-conferido-no-bling.sql
alter table public.vessel_pedidos
  add column if not exists conferido_no_bling_em timestamptz;

-- 2026-09-22-item-preco-de-tabela.sql
alter table public.vessel_pedido_itens
  add column if not exists preco_de_tabela numeric;

-- 2026-09-22-lp-anota-de-qual-anuncio-veio.sql
alter table public.vessel_lista_espera
  add column if not exists utm_source   text,
  add column if not exists utm_medium   text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content  text,
  add column if not exists utm_term     text,
  add column if not exists clique_meta  text;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists alter column estagio set default 'prospectado';

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_estagio_valido;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists add constraint vessel_stylists_estagio_valido
  check (estagio in ('prospectado', 'contatado', 'interessado', 'em_negociacao',
                     'ativado', 'evento_realizado', 'recorrente',
                     'sem_retorno', 'nao_interessado', 'pausado', 'inativo'));

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists
  add column if not exists loja            text,
  -- ⚠️ `inbound` É O PADRÃO porque a porta pública (`vessel_pedido_do_stylist`)
  -- não passa este campo — e quem entra por ela chegou sozinha. Quem é
  -- cadastrada na Central escolhe na tela (a função exige).
  add column if not exists origem_contato  text not null default 'inbound',
  add column if not exists responsavel     text,
  add column if not exists prospectado_em  date not null
    default (now() at time zone 'America/Sao_Paulo')::date,
  add column if not exists proxima_acao    text,
  add column if not exists proxima_acao_em date,
  -- ⚠️ CONGELA NA PRIMEIRA VEZ. "Ativado" é o dia em que o primeiro encontro
  -- foi agendado; cancelar aquele encontro depois não desfaz a ativação — ela
  -- aconteceu, e a taxa de ativação do período em que ela aconteceu não pode
  -- mudar de valor no mês seguinte.
  add column if not exists ativada_em      timestamptz;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_loja_valida;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists add constraint vessel_stylists_loja_valida
  check (loja is null or loja in ('iguatemi', 'tivoli', 'parkshopping'));

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_origem_contato_valida;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_stylists add constraint vessel_stylists_origem_contato_valida
  check (origem_contato in ('indicacao', 'pesquisa', 'evento', 'inbound'));

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits
  add column if not exists status       text not null default 'agendado',
  add column if not exists realizado_em date,
  add column if not exists motivo       text,
  add column if not exists observacoes  text;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits drop constraint if exists vessel_private_edits_status_valido;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits add constraint vessel_private_edits_status_valido
  check (status in ('em_planejamento', 'agendado', 'confirmado', 'realizado',
                    'reagendado', 'cancelado', 'nao_realizado'));

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits drop constraint if exists vessel_private_edits_motivo_quando_cai;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits add constraint vessel_private_edits_motivo_quando_cai
  check (status not in ('cancelado', 'nao_realizado') or nullif(trim(coalesce(motivo, '')), '') is not null);

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits drop constraint if exists vessel_private_edits_realizado_tem_data;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_private_edits add constraint vessel_private_edits_realizado_tem_data
  check (status <> 'realizado' or realizado_em is not null);

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_atendimentos
  add column if not exists convidada_em       timestamptz,
  add column if not exists convite_enviado_em timestamptz;

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
alter table public.vessel_atendimentos
  add column if not exists chave_convite      text,
  add column if not exists convite_aberto_em  timestamptz,
  add column if not exists convite_aberturas  int not null default 0;

-- 2026-09-23-beauty-session-pergunta-o-instagram.sql
alter table public.vessel_pessoas
  add column if not exists instagram text;

-- 2026-09-23-pedido-sabe-de-qual-lead-veio.sql
alter table public.vessel_pedidos
  add column if not exists lead_id bigint
    references public.vessel_lista_espera(id) on delete set null,
  add column if not exists casou_lead_por text;

-- 2026-09-23-pedido-sabe-de-qual-lead-veio.sql
alter table public.vessel_pedidos
  drop constraint if exists vessel_pedidos_casou_lead_por_valido;

-- 2026-09-23-pedido-sabe-de-qual-lead-veio.sql
alter table public.vessel_pedidos
  add constraint vessel_pedidos_casou_lead_por_valido check (
    casou_lead_por is null or casou_lead_por in ('ficha', 'email', 'telefone'));

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
alter table public.vessel_stylist_etapas
  add column libera_private_edit boolean not null default false;

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
alter table public.vessel_stylist_etapas_trilha drop constraint vessel_stylist_etapas_trilha_acao_valida;

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
alter table public.vessel_stylist_etapas_trilha add constraint vessel_stylist_etapas_trilha_acao_valida check (acao in
  ('criar', 'renomear', 'reordenar', 'tipo', 'marcar_prospectada', 'excluir',
   'libera_private_edit',
   'motivo_criar', 'motivo_renomear', 'motivo_reordenar', 'motivo_ativar', 'motivo_exige_nota'));

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
alter table public.vessel_stylist_etapas_historico
  add column motivo_id bigint references public.vessel_stylist_motivos_de_saida(id),
  add column nota text,
  -- ⚠️ A FOTO DA MARCA NA HORA DA CHEGADA: a ativação lê ESTA coluna, e não a
  -- marca de hoje da etapa — desmarcar ou marcar uma etapa amanhã não reescreve
  -- a data de ativação de ninguém (a mesma regra da data da prospecção).
  -- `not null default false` num Postgres 11+ não reescreve linha nenhuma.
  add column liberava_private_edit boolean not null default false,
  add constraint vessel_stylist_etapas_historico_nota_curta check (nota is null or length(nota) <= 500);

-- 2026-09-24-vessel-stylist-etapa-identificada.sql
alter table public.vessel_stylists alter column prospectado_em drop not null;

-- 2026-09-24-vessel-stylist-etapa-identificada.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_estagio_valido;

-- 2026-09-24-vessel-stylist-etapa-identificada.sql
alter table public.vessel_stylists add constraint vessel_stylists_estagio_valido
  check (estagio in ('identificada', 'prospectado', 'contatado', 'interessado', 'em_negociacao',
                     'ativado', 'evento_realizado', 'recorrente',
                     'sem_retorno', 'nao_interessado', 'pausado', 'inativo'));

-- 2026-09-24-vessel-stylist-etapa-identificada.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_identificada_sem_prospeccao;

-- 2026-09-24-vessel-stylist-etapa-identificada.sql
alter table public.vessel_stylists add constraint vessel_stylists_identificada_sem_prospeccao
  check (estagio <> 'identificada' or prospectado_em is null);

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_estagio_valido;

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_identificada_sem_prospeccao;

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
alter table public.vessel_stylists drop column estagio;

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
alter table public.vessel_stylists alter column prospectado_em drop default;

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
alter table public.vessel_stylists
  add column etapa_id bigint not null references public.vessel_stylist_etapas(id);

-- 2026-09-24-vessel-stylist-sem-contato.sql
alter table public.vessel_stylists
  add column if not exists sem_contato boolean not null default false;

-- 2026-09-24-vessel-stylist-sem-contato.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_tem_contato;

-- 2026-09-24-vessel-stylist-sem-contato.sql
alter table public.vessel_stylists add constraint vessel_stylists_tem_contato
  check (whatsapp is not null
         or nullif(btrim(coalesce(instagram, '')), '') is not null
         or sem_contato);

-- 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql
alter table public.vessel_stylists alter column whatsapp drop not null;

-- 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql
alter table public.vessel_stylists
  add column if not exists observacoes text;

-- 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_tem_contato;

-- 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql
alter table public.vessel_stylists add constraint vessel_stylists_tem_contato
  check (whatsapp is not null or nullif(btrim(coalesce(instagram, '')), '') is not null);

-- 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql
alter table public.vessel_stylists drop constraint if exists vessel_stylists_observacoes_curta;

-- 2026-09-24-vessel-stylist-whatsapp-ou-instagram.sql
alter table public.vessel_stylists add constraint vessel_stylists_observacoes_curta
  check (observacoes is null or length(observacoes) <= 2000);

-- 2026-09-25-vessel-candidaturas-na-planilha.sql
alter table public.vessel_candidaturas
  add column if not exists na_planilha_em timestamptz;

-- 2026-09-25-vessel-praca-e-edicao.sql
alter table public.vessel_stylists      add column if not exists praca_id bigint references public.vessel_pracas(id);

-- 2026-09-25-vessel-praca-e-edicao.sql
alter table public.vessel_private_edits add column if not exists praca_id bigint references public.vessel_pracas(id);

-- 2026-09-28-zz-vessel-rd-station-segura-sem-email.sql
alter table public.vessel_rd_envios drop constraint if exists vessel_rd_envios_status_check;

-- 2026-09-28-zz-vessel-rd-station-segura-sem-email.sql
alter table public.vessel_rd_envios add constraint vessel_rd_envios_status_check
  check (status in ('pendente', 'enviado', 'ok', 'falhou', 'sem_email'));

-- 2026-09-28-zzzzzz-vessel-edicao-e-o-evento.sql
alter table public.vessel_stylist_na_edicao
  add column if not exists convidada_em    timestamptz,
  add column if not exists confirmou_em    timestamptz,
  add column if not exists presente_em     timestamptz,
  add column if not exists indisponivel_em timestamptz;

-- 2026-09-28-zzzzzz-vessel-edicao-e-o-evento.sql
alter table public.vessel_stylist_motivos_de_saida
  add column if not exists volta_na_proxima_edicao boolean not null default false;

-- 2026-09-29-vessel-stylist-trocar-motivo.sql
alter table public.vessel_stylist_etapas_historico
  drop constraint vessel_stylist_etapas_historico_motivo_valido;

-- 2026-09-29-vessel-stylist-trocar-motivo.sql
alter table public.vessel_stylist_etapas_historico
  add constraint vessel_stylist_etapas_historico_motivo_valido
  check (motivo = any (array['cadastro'::text, 'mudanca'::text, 'etapa_excluida'::text, 'troca_de_motivo'::text]));

-- 2026-08-28-vessel-lista-de-espera.sql
create unique index if not exists vessel_lista_espera_email_idx
  on public.vessel_lista_espera (lower(email));

-- 2026-08-28-vessel-lista-de-espera.sql
create index if not exists vessel_lista_espera_pendente_bling_idx
  on public.vessel_lista_espera (criado_em) where bling_em is null;

-- 2026-08-28-vessel-lista-de-espera.sql
create index if not exists vessel_lista_espera_pendente_planilha_idx
  on public.vessel_lista_espera (criado_em) where planilha_em is null;

-- 2026-09-11-vessel-lista-objetivo-e-loja.sql
create index if not exists vessel_lista_espera_senha_hash_idx
  on public.vessel_lista_espera (senha_hash)
  where senha_hash is not null;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create unique index if not exists vessel_pessoas_telefone_idx
  on public.vessel_pessoas (telefone);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_pessoas_email_idx
  on public.vessel_pessoas (lower(email)) where email is not null;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_origens_pessoa_idx
  on public.vessel_origens (pessoa_id, momento);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create unique index if not exists vessel_atendimentos_convite_idx
  on public.vessel_atendimentos (convite_codigo) where convite_codigo is not null;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_atendimentos_pessoa_idx
  on public.vessel_atendimentos (pessoa_id, criado_em);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_atendimentos_origem_idx
  on public.vessel_atendimentos (ip_hash, criado_em) where ip_hash is not null;

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_atendimentos_agenda_idx
  on public.vessel_atendimentos (loja, quando) where status in ('solicitado', 'confirmado');

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_convite_aberturas_codigo_idx
  on public.vessel_convite_aberturas (convite_codigo, momento);

-- 2026-09-16-vessel-pessoas-e-atendimentos.sql
create index if not exists vessel_convite_aberturas_praca_idx
  on public.vessel_convite_aberturas (praca, momento);

-- 2026-09-17-vessel-client-advisor-e-o-vendedor.sql
create index if not exists vessel_vendedores_bling_chave_idx
  on public.vessel_vendedores_bling (chave);

-- 2026-09-17-vessel-client-advisor-e-o-vendedor.sql
create unique index if not exists vessel_client_advisors_vendedor_idx
  on public.vessel_client_advisors (bling_vendedor_id)
  where bling_vendedor_id is not null;

-- 2026-09-17-vessel-client-advisors.sql
create unique index if not exists vessel_client_advisors_codigo_idx
  on public.vessel_client_advisors (codigo);

-- 2026-09-17-vessel-client-advisors.sql
create unique index if not exists vessel_client_advisors_chave_idx
  on public.vessel_client_advisors (chave);

-- 2026-09-17-vessel-contas-base.sql
create index if not exists vessel_sessoes_cliente_idx on public.vessel_sessoes (cliente_id);

-- 2026-09-17-vessel-contas-base.sql
create index if not exists vessel_tentativas_login_idx
  on public.vessel_tentativas_de_login (chave, quando desc);

-- 2026-09-17-vessel-fase-de-testes.sql
create index if not exists vessel_pessoas_teste_idx
  on public.vessel_pessoas (teste) where teste;

-- 2026-09-17-vessel-fase-de-testes.sql
create index if not exists vessel_atendimentos_teste_idx
  on public.vessel_atendimentos (teste) where teste;

-- 2026-09-17-vessel-pedido-receita-liquida.sql
create index if not exists vessel_pedidos_receita_idx
  on public.vessel_pedidos (data_da_venda, receita_liquida);

-- 2026-09-17-vessel-pedidos-usa-a-data-da-casa.sql
create index if not exists vessel_pedidos_data_da_venda_idx
  on public.vessel_pedidos (data_da_venda);

-- 2026-09-17-vessel-pedidos.sql
create unique index if not exists vessel_pessoas_bling_idx
  on public.vessel_pessoas (bling_contato_id) where bling_contato_id is not null;

-- 2026-09-17-vessel-pedidos.sql
create unique index if not exists vessel_pedidos_bling_idx
  on public.vessel_pedidos (bling_pedido_id);

-- 2026-09-17-vessel-pedidos.sql
create index if not exists vessel_pedidos_pessoa_idx
  on public.vessel_pedidos (pessoa_id, data_do_pedido);

-- 2026-09-17-vessel-pedidos.sql
create index if not exists vessel_pedidos_contato_idx
  on public.vessel_pedidos (bling_contato_id);

-- 2026-09-17-vessel-pedidos.sql
create index if not exists vessel_pedidos_janela_idx
  on public.vessel_pedidos (data_do_pedido, loja_id);

-- 2026-09-17-vessel-pedidos.sql
create index if not exists vessel_pedidos_orfas_idx
  on public.vessel_pedidos (data_do_pedido) where pessoa_id is null;

-- 2026-09-17-vessel-pedidos.sql
create index if not exists vessel_pedido_itens_pedido_idx
  on public.vessel_pedido_itens (pedido_id);

-- 2026-09-17-vessel-pedidos.sql
create index if not exists vessel_pedido_itens_sku_idx
  on public.vessel_pedido_itens (sku);

-- 2026-09-17-vessel-preferencias-da-visita.sql
create index if not exists vessel_lista_espera_visita_idx
  on public.vessel_lista_espera (visita_data, visita_hora)
  where visita_data is not null;

-- 2026-09-17-vessel-registro-com-conta.sql
create index if not exists vessel_tentativas_presente_idx
  on public.vessel_tentativas_de_presente (codigo, quando desc);

-- 2026-09-17-vessel-um-horario-uma-visita.sql
create index if not exists vessel_atendimentos_hora_idx
  on public.vessel_atendimentos (loja, quando)
  where status in ('solicitado', 'confirmado', 'realizado');

-- 2026-09-18-vessel-contar-as-beauty-sessions.sql
create index if not exists vessel_sessao_aberturas_codigo_idx
  on public.vessel_sessao_aberturas (codigo, momento);

-- 2026-09-18-vessel-pedido-de-atendimento.sql
create index if not exists vessel_consentimentos_pessoa_idx
  on public.vessel_consentimentos (pessoa_id, finalidade, momento desc);

-- 2026-09-18-vessel-private-edit.sql
create unique index if not exists vessel_private_edits_codigo_idx
  on public.vessel_private_edits (codigo);

-- 2026-09-18-vessel-private-edit.sql
create unique index if not exists vessel_private_edits_chave_idx
  on public.vessel_private_edits (chave);

-- 2026-09-18-vessel-private-edit.sql
create index if not exists vessel_private_edits_stylist_idx
  on public.vessel_private_edits (stylist_id, quando desc);

-- 2026-09-18-vessel-private-edit.sql
create index if not exists vessel_atendimentos_evento_idx
  on public.vessel_atendimentos (evento_codigo) where evento_codigo is not null;

-- 2026-09-18-vessel-rastreio-por-stylist.sql
create index if not exists vessel_stylist_aberturas_codigo_idx
  on public.vessel_stylist_aberturas (codigo, momento);

-- 2026-09-18-vessel-stylist-circle.sql
create unique index if not exists vessel_stylists_whatsapp_idx
  on public.vessel_stylists (whatsapp);

-- 2026-09-18-vessel-stylist-circle.sql
create unique index if not exists vessel_stylists_codigo_idx
  on public.vessel_stylists (codigo);

-- 2026-09-18-vessel-stylist-circle.sql
create index if not exists vessel_consentimentos_stylist_idx
  on public.vessel_consentimentos (stylist_id, finalidade) where stylist_id is not null;

-- 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
create unique index if not exists vessel_transferencias_um_aberto_idx
  on public.vessel_transferencias (peca_codigo)
  where usado_em is null and cancelado_em is null;

-- 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
create index if not exists vessel_transferencias_peca_idx
  on public.vessel_transferencias (peca_codigo, criado_em desc);

-- 2026-09-18-zzzzz-vessel-transferencia-de-propriedade.sql
create index if not exists vessel_tentativas_transferencia_idx
  on public.vessel_tentativas_de_transferencia (codigo, quando desc);

-- 2026-09-21-pedido-conferido-no-bling.sql
create index if not exists vessel_pedidos_situacao_idx
  on public.vessel_pedidos (situacao_id);

-- 2026-09-21-pedido-conferido-no-bling.sql
create index if not exists vessel_pedidos_conferido_idx
  on public.vessel_pedidos (conferido_no_bling_em nulls first);

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
create index if not exists vessel_stylist_contatos_stylist_idx
  on public.vessel_stylist_contatos (stylist_id, criado_em desc);

-- 2026-09-22-vessel-t11-bases-do-stylist-circle.sql
create unique index if not exists vessel_atendimentos_chave_convite_idx
  on public.vessel_atendimentos (chave_convite) where chave_convite is not null;

-- 2026-09-23-pedido-sabe-de-qual-lead-veio.sql
create index if not exists vessel_pedidos_lead_idx
  on public.vessel_pedidos (lead_id) where lead_id is not null;

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
create unique index vessel_stylist_motivos_de_saida_nome_idx
  on public.vessel_stylist_motivos_de_saida (etapa_id, lower(btrim(nome))) where ativo;

-- 2026-09-24-vessel-private-edit-so-com-stylist-liberada.sql
create index vessel_stylist_motivos_de_saida_etapa_idx
  on public.vessel_stylist_motivos_de_saida (etapa_id, ordem);

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create unique index vessel_stylist_etapas_nome_idx
  on public.vessel_stylist_etapas (lower(btrim(nome))) where ativa;

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create unique index vessel_stylist_etapas_uma_prospectada_idx
  on public.vessel_stylist_etapas (conta_como_prospectada) where conta_como_prospectada;

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create index vessel_stylists_etapa_idx on public.vessel_stylists (etapa_id);

-- 2026-09-24-vessel-stylist-funil-configuravel.sql
create index vessel_stylist_etapas_historico_stylist_idx
  on public.vessel_stylist_etapas_historico (stylist_id, em);

-- 2026-09-24-vessel-stylist-scorecard-e-qualificacao.sql
create index if not exists vessel_stylist_qualificacoes_stylist_idx
  on public.vessel_stylist_qualificacoes (stylist_id, avaliado_em desc, id desc);

-- 2026-09-25-vessel-candidaturas-da-vaga.sql
create index if not exists vessel_candidaturas_vaga_criado
  on public.vessel_candidaturas (vaga, criado_em desc);

-- 2026-09-25-vessel-candidaturas-da-vaga.sql
create index if not exists vessel_candidaturas_ip_recente
  on public.vessel_candidaturas (ip_hash, criado_em);

-- 2026-09-25-vessel-convite-da-convidada-teto-e-abertura-da-equipe.sql
create index if not exists vessel_rsvp_tentativas_atendimento_idx on public.vessel_rsvp_tentativas (atendimento_id, momento);

-- 2026-09-25-vessel-convite-da-convidada-teto-e-abertura-da-equipe.sql
create index if not exists vessel_rsvp_tentativas_ip_idx on public.vessel_rsvp_tentativas (ip_hash, momento);

-- 2026-09-25-vessel-praca-e-edicao.sql
create index if not exists vessel_praca_cidades_praca_idx on public.vessel_praca_cidades (praca_id);

-- 2026-09-25-vessel-praca-e-edicao.sql
create index if not exists vessel_stylist_na_edicao_edicao_idx on public.vessel_stylist_na_edicao (edicao_id);

-- 2026-09-25-vessel-praca-e-edicao.sql
create index if not exists vessel_stylists_praca_idx on public.vessel_stylists (praca_id);

-- 2026-09-25-vessel-praca-e-edicao.sql
create index if not exists vessel_private_edits_praca_idx on public.vessel_private_edits (praca_id);

-- 2026-09-28-vessel-beauty-session-no-rd-station.sql
create index if not exists vessel_rd_envios_status on public.vessel_rd_envios (status);

-- 2026-09-28-zzzzzz-vessel-edicao-e-o-evento.sql
create index if not exists vessel_stylist_na_edicao_presente_idx
  on public.vessel_stylist_na_edicao (stylist_id, presente_em) where presente_em is not null;

-- 2026-09-29-vessel-card-da-stylist.sql
create index if not exists vessel_card_consultas_ip_momento
  on public.vessel_card_consultas (ip_hash, momento);

-- 2026-09-29-vessel-card-da-stylist.sql
create index if not exists vessel_card_consultas_momento
  on public.vessel_card_consultas (momento);

-- 2026-09-29-vessel-card-da-stylist.sql
create index if not exists vessel_pe_card_leituras_encontro
  on public.vessel_private_edit_card_leituras (private_edit_id, ip_hash, momento);
