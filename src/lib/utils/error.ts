/**
 * Extracts a user-friendly error message from an unknown error
 * @param error - The error to extract a message from
 * @param defaultMessage - The default message to use if extraction fails
 * @returns A user-friendly error message string
 */
export function getErrorMessage(error: unknown, defaultMessage = "An error occurred"): string {
  if (typeof error === "string") {
    return error;
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return defaultMessage;
}
