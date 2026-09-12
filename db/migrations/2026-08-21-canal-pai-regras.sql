-- O CANAL PAI E A SUPERVISORA DO GRUPO — PARTE 2 (21/08/2026)
--
-- Continuação de `2026-08-21-canal-pai-e-supervisora-de-grupo.sql` (Parte 1,
-- já aplicada em produção — NÃO EDITAR aquele arquivo). A Parte 1 criou o
-- cadastro (`canais_grupos`, `canais_grupos_membros`, `bling_lojas.grupo_id`)
-- e o vínculo continua sendo digitado igual a todo o resto: cadastro na tela,
-- não evento de engenharia.
--
-- ESTA PARTE faz o vínculo digitado passar a VALER: soma "os times onde eu
-- estou" com "os times das lojas do grupo que eu superviso" num lugar só, e
-- muda as funções de acesso para consultar essa soma em vez de reaprender o
-- grupo cada uma do seu jeito.
--
-- ⚠️ ESTADO DO BANCO NESTE MOMENTO (21/08/2026): `canais_grupos` tem 2 linhas
-- (Varejo, Atacado), `bling_lojas.grupo_id` preenchido em 10 dos 14 canais, e
-- `canais_grupos_membros` está VAZIA — ninguém foi cadastrado como
-- supervisora de grupo ainda. É por essa tabela estar vazia que esta migration
-- NÃO MUDA NADA PARA NINGUÉM ao ser aplicada: `meus_vinculos()` (seção 6) soma
-- `equipes_membros` com uma consulta em `canais_grupos_membros` que hoje não
-- devolve linha nenhuma, então toda função que passa a ler a soma responde
-- exatamente o que respondia antes. `meus_vinculos()` só passa a existir
-- DEPOIS desta migration ser aplicada (Passo 3) — é o Passo 4 do brief desta
-- tarefa, rodado logo em seguida, que mede essa propriedade.

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. A SOMA, NUM LUGAR SÓ
--
-- Até aqui cada regra procurava a pessoa em equipes_membros por conta própria.
-- Se cada uma aprender o grupo do seu jeito, elas discordam — e duas regras
-- discordando sobre permissão é o defeito mais caro que este sistema produz.
--
-- O caminho 2 é o que faz LOJA NOVA ENTRAR SOZINHA: não há lista guardada, a
-- resposta é calculada na hora a partir de quem está no grupo.

create or replace function public.meus_vinculos()
returns table (equipe_id uuid, papel text)
language sql stable security definer set search_path to 'public' as $$
  select m.equipe_id, m.papel
    from public.equipes_membros m
   where m.profile_id = auth.uid()
  union
  select e.id, 'supervisora'
    from public.canais_grupos_membros gm
    join public.bling_lojas bl on bl.grupo_id = gm.grupo_id
    join public.equipes     e  on e.canal_loja_id = bl.loja_id
   where gm.profile_id = auth.uid()
     and gm.papel = 'supervisora';
$$;

-- A ARMADILHA QUE ESTA FUNÇÃO EXISTE PARA EVITAR:
--
-- Quem for gestora da loja Dom Pedro E supervisora do Varejo tem DOIS vínculos
-- com o mesmo time. meu_papel_na_equipe devolve UM papel — se devolver
-- 'supervisora', sou_gestor_da_equipe (que compara com 'gestor') vira false, e a
-- gestora PERDE, calada, o poder de administrar o próprio time. Por ter ganhado
-- um papel a mais.
--
-- Então toda regra de PODER pergunta "tenho este papel?", nunca "qual é o meu".
create or replace function public.tenho_papel_na_equipe(p_equipe uuid, p_papeis text[])
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.meus_vinculos() v
                  where v.equipe_id = p_equipe and v.papel = any(p_papeis));
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. AS REGRAS QUE PASSAM A LER A SOMA

create or replace function public.minhas_equipes()
returns setof uuid language sql stable security definer set search_path to 'public' as $$
  select equipe_id from public.meus_vinculos();
$$;

-- pode_ver_bem e pode_ver_equipe NÃO MUDAM: herdam de minhas_equipes(). Foi
-- conferido antes de escrever que minhas_equipes() é usada por exatamente três
-- funções — pode_ver_bem, pode_ver_canal, pode_ver_equipe — e por NENHUMA
-- política diretamente. As três são justamente as que devem alargar.

-- pode_ver_canal PRECISA DE DOIS CAMINHOS, e este é o ponto mais fácil de errar
-- do desenho inteiro:
--
-- Se o pai valesse só "pelas lojas de baixo", a supervisora do Varejo veria os
-- canais dos times do Varejo e PERDERIA os 6 canais do Varejo que não têm time
-- nenhum (Amazon Seller, Hortolândia, Shopify, Mercado Livre, Tik Tok, Varejo
-- Fábrica). Ela vê esses 6 HOJE, pela regra de 20/08. Seria um retrocesso do que
-- já está no ar, escondido dentro de uma melhoria.
create or replace function public.pode_ver_canal(p_canal bigint)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    -- caminho 3: o canal é de um time meu
    or exists (select 1 from public.equipes e
                where e.canal_loja_id = p_canal
                  and e.id in (select public.minhas_equipes()))
    -- caminho 4: o canal é de um grupo que eu superviso — direto, sem time.
    -- Canal SEM grupo (grupo_id nulo) não amplia nada, e isso não pode virar
    -- "vê tudo" por omissão.
    or exists (select 1
                 from public.canais_grupos_membros gm
                 join public.bling_lojas alvo on alvo.grupo_id = gm.grupo_id
                where gm.profile_id = auth.uid()
                  and gm.papel = 'supervisora'
                  and alvo.loja_id = p_canal);
