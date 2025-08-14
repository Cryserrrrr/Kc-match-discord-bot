import { logger } from "./logger";

export interface RetryConfig {
  maxRetries?: number;
  initialDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
}

const DEFAULT_RETRY_CONFIG: Required<RetryConfig> = {
  maxRetries: 5,
  initialDelay: 2000,
  maxDelay: 60000,
  backoffMultiplier: 2,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig = {}
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: Error;
  let delay = finalConfig.initialDelay;

  for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      logger.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt === finalConfig.maxRetries) {
        logger.error(
          `💥 All ${finalConfig.maxRetries} attempts failed. Final error:`,
          lastError
        );
        throw lastError;
      }

      logger.info(`⏳ Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(
        delay * finalConfig.backoffMultiplier,
        finalConfig.maxDelay
      );
    }
  }

  throw lastError!;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string = "Operation timed out"
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(errorMessage)), timeoutMs)
  );

  return Promise.race([promise, timeoutPromise]);
}

export async function withRetryAndTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  retryConfig: RetryConfig = {},
  timeoutErrorMessage: string = "Operation timed out"
): Promise<T> {
  return withRetry(
    () => withTimeout(fn(), timeoutMs, timeoutErrorMessage),
    retryConfig
  );
}

export function handleInteractionError(error: any, context: string): void {
  if (
    error.code === 10062 ||
    error.message?.includes("Unknown interaction") ||
    error.message?.includes("interaction has already been acknowledged")
  ) {
    logger.warn(`Interaction expired in ${context}, skipping`);
    return;
  }

  logger.error(`Error in ${context}:`, error);
}

export function isRecoverableError(error: any): boolean {
  const nonRecoverableCodes = [
    10062, // Unknown interaction
    10008, // Unknown message
    10013, // Unknown user
    10014, // Unknown channel
    10015, // Unknown guild
  ];

  if (error.code && nonRecoverableCodes.includes(error.code)) {
    return false;
  }

  if (error.message?.includes("Unknown interaction")) {
    return false;
  }

  return true;
}
