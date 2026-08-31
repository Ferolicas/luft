import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, errorMessage, money } from "./api";

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("sends authenticated JSON requests under the API prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api<{ ok: boolean }>("/health")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/health",
      expect.objectContaining({
        credentials: "include",
        headers: expect.objectContaining({ "Content-Type": "application/json" }),
      }),
    );
  });

  it("preserves provider errors for useful user feedback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: "Credenciales pendientes" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const request = api("/startif/payments/pse");
    await expect(request).rejects.toBeInstanceOf(ApiError);
    await request.catch((error) =>
      expect(errorMessage(error)).toBe("Credenciales pendientes"),
    );
  });
});

describe("money", () => {
  it("formats whole Colombian pesos", () => {
    const formatted = money(500000);
    expect(formatted).toContain("500.000");
    expect(formatted).toContain("$");
  });
});
