import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import App from "../App.js";

describe("App", () => {
  it("renders without throwing", () => {
    expect(() => renderToStaticMarkup(<App />)).not.toThrow();
  });

  it("includes the product name", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html).toContain("SolCard");
  });
});
