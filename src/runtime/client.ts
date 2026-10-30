import { createConnection } from "node:net";
import { join } from "node:path";
import type { RuntimeRequest } from "./types/runtime-request.js";
export function request(
  directory: string,
  payload: RuntimeRequest,
): Promise<any> {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const socket = createConnection(join(directory, "runtime.sock"));
    socket.setTimeout(3000);
    socket.on("connect", () => socket.write(JSON.stringify(payload) + "\n"));
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      if (buffer.length > 4_000_000) {
        socket.destroy();
        reject(new Error("Runtime response limit"));
      }
      if (buffer.includes("\n")) {
        socket.end();
        try {
          const result = JSON.parse(buffer.split("\n")[0]!);
          if (result.error) reject(new Error(result.error));
          else resolve(result);
        } catch (error) {
          reject(error);
        }
      }
    });
    socket.on("error", () => reject(new Error("Local runtime unavailable")));
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("Local runtime timeout"));
    });
  });
}
