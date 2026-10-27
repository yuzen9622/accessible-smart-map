"use client";

import type { CustomLayerInterface } from "maplibre-gl";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import * as THREE from "three";
import type { CumulativePath } from "@/lib/geo";
import {
  type NavigationProgress,
  poseAtAlong,
} from "@/lib/navigation/navigationProgress";

const LAYER_ID = "navigation-riding-bus";

function createBus(): THREE.Group {
  const bus = new THREE.Group();
  const materials = {
    body: new THREE.MeshStandardMaterial({ color: 0x2563eb, roughness: 0.55 }),
    roof: new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.7 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0f2847, roughness: 0.25 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x18212f, roughness: 1 }),
    hub: new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.5 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff1bf }),
    tail: new THREE.MeshBasicMaterial({ color: 0xfb7185 }),
  };
  const box = (
    size: [number, number, number],
    at: [number, number, number],
    material: THREE.Material,
  ) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.position.set(...at);
    bus.add(mesh);
  };
  box([3.4, 2.5, 8.8], [0, 1.95, 0], materials.body);
  box([3.46, 0.28, 8.9], [0, 3.34, 0], materials.roof);
  box([2.9, 1.3, 0.08], [0, 2.45, -4.45], materials.glass);
  box([2.8, 0.9, 0.08], [0, 2.6, 4.45], materials.glass);
  box([2.8, 0.22, 0.1], [0, 3.1, -4.5], materials.rubber);
  box([2.4, 0.7, 2.5], [0, 3.75, 0.6], materials.roof);
  for (const x of [-1.73, 1.73]) {
    for (const z of [-2.95, -0.95, 1.05, 3.05])
      box([0.08, 1.15, 1.65], [x, 2.5, z], materials.glass);
    box([0.08, 0.18, 7.6], [x, 1.42, 0], materials.roof);
    for (const z of [-2.6, 2.7]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.67, 0.67, 0.4, 16),
        materials.rubber,
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x, 0.78, z);
      bus.add(wheel);
      const hub = new THREE.Mesh(
        new THREE.CylinderGeometry(0.31, 0.31, 0.42, 12),
        materials.hub,
      );
      hub.rotation.z = Math.PI / 2;
      hub.position.copy(wheel.position);
      bus.add(hub);
    }
  }
  for (const x of [-1.12, 1.12]) {
    box([0.65, 0.28, 0.12], [x, 1.15, -4.46], materials.lamp);
    box([0.4, 0.45, 0.12], [x, 1.3, 4.46], materials.tail);
  }
  const outline = new THREE.Mesh(
    new THREE.RingGeometry(5.15, 5.45, 48),
    new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      side: THREE.DoubleSide,
    }),
  );
  outline.rotation.x = -Math.PI / 2;
  outline.position.y = 0.05;
  bus.add(outline);
  return bus;
}

interface Motion {
  progress: NavigationProgress;
  from: number;
  to: number;
  startedAt: number;
  duration: number;
}

function distanceAt(motion: Motion, at: number): number {
  const fraction =
    motion.duration === 0
      ? 1
      : Math.min(1, Math.max(0, (at - motion.startedAt) / motion.duration));
  return motion.from + (motion.to - motion.from) * fraction;
}

