/**
 * A 40 px thumbnail for the admin table.
 *
 * Same plate idea as everywhere else, one size smaller: an editing table is
 * read by row, not admired. Lazy, sized, and unbothered by a missing file —
 * 27 collectibles have none.
 */
export function AdminThumb({ file, name }: { file: string | null; name: string }) {
  return (
    <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-sky-sm bg-plate ring-1 ring-card-border/70">
      {file ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/images/skylanders/${file}`}
          alt=""
          aria-hidden="true"
          loading="lazy"
          decoding="async"
          width={40}
          height={40}
          className="h-full w-full object-contain"
        />
      ) : (
        <span aria-hidden="true" className="text-[10px] text-on-plate-muted">
          —
        </span>
      )}
      <span className="sr-only">{name}</span>
    </span>
  );
}
