/**
 * Table module (port of Texy\Modules\TableModule).
 */

import { Modifier } from "../Modifier.js";
import { ContentNode, TableCellNode, TableNode, TableRowNode, TextNode } from "../nodes.js";
import { OffsetMap } from "../Parsing/OffsetMap.js";
import { ModifierHVAlign } from "../Patterns.js";
import { match, matchAll } from "../Regexp.js";
import { Syntax } from "../Syntax.js";
import { Module } from "./Module.js";

/**
 * Removes the backslashes before pipes: \\| -> |, returning the offset map
 * of the unescaped positions (null when there is nothing to unescape).
 * @param {string} text
 * @param {number} offset
 * @returns {[string, ?OffsetMap]}
 */
function unescapePipes(text, offset = 0) {
  const parts = text.split("\\|");
  const last = parts.pop();
  if (parts.length === 0) return [text, null];
  const map = { 0: offset };
  let local = 0;
  for (const part of parts) {
    local += part.length;
    offset += part.length + 1;
    map[local] = offset; // the | written behind a backslash
    local++;
    offset++;
  }
  return [parts.join("|") + "|" + last, new OffsetMap(map)];
}

export class TableModule extends Module {
  constructor(texy) {
    super();
    this.texy = texy;
    this.disableTables = false;
  }

  beforeParse() {
    this.texy.addBlockSyntax(
      Syntax.Table,
      String.raw`~^
				(?:` +
        ModifierHVAlign +
        String.raw`\n)? # modifier (1)
				\|                                   # table start
				.*                                   # content
			$~mUx`,
      (context, matches, offsets) => this.parseTable(context, matches, offsets),
    );
  }

