import { describe, expect, it } from "vitest";
import {
  BLUR_TAIL_CHARS,
  isPrefixExtension,
  nextRevealCount,
  splitBlurTail,
  splitStreamingMarkdown,
} from "../streamingText";

describe("isPrefixExtension", () => {
  it("累積式串流的每一步都算延伸", () => {
    expect(isPrefixExtension("台北車", "台北車站")).toBe(true);
    expect(isPrefixExtension("", "台")).toBe(true);
    expect(isPrefixExtension("同樣", "同樣")).toBe(true);
  });

  it("換一則訊息、內容被改寫或變短都不算延伸", () => {
    expect(isPrefixExtension("台北車站", "高雄車站")).toBe(false);
    expect(isPrefixExtension("台北車站", "台北")).toBe(false);
    expect(isPrefixExtension("錯誤訊息", "")).toBe(false);
  });
});

describe("nextRevealCount", () => {
  const call = (
    target: number,
    current: number,
    streaming = true,
    options?: Parameters<typeof nextRevealCount>[0]["options"],
  ) => nextRevealCount({ target, current, streaming, options });

  it("串流結束時一次補完，不讓使用者等動畫", () => {
    expect(call(500, 3, false)).toBe(500);
  });

  it("每次至少推進一個字，不會卡住不動", () => {
    expect(call(10, 9)).toBe(10);
    expect(call(2, 1)).toBe(2);
  });

  it("積壓越多走得越快", () => {
    const slow = call(20, 10) - 10; // backlog 10
    const fast = call(110, 10) - 10; // backlog 100
    expect(fast).toBeGreaterThan(slow);
  });

  it("落後超過上限就直接跳，不會拖在後面好幾秒", () => {
    // backlog 1000 遠超過預設 maxLagChars=120：起點被拉到 target-120，
    // 再走 120/8=15，所以一個 tick 就從 0 跳到 895。
    expect(call(1000, 0)).toBe(895);
  });

  it("永遠不超過已到貨的字數", () => {
    expect(call(5, 0)).toBeLessThanOrEqual(5);
    expect(call(1, 0)).toBe(1);
  });

  it("current 超前 target（上游換訊息）時直接對齊而不是回傳負數", () => {
    expect(call(3, 99)).toBe(3);
  });

  it("可以覆寫節流參數", () => {
    expect(call(100, 0, true, { maxLagChars: 10, catchUpDivisor: 1 })).toBe(
      100,
    );
  });
});

describe("splitBlurTail", () => {
  it("把尾端固定字數切出來當模糊前緣", () => {
    expect(splitBlurTail("0123456789", 4)).toEqual({
      lead: "012345",
      edge: "6789",
    });
  });

  it("文字比前緣短時整段都是前緣", () => {
    expect(splitBlurTail("嗨", 6)).toEqual({ lead: "", edge: "嗨" });
  });

  it("空字串不會爆", () => {
    expect(splitBlurTail("")).toEqual({ lead: "", edge: "" });
  });

  it("預設吃 BLUR_TAIL_CHARS", () => {
    const text = "a".repeat(20);
    expect(splitBlurTail(text).edge).toHaveLength(BLUR_TAIL_CHARS);
  });
});

describe("splitStreamingMarkdown", () => {
  it("只有一段純文字時整段都是 tail", () => {
    expect(splitStreamingMarkdown("附近有三個無障礙電梯")).toEqual({
      head: "",
      tail: "附近有三個無障礙電梯",
    });
  });

  it("多段時在最後一個空行切開，前面交給 markdown", () => {
    const { head, tail } = splitStreamingMarkdown("第一段\n\n第二段正在打");
    expect(head).toBe("第一段\n\n");
    expect(tail).toBe("第二段正在打");
  });

  it("未閉合的 code fence 絕對不切——切了會讓 ``` 落單", () => {
    const content = "說明\n\n```ts\nconst a = 1;";
    expect(splitStreamingMarkdown(content)).toEqual({
      head: content,
      tail: "",
    });
  });

  it("已閉合的 code fence 之後的純文字可以正常切", () => {
    const content = "```ts\nconst a = 1;\n```\n\n以上是範例";
    expect(splitStreamingMarkdown(content).tail).toBe("以上是範例");
  });

  // 上面那條「未閉合」其實驗不到 hasUnclosedFence：候選尾段開頭就是 ```，
  // BLOCK_PREFIX 會先攔下來，把 fence 偵測關掉結果也一樣（fresh-context
  // 驗收的突變測試抓到的覆蓋缺口）。真正只有 fence 偵測救得了的情況是
  // **程式碼區塊中間有空行**：最後一段長得像普通句子，切下去會讓 head 停在
  // 落單的 ```，程式碼那行則被當成一般段落拉出來。
  it("程式碼區塊中間有空行時也不切——這條才真的在驗 fence 偵測", () => {
    const content = "說明\n\n```ts\nconst a = 1;\n\nconsole.log(a);";
    expect(splitStreamingMarkdown(content)).toEqual({
      head: content,
      tail: "",
    });
  });

  it("~~~ 圍籬同樣算數", () => {
    const content = "說明\n\n~~~py\nx = 1\n\nprint(x)";
    expect(splitStreamingMarkdown(content)).toEqual({
      head: content,
      tail: "",
    });
  });

  it.each([
    ["清單", "前言\n\n- 第一項"],
    ["有序清單", "前言\n\n1. 第一項"],
    ["標題", "前言\n\n## 小標"],
    ["表格", "前言\n\n| 站名 | 電梯 |"],
    ["引言", "前言\n\n> 注意"],
    ["分隔線", "前言\n\n---"],
  ])("最後一段是 %s 時不切，避免噴出半個語法", (_label, content) => {
    expect(splitStreamingMarkdown(content)).toEqual({
      head: content,
      tail: "",
    });
  });

  it.each([
    ["粗體", "前言\n\n這裡有 **重點"],
    ["行內程式碼", "前言\n\n輸入 `npm"],
    ["連結", "前言\n\n參考 [官網"],
    ["換行", "前言\n\n第一行\n第二行"],
  ])("最後一段含 %s 語法時不切", (_label, content) => {
    expect(splitStreamingMarkdown(content)).toEqual({
      head: content,
      tail: "",
    });
  });

  it("空字串回空", () => {
    expect(splitStreamingMarkdown("")).toEqual({ head: "", tail: "" });
  });

  it("切點是可還原的——head + tail 永遠等於原文", () => {
    for (const content of [
      "純文字",
      "第一段\n\n第二段",
      "前言\n\n- 清單",
      "```ts\nx",
      "",
    ]) {
      const { head, tail } = splitStreamingMarkdown(content);
      expect(head + tail).toBe(content);
    }
  });
});
