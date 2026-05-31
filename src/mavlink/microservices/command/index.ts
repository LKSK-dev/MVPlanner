/**
 * `mavlink/microservices/command` public surface (tasks T2.5 + T2.6; spec
 * plan/03 §3.4 Command + Mode/Arm). The {@link CommandClient} implements the
 * frozen `CommandClient` contract: COMMAND_LONG/INT ↔ COMMAND_ACK with
 * retry-until-ack and IN_PROGRESS handling, plus the arm/mode/takeoff/land/rtl/
 * guided/ROI/set-current-WP helpers. Cross-module consumers import from here,
 * never deep paths (conventions plan/implementation/00 §0.3).
 *
 * @see ./README.md for the contract, owned files, and how to test it.
 */
export { CommandClient, CommandError, createCommandClient } from './command-client';
export type {
  CommandClientDeps,
  CommandSendFn,
  CommandMessageTap,
  CommandClock,
  CommandSendOpts,
  CommandResult,
  CommandErrorReason,
  ActiveVehicle,
  ActiveVehicleAccessor,
} from './command-client';
