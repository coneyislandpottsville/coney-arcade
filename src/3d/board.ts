import { fetchBoards, formatValue, type Column, type Entry } from "../../api/client/leaderboards";

type Listed = { id: string; name: string; columns: Column[]; entries: Entry[] };

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
  caption.textContent = `${game.name} Hall of Fame`;
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

export async function fillBoard(slot: HTMLElement, game = "maze", limit = 10): Promise<void> {
  const boards = await fetchBoards(limit);
  const listed = boards?.games.find((g) => g.id === game);
  if (!listed || listed.entries.length === 0) return;
  slot.replaceChildren(table(listed));
  slot.hidden = false;
}
