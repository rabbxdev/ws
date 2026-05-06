/**
 * @rabbx/ws/server - Server types
 */

import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';

export interface ServerOptions {
  /** Path to accept WebSocket connections */
  path?: string;
  /** Verify client before upgrade */
  verifyClient?: (
    info: { origin: string; req: IncomingMessage; secure: boolean },
    callback: (res: boolean, code?: number, message?: string) => void
  ) => void;
  /** CORS config */
  cors?: {
    origin?: string | string[] | boolean;
  };
}

export interface ConnectionEvent extends CustomEvent {
  detail: {
    socket: RabbitSocket;
    req: IncomingMessage | Request;
  };
}

export interface WebSocketServerEventMap {
  connection: ConnectionEvent;
  error: ErrorEvent;
  close: CloseEvent;
}

export declare class RabbitSocket extends EventTarget {
  readonly readyState: 0 | 1 | 2 | 3;
  readonly url: string;

  send(data: string | ArrayBufferLike | ArrayBufferView): void;
  close(code?: number, reason?: string): void;

  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  addEventListener(type: 'close', listener: (event: CloseEvent) => void): void;
  addEventListener(type: 'error', listener: (event: ErrorEvent) => void): void;
  addEventListener(type: string, listener: EventListener): void;
}

export declare class WebSocketServer extends EventTarget {
  readonly clients: Set<RabbitSocket>;

  constructor(opts?: ServerOptions);

  handleUpgrade(req: IncomingMessage, socket: any, head: Buffer): void;
  handleRequest(req: Request): Response | Promise<Response>;
  handleDeno(req: Request): Response;
  attachBun(server: any): void;

  close(callback?: () => void): void;

  addEventListener<K extends keyof WebSocketServerEventMap>(
    type: K,
    listener: (this: WebSocketServer, ev: WebSocketServerEventMap[K]) => any
  ): void;
  addEventListener(type: string, listener: EventListener): void;
}

/**
 * Create WebSocket server instance
 *
 * @param httpServer - Node http.Server, Bun.serve instance, or null for Workers
 * @param opts - Server options
 */
export declare function createServer(
  httpServer: Server | any | null,
  opts?: ServerOptions
): WebSocketServer;

export default createServer;