/**
 * `mavlink/microservices/streams` public surface (T1.11; spec plan/03 §3.3).
 * The {@link StreamRateService} requests the telemetry message intervals the GCS
 * needs from the vehicle. Cross-module consumers import from here, never deep
 * paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the contract, owned files, and how to test it.
 */
export { StreamRateService, createStreamRateService } from './stream-rate-service';
export type { StreamRateServiceOptions, StreamSendFn } from './stream-rate-service';
