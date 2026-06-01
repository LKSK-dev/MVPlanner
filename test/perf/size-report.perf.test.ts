/** Single-file size report and bundled-dialect redundancy note for T8.10. */
import { describe, expect, it } from 'vitest';
import artifactHtml from '../../dist/MVPlanner.html?raw';
import ardupilotmegaJson from '../../src/mavlink/dialects/generated/ardupilotmega.json';
import commonJson from '../../src/mavlink/dialects/generated/common.json';
import { formatMiB, reportPerfLine } from './helpers';

const TARGET_BYTES = 5 * 1024 * 1024;
const HARD_LIMIT_BYTES = 8 * 1024 * 1024;

interface GeneratedMessage {
  readonly name: string;
}

interface GeneratedDialect {
  readonly messages: Readonly<Record<string, GeneratedMessage>>;
}

describe('perf: single-file size report', () => {
  it('reports artifact size and records the known common/ardupilotmega redundancy', () => {
    const artifactBytes = new TextEncoder().encode(artifactHtml).byteLength;
    const commonBytes = jsonBytes(commonJson);
    const ardupilotmegaBytes = jsonBytes(ardupilotmegaJson);
    const common = commonJson as GeneratedDialect;
    const ardupilotmega = ardupilotmegaJson as GeneratedDialect;
    const commonMessageCount = Object.keys(common.messages).length;
    const ardupilotmegaMessageCount = Object.keys(ardupilotmega.messages).length;
    const commonIsMessageSubset = Object.entries(common.messages).every(([id, message]) => {
      const candidate = ardupilotmega.messages[id];
      return candidate?.name === message.name;
    });

    reportPerfLine(
      [
        'T8.10 size report:',
        `dist/MVPlanner.html=${formatMiB(artifactBytes)} (target≤${formatMiB(TARGET_BYTES)}, hard≤${formatMiB(HARD_LIMIT_BYTES)})`,
        `dialect JSON raw: common=${formatMiB(commonBytes)}, ardupilotmega=${formatMiB(ardupilotmegaBytes)}`,
        `messages: common=${commonMessageCount}, ardupilotmega=${ardupilotmegaMessageCount}, common subset=${String(commonIsMessageSubset)}`,
        `tracked optimization: common.json is bundled redundantly beside ardupilotmega.json (~${formatMiB(commonBytes)} raw); microservice constants currently import commonDialect, so repointing to ardupilotmega-only would save it. No dialect refactor in T8.10 because size is within budget.`,
      ].join(' | '),
    );

    expect(artifactBytes).toBeLessThanOrEqual(HARD_LIMIT_BYTES);
    expect(commonIsMessageSubset).toBe(true);
  });
});

function jsonBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}
