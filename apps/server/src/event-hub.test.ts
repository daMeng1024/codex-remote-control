import { EventEmitter } from "node:events";
import WebSocket from "ws";
import { describe, expect, it } from "vitest";
import { EventHub } from "./event-hub.js";

class FakeSocket extends EventEmitter {
  readonly sent: string[] = [];
  readyState = WebSocket.OPEN;

  send(message: string): void {
    this.sent.push(message);
  }
}

function messages(
  socket: FakeSocket,
): Array<{ seq: number; type: string; payload: unknown }> {
  return socket.sent.map(
    (message) =>
      JSON.parse(message) as { seq: number; type: string; payload: unknown },
  );
}

describe("EventHub", () => {
  it("assigns increasing sequence numbers and replays only missing events", () => {
    const hub = new EventHub();
    hub.publish("thread.updated", { value: 1 });
    hub.publish("turn.updated", { value: 2 });
    const socket = new FakeSocket();

    hub.addClient(socket as unknown as WebSocket, 1);
    hub.publish("timeline.updated", { value: 3 });

    expect(messages(socket).map((event) => event.seq)).toEqual([2, 3]);
  });

  it("requests a REST resync when the client sequence came from an older server", () => {
    const hub = new EventHub();
    const socket = new FakeSocket();

    hub.addClient(socket as unknown as WebSocket, 50);

    expect(messages(socket)).toEqual([
      expect.objectContaining({
        seq: 0,
        type: "resync.required",
        payload: { reason: "server-sequence-reset" },
      }),
    ]);
  });

  it("requests a REST resync when the ring buffer no longer contains the gap", () => {
    const hub = new EventHub();
    for (let index = 0; index < 502; index += 1) {
      hub.publish("thread.updated", { index });
    }
    const socket = new FakeSocket();

    hub.addClient(socket as unknown as WebSocket, 1);

    expect(messages(socket)).toEqual([
      expect.objectContaining({
        seq: 502,
        type: "resync.required",
        payload: { reason: "event-history-expired" },
      }),
    ]);
  });

  it("stops broadcasting after a client closes", () => {
    const hub = new EventHub();
    const socket = new FakeSocket();
    hub.addClient(socket as unknown as WebSocket, 0);
    socket.emit("close");

    hub.publish("thread.updated", {});

    expect(socket.sent).toHaveLength(0);
  });
});
