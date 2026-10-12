package autz

import "context"

// Contexto do Escopo. Provisório na Task 6 (o resto de escrita.go — ComEscopo, PodeCriar/
// PodeEditar/PodeApagar — é da Task 5, que traz estas mesmas definições): ao mesclar, vale o
// arquivo da Task 5.

type chaveEscopo struct{}

func NoContexto(ctx context.Context, e *Escopo) context.Context {
	return context.WithValue(ctx, chaveEscopo{}, e)
}

// EscopoDo devolve o escopo que ComEscopo pôs no contexto (nil se a rota não passou por ele).
func EscopoDo(ctx context.Context) *Escopo {
	e, _ := ctx.Value(chaveEscopo{}).(*Escopo)
	return e
}
