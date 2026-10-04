// The health report's ready-to-show banners, one box each, in the order the
// backend sent them: errors first, then warnings.
import type { Banner } from "../server/health.ts";

const ERROR_BOX =
  "rounded border border-red-600 bg-red-100 px-4 py-3 text-red-700 dark:border-red-500 dark:bg-red-950 dark:text-red-300";
const WARNING_BOX =
  "rounded border border-amber-500 bg-amber-100 px-3 py-2 text-sm text-amber-700 dark:border-amber-400 dark:bg-amber-950 dark:text-amber-300";

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
