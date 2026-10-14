# 5.11: as 62 RPCs de atendimentos da Vessel (plano curto, 14/10/2026)

**Especificação:** `docs/superpowers/plans/2026-10-11-api-go-plano-5-dominios.md` (molde dos pacotes 5.1–5.10). **Pacote:** `api/internal/atendimentos` (`FuncoesRPC`, 62 declarações; `web.FuncoesRPC` as junta; `RPCPendentes` fica vazia). **Esquema de teste:** `api/internal/testebanco/esquema/fatia511.mjs` gera `01-tabelas-5-11.sql` (25 tabelas, do DDL das migrations) e `03-funcoes-5-11.sql` (funções e 12 gatilhos VERBATIM do levantamento). **Script de classificação:** `FECHAMENTO-2026-10/ferramentas/classifica-rpcs.mjs`.

## Rulings
1. **Portão = a primeira linha de cada função** (`vessel_pode(ferramenta, nível)`, com "ou" entre ferramentas onde a função tem). Nenhuma das 62 está sem portão; a função segue como segunda barreira (`banco.ComUsuario` põe `auth.uid()`).
2. **Recusa do portão = `403 sem_permissao`** sem a função rodar. Produção devolvia `200 {ok:false, situacao:"sem_permissao"}` (40), `200 {ok:false, erro:"Você não tem a permissão…"}` (3) ou `raise 42501` (16), e 3 devolvem lista vazia (Ruling 3): a tela troca por `e.recusa = "sem_permissao"` (igual ao 5.10).
3. **Três devolvem lista vazia a quem não pode ver** (convidadas do encontro, contatos e qualificações da stylist: "bloco dentro de ficha já aberta"). Responder 403 mudaria o contrato: o portão do Go é só **conta ativa** e a função decide. O teste prova que o portão do Go deixa passar tudo o que a função deixa.
4. **Gravar = `SoSessaoPropria`** (43): "entrar como" recebe 403 sem a função rodar. Escrita = o corpo faz DML ou chama, transitivamente, função que faz (script). As 19 leituras ficam abertas a quem entrou como.
5. **Apertado (migração goose 00009, depois do 5.11):** `vessel_convite_marcar` grava e o comentário dela pede "a mesma trava de `vessel_situacao_do_atendimento`" (editar), mas produção só pedia `ver` do Private Edit. Agora o portão é editar nos dois lados (Go e função). `vessel_chave_da_convidada` fica com `ver`: só sorteia a chave do link do cartão quando ela ainda não existe.
6. Parâmetros, DEFAULTs e retorno saem do levantamento: `returns table` vira lista JSON (`rpc.Conjunto`); o resto é `to_json`.

