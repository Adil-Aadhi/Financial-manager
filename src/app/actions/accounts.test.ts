import { beforeEach, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({
  update: null as Record<string, unknown> | null,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const query = {
      eq: () => query,
      is: () => query,
      select: () => query,
      maybeSingle: async () => ({ data: { id: "account-id" }, error: null }),
    };
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: "owner-id" } },
          error: null,
        }),
      },
      from: () => ({
        update: (values: Record<string, unknown>) => {
          holder.update = values;
          return query;
        },
      }),
    };
  },
}));

const { updateAccountAction } = await import("@/app/actions/accounts");

beforeEach(() => {
  holder.update = null;
});

describe("online account summary inclusion updates", () => {
  it("does not submit an unchanged setting with a name edit", async () => {
    const result = await updateAccountAction({
      accountId: "account-id",
      name: "Renamed account",
      openingAmount: 10,
      accountGroup: "primary",
    });

    expect(result.success).toBe(true);
    expect(holder.update).toMatchObject({
      name: "Renamed account",
      opening_balance: 10,
      account_group: "primary",
    });
    expect(holder.update).not.toHaveProperty("include_in_summary");
  });

  it("does not submit an unchanged setting with an opening-balance edit", async () => {
    const result = await updateAccountAction({
      accountId: "account-id",
      name: "Cash",
      openingAmount: 25,
      accountGroup: "general",
    });

    expect(result.success).toBe(true);
    expect(holder.update).toMatchObject({
      name: "Cash",
      opening_balance: 25,
      account_group: "general",
    });
    expect(holder.update).not.toHaveProperty("include_in_summary");
  });

  it("submits an intentional toggle change", async () => {
    const result = await updateAccountAction({
      accountId: "account-id",
      name: "Cash",
      openingAmount: 10,
      accountGroup: "primary",
      includeInSummary: false,
    });

    expect(result.success).toBe(true);
    expect(holder.update).toMatchObject({ include_in_summary: false });
  });
});
