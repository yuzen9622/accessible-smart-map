import MapAppLayout from "@/app/[lng]/layout";

export { metadata, viewport } from "@/app/[lng]/layout";

/** The public /map entry uses the existing application shell without a rewrite. */
export default function MapLayout({ children }: { children: React.ReactNode }) {
  return (
    <MapAppLayout params={Promise.resolve({ lng: "zh-TW" })}>
      {children}
    </MapAppLayout>
  );
}
