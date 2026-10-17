"use client";

import type { CustomLayerInterface } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMap } from "react-map-gl/maplibre";
import * as THREE from "three";
import { localToLngLat } from "@/lib/indoor/coordinates";
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
  createIndoorContent,
  disposeTree,
  type IndoorContentState,
  indoorActiveSpanKey,
  indoorDisplayLevel,
  indoorPalette,
  rebuildIndoorContent,
  rebuildIndoorRoute,
  updateIndoorLabels,
  updateIndoorMarker,
  v3,
} from "@/lib/indoor/sceneContent";
import type { IndoorSceneProps } from "@/lib/indoor/sceneTypes";
import useMapStore from "@/stores/useMapStore";

const LAYER_ID = "local-indoor-cutaway";
interface MapSceneState extends IndoorContentState {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  inverseMapProjection: THREE.Matrix4;
  shadowTarget: THREE.WebGLRenderTarget;
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
  const latest = useRef<IndoorSceneProps>({ ...props, grounded: true });
  latest.current = { ...props, grounded: true };
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<MapSceneState | null>(null);
  const [error, setError] = useState("");
  const { model } = props;
  const levelsKey = String(props.visibleLevels[0] ?? "");
  const activeSpanKey = indoorActiveSpanKey(props);
  const stairKey = JSON.stringify(props.stairPreview ?? null);
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
    const restoreShell = mountIndoorBuildingMask(map, model);
    return () => {
      overview.current.leaving = true;
      restoreShell();
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
  }, [map, model]);

  useEffect(() => {
    if (!map || !host.current) return;
    const container = host.current;
    const labelLeaders = new WeakMap<HTMLButtonElement, HTMLSpanElement>();
    let disposed = false;
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
          renderer.shadowMap.needsUpdate = true;
          renderer.shadowMap.type = THREE.PCFShadowMap;
          renderer.outputColorSpace = THREE.SRGBColorSpace;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          renderer.toneMappingExposure = 0.9;
          const scene = new THREE.Scene();
          scene.add(new THREE.HemisphereLight(0xffffff, 0xa6a6a6, 1.7));
          const light = new THREE.DirectionalLight(0xffffff, 2.2);
          const bounds = new THREE.Box3().setFromPoints(
            model.building.footprint.flat().map((p) => v3([p[0], p[1], 0])),
          );
          const center = bounds.getCenter(new THREE.Vector3());
          light.position.copy(center).add(new THREE.Vector3(-35, 65, 20));
          light.target.position.copy(center);
          light.castShadow = true;
          light.shadow.mapSize.set(2048, 2048);
          Object.assign(light.shadow.camera, {
            left: -80,
            right: 80,
            top: 80,
            bottom: -80,
            near: 0.1,
            far: 180,
          });
          light.shadow.normalBias = 0.04;
          light.shadow.bias = -0.00025;
          scene.add(light, light.target);
          const content = createIndoorContent();
          scene.add(content.content, content.routeGroup, content.marker);
          const s: MapSceneState = {
            ...content,
            scene,
            camera: new THREE.PerspectiveCamera(),
            inverseMapProjection: new THREE.Matrix4(),
            shadowTarget: new THREE.WebGLRenderTarget(1, 1),
            renderer,
          };
          s.camera.matrixAutoUpdate = false;
          s.camera.matrixWorldAutoUpdate = false;
          layerState = s;
          state.current = s;
          rebuildIndoorContent(s, container, latest.current, (id) =>
            latest.current.onSelect(id),
          );
          rebuildIndoorRoute(s, latest.current);
          updateIndoorMarker(s, container, latest.current);
          setError("");
        },
        render(_gl, args) {
          const s = layerState;
          if (!s || disposed) return;

          // getMatrixForModel consumes metres in the existing (E, Up, -N) basis.
          // No per-room scale, geographic mirroring, or independent indoor camera.
          const sourceFloorElevation =
            indoorDisplayLevel(latest.current)?.elevationM ?? 0;
          const modelMatrix = groundFloorModelMatrix(
            new THREE.Matrix4().fromArray(
              map.transform.getMatrixForModel(model.origin, 0),
            ),
            sourceFloorElevation,
          );
          const combined = new THREE.Matrix4()
            .fromArray(args.defaultProjectionData.mainMatrix)
            .multiply(modelMatrix);
          s.inverseMapProjection = updateIndoorMapCamera(
            s.camera,
            args.projectionMatrix,
            combined,
          );
          const depthRange = _gl.getParameter(_gl.DEPTH_RANGE) as Float32Array;
          s.renderer.resetState();
          if (s.renderer.shadowMap.needsUpdate) {
            // MapLibre reserves a reduced depth range for its 3D layers. Three's
            // native shadow depth texture must be generated at 0..1 or every
            // surface falsely shadows itself. The colour pass stays offscreen.
            _gl.depthRange(0, 1);
            s.renderer.setRenderTarget(s.shadowTarget);
            s.renderer.render(s.scene, s.camera);
            s.renderer.setRenderTarget(null);
          }
          _gl.depthRange(depthRange[0], depthRange[1]);
          s.renderer.setViewport(
            0,
            0,
            _gl.drawingBufferWidth,
            _gl.drawingBufferHeight,
          );
          s.renderer.render(s.scene, s.camera);
          s.renderer.resetState();
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
          const labelPriority = (
            label: IndoorContentState["labels"][number],
          ) =>
            label.endpoint || latest.current.selectedId === label.id
              ? 2
              : label.textElement
                ? 1
                : 0;
          for (const label of [...s.labels].sort(
            (a, b) => labelPriority(b) - labelPriority(a),
          )) {
            const projected = label.point.clone().project(s.camera);
            const anchorX = ((projected.x + 1) * width) / 2,
              anchorY = ((1 - projected.y) * height) / 2;
            let x = anchorX,
              y = anchorY;
            const selected = latest.current.selectedId === label.id;
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
            label.element.style.background = selected
              ? indoorPalette.primaryCss
              : indoorPalette.labelBackground;
            label.element.style.color = selected
              ? "white"
              : indoorPalette.labelInk;
            let leader = labelLeaders.get(label.element);
            if (facility && !leader) {
              leader = document.createElement("span");
              leader.setAttribute("aria-hidden", "true");
              leader.dataset.indoorLabelLeader = "true";
              leader.style.cssText =
                "position:absolute;left:50%;top:50%;height:1px;background:#64748b;transform-origin:0 50%;pointer-events:none;z-index:-1";
              label.element.style.overflow = "visible";
              label.element.appendChild(leader);
              labelLeaders.set(label.element, leader);
            }
            if (leader) {
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
          container.dataset.triangles = String(
            s.renderer.info.render.triangles,
          );
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
          for (const label of s.labels) label.element.remove();
          disposeTree(s.scene);
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
    map.on("style.load", add);
    if (map.getStyle()?.layers) add();
    const unregister = registerIndoorPicker(map, (point) => {
      const s = state.current;
      if (!s || container.dataset.rendered !== "true") return false;
      const ray = mapPixelRay(
        point,
        map.getCanvas().clientWidth,
        map.getCanvas().clientHeight,
        s.inverseMapProjection,
      );
      const hit = ray
        .intersectObjects(s.pickable, false)
        .find(({ object, point: hitPoint }) => {
          const mat = (object as THREE.Mesh).material;
          return (Array.isArray(mat) ? mat : [mat]).every((m) =>
            (m.clippingPlanes ?? []).every(
              (plane) => plane.distanceToPoint(hitPoint) >= 0,
            ),
          );
        });
      if (!hit?.object.userData.id) {
        // A click in the building's empty cutaway is still an indoor action;
        // do not accidentally reverse-geocode an unknown doorway or void.
        const p = latest.current;
        const elevation = indoorDisplayLevel(p)?.elevationM ?? 0;
        const point = ray.ray.intersectPlane(
          new THREE.Plane(new THREE.Vector3(0, 1, 0), -elevation),
          new THREE.Vector3(),
        );
        if (!point) return false;
        const ring = model.building.footprint[0];
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const a = ring[i],
            b = ring[j];
          if (
            a[1] > -point.z !== b[1] > -point.z &&
            point.x < ((b[0] - a[0]) * (-point.z - a[1])) / (b[1] - a[1]) + a[0]
          )
            inside = !inside;
        }
        return inside;
      }
      latest.current.onSelect(hit.object.userData.id);
      return true;
    });
    const lost = () => setError("地圖 3D 顯示連線中斷，請重新整理。");
    map.getCanvas().addEventListener("webglcontextlost", lost);
    return () => {
      disposed = true;
      unregister();
      map.off("style.load", add);
      map.getCanvas().removeEventListener("webglcontextlost", lost);
      if (map.getStyle() && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    };
  }, [map, model]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Geometry keys intentionally exclude animation and selection.
  useEffect(() => {
    const s = state.current;
    if (!s || !host.current) return;
    rebuildIndoorContent(s, host.current, latest.current, (id) =>
      latest.current.onSelect(id),
    );
    s.renderer.shadowMap.needsUpdate = true;
    rebuildIndoorRoute(s, latest.current);
    updateIndoorMarker(s, host.current, latest.current);
    map?.triggerRepaint();
  }, [map, model, levelsKey, activeSpanKey, stairKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Meshes are rebuilt on floor changes.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const [id, meshes] of s.featureMeshes)
      for (const mesh of meshes)
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(
          id === props.selectedId
            ? indoorPalette.selection
            : mesh.userData.originalColor,
        );
    map?.triggerRepaint();
  }, [
    map,
    props.selectedId,
    props.showLabels,
    levelsKey,
    activeSpanKey,
    stairKey,
  ]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Route-only rebuild; progress updates the marker below.
  useEffect(() => {
    if (state.current) {
      rebuildIndoorRoute(state.current, latest.current);
      updateIndoorLabels(state.current, latest.current);
    }
    map?.triggerRepaint();
  }, [map, props.route, levelsKey, activeSpanKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Progress must not rebuild static geometry.
  useEffect(() => {
    if (state.current && host.current) {
      updateIndoorMarker(state.current, host.current, latest.current);
      state.current.renderer.shadowMap.needsUpdate = true;
    }
    map?.triggerRepaint();
  }, [
    map,
    props.route,
    props.progress,
    props.routeDirection,
    levelsKey,
    activeSpanKey,
    stairKey,
  ]);

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
    const endZoom = (event: { type: string; indoorOverview?: boolean }) => {
      const state = overview.current;
      if (
        state.leaving ||
        event.indoorOverview ||
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
    const points = model.building.footprint
      .flat()
      .map((xy) => localToLngLat(xy, model.origin));
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
    const rotated = model.building.footprint
      .flat()
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
    const zoom = Math.min(
      20.5,
      Math.log2(metresPerPixelAtZoomZero * pixelsPerM),
    );
    overview.current.entryZoom = zoom;
    overview.current.entering = true;
    map.setCenterElevation(0);
    map.flyTo(
      {
        padding,
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
        zoom,
        pitch,
        bearing,
        elevation: 0,
        duration: duration(1400),
      },
      { indoorOverview: true },
    );
  }, [map, model, props.cameraAction]);

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
    const target = state.current?.targets.get(props.focusId);
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
                background: "white",
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
