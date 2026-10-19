"use client";

import {
  createContext,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import useMapStore from "@/stores/useMapStore";

interface PanelHost {
  host: HTMLDivElement | null;
  setHost: Dispatch<SetStateAction<HTMLDivElement | null>>;
}

const PanelContext = createContext<PanelHost | null>(null);

/** Shares the existing sheet's responsive content slot with the map subtree. */
export function IndoorPanelProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo(() => ({ host, setHost }), [host]);
  return <PanelContext value={value}>{children}</PanelContext>;
}

/** Both sheet shells may exist, but only the current breakpoint owns content. */
export function IndoorPanelSlot({ active }: { active: boolean }) {
  const context = useContext(PanelContext);
  const setHost = context?.setHost;
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!active || !node || !setHost) return;
    setHost(node);
    return () => setHost((current) => (current === node ? null : current));
  }, [active, node, setHost]);
  return <div ref={setNode} data-indoor-panel-slot="" className="min-w-0" />;
}

export function IndoorPanelPortal({ children }: { children: ReactNode }) {
  const context = useContext(PanelContext);
  return context?.host ? createPortal(children, context.host) : null;
}

export function useIndoorPanel() {
  const open = useMapStore((state) => state.indoorPanelOpen);
  const setOpen = useMapStore((state) => state.setIndoorPanelOpen);
  return { open, setOpen };
}
