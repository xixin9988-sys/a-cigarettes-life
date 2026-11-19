import type { ILogger } from './contracts';
import type { JsonValue } from './SharedTypes';

const LEVEL_ORDER: Record<'debug' | 'info' | 'warn' | 'error', number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export interface ConsoleLoggerOptions {
  minLevel?: 'debug' | 'info' | 'warn' | 'error';
  prefix?: string;
}

export class ConsoleLogger implements ILogger {
  private readonly minLevel: number;
  private readonly prefix: string;

  constructor(options: ConsoleLoggerOptions = {}) {
    this.minLevel = LEVEL_ORDER[options.minLevel ?? 'info'];
    this.prefix = options.prefix ?? '[game]';
  }

  private enabled(level: 'debug' | 'info' | 'warn' | 'error'): boolean {
    return LEVEL_ORDER[level] >= this.minLevel;
  }

  debug(message: string, data?: JsonValue): void {
    if (this.enabled('debug')) console.debug(this.prefix, message, data ?? '');
  }

  info(message: string, data?: JsonValue): void {
    if (this.enabled('info')) console.info(this.prefix, message, data ?? '');
  }

  warn(message: string, data?: JsonValue): void {
    if (this.enabled('warn')) console.warn(this.prefix, message, data ?? '');
  }

  error(message: string, error?: unknown): void {
    if (this.enabled('error')) console.error(this.prefix, message, error ?? '');
  }
}

/** Collects logs in memory (used by tests and the probability debug panel). */
export class MemoryLogger implements ILogger {
  readonly entries: { level: string; message: string; data?: JsonValue }[] = [];

  debug(message: string, data?: JsonValue): void {
    this.entries.push(data === undefined ? { level: 'debug', message } : { level: 'debug', message, data });
  }

  info(message: string, data?: JsonValue): void {
    this.entries.push(data === undefined ? { level: 'info', message } : { level: 'info', message, data });
  }

  warn(message: string, data?: JsonValue): void {
    this.entries.push(data === undefined ? { level: 'warn', message } : { level: 'warn', message, data });
  }

  error(message: string, error?: unknown): void {
    this.entries.push({ level: 'error', message, data: typeof error === 'string' ? error : String(error) });
  }
}
