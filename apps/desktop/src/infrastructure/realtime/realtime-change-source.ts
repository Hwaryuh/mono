import { realtimeChangeEventSchema, type RealtimeChangeEvent } from "@mono/contracts";

export interface RealtimeChangeListener {
  onChange(change: RealtimeChangeEvent): void;
  onOpen(): void;
  onResync(): void;
}

export interface RealtimeChangeSource {
  connect(listener: RealtimeChangeListener): () => void;
}

export class SseRealtimeChangeSource implements RealtimeChangeSource {
  private constructor(private readonly url: string) {}

  static of(url: string): SseRealtimeChangeSource {
    return new SseRealtimeChangeSource(url);
  }

  connect(listener: RealtimeChangeListener): () => void {
    const source = new EventSource(this.url);
    const onChange = (event: MessageEvent<string>) => {
      let candidate: unknown;
      try {
        candidate = JSON.parse(event.data);
      } catch {
        listener.onResync();
        return;
      }
      const parsed = realtimeChangeEventSchema.safeParse(candidate);
      if (parsed.success) listener.onChange(parsed.data);
      else listener.onResync();
    };
    const onResync = () => listener.onResync();

    source.addEventListener("open", listener.onOpen);
    source.addEventListener("change", onChange as EventListener);
    source.addEventListener("resync", onResync);

    return () => {
      source.removeEventListener("open", listener.onOpen);
      source.removeEventListener("change", onChange as EventListener);
      source.removeEventListener("resync", onResync);
      source.close();
    };
  }
}