## Tabela de rotas (`POST /rpc/{nome}`)
| RPC | portão (`vessel_pode`, ferramenta:nível) | tipo | parâmetros (? = tem DEFAULT) |
|---|---|---|---|
| vessel_agenda_das_lojas | private-edit:ver | lê | de, ate, loja? |
| vessel_beauty_session_apagar | beauty-sessions:editar | grava | codigo |
| vessel_beauty_session_arquivar | beauty-sessions:editar | grava | codigo, arquivada? |
| vessel_beauty_session_cadastrar_lead | beauty-sessions:editar | grava | codigo, nome, whatsapp, instagram?, interesse?, email? |
| vessel_beauty_session_criar | beauty-sessions:editar | grava | codigo, quando, praca, loja, parceiro? |
| vessel_beauty_session_editar | beauty-sessions:editar | grava | codigo, quando?, loja? |
| vessel_beauty_session_encerrar | beauty-sessions:editar | grava | codigo, ativa? |
| vessel_chave_da_convidada | private-edit:ver | grava | id |
| vessel_conta_das_beauty_sessions | beauty-sessions:ver ou material-grafico:ver | lê | dias?, incluir_arquivadas? |
| vessel_conta_das_private_edits | private-edit:ver ou material-grafico:ver | lê | dias?, incluir_arquivadas? |
| vessel_convidadas_do_encontro | conta ativa (a função decide; vazio sem permissão) | lê | codigo, dias? |
| vessel_convidar_para_encontro | private-edit:editar | grava | codigo, nome, whatsapp, email? |
| vessel_convite_marcar | atendimentos:editar ou private-edit:editar (migração 00009; produção: private-edit:ver) | grava | id, marca |
| vessel_criar_private_edit | private-edit:editar | grava | stylist, quando, local?, praca?, loja?, vagas?, teste?, confirmar_sobreposicao? |
| vessel_edicao_abrir | edicoes:editar | grava | id |
| vessel_edicao_criar | edicoes:editar | grava | praca_id, nome, comeca_em, termina_em |
| vessel_edicao_encerrar | edicoes:editar | grava | id, levar_para |
| vessel_edicao_incluir_stylist | edicoes:editar ou stylist-circle:editar | grava | codigo, edicao_id |
| vessel_edicao_tirar_stylist | edicoes:editar ou stylist-circle:editar | grava | codigo, edicao_id |
| vessel_edicao_turma | edicoes:ver ou stylist-circle:ver | lê (lista) | edicao_id |
| vessel_edicoes_listar | pracas:ver ou edicoes:ver ou stylist-circle:ver ou private-edit:ver | lê | praca_id |
| vessel_eventos_de_origem | private-edit:ver ou stylist-circle:ver ou edicoes:ver | lê (lista) |  |
| vessel_leads_da_beauty_session | beauty-sessions:ver | lê | codigo, dias? |
| vessel_placar_da_edicao | stylist-circle:ver | lê | edicao_id |
| vessel_praca_cidade_desvincular | pracas:editar | grava | id |
| vessel_praca_cidade_vincular | pracas:editar | grava | praca_id, cidade |
| vessel_praca_criar | pracas:editar | grava | sigla, nome, loja_destino |
| vessel_praca_editar | pracas:editar | grava | id, nome, loja_destino, ativa |
| vessel_pracas_listar | pracas:ver ou edicoes:ver ou stylist-circle:ver ou private-edit:ver | lê |  |
| vessel_private_edit_apagar | private-edit:editar | grava | codigo |
| vessel_private_edit_arquivar | private-edit:editar | grava | codigo, arquivada? |
| vessel_private_edit_editar | private-edit:editar | grava | codigo, quando?, local?, praca?, loja?, vagas?, stylist?, confirmar_sobreposicao? |
| vessel_private_edit_encerrar | private-edit:editar | grava | codigo, ativa? |
| vessel_private_edit_situacao | private-edit:editar | grava | codigo, status, realizado_em?, motivo?, observacoes? |
| vessel_private_edit_sobreposicoes | private-edit:ver | lê | quando, loja, ignorar_codigo?, praca?, local? |
| vessel_qualificacoes_vigentes | stylist-circle:ver | lê |  |
| vessel_rastreio_dos_stylists | stylist-circle:ver ou material-grafico:ver | lê | dias?, incluir_desativadas?, praca_id?, edicao_id? |
| vessel_scorecard_da_stylist | stylist-circle:ver | lê | codigo, de?, ate?, dias? |
| vessel_situacao_do_atendimento | atendimentos (geral):editar ou private-edit:editar | grava | id, situacao |
| vessel_stylist_avaliar | stylist-circle:editar | grava | codigo, carteira, portfolio, mobilizacao, acesso, confiabilidade, observacao? |
| vessel_stylist_contatos | conta ativa (a função decide; vazio sem permissão) | lê | codigo |
| vessel_stylist_criar | stylist-circle:editar | grava | nome, whatsapp, cidade?, instagram?, atuacao?, praca?, loja?, origem_contato?, responsavel?, prospectado_em?, proxima_acao?, proxima_acao_em?, observacoes?, sem_contato? |
| vessel_stylist_desativar | stylist-circle:editar | grava | codigo, ativa? |
| vessel_stylist_editar | stylist-circle:editar | grava | codigo, nome?, whatsapp?, cidade?, instagram?, atuacao?, estagio?, praca?, loja?, origem_contato?, responsavel?, prospectado_em?, proxima_acao?, proxima_acao_em?, sem_proxima_acao?, observacoes?, sem_contato? |
| vessel_stylist_etapas | stylist-circle:ver ou private-edit:ver | lê |  |
| vessel_stylist_historico_de_etapas | stylist-circle:ver | lê | codigo |
| vessel_stylist_mover_de_etapa | stylist-circle:editar | grava | codigo, etapa_id, motivo_id?, nota? |
| vessel_stylist_qualificacoes | conta ativa (a função decide; vazio sem permissão) | lê | codigo |
| vessel_stylist_registrar_contato | stylist-circle:editar | grava | codigo, canal, resultado, nota?, proxima_acao?, proxima_acao_em? |
| vessel_stylist_etapa_criar | stylist-circle:editar | grava | nome, posicao?, tipo? |
| vessel_stylist_etapa_excluir | stylist-circle:editar | grava | id, destino?, motivo_id?, nota? |
| vessel_stylist_etapa_liberar_private_edit | stylist-circle:editar | grava | id, libera |
| vessel_stylist_etapa_marcar_prospectada | stylist-circle:editar | grava | id |
| vessel_stylist_etapa_mover | stylist-circle:editar | grava | id, direcao |
| vessel_stylist_etapa_renomear | stylist-circle:editar | grava | id, nome |
| vessel_stylist_etapa_tipo | stylist-circle:editar | grava | id, tipo |
| vessel_stylist_motivo_ativar | stylist-circle:editar | grava | id, ativo |
| vessel_stylist_motivo_criar | stylist-circle:editar | grava | etapa_id, nome, exige_nota? |
| vessel_stylist_motivo_exigir_nota | stylist-circle:editar | grava | id, exige |
| vessel_stylist_motivo_mover | stylist-circle:editar | grava | id, direcao |
| vessel_stylist_motivo_renomear | stylist-circle:editar | grava | id, nome |
| vessel_stylists_para_escolher | private-edit:ver | lê |  |

