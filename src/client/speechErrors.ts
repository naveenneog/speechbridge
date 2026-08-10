/**
 * Turns Speech SDK cancellations into something a person can act on.
 *
 * Separated from the SDK adapter because this is real logic with a real contract — the
 * words a user reads when the demo breaks — whereas the adapter around it is vendor wiring.
 */
import { CancellationErrorCode } from "microsoft-cognitiveservices-speech-sdk";

export function describeCancellation(code: CancellationErrorCode, details: string): string {
  switch (code) {
    case CancellationErrorCode.AuthenticationFailure:
      return "Azure rejected the Speech credential. Check the Cognitive Services Speech User role assignment on the resource.";
    case CancellationErrorCode.ConnectionFailure:
      return "Lost the connection to Azure Speech. Check the network and try again.";
    case CancellationErrorCode.Forbidden:
      return "Access to the Speech resource was refused. Check the role assignment and the quota.";
    default:
      return details || "Azure Speech stopped unexpectedly.";
  }
}
