package stream

import (
	"context"

	"github.com/redis/go-redis/v9"
)

type Writer struct {
	Rdb    *redis.Client
	Stream string // ex: ggbot:events_primary:srv-a
	MaxLen int64  // ex: 100_000 (approx)
}

func (w *Writer) AppendBatch(ctx context.Context, entries []map[string]any) error {
	if len(entries) == 0 {
		return nil
	}
	pipe := w.Rdb.Pipeline()
	for _, vals := range entries {
		pipe.XAdd(ctx, &redis.XAddArgs{
			Stream: w.Stream,
			MaxLen: w.MaxLen, Approx: true,
			Values: vals,
		})
	}
	_, err := pipe.Exec(ctx)
	return err
}
