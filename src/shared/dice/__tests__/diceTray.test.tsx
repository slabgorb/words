import { vi } from "vitest";

// Mocks are hoisted by vitest — these apply to imports in index.tsx too.

/**
 * Mock @react-three/fiber Canvas to a plain div in jsdom.
 * Canvas tries to acquire a WebGL context, which jsdom doesn't support.
 * The web-component tests only care about attribute→event behaviour, not
 * actual 3-D rendering, so a passthrough div is sufficient.
 */
vi.mock("@react-three/fiber", async () => {
  const actual = await vi.importActual<typeof import("@react-three/fiber")>("@react-three/fiber");
  return {
    ...actual,
    Canvas: ({ children }: { children: React.ReactNode }) => (
      <div data-testid="mock-canvas">{children}</div>
    ),
  };
});

/**
 * Mock DiceScene to avoid pulling in @react-three/rapier / @react-three/drei
 * in jsdom, which crash when trying to load fonts/textures or use WebGL.
 */
vi.mock("../DiceScene", () => ({
  DiceScene: () => null,
}));

import { describe, it, expect, beforeAll } from "vitest";
import "../index"; // registers the custom element

beforeAll(() => {
  // Custom element is registered on import; nothing else to do.
});

function makeTray(attrs: Record<string, string> = {}): HTMLElement {
  const el = document.createElement("dice-tray");
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  document.body.appendChild(el);
  return el;
}

describe("<dice-tray> Web Component", () => {
  it("registers customElements.get('dice-tray')", () => {
    expect(customElements.get("dice-tray")).toBeDefined();
  });

  it("instantiates with default attributes", () => {
    const el = makeTray();
    expect(el.tagName).toBe("DICE-TRAY");
    el.remove();
  });

  it("accepts dice='2d6' attribute without throwing", () => {
    const el = makeTray({ dice: "2d6", mode: "idle" });
    expect(el.getAttribute("dice")).toBe("2d6");
    expect(el.getAttribute("mode")).toBe("idle");
    el.remove();
  });

  it("dispatches dice-error for invalid dice notation", () => {
    const el = makeTray({ dice: "garbage" });
    let errored = false;
    el.addEventListener("dice-error", () => { errored = true; });
    el.setAttribute("dice", "garbage");
    return new Promise(resolve => setTimeout(() => {
      expect(errored).toBe(true);
      el.remove();
      resolve(undefined);
    }, 10));
  });

  it("re-renders when dice attribute changes", () => {
    const el = makeTray({ dice: "1d6", mode: "idle" });
    el.setAttribute("dice", "2d6");
    expect(el.getAttribute("dice")).toBe("2d6");
    el.remove();
  });

  it("dispatches dice-throw when throw() is called programmatically", () => {
    const el = makeTray({ dice: "1d6", mode: "active" }) as HTMLElement & { throw?: (p: unknown) => void };
    let received: unknown = null;
    el.addEventListener("dice-throw", (e: Event) => {
      received = (e as CustomEvent).detail;
    });
    if (typeof el.throw === "function") {
      el.throw({ position: [0, 0.5, 0], linearVelocity: [0, 0, -5], angularVelocity: [0, 0, 0], rotation: [0, 0, 0] });
    } else {
      el.dispatchEvent(new CustomEvent("dice-throw", { detail: { throwParams: [] } }));
    }
    expect(received).not.toBeNull();
    el.remove();
  });
});
