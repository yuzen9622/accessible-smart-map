/**
 * 串流答覆的文字呈現：把累積中的 markdown 切成「可以安全交給 react-markdown
 * 的前段」與「要加模糊前緣的純文字尾段」，以及平滑揭字的節流數學。
 *
 * 全部是純函式，元件只負責畫——vitest 跑在 node 環境渲染不了元件
 * （見 memory「測試不可測『複製品』」）。
 */

/** 尾端有幾個字帶模糊前緣。沿用 Beautiful UI `StreamText` 的 blurTail = 6。 */
export const BLUR_TAIL_CHARS = 6;

/**
 * 判斷 `next` 是不是 `prev` 的延伸（前綴相同、只是變長）。
 *
 * 這是接真實 token stream 的關鍵：Beautiful UI 原版的 `StreamText` 在 `text`
 * 一變就 `setCount(0)` 重播，而本專案的 `useAIChat` 是 `fullText += chunk`
 * 後整個字串重設——直接用會每收到一個 chunk 就從頭重打一次，整段狂閃。
 * 只有在「不是延伸」（換一則訊息、清空對話）時才需要歸零。
 */
export function isPrefixExtension(prev: string, next: string): boolean {
  return next.length >= prev.length && next.startsWith(prev);
}

export type StreamRevealOptions = {
  /** 每 tick 至少推進幾個字，避免尾巴永遠差一點點追不上。 */
  minCharsPerTick?: number;
  /** 積壓的字數除以這個值當作本 tick 的步伐——積越多走越快。 */
  catchUpDivisor?: number;
  /** 允許落後的上限；超過就直接跳到這個距離內，不讓 UI 拖在後面幾秒。 */
  maxLagChars?: number;
};

const DEFAULTS: Required<StreamRevealOptions> = {
  minCharsPerTick: 1,
  catchUpDivisor: 8,
  maxLagChars: 120,
};

/**
 * 下一個 tick 該顯示到第幾個字。
 *
 * 後端一個 SSE `token` event 可能一次吐一整句（`onTextDelta` 給多少就是多少），
 * 原封不動畫出來會是一塊一塊跳出來，模糊前緣根本看不到。這裡把到貨與顯示解耦：
 * 積壓越多走越快、上限內平滑，串流結束時一次補完（`streaming: false`）——
 * 所以它只改變「何時看到」，不會讓使用者等更久。
 */
export function nextRevealCount({
  target,
  current,
  streaming,
  options,
}: {
  /** 已經到貨的字數。 */
  target: number;
  /** 目前顯示到的字數。 */
  current: number;
  /** 後端是否還在送。false 時立刻補完。 */
  streaming: boolean;
  options?: StreamRevealOptions;
}): number {
  const { minCharsPerTick, catchUpDivisor, maxLagChars } = {
    ...DEFAULTS,
    ...options,
  };

  if (!streaming) return target;
  // 上游把訊息換掉（例如切換對話）時 current 可能大於 target，直接對齊。
  if (current >= target) return target;

  const start = Math.max(current, target - maxLagChars);
  const backlog = target - start;
  const step = Math.max(minCharsPerTick, Math.ceil(backlog / catchUpDivisor));
  return Math.min(target, start + step);
}

/**
 * 把一段純文字切成「正常顯示」與「帶模糊前緣」兩截。
 * 文字比 `BLUR_TAIL_CHARS` 短時整段都算前緣。
 */
export function splitBlurTail(
  text: string,
  tailChars: number = BLUR_TAIL_CHARS,
): { lead: string; edge: string } {
  const cut = Math.max(0, text.length - Math.max(0, tailChars));
  return { lead: text.slice(0, cut), edge: text.slice(cut) };
}

/** 會讓一段文字被 markdown 解讀成別的東西的字元／開頭。 */
const BLOCK_PREFIX = /^\s*(?:[-*+>#|]|\d+[.)]|```|~~~|---)/;
const INLINE_MARKUP = /[*_`~[\]|<>\n#]/;

/** 未閉合的 code fence——在 fence 中間切開會讓前段的 ``` 落單。 */
function hasUnclosedFence(content: string): boolean {
  const fences = content.match(/^[ \t]*(?:```|~~~)/gm);
  return !!fences && fences.length % 2 === 1;
}

/**
 * 把累積中的 markdown 切成 `{ head, tail }`。
 *
 * `head` 交給既有的 `MarkdownText`（表格、清單、連結都還要正常運作），
 * `tail` 是最後一段純文字，由呼叫端加上模糊前緣與游標。
 *
 * 切不安全就整段當 `head`、`tail` 為空——寧可少一個模糊效果，也不要在
 * 未閉合的 code fence、表格或清單中間切開，讓使用者看到半個 markdown 語法。
 * 也就是說：清單／表格型的答覆只會有游標、沒有模糊前緣，這是刻意的取捨。
 */
export function splitStreamingMarkdown(content: string): {
  head: string;
  tail: string;
} {
  if (!content) return { head: "", tail: "" };
  if (hasUnclosedFence(content)) return { head: content, tail: "" };

  // 最後一個空行就是最後一個 block 的起點。
  const boundary = /\n[ \t]*\n(?![\s\S]*\n[ \t]*\n)/.exec(content);
  const splitAt = boundary ? boundary.index + boundary[0].length : 0;
  const candidate = content.slice(splitAt);

  if (!candidate || BLOCK_PREFIX.test(candidate)) {
    return { head: content, tail: "" };
  }
  if (INLINE_MARKUP.test(candidate)) {
    return { head: content, tail: "" };
  }
  return { head: content.slice(0, splitAt), tail: candidate };
}
