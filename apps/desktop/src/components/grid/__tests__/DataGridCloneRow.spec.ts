// @vitest-environment happy-dom

import { createApp, defineComponent, h, KeepAlive, nextTick, shallowRef, type App, type PropType } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/i18n";
import type { ColumnInfo, IndexInfo, QueryResult } from "@/types/database";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useSettingsStore } from "@/stores/settingsStore";

const mocks = vi.hoisted(() => ({ listIndexes: vi.fn() }));
vi.mock("@/lib/backend/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend/api")>()),
  listIndexes: mocks.listIndexes,
}));

vi.mock("vue-virtual-scroller", async () => {
  const { defineComponent, h } = await import("vue");
  return {
    RecycleScroller: defineComponent({
      props: { items: { type: Array as PropType<unknown[]>, default: () => [] } },
      setup(props, { attrs, slots }) {
        return () =>
          h(
            "div",
            attrs,
            props.items.map((item) => slots.default?.({ item })),
          );
      },
    }),
  };
});

import DataGrid from "../DataGrid.vue";

const mounted: Array<{ app: App; host: HTMLElement }> = [];

function mountGrid() {
  const pinia = createPinia();
  setActivePinia(pinia);
  const settings = useSettingsStore();
  settings.updateEditorSettings({
    dataGridRenderMode: "canvas",
    dataGridMultiRowTranspose: false,
    dataGridHideNullColumns: false,
    dataGridQuickEntry: false,
    shortcuts: { ...settings.editorSettings.shortcuts, copyCurrentRow: "Ctrl+Alt+K" },
  });
  const result = shallowRef<QueryResult>({
    columns: ["id", "code", "name"],
    rows: [
      [1, "one", "Alice"],
      [2, "two", "Bob"],
    ],
    affected_rows: 0,
    execution_time_ms: 0,
  });
  const columns: ColumnInfo[] = [
    { name: "id", data_type: "int", is_nullable: false, column_default: null, is_primary_key: true, extra: "auto_increment" },
    { name: "code", data_type: "varchar", is_nullable: true, column_default: null, is_primary_key: false, extra: null },
    { name: "name", data_type: "varchar", is_nullable: true, column_default: null, is_primary_key: false, extra: null },
  ];
  const tableMeta = shallowRef({ tableName: "users", columns, primaryKeys: ["id"] });
  const visible = shallowRef(true);
  const host = document.createElement("div");
  document.body.append(host);
  const app = createApp(
    defineComponent({
      setup: () => () =>
        h(
          TooltipProvider,
          { delayDuration: 0 },
          {
            default: () =>
              h(KeepAlive, null, {
                default: () =>
                  visible.value
                    ? h(DataGrid, {
                        result: result.value,
                        databaseType: "mysql",
                        context: "table-data",
                        editable: true,
                        connectionId: "connection-1",
                        database: "app",
                        tableMeta: tableMeta.value,
                      })
                    : null,
              }),
          },
        ),
    }),
  );
  app.use(pinia);
  app.use(i18n);
  app.mount(host);
  settings.updateEditorSettings({ dataGridRenderMode: "dom" });
  mounted.push({ app, host });
  return { host, result, tableMeta, visible };
}

async function settle() {
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

async function requestClone(host: HTMLElement, multiple: boolean) {
  const rows = [...host.querySelectorAll<HTMLElement>(".data-grid-row")];
  for (let index = 0; index < (multiple ? 2 : 1); index++) {
    const number = rows[index]!.querySelector<HTMLElement>(".data-grid-row-number")!;
    number.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0, ctrlKey: index > 0 }));
    window.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }));
    await settle();
  }
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "k", ctrlKey: true, altKey: true });
  host.querySelector<HTMLElement>("[data-grid-root]")!.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
}

function deferIndexes() {
  let resolve!: (indexes: IndexInfo[]) => void;
  mocks.listIndexes.mockReturnValue(
    new Promise<IndexInfo[]>((done) => {
      resolve = done;
    }),
  );
  return resolve;
}

afterEach(() => {
  for (const { app, host } of mounted.splice(0)) {
    app.unmount();
    host.remove();
  }
  vi.clearAllMocks();
});

