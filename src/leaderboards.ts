// Each chapter carries an empty, hidden .board. Once the "Now showing" section
// nears the viewport, one request fetches every listed board, and a chapter
// whose game has entries gets its table and comes into view. A game with no
// entries, an unregistered game or an unreachable service leaves the page as
// it was.

import { fetchBoards, formatValue, type Column, type Entry } from "../api/client/leaderboards";

type Listed = { id: string; name: string; columns: Column[]; entries: Entry[] };

const slots = new Map<string, HTMLElement>();
for (const chapter of document.querySelectorAll<HTMLElement>(".chapter[data-game]")) {
  const board = chapter.querySelector<HTMLElement>(".board");
  if (board && chapter.dataset.game) slots.set(chapter.dataset.game, board);
}

const cell = (tag: "th" | "td", text: string, className: string): HTMLTableCellElement => {
  const el = document.createElement(tag);
  el.textContent = text;
  el.className = className;
  if (tag === "th") el.scope = "col";
  return el;
};

const table = (game: Listed): HTMLTableElement => {
  const t = document.createElement("table");
  t.className = "board-table";

  const caption = document.createElement("caption");
  caption.textContent = "Hall of Fame";
  t.append(caption);

  const head = document.createElement("tr");
  head.append(cell("th", "#", "rank"), cell("th", "Initials", "initials"));
  for (const column of game.columns) head.append(cell("th", column.label, "value"));
  const thead = document.createElement("thead");
  thead.append(head);

  const tbody = document.createElement("tbody");
  for (const entry of game.entries) {
    const row = document.createElement("tr");
    row.append(cell("td", String(entry.rank), "rank"), cell("td", entry.initials, "initials"));
    for (const column of game.columns) {
      row.append(cell("td", formatValue(entry[column.field], column.format), "value"));
    }
    tbody.append(row);
  }

  t.append(thead, tbody);
  return t;
};

const show = (game: Listed): void => {
  const slot = slots.get(game.id);
  if (!slot || game.entries.length === 0) return;
  slot.replaceChildren(table(game));
  slot.hidden = false;
};

const load = async (): Promise<void> => {
  const boards = await fetchBoards(5);
  if (!boards) return;
  for (const game of boards.games) show(game);
};

const section = document.querySelector("#now-showing");
if (slots.size > 0 && section) {
  if ("IntersectionObserver" in window) {
    const watcher = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        watcher.disconnect();
        void load();
      },
      { rootMargin: "600px 0px" },
    );
    watcher.observe(section);
  } else {
    void load();
  }
}
