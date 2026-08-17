import type { EventEnvelope } from "@codex-remote/shared";

export interface EventStream {
  close: () => void;
}

export function openEventStream(
  onEvent: (event: EventEnvelope) => void,
  onStatus: (connected: boolean) => void,
): EventStream {
  let closed = false;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | null = null;
  let retry = 0;
  let lastSequence = Number(sessionStorage.getItem("event-sequence") ?? 0);

  const connect = () => {
    if (closed) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(
      `${protocol}//${window.location.host}/api/events?since=${lastSequence}`,
    );
    socket.addEventListener("open", () => {
      retry = 0;
      onStatus(true);
    });
    socket.addEventListener("message", (message) => {
      const event = JSON.parse(String(message.data)) as EventEnvelope;
      if (event.type === "resync.required") {
        lastSequence = event.seq;
      } else {
        if (event.seq <= lastSequence) return;
        lastSequence = event.seq;
      }
      sessionStorage.setItem("event-sequence", String(lastSequence));
      onEvent(event);
    });
    socket.addEventListener("close", () => {
      onStatus(false);
      if (!closed) {
        const delay = Math.min(10_000, 500 * 2 ** retry++);
        reconnectTimer = window.setTimeout(connect, delay);
      }
    });
  };

  connect();
  return {
    close: () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      socket?.close();
    },
  };
}
