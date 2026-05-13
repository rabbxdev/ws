// index.d.ts
export interface WebSocketServerOptions {
  path?: string;
  verifyClient?: (
    info: { origin: string; req: any; secure: boolean },
    cb: (ok: boolean, code?: number, message?: string) => void
  ) => void;
  maxPayload?: number; // default 64 * 1024
  maxHeaderSize?: number; // default 8 * 1024
  backpressureLimit?: number; // default 1 * 1024 * 1024, Node only
}

export interface MessageEvent extends Event {
  readonly data: string | Buffer | ArrayBuffer;
}

export interface CloseEvent extends Event {
  readonly code: number;
  readonly reason: string;
  readonly wasClean: boolean;
}

export interface ErrorEvent extends Event {
  readonly error: any;
  readonly message: string;
}

export type WebSocketEventMap = {
  open: Event;
  message: MessageEvent;
  close: CloseEvent;
  error: ErrorEvent;
};

export class RabbitSocket extends EventTarget {
  readonly readyState: 0 | 1 | 2 | 3;
  readonly url: string;
  readonly bufferedAmount: number;

  constructor(
    ws: any,
    req: any,
    server: RabbitWSServer,
    runtime: 'node' | 'bun' | 'deno' | 'worker',
    maxPayload?: number,
    backpressureLimit?: number
  );

  send(data: string | Buffer | ArrayBuffer | Uint8Array): void;
  close(code?: number, reason?: string): void;

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (ev: WebSocketEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (ev: WebSocketEventMap[K]) => void,
    options?: boolean | EventListenerOptions
  ): void;

  // Internal methods, not for public use
  _onMessage(data: any): void;
  _onClose(code?: number, reason?: string): void;
  _onError(error: any): void;
  _parseFrame(buf: Buffer): Buffer;
}

export type ServerEventMap = {
  connection: CustomEvent<{ socket: RabbitSocket; req: any }>;
};

export class RabbitWSServer extends EventTarget {
  constructor(opts?: WebSocketServerOptions);

  get clients(): Set<RabbitSocket>;

  // Bun
  bunConfig(): {
    config: {
      websocket: {
        maxPayloadLength: number;
        open(ws: any): void;
        message(ws: any, msg: any): void;
        close(ws: any, code: number, reason: string): void;
      };
      fetch(req: Request, serverInstance: any): Response | undefined;
    };
    server: RabbitWSServer;
  } | null;

  // Deno
  handleDeno(req: Request): Response;

  // Cloudflare Workers
  handleRequest(req: Request): Promise<Response>;

  // Node
  handleNodeUpgrade(req: any, socket: any, head: Buffer): void;

  close(cb?: () => void): void;

  addEventListener<K extends keyof ServerEventMap>(
    type: K,
    listener: (ev: ServerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof ServerEventMap>(
    type: K,
    listener: (ev: ServerEventMap[K]) => void,
    options?: boolean | EventListenerOptions
  ): void;
}

export type WebSocketServer = RabbitWSServer;

export function createServer(
  httpServer?: any,
  opts?: WebSocketServerOptions
): RabbitWSServer;

export function createBunServer(
  opts?: WebSocketServerOptions
): {
  config: any;
  server: RabbitWSServer;
};

export default createServer;