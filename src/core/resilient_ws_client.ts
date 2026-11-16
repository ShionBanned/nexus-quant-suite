/**
 * NEXUS QUANT SUITE v2.0 - RESILIENT WEBSOCKET TRANSPORT CLIENT
 * 
 * Capa de Transporte Blindada contra Desconexiones Silenciosas (TCP Half-Open):
 * 1. Ping/Pong Heartbeat activo cada 5,000 ms.
 * 2. Inactivity Watchdog pasivo a 15,000 ms (fuerza terminación si hay silencio de red).
 * 3. Reconexión con Backoff Exponencial y Jitter aleatorio.
 * 4. Notificación reactiva a RiskGuardian para conmutar a DEFAULT_DENY / PAUSE ante degradación.
 */

import { WebSocket } from 'ws';

export interface ResilientWsOptions {
  url: string;
  pingIntervalMs?: number;
  inactivityTimeoutMs?: number;
  maxBackoffMs?: number;
}

export type HealthChangeHandler = (isHealthy: boolean) => void;
export type MessageHandler = (data: string) => void;

export class ResilientWebSocketClient {
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isAlive: boolean = false;
  private reconnectAttempts: number = 0;
  private isExplicitlyClosed: boolean = false;

  private onMessageCallback: MessageHandler | null = null;
  private onHealthCallback: HealthChangeHandler | null = null;

  constructor(private options: ResilientWsOptions) {}

  public onMessage(cb: MessageHandler): void {
    this.onMessageCallback = cb;
  }

  public onHealthChange(cb: HealthChangeHandler): void {
    this.onHealthCallback = cb;
  }

  public connect(): void {
    this.isExplicitlyClosed = false;
    this.cleanupTimers();

    try {
      this.ws = new WebSocket(this.options.url);

      this.ws.on('open', () => {
        this.isAlive = true;
        this.reconnectAttempts = 0;
        this.notifyHealth(true);
        this.startHeartbeat();
        this.resetWatchdog();
      });

      this.ws.on('message', (raw) => {
        this.isAlive = true;
        this.resetWatchdog();
        if (this.onMessageCallback) {
          try {
            this.onMessageCallback(raw.toString());
          } catch (err) {
            console.error('[ResilientWS] Error en procesamiento de mensaje:', err);
          }
        }
      });

      this.ws.on('pong', () => {
        this.isAlive = true;
        this.resetWatchdog();
      });

      this.ws.on('error', (err) => {
        console.warn(`[ResilientWS] Error de socket (${this.options.url}):`, err.message);
        this.handleDisconnect();
      });

      this.ws.on('close', () => {
        this.handleDisconnect();
      });
    } catch (err) {
      console.error('[ResilientWS] Fallo al iniciar conexión WebSocket:', err);
      this.handleDisconnect();
    }
  }

  private startHeartbeat(): void {
    const interval = this.options.pingIntervalMs || 5000;
    this.pingTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

      if (!this.isAlive) {
        console.warn(`[ResilientWS] Heartbeat fallido (sin pong en ${interval}ms). Forzando cierre del socket.`);
        this.ws.terminate();
        return;
      }

      this.isAlive = false;
      this.ws.ping();
    }, interval);
    if (this.pingTimer.unref) this.pingTimer.unref();
  }

  private resetWatchdog(): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    const timeout = this.options.inactivityTimeoutMs || 15000;

    this.watchdogTimer = setTimeout(() => {
      console.warn(`[ResilientWS] Watchdog de inactividad disparado (> ${timeout}ms sin datos). Terminando conexión.`);
      if (this.ws) {
        this.ws.terminate();
      }
    }, timeout);
    if (this.watchdogTimer.unref) this.watchdogTimer.unref();
  }

  private handleDisconnect(): void {
    if (this.isExplicitlyClosed) return;

    this.notifyHealth(false);
    this.cleanupTimers();

    const maxBackoff = this.options.maxBackoffMs || 30000;
    const baseBackoff = Math.min(maxBackoff, 1000 * Math.pow(2, this.reconnectAttempts));
    const jitter = Math.floor(Math.random() * 500);
    const backoffMs = baseBackoff + jitter;

    this.reconnectAttempts++;
    console.log(`[ResilientWS] Reconectando en ${backoffMs}ms (Intento #${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, backoffMs);
    if (this.reconnectTimer.unref) this.reconnectTimer.unref();
  }

  private notifyHealth(healthy: boolean): void {
    if (this.onHealthCallback) {
      try {
        this.onHealthCallback(healthy);
      } catch (e) {
        console.error('[ResilientWS] Error en callback de salud:', e);
      }
    }
  }

  private cleanupTimers(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  public close(): void {
    this.isExplicitlyClosed = true;
    this.cleanupTimers();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.notifyHealth(false);
  }
}
