// The health report's ready-to-show banners, one box each, in the order the
// backend sent them: errors first, then warnings.
import type { Banner } from "../server/health.ts";

const ERROR_BOX =
  "rounded border border-hot bg-hot/10 px-4 py-3 text-hot";
const WARNING_BOX =
  "rounded border border-warn bg-warn/10 px-3 py-2 text-sm text-warn";

export function HealthBanners({ banners }: { banners: Banner[] }) {
  if (banners.length === 0) return null;
  return (
    <ul className="mt-4 flex flex-col gap-2">
      {banners.map((banner, i) => (
        <li key={i} className={banner.level === "error" ? ERROR_BOX : WARNING_BOX}>
          {banner.text}
        </li>
      ))}
    </ul>
  );
}