describe("DataGrid clone row", () => {
  it.each([
    [false, false, 2],
    [true, true, 4],
    [false, true, 3],
  ] as const)("keeps consecutive clone requests while indexes load (%s, %s)", async (firstMultiple, secondMultiple, expectedCount) => {
    const resolve = deferIndexes();
    const { host } = mountGrid();
    await settle();
    await requestClone(host, firstMultiple);
    await requestClone(host, secondMultiple);
    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(0);

    resolve([{ name: "unique_code", columns: ["code"], is_unique: true, is_primary: false } as IndexInfo]);
    await vi.waitFor(() => expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(expectedCount));
    expect(mocks.listIndexes).toHaveBeenCalledTimes(1);
    for (const row of host.querySelectorAll(".data-grid-row--new")) {
      const cells = row.querySelectorAll(".data-grid-cell");
      expect(cells[0]?.textContent?.trim()).toBe("<generated>");
      expect(cells[1]?.textContent?.trim()).toBe("NULL");
    }

    // Each user request keeps its own undo entry, including batch clones.
    const root = host.querySelector<HTMLElement>("[data-grid-root]")!;
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }));
    await settle();
    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(firstMultiple ? 2 : 1);
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }));
    await settle();
    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(0);
  });

  it.each([false, true])("waits for unique index metadata before cloning (multiple: %s)", async (multiple) => {
    const resolve = deferIndexes();
    const { host } = mountGrid();
    await settle();
    await requestClone(host, multiple);
    expect(mocks.listIndexes).toHaveBeenCalledTimes(1);
    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(0);

    resolve([{ name: "unique_code", columns: ["code"], is_unique: true, is_primary: false } as IndexInfo]);
    await settle();
    await settle();

    const clones = [...host.querySelectorAll<HTMLElement>(".data-grid-row--new")];
    expect(clones).toHaveLength(multiple ? 2 : 1);
    expect(clones.map((row) => [...row.querySelectorAll(".data-grid-cell")].map((cell) => cell.textContent?.trim()))).toEqual(
      multiple
        ? [
            ["<generated>", "NULL", "Alice"],
            ["<generated>", "NULL", "Bob"],
          ]
        : [["<generated>", "NULL", "Alice"]],
    );
  });

  it.each([false, true])("cancels cloning after a result change on the same table (multiple: %s)", async (multiple) => {
    const resolve = deferIndexes();
    const { host, result } = mountGrid();
    await settle();
    await requestClone(host, multiple);

    await requestClone(host, multiple);
    result.value = {
      ...result.value,
      rows: [
        [99, "other", "Different page"],
        [100, "next", "Another row"],
      ],
    };
    await settle();
    resolve([]);
    await settle();
    await settle();

    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(0);
    expect(host.textContent).toContain("Different page");
  });

  it("cancels cloning when pending changes are undone during index loading", async () => {
    const resolve = deferIndexes();
    const { host } = mountGrid();
    await settle();
    const root = host.querySelector<HTMLElement>("[data-grid-root]")!;
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "n", ctrlKey: true }));
    await settle();
    host.querySelector<HTMLElement>(".cell-edit-input")!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await settle();
    await requestClone(host, false);
    await requestClone(host, true);
    root.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "z", ctrlKey: true }));
    await settle();
    resolve([]);
    await settle();
    await settle();

    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(0);
  });

  it("does not block a new table's clones on a cancelled queue", async () => {
    const resolveOldIndexes = deferIndexes();
    const { host, result, tableMeta } = mountGrid();
    await settle();
    await requestClone(host, false);

    mocks.listIndexes.mockResolvedValueOnce([]);
    tableMeta.value = { ...tableMeta.value, tableName: "other_users" };
    result.value = { ...result.value, rows: [[99, "other", "New table"]] };
    await settle();
    await requestClone(host, false);
    await vi.waitFor(() => expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(1));
    expect(host.querySelector(".data-grid-row--new")?.textContent).toContain("New table");

    resolveOldIndexes([]);
    await settle();
    await settle();
    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(1);
  });

  it("cancels cloning when the grid is deactivated during index loading", async () => {
    const resolve = deferIndexes();
    const { host, visible } = mountGrid();
    await settle();
    await requestClone(host, false);
    await requestClone(host, true);
    visible.value = false;
    await settle();
    resolve([]);
    await settle();
    visible.value = true;
    await settle();
    await settle();

    expect(host.querySelectorAll(".data-grid-row--new")).toHaveLength(0);
  });
});
