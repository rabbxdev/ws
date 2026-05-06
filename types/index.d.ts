/**
 * @rabbx/ws - Client types
 */

export interface WebSocketEventMap {
  open: Event;
  message: MessageEvent;
  close: CloseEvent;
  error: ErrorEvent;
}

export declare class WebSocket extends EventTarget {
  static readonly CONNECTING: 0;
  static readonly OPEN: 1;
  static readonly CLOSING: 2;
  static readonly CLOSED: 3;

  readonly url: string;
  readonly readyState: 0 | 1 | 2 | 3;
  readonly bufferedAmount: number;
  readonly extensions: string;
  readonly protocol: string;
  binaryType: 'blob' | 'arraybuffer';

  constructor(url: string | URL, protocols?: string | string[]);

  send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;

  addEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;

  removeEventListener<K extends keyof WebSocketEventMap>(
    type: K,
    listener: (this: WebSocket, ev: WebSocketEventMap[K]) => any,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export default WebSocket;