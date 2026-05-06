// Selection state machine. Tracks the source the user clicked.
//   null   — no selection
//   number — point index (0..23)
//   'bar'  — viewer's bar

let selected = null;
const listeners = new Set();

export function getSelected() { return selected; }

export function setSelected(s) {
  if (s === selected) return;
  selected = s;
  for (const fn of listeners) fn();
}

export function clearSelection() {
  setSelected(null);
}

export function onSelectionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
