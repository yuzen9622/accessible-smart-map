/** Responsive local assets keep the map app's existing image configuration intact. */
export default function LandingImage({
  src,
  alt,
  width,
  height,
  sizes,
  priority = false,
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  sizes?: string;
  priority?: boolean;
}) {
  const isDesktop = src.endsWith("-desktop.webp");
  const isPhone = src.endsWith("-native.webp") || src.endsWith("-mobile.webp");
  const originalWidth = isPhone ? 1206 : 1440;
  const srcSet =
    isDesktop || isPhone
      ? (isPhone ? [360, 720, 1206] : [480, 768, 1024, 1440])
          .map(
            (size) =>
              `${size === originalWidth ? src : src.replace(".webp", `-${size}.webp`)} ${size}w`,
          )
          .join(", ")
      : undefined;
  const source = src === "/logo.webp" ? "/landing/brand-mark.webp" : src;
  return (
    <>
      {priority && (
        <link
          rel="preload"
          as="image"
          href={srcSet ? undefined : source}
          imageSrcSet={srcSet}
          imageSizes={sizes}
          fetchPriority="high"
        />
      )}
      {/* biome-ignore lint/performance/noImgElement: pre-sized local srcsets avoid changing the map application's unoptimized image config. */}
      <img
        src={source}
        srcSet={srcSet}
        sizes={sizes}
        alt={alt}
        width={width}
        height={height}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
      />
    </>
  );
}
