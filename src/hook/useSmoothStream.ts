"use client";

import { useEffect, useRef, useState } from "react";
import {
  isPrefixExtension,
  nextRevealCount,
  type StreamRevealOptions,
} from "@/lib/ai/streamingText";

/** 節流的心跳。16ms ≈ 一個 frame，夠細到看得出前緣在走。 */
const TICK_MS = 16;

/**
 * 把「已到貨的文字」平滑成「正在顯示的文字」。
 *
 * 後端一個 SSE `token` event 可能一次吐一整句，直接畫會一塊一塊跳出來。
 * 這裡讓顯示落後到貨一小段並穩定追上，串流一結束（`streaming` 轉 false）
 * 立刻補完——只改變「何時看到」，不會讓使用者多等。
 *
 * 關鍵：只有在新字串**不是**舊字串的延伸時才歸零。Beautiful UI 原版的
 * `StreamText` 是 `useEffect(..., [text])` 裡無條件 `setCount(0)`，接上
 * `fullText += chunk` 這種累積式串流會每個 chunk 從頭重播一次。
 */
export default function useSmoothStream(
  text: string,
  {
    enabled = true,
    options,
  }: { enabled?: boolean; options?: StreamRevealOptions } = {},
): string {
  // 關閉時（reduced motion、非串流中的舊訊息）完全不啟動計時器，直接回全文。
  const [count, setCount] = useState(() => (enabled ? 0 : text.length));
  const prevTextRef = useRef(text);

  // 換了一則訊息就從頭開始；同一則變長則接著播。在 render 期間同步比對，
  // 避免先用舊 count 畫出「新訊息的前半段」再被 effect 修正而閃一下。
  if (!isPrefixExtension(prevTextRef.current, text)) {
    prevTextRef.current = text;
    if (count !== 0) setCount(0);
  } else {
    prevTextRef.current = text;
  }

  useEffect(() => {
    if (!enabled) {
      setCount(text.length);
      return;
    }
    const id = setInterval(() => {
      setCount((current) => {
        const next = nextRevealCount({
          target: text.length,
          current,
          streaming: true,
          options,
        });
        return next === current ? current : next;
      });
    }, TICK_MS);
    return () => clearInterval(id);
  }, [text.length, enabled, options]);

  return enabled ? text.slice(0, Math.min(count, text.length)) : text;
}
