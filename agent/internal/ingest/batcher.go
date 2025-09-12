package ingest

import (
	"context"
	"time"
)

type Batcher struct {
	maxBatch int
	maxWait  time.Duration
}

func NewBatcher(maxBatch int, maxWait time.Duration) *Batcher {
	return &Batcher{maxBatch: maxBatch, maxWait: maxWait}
}

// Run regroupe les entrées (map[string]any) et appelle flush(entries)
// - in: canal d'items prêts pour XADD (fields map)
func (b *Batcher) Run(ctx context.Context, in <-chan map[string]any, flush func([]map[string]any) error) error {
	buf := make([]map[string]any, 0, b.maxBatch)
	timer := time.NewTimer(b.maxWait)
	defer timer.Stop()

	reset := func() {
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(b.maxWait)
	}
	reset()

	for {
		select {
		case <-ctx.Done():
			// flush final
			if len(buf) > 0 {
				_ = flush(buf)
			}
			return ctx.Err()
		case v, ok := <-in:
			if !ok {
				if len(buf) > 0 {
					_ = flush(buf)
				}
				return nil
			}
			buf = append(buf, v)
			if len(buf) >= b.maxBatch {
				if err := flush(buf); err != nil {
					return err
				}
				buf = buf[:0]
				reset()
			}
		case <-timer.C:
			if len(buf) > 0 {
				if err := flush(buf); err != nil {
					return err
				}
				buf = buf[:0]
			}
			reset()
		}
	}
}
