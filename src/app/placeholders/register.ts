/**
 * Phase 0 placeholders — replaced by the ui/perf agents.
 *
 * These three scenes exist only so `npm run dev` shows something and the
 * whole flow (menu → session → loading → world → back) is exercised end
 * to end before the real screens land. Each is a few dozen lines and none
 * of them is design.
 */
import { registerScene } from '../registry';
import { emptyWorldPlaceholder } from './EmptyWorldPlaceholder';
import { loadingPlaceholder } from './LoadingPlaceholder';
import { menuPlaceholder } from './MenuPlaceholder';

export function registerPhase0Placeholders(): void {
  registerScene('menu', menuPlaceholder);
  registerScene('loading', loadingPlaceholder);
  registerScene('world:perf-empty', emptyWorldPlaceholder);
}
