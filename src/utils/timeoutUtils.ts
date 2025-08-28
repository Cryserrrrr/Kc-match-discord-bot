import { CONFIG, ERROR_MESSAGES } from "./config";
import { logger } from "./logger";

/**
 * Wraps a promise with a timeout
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMessage: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(errorMessage));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]);
}

/**
 * Retries a function with exponential backoff
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = CONFIG.RETRY.MAX_ATTEMPTS,
  delayMs: number = CONFIG.RETRY.DELAY_BETWEEN_ATTEMPTS
): Promise<T> {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (attempt === maxAttempts) {
        logger.error(`Failed after ${maxAttempts} attempts:`, error);
        throw lastError;
      }

      logger.warn(
        `Attempt ${attempt} failed, retrying in ${delayMs}ms:`,
        error
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));

      delayMs *= 2;
    }
  }

  throw lastError!;
}

/**
 * Safely executes a function with timeout and retry
 */
export async function safeExecute<T>(
  fn: () => Promise<T>,
  timeoutMs: number,
  errorMessage: string,
  maxRetries: number = CONFIG.RETRY.MAX_ATTEMPTS
): Promise<T> {
  return withRetry(
    () => withTimeout(fn(), timeoutMs, errorMessage),
    maxRetries,
    CONFIG.RETRY.DELAY_BETWEEN_ATTEMPTS
  );
}

/**
 * Checks if an interaction is still valid
 */
export function isInteractionValid(interaction: any): boolean {
  return (
    interaction &&
    !interaction.isExpired &&
    !interaction.isReplied &&
    !interaction.isDeferred
  );
}

/**
 * Safely sends a response to an interaction
 */
export async function safeInteractionReply(
  interaction: any,
  response: any,
  timeoutMs: number = CONFIG.TIMEOUTS.INTERACTION_REPLY
): Promise<void> {
  if (!isInteractionValid(interaction)) {
    logger.warn("Interaction is no longer valid, skipping reply");
    return;
  }

  try {
    await withTimeout(
      (async () => {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply(response);
        } else {
          await interaction.editReply(response);
        }
      })(),
      timeoutMs,
      ERROR_MESSAGES.TIMEOUT.INTERACTION_REPLY
    );
  } catch (error) {
    logger.error("Error sending interaction reply:", error);
    throw error;
  }
}

/**
 * Safely defers an interaction reply
 */
export async function safeInteractionDefer(
  interaction: any,
  timeoutMs: number = CONFIG.TIMEOUTS.INTERACTION_REPLY
): Promise<void> {
  if (
    !isInteractionValid(interaction) ||
    interaction.deferred ||
    interaction.replied
  ) {
    return;
  }

  try {
    await withTimeout(
      interaction.deferReply({ ephemeral: true }),
      timeoutMs,
      ERROR_MESSAGES.TIMEOUT.INTERACTION_REPLY
    );
  } catch (error) {
    logger.error("Error deferring interaction reply:", error);
    throw error;
  }
}
