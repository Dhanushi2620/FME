/**
 * Raised when the metadata HTTP sidecar returns a non-success response or is unreachable.
 */
export class MetadataExtractionRequestError extends Error {
  readonly statusCode?: number;

  readonly responseBody?: string;

  constructor(message: string, statusCode?: number, responseBody?: string) {
    super(message);
    this.name = "MetadataExtractionRequestError";
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}