  /**
   * Parses tables.
   */
  parseTable(context, matches, offsets) {
    if (this.disableTables) return null;

    const [, mMod] = matches;

    const startOffset = offsets[0];

    context.getBlockParser().moveBackward();

    const caption = this.parseCaption(context);

    const rows = [];
    let isHead = false;
    /** @type {Object<number, {node: TableCellNode, text: string}>} */
    let prevRow = {};
    const colModifier = {};
    let colCounter = 0;
    /** @type {Map<TableCellNode, Array<{content: string, offset: number}>>} */
    const cellTexts = new Map();

    let end = startOffset + matches[0].length;

    for (;;) {
      let lineMatches;

      const separator = context.getBlockParser().next(String.raw`~^ \| ([=-]) [+|=-]{2,} $~Umx`);
      if (separator !== null) {
        isHead = !isHead;
        prevRow = {};
        end = separator.offsets[0] + separator.length;
        continue;
      }

      lineMatches = context
        .getBlockParser()
        .next(String.raw`~^ \| (.*) (?: | \| [ \t]* ` + ModifierHVAlign + String.raw`?)$~Ux`);
      if (lineMatches !== null) {
        // smarter head detection: if the first row is followed by a separator line, it is a head row
        if (
          rows.length === 0 &&
          !isHead &&
          context.getBlockParser().next(String.raw`~^ \| [=-] [+|=-]{2,} $~Umx`) !== null
        ) {
          isHead = true;
          context.getBlockParser().moveBackward();
        }

        const mContent = lineMatches.matches[1];
        const mRowMod = lineMatches.matches[2];
        const lineBaseOffset = lineMatches.offsets[1]; // content after first |

        const cells = [];
        let col = 0;
        let lastCell = null;

        // a | divides cells unless it is escaped or stands inside [brackets]
        const cellPieces = [];
        let pos = 0;
        for (const dm of matchAll(mContent, String.raw`~\\\||\[[^\]]*+\]|\|~x`)) {
          if (dm.matches[0] === "|") {
            cellPieces.push([mContent.slice(pos, dm.index), pos]);
            pos = dm.index + 1;
          }
        }
        cellPieces.push([mContent.slice(pos), pos]);

        let m;
        for (const [cell, cellOffset] of cellPieces) {
          const cellAbsoluteOffset = lineBaseOffset + cellOffset;

          // rowSpan: ^ at end of cell or cell is just ^
          if (
            prevRow[col] !== undefined &&
            (m = match(cell, String.raw`~\^[ \t]*$|\*??(.*)[ \t]+\^$~AU`)) !== null
          ) {
            prevRow[col].node.rowspan++;
            const cellText = m.matches[1] ?? "";
            const cellTextOffset =
              m.offsets[1] !== null && m.offsets[1] >= 0 ? cellAbsoluteOffset + m.offsets[1] : cellAbsoluteOffset;
            // Append text to the cell above
            const lines = cellTexts.get(prevRow[col].node);
            lines.push({ content: String(cellText), offset: cellTextOffset });
            cellTexts.set(prevRow[col].node, lines);
            col += prevRow[col].node.colspan;
            lastCell = null;
            continue;
          }

          // colSpan: empty cell extends previous cell
          if (cell === "" && lastCell !== null) {
            lastCell.colspan++;
            delete prevRow[col];
            col++;
            continue;
          }

          // common cell
          const cellMatches = match(
            cell,
            String.raw`~
						( \*?? )                          # head mark (1)
						[ \t]*
						` +
              ModifierHVAlign +
              String.raw`??   # modifier (2)
						(.*)                              # content (3)
						` +
              ModifierHVAlign +
              String.raw`?    # modifier (4)
						[ \t]*
					$~AUx`,
          );

          if (cellMatches) {
            const mHead = cellMatches.matches[1];
            const mModCol = cellMatches.matches[2];
            const mCellContent = cellMatches.matches[3];
            const mCellContentOffset = cellMatches.offsets[3];
            const mCellMod = cellMatches.matches[4];

            const cellIsHeader = isHead || mHead === "*";

            // column modifier inheritance
            if (mModCol) {
              colModifier[col] = Modifier.parse(
                mModCol.replaceAll("\\|", "|"),
                cellMatches.offsets[2] >= 0 ? cellAbsoluteOffset + cellMatches.offsets[2] : null,
              );
            }
            const cellMod = colModifier[col] !== undefined ? colModifier[col].clone() : new Modifier();
            cellMod.setProperties(mCellMod === null ? null : mCellMod.replaceAll("\\|", "|"));
            if (mCellMod !== null && mCellMod !== "") {
              // the range covers the modifier only when it is written as a single part
              cellMod.range =
                colModifier[col] !== undefined
                  ? null
                  : { offset: cellAbsoluteOffset + cellMatches.offsets[4], length: mCellMod.length };
            } else if (mModCol == null || mModCol === "") {
              // inherited from the column, not written here
              cellMod.range = null;
            }

            // Calculate absolute offset of cell content
            const contentAbsoluteOffset = cellAbsoluteOffset + mCellContentOffset;

            // Create cell node - text will be parsed later
            lastCell = new TableCellNode(new ContentNode(), 1, 1, cellIsHeader, cellMod, {
              offset: cellAbsoluteOffset,
              length: cell.length,
            });
            cells.push(lastCell);
            cellTexts.set(lastCell, [{ content: mCellContent, offset: contentAbsoluteOffset }]);
            prevRow[col] = { node: lastCell, text: mCellContent };
            col++;
          }

        }

        // even up with empty cells
        while (col < colCounter) {
          const cellMod = colModifier[col] ? colModifier[col].clone() : new Modifier();
          const emptyCell = new TableCellNode(new ContentNode(), 1, 1, isHead, cellMod);
          cells.push(emptyCell);
          cellTexts.set(emptyCell, [{ content: "", offset: 0 }]);
          prevRow[col] = { node: emptyCell, text: "" };
          col++;
        }

        colCounter = col;
        end = lineMatches.offsets[0] + lineMatches.length;

        if (cells.length > 0) {
          const rowMod = Modifier.parse(mRowMod, lineMatches.offsets[2] ?? null);
          const rowOffset = lineMatches.offsets[0];
          rows.push(new TableRowNode(cells, isHead, rowMod, { offset: rowOffset, length: end - rowOffset }));
        } else {
          // redundant row - decrement rowspan
          for (const item of Object.values(prevRow)) {
            item.node.rowspan--;
          }
        }

        continue;
      }

      break;
    }

    if (rows.length === 0) return null;

    // Parse cell text content after rowspan/colspan is determined
    for (const row of rows) {
      for (const cell of row.cells) {
        if (cellTexts.has(cell)) {
          let lines = cellTexts.get(cell);

          // right-trim: drop blank trailing fragments, trim the last one
          while (
            lines.length > 0 &&
            lines[lines.length - 1].content
              .replace(/[\t ]+$/, "")
              .replace(/\n/g, " ")
              .trim() === ""
          ) {
            lines.pop();
          }
          if (lines.length > 0) {
            lines = [...lines];
            lines[lines.length - 1] = {
              content: lines[lines.length - 1].content.replace(/[\t ]+$/, ""),
              offset: lines[lines.length - 1].offset,
            };
          }

          if (lines.length > 1) {
            // multiline - parse as block (disable nested tables)
            const [outdented, map] = OffsetMap.outdentLines(lines);
            const [unescaped, escapes] = unescapePipes(outdented);
            this.disableTables = true;
            let parsed;
            try {
              parsed = context.parseBlock(unescaped);
            } finally {
              this.disableTables = false;
            }
            if (escapes !== null) escapes.applyTo(parsed);
            map.applyTo(parsed);
            cell.content.children = parsed.children;
          } else {
            // single line - parse as inline
            const text = lines[0]?.content ?? "";
            const trimmed = text.replace(/^[\t ]+/, "");
            const trimOffset = text.length - trimmed.length;
            const baseOffset = (lines[0]?.offset ?? 0) + trimOffset;
            const [unescaped, escapes] = unescapePipes(trimmed, baseOffset);
            const parsed = context.parseInline(unescaped, escapes !== null ? 0 : baseOffset);
            if (escapes !== null) escapes.applyTo(parsed);
            cell.content.children = parsed.children;
          }

          // empty cell gets &nbsp;
          if (cell.content.children.length === 0) {
            cell.content.children = [new TextNode("\u00A0")];
          }
        }
      }
    }

    return new TableNode(
      rows,
      Modifier.parse(mMod, offsets[1]),
      { offset: startOffset, length: end - startOffset },
      caption,
    );
  }

  /**
   * Parses the optional caption line |## Text preceding the first row.
   */
  parseCaption(context) {
    const matches = context.getBlockParser().next(
      String.raw`~^
				\|                            # opening pipe
				( [\#=] ){2,}  (?! [|\#=+] )  # opening chars (1)
				(.+)                          # caption (2)
				\1*                           # matching closing chars
				\|? [ \t]*                    # optional closing pipe and spaces
			$~Umx`,
    );

    if (matches === null || matches.matches[2] === null || matches.offsets[2] === null) return null;

    // space after the opening chars is a separator, not content
    const text = matches.matches[2].replace(/[\t ]+$/, "");
    const trimmed = text.replace(/^[\t ]+/, "");
    const offset = matches.offsets[2] + text.length - trimmed.length;

    return context.parseInline(trimmed, offset);
  }
}
