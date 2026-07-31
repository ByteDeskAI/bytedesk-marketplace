/**
 * Epics as rows.
 *
 * The board was five status columns and one epic lozenge in the header, and that
 * lozenge was computed as "the first epic that isn't done" — not the active epic the
 * store actually records in state.json, which the board payload has always carried and
 * the UI simply ignored. With one epic those coincide. With two they do not, and the
 * header and the burndown chart both point at the wrong one.
 *
 * Pure functions, so the ordering rules are testable without rendering anything.
 */

/** The lane a task with no epic belongs to. Not a real id — never sent to the store. */
export const NO_EPIC = "__none__";

/**
 * Lane order: the active epic first, because it is the one you are working in; then
 * open epics by id; then closed ones; then unfiled work last.
 *
 * Closed epics sink rather than disappear — a finished epic still holds the history of
 * how the current one got here, and hiding it would make the board disagree with `tm
 * epic`. Unfiled work goes last but is never dropped: a task with no epic is the exact
 * thing you want to notice.
 */
export function laneOrder(epics, tasks, activeEpic) {
  const used = new Set(tasks.map((t) => t.epic).filter(Boolean));
  const known = new Set(epics.map((e) => e.id));
  const lanes = epics
    .filter((e) => used.has(e.id) || e.id === activeEpic)
    .map((e) => ({
      id: e.id,
      title: e.title,
      status: e.status,
      active: e.id === activeEpic,
    }))
    .sort((a, b) => {
      if (a.active !== b.active) return a.active ? -1 : 1;
      const closed = (x) => (x.status === "done" ? 1 : 0);
      return closed(a) - closed(b) || a.id.localeCompare(b.id);
    });

  // An epic id on a task with no matching epic file: `tm doctor` calls this
  // orphan-epic. Until someone fixes it, the work still has to be visible.
  const orphans = [...used].filter((id) => !known.has(id)).sort();
  for (const id of orphans) lanes.push({ id, title: "(no such epic)", status: "missing", active: false });

  if (tasks.some((t) => !t.epic)) lanes.push({ id: NO_EPIC, title: "No epic", status: null, active: false });
  return lanes;
}

export const laneTasks = (tasks, laneId) =>
  laneId === NO_EPIC ? tasks.filter((t) => !t.epic) : tasks.filter((t) => t.epic === laneId);

/** done / total for a lane, plus the fraction the progress bar draws. */
export function laneProgress(tasks) {
  const total = tasks.length;
  const done = tasks.filter((t) => t.status === "done").length;
  return { done, total, fraction: total ? done / total : 0 };
}

/**
 * Sort tasks so that walking a status column top-to-bottom crosses lanes in lane
 * order. The keyboard cursor reads the same five columns whether or not the board is
 * grouped, so getting this ordering right is what keeps `j` moving down the screen
 * rather than jumping between lanes.
 */
export function sortForLanes(tasks, lanes) {
  const rank = new Map(lanes.map((l, i) => [l.id, i]));
  const laneIndexOf = (t) => rank.get(t.epic ?? NO_EPIC) ?? rank.size;
  return [...tasks].sort(
    (a, b) =>
      laneIndexOf(a) - laneIndexOf(b) ||
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      a.id.localeCompare(b.id),
  );
}
