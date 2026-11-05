import { expect, test } from "vitest";
import { calculateDataGridColumnWidth, DATA_GRID_AUTO_FIT_VALUE_TEXT_LIMIT, DATA_GRID_COL_AUTO_FIT_MAX_WIDTH, DATA_GRID_COL_MAX_WIDTH, DATA_GRID_HEADER_MAX_WIDTH } from "../../apps/desktop/src/lib/dataGrid/dataGridColumnWidth.ts";

test("default data grid column width remains compact for long values", () => {
  const width = calculateDataGridColumnWidth({
    columnName: "description",
    sampleValues: ["x".repeat(120)],
  });

  // standard: valueTextLimit=40, so 120 chars truncated to 40 → 40×8+24+12=356
  expect(width).toBe(356);
});

test("auto-fit data grid column width expands long values beyond default width", () => {
  const width = calculateDataGridColumnWidth({
    columnName: "description",
    sampleValues: ["x".repeat(120)],
    maxWidth: DATA_GRID_COL_AUTO_FIT_MAX_WIDTH,
    valueTextLimit: DATA_GRID_AUTO_FIT_VALUE_TEXT_LIMIT,
  });

  expect(width).toBeGreaterThan(356);
});

test("auto-fit data grid column width stays bounded for very long values", () => {
  const width = calculateDataGridColumnWidth({
    columnName: "description",
    sampleValues: ["x".repeat(1000)],
    maxWidth: DATA_GRID_COL_AUTO_FIT_MAX_WIDTH,
    valueTextLimit: DATA_GRID_AUTO_FIT_VALUE_TEXT_LIMIT,
  });

  expect(width).toBe(DATA_GRID_COL_AUTO_FIT_MAX_WIDTH);
});

test("data grid column width uses measured header text as the normal minimum", () => {
  const width = calculateDataGridColumnWidth({
    columnName: "AMOUNT",
    sampleValues: ["1"],
    density: "comfortable",
    compactColumnHeaderActions: true,
    headerTextWidth: 54,
  });

  expect(width).toBe(113);
});

test("data grid caps pathological field names independently of density", () => {
  const width = calculateDataGridColumnWidth({
    columnName: "x".repeat(100),
    sampleValues: ["1"],
    density: "compact",
    compactColumnHeaderActions: true,
    headerTextWidth: 700,
  });

  expect(width).toBe(DATA_GRID_HEADER_MAX_WIDTH);
});

test("data grid column width accommodates placeholder when values are short", () => {
  const widthWithoutPlaceholder = calculateDataGridColumnWidth({
    columnName: "id",
    sampleValues: [1, 2, 3],
  });

  const widthWithPlaceholder = calculateDataGridColumnWidth({
    columnName: "id",
    sampleValues: [1, 2, 3],
    placeholder: "<generated>",
  });

  expect(widthWithPlaceholder).toBeGreaterThan(widthWithoutPlaceholder);
  // <generated> is 11 chars. At 8px/char + 24px padding + 12px slack = 124px.
  expect(widthWithPlaceholder).toBe(124);
});

test("data grid column width does not shrink wider columns for a shorter placeholder", () => {
  const width = calculateDataGridColumnWidth({
    columnName: "long_column_identifier_name",
    sampleValues: ["a_very_long_sample_value_that_exceeds_placeholder"],
    placeholder: "<generated>",
  });

  expect(width).toBeGreaterThan(124);
});
