/**
 * 工具名稱 → 使用者可讀標籤。
 *
 * 原本住在 `src/hook/useAIChat.ts`，搬到 lib 是因為 `thinkingTrace.ts`
 * （純函式、可測）需要它：hook 會 import `lib/ai/*`，lib 再回頭 import hook
 * 就會形成循環依賴，`npm run check:cycles` 會擋下來。
 */
export const TOOL_LABELS: Record<string, string> = {
  findGooglePlaces: "搜尋周邊地點",
  findA11yPlaces: "查詢無障礙設施",
  getA11yFacilityDetails: "查詢無障礙設施詳情",
  findCampusAccessibility: "查詢校園無障礙",
  getCampusAccessibilityDetails: "查詢校區設施詳情",
  planAccessibleRoute: "規劃無障礙路線",
  getNavInstructions: "產生導航指引",
  getBusRoute: "查詢公車路線",
  getBusRouteDetail: "查詢公車路線詳情",
  getBusArrival: "查詢公車預估到站時間",
  getBusTimetable: "查詢公車時刻表",
  trackBuses: "追蹤公車即時動態",
  findNearbyBusStops: "查詢附近公車站牌",
  getAirQuality: "查詢空氣品質",
  getEnvironmentInfo: "查詢周邊環境資訊",
  getNearbyHazards: "查詢附近障礙物",
  findNearbyParking: "查詢身障停車位",
  saveMemory: "記錄偏好設定",
  deleteMemory: "刪除偏好設定",
  searchAccessibilityGuide: "查詢無障礙指南",
  webSearch: "網路搜尋",
  // 後端 tool.ts 有、原本這張表漏掉的（未知工具會以英文原名出現在 trace 上）
  planRoute: "規劃路線",
  getTrainTimetable: "查詢火車時刻表",
  getStationTimetable: "查詢車站發車時刻",
  getMetroAlerts: "查詢捷運營運狀態",
  getTransitAlerts: "查詢大眾運輸警報",
};

/**
 * 每個工具執行時的專屬 loading 文字（已含「正在…」與結尾「…」）。
 * 找不到對應時退回 `正在${TOOL_LABELS[name]}…` 或工具原名——見
 * `toolLoadingLabel()`。
 */
export const TOOL_LOADING_TEXT: Record<string, string> = {
  findGooglePlaces: "正在搜尋周邊地點…",
  findA11yPlaces: "正在查詢周邊無障礙設施…",
  getA11yFacilityDetails: "正在查詢無障礙設施詳情…",
  findCampusAccessibility: "正在查詢校園無障礙資訊…",
  getCampusAccessibilityDetails: "正在查詢校區設施詳情…",
  planAccessibleRoute: "正在為你規劃無障礙路線…",
  getNavInstructions: "正在產生導航指引…",
  getBusRoute: "正在查詢公車路線…",
  getBusRouteDetail: "正在查詢公車路線詳情…",
  getBusArrival: "正在查詢公車到站時間…",
  getBusTimetable: "正在查詢公車時刻表…",
  trackBuses: "正在追蹤公車即時動態…",
  findNearbyBusStops: "正在查詢附近公車站牌…",
  getAirQuality: "正在查詢空氣品質…",
  getEnvironmentInfo: "正在查詢周邊環境資訊…",
  getNearbyHazards: "正在查詢附近路況與障礙物…",
  findNearbyParking: "正在尋找身障停車位…",
  saveMemory: "正在記住你的偏好…",
  deleteMemory: "正在刪除記憶…",
  searchAccessibilityGuide: "正在查詢無障礙指南…",
  webSearch: "正在搜尋網路資訊…",
  planRoute: "正在規劃路線…",
  getTrainTimetable: "正在查詢火車時刻表…",
  getStationTimetable: "正在查詢車站發車時刻…",
  getMetroAlerts: "正在查詢捷運營運狀態…",
  getTransitAlerts: "正在查詢大眾運輸警報…",
};

/** 進行中的文字，例如「正在查詢公車路線…」。 */
export function toolLoadingLabel(name: string): string {
  return (
    TOOL_LOADING_TEXT[name] ??
    (TOOL_LABELS[name] ? `正在${TOOL_LABELS[name]}…` : `正在${name}…`)
  );
}

/** 已完成的文字，例如「查詢公車路線」。未知工具退回原始名稱。 */
export function toolDoneLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}
