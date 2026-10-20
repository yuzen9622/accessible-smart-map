"use client";

import { type CustomLayerInterface, LngLat } from "maplibre-gl";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import * as THREE from "three";
import { venueBuildingKey } from "@/lib/indoor/catalog";
import { lngLatToLocal, localToLngLat } from "@/lib/indoor/coordinates";
import { getIndoorPalette, type IndoorTheme } from "@/lib/indoor/indoorTheme";
import { mountIndoorBuildingMask } from "@/lib/indoor/mapBuildingShell";
import {
  getIndoorExitZoom,
  shouldLeaveIndoor,
} from "@/lib/indoor/mapExperience";
import { registerIndoorPicker } from "@/lib/indoor/mapInteraction";
import {
  groundFloorModelMatrix,
  mapPixelRay,
  updateIndoorMapCamera,
} from "@/lib/indoor/mapProjection";
import {
  buildingSceneProps,
  indoorBuildingViews,
  indoorSceneModelsKey,
} from "@/lib/indoor/mapSceneViews";
import {
  fitIndoorOverviewZoom,
  projectIndoorOverviewAtZoom,
} from "@/lib/indoor/overviewFit";
import {
  createIndoorContent,
  disposeTree,
  type IndoorContentState,
  indoorActiveSpanKey,
  indoorDisplayLevel,
  rebuildIndoorContent,
  rebuildIndoorRoute,
  rebuildIndoorRouteSegments,
  updateCampusTourMarker,
  updateIndoorLabels,
  updateIndoorMarker,
  updateIndoorOverlayScale,
  updateIndoorRouteFlow,
  updateIndoorTheme,
  v3,
} from "@/lib/indoor/sceneContent";
import type { IndoorSceneProps } from "@/lib/indoor/sceneTypes";
import type { XYZ } from "@/lib/indoor/types";
import useMapStore from "@/stores/useMapStore";

const LAYER_ID = "local-indoor-cutaway";
interface BuildingSceneState extends IndoorContentState {
  key: string;
  props: IndoorSceneProps;
  host: HTMLDivElement;
  scene: THREE.Scene;
  camera: THREE.Camera;
  inverseMapProjection: THREE.Matrix4;
  ambient: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  geometryKey: string;
  shadowDirty: boolean;
}
interface MapSceneState {
  buildings: Map<string, BuildingSceneState>;
  renderer: THREE.WebGLRenderer;
  shadowTarget: THREE.WebGLRenderTarget;
  campus: IndoorContentState;
  campusScene: THREE.Scene;
  campusCamera: THREE.Camera;
  campusSegmentsKey: string;
  campusTour: boolean | undefined;
  campusOrigin: string;
  flowSeconds: number;
  frameAt: number;
}

