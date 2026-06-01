/**
 * i18n registration for the parameter grid widget (task T3.4; conventions
 * plan/implementation/00 §0.3, spec plan/05 §5.9).
 *
 * Contributes the grid's `params.*` strings to the English catalog via the
 * public {@link registerMessages} seam (never editing i18n internals). The
 * workbench screen registers its own toolbar/diff `params.*` strings. Keys are
 * disjoint, so the merge never warns. Registration runs once at import and is
 * idempotent.
 */
import { registerMessages } from '../../../core/i18n';

/** English `params.*` strings owned by the grid widget. */
export const PARAM_GRID_MESSAGES: Readonly<Record<string, string>> = {
  'params.grid.label': 'Parameters',
  'params.search': 'Search parameters',
  'params.searchPlaceholder': 'Filter by name or description…',
  'params.view.label': 'View',
  'params.view.flat': 'Flat',
  'params.view.tree': 'Tree',
  'params.col.name': 'Name',
  'params.col.value': 'Value',
  'params.col.units': 'Units',
  'params.col.range': 'Range',
  'params.col.info': 'Info',
  'params.col.sortName': 'Sort by name',
  'params.col.sortValue': 'Sort by value',
  'params.empty': 'No parameters. Fetch the parameter set from the vehicle.',
  'params.noMatches': 'No parameters match the filter.',
  'params.modified': 'Modified',
  'params.modifiedTip': 'Changed from the vehicle value (not yet written)',
  'params.outOfRange': 'Out of range',
  'params.outOfRangeTip': 'Value is outside the allowed range',
  'params.reboot': 'Reboot required',
  'params.rebootTip': 'Changing this parameter requires a vehicle reboot',
  'params.range': '{min} – {max}',
  'params.rangeMin': '≥ {min}',
  'params.rangeMax': '≤ {max}',
  'params.expand': 'Expand group',
  'params.collapse': 'Collapse group',
  'params.expandInfo': 'Show description',
  'params.collapseInfo': 'Hide description',
  'params.group': '{prefix} ({count})',
  'params.showing': 'Showing {shown} of {total}',
  'params.valueFor': 'Value for {name}',
  'params.bitFor': '{name} bit {bit}: {label}',
};

let registered = false;

/** Register the grid's `params.*` English catalog once (idempotent). */
export function registerParamGridMessages(): void {
  if (registered) return;
  registered = true;
  registerMessages(PARAM_GRID_MESSAGES);
}

registerParamGridMessages();
