/**
 * `mavlink/microservices/mission` public surface (task T4.1; spec plan/03 §3.4
 * Mission). The {@link MissionClient} implements the frozen `MissionClient`
 * contract over the `MISSION_*` item-transfer protocol for all three
 * `MAV_MISSION_TYPE`s (mission / fence / rally): seq+ack+retry up/download with
 * optional read-back verify, `MISSION_CLEAR_ALL`, `MISSION_SET_CURRENT`, and the
 * `MISSION_CURRENT` / `MISSION_ITEM_REACHED` event taps. Cross-module consumers
 * import from here, never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the contract, state machines, and how to test it.
 */
export { MissionClient, MissionError, createMissionClient } from './mission-client';
export type {
  MissionClientDeps,
  MissionSendFn,
  MissionMessageTap,
  MissionTarget,
  MissionTargetAccessor,
  MissionClock,
  MissionErrorReason,
  MissionUploadOpts,
} from './mission-client';
export { MAV_MISSION_TYPE, MAV_MISSION_ACCEPTED, missionTypeValue } from './constants';