function updateBuildingTheme(s: BuildingSceneState, p: IndoorSceneProps) {
  updateIndoorTheme(s, p);
  const lighting = getIndoorPalette(p.theme).lighting;
  s.ambient.color.setHex(lighting.hemisphereSky);
  s.ambient.groundColor.setHex(lighting.hemisphereGround);
  s.ambient.intensity = lighting.hemisphereIntensity;
  s.sun.color.setHex(lighting.directionalColor);
  s.sun.intensity = lighting.directionalIntensity;
}
function createBuildingScene(
  key: string,
  p: IndoorSceneProps,
  container: HTMLDivElement,
): BuildingSceneState {
  const scene = new THREE.Scene();
  const ambient = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  const bounds = new THREE.Box3().setFromPoints(
    p.model.building.footprint
      .flat()
      .map((point) => v3([point[0], point[1], 0])),
  );
  const center = bounds.getCenter(new THREE.Vector3());
  sun.position.copy(center).add(new THREE.Vector3(-35, 65, 20));
  sun.target.position.copy(center);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -80,
    right: 80,
    top: 80,
    bottom: -80,
    near: 0.1,
    far: 180,
  });
  sun.shadow.normalBias = 0.04;
  sun.shadow.bias = -0.00025;
  const content = createIndoorContent();
  scene.add(
    ambient,
    sun,
    sun.target,
    content.content,
    content.routeGroup,
    content.marker,
  );
  const host = document.createElement("div");
  host.dataset.buildingKey = key;
  host.style.cssText = "position:absolute;inset:0;pointer-events:none";
  container.appendChild(host);
  const s: BuildingSceneState = {
    ...content,
    key,
    props: p,
    host,
    scene,
    ambient,
    sun,
    camera: new THREE.PerspectiveCamera(),
    inverseMapProjection: new THREE.Matrix4(),
    geometryKey: "",
    shadowDirty: true,
  };
  s.camera.matrixAutoUpdate = false;
  s.camera.matrixWorldAutoUpdate = false;
  updateBuildingTheme(s, p);
  return s;
}
function disposeBuilding(s: BuildingSceneState) {
  disposeTree(s.scene);
  s.host.remove();
}
function synchronizeBuildings(
  state: MapSceneState,
  container: HTMLDivElement,
  p: IndoorSceneProps,
  onSelect: (key: string, id: string) => void,
) {
  const views = indoorBuildingViews(p);
  const keys = new Set(views.map((view) => view.key));
  for (const [key, building] of state.buildings)
    if (!keys.has(key)) {
      disposeBuilding(building);
      state.buildings.delete(key);
    }
  for (const view of views) {
    const local = buildingSceneProps(p, view);
    let building = state.buildings.get(view.key);
    if (!building) {
      building = createBuildingScene(view.key, local, container);
      state.buildings.set(view.key, building);
    }
    const geometryKey = JSON.stringify([
      local.visibleLevels,
      indoorActiveSpanKey(local),
      local.stairPreview,
    ]);
    const rebuild =
      building.geometryKey !== geometryKey ||
      building.props.model !== local.model;
    const previous = building.props;
    const routeChanged =
      building.props.route !== local.route ||
      building.props.routeTour !== local.routeTour;
    building.props = local;
    if (rebuild) {
      rebuildIndoorContent(building, building.host, local, (id) =>
        onSelect(view.key, id),
      );
      building.geometryKey = geometryKey;
      building.shadowDirty = true;
    }
    if (rebuild || routeChanged) rebuildIndoorRoute(building, local);
    if (routeChanged) updateIndoorLabels(building, local);
    updateIndoorMarker(building, building.host, local);
    if (
      rebuild ||
      routeChanged ||
      previous.selectedId !== local.selectedId ||
      previous.theme !== local.theme
    )
      updateBuildingTheme(building, local);
  }
  const origin = JSON.stringify(p.model.origin);
  const campusSegmentsKey = JSON.stringify(p.campusRouteSegments ?? []);
  if (
    state.campusSegmentsKey !== campusSegmentsKey ||
    state.campusTour !== p.routeTour ||
    state.campusOrigin !== origin
  ) {
    // Campus segments have their own main-model frame and are presented at map
    // ground. Source XYZ and individual segment boundaries remain untouched.
    rebuildIndoorRouteSegments(
      state.campus,
      { ...p, grounded: true },
      (p.campusRouteSegments ?? []).map((segment) => {
        const [a, b] = Array.isArray(segment) ? segment : segment.coordinates;
        const coordinates: [XYZ, XYZ] = [
          [a[0], a[1], 0],
          [b[0], b[1], 0],
        ];
        return Array.isArray(segment)
          ? coordinates
          : { ...segment, coordinates };
      }),
    );
    state.campusSegmentsKey = campusSegmentsKey;
    state.campusTour = p.routeTour;
    state.campusOrigin = origin;
  }
  updateIndoorTheme(state.campus, p);
  updateCampusTourMarker(state.campus, container, p);
  state.renderer.toneMappingExposure = getIndoorPalette(
    p.theme,
  ).lighting.exposure;
}
function duration(ms: number) {
  return document.hidden ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : ms;
}