## Testes (`api/internal/atendimentos`) e como se provou
| Teste | Prova |
|---|---|
| `TestPortoesIguaisAsFuncoes` | as 62 rodam como 20 pessoas (cada ferramenta ver / ver+editar, super, desativado, admin, sem perfil, permissions-lista, só-editar) em transação desfeita; o portão do Go = a função, pessoa a pessoa; ≥2 permitidas e ≥5 negadas por função. Mutação: `pode(circle, ver)` no lugar de `editar` reprova |
| `TestNenhumaRPCDa5xxNemParametroErrado` | as 62 pelo HTTP como super: nenhuma 5xx (tabela, coluna ou função ausente) nem 400 de parâmetro (declaração errada) |
| `TestEntrarComoNaoGrava` | 43 gravam = 403 e o mundo (19 tabelas) fica igual; 19 leem. Mutação: `SoSessaoPropria` desligado reprova |
| `TestNegadoNaoGravaNemVaza` | quem não pode: 403 e mundo igual; varredura de vazamento (nome, WhatsApp, e-mail, chave) com detector provado no super |
| `TestFunilDaStylist`, `TestPrivateEditEConvites`, `TestBeautyPracasEEdicoes` | fluxos pelo HTTP; regras da função chegam (`tem_leads`, `tem_gente`, `stylist_nao_liberada`, `edicao_encerrada`) |
| `TestCadastroSimultaneoDeStylists` | 8 cadastros ao mesmo tempo: sem 5xx, 8 códigos distintos; convidar duas vezes = `ja_estava` (idempotente) |

## Antes do corte
- As 12 funções de gatilho e o `vessel_pode(text,text)` entram na lista de `api worker conferir` (`conferir.go`: `funcoesDoWorker`, `gatilhosDoWorker`).
- O padrão da coluna `teste` (`vessel_pessoas`, `vessel_atendimentos`) em produção mudou por script (`coletor/limpar-testes-do-cartao.mjs --aprovar`), fora das migrations: o `pg_dump` do ensaio traz o valor certo; o esquema de teste só tem o DDL das migrations.
- O gatilho `vessel_rd_na_fila` (`vessel_origens`) segue vivo no dump de 09/10; a RD está desligada (#350). O Plano 6 tira `vessel-rd-station` do worker; o gatilho só enfileira.
