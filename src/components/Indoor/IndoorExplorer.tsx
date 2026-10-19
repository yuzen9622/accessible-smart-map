"use client";

import {
  Accessibility,
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  Box,
  Building2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  DoorOpen,
  Footprints,
  ImageIcon,
  Layers3,
  LoaderCircle,
  MapPin,
  Minus,
  Navigation,
  Pause,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { indoorFeatureName } from "@/lib/indoor/facilityAreas";
import { planIndoorRoute } from "@/lib/indoor/route";
import { sampleRoutePresentation } from "@/lib/indoor/routePresentation";
import type {
  IndoorConnection,
  IndoorFeature,
  IndoorMode,
  IndoorPlace,
  IndoorRoute,
  IndoorStairDesign,
  IndoorVerticalPreference,
  LocalIndoorModel,
} from "@/lib/indoor/types";
import useMapStore from "@/stores/useMapStore";
import { IndoorPanelPortal } from "./IndoorPanelBridge";
import styles from "./indoor.module.css";

const IndoorScene = dynamic(() => import("./IndoorScene"), {
  ssr: false,
  loading: () => (
    <div className={styles.sceneLoading}>
      <LoaderCircle className={styles.spin} size={24} />
      <span>建立室內模型…</span>
    </div>
  ),
});

const IndoorMapScene = dynamic(() => import("./IndoorMapScene"), {
  ssr: false,
});

type CameraAction = {
  type: "zoomIn" | "zoomOut" | "rotate" | "reset";
  nonce: number;
};
type DirectoryCategory = "all" | "room" | "elevator" | "stairs";

function featureKind(feature: IndoorFeature) {
  return feature.displayKind ?? feature.kind;
}

function featureName(feature: IndoorFeature) {
  const name = indoorFeatureName(feature);
  return (
    (feature.ref && name && !name.includes(feature.ref)
      ? `${feature.ref} ${name}`
      : name) ||
    feature.ref ||
    (featureKind(feature) === "elevator"
      ? "電梯"
      : featureKind(feature) === "stairs"
        ? "樓梯"
        : "未命名空間")
  );
}

function kindLabel(kind: string) {
  return (
    (
      {
        room: "教室／空間",
        elevator: "電梯",
        stairs: "樓梯",
        steps: "樓梯",
        corridor: "公共走廊",
        area: "公共空間",
        ramp: "坡道",
        door: "出入口",
      } as Record<string, string>
    )[kind] || "室內地點"
  );
}

function KindIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  if (kind === "elevator") return <ArrowDownUp size={size} />;
  if (kind === "stairs" || kind === "steps") return <Footprints size={size} />;
  return <DoorOpen size={size} />;
}

function placeForFeature(model: LocalIndoorModel, feature: IndoorFeature) {
  return model.places.find(
    (place) =>
      place.id === feature.id ||
      (feature.connectionId &&
        (place.connectionId === feature.connectionId ||
          place.connectionIds?.includes(feature.connectionId)) &&
        place.levelRef === feature.levelRef) ||
      (place.levelRef === feature.levelRef &&
        ((feature.ref && place.ref === feature.ref) ||
          (feature.name && place.name === feature.name))),
  );
}

function demoRoute(
  connection: IndoorConnection,
  design?: IndoorStairDesign,
): IndoorRoute {
  const points = design?.animationPath ?? connection.coordinates;
  let distanceM = 0;
  for (let index = 1; index < points.length; index++) {
    distanceM += Math.hypot(
      ...points[index].map((value, axis) => value - points[index - 1][axis]),
    );
  }
  return {
    ok: true,
    fromPlaceId: "",
    toPlaceId: "",
    points,
    kinds: points
      .slice(1)
      .map((_, index) =>
        ["platform", "approach"].includes(
          design?.animationSegments[index]?.kind ?? "",
        )
          ? "corridor"
          : "steps",
      ),
    steps: [
      {
        kind: "steps",
        connectionId: connection.id,
        name: design?.name ?? connection.name,
        fromLevel: connection.levelRefs[0],
        toLevel: connection.levelRefs.at(-1) ?? null,
        distanceM,
        startIndex: 0,
        endIndex: points.length - 1,
        heightPending: connection.heightPending,
      },
    ],
    distanceM,
    animationSafe:
      !connection.heightPending && (!design || design.conflicts.length === 0),
    warnings: design?.assumptions ?? [
      "層高、梯段與平台高度為示意；待現場尺寸確認。",
    ],
    edgeIds: [],
  };
}