function indoorMapPadding(canvas: HTMLCanvasElement) {
  const store = useMapStore.getState();
  if (canvas.clientWidth >= 1024)
    return {
      left: store.sidebarCollapsed ? 90 : 470,
      right: 80,
      top: 150,
      bottom: 60,
    };
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue("--bottom-sheet-h")
    .trim();
  const value = Number.parseFloat(raw);
  const fallback = store.mobileSheetSnap === "peek" ? 0.12 : 0.38;
  const sheetHeight = Number.isFinite(value)
    ? raw.endsWith("vh")
      ? (value / 100) * (window.visualViewport?.height ?? window.innerHeight)
      : value
    : canvas.clientHeight * fallback;
  return { left: 65, right: 75, top: 160, bottom: sheetHeight + 24 };
}

/** One canvas, one geographic camera. This component owns only its custom layer. */
export default function IndoorMapScene(props: IndoorSceneProps) {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap();
  const { resolvedTheme } = useTheme();
  const theme: IndoorTheme = resolvedTheme === "dark" ? "dark" : "light";
  const palette = getIndoorPalette(theme);
  const latest = useRef<IndoorSceneProps>({ ...props, grounded: true, theme });
  latest.current = { ...props, grounded: true, theme };
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<MapSceneState | null>(null);
  const [error, setError] = useState("");
  const { model } = props;
  const modelsKey = indoorSceneModelsKey(props);
  const views = indoorBuildingViews(props);
  const levelsKey = JSON.stringify(
    views.map((view) => [view.key, view.levelOrdinal]),
  );
  const maskKey = JSON.stringify(
    views.filter((view) => view.levelOrdinal !== null).map((view) => view.key),
  );
  const lastView = useRef(props.view);
  const overview = useRef({
    entryZoom: null as number | null,
    entering: true,
    leaving: false,
  });

  useEffect(() => {
    if (!map) return;
    const clamped = map.getCenterClampedToGround();
    const elevation = map.getCenterElevation();
    const padding = map.getPadding();
    overview.current.leaving = false;
    map.setCenterClampedToGround(false);
    return () => {
      overview.current.leaving = true;
      map.setCenterClampedToGround(clamped);
      // Keep the user's current centre, zoom and bearing after zooming out.
      // A manual 2D toggle must finish flat even if its animation is interrupted
      // by this elevation/padding reset. Do not restore an old camera or mode.
      map.jumpTo({
        elevation,
        padding,
        ...(!useMapStore.getState().is3D ? { pitch: 0 } : {}),
      });
    };
  }, [map]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Mask only changes with displayed model identities, not animation or focus.
  useEffect(() => {
    if (!map) return;
    const visible = indoorBuildingViews(latest.current).filter(
      (view) =>
        view.levelOrdinal !== null &&
        view.model.building.levels.some(
          (level) => level.ordinal === view.levelOrdinal,
        ),
    );
    return mountIndoorBuildingMask(
      map,
      visible.map((view) => view.model),
    );
  }, [map, modelsKey, maskKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: One layer survives active-building, floor, theme and route progress changes.
  useEffect(() => {
    if (!map || !host.current) return;
    const container = host.current;
    const labelLeaders = new WeakMap<HTMLButtonElement, HTMLSpanElement>();
    let disposed = false;
    const select = (buildingKey: string, featureId: string) => {
      if (latest.current.onSelectBuildingFeature)
        latest.current.onSelectBuildingFeature({ buildingKey, featureId });
      else latest.current.onSelect(featureId);
    };
    const createLayer = (): CustomLayerInterface => {
      let layerState: MapSceneState | null = null;
      return {
        id: LAYER_ID,
        type: "custom",
        renderingMode: "3d",
        onAdd(_map, gl) {
          const renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl as WebGL2RenderingContext,
          });
          renderer.autoClear = false;
          renderer.localClippingEnabled = true;
          renderer.shadowMap.enabled = true;
          renderer.shadowMap.autoUpdate = false;
          renderer.shadowMap.type = THREE.PCFShadowMap;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          const campus = createIndoorContent();
          const campusScene = new THREE.Scene();
          campusScene.add(
            campus.routeGroup,
            campus.marker,
            new THREE.HemisphereLight(0xffffff, 0xffffff, 2),
          );
          const s: MapSceneState = {
            buildings: new Map(),
            renderer,
            shadowTarget: new THREE.WebGLRenderTarget(1, 1),
            campus,
            campusScene,
            campusCamera: new THREE.PerspectiveCamera(),
            campusSegmentsKey: "",
            campusTour: undefined,
            campusOrigin: "",
            flowSeconds: 0,
            frameAt: 0,
          };
          layerState = s;
          state.current = s;
          synchronizeBuildings(s, container, latest.current, select);
          setError("");
        },
        render(_gl, args) {
          const s = layerState;
          if (!s || disposed) return;
          const p = latest.current;
          const currentPalette = getIndoorPalette(p.theme);
          const now = performance.now();
          const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          if (p.routePlaying && !reduced && s.frameAt)
            s.flowSeconds += Math.min(
              0.1,
              Math.max(0, (now - s.frameAt) / 1000),
            );
          s.frameAt = now;
          const depthRange = _gl.getParameter(_gl.DEPTH_RANGE) as Float32Array;
          const rendered = [...s.buildings.values()].filter((building) =>
            indoorDisplayLevel(building.props),
          );
          let triangles = 0;
          // All architectural geometry is rendered first, in each source ENU
          // frame, through the same geographic MapLibre camera and GL context.
          for (const building of rendered) {
            const floor = indoorDisplayLevel(building.props);
            if (!floor) continue;
            const matrix = groundFloorModelMatrix(
              new THREE.Matrix4().fromArray(
                map.transform.getMatrixForModel(building.props.model.origin, 0),
              ),
              floor.elevationM,
            );
            const combined = new THREE.Matrix4()
              .fromArray(args.defaultProjectionData.mainMatrix)
              .multiply(matrix);
            building.inverseMapProjection = updateIndoorMapCamera(
              building.camera,
              args.projectionMatrix,
              combined,
            );
            const markerVisible = building.marker.visible;
            building.content.visible = true;
            building.routeGroup.visible = false;
            building.marker.visible = false;
            s.renderer.resetState();
            s.renderer.shadowMap.needsUpdate = building.shadowDirty;
            if (building.shadowDirty) {
              _gl.depthRange(0, 1);
              s.renderer.setRenderTarget(s.shadowTarget);
              s.renderer.render(building.scene, building.camera);
              s.renderer.setRenderTarget(null);
              building.shadowDirty = false;
            }
            _gl.depthRange(depthRange[0], depthRange[1]);
            s.renderer.setViewport(
              0,
              0,
              _gl.drawingBufferWidth,
              _gl.drawingBufferHeight,
            );
            s.renderer.render(building.scene, building.camera);
            triangles += s.renderer.info.render.triangles;
            building.marker.visible = markerVisible;
          }
          // Navigation is a final non-depth-writing overlay. Neither the basemap
          // shells nor a later building's floor can cut its visible segments.
          for (const building of rendered) {
            building.content.visible = false;
            building.routeGroup.visible = true;
            updateIndoorOverlayScale(
              building,
              building.camera,
              map.getCanvas().clientWidth,
              map.getCanvas().clientHeight,
            );
            updateIndoorRouteFlow(
              building,
              building.props,
              reduced ? 0 : s.flowSeconds,
            );
            s.renderer.render(building.scene, building.camera);
            triangles += s.renderer.info.render.triangles;
            building.content.visible = true;
          }
          updateIndoorMapCamera(
            s.campusCamera,
            args.projectionMatrix,
            new THREE.Matrix4()
              .fromArray(args.defaultProjectionData.mainMatrix)
              .multiply(
                new THREE.Matrix4().fromArray(
                  map.transform.getMatrixForModel(p.model.origin, 0),
                ),
              ),
          );
          updateIndoorOverlayScale(
            s.campus,
            s.campusCamera,
            map.getCanvas().clientWidth,
            map.getCanvas().clientHeight,
          );
          updateIndoorRouteFlow(s.campus, p, reduced ? 0 : s.flowSeconds);
          s.renderer.render(s.campusScene, s.campusCamera);
          triangles += s.renderer.info.render.triangles;
          s.renderer.resetState();
          if (p.routePlaying && !reduced) map.triggerRepaint();
          const width = map.getCanvas().clientWidth;
          const height = map.getCanvas().clientHeight;
          const used: {
            x: number;
            y: number;
            width: number;
            height: number;
            facility: boolean;
          }[] = [];
          // Small facility symbols remain discoverable beside dense room
          // names. Route endpoints and the selected space retain priority.
          const labels = rendered.flatMap((building) =>
            building.labels.map((label) => ({ building, label })),
          );
          const priority = ({ building, label }: (typeof labels)[number]) =>
            label.endpoint || building.props.selectedId === label.id
              ? 2
              : label.textElement
                ? 1
                : 0;
          for (const { building, label } of labels.sort(
            (a, b) => priority(b) - priority(a),
          )) {
            const projected = label.point.clone().project(building.camera);
            const anchorX = ((projected.x + 1) * width) / 2,
              anchorY = ((1 - projected.y) * height) / 2;
            let x = anchorX,
              y = anchorY;
            const selected = building.props.selectedId === label.id;
            const facility = Boolean(label.textElement);
            label.width = label.element.offsetWidth || label.width;
            const labelHeight =
              label.element.offsetHeight || (facility ? 30 : 24);
            const collisionsAt = (cx: number, cy: number) =>
              used.filter(
                (p) =>
                  Math.abs(p.x - cx) < (p.width + label.width) / 2 + 5 &&
                  Math.abs(p.y - cy) < (p.height + labelHeight) / 2 + 4,
              );
            let collisions = collisionsAt(x, y);
            if (
              facility &&
              !selected &&
              !label.endpoint &&
              collisions.some((p) => p.facility)
            ) {
              // Only symbols may move, by at most 40 CSS pixels. Keep rooms
              // at their own anchors and preserve endpoint/selection priority.
              const offsets = [
                [0, -32],
                [0, 32],
                [-32, 0],
                [32, 0],
                [-24, -24],
                [24, -24],
                [-24, 24],
                [24, 24],
                [0, -40],
                [0, 40],
                [-40, 0],
                [40, 0],
              ];
              for (const [dx, dy] of offsets) {
                const cx = anchorX + dx,
                  cy = anchorY + dy;
                if (
                  cx - label.width / 2 > 8 &&
                  cx + label.width / 2 < width - 8 &&
                  cy - labelHeight / 2 > 8 &&
                  cy + labelHeight / 2 < height - 8 &&
                  collisionsAt(cx, cy).length === 0
                ) {
                  x = cx;
                  y = cy;
                  collisions = [];
                  break;
                }
              }
            }
            const visible =
              label.allowed &&
              (latest.current.showLabels || label.endpoint) &&
              map.getZoom() > 17.5 &&
              projected.z >= -1 &&
              projected.z < 1 &&
              x > 8 &&
              x < width - 8 &&
              y > 8 &&
              y < height - 8 &&
              (collisions.length === 0 || selected || label.endpoint);
            label.element.style.display = visible ? "block" : "none";
            label.element.style.pointerEvents = "auto";
            label.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
            let leader = labelLeaders.get(label.element);
            if (facility && !leader) {
              leader = document.createElement("span");
              leader.setAttribute("aria-hidden", "true");
              leader.dataset.indoorLabelLeader = "true";
              leader.style.cssText =
                "position:absolute;left:50%;top:50%;height:1px;transform-origin:0 50%;pointer-events:none;z-index:-1";
              label.element.style.overflow = "visible";
              label.element.appendChild(leader);
              labelLeaders.set(label.element, leader);
            }
            if (leader) {
              leader.style.background = currentPalette.labelLeader;
              const dx = anchorX - x,
                dy = anchorY - y,
                length = Math.hypot(dx, dy);
              // Start outside the label edge, not through its icon or caption.
              const edge = length
                ? Math.min(
                    (label.width / 2 + 1) / (Math.abs(dx) / length),
                    (labelHeight / 2 + 1) / (Math.abs(dy) / length),
                  )
                : 0;
              leader.style.display =
                visible && length > edge ? "block" : "none";
              leader.style.width = `${Math.max(0, length - edge)}px`;
              leader.style.transform = `rotate(${Math.atan2(dy, dx)}rad) translateX(${edge}px)`;
            }
            if (visible)
              used.push({
                x,
                y,
                width: label.width,
                height: labelHeight,
                facility,
              });
          }
          container.dataset.rendered = "true";
          container.dataset.renderer = "maplibre-shared-context";
          container.dataset.triangles = String(triangles);
          container.dataset.displayedBuildings = JSON.stringify(
            rendered.map((building) => ({
              key: building.key,
              level: indoorDisplayLevel(building.props)?.ref,
            })),
          );
          const active = s.buildings.get(
            p.activeBuildingKey ?? venueBuildingKey(p.model),
          );
          if (active) Object.assign(container.dataset, active.host.dataset);
          const sourceFloorElevation = active
            ? (indoorDisplayLevel(active.props)?.elevationM ?? 0)
            : 0;
          container.dataset.zoom = String(map.getZoom());
          container.dataset.pitch = String(map.getPitch());
          container.dataset.entryZoom = String(
            overview.current.entryZoom ?? "",
          );
          container.dataset.exitZoom =
            overview.current.entryZoom === null
              ? ""
              : String(getIndoorExitZoom(overview.current.entryZoom));
          container.dataset.entering = String(overview.current.entering);
          container.dataset.sourceFloorElevation = String(sourceFloorElevation);
          container.dataset.displayFloorElevation = "0";
          container.dataset.navigationProjection = "floor";
        },
        onRemove() {
          const s = layerState;
          if (!s) return;
          for (const building of s.buildings.values())
            disposeBuilding(building);
          s.buildings.clear();
          disposeTree(s.campusScene);
          disposeTree(s.campus.content);
          // Never lose or resize the WebGL context owned by MapLibre.
          s.shadowTarget.dispose();
          s.renderer.dispose();
          if (state.current === s) state.current = null;
          layerState = null;
        },
      };
    };
    const add = () => {
      if (disposed || map.getLayer(LAYER_ID)) return;
      try {
        map.addLayer(createLayer());
        map.triggerRepaint();
      } catch {
        setError("室內圖層尚未就緒，正在等待底圖載入。");
      }
    };
    const keepAboveBuildings = () => {
      const layers = map.getStyle()?.layers ?? [];
      const index = layers.findIndex((layer) => layer.id === LAYER_ID);
      if (
        index >= 0 &&
        layers.slice(index + 1).some((layer) => layer.type === "fill-extrusion")
      )
        map.moveLayer(LAYER_ID);
    };
    map.on("styledata", keepAboveBuildings);
    map.on("style.load", add);
    if (map.getStyle()?.layers) add();
    const unregister = registerIndoorPicker(map, (point) => {
      const s = state.current;
      if (!s || container.dataset.rendered !== "true") return false;
      let nearest: { key: string; id: string; depth: number } | null = null;
      let insideBuilding = false;
      for (const building of s.buildings.values()) {
        const floor = indoorDisplayLevel(building.props);
        if (!floor) continue;
        const ray = mapPixelRay(
          point,
          map.getCanvas().clientWidth,
          map.getCanvas().clientHeight,
          building.inverseMapProjection,
        );
        for (const hit of ray.intersectObjects(building.pickable, false)) {
          const material = (hit.object as THREE.Mesh).material;
          if (
            !(Array.isArray(material) ? material : [material]).every((m) =>
              (m.clippingPlanes ?? []).every(
                (plane) => plane.distanceToPoint(hit.point) >= 0,
              ),
            )
          )
            continue;
          const id = hit.object.userData.id;
          if (!id) continue;
          const depth = hit.point.clone().project(building.camera).z;
          if (!nearest || depth < nearest.depth)
            nearest = { key: building.key, id, depth };
          break;
        }
        const ground = ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -floor.elevationM),
          new THREE.Vector3(),
        );
        if (!ground) continue;
        const ring = building.props.model.building.footprint[0];
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (
            a[1] > -ground.z !== b[1] > -ground.z &&
            ground.x <
              ((b[0] - a[0]) * (-ground.z - a[1])) / (b[1] - a[1]) + a[0]
          )
            inside = !inside;
        }
        insideBuilding ||= inside;
      }
      if (nearest) select(nearest.key, nearest.id);
      return Boolean(nearest) || insideBuilding;
    });
    const lost = () => setError("地圖 3D 顯示連線中斷，請重新整理。");
    map.getCanvas().addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true;
      unregister();
      map.off("style.load", add);
      map.off("styledata", keepAboveBuildings);
      map.getCanvas().removeEventListener("webglcontextlost", lost);
      if (map.getStyle() && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    };
  }, [map, modelsKey]);

  // Synchronize per-building data without rebuilding unchanged floors. The one
  // shared layer and geographic camera survive theme, focus and progress changes.
  useEffect(() => {
    const s = state.current;
    if (!s || !host.current) return;
    synchronizeBuildings(
      s,
      host.current,
      latest.current,
      (buildingKey, featureId) => {
        if (latest.current.onSelectBuildingFeature)
          latest.current.onSelectBuildingFeature({ buildingKey, featureId });
        else latest.current.onSelect(featureId);
      },
    );
    map?.triggerRepaint();
  });

  // Fly through the existing map, leaving its surroundings and overlays intact.
  useEffect(() => {
    if (!map) return;
    let zoomStartedAt = map.getZoom();
    const startZoom = () => {
      zoomStartedAt = map.getZoom();
    };
    const settleEntry = (event: { type: string; indoorOverview?: boolean }) => {
      // A cancelled fly-in also emits its tagged moveend. Arm subsequent
      // zoom-out gestures here, rather than treating cancellation as zoom-out.
      if (event.indoorOverview) {
        overview.current.entering = false;
        map.triggerRepaint();
      }
    };
    const endZoom = (event: {
      type: string;
      indoorOverview?: boolean;
      indoorTour?: boolean;
    }) => {
      const state = overview.current;
      if (
        state.leaving ||
        event.indoorOverview ||
        event.indoorTour ||
        map.getZoom() >= zoomStartedAt
      )
        return;
      if (
        latest.current.onOverviewExit &&
        shouldLeaveIndoor({
          zoom: map.getZoom(),
          entryZoom: state.entryZoom,
          entering: state.entering,
          is3D: useMapStore.getState().is3D,
        })
      ) {
        state.leaving = true;
        latest.current.onOverviewExit();
      }
    };
    map.on("zoomstart", startZoom);
    map.on("zoomend", endZoom);
    map.on("moveend", settleEntry);
    return () => {
      map.off("zoomstart", startZoom);
      map.off("zoomend", endZoom);
      map.off("moveend", settleEntry);
    };
  }, [map]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Camera commands read current floor/view without resetting for each animation frame.
  useEffect(() => {
    if (!map) return;
    const p = latest.current;
    const action = p.cameraAction.type;
    if (action === "zoomIn" || action === "zoomOut") {
      map.easeTo({
        zoom: map.getZoom() + (action === "zoomIn" ? 0.65 : -0.65),
        duration: duration(350),
      });
      return;
    }
    if (action === "rotate") {
      map.easeTo({ bearing: map.getBearing() + 45, duration: duration(450) });
      return;
    }
    const points = indoorBuildingViews(p).flatMap((view) =>
      view.model.building.footprint
        .flat()
        .map((xy) => localToLngLat(xy, view.model.origin)),
    );
    const min: [number, number] = [
      Math.min(...points.map((p) => p[0])),
      Math.min(...points.map((p) => p[1])),
    ];
    const max: [number, number] = [
      Math.max(...points.map((p) => p[0])),
      Math.max(...points.map((p) => p[1])),
    ];
    const bearing = (-(model.building.photoOrientation ?? 0) * 180) / Math.PI;
    const padding = indoorMapPadding(map.getCanvas());
    const angle = (bearing * Math.PI) / 180;
    const rotated = points
      .map((point) => lngLatToLocal(point, model.origin))
      .map(([e, n]) => [
        e * Math.cos(angle) - n * Math.sin(angle),
        e * Math.sin(angle) + n * Math.cos(angle),
      ]);
    const widthM =
      Math.max(...rotated.map((p) => p[0])) -
      Math.min(...rotated.map((p) => p[0]));
    const depthM =
      Math.max(...rotated.map((p) => p[1])) -
      Math.min(...rotated.map((p) => p[1]));
    const pitch = p.view === "top" ? 0 : 48;
    const width = Math.max(
      150,
      map.getCanvas().clientWidth - padding.left - padding.right,
    );
    const height = Math.max(
      160,
      map.getCanvas().clientHeight - padding.top - padding.bottom,
    );
    const pixelsPerM =
      Math.min(
        width / widthM,
        height / (depthM * Math.cos((pitch * Math.PI) / 180) + 4),
      ) * 0.82;
    const metresPerPixelAtZoomZero =
      (Math.cos((model.origin[1] * Math.PI) / 180) * 2 * Math.PI * 6371000) /
      512;
    const initialZoom = Math.min(
      20.5,
      Math.log2(metresPerPixelAtZoomZero * pixelsPerM),
    );
    const center: [number, number] = [
      (min[0] + max[0]) / 2,
      (min[1] + max[1]) / 2,
    ];
    // Use MapLibre's exact perspective on a detached transform. This accounts
    // for near-side magnification without moving the live map while measuring.
    const projection = map.transform.clone();
    projection.setElevation(0);
    projection.setCenter(new LngLat(...center));
    projection.setPadding(padding);
    projection.setBearing(bearing);
    projection.setPitch(pitch);
    const fittedInitialZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), initialZoom),
    );
    const projectionCenter = new LngLat(...center);
    const projectionPoints = points.map((point) => new LngLat(...point));
    const zoom =
      fitIndoorOverviewZoom(
        {
          width: map.getCanvas().clientWidth,
          height: map.getCanvas().clientHeight,
          padding,
        },
        // Perspective correction must stay near the metre-based estimate;
        // a failed projection must never send the campus to a world view.
        Math.max(map.getMinZoom(), fittedInitialZoom - 1),
        fittedInitialZoom,
        (candidate) =>
          projectIndoorOverviewAtZoom(
            projection,
            candidate,
            projectionCenter,
            projectionPoints,
          ),
      ) ?? fittedInitialZoom;
    overview.current.entryZoom = zoom;
    overview.current.entering = true;
    map.setCenterElevation(0);
    map.flyTo(
      {
        padding,
        center,
        zoom,
        pitch,
        bearing,
        elevation: 0,
        duration: duration(1400),
      },
      { indoorOverview: true },
    );
  }, [map, modelsKey, props.cameraAction]);

  useEffect(() => {
    if (!map || lastView.current === props.view) return;
    lastView.current = props.view;
    map.easeTo({
      pitch: props.view === "top" ? 0 : 48,
      duration: duration(600),
    });
  }, [map, props.view]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Changing floors rebuilds focus targets.
  useEffect(() => {
    if (!map || !props.focusId) return;
    const activeKey =
      latest.current.activeBuildingKey ?? venueBuildingKey(model);
    const target = state.current?.buildings
      .get(activeKey)
      ?.targets.get(props.focusId);
    if (!target) return;
    map.setCenterElevation(0);
    map.flyTo({
      center: localToLngLat([target.x, -target.z], model.origin),
      elevation: 0,
      zoom: model.connections.some(
        (c) => c.id === props.focusId && c.kind === "stairs",
      )
        ? 21
        : 20.2,
      padding: indoorMapPadding(map.getCanvas()),
      duration: duration(900),
    });
  }, [map, props.focusId, model, levelsKey]);

  return map
    ? createPortal(
        <>
          <div
            ref={host}
            data-testid="indoor-scene"
            data-theme={theme}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          />
          {error && (
            <p
              role="alert"
              style={{
                position: "absolute",
                top: 130,
                left: "clamp(16px, 29vw, 420px)",
                right: 16,
                maxWidth: 380,
                background: palette.labelBackground,
                color: palette.labelInk,
                padding: 12,
              }}
            >
              {error}
            </p>
          )}
        </>,
        map.getCanvasContainer(),
      )
    : null;
}
