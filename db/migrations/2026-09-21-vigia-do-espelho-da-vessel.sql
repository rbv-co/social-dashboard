-- O VIGIA PASSA A OLHAR O ROBÔ DA PLANILHA DA VESSEL.
--
-- O FURO (medido em 21/09/2026): `vessel-espelhar-lista` não estava em
-- `robos_esperados`, então o painel Saúde dos Robôs simplesmente não olhava para
-- ele. Até agora ele espelhava só a lista de espera; desde 21/09 é o ÚNICO
-- escritor da planilha inteira, com as onze abas. O que antes era "um espelho
-- atrasado" passou a ser "a planilha toda parada", sem nada acusar.
--
-- ⚠️ POR QUE SÓ REGISTRAR NÃO BASTAVA, e por isso esta migration anda junto de
-- uma mudança no robô: a função devolve HTTP 200 quando UMA das duas etapas dá
-- certo — de propósito, porque derrubar a rodada inteira porque o Zoho caiu
-- perderia o cadastro no Bling. E `conferir_robos()` calcula
-- `ok = status_code entre 200 e 299`. Ou seja: a rodada em que a planilha NÃO
-- subiu ficava gravada como sucesso. Registrar o robô assim daria um vigia que
-- diz "em dia" para sempre — pior que vigia nenhum, porque ninguém mais olha.
--
-- A SAÍDA (escolhida pelo dono em 21/09): o robô grava uma linha POR ETAPA em
-- `robos_execucoes`, com nome próprio:
--
--     vessel-espelhar-lista            ← a rodada (quem grava é `disparar_robo`)
--     vessel-espelhar-lista · planilha ← a planilha no Zoho
--     vessel-espelhar-lista · bling    ← cadastrar e completar a ficha
--
-- Nada precisa mudar no vigia: ele já junta as variantes por PREFIXO
-- (`e.robo like x.robo || '%'`) e a situação do robô é a da PIOR variante viva.
-- É o mesmo desenho que ele usa desde 19/08 para os perfis do `coletar-dados`.
-- A regra que decide sucesso ou falha mora em
-- `supabase/functions/_shared/vigia-do-espelho.js`, pura e com 14 testes — é a
-- parte que, se inverter, faz o painel mentir sem ninguém notar.
--
-- ⚠️ TRÊS HORAS, E NÃO TRINTA MINUTOS. O robô roda de 3 em 3 minutos, então três
-- horas são 60 rodadas seguidas falhando: é quebra, não soluço. O Zoho recusa
-- login de vez em quando (limite de geração de token) e a rodada seguinte se
-- cura sozinha; alarme que dispara nesses soluços vira alarme ignorado. E há
-- folga de sobra para a promessa da Política de Privacidade, que é de 7 dias.
--
-- ⚠️ `critico = false` de propósito. Robô crítico nesta casa é o que, parado,
-- quebra outra coisa em cascata — o `coletar-dados` renova o token da Meta, que
-- vence em 60 dias. A planilha parada faz o dono ler dado velho, o que é ruim e
-- não é cascata. O alarme aparece do mesmo jeito; só não vai para o topo da
-- lista na frente do que derruba o sistema.

insert into public.robos_esperados (robo, horas_sem_sucesso_ate, critico, porque) values
  ('vessel-espelhar-lista', 3, false,
   'Escreve a planilha "Base de clientes.xlsx" no Zoho (as 11 abas) e cadastra a '
   'pessoa no Bling. Roda de 3 em 3 minutos e também no segundo do cadastro, por '
   'gatilho. Aparece em DUAS variantes, uma por etapa: se só a planilha parar, o '
   'painel nomeia "vessel-espelhar-lista · planilha" e diz que o resto está em dia.')
on conflict (robo) do update
  set horas_sem_sucesso_ate = excluded.horas_sem_sucesso_ate,
      critico = excluded.critico,
      porque = excluded.porque;
