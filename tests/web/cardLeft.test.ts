// Where a chart's hover card goes: centred over its column, then shifted so the whole card
// stays on screen, CARD_MARGIN px in from either edge.
import { describe, expect, it } from "vitest";
import { CARD_MARGIN, cardLeft } from "../../src/web/ChartTooltip.tsx";

// A phone: a 360 px screen, the chart's container 16 px in and 328 px wide, a 176 px card
// (ChartTooltip's 11rem minimum), and 30 day columns.
const SCREEN = 360;
const BOX_LEFT = 16;
const BOX_WIDTH = 328;
const CARD = 176;
const column = (i: number, n = 30) => ((i + 0.5) / n) * BOX_WIDTH;
// The card's left and right edge on screen, for a left offset inside the container.
const edges = (left: number, card = CARD) => ({ left: BOX_LEFT + left, right: BOX_LEFT + left + card });

describe("cardLeft", () => {
  it("keeps the first column's card inside the screen's left edge", () => {
    expect(edges(cardLeft(column(0), CARD, BOX_LEFT, { left: 0, right: SCREEN })).left).toBeGreaterThanOrEqual(CARD_MARGIN);
  });

  it("keeps the last column's card inside the screen's right edge", () => {
    expect(edges(cardLeft(column(29), CARD, BOX_LEFT, { left: 0, right: SCREEN })).right).toBeLessThanOrEqual(SCREEN - CARD_MARGIN);
  });

  it("centres the card over a middle column", () => {
    const left = cardLeft(column(15), CARD, BOX_LEFT, { left: 0, right: SCREEN });
    expect(left + CARD / 2).toBeCloseTo(column(15));
  });

  it("keeps the card's left edge on screen when the card is wider than the screen", () => {
    expect(edges(cardLeft(column(0), 400, BOX_LEFT, { left: 0, right: SCREEN }), 400).left).toBe(CARD_MARGIN);
    expect(edges(cardLeft(column(29), 400, BOX_LEFT, { left: 0, right: SCREEN }), 400).left).toBe(CARD_MARGIN);
  });

  it("keeps the card inside narrower bounds on both sides", () => {
    // A desktop column that starts at 420 px and whose scrollbar leaves it 1005 px wide.
    const bounds = { left: 420, right: 1425 };
    const box = 444;
    const width = 960;
    const first = cardLeft(((0 + 0.5) / 30) * width, CARD, box, bounds);
    const last = cardLeft(((29 + 0.5) / 30) * width, CARD, box, bounds);
    expect(box + first).toBeGreaterThanOrEqual(bounds.left + CARD_MARGIN);
    expect(box + last + CARD).toBeLessThanOrEqual(bounds.right - CARD_MARGIN);
  });

  it("does not move a card that already fits", () => {
    // A wide desktop: the same columns, a 1200 px container on a 1440 px screen.
    const at = ((0 + 0.5) / 30) * 1200;
    expect(cardLeft(at, CARD, 200, { left: 0, right: 1440 })).toBeCloseTo(at - CARD / 2);
  });
});