function StairResearchDetails({ design }: { design: IndoorStairDesign }) {
  return (
    <details className={styles.researchDetails} key={design.id}>
      <summary>研究尺寸與限制</summary>
      <div className={styles.researchBody}>
        <p className={styles.detailLine}>{design.name}</p>
        <dl className={styles.dimensionList}>
          <div>
            <dt>樓梯淨寬</dt>
            <dd>{design.dimensions.flightClearWidthM} m</dd>
          </div>
          <div>
            <dt>各跑階數</dt>
            <dd>{design.dimensions.risers.join("／")} 階</dd>
          </div>
          <div>
            <dt>水平平台</dt>
            <dd>{design.platforms.length} 處</dd>
          </div>
          <div>
            <dt>估計層高</dt>
            <dd>{design.dimensions.floorHeightM} m</dd>
          </div>
        </dl>
        <ul className={styles.researchAssumptions}>
          {design.assumptions.map((assumption) => (
            <li key={assumption}>{assumption}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

export default function IndoorExplorer({
  initialModel,
  onClose,
  embedded = false,
}: {
  initialModel?: LocalIndoorModel;
  onClose?: () => void;
  embedded?: boolean;
}) {
  const router = useRouter();
  const sidebarCollapsed = useMapStore((state) => state.sidebarCollapsed);
  const mapIs3D = useMapStore((state) => state.is3D);
  const indoorPanelOpen = useMapStore((state) => state.indoorPanelOpen);
  const setIndoorPanelOpen = useMapStore((state) => state.setIndoorPanelOpen);
  const setMobileSheetSnap = useMapStore((state) => state.setMobileSheetSnap);
  const [routePlanning, setRoutePlanning] = useState(false);
  const pathname = usePathname();
  const [model, setModel] = useState<LocalIndoorModel | null>(
    initialModel ?? null,
  );
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [activeLevel, setActiveLevel] = useState(0);
  const [view, setView] = useState<"top" | "perspective">("perspective");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<DirectoryCategory>("all");
  const [tab, setTab] = useState<"directory" | "route">("directory");
  const [cameraAction, setCameraAction] = useState<CameraAction>({
    type: "reset",
    nonce: 0,
  });
  const [showLabels, setShowLabels] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [photoId, setPhotoId] = useState("");
  const [showNotes, setShowNotes] = useState(false);
  const [route, setRoute] = useState<IndoorRoute | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [mode, setMode] = useState<IndoorMode>("normal");
  const [verticalPreference, setVerticalPreference] =
    useState<IndoorVerticalPreference>("auto");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [routeError, setRouteError] = useState("");
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [followFloor, setFollowFloor] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(
    () => embedded && typeof window !== "undefined" && window.innerWidth > 760,
  );
  const [stairWidth, setStairWidth] = useState("");
  const [stairRisers, setStairRisers] = useState("");
  const [stairInputError, setStairInputError] = useState("");
  const [collisionCount, setCollisionCount] = useState(0);
  const onGeometryStatus = useCallback((status: { collisionCount: number }) => {
    setCollisionCount(status.collisionCount);
    if (status.collisionCount > 0) setPlaying(false);
  }, []);
  const [stairPreview, setStairPreview] = useState<{
    widthM: number;
    risers: number[];
  }>();

  useEffect(() => {
    if (initialModel) return;
    const controller = new AbortController();
    setLoadError("");
    fetch("/api/local-indoor/", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (response.status === 404)
          throw new Error(
            "尚未啟用本機室內資料。請使用專案的本機室內預覽啟動方式。",
          );
        if (!response.ok)
          throw new Error("室內資料暫時無法載入，請確認本機資料服務後重試。");
        const data = (await response.json()) as LocalIndoorModel;
        if (data.schemaVersion !== 1 || !Array.isArray(data.features))
          throw new Error("室內資料格式不相容，請重新匯出本機模型。");
        setModel(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(
            error instanceof Error ? error.message : "室內模型載入失敗。",
          );
      });
    return () => controller.abort();
  }, [initialModel]);

  // Retry is deliberately separate from the initial mount: it creates a fresh
  // request after the local companion service has been restarted.
  useEffect(() => {
    if (!reload) return;
    const controller = new AbortController();
    setLoadError("");
    fetch("/api/local-indoor/", {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("本機室內資料仍無法載入，請確認資料服務已啟動。");
        const data = (await response.json()) as LocalIndoorModel;
        if (data.schemaVersion !== 1 || !Array.isArray(data.features))
          throw new Error("本機模型格式不相容。");
        setModel(data);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setLoadError(error instanceof Error ? error.message : "載入失敗。");
      });
    return () => controller.abort();
  }, [reload]);

  const close = useCallback(() => {
    setPlaying(false);
    if (onClose) onClose();
    else router.push(`/${pathname.split("/")[1] || "zh-TW"}/`);
  }, [onClose, pathname, router]);

  const availableLevels = useMemo(
    () =>
      [...(model?.building.levels ?? [])].sort((a, b) => a.ordinal - b.ordinal),
    [model],
  );
  const visibleLevels = useMemo(() => [activeLevel], [activeLevel]);
  const selected = model?.features.find((feature) => feature.id === selectedId);
  const selectedConnection = model?.connections.find(
    (connection) =>
      connection.id === selectedId || connection.id === selected?.connectionId,
  );
  const stairDesigns = useMemo(
    () =>
      model?.stairDesigns?.length
        ? model.stairDesigns
        : model?.stairDesign
          ? [model.stairDesign]
          : [],
    [model],
  );
  const selectedStairDesign = stairDesigns.find(
    (design) => design.sourceConnectionId === selectedConnection?.id,
  );
  const selectedPlace =
    selected && model
      ? placeForFeature(model, selected)
      : selectedConnection && model
        ? model.places.find(
            (place) =>
              place.levelRef ===
                availableLevels.find((level) => level.ordinal === activeLevel)
                  ?.ref &&
              (place.connectionId === selectedConnection.id ||
                place.connectionIds?.includes(selectedConnection.id)),
          )
        : undefined;
  const demonstration = model?.connections.find(
    (connection) => connection.id === model.preview?.demoConnectionId,
  );
  const directory = useMemo(() => {
    if (!model) return [];
    const term = query.trim().toLocaleLowerCase();
    return model.features
      .filter((feature) => {
        if (
          feature.ordinal === null ||
          !availableLevels.some((level) => level.ordinal === feature.ordinal)
        )
          return false;
        if (!["room", "elevator", "stairs"].includes(featureKind(feature)))
          return false;
        if (category !== "all" && category !== featureKind(feature))
          return false;
        return (
          !term ||
          `${featureName(feature)} ${feature.ref || ""} ${feature.levelRef ?? ""} ${kindLabel(featureKind(feature))}`
            .toLocaleLowerCase()
            .includes(term)
        );
      })
      .sort(
        (a, b) =>
          (a.ordinal ?? 0) - (b.ordinal ?? 0) ||
          featureName(a).localeCompare(featureName(b), "zh-TW", {
            numeric: true,
          }),
      );
  }, [model, query, category, availableLevels]);

  const routePlaces = useMemo(() => {
    if (!model) return [];
    const allowedRefs = new Set(availableLevels.map((level) => level.ref));
    return model.places
      .filter((place) => place.levelRef && allowedRefs.has(place.levelRef))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-TW", { numeric: true }));
  }, [model, availableLevels]);
  const externalApproach = model?.places.find(
    (place) => place.id === model.preview?.externalApproachPlaceId,
  );
  const fromExternalApproach = Boolean(
    externalApproach && fromId === externalApproach.id,
  );
  const toExternalApproach = Boolean(
    externalApproach && toId === externalApproach.id,
  );
  const journeyStages = [
    {
      title: "室外接續待確認",
      description: toExternalApproach
        ? `路線只到「${externalApproach?.name}」；離館後到公共道路的接續仍未建立。`
        : `尚無公共道路到館外接點的完整路網；本次從「${externalApproach?.name}」開始檢查。`,
    },
    {
      title: "坡道高差待確認",
      description: `沿來源坡道${toExternalApproach ? "出館" : "進館"}，編譯高度相同不代表平地；完整路線暫不播放行進動畫。`,
    },
    {
      title: route && !isDemo ? "室內路線可檢查" : "選擇地點後規劃室內路線",
      description:
        "依樓層、電梯停靠與通行方式規劃，教室門位未知時使用公共走廊接點。",
    },
  ];
  if (toExternalApproach) journeyStages.reverse();

  const presentation = useMemo(
    () =>
      model && route
        ? sampleRoutePresentation(model, route, progress, direction)
        : null,
    [model, route, progress, direction],
  );
  const followedLevel = availableLevels.find(
    (level) => level.ref === presentation?.currentLevelRef,
  );
  const displayedLevel = availableLevels.find(
    (level) => level.ordinal === activeLevel,
  );
  const previewingFloor = Boolean(route && !followFloor);
  const transition = presentation?.transition;
  const arrivalReached = Boolean(
    route && (direction === 1 ? progress >= 1 : progress <= 0),
  );
  const upcomingTransition = route?.steps
    .filter(
      (step) =>
        step.fromLevel && step.toLevel && step.fromLevel !== step.toLevel,
    )
    [direction === 1 ? "find" : "findLast"](
      (step) =>
        (direction === 1 ? step.fromLevel : step.toLevel) ===
        presentation?.currentLevelRef,
    );
  const targetFloorRef =
    transition?.toLevel ??
    (direction === 1
      ? upcomingTransition?.toLevel
      : upcomingTransition?.fromLevel);
  const targetFloor = availableLevels.find(
    (level) => level.ref === targetFloorRef,
  );
  const transitionKind = transition?.kind ?? upcomingTransition?.kind;
  const transitionName = transition?.name ?? upcomingTransition?.name;
  const transitionText = targetFloor
    ? `${transitionKind === "elevator" ? "搭電梯" : targetFloor.ordinal > (followedLevel?.ordinal ?? 0) ? "上樓" : "下樓"}至 ${targetFloor.ref}`
    : null;
  const photos = model?.photos ?? [];
  const photo =
    photos.find((item) => item.id === photoId) ??
    photos.find((item) => item.levelOrdinal === activeLevel) ??
    photos[0];

  useEffect(() => {
    if (!playing || !route?.animationSafe || collisionCount > 0) return;
    let frame = 0;
    let previous: number | undefined;
    const durationMs = Math.max(12000, (route.distanceM / 1.2) * 1000);
    const tick = (now: number) => {
      if (previous !== undefined) {
        const delta = Math.min(now - previous, 100) / durationMs;
        setProgress((value) =>
          Math.max(0, Math.min(1, value + direction * delta)),
        );
      }
      previous = now;
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, route, direction, collisionCount]);

  useEffect(() => {
    if (
      (direction === 1 && progress >= 1) ||
      (direction === -1 && progress <= 0)
    )
      setPlaying(false);
  }, [progress, direction]);

  useEffect(() => {
    if (followFloor && followedLevel) setActiveLevel(followedLevel.ordinal);
  }, [followedLevel, followFloor]);

  const camera = (type: CameraAction["type"]) =>
    setCameraAction((previous) => ({ type, nonce: previous.nonce + 1 }));

  const selectFeature = (id: string) => {
    setPlaying(false);
    setFollowFloor(false);
    if (embedded) {
      setIndoorPanelOpen(true);
      setMobileSheetSnap("half");
    }
    setSelectedId(id);
    setFocusId(id);
    const feature = model?.features.find((item) => item.id === id);
    if (
      feature?.ordinal !== null &&
      feature?.ordinal !== undefined &&
      availableLevels.some((level) => level.ordinal === feature.ordinal) &&
      !visibleLevels.includes(feature.ordinal)
    )
      setActiveLevel(feature.ordinal);
  };

  const resetPlayback = () => {
    setPlaying(false);
    setProgress(0);
    setDirection(1);
  };
  const loadDemo = (
    variant: "design" | "source" = stairPreview ? "source" : "design",
  ) => {
    if (!demonstration) return;
    resetPlayback();
    setRoute(
      demoRoute(
        demonstration,
        variant === "design" ? model?.stairDesign : undefined,
      ),
    );
    setIsDemo(true);
    if (embedded) setIndoorPanelOpen(true);
    setRoutePlanning(false);
    setActiveLevel(
      availableLevels.find((level) => level.ref === demonstration.levelRefs[0])
        ?.ordinal ?? 0,
    );
    setView("perspective");
    setFollowFloor(true);
    setSelectedId(null);
    setFocusId(demonstration.id);
    setSidebarOpen(false);
  };

  const findRoute = () => {
    if (!model) return;
    setRouteError("");
    resetPlayback();
    if (!fromId || !toId) {
      setRouteError("請先選擇起點與目的地。");
      return;
    }
    if (fromId === toId) {
      setRouteError("起點與目的地相同，請選擇另一個地點。");
      return;
    }
    const result = planIndoorRoute(model, fromId, toId, mode, {
      verticalPreference:
        mode === "wheelchair" ? "elevator" : verticalPreference,
    });
    if (!result.ok) {
      setRoute(null);
      setRouteError(
        result.reason === "NO_ACCESSIBLE_ROUTE"
          ? "目前資料中找不到可搭乘電梯的輪椅路線。請更換地點，或確認現場通行條件。"
          : verticalPreference !== "auto"
            ? `目前圖資沒有符合${verticalPreference === "stairs" ? "樓梯" : "電梯"}條件的已知路線，可改為自動選擇或更換地點。`
            : "目前圖資沒有連通這兩個地點的已知路線。",
      );
      return;
    }
    setRoute(result);
    setSelectedId(null);
    setRoutePlanning(false);
    setIsDemo(false);
    const startLevel = availableLevels.find(
      (level) =>
        level.ref ===
        routePlaces.find((place) => place.id === fromId)?.levelRef,
    );
    if (startLevel) setActiveLevel(startLevel.ordinal);
    setFollowFloor(true);
    setFocusId(null);
    camera("reset");
    setSidebarOpen(false);
  };

  const setRouteEndpoint = (place: IndoorPlace, target: "from" | "to") => {
    if (target === "from") setFromId(place.id);
    else {
      setToId(place.id);
      if (!fromId && externalApproach) setFromId(externalApproach.id);
    }
    setRoute(null);
    resetPlayback();
    setTab("route");
    setSidebarOpen(true);
    if (embedded) {
      setIndoorPanelOpen(true);
      setMobileSheetSnap("half");
    }
    setRoutePlanning(true);
    setSelectedId(null);
  };

  const Scene = embedded ? IndoorMapScene : IndoorScene;
  const shellClassName = `${styles.shell} ${embedded ? styles.embedded : ""}`;

  if (!model)
    return (
      <div className={shellClassName}>
        <div className={styles.loadingCard}>
          {loadError ? (
            <CircleHelp size={32} />
          ) : (
            <LoaderCircle size={32} className={styles.spin} />
          )}
          <h1>{loadError ? "室內預覽尚未就緒" : "正在打開室內空間"}</h1>
          <p>{loadError || "載入本機樓層資料與 3D 模型…"}</p>
          {loadError && (
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setReload((value) => value + 1)}
            >
              重新載入
            </button>
          )}
          <button type="button" className={styles.textButton} onClick={close}>
            <ArrowLeft size={16} />
            返回戶外地圖
          </button>
        </div>
      </div>
    );

  const header = (
    <header className={styles.header}>
      <button
        type="button"
        className={styles.backButton}
        onClick={close}
        title={embedded ? "結束室內檢視" : "返回戶外地圖"}
        aria-label={embedded ? "結束室內檢視" : "返回戶外地圖"}
      >
        <ArrowLeft size={19} />
        <span>{embedded ? "結束室內檢視" : "戶外地圖"}</span>
      </button>
      <div className={styles.headerDivider} />
      <div className={styles.buildingIcon}>
        <Building2 size={23} />
      </div>
      <div className={styles.headerTitle}>
        <span className={styles.eyebrow}>
          {embedded ? "室內檢視 · 與戶外地圖連續" : "無障礙智慧地圖 · 室內探索"}
        </span>
        <h1 title={model.name}>{model.name}</h1>
      </div>
      <span className={styles.previewBadge}>
        <span />
        本機建模試作
      </span>
      <button
        type="button"
        className={styles.headerButton}
        aria-label="照片對照"
        onClick={() => setShowPhotos((value) => !value)}
        aria-pressed={showPhotos}
        disabled={!photos.length}
      >
        <ImageIcon size={17} />
        <span>照片對照</span>
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="模型資料與待確認事項"
        onClick={() => setShowNotes((value) => !value)}
      >
        <CircleHelp size={19} />
      </button>
    </header>
  );
  const sidebar = (
    <aside
      className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}
      aria-label="室內搜尋與路線"
    >
      <div className={styles.sidebarTop}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={tab === "directory" ? styles.tabActive : ""}
            onClick={() => setTab("directory")}
          >
            <Search size={16} />
            找地點
          </button>
          <button
            type="button"
            className={tab === "route" ? styles.tabActive : ""}
            onClick={() => setTab("route")}
          >
            <Navigation size={16} />
            室內路線
          </button>
        </div>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.mobileOnly}`}
          aria-label="關閉地點面板"
          onClick={() => setSidebarOpen(false)}
        >
          <X size={18} />
        </button>
      </div>
      {tab === "directory" ? (
        <>
          <div className={styles.searchBox}>
            <Search size={18} />
            <input
              aria-label="搜尋教室、電梯或樓梯"
              placeholder="搜尋教室、電梯或樓梯"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                type="button"
                aria-label="清除搜尋"
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </div>
          <div className={styles.filters}>
            {(
              [
                ["all", "全部"],
                ["room", "教室"],
                ["elevator", "電梯"],
                ["stairs", "樓梯"],
              ] as const
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                aria-pressed={category === value}
                className={category === value ? styles.filterActive : ""}
                onClick={() => setCategory(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className={styles.listHeading}>
            <span>全棟 {availableLevels.length} 層地點目錄</span>
            <span>{directory.length} 個地點</span>
          </div>
          <div className={styles.placeList}>
            {directory.length ? (
              directory.map((feature) => (
                <button
                  type="button"
                  key={feature.id}
                  className={`${styles.placeRow} ${selectedId === feature.id ? styles.placeSelected : ""}`}
                  onClick={() => {
                    selectFeature(feature.id);
                    setSidebarOpen(false);
                  }}
                >
                  <span
                    className={`${styles.placeIcon} ${featureKind(feature) === "elevator" ? styles.elevatorIcon : ""}`}
                  >
                    <KindIcon kind={featureKind(feature)} />
                  </span>
                  <span className={styles.placeText}>
                    <strong>{featureName(feature)}</strong>
                    <span>{kindLabel(featureKind(feature))}</span>
                  </span>
                  <span className={styles.floorTag}>{feature.levelRef}</span>
                  <ChevronRight size={14} />
                </button>
              ))
            ) : (
              <div className={styles.emptyState}>
                <Search size={24} />
                <p>找不到「{query}」</p>
                <span>試試房號，或切換地點類型。</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className={styles.routePanel}>
          <p className={styles.panelIntro}>選擇地點，查看同層或跨樓層路線。</p>
          {externalApproach && (
            <button
              type="button"
              className={styles.outdoorStartButton}
              aria-pressed={fromExternalApproach}
              onClick={() => {
                setFromId(externalApproach.id);
                setRoute(null);
                resetPlayback();
              }}
            >
              <MapPin size={16} />
              從館外已知接點前往
            </button>
          )}
          <label className={styles.fieldLabel} htmlFor="indoor-from">
            起點
          </label>
          <div className={styles.selectWrap}>
            <span className={styles.startDot} />
            <select
              id="indoor-from"
              value={fromId}
              onChange={(event) => {
                setFromId(event.target.value);
                setRoute(null);
                resetPlayback();
              }}
            >
              <option value="">選擇起點</option>
              {externalApproach && (
                <option value={externalApproach.id}>
                  {externalApproach.name}
                </option>
              )}
              {routePlaces.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <button
            type="button"
            className={styles.swapButton}
            aria-label="交換起點與目的地"
            onClick={() => {
              setFromId(toId);
              setToId(fromId);
              setRoute(null);
              resetPlayback();
            }}
          >
            <ArrowDownUp size={16} />
          </button>
          <label className={styles.fieldLabel} htmlFor="indoor-to">
            目的地
          </label>
          <div className={styles.selectWrap}>
            <MapPin size={16} />
            <select
              id="indoor-to"
              value={toId}
              onChange={(event) => {
                setToId(event.target.value);
                setRoute(null);
                resetPlayback();
              }}
            >
              <option value="">選擇目的地</option>
              {externalApproach && (
                <option value={externalApproach.id}>
                  {externalApproach.name}
                </option>
              )}
              {routePlaces.map((place) => (
                <option key={place.id} value={place.id}>
                  {place.name}
                </option>
              ))}
            </select>
            <ChevronDown size={15} />
          </div>
          <div className={styles.modeGroup}>
            {(
              [
                ["normal", "一般步行", Footprints],
                ["wheelchair", "輪椅通行", Accessibility],
              ] as const
            ).map(([value, label, Icon]) => (
              <button
                type="button"
                key={value}
                aria-pressed={mode === value}
                className={mode === value ? styles.modeActive : ""}
                onClick={() => {
                  setMode(value);
                  setRoute(null);
                  resetPlayback();
                }}
              >
                <Icon size={19} />
                {label}
              </button>
            ))}
          </div>
          <label
            className={styles.fieldLabel}
            htmlFor="indoor-vertical-preference"
          >
            跨樓層方式
          </label>
          <div className={styles.selectWrap}>
            <ArrowDownUp size={16} />
            <select
              id="indoor-vertical-preference"
              value={mode === "wheelchair" ? "elevator" : verticalPreference}
              disabled={mode === "wheelchair"}
              onChange={(event) => {
                setVerticalPreference(
                  event.target.value as IndoorVerticalPreference,
                );
                setRoute(null);
                resetPlayback();
              }}
            >
              <option value="auto">自動選擇</option>
              <option value="stairs">使用樓梯</option>
              <option value="elevator">使用電梯</option>
            </select>
            <ChevronDown size={15} />
          </div>
          {mode === "wheelchair" && (
            <p className={styles.routeNotice}>
              輪椅跨樓層固定使用可停靠的電梯。
            </p>
          )}
          <button
            type="button"
            className={`${styles.primaryButton} ${styles.planButton}`}
            onClick={findRoute}
          >
            <Navigation size={16} />
            規劃室內路線
            <ArrowRight size={16} />
          </button>
          {routeError && (
            <p className={styles.errorText} role="alert">
              {routeError}
            </p>
          )}
          <p className={styles.routeNotice}>
            房間門位未確認時，導引至既有公共走廊接點；輪椅模式排除樓梯並依電梯停靠規則規劃，通行條件仍需現場確認。
          </p>
          {(fromExternalApproach || toExternalApproach) && (
            <section
              className={styles.journeyStages}
              aria-label="戶外至室內接續狀態"
            >
              <h2>
                {toExternalApproach
                  ? "室內 → 入口 → 戶外"
                  : "戶外 → 入口 → 室內"}
              </h2>
              <ol>
                {journeyStages.map((stage) => (
                  <li key={stage.title}>
                    <strong>{stage.title}</strong>
                    <p>{stage.description}</p>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {route && !isDemo && (
            <div className={styles.routeResult}>
              <div className={styles.routeSummary}>
                <strong>約 {Math.round(route.distanceM)} m</strong>
                <span>
                  {mode === "wheelchair" ? "輪椅路線" : "步行路線"} ·
                  圖資估計距離
                </span>
              </div>
              <ol className={styles.routeSteps}>
                {route.steps.map((step, index) => (
                  <li key={`${step.startIndex}-${step.endIndex}`}>
                    <span className={styles.stepNumber}>{index + 1}</span>
                    <div>
                      <strong>{step.name || kindLabel(step.kind)}</strong>
                      <span>
                        {step.fromLevel === step.toLevel
                          ? "沿已知通路前進"
                          : `${step.fromLevel ?? "起點樓層"} → ${step.toLevel ?? "目的樓層"}`}{" "}
                        · {Math.round(step.distanceM)} m
                      </span>
                      {step.heightPending && <em>高差待確認</em>}
                    </div>
                  </li>
                ))}
              </ol>
              {route.warnings.map((warning) => (
                <p className={styles.routeNotice} key={warning}>
                  {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
      <div className={styles.sidebarFooter}>
        <span className={styles.localDot} />
        <span>本機圖資 · 樓層幾何待現場驗收</span>
      </div>
    </aside>
  );
  const selection = (selected || selectedConnection) && (
    <div className={styles.selectionCard}>
      <button
        type="button"
        className={styles.selectionClose}
        aria-label="關閉地點詳情"
        onClick={() => setSelectedId(null)}
      >
        <X size={16} />
      </button>
      <div className={styles.selectionHeading}>
        <span className={styles.placeIcon}>
          <KindIcon
            kind={
              selected?.displayKind ??
              selectedConnection?.kind ??
              selected?.kind ??
              "room"
            }
            size={21}
          />
        </span>
        <div>
          <span>
            {selected?.levelRef ? `${selected.levelRef} · ` : ""}
            {kindLabel(
              selected?.displayKind ??
                selectedConnection?.kind ??
                selected?.kind ??
                "room",
            )}
          </span>
          <h2>{selected ? featureName(selected) : selectedConnection?.name}</h2>
        </div>
      </div>
      {(selected?.displayKind === "elevator" ||
        selectedConnection?.kind === "elevator") && (
        <>
          <p className={styles.detailLine}>
            停靠樓層：
            {selectedConnection?.levelRefs.filter(Boolean).join("、") ||
              "停靠資料待確認"}
            （本次模型範圍）
          </p>
          <p className={styles.detailLine}>
            {selectedConnection?.wheelchair === "yes"
              ? "可搭乘輪椅"
              : "輪椅通行狀態依來源資料"}{" "}
            · 井道經過不代表可搭乘
          </p>
          {selected?.levelRef &&
            selectedConnection &&
            !selectedConnection.levelRefs.includes(selected.levelRef) && (
              <p className={styles.errorText}>
                此電梯在 {selected.levelRef} 不停靠，請改搭其他電梯。
              </p>
            )}
        </>
      )}
      {(selected?.displayKind === "stairs" ||
        selectedConnection?.kind === "stairs" ||
        selectedConnection?.kind === "steps") && (
        <p className={styles.detailLine}>
          {embedded
            ? "樓梯不供輪椅通行，無障礙路線請使用電梯。"
            : "位置依來源圖資；梯寬、平台邊界與高度仍待確認。樓梯不供輪椅通行。"}
        </p>
      )}
      {!embedded && selectedStairDesign && (
        <>
          <p className={styles.researchStatus}>實體梯段研究版，尺寸未實測</p>
          <StairResearchDetails design={selectedStairDesign} />
        </>
      )}
      {selected?.kind === "room" && (
        <p className={styles.detailLine}>
          {selectedPlace?.doorKnown
            ? "依既有門位與通路導引。"
            : "門位尚未確認，路線到達公共走廊接點。"}
        </p>
      )}
      {selectedPlace && (
        <div className={styles.selectionActions}>
          <button
            type="button"
            onClick={() => setRouteEndpoint(selectedPlace, "from")}
          >
            設為起點
          </button>
          <button
            type="button"
            onClick={() => setRouteEndpoint(selectedPlace, "to")}
          >
            <Navigation size={14} />
            前往這裡
          </button>
        </div>
      )}
    </div>
  );
  const player = (
    <footer className={styles.player} data-has-route={Boolean(route)}>
      <div className={styles.playerIntro}>
        <span className={styles.playerIcon}>
          <Footprints size={22} />
        </span>
        <div>
          <strong>
            {isDemo && demonstration
              ? embedded
                ? "樓梯導引示範"
                : model.stairDesign && !stairPreview
                  ? "A梯間尺寸假設版・待現場驗收"
                  : demonstration.name
              : route
                ? `${model.places.find((place) => place.id === route.fromPlaceId)?.name ?? "起點"} → ${model.places.find((place) => place.id === route.toPlaceId)?.name ?? "終點"}`
                : "探索樓層之間的連接"}
          </strong>
          <span>
            {route
              ? `${Math.round(route.distanceM)} m · ${embedded ? "單層平面導引" : isDemo ? (stairPreview ? "使用者輸入尺寸的梯段示意" : model.stairDesign ? "沿踏面與水平平台的連續路徑" : "實體梯段待確認，目前播放中心線檢查") : "路線預演 · 沿已知通路"}`
              : "選擇地點規劃路線，或開啟樓梯中心線檢查"}
          </span>
        </div>
      </div>
      {route ? (
        <div className={styles.playback}>
          <button
            type="button"
            className={styles.playButton}
            aria-label={playing ? "暫停行進動畫" : "播放行進動畫"}
            disabled={!route.animationSafe || collisionCount > 0}
            onClick={() => {
              if (
                (direction === 1 && progress >= 1) ||
                (direction === -1 && progress <= 0)
              )
                setProgress(direction === 1 ? 0 : 1);
              setFollowFloor(true);
              setPlaying((value) => !value);
            }}
          >
            {playing ? (
              <Pause size={20} fill="currentColor" />
            ) : (
              <Play size={20} fill="currentColor" />
            )}
          </button>
          <button
            type="button"
            className={styles.reverseButton}
            aria-label="反向行進"
            title="反向走同一路徑"
            onClick={() => {
              const nextDirection = direction === 1 ? -1 : 1;
              setFollowFloor(true);
              setDirection(nextDirection);
              if (nextDirection === -1 && progress === 0) setProgress(1);
              else if (nextDirection === 1 && progress === 1) setProgress(0);
            }}
          >
            <ArrowDownUp size={17} />
            <span>{direction === 1 ? "正向" : "反向"}</span>
          </button>
          <div className={styles.progressWrap}>
            <div>
              <span>{direction === 1 ? "起點 → 終點" : "終點 → 起點"}</span>
              <span>{Math.round(progress * 100)}%</span>
            </div>
            <input
              aria-label="行進動畫進度"
              type="range"
              min="0"
              max="1"
              step="0.001"
              value={progress}
              disabled={!route.animationSafe || collisionCount > 0}
              onChange={(event) => {
                setPlaying(false);
                setFollowFloor(true);
                setProgress(Number(event.target.value));
              }}
            />
          </div>
          <div className={styles.currentFloor}>
            {displayedLevel?.ref}
            {transition && <span>換層中</span>}
          </div>
          <label className={styles.followLabel}>
            <input
              type="checkbox"
              checked={followFloor}
              onChange={(event) => {
                setFollowFloor(event.target.checked);
                if (!event.target.checked) setPlaying(false);
              }}
            />
            跟隨樓層
          </label>
        </div>
      ) : (
        <div className={styles.playerPlaceholder}>
          <span>{demonstration?.levelRefs[0] ?? availableLevels[0]?.ref}</span>
          <span className={styles.floorConnection} />
          <span>
            {demonstration?.levelRefs.at(-1) ?? availableLevels[1]?.ref}
          </span>
        </div>
      )}
      {demonstration && (!embedded || isDemo) && (
        <button
          type="button"
          className={styles.demoButton}
          onClick={() => loadDemo()}
        >
          {isDemo ? "重設樓梯示範" : "樓梯上下樓示範"}
          <ArrowRight size={16} />
        </button>
      )}
      {route && !route.animationSafe && (
        <span className={styles.animationWarning}>
          路線含未確認高差或實體梯面，暫不播放。
        </span>
      )}
    </footer>
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: This boundary only stops map gestures; each child control owns its keyboard-accessible action.
    <div
      className={shellClassName}
      data-testid="indoor-explorer"
      data-embedded={embedded ? "true" : "false"}
      data-panel-collapsed={sidebarCollapsed ? "true" : "false"}
      onClick={embedded ? (event) => event.stopPropagation() : undefined}
      onMouseDown={embedded ? (event) => event.stopPropagation() : undefined}
      onTouchStart={embedded ? (event) => event.stopPropagation() : undefined}
      onWheel={embedded ? (event) => event.stopPropagation() : undefined}
    >
      {!embedded && header}
      {embedded && (
        <IndoorPanelPortal>
          <div
            className={`${styles.shell} ${styles.panelContent}`}
            data-testid="indoor-panel-content"
          >
            {header}
            {route && player}
            {selection}
            {route && !routePlanning ? (
              <div className={styles.routeActions}>
                <button
                  type="button"
                  onClick={() => {
                    setRoutePlanning(true);
                    setTab("route");
                    setMobileSheetSnap("half");
                  }}
                >
                  <Navigation size={15} /> 調整路線
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRoute(null);
                    resetPlayback();
                    setSelectedId(null);
                  }}
                >
                  <X size={15} /> 結束路線
                </button>
              </div>
            ) : selected || selectedConnection ? (
              <div className={styles.routeActions}>
                <button type="button" onClick={() => setSelectedId(null)}>
                  <ArrowLeft size={15} /> 返回室內搜尋
                </button>
              </div>
            ) : (
              sidebar
            )}
            {!route && (
              <div className={styles.panelDemo}>
                <button
                  type="button"
                  onClick={() => loadDemo()}
                  disabled={!demonstration}
                >
                  <Footprints size={16} /> 樓梯上下樓示範
                </button>
              </div>
            )}
          </div>
        </IndoorPanelPortal>
      )}

      <div className={styles.workspace}>
        {!embedded && sidebar}

        <section className={styles.viewport} aria-label="互動式室內 3D 模型">
          <Scene
            model={model}
            visibleLevels={visibleLevels}
            view={embedded ? (mapIs3D ? "perspective" : "top") : view}
            selectedId={selectedId}
            onSelect={selectFeature}
            route={route}
            progress={progress}
            exploded={false}
            routeDirection={direction}
            focusId={focusId}
            cameraAction={cameraAction}
            showLabels={showLabels}
            stairPreview={stairPreview}
            onGeometryStatus={onGeometryStatus}
            onOverviewExit={embedded ? close : undefined}
          />
          {!embedded && (
            <div className={styles.viewportTop}>
              <div className={styles.viewTabs}>
                <button
                  type="button"
                  aria-pressed={view === "perspective"}
                  className={view === "perspective" ? styles.viewActive : ""}
                  onClick={() => setView("perspective")}
                >
                  <Box size={16} />
                  立體
                </button>
                <button
                  type="button"
                  aria-pressed={view === "top"}
                  className={view === "top" ? styles.viewActive : ""}
                  onClick={() => setView("top")}
                >
                  <Layers3 size={16} />
                  俯視
                </button>
              </div>
              <span className={styles.viewCaption}>
                {displayedLevel?.ref} <span> / </span> 建築剖視
              </span>
            </div>
          )}
          <button
            type="button"
            className={styles.mobileSearch}
            onClick={() => {
              if (embedded) {
                setIndoorPanelOpen(true);
                setMobileSheetSnap("half");
              } else setSidebarOpen(true);
            }}
            aria-expanded={
              embedded ? indoorPanelOpen && !sidebarCollapsed : sidebarOpen
            }
          >
            <Search size={17} />
            {embedded
              ? `${model.building.name} · ${displayedLevel?.ref ?? ""}`
              : "搜尋地點與路線"}
          </button>
          {route && (
            <section
              className={styles.transitionCard}
              aria-label="樓層導引"
              data-testid="indoor-floor-guidance"
            >
              <div aria-live="polite" aria-atomic="true">
                <span>
                  {previewingFloor
                    ? `正在預覽 ${displayedLevel?.ref}`
                    : `目前 ${displayedLevel?.ref}`}
                </span>
                <strong>
                  {previewingFloor
                    ? "已暫停路線預演"
                    : arrivalReached
                      ? "已抵達路線終點"
                      : (transitionText ?? "沿本層路線前進")}
                </strong>
                {!previewingFloor && transitionName && !arrivalReached && (
                  <small>{transitionName}</small>
                )}
              </div>
              {previewingFloor ? (
                <button
                  type="button"
                  onClick={() => {
                    setFollowFloor(true);
                    setFocusId(null);
                    camera("reset");
                  }}
                >
                  回到導引樓層
                </button>
              ) : targetFloor && !arrivalReached ? (
                <button
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setFollowFloor(false);
                    setActiveLevel(targetFloor.ordinal);
                  }}
                >
                  預覽 {targetFloor.ref} <ChevronRight size={14} />
                </button>
              ) : null}
            </section>
          )}
          <div
            className={styles.floorControls}
            role="toolbar"
            aria-label="樓層切換"
          >
            <span>樓層</span>
            {[...model.building.levels]
              .sort((a, b) => b.ordinal - a.ordinal)
              .map((level) => (
                <button
                  type="button"
                  key={level.ref}
                  title={`顯示 ${level.ref} · 來源格局，尺寸待現場驗收`}
                  aria-pressed={visibleLevels.includes(level.ordinal)}
                  className={
                    visibleLevels.includes(level.ordinal)
                      ? styles.floorActive
                      : ""
                  }
                  onClick={() => {
                    setActiveLevel(level.ordinal);
                    setPlaying(false);
                    setFollowFloor(false);
                  }}
                >
                  {level.ref}
                </button>
              ))}
          </div>
          {!embedded && (
            <div
              className={styles.cameraControls}
              role="toolbar"
              aria-label="視角控制"
            >
              <button
                type="button"
                aria-label="放大模型"
                onClick={() => camera("zoomIn")}
              >
                <Plus size={19} />
              </button>
              <button
                type="button"
                aria-label="縮小模型"
                onClick={() => camera("zoomOut")}
              >
                <Minus size={19} />
              </button>
              <div className={styles.controlDivider} />
              <button
                type="button"
                aria-label="旋轉模型"
                onClick={() => camera("rotate")}
              >
                <RotateCw size={18} />
              </button>
              <button
                type="button"
                aria-label="重設視角"
                onClick={() => {
                  setFocusId(null);
                  camera("reset");
                }}
              >
                <RotateCcw size={17} />
              </button>
              <button
                type="button"
                aria-label="顯示設定"
                aria-pressed={showSettings}
                onClick={() => setShowSettings((value) => !value)}
              >
                <SlidersHorizontal size={17} />
              </button>
            </div>
          )}
          {showSettings && (
            <div className={styles.settings}>
              <strong>顯示設定</strong>
              <label>
                <input
                  type="checkbox"
                  checked={showLabels}
                  onChange={(event) => setShowLabels(event.target.checked)}
                />
                房號與設施標籤
              </label>
              <p>每次只顯示一層；路線中僅標示起點與終點教室。</p>
            </div>
          )}
          {!embedded && !stairPreview && collisionCount === 0 && (
            <button
              type="button"
              className={styles.designBadge}
              onClick={() => setShowNotes(true)}
            >
              <CircleHelp size={13} />
              {stairDesigns.length > 1
                ? "樓梯尺寸研究版・待現場驗收"
                : model.stairDesign &&
                    availableLevels.some(
                      (level) =>
                        visibleLevels.includes(level.ordinal) &&
                        demonstration?.levelRefs.includes(level.ref),
                    )
                  ? "A梯間尺寸假設版・待現場驗收"
                  : "來源樓層格局・尺寸待現場驗收"}
            </button>
          )}
          {collisionCount > 0 && (
            <div className={styles.explodedNotice}>
              與房間重疊 {collisionCount} 處；請修正來源或確認尺寸。動畫已暫停。
            </div>
          )}
          {!embedded && selection}

          {showPhotos && photo && (
            <section className={styles.photoPanel} aria-label="來源照片對照">
              <div className={styles.photoHeader}>
                <ImageIcon size={17} />
                <strong>來源照片對照</strong>
                <button
                  type="button"
                  aria-label="關閉照片對照"
                  onClick={() => setShowPhotos(false)}
                >
                  <X size={18} />
                </button>
              </div>
              <select
                aria-label="選擇來源照片"
                value={photo.id}
                onChange={(event) => setPhotoId(event.target.value)}
              >
                {photos.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
              {/* biome-ignore lint/performance/noImgElement: Private local photos are served by the development companion, without Next image caching. */}
              <img src={photo.url} alt={photo.label} />
              <p>照片方向可能不同；以房號、電梯與廁所對位。照片保留於本機。</p>
            </section>
          )}

          <div className={styles.viewportBottom}>
            <div className={styles.legend}>
              <span>
                <i className={styles.roomSwatch} />
                室內空間
              </span>
              <span>
                <i className={styles.corridorSwatch} />
                公共走廊
              </span>
              <span>
                <i className={styles.elevatorSwatch} />
                電梯
              </span>
              <span>
                <i className={styles.stairsSwatch} />
                樓梯
              </span>
            </div>
            <span className={styles.gestureHint}>
              {embedded
                ? "拖曳地圖 · 右鍵／雙指旋轉 · 點選空間"
                : "拖曳旋轉 · 滾輪縮放 · 點選空間"}
            </span>
          </div>
        </section>
      </div>

      {!embedded && player}

      {showNotes && (
        <div className={styles.notesBackdrop}>
          <section
            className={styles.notesPanel}
            aria-label="模型資料與待確認事項"
          >
            <button
              type="button"
              className={styles.selectionClose}
              aria-label="關閉模型說明"
              onClick={() => setShowNotes(false)}
            >
              <X size={20} />
            </button>
            <span className={styles.eyebrow}>本機室內建模試作</span>
            <h2>看得見空間，也保留資料的不確定性</h2>
            <p>
              可切換全部 {availableLevels.length}{" "}
              層，保留各層來源格局與地點差異；首兩層優先驗收，其餘樓層仍待逐層核對。搜尋與導引一次只顯示一層，抵達換層出口後再切換樓層。
            </p>
            <div className={styles.noteItem}>
              <strong>
                層高 {model.building.floorHeightM} m ·{" "}
                {model.building.heightStatus === "estimated"
                  ? "估計"
                  : model.building.heightStatus}
              </strong>
              <p>全棟共用公尺座標與等比例高度，各層保持實際相對位置。</p>
            </div>
            <div className={styles.noteItem}>
              <strong>樓梯仍為示意模型</strong>
              <p>
                梯寬、階數、平台邊界、平台高度與部分上樓方向尚未實測，不能視為現場定稿。
              </p>
            </div>
            {stairDesigns.length > 0 && (
              <div className={styles.noteItem}>
                <strong>{stairDesigns.length} 段樓梯實體研究模型</strong>
                <p>
                  每段依對應的來源樓梯與上下層接點建立，保留各段差異。淨寬、階數、平台邊界與高度均未實測；選取樓梯可展開「研究尺寸與限制」。研究模型不代表現場或法規驗收完成。
                </p>
                <details className={styles.researchDetails}>
                  <summary>檢視各段樓梯與樓層</summary>
                  <ul
                    className={`${styles.researchAssumptions} ${styles.researchBody}`}
                  >
                    {stairDesigns.map((design) => (
                      <li key={design.id}>{design.name} · 尺寸未實測</li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
            <div className={styles.noteItem}>
              <strong>室內導航的範圍</strong>
              <p>
                僅使用本機已知路網與電梯停靠規則。房間未知門位不補開門洞；無即時室內定位，動畫僅供路線預演。
              </p>
            </div>
            {model.stairDesign && (
              <div className={styles.noteItem}>
                <strong>A梯間尺寸假設版・待現場驗收</strong>
                <dl className={styles.dimensionList}>
                  {model.stairDesign.dimensions.carInsideM && (
                    <div>
                      <dt>參考車廂內尺寸</dt>
                      <dd>
                        {model.stairDesign.dimensions.carInsideM.width} ×{" "}
                        {model.stairDesign.dimensions.carInsideM.depth} m
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>樓梯淨寬</dt>
                    <dd>{model.stairDesign.dimensions.flightClearWidthM} m</dd>
                  </div>
                  <div>
                    <dt>階數／踢面高度</dt>
                    <dd>
                      {model.stairDesign.dimensions.risers.reduce(
                        (sum, count) => sum + count,
                        0,
                      )}{" "}
                      階 × {model.stairDesign.dimensions.riserHeightM} m
                    </dd>
                  </div>
                  <div>
                    <dt>轉角平台</dt>
                    <dd>
                      {model.stairDesign.dimensions.platformM.join(" × ")} m
                    </dd>
                  </div>
                </dl>
                <p>
                  這組尺寸是為本次空間檢查建立的假設，引用資料不代表現場電梯品牌、實測尺寸或已通過法規驗收。
                </p>
                {model.stairDesign.assumptions.map((assumption) => (
                  <p key={assumption}>{assumption}</p>
                ))}
                <ul className={styles.designSources}>
                  {model.stairDesign.sources.map((source) => (
                    <li key={source.url}>
                      <a href={source.url} target="_blank" rel="noreferrer">
                        {source.title}
                      </a>
                      <span>{source.usedFor}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <details className={styles.schematicForm}>
              <summary>示意幾何參數（選填）</summary>
              <p>
                {model.stairDesign
                  ? "目前使用研究尺寸建立的假設版。此工具可另外檢查原始中心線套上自訂梯寬的衝突，不會修改主圖資。"
                  : "目前缺少實測尺寸，預設只播放樓梯中心線。"}
                請輸入你確認或允許估計的梯寬與各跑階數；套用後仍為示意，並非現場定稿。
              </p>
              <label htmlFor="indoor-stair-width">
                梯寬（公尺）
                <input
                  id="indoor-stair-width"
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.05"
                  placeholder="未知，先留白"
                  value={stairWidth}
                  onChange={(event) => setStairWidth(event.target.value)}
                />
              </label>
              <label htmlFor="indoor-stair-risers">
                下側、右側、上側各跑階數
                <input
                  id="indoor-stair-risers"
                  placeholder="依序輸入，以逗號分隔"
                  value={stairRisers}
                  onChange={(event) => setStairRisers(event.target.value)}
                />
              </label>
              {stairInputError && (
                <p className={styles.errorText} role="alert">
                  {stairInputError}
                </p>
              )}
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => {
                  const widthM = Number(stairWidth);
                  const risers = stairRisers
                    .split(/[,，、\s]+/)
                    .filter(Boolean)
                    .map(Number);
                  if (
                    !Number.isFinite(widthM) ||
                    widthM <= 0 ||
                    widthM > 5 ||
                    risers.length !== 3 ||
                    risers.some(
                      (value) =>
                        !Number.isInteger(value) || value < 1 || value > 50,
                    )
                  ) {
                    setStairInputError(
                      "請提供有效梯寬（0–5 m）及三個 1–50 的整數階數。",
                    );
                    return;
                  }
                  setStairInputError("");
                  setStairPreview({ widthM, risers });
                  setShowNotes(false);
                  loadDemo("source");
                }}
              >
                以這組尺寸查看示意
              </button>
              {stairPreview && (
                <button
                  type="button"
                  className={styles.textButton}
                  onClick={() => {
                    setStairPreview(undefined);
                    setStairWidth("");
                    setStairRisers("");
                    loadDemo("design");
                  }}
                >
                  {model.stairDesign
                    ? "清除自訂尺寸，回到假設版"
                    : "清除尺寸，回到中心線檢查"}
                </button>
              )}
            </details>
            {model.source.warnings.map((warning) => (
              <p className={styles.sourceWarning} key={warning}>
                {warning}
              </p>
            ))}
            <p className={styles.sourceFootnote}>
              來源版本 {model.source.sha256.slice(0, 12)} · 本機匯出時間{" "}
              {new Date(model.source.generatedAt).toLocaleString("zh-TW")}
            </p>
            <button
              type="button"
              className={styles.primaryButton}
              onClick={() => setShowNotes(false)}
            >
              回到模型
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