$$;

-- O ESTOQUE MANTÉM A REGRA PRÓPRIA E MAIS APERTADA, escrita de propósito:
-- "estar no time não basta" — ou você supervisiona, ou é gestora, ou alguém
-- liberou. O que muda é só que "supervisiona" passa a incluir quem supervisiona
-- pelo grupo; o ramo da liberação (`equipes_permissoes`) CONTINUA exigindo
-- estar no time, exatamente como a regra de 04/08.
--
-- É fácil errar aqui: a regra de hoje (2026-08-04-escopo-em-vendas-e-estoque.sql)
-- tem UM join com equipes_membros que governa os dois ramos — o do papel e o
-- da liberação. Se o ramo da liberação virasse só "existe uma linha em
-- equipes_permissoes com chave='estoque'", sem checar equipes_membros, alguém
-- que teve estoque liberado e depois foi tirada do time (a tela apaga
-- equipes_membros, não equipes_permissoes) continuaria vendo aquele depósito
-- PARA SEMPRE, sem estar no time, sem ninguém perceber. Por isso o `exists`
-- de baixo é aninhado dentro de outro `exists` que confere o vínculo.
create or replace function public.pode_ver_estoque(p_deposito bigint)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select
    coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
    or coalesce((select not escopo_por_equipe from public.profiles where id = auth.uid()), false)
    or exists (
      select 1 from public.equipes e
       where e.deposito_id = p_deposito
         and (public.tenho_papel_na_equipe(e.id, array['supervisora','gestor'])
              or exists (select 1 from public.equipes_permissoes p
                          where p.equipe_id = e.id and p.profile_id = auth.uid() and p.chave = 'estoque'
                            and exists (select 1 from public.equipes_membros m
                                         where m.equipe_id = e.id and m.profile_id = auth.uid())))
    );
$$;

-- PODER, não leitura: continua exigindo 'gestor'. A supervisora tem alcance
-- largo de LEITURA e nenhum de PODER — ela não põe nem tira gente.
create or replace function public.sou_gestor_da_equipe(p_equipe uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select coalesce((select is_superadmin from public.profiles where id = auth.uid()), false)
      or public.tenho_papel_na_equipe(p_equipe, array['gestor']);
$$;

-- SÓ PARA FRASE DE TELA, com precedência declarada. NENHUMA decisão de acesso
-- passa mais por aqui — quem decide poder é tenho_papel_na_equipe.
create or replace function public.meu_papel_na_equipe(p_equipe uuid)
returns text language sql stable security definer set search_path to 'public' as $$
  select v.papel from public.meus_vinculos() v
   where v.equipe_id = p_equipe
   order by case v.papel when 'supervisora' then 1 when 'gestor' then 2 else 3 end
   limit 1;
$$;

-- A política de liberar estoque também para de comparar papel único.
drop policy if exists eqperm_escrever on public.equipes_permissoes;
create policy eqperm_escrever on public.equipes_permissoes
  for all to authenticated
  using (public.superadmin_pela_ficha() or public.tenho_papel_na_equipe(equipe_id, array['supervisora','gestor']))
  with check (public.superadmin_pela_ficha() or public.tenho_papel_na_equipe(equipe_id, array['supervisora','gestor']));

comment on function public.meus_vinculos() is
  'A soma dos dois vinculos: equipes_membros direto + canais_grupos_membros (supervisora de grupo) traduzido para as equipes das lojas do grupo. Fonte unica de "onde eu estou e com que papel" para minhas_equipes, pode_ver_canal, pode_ver_estoque, sou_gestor_da_equipe e meu_papel_na_equipe.';

comment on function public.tenho_papel_na_equipe(uuid, text[]) is
  'Pergunta de PODER: "tenho algum destes papeis nesta equipe?". Usar sempre no lugar de comparar meu_papel_na_equipe(...) = X, porque uma pessoa pode ter dois vinculos com o mesmo time (ex.: gestora da loja e supervisora do grupo) e meu_papel_na_equipe devolve so um.';

comment on function public.pode_ver_canal(bigint) is
  'Ve a venda deste canal? Superadmin e quem nao esta sob escopo por equipe veem tudo. Quem esta sob escopo ve os canais dos times onde tem vinculo (minhas_equipes) OU os canais do grupo que supervisiona diretamente (canais_grupos_membros), inclusive canais sem time nenhum. Canal sem grupo nao amplia nada.';
