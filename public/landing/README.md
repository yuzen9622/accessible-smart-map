# Landing-page product captures

Product WebP assets in this directory are real captures of Accessible Smart Map made on 2026-11-05. Desktop captures use the web app (https://map.yuzen.dev/zh-TW/); phone captures use the native iOS App in the user’s iPhone 18 Pro simulator, running iOS 27.0. The supplied App Store brand references were not copied or embedded. No AI-generated imagery is used.

- `route-desktop.webp`: general walking result, Taipei Main Station to Zhongshan Station, 1440 × 1000.
- `route-native.webp`: native App, general walking route from 台北車站捷運站 to 中山站, with the map and mode controls visible, 1206 × 2622.
- `terrain-desktop.webp`: the same walking result with the details expanded, including the actual elevation graph and mapped sidewalk segments, 1440 × 1000.
- `wheelchair-desktop.webp`: wheelchair planning settings, 1440 × 1000. This is the settings screen, not evidence of a successful wheelchair route.
- `navigation-native.webp`: the same native App route in navigation preview, 1206 × 2622. The screen explicitly shows 路線預覽; it is not a field test. This is a general-mode route and includes stairs, not a wheelchair-route demonstration.
- `transit-desktop.webp`: actual transit query from Taipei Main Station to Taipei 101, 1440 × 1000.
- `assistant-desktop.webp`: actual AI response to a question about accessibility facilities between Taipei Main Station and Taipei 101, 1440 × 1000.

The captures use fixed public destinations. Browser captures used an anonymous isolated session. Native captures used the already-installed App; no account identity, saved places, or search history is visible in the published images. No device location was used as a route endpoint. Map attribution is retained. Compression: Sharp WebP, quality 88 (desktop) / 90 (mobile), original dimensions retained; native variants at 360 and 720 pixels wide. LandingImage uses local responsive srcset variants to serve appropriately sized captures. The small brand-mark.webp is derived from the existing app icon, not a capture.

Screenshots are historical UI demonstrations. Times, service conditions, elevations and route results are not current service guarantees. Green segments represent matched sidewalk data, not verified passability or accessibility certification. Elevation is modeled, not a field survey.

The Hero ASCII mark is sampled from the white symbol in the existing public/logo.png and stored as text in src/components/landing/brand-ascii.ts. It is not generated imagery. Landing-page accents use the same primary blue as src/app/globals.css; surfaces are warm neutrals.

Device presentation uses the official Magic UI Safari and Iphone components (MIT). Their original SVG geometry is retained; utility classes are translated to scoped marketing CSS, SVG IDs are unique per instance, and media uses accessible alt text and responsive local images. See src/components/landing/magicui/LICENSE.md. Safari preserves complete desktop captures using contain; iPhone displays native screenshots.
