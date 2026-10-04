import { fromLittle, toLittle } from "../../src";

describe("toLittle", () => {
  it("escapes every reserved character", () => {
    expect(toLittle("a\\b|c{d}e@f[g]h(i)j<k>l*m_n~o")).toBe(
      "a\\\\b\\|c\\{d\\}e\\@f\\[g\\]h\\(i\\)j\\<k\\>l\\*m\\_n\\~o"
    );
  });

  it("keeps #words as hashtags, and escapes a # that starts no word", () => {
    expect(toLittle("#ship it, C# and # 1, #café #2026")).toBe("#ship it, C\\# and \\# 1, #café #2026");
  });

  it("ends a hashtag at the first character that is not a letter or a digit", () => {
    expect(toLittle("#open_source")).toBe("#open\\_source");
  });

  it("escapes every # with hashtags: false", () => {
    expect(toLittle("#ship", { hashtags: false })).toBe("\\#ship");
  });

  it("keeps line breaks and emoji", () => {
    expect(toLittle("Line 1\n\n🚀 Line 2")).toBe("Line 1\n\n🚀 Line 2");
  });
});

describe("fromLittle", () => {
  it("undoes toLittle", () => {
    const text = "Launch (beta) — [notes] #release @team C# 50% *bold* _x_ ~y~ <z> {w} a|b \\";
    expect(fromLittle(toLittle(text))).toBe(text);
  });

  it("resolves hashtag templates and mentions", () => {
    expect(fromLittle("Hi @[Ada](urn:li:person:1) {hashtag|\\#|coding}")).toBe("Hi Ada #coding");
  });
});
