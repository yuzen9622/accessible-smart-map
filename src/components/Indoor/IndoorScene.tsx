"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
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

export type { IndoorSceneProps } from "@/lib/indoor/sceneTypes";

interface SceneState extends IndoorContentState {
  camera: THREE.OrthographicCamera;
  controls: OrbitControls;
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  bounds: THREE.Box3;
  reset: () => void;
}

export default function IndoorScene(props: IndoorSceneProps) {
  const host = useRef<HTMLDivElement>(null);
  const state = useRef<SceneState | null>(null);
  const latest = useRef(props);
  const cameraLevel = useRef<number | null>(null);
  latest.current = props;
  const [error, setError] = useState("");
  const { model } = props;

  useEffect(() => {
    const container = host.current;
    if (!container) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
    } catch {
      setError(
        "此瀏覽器無法啟用 3D。請開啟硬體加速後重新整理；仍可使用左側目錄與路線文字。",
      );
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.localClippingEnabled = true;
    renderer.setClearColor(0xf2f2f2);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.domElement.setAttribute(
      "aria-label",
      "室內立體模型，可拖曳旋轉、滾輪縮放；也可使用視角控制按鈕與地點目錄",
    );
    renderer.domElement.style.cssText =
      "display:block;width:100%;height:100%;touch-action:none";
    container.appendChild(renderer.domElement);
    setError("");
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xa6a6a6, 1.7));
    const light = new THREE.DirectionalLight(0xffffff, 2.2);
    light.position.set(-35, 65, 20);
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
    light.shadow.normalBias = 0.025;
    scene.add(light);
    const camera = new THREE.OrthographicCamera(-50, 50, 40, -40, 0.1, 600);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.12;
    controls.minZoom = 0.35;
    controls.maxZoom = 16;
    controls.maxPolarAngle = Math.PI / 2 - 0.08;
    controls.screenSpacePanning = true;
    const indoor = createIndoorContent();
    const { content, routeGroup, marker, labels } = indoor;
    scene.add(content, routeGroup, marker);
    const bounds = new THREE.Box3().setFromPoints(
      model.building.footprint.flat().map((p) => v3([p[0], p[1], 0])),
    );
    const center = bounds.getCenter(new THREE.Vector3());
    light.target.position.copy(center);
    scene.add(light.target);
    const size = bounds.getSize(new THREE.Vector3());
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size.length() * 4, size.length() * 4),
      new THREE.ShadowMaterial({ opacity: 0.16 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(center.x, -0.35, center.z);
    ground.receiveShadow = true;
    scene.add(ground);
    const reset = () => {
      const p = latest.current;
      const heading = model.building.photoOrientation ?? 0;
      // Photo +x maps to screen right. Photo +y is clockwise in the EN plane.
      const up = new THREE.Vector3(-Math.sin(heading), 0, -Math.cos(heading));
      const right = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading));
      const level = indoorDisplayLevel(p);
      const target = center.clone().setY(level?.elevationM ?? 0);
      camera.up.copy(p.view === "top" ? up : new THREE.Vector3(0, 1, 0));
      if (p.view === "top")
        camera.position.copy(target).add(new THREE.Vector3(0, 110, 0.001));
      else
        camera.position
          .copy(target)
          .addScaledVector(up, -58)
          .addScaledVector(right, 32)
          .add(new THREE.Vector3(0, 68, 0));
      camera.zoom = 1;
      controls.target.copy(target);
      cameraLevel.current = target.y;
      controls.enableRotate = p.view !== "top";
      camera.lookAt(target);
      camera.updateProjectionMatrix();
      controls.update();
      const extent = Math.max(
        ...model.building.footprint.flat().flatMap((p) => {
          const screen = v3([p[0], p[1], target.y]).project(camera);
          return [Math.abs(screen.x), Math.abs(screen.y)];
        }),
      );
      camera.zoom = 0.78 / Math.max(extent, 0.1);
      camera.updateProjectionMatrix();
    };
    state.current = {
      camera,
      controls,
      scene,
      renderer,
      ...indoor,
      bounds,
      reset,
    };
    const resize = () => {
      const width = Math.max(container.clientWidth, 1),
        height = Math.max(container.clientHeight, 1),
        aspect = width / height;
      const dimension = Math.max(size.x, size.z) * 0.68;
      camera.left = -dimension * aspect;
      camera.right = dimension * aspect;
      camera.top = dimension;
      camera.bottom = -dimension;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    reset();
    let raf = 0;
    const projected = new THREE.Vector3();
    const draw = () => {
      const s = state.current;
      if (!s) return;
      controls.update();
      renderer.render(scene, camera);
      const width = container.clientWidth,
        height = container.clientHeight;
      const used: { x: number; y: number; width: number }[] = [];
      for (const label of labels) {
        projected.copy(label.point).project(camera);
        const x = ((projected.x + 1) * width) / 2,
          y = ((1 - projected.y) * height) / 2;
        const selected = latest.current.selectedId === label.id;
        label.width = label.element.offsetWidth || label.width;
        const collides = used.some(
          (p) =>
            Math.abs(p.x - x) < (p.width + label.width) / 2 + 5 &&
            Math.abs(p.y - y) < 25,
        );
        const visible =
          label.allowed &&
          (latest.current.showLabels || label.endpoint) &&
          projected.z >= -1 &&
          projected.z < 1 &&
          x > 8 &&
          x < width - 8 &&
          y > 8 &&
          y < height - 8 &&
          (!collides || selected || label.endpoint);
        label.element.style.display = visible ? "block" : "none";
        label.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
        label.element.style.background = selected
          ? indoorPalette.primaryCss
          : indoorPalette.labelBackground;
        label.element.style.color = selected ? "white" : indoorPalette.labelInk;
        if (visible) used.push({ x, y, width: label.width });
      }
      container.dataset.rendered = "true";
      container.dataset.triangles = String(renderer.info.render.triangles);
      raf = requestAnimationFrame(draw);
    };
    draw();
    let down: [number, number] = [0, 0];
    const pointerDown = (event: PointerEvent) => {
      down = [event.clientX, event.clientY];
    };
    const pointerUp = (event: PointerEvent) => {
      if (Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 6)
        return;
      const rect = renderer.domElement.getBoundingClientRect();
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(
        new THREE.Vector2(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          (-(event.clientY - rect.top) / rect.height) * 2 + 1,
        ),
        camera,
      );
      const hit = raycaster
        .intersectObjects(state.current?.pickable ?? [], false)
        .find(({ object, point }) => {
          const material = (object as THREE.Mesh).material;
          const materials = Array.isArray(material) ? material : [material];
          return materials.every((entry) =>
            (entry?.clippingPlanes ?? []).every(
              (plane) => plane.distanceToPoint(point) >= 0,
            ),
          );
        });
      if (hit?.object.userData.id)
        latest.current.onSelect(hit.object.userData.id);
    };
    renderer.domElement.addEventListener("pointerdown", pointerDown);
    renderer.domElement.addEventListener("pointerup", pointerUp);
    let disposed = false;
    const contextLost = (e: Event) => {
      if (disposed) return;
      e.preventDefault();
      setError("3D 顯示連線中斷，請重新整理預覽。");
    };
    renderer.domElement.addEventListener("webglcontextlost", contextLost);
    return () => {
      disposed = true;
      renderer.domElement.removeEventListener("webglcontextlost", contextLost);
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      for (const label of labels) label.element.remove();
      disposeTree(scene);
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
      state.current = null;
      cameraLevel.current = null;
    };
  }, [model]);

  const levelsKey = String(props.visibleLevels[0] ?? "");
  const activeSpanKey = indoorActiveSpanKey(props);
  const stairKey = JSON.stringify(props.stairPreview ?? null);
  // Regenerate only geometric changes; selection and animation do not allocate meshes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Ref snapshots are invalidated by these geometry keys, not animation frames.
  useEffect(() => {
    const s = state.current,
      container = host.current;
    if (!s || !container) return;
    rebuildIndoorContent(s, container, latest.current, (id) =>
      latest.current.onSelect(id),
    );
  }, [model, levelsKey, activeSpanKey, stairKey]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset reads the current view through latest.
  useEffect(() => {
    state.current?.reset();
  }, [props.view]);
  // Preserve the user's orbit and zoom while moving with the selected floor.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const ordinal = Number(levelsKey);
    const level = model.building.levels.find(
      (entry) => entry.ordinal === ordinal,
    );
    const elevation = level?.elevationM ?? 0;
    const delta =
      cameraLevel.current === null ? 0 : elevation - cameraLevel.current;
    s.camera.position.y += delta;
    s.controls.target.y += delta;
    s.controls.update();
    cameraLevel.current = elevation;
  }, [levelsKey, model]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Newly rebuilt floor meshes need the current selection applied.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    for (const [id, meshes] of s.featureMeshes)
      for (const mesh of meshes) {
        (mesh.material as THREE.MeshStandardMaterial).color.setHex(
          id === props.selectedId
            ? indoorPalette.selection
            : mesh.userData.originalColor,
        );
      }
  }, [props.selectedId, levelsKey, activeSpanKey, stairKey]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Floor changes rebuild target anchors.
  useEffect(() => {
    const s = state.current;
    if (!s || !props.focusId) return;
    const point = s.targets.get(props.focusId);
    if (!point) return;
    const delta = point.clone().sub(s.controls.target);
    s.controls.target.copy(point);
    s.camera.position.add(delta);
    s.camera.zoom = model.connections.some(
      (connection) =>
        connection.id === props.focusId && connection.kind === "stairs",
    )
      ? 4.3
      : 2.1;
    s.camera.updateProjectionMatrix();
    s.controls.update();
  }, [props.focusId, model, levelsKey]);
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    const action = props.cameraAction.type;
    if (action === "reset") s.reset();
    if (action === "zoomIn" || action === "zoomOut") {
      s.camera.zoom = THREE.MathUtils.clamp(
        s.camera.zoom * (action === "zoomIn" ? 1.25 : 0.8),
        0.35,
        16,
      );
      s.camera.updateProjectionMatrix();
    }
    if (action === "rotate") {
      if (latest.current.view === "top")
        s.camera.up.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);
      else
        s.camera.position
          .sub(s.controls.target)
          .applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4)
          .add(s.controls.target);
      s.camera.lookAt(s.controls.target);
      s.controls.update();
    }
  }, [props.cameraAction]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Geometry-only invalidation excludes progress.
  useEffect(() => {
    const s = state.current;
    if (!s) return;
    rebuildIndoorRoute(s, latest.current);
    updateIndoorLabels(s, latest.current);
  }, [props.route, levelsKey, activeSpanKey, model]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Update marker only for path, progress, and visible floor.
  useEffect(() => {
    const s = state.current;
    if (s && host.current) updateIndoorMarker(s, host.current, latest.current);
  }, [
    props.route,
    props.progress,
    props.routeDirection,
    model,
    levelsKey,
    activeSpanKey,
    stairKey,
  ]);

  return (
    <div
      ref={host}
      data-testid="indoor-scene"
      style={{ position: "absolute", inset: 0, overflow: "hidden" }}
    >
      {error && (
        <p
          role="alert"
          style={{
            position: "absolute",
            zIndex: 5,
            padding: 24,
            background: "white",
          }}
        >
          {error}
        </p>
      )}
    </div>
  );
}