export default function NavigationBusLayer({
  path,
  progress,
  fallback,
}: {
  path: CumulativePath;
  progress: NavigationProgress;
  fallback: ReactNode;
}) {
  const { current: mapRef } = useMap();
  const map = mapRef?.getMap();
  const [ready, setReady] = useState(false);
  const latestPath = useRef(path);
  latestPath.current = path;
  const motion = useRef<Motion>({
    progress,
    from: progress.alongM,
    to: progress.alongM,
    startedAt: 0,
    duration: 0,
  });

  useEffect(() => {
    const previous = motion.current;
    const now = performance.now();
    const sameLeg =
      previous.progress.routeToken === progress.routeToken &&
      previous.progress.navigationId === progress.navigationId &&
      previous.progress.routeVersion === progress.routeVersion &&
      previous.progress.legIndex === progress.legIndex;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    motion.current = {
      progress,
      from: sameLeg ? distanceAt(previous, now) : progress.alongM,
      to: progress.alongM,
      startedAt: now,
      duration:
        sameLeg && !reduced && Date.now() - progress.observedAt < 25_000
          ? 800
          : 0,
    };
    map?.triggerRepaint();
  }, [progress, map]);

  useEffect(() => {
    if (!map) return;
    let disposed = false;
    let painted = false;
    const createLayer = (): CustomLayerInterface => {
      let renderer: THREE.WebGLRenderer | null = null;
      let bus: THREE.Group | null = null;
      const camera = new THREE.Camera();
      const scene = new THREE.Scene();
      return {
        id: LAYER_ID,
        type: "custom",
        renderingMode: "3d",
        onAdd(_map, gl) {
          renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl as WebGL2RenderingContext,
          });
          renderer.autoClear = false;
          renderer.toneMapping = THREE.ACESFilmicToneMapping;
          bus = createBus();
          scene.add(bus, new THREE.HemisphereLight(0xffffff, 0x64748b, 2.5));
          const light = new THREE.DirectionalLight(0xffffff, 3);
          light.position.set(-20, 30, -20);
          scene.add(light);
        },
        render(_gl, args) {
          if (!renderer || !bus || disposed || _gl.isContextLost()) return;
          const current = motion.current;
          const reduced = window.matchMedia(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          const at = performance.now();
          const alongM = reduced ? current.to : distanceAt(current, at);
          const pose = poseAtAlong(
            latestPath.current,
            current.progress.legIndex,
            alongM,
          );
          if (!pose) return;
          const metersPerPixel =
            (40075016.686 * Math.cos((pose.location.lat * Math.PI) / 180)) /
            (512 * 2 ** map.getZoom());
          bus.scale.setScalar(metersPerPixel * 5.2);
          bus.rotation.y = (-pose.bearing * Math.PI) / 180;
          camera.projectionMatrix
            .fromArray(args.defaultProjectionData.mainMatrix)
            .multiply(
              new THREE.Matrix4().fromArray(
                map.transform.getMatrixForModel(
                  [pose.location.lng, pose.location.lat],
                  0,
                ),
              ),
            );
          renderer.resetState();
          // This is a navigation marker: retain its own depth while keeping it above map buildings.
          renderer.clearDepth();
          renderer.render(scene, camera);
          renderer.resetState();
          if (!painted) {
            painted = true;
            setReady(true);
          }
          if (!reduced && at < current.startedAt + current.duration)
            map.triggerRepaint();
        },
        onRemove() {
          const geometries = new Set<THREE.BufferGeometry>();
          const materials = new Set<THREE.Material>();
          scene.traverse((object) => {
            if (!(object instanceof THREE.Mesh)) return;
            geometries.add(object.geometry);
            for (const material of Array.isArray(object.material)
              ? object.material
              : [object.material])
              materials.add(material);
          });
          for (const geometry of geometries) geometry.dispose();
          for (const material of materials) material.dispose();
          renderer?.dispose();
          renderer = null;
          bus = null;
          painted = false;
          if (!disposed) setReady(false);
        },
      };
    };
    const add = () => {
      if (disposed || map.getLayer(LAYER_ID)) return;
      try {
        map.addLayer(createLayer());
        map.triggerRepaint();
      } catch {
        setReady(false);
      }
    };
    const lost = () => {
      painted = false;
      setReady(false);
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
    const repaint = () => map.triggerRepaint();
    const restored = () => {
      if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
      add();
    };
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    media.addEventListener("change", repaint);
    map.on("style.load", add);
    map.on("styledata", keepAboveBuildings);
    map.getCanvas().addEventListener("webglcontextlost", lost);
    map.getCanvas().addEventListener("webglcontextrestored", restored);
    if (map.getStyle()?.layers) add();
    return () => {
      disposed = true;
      media.removeEventListener("change", repaint);
      map.off("style.load", add);
      map.off("styledata", keepAboveBuildings);
      map.getCanvas().removeEventListener("webglcontextlost", lost);
      map.getCanvas().removeEventListener("webglcontextrestored", restored);
      if (map.getStyle() && map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    };
  }, [map]);

  return ready ? (
    <span className="sr-only" role="img" aria-label="公車搭乘位置" />
  ) : (
    fallback
  );
}
