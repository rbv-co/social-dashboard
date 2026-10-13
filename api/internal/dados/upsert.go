package dados

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/rbv-co/social-dashboard/api/internal/autz"
)

// UpsertVisivel: INSERT … ON CONFLICT DO UPDATE com a semântica que o PostgREST tinha sob a RLS de
// produção (a tela fazia .upsert / resolution=merge-duplicates): (1) a linha nova passa no WITH CHECK de
// criar (PodeCriar) E na regra de LER e de editar sobre ela (EditarNova: num upsert o Postgres confere as
// policies de SELECT na linha proposta — é isso que barrava a conta invisível); (2) a linha que já existe
// só muda se quem pede a lê e a edita (WHERE do DO UPDATE). Fora disso, autz.ErrNegado — igual para
// "existe e é de outra conta" e "não existe e não se veria" (sem oráculo). `linha` é o MESMO mapa que vai
// às conferências e ao INSERT (jsonb_populate_record); tabela, chave e resposta (lista de colunas, sem
// alias) são da rota, nunca do pedido. Rode na tx de banco.ComUsuario de quem pede.
// Promovido de redes.upsertVisivel (5.6, Rulings 5.6-7 e 5.6-16) no 5.7 (Ruling 5.7-6).
func UpsertVisivel(ctx context.Context, tx pgx.Tx, cat *autz.Catalogo, e *autz.Escopo, tab string, chave []string,
	linha map[string]any, resposta string) ([]byte, error) {
	if e == nil {
		return nil, autz.ErrNegado
	}
	if err := cat.PodeCriar(ctx, tx, e, tab, linha); err != nil {
		return nil, err
	}
	fn, err := cat.Filtro(e, tab, autz.EditarNova, "autz_nova")
	if err != nil {
		return nil, err
	}
	if ok, err := autz.Conferir(ctx, tx, fn, tab, linha); err != nil || !ok {
		if err == nil {
			err = autz.ErrNegado
		}
		return nil, err
	}
	fl, err := cat.Filtro(e, tab, autz.Ler, tab)
	if err != nil {
		return nil, err
	}
	fe, err := cat.Filtro(e, tab, autz.Editar, tab)
	if err != nil {
		return nil, err
	}
	var lista, sets, alvo []string
	for _, c := range slices.Sorted(maps.Keys(linha)) {
		id := pgx.Identifier{c}.Sanitize()
		lista = append(lista, id)
		if !slices.Contains(chave, c) {
			sets = append(sets, id+" = excluded."+id)
		}
	}
	if len(sets) == 0 {
		return nil, fmt.Errorf("%w: upsert de %s sem coluna fora da chave", autz.ErrDeclaracao, tab)
	}
	for _, c := range chave {
		alvo = append(alvo, pgx.Identifier{c}.Sanitize())
	}
	j, err := json.Marshal(linha)
	if err != nil {
		return nil, err
	}
	t, l := pgx.Identifier{tab}.Sanitize(), strings.Join(lista, ", ")
	var corpo []byte
	err = tx.QueryRow(ctx, `with n as (insert into `+t+` (`+l+`) select `+l+` from jsonb_populate_record(null::`+t+`, @linha::jsonb)
		on conflict (`+strings.Join(alvo, ", ")+`) do update set `+strings.Join(sets, ", ")+`
		  where (`+fl.SQL+`) and (`+fe.SQL+`)
		returning `+resposta+`) select row_to_json(n) from n`,
		fe.Juntar(fl.Juntar(pgx.NamedArgs{"linha": string(j)}))).Scan(&corpo)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, autz.ErrNegado // a linha existe e quem pede não a lê ou não a edita: fica como estava
	}
	return corpo, err
}
