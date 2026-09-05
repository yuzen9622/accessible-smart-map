import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NumberTicker } from "../number-ticker";

describe("NumberTicker (vanilla @beui/number-ticker)", () => {
  it("renders an integer with sr-only readable text", () => {
    const html = renderToStaticMarkup(<NumberTicker value={42} blur={true} />);
    expect(html).toContain('<span class="sr-only">42</span>');
    expect(html).toContain('aria-hidden="true"');
  });

  it("renders with prefix and suffix", () => {
    const html = renderToStaticMarkup(
      <NumberTicker value={15} prefix="$" suffix=" NTD" />,
    );
    expect(html).toContain('<span class="sr-only">$15 NTD</span>');
    expect(html).toContain("$");
    expect(html).toContain(" NTD");
  });

  it("renders custom formatted text with format prop", () => {
    const html = renderToStaticMarkup(
      <NumberTicker value={12} format={(v) => (v / 10).toFixed(1)} />,
    );
    expect(html).toContain('<span class="sr-only">1.2</span>');
    expect(html).toContain(".");
  });

  it("supports startOnView=false and blur=true without error", () => {
    const html = renderToStaticMarkup(
      <NumberTicker
        value={580}
        startOnView={false}
        blur={true}
        duration={0.4}
      />,
    );
    expect(html).toContain('<span class="sr-only">580</span>');
  });

  it("supports pad prop", () => {
    const html = renderToStaticMarkup(<NumberTicker value={5} pad={3} />);
    expect(html).toContain('<span class="sr-only">005</span>');
  });
});
