/**
 * Lightweight logger for Karya runtime modules.
 * I keep it dependency-free and environment-driven so services can emit consistent operational logs.
 * @packageDocumentation
 */

/**
 * Supported runtime log levels.
 * @public
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger contract used across runtime modules.
 * @public
 */
export interface Logger {
  /** Emits a debug-level message */
  debug: (...args: unknown[]) => void;
  /** Emits an info-level message */
  info: (...args: unknown[]) => void;
  /** Emits a warning-level message */
  warn: (...args: unknown[]) => void;
  /** Emits an error-level message */
  error: (...args: unknown[]) => void;
}

/**
 * Numeric priority used for log level comparison.
 * @internal
 */
const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

/**
 * Creates a scoped logger with environment-driven level filtering.
 *
 * `KARYA_LOG_LEVEL` accepts `debug`, `info`, `warn`, or `error`.
 *
 * @param scope - Short runtime scope label
 * @returns Scoped logger instance
 * @public
 */
export function createLogger(scope: string): Logger {
  const prefix = `[karya:${scope}]`;

  return {
    debug: (...args) => write('debug', prefix, ...args),
    info: (...args) => write('info', prefix, ...args),
    warn: (...args) => write('warn', prefix, ...args),
    error: (...args) => write('error', prefix, ...args),
  };
}

/**
 * Writes a log event when it passes the active level filter.
 *
 * @param level - Log level of the event
 * @param prefix - Scoped prefix
 * @param args - Structured log payload
 * @internal
 */
function write(level: LogLevel, prefix: string, ...args: unknown[]): void {
  if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[getActiveLogLevel()]) {
    return;
  }

  const writer = level === 'error'
    ? console.error
    : level === 'warn'
      ? console.warn
      : console.log;

  writer(prefix, ...args);
}

/**
 * Resolves the active log level from the environment.
 * @internal
 */
function getActiveLogLevel(): LogLevel {
  const candidate = process.env.KARYA_LOG_LEVEL?.toLowerCase();
  if (candidate === 'debug' || candidate === 'info' || candidate === 'warn' || candidate === 'error') {
    return candidate;
  }

  return process.env.DEBUG ? 'debug' : 'info';
}
