import type { EventEnvelope, EventType } from "@codex-remote/shared";
import WebSocket from "ws";

const MAX_EVENTS = 500;

export class EventHub {
  private sequence = 0;
  private readonly events: EventEnvelope[] = [];
  private readonly clients = new Set<WebSocket>();

  publish<T>(type: EventType, payload: T, threadId?: string): EventEnvelope<T> {
    const event: EventEnvelope<T> = {
      seq: ++this.sequence,
      type,
      emittedAt: Date.now(),
      ...(threadId ? { threadId } : {}),
      payload,
    };
    this.events.push(event as EventEnvelope);
    if (this.events.length > MAX_EVENTS) {
      this.events.shift();
    }
    const serialized = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
    return event;
  }

  addClient(client: WebSocket, since: number): void {
    this.clients.add(client);
    const oldest = this.events[0]?.seq ?? this.sequence;
    if (since > this.sequence) {
      this.sendResync(client, "server-sequence-reset");
    } else if (since > 0 && since < oldest - 1) {
      this.sendResync(client, "event-history-expired");
    } else {
      for (const event of this.events) {
        if (event.seq > since) {
          client.send(JSON.stringify(event));
        }
      }
    }
    client.on("close", () => this.clients.delete(client));
  }

  private sendResync(client: WebSocket, reason: string): void {
    const event: EventEnvelope = {
      seq: this.sequence,
      type: "resync.required",
      emittedAt: Date.now(),
      payload: { reason },
    };
    client.send(JSON.stringify(event));
  }

  currentSequence(): number {
    return this.sequence;
  }
}
