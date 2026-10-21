#!/bin/bash
set -euo pipefail
export AGENT_BROWSER_SESSION=voice-parity-ui-replay-20261021
notes="$(pwd)/.pi/notes/voice-assistant-parity-20261021"
agent-browser open http://127.0.0.1:43862/parity-ui.html
agent-browser set viewport 1280 900
agent-browser wait 350
agent-browser eval '(()=>{const p=window.parity.inspect();if(p.flights.length||!p.chatOpen||p.details||p.links.length!==1||p.links[0].rel!=="noopener noreferrer")throw Error(JSON.stringify(p));return "PASS initial render is side-effect free; safe sources only"})()'
agent-browser eval 'document.querySelectorAll("button").forEach(b=>{if(b.textContent.includes("身障停車位")) b.id="parity-parking-tab"})'
agent-browser focus '#parity-parking-tab'
agent-browser press Enter
agent-browser wait 350
agent-browser eval 'document.querySelectorAll("button").forEach(b=>{if(b.textContent.includes("三民校區無障礙停車場")) b.id="parity-parking-card"})'
agent-browser focus '#parity-parking-card'
agent-browser press Enter
agent-browser eval '(()=>{const p=window.parity.inspect();if(p.flights.length!==1||p.flights[0].center[0]!==120.684||p.chatOpen)throw Error(JSON.stringify(p));return "PASS keyboard tab and map card activation"})()'
agent-browser focus 'button[aria-expanded]'
agent-browser press Enter
agent-browser wait 350
agent-browser eval '(()=>{if(document.querySelector("button[aria-expanded]").getAttribute("aria-expanded")!=="false"||[...document.querySelectorAll("button")].some(b=>b.textContent.includes("三民校區無障礙停車場")))throw Error("collapse failed");return "PASS keyboard collapse"})()'
agent-browser press Enter
agent-browser wait 350
agent-browser screenshot body "$notes/ui-desktop.png"
agent-browser set viewport 390 844
agent-browser screenshot body "$notes/ui-mobile.png"
agent-browser eval '(()=>{const p=window.parity.inspect();if(p.width!==p.scrollWidth)throw Error(JSON.stringify(p));return "PASS mobile containment"})()'
for fixture in pending cancelled failure empty; do
  agent-browser eval "window.parity.setFixture('$fixture')"
  agent-browser wait 80
  agent-browser eval "(()=>{const p=window.parity.inspect();const expected={pending:'查詢中',cancelled:'已取消',failure:'來源暫時不可用',empty:'無資料'}['$fixture'];if(!p.text.includes(expected)||/STALE_SELECTION|planAccessibleRoute|DO_NOT_RENDER|缺少位置|webSearch/.test(p.text)||p.details)throw Error(p.text);return 'PASS $fixture: '+expected})()"
done
agent-browser screenshot body "$notes/ui-empty-mobile.png"
agent-browser close
