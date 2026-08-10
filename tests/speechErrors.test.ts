import { describe, it, expect } from "vitest";
import { CancellationErrorCode } from "microsoft-cognitiveservices-speech-sdk";
import { describeCancellation } from "../src/client/speechErrors.js";

describe("describeCancellation", () => {
  it("explains an authentication failure in terms of the fix", () => {
    const message = describeCancellation(CancellationErrorCode.AuthenticationFailure, "");
    expect(message).toMatch(/role/i);
  });

  it("explains a connection failure", () => {
    const message = describeCancellation(CancellationErrorCode.ConnectionFailure, "");
    expect(message).toMatch(/connection|network/i);
  });

  it("explains a forbidden response", () => {
    const message = describeCancellation(CancellationErrorCode.Forbidden, "");
    expect(message).toMatch(/refused|quota|role/i);
  });

  it("passes through the service's own detail when it has one", () => {
    const message = describeCancellation(
      CancellationErrorCode.ServiceError,
      "Something specific from Azure",
    );
    expect(message).toBe("Something specific from Azure");
  });

  it("never returns an empty message, whatever arrives", () => {
    const message = describeCancellation(CancellationErrorCode.RuntimeError, "");
    expect(message.length).toBeGreaterThan(0);
  });

  it("does not surface a bare error code to the user", () => {
    // "errorCode=4" tells a person nothing they can act on.
    const message = describeCancellation(CancellationErrorCode.ConnectionFailure, "");
    expect(message).not.toMatch(/^\d+$/);
  });
});
