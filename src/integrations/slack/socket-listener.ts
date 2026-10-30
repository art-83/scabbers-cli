import { SocketModeClient } from "@slack/socket-mode";
export class SocketListener {
  private readonly client: SocketModeClient;
  constructor(
    token: string,
    wake: () => void,
    onAction: (payload: unknown) => Promise<void>,
    onReaction?: (event: unknown) => Promise<void>,
  ) {
    this.client = new SocketModeClient({ appToken: token });
    this.client.on("error", () => wake());
    this.client.on("message", async ({ ack }) => {
      await ack();
      wake();
    });
    this.client.on("reaction_added", async ({ ack, event }) => {
      await ack();
      try {
        await onReaction?.(event);
      } catch {
        wake();
      }
      wake();
    });
    this.client.on("interactive", async ({ ack, body }) => {
      await ack();
      try {
        await onAction(body);
      } catch {
        wake();
      }
    });
  }
  async start(): Promise<void> {
    await this.client.start();
  }
  async stop(): Promise<void> {
    await this.client.disconnect();
  }
}
