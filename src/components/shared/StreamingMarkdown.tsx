"use client";

import { useMemo } from "react";
import useReducedMotion from "@/hook/useReducedMotion";
import useSmoothStream from "@/hook/useSmoothStream";
import { splitBlurTail, splitStreamingMarkdown } from "@/lib/ai/streamingText";
import { cn } from "@/lib/utils";
import MarkdownText from "./MarkdownText";

/**
 * 串流中的答覆內容。
 *
 * 模糊前緣與游標的做法取自 Beautiful UI 的 `StreamText`
 * （MIT, © 2026 Shane Levine, https://www.beautifului.dev — 見 AUTHORS.md），
 * 但沒有沿用它的打字機：原版吃的是「已經完整拿到的字串」再假裝逐字打出來，
 * 本專案的字是真的一個個從後端來的，再疊一層假打字只會拖慢答覆。這裡改成
 * 把真實到貨節流成穩定的速度（`useSmoothStream`）。
 *
 * markdown 不能整段拿去做逐字效果——`MarkdownText` 吃的是完整語法，切在
 * 一半會噴出半個表格或落單的 ```。所以只把**最後一段純文字**交給模糊前緣，
 * 其餘照常走 markdown；清單／表格結尾的答覆就只有游標，沒有模糊前緣。
 */
export default function StreamingMarkdown({
  content,
  streaming,
}: {
  content: string;
  /** 後端是否還在送這則訊息。false 時完全等同於原本的 `MarkdownText`。 */
  streaming: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const animate = streaming && !reducedMotion;
  const shown = useSmoothStream(content, { enabled: animate });

  const { head, tail } = useMemo(
    () => (animate ? splitStreamingMarkdown(shown) : { head: shown, tail: "" }),
    [animate, shown],
  );
  const { lead, edge } = useMemo(() => splitBlurTail(tail), [tail]);

  return (
    <div className={cn("stream-body", animate && "is-streaming")}>
      {head && <MarkdownText>{head}</MarkdownText>}
      {tail && (
        // 與 MarkdownText 的 `p` 覆寫同一組 class，接在 markdown 後面時
        // 段距才不會忽然變掉。
        <p className="mb-2 last:mb-0">
          {lead}
          <span className="stream-tail">{edge}</span>
        </p>
      )}
    </div>
  );
}
